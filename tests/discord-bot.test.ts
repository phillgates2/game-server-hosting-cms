/**
 * Tests for Discord bot channel provisioning.
 *
 * A webhook can only post into a channel that already exists, so "one channel
 * per server" needs the bot API: POST /guilds/{id}/channels followed by
 * POST /channels/{id}/webhooks. These tests drive that flow against a local
 * stub so the call sequence, name normalisation and failure handling are
 * verified without touching Discord.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { toChannelName, isBotConfigured } from "../src/lib/discord";

describe("toChannelName", () => {
  test("lowercases and hyphenates, matching what Discord would do anyway", () => {
    assert.equal(toChannelName("My Server"), "my-server");
    assert.equal(toChannelName("Survival SMP"), "survival-smp");
  });

  test("applies a prefix", () => {
    assert.equal(toChannelName("My Server", "gs-"), "gs-my-server");
  });

  test("strips punctuation and collapses separators", () => {
    assert.equal(toChannelName("  CS2 · Comp #1  "), "cs2-comp-1");
    assert.equal(toChannelName("a___b   c"), "a-b-c");
  });

  test("folds accented characters rather than dropping the name", () => {
    assert.equal(toChannelName("Ünïcödé Náme"), "unicode-name");
  });

  test("falls back when nothing usable remains", () => {
    // Discord rejects an empty channel name outright.
    assert.equal(toChannelName("!!!"), "game-server");
    assert.equal(toChannelName(""), "game-server");
  });

  test("truncates to Discord's 100 character limit", () => {
    assert.equal(toChannelName("a".repeat(150)).length, 100);
  });
});

describe("isBotConfigured", () => {
  test("requires both a token and a guild id", () => {
    assert.equal(isBotConfigured({ token: "t", guildId: "1" }), true);
    assert.equal(isBotConfigured({ token: "t", guildId: "" }), false);
    assert.equal(isBotConfigured({ token: "", guildId: "1" }), false);
    assert.equal(isBotConfigured({ token: "   ", guildId: "1" }), false);
    assert.equal(isBotConfigured(null), false);
    assert.equal(isBotConfigured(undefined), false);
  });
});

/** Spin up a stub Discord API and point fetch at it. */
async function withStubDiscord(
  handler: (req: { method: string; url: string; body: string }) =>
    { status: number; json?: unknown; text?: string },
  fn: (calls: string[]) => Promise<void>
) {
  const calls: string[] = [];
  const srv: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      calls.push(`${req.method} ${req.url}`);
      const out = handler({ method: req.method || "", url: req.url || "", body });
      res.writeHead(out.status, { "content-type": "application/json" });
      res.end(out.json !== undefined ? JSON.stringify(out.json) : (out.text ?? ""));
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  const port = (srv.address() as { port: number }).port;

  const realFetch = globalThis.fetch;
  globalThis.fetch = ((url: string, init: RequestInit) =>
    realFetch(String(url).replace("https://discord.com/api/v10", `http://127.0.0.1:${port}`), init)
  ) as typeof fetch;

  try {
    await fn(calls);
  } finally {
    globalThis.fetch = realFetch;
    srv.close();
  }
}

const CFG = { token: "tok", guildId: "123", categoryId: "999" };

describe("provisionServerChannel", () => {
  test("creates the channel then a webhook in it, and returns the URL", async () => {
    const { provisionServerChannel } = await import("../src/lib/discord");

    await withStubDiscord(
      ({ url, method }) => {
        if (method === "POST" && url.includes("/guilds/") && url.endsWith("/channels")) {
          return { status: 200, json: { id: "555" } };
        }
        if (method === "POST" && /^\/channels\/\d+\/webhooks$/.test(url)) {
          return { status: 200, json: { id: "777", token: "abc" } };
        }
        return { status: 404, text: "" };
      },
      async (calls) => {
        const res = await provisionServerChannel(CFG, "My Server", { prefix: "gs-" });
        assert.equal(res.ok, true);
        assert.equal(res.channelId, "555");
        assert.equal(res.channelName, "gs-my-server");
        assert.equal(res.webhookUrl, "https://discord.com/api/webhooks/777/abc");
        assert.deepEqual(calls, ["POST /guilds/123/channels", "POST /channels/555/webhooks"]);
      }
    );
  });

  test("nests the channel under the configured category", async () => {
    const { provisionServerChannel } = await import("../src/lib/discord");
    let sentParent: unknown;

    await withStubDiscord(
      ({ url, method, body }) => {
        if (method === "POST" && url.endsWith("/channels")) {
          sentParent = JSON.parse(body).parent_id;
          return { status: 200, json: { id: "1" } };
        }
        return { status: 200, json: { id: "2", token: "t" } };
      },
      async () => {
        await provisionServerChannel(CFG, "S");
        assert.equal(sentParent, "999");
      }
    );
  });

  test("reports precisely when the channel exists but the webhook fails", async () => {
    // Leaving the operator with a channel that receives nothing is confusing;
    // the error has to say which half succeeded.
    const { provisionServerChannel } = await import("../src/lib/discord");

    await withStubDiscord(
      ({ url, method }) => {
        if (method === "POST" && url.endsWith("/channels")) return { status: 200, json: { id: "555" } };
        return { status: 403, text: "missing perms" };
      },
      async () => {
        const res = await provisionServerChannel(CFG, "Another");
        assert.equal(res.ok, false);
        assert.equal(res.channelId, "555", "the created channel id should still be reported");
        assert.match(String(res.error), /was created but the webhook could not be/);
        assert.match(String(res.error), /Manage Webhooks/);
      }
    );
  });

  test("maps common HTTP failures to actionable messages", async () => {
    const { provisionServerChannel } = await import("../src/lib/discord");

    const cases: Array<[number, RegExp]> = [
      [401, /Invalid bot token/],
      [403, /Manage Channels/],
      [404, /Guild or category not found/],
      [429, /Rate limited/],
    ];

    for (const [status, expected] of cases) {
      await withStubDiscord(
        () => ({ status, text: "err" }),
        async () => {
          const res = await provisionServerChannel(CFG, "S");
          assert.equal(res.ok, false);
          assert.match(String(res.error), expected, `status ${status}`);
        }
      );
    }
  });
});

describe("verifyBot", () => {
  test("returns the guild name on success", async () => {
    const { verifyBot } = await import("../src/lib/discord");
    await withStubDiscord(
      () => ({ status: 200, json: { name: "My Guild" } }),
      async () => {
        const res = await verifyBot(CFG);
        assert.equal(res.ok, true);
        assert.equal(res.guildName, "My Guild");
      }
    );
  });

  test("surfaces a bad token clearly", async () => {
    const { verifyBot } = await import("../src/lib/discord");
    await withStubDiscord(
      () => ({ status: 401, text: "unauthorized" }),
      async () => {
        const res = await verifyBot(CFG);
        assert.equal(res.ok, false);
        assert.match(String(res.error), /Invalid bot token/);
      }
    );
  });
});
