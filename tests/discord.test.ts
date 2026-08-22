/**
 * Tests for Discord webhook notifications.
 *
 * The webhook URL is operator-supplied and gets POSTed to by the server, so
 * validation is a small SSRF surface as well as a correctness concern: a lax
 * check would let the panel be pointed at an arbitrary host.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isValidWebhookUrl, resolveWebhookUrl } from "../src/lib/discord";

describe("isValidWebhookUrl", () => {
  const valid = [
    "https://discord.com/api/webhooks/123456789/abcDEF-_xyz",
    "https://discordapp.com/api/webhooks/1/a", // legacy hostname still issued
    "https://ptb.discord.com/api/webhooks/1/a",
    "https://canary.discord.com/api/webhooks/1/a",
  ];
  for (const url of valid) {
    test(`accepts ${url}`, () => assert.equal(isValidWebhookUrl(url), true));
  }

  const invalid: Array<[string, string]> = [
    ["http://discord.com/api/webhooks/1/a", "plaintext http"],
    ["https://evil.com/api/webhooks/1/a", "wrong host"],
    ["https://discord.com.evil.com/api/webhooks/1/a", "host suffix attack"],
    ["https://discord.com/api/webhooks/", "no id or token"],
    ["https://discord.com/api/webhooks/abc/def", "non-numeric id"],
    ["https://discord.com/api/v10/channels/1/messages", "not a webhook route"],
    ["", "empty"],
    ["   ", "whitespace"],
    ["javascript:alert(1)", "non-http scheme"],
  ];
  for (const [url, why] of invalid) {
    test(`rejects ${why}`, () => assert.equal(isValidWebhookUrl(url), false));
  }

  test("rejects non-string input", () => {
    assert.equal(isValidWebhookUrl(null), false);
    assert.equal(isValidWebhookUrl(undefined), false);
  });
});

describe("resolveWebhookUrl", () => {
  const GLOBAL = "https://discord.com/api/webhooks/999/globaltoken";
  const PER_SERVER = "https://discord.com/api/webhooks/111/servertoken";

  test("prefers the per-server webhook", () => {
    process.env.DISCORD_WEBHOOK_URL = GLOBAL;
    assert.equal(resolveWebhookUrl(PER_SERVER), PER_SERVER);
    delete process.env.DISCORD_WEBHOOK_URL;
  });

  test("falls back to DISCORD_WEBHOOK_URL when the server has none", () => {
    // This env var was documented in .env.example and the README but nothing
    // ever read it, so the panel-wide default silently did nothing.
    process.env.DISCORD_WEBHOOK_URL = GLOBAL;
    assert.equal(resolveWebhookUrl(null), GLOBAL);
    assert.equal(resolveWebhookUrl(""), GLOBAL);
    assert.equal(resolveWebhookUrl("   "), GLOBAL);
    delete process.env.DISCORD_WEBHOOK_URL;
  });

  test("a malformed per-server value does not silence the global default", () => {
    process.env.DISCORD_WEBHOOK_URL = GLOBAL;
    assert.equal(resolveWebhookUrl("not-a-url"), GLOBAL);
    delete process.env.DISCORD_WEBHOOK_URL;
  });

  test("returns null when neither is usable", () => {
    delete process.env.DISCORD_WEBHOOK_URL;
    assert.equal(resolveWebhookUrl(null), null);
    assert.equal(resolveWebhookUrl("garbage"), null);
  });

  test("an invalid global default is not returned", () => {
    process.env.DISCORD_WEBHOOK_URL = "https://evil.com/api/webhooks/1/a";
    assert.equal(resolveWebhookUrl(null), null);
    delete process.env.DISCORD_WEBHOOK_URL;
  });

  test("surrounding whitespace is trimmed", () => {
    assert.equal(resolveWebhookUrl(`  ${PER_SERVER}  `), PER_SERVER);
  });
});

describe("sendDiscordWebhook payload", () => {
  // Point fetch at a local stub so the real embed structure can be asserted
  // without touching the network.
  async function capture(fn: () => Promise<unknown>) {
    const { createServer } = await import("node:http");
    let body: Record<string, unknown> = {};
    const srv = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        body = JSON.parse(raw || "{}");
        res.writeHead(204);
        res.end();
      });
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
    const port = (srv.address() as { port: number }).port;

    const realFetch = globalThis.fetch;
    globalThis.fetch = ((_url: string, init: RequestInit) =>
      realFetch(`http://127.0.0.1:${port}/`, init)) as typeof fetch;
    try {
      await fn();
    } finally {
      globalThis.fetch = realFetch;
      srv.close();
    }
    return body;
  }

  const HOOK = "https://discord.com/api/webhooks/123/abc";

  test("a crash notification carries the right title, colour and detail", async () => {
    const { notifyServerCrashed } = await import("../src/lib/discord");
    const body = await capture(() =>
      notifyServerCrashed(HOOK, "Survival SMP", "Minecraft: Java Edition", 25565, 137)
    );

    const embed = (body.embeds as Array<Record<string, unknown>>)[0];
    assert.match(String(embed.title), /Crashed/);
    assert.equal(embed.color, 0xef4444, "crashes should be red");
    assert.match(String(embed.description), /Survival SMP/);

    const fields = embed.fields as Array<{ name: string; value: string }>;
    assert.ok(fields.some((f) => f.value.includes("Minecraft")), "game name missing");
    assert.ok(fields.some((f) => f.value.includes("25565")), "port missing");
    assert.ok(fields.some((f) => f.name === "Exit Code"), "exit code missing");
    assert.ok(embed.timestamp, "embed should be timestamped");
  });

  test("no broken placeholder images are sent", async () => {
    // The footer icon pointed at a made-up emoji id and the avatar at a
    // third-party imgur upload; both rendered as broken images in Discord.
    const { notifyServerStarted } = await import("../src/lib/discord");
    const body = await capture(() =>
      notifyServerStarted(HOOK, "S", "G", "1.2.3.4", null, 27015)
    );
    assert.ok(!("avatar_url" in body), "avatar_url should not be sent");
    const embed = (body.embeds as Array<Record<string, unknown>>)[0];
    const footer = (embed.footer ?? {}) as Record<string, unknown>;
    assert.ok(!("icon_url" in footer), "footer icon_url should not be sent");
  });

  test("an invalid URL is refused before any request is made", async () => {
    const { sendDiscordWebhook } = await import("../src/lib/discord");
    const res = await sendDiscordWebhook("https://evil.com/api/webhooks/1/a", {
      serverName: "S",
      gameName: "G",
      port: 1,
      event: "server_started",
    });
    assert.equal(res.success, false);
    assert.match(String(res.error), /Invalid Discord webhook URL/);
  });
});
