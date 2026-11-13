/**
 * Regression tests for "the bot does not answer commands".
 *
 * Root cause: the gateway library was loaded through a variable-specifier
 * `import(specifier)` helper. Turbopack compiles a non-literal import into a
 * stub that always rejects ("Cannot find module as expression is too
 * dynamic"), so in a production build the bot never loaded discord.js, never
 * logged in, and silently retried forever. A second defect hid behind it:
 * the bot's state lived in module variables, and Next bundles the module once
 * for the boot hook and once for the API routes — two copies, two bots.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

process.env.DATABASE_URL ||= "postgres://test:test@127.0.0.1:5432/test";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("gateway library loading", () => {
  const src = read("../src/lib/discord-bot.ts");

  test("discord.js is imported with a literal specifier", () => {
    assert.match(src, /import\("discord\.js"\)/);
    // No import() whose argument is an identifier, and no helper that hides one.
    assert.doesNotMatch(src, /runtimeImport/);
    assert.doesNotMatch(src, /\bimport\(\s*[A-Za-z_$][\w$]*\s*\)/);
  });

  test("discord.js is an external server package, so the literal import survives bundling", () => {
    assert.match(read("../next.config.ts"), /serverExternalPackages:\s*\[[^\]]*"discord\.js"/);
  });

  test("the library the bot needs actually loads and has the API it uses", async () => {
    const d = (await import("discord.js")) as unknown as Record<string, unknown> & {
      GatewayIntentBits: Record<string, number>;
      Partials: Record<string, number>;
      Events: Record<string, string>;
    };
    for (const intent of ["Guilds", "GuildMessages", "GuildMembers", "DirectMessages", "MessageContent"]) {
      assert.equal(typeof d.GatewayIntentBits[intent], "number", intent);
    }
    assert.equal(typeof d.Partials.Channel, "number");
    assert.equal(typeof d.Client, "function");
    assert.equal(typeof d.ButtonBuilder, "function");
    assert.equal(typeof d.ActionRowBuilder, "function");
    // The bot listens for this event to mark itself online.
    assert.equal(d.Events.ClientReady, "clientReady");
    assert.match(src, /once\("clientReady"/);
  });
});

describe("one bot per process", () => {
  test("gateway state is shared through globalThis, not module variables", async () => {
    const src = read("../src/lib/discord-bot.ts");
    assert.match(src, /__gsmDiscordBot/);
    assert.doesNotMatch(src, /^let (client|retryTimer|xpTimer|starting)\b/m);

    const { getDiscordBotStatus } = await import("../src/lib/discord-bot");
    const holder = globalThis as unknown as { __gsmDiscordBot?: { status: { state: string; error: string | null } } };
    assert.ok(holder.__gsmDiscordBot, "the runtime is registered globally");
    assert.equal(getDiscordBotStatus().state, "stopped");

    // Another bundled copy of the module mutates the shared object; this copy sees it.
    holder.__gsmDiscordBot!.status = { ...holder.__gsmDiscordBot!.status, state: "error", error: "boom" };
    assert.equal(getDiscordBotStatus().state, "error");
    assert.equal(getDiscordBotStatus().error, "boom");
    // Callers get a copy, not the live object.
    getDiscordBotStatus().error = "tampered";
    assert.equal(getDiscordBotStatus().error, "boom");
  });
});

describe("describeBotLoginError", () => {
  test("names the fix for each common failure", async () => {
    const { describeBotLoginError } = await import("../src/lib/discord-bot");
    assert.match(describeBotLoginError("Used disallowed intents"), /Message Content Intent/);
    assert.match(describeBotLoginError("Privileged intent provided is not enabled or whitelisted."), /Server Members Intent/);
    assert.match(describeBotLoginError("An invalid token was provided."), /rejected the bot token/);
    assert.match(describeBotLoginError("Cannot find module as expression is too dynamic"), /npm ci/);
    assert.match(describeBotLoginError("Cannot find package 'discord.js' imported from /x"), /could not be loaded/);
    assert.match(describeBotLoginError("getaddrinfo ENOTFOUND gateway.discord.gg"), /could not reach Discord/);
    assert.equal(describeBotLoginError("something odd"), "Login failed: something odd");
  });
});
