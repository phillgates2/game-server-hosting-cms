/**
 * Tests for live Discord status boards.
 *
 * The board builder is pure (tests drive it directly), the webhook endpoint
 * and interval clamp are pinned, and the roster rendering is bounded so a
 * full server never produces a field Discord rejects.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  buildStatusBoardEmbed,
  buildStatusBoardPayload,
  messageEndpoint,
  clampInterval,
  stripColorCodes,
  rosterKey,
  MAX_LISTED_PLAYERS,
  MAX_EMBED_FIELD_LENGTH,
  STATUS_DEFAULT_INTERVAL_MINUTES,
} from "../src/lib/status-board-embed";

const VIEW = {
  serverName: "Operation Overlord",
  gameName: "Counter-Strike 2",
  address: "`203.0.113.7:27960`",
  online: true,
  map: "et_beach",
  players: 5,
  maxPlayers: 24,
  names: ["^5Rifleman^7", "Medic", "Sniper", "CovertOps", "Engineer"],
};

describe("buildStatusBoardEmbed", () => {
  test("online server: green dot, map, players and address", () => {
    const embed = buildStatusBoardEmbed(VIEW, new Date("2026-08-26T12:00:00Z"));
    assert.equal(embed.color, 0x22c55e, "online should be green");
    assert.match(embed.title, /Operation Overlord/);
    assert.equal(embed.fields[0].name, "Status");
    assert.equal(embed.fields[0].value, "🟢 Online");

    const mapField = embed.fields.find((f) => f.name === "🗺️ Map");
    assert.equal(mapField?.value, "et_beach");

    const playersField = embed.fields.find((f) => f.name === "👥 Players");
    assert.equal(playersField?.value, "5/24");

    const addressField = embed.fields.find((f) => f.name === "🌐 Address");
    assert.equal(addressField?.value, "`203.0.113.7:27960`");

    assert.equal(embed.timestamp, "2026-08-26T12:00:00.000Z", "Discord renders the updated time itself");
  });

  test("offline server: red dot and honest placeholders", () => {
    const embed = buildStatusBoardEmbed({
      ...VIEW,
      online: false,
      players: undefined,
      maxPlayers: undefined,
    });
    assert.equal(embed.color, 0xef4444, "offline should be red");
    assert.equal(embed.fields[0].value, "🔴 Offline");
    const playersField = embed.fields.find((f) => f.name === "👥 Players");
    assert.equal(playersField?.value, "—");
    assert.ok(!embed.fields.some((f) => f.name === "👤 Players online"), "no roster when offline");
  });

  test("roster strips colour codes and names the players", () => {
    const embed = buildStatusBoardEmbed(VIEW);
    const roster = embed.fields.find((f) => f.name === "👤 Players online");
    assert.ok(roster);
    assert.equal(roster.value.split("\n")[0], "• Rifleman");
    assert.match(roster.value, /Medic/);
    assert.match(roster.value, /Engineer/);
  });

  test("verified players get their Discord role color name appended", () => {
    const embed = buildStatusBoardEmbed({
      ...VIEW,
      names: ["^5Rifleman^7", "Medic", "Unknown"],
      pings: [12, 8, 55],
      roleColors: { rifleman: "#3b82f6", medic: "#22c55e" },
    });
    const roster = embed.fields.find((f) => f.name === "👤 Players online");
    assert.ok(roster);
    assert.equal(roster.value.split("\n")[0], "• Rifleman [12ms] 🎨 Vivid Azurite", "name + ping + color name");
    assert.equal(roster.value.split("\n")[1], "• Medic [8ms] 🎨 Vivid Jade");
    assert.equal(roster.value.split("\n")[2], "• Unknown [55ms]", "no annotation without a color");
  });

  test("the annotated roster still fits the field cap", () => {
    const names = Array.from({ length: 20 }, (_, i) => `Player${i}`);
    const roleColors: Record<string, string> = {};
    for (const n of names) roleColors[rosterKey(n)] = "#ef4444";
    const embed = buildStatusBoardEmbed({ ...VIEW, names, roleColors });
    const roster = embed.fields.find((f) => f.name === "👤 Players online");
    assert.ok(roster && roster.value.length <= MAX_EMBED_FIELD_LENGTH);
    assert.match(roster.value, /🎨 Bright Scarlet/);
  });

  test("a big roster is summarised, never a field Discord rejects", () => {
    const names = Array.from({ length: 40 }, (_, i) => `Player${i}`);
    const embed = buildStatusBoardEmbed({ ...VIEW, names });
    const roster = embed.fields.find((f) => f.name === "👤 Players online");
    assert.ok(roster);
    assert.equal(roster.value.split("\n").length, MAX_LISTED_PLAYERS + 1, "listed + the summary line");
    assert.match(roster.value, /… and 26 more/);
    assert.ok(roster.value.length <= MAX_EMBED_FIELD_LENGTH, "must stay under Discord's 1024 field cap");
  });

  test("probe failure while the panel says online is said honestly", () => {
    const embed = buildStatusBoardEmbed({ ...VIEW, players: undefined, probeFailed: true });
    const playersField = embed.fields.find((f) => f.name === "👥 Players");
    assert.equal(playersField?.value, "— (query port unreachable)");
  });

  test("payload carries a username and a single embed", () => {
    const payload = buildStatusBoardPayload(VIEW);
    assert.equal(payload.username, "GameServer Manager");
    assert.equal(payload.embeds.length, 1);
    assert.ok(payload.embeds[0].fields.length >= 4);
  });
});

describe("webhook wait behaviour (the reported 'no message id' bug)", () => {
  test("a Discord-accurate stub only returns the id when ?wait=true is sent", async () => {
    process.env.DATABASE_URL = "postgres://u:p@127.0.0.1:5432/db";
    const { createServer } = await import("node:http");
    const { createSocket } = await import("node:dgram");
    const { refreshServerBoard } = await import("../src/lib/status-board");

    // Fake game server (A2S, split protocol) so the view is live.
    const fake = createSocket("udp4");
    fake.on("message", (msg, rinfo) => {
      if (msg[4] === 0x54) {
        const buf = Buffer.concat([
          Buffer.from([0xff, 0xff, 0xff, 0xff, 0x49, 0x11]),
          Buffer.from("ET Board\0"), Buffer.from("et_beach\0"),
          Buffer.from("etmain\0"), Buffer.from("Wolf ET\0"),
          Buffer.from([0x0a, 0x00]), Buffer.from([0, 24, 0, 0x64, 0x6c, 0, 1]),
        ]);
        fake.send(buf, rinfo.port, rinfo.address);
      } else if (msg[4] === 0x55 && msg[5] === 0xff) {
        fake.send(Buffer.from([0xff, 0xff, 0xff, 0xff, 0x41, 0x78, 0x56, 0x34, 0x12]), rinfo.port, rinfo.address);
      } else if (msg[4] === 0x55) {
        const name = Buffer.from("^5Rifleman^7\0", "utf8");
        const score = Buffer.alloc(4); score.writeInt32LE(0, 0);
        const dur = Buffer.alloc(4); dur.writeFloatLE(10, 0);
        fake.send(Buffer.concat([
          Buffer.from([0xff, 0xff, 0xff, 0xff, 0x44, 1, 0]), name, score, dur,
        ]), rinfo.port, rinfo.address);
      }
    });
    await new Promise<void>((resolve) => fake.bind(0, "127.0.0.1", () => resolve()));
    const gamePort = (fake.address() as { port: number }).port;

    // Discord-accurate webhook stub: 204 with no body unless ?wait=true.
    let seenUrl = "";
    const srv = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        seenUrl = req.url || "";
        if (req.method === "POST" && seenUrl.includes("wait=true")) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ id: "1000000000000000007" }));
        } else {
          res.writeHead(204);
          res.end("");
        }
      });
    });
    await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", () => resolve()));
    const hookPort = (srv.address() as { port: number }).port;

    const realFetch = globalThis.fetch;
    globalThis.fetch = ((url: string, init: RequestInit) =>
      realFetch(`http://127.0.0.1:${hookPort}/${String(url).split("/").slice(-2).join("/")}`, init)) as typeof fetch;

    try {
      const server = {
        id: 1, name: "ET Server", ipv4: "127.0.0.1", ipv6: null,
        port: gamePort, queryPort: gamePort, variables: null, config: null,
        status: "running", gameName: "Wolfenstein: Enemy Territory", gameSlug: "cs2",
        discordWebhook: "https://discord.com/api/webhooks/12345/abc-xyz",
        discordStatusEnabled: true, discordStatusMessageId: null,
      };
      const result = await refreshServerBoard(server);
      assert.equal(result.ok, true, `board must post with wait=true: ${result.error}`);
      assert.equal(result.messageId, "1000000000000000007");
    } finally {
      globalThis.fetch = realFetch;
      await new Promise<void>((r) => srv.close(() => r()));
      fake.close();
    }
  });
});

describe("messageEndpoint", () => {
  const HOOK = "https://discord.com/api/webhooks/12345/abcDEF-_xyz";

  test("builds the edit URL for a webhook's own message", () => {
    assert.equal(messageEndpoint(HOOK, "987654321"), `${HOOK}/messages/987654321`);
  });

  test("refuses junk message ids and invalid webhooks", () => {
    assert.equal(messageEndpoint(HOOK, "abc"), null);
    assert.equal(messageEndpoint(HOOK, ""), null);
    assert.equal(messageEndpoint("https://evil.com/api/webhooks/1/a", "987654321"), null);
  });
});

describe("clampInterval", () => {
  test("clamps to 1-60 minutes and defaults on junk", () => {
    assert.equal(clampInterval(0), 1);
    assert.equal(clampInterval(999), 60);
    assert.equal(clampInterval(5), 5);
    assert.equal(clampInterval("7"), 7);
    assert.equal(clampInterval("abc"), STATUS_DEFAULT_INTERVAL_MINUTES);
    assert.equal(clampInterval(undefined), STATUS_DEFAULT_INTERVAL_MINUTES);
    assert.equal(clampInterval(2.6), 3, "rounds to a whole minute");
  });
});

describe("stripColorCodes", () => {
  test("removes ^-codes and keeps the rest", () => {
    assert.equal(stripColorCodes("^5Rifleman^7"), "Rifleman");
    assert.equal(stripColorCodes("Medic"), "Medic");
    assert.equal(stripColorCodes("^2x^3y"), "xy");
  });
});

describe("refreshServerBoard — webhook round trip", () => {
  test("posts a board message, then edits it via /messages/{id}", async () => {
    process.env.DATABASE_URL = "postgres://u:p@127.0.0.1:5432/db";
    const { createServer } = await import("node:http");
    import("node:dgram").then(() => {});
    const { createSocket } = await import("node:dgram");
    const { refreshServerBoard } = await import("../src/lib/status-board");

    // Fake game server (A2S, split protocol).
    const fake = createSocket("udp4");
    fake.on("message", (msg, rinfo) => {
      if (msg[4] === 0x54) {
        const buf = Buffer.concat([
          Buffer.from([0xff, 0xff, 0xff, 0xff, 0x49, 0x11]),
          Buffer.from("ET Board\0"), Buffer.from("et_beach\0"),
          Buffer.from("etmain\0"), Buffer.from("Wolf ET\0"),
          Buffer.from([0x0a, 0x00]), Buffer.from([0, 24, 0, 0x64, 0x6c, 0, 1]),
        ]);
        fake.send(buf, rinfo.port, rinfo.address);
      } else if (msg[4] === 0x55 && msg[5] === 0xff) {
        fake.send(Buffer.from([0xff, 0xff, 0xff, 0xff, 0x41, 0x78, 0x56, 0x34, 0x12]), rinfo.port, rinfo.address);
      } else if (msg[4] === 0x55) {
        const name = Buffer.from("^5Rifleman^7\0", "utf8");
        const score = Buffer.alloc(4); score.writeInt32LE(0, 0);
        const dur = Buffer.alloc(4); dur.writeFloatLE(10, 0);
        fake.send(Buffer.concat([
          Buffer.from([0xff, 0xff, 0xff, 0xff, 0x44, 1, 0]), name, score, dur,
        ]), rinfo.port, rinfo.address);
      }
    });
    await new Promise<void>((resolve) => fake.bind(0, "127.0.0.1", () => resolve()));
    const gamePort = (fake.address() as { port: number }).port;

    // Fake Discord webhook endpoint: records every request, answers 204 with
    // a message id when a message is created.
    const seen: Array<{ method: string; url: string; body: string }> = [];
    let messageSeq = 0;
    const srv = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        seen.push({ method: req.method || "", url: req.url || "", body: raw });
        res.writeHead(req.method === "POST" ? 200 : 204, { "Content-Type": "application/json" });
        res.end(req.method === "POST" ? JSON.stringify({ id: String(1_000_000_000_000_000_000 + ++messageSeq) }) : "");
      });
    });
    await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", () => resolve()));
    const hookPort = (srv.address() as { port: number }).port;

    const realFetch = globalThis.fetch;
    globalThis.fetch = ((url: string, init: RequestInit) =>
      realFetch(`http://127.0.0.1:${hookPort}/${String(url).split("/").slice(-2).join("/")}`, init)) as typeof fetch;

    try {
      const hook = `https://discord.com/api/webhooks/12345/abc-xyz`;
      const server = {
        id: 1, name: "ET Server", ipv4: "127.0.0.1", ipv6: null,
        port: gamePort, queryPort: gamePort, variables: null, config: null,
        status: "running", gameName: "Counter-Strike 2", gameSlug: "cs2",
        discordWebhook: hook, discordStatusEnabled: true, discordStatusMessageId: null,
      };

      // First refresh: POST the board. Discord answers 204 (no body) unless
      // the request carries ?wait=true; the board has to ask for the message.
      const first = await refreshServerBoard(server);
      assert.equal(first.ok, true, `first post failed: ${first.error}`);
      assert.ok(first.messageId);
      assert.equal(seen[0].method, "POST");
      assert.match(seen[0].url, /wait=true/, "webhook POST must include ?wait=true");
      assert.match(seen[0].body, /et_beach/);
      assert.match(seen[0].body, /Rifleman/);

      // Second refresh: PATCH /messages/{id}.
      const second = await refreshServerBoard({ ...server, discordStatusMessageId: first.messageId! });
      assert.equal(second.ok, true);
      assert.equal(seen[1].method, "PATCH");
      // The stub receives the path portion; the full Discord URL is what the
      // library built (asserted indirectly through the path).
      assert.equal(seen[1].url, `/messages/${first.messageId}`);
    } finally {
      globalThis.fetch = realFetch;
      await new Promise<void>((r) => srv.close(() => r()));
      fake.close();
    }
  });
});

describe("headingDue (the rename policy)", () => {
  const NOW = 1_700_000_000_000;

  test("a heading nobody has seen yet is written", async () => {
    const { headingDue } = await import("../src/lib/status-board");
    assert.equal(headingDue({}, true, NOW), "status");
    assert.equal(headingDue({ name: "x" } as never, false, NOW), "status");
  });

  test("an up/down change is applied at once, count churn waits for the cool-down", async () => {
    const { headingDue, CHANNEL_RENAME_COOLDOWN_MS } = await import("../src/lib/status-board");
    // The dot on screen says "up"; the server just stopped.
    assert.equal(headingDue({ online: true, renamedAt: NOW - 1_000 }, false, NOW), "status");
    // Same dot, cool-down still running: leave Discord alone.
    assert.equal(headingDue({ online: true, renamedAt: NOW - 1_000 }, true, NOW), null);
    // Same dot, cool-down over: the count or map may have moved.
    assert.equal(
      headingDue({ online: true, renamedAt: NOW - CHANNEL_RENAME_COOLDOWN_MS }, true, NOW),
      "refresh"
    );
  });

  test("two renames per channel per ten minutes is the budget, and a 429 is obeyed", async () => {
    const { headingDue, CHANNEL_RENAME_COOLDOWN_MS, CHANNEL_RENAME_RETRY_MS } = await import("../src/lib/status-board");
    // Discord's documented channel-name limit — changing this silently would
    // mean rate-limited channels, which is what the heading cannot afford.
    assert.equal(CHANNEL_RENAME_COOLDOWN_MS, 10 * 60_000);
    assert.equal(CHANNEL_RENAME_RETRY_MS, 10 * 60_000);
    // A backoff outranks even a status change: Discord said "wait".
    assert.equal(headingDue({ online: true, renamedAt: NOW, blockedUntil: NOW + 60_000 }, false, NOW), null);
    assert.equal(headingDue({ online: true, renamedAt: NOW, blockedUntil: NOW - 1 }, false, NOW), "status");
  });
});

/**
 * The channel heading: the 🟢/🔴 in the Discord channel name.
 *
 * These are the cases that were broken in the field: the heading only moved
 * when a board message was posted, and every board refresh tried a rename
 * whether or not it was inside Discord's two-per-ten-minutes budget. So the
 * tests below drive the real transport against a stubbed Discord API and a
 * fake game server, and assert what actually reaches Discord.
 */
describe("channel heading (🟢/🔴 in the channel name)", () => {
  test("down servers go red without querying the game, up servers say who is on", async () => {
    process.env.DATABASE_URL = "postgres://u:p@127.0.0.1:5432/db";
    process.env.DISCORD_BOT_TOKEN = "test-bot-token";
    process.env.DISCORD_GUILD_ID = "100000000000000001";

    const { createServer } = await import("node:http");
    const { createSocket } = await import("node:dgram");
    const {
      syncChannelHeading,
      resetChannelHeadingState,
    } = await import("../src/lib/status-board");

    resetChannelHeadingState();

    // Fake ET server: answers the Quake 3 getstatus the ET probe sends, and
    // counts every query so "a down server is never queried" can be asserted.
    let gameQueries = 0;
    const fake = createSocket("udp4");
    fake.on("message", (msg, rinfo) => {
      gameQueries++;
      fake.send(Buffer.concat([
        Buffer.from([0xff, 0xff, 0xff, 0xff]),
        Buffer.from(
          "statusResponse\n\\sv_hostname\\ET Heading\\mapname\\et_beach\\sv_maxclients\\24\n5 42 \"^5Rifleman^7\"\n",
          "latin1"
        ),
      ]), rinfo.port, rinfo.address);
    });
    await new Promise<void>((resolve) => fake.bind(0, "127.0.0.1", () => resolve()));
    const gamePort = (fake.address() as { port: number }).port;

    // Stub Discord: records every channel rename.
    const renames: string[] = [];
    const srv = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        if (req.method === "PATCH" && /\/channels\/\d+$/.test(req.url || "")) {
          renames.push(String((JSON.parse(raw) as { name?: string }).name ?? ""));
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ id: "123456789012345678", name: renames[renames.length - 1] }));
          return;
        }
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end("{}");
      });
    });
    await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", () => resolve()));
    const apiPort = (srv.address() as { port: number }).port;

    const realFetch = globalThis.fetch;
    globalThis.fetch = ((url: string, init: RequestInit) =>
      realFetch(`http://127.0.0.1:${apiPort}${new URL(String(url)).pathname}`, init)) as typeof fetch;

    const server = {
      id: 4711,
      name: "ET Heading",
      ipv4: "127.0.0.1",
      ipv6: null,
      port: gamePort,
      queryPort: gamePort,
      variables: null,
      config: null,
      status: "stopped",
      gameName: "Wolfenstein: Enemy Territory",
      gameSlug: "wolfenstein-et",
      discordChannelId: "123456789012345678",
    };

    try {
      // A server that is down needs no game query at all — the heading is a
      // status fact the panel already knows.
      const down = await syncChannelHeading(server);
      assert.equal(down.ok, true, `heading rename failed: ${down.error}`);
      assert.equal(down.renamed, true);
      // Discord lowercases channel names, so the applied name comes back lower.
      assert.equal(down.name, "🔴 et: server offline");
      assert.equal(gameQueries, 0, "a down server must not be queried");

      // Same state again, inside the cool-down: nothing is sent to Discord.
      const repeat = await syncChannelHeading(server);
      assert.equal(repeat.skipped, "cooldown");
      assert.equal(renames.length, 1);

      // Up: the probe supplies the map and count, and the dot goes green.
      const running = { ...server, status: "running" };
      const up = await syncChannelHeading(running);
      assert.equal(up.ok, true, `heading rename failed: ${up.error}`);
      assert.equal(up.name, "🟢 et: (1) - et_beach");
      assert.ok(gameQueries > 0, "an up server is probed for map and players");
      assert.deepEqual(renames, ["🔴 et: server offline", "🟢 et: (1) - et_beach"]);

      // A count change inside the cool-down waits — Discord only allows two
      // renames per ten minutes per channel, and a 429 leaves the heading
      // stale, which is exactly the reported bug.
      const cached = await import("../src/lib/status-cache");
      cached.setCachedView(server.id, {
        serverName: "ET Heading",
        gameName: "Wolfenstein: Enemy Territory",
        address: "`127.0.0.1:27960`",
        online: true,
        players: 9,
        maxPlayers: 24,
        map: "goldrush",
      });
      const churn = await syncChannelHeading(running);
      assert.equal(churn.skipped, "cooldown", "count churn waits for the cool-down");
      assert.equal(renames.length, 2);

      // …but going down is applied immediately, cool-down or not.
      const back = await syncChannelHeading(server);
      assert.equal(back.renamed, true, "a status change must bypass the cool-down");
      assert.equal(renames[2], "🔴 et: server offline");
    } finally {
      globalThis.fetch = realFetch;
      delete process.env.DISCORD_BOT_TOKEN;
      delete process.env.DISCORD_GUILD_ID;
      await new Promise<void>((r) => srv.close(() => r()));
      fake.close();
    }
  });

  test("a probe that times out does not downgrade a good heading", async () => {
    process.env.DATABASE_URL = "postgres://u:p@127.0.0.1:5432/db";
    process.env.DISCORD_BOT_TOKEN = "test-bot-token";
    process.env.DISCORD_GUILD_ID = "100000000000000001";

    const { createServer } = await import("node:http");
    const { createSocket } = await import("node:dgram");
    const { syncChannelHeading, resetChannelHeadingState } = await import("../src/lib/status-board");
    resetChannelHeadingState();

    // A UDP port that never answers: the server is up, the query port is not.
    const silent = createSocket("udp4");
    await new Promise<void>((resolve) => silent.bind(0, "127.0.0.1", () => resolve()));
    const gamePort = (silent.address() as { port: number }).port;

    let renames = 0;
    const srv = createServer((req, res) => {
      renames++;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: "123456789012345678", name: "x" }));
    });
    await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", () => resolve()));
    const apiPort = (srv.address() as { port: number }).port;

    const realFetch = globalThis.fetch;
    globalThis.fetch = ((url: string, init: RequestInit) =>
      realFetch(`http://127.0.0.1:${apiPort}${new URL(String(url)).pathname}`, init)) as typeof fetch;

    const server = {
      id: 4713, name: "Slow Query", ipv4: "127.0.0.1", ipv6: null,
      port: gamePort, queryPort: gamePort, variables: null, config: null,
      status: "running", gameName: "WolfET", gameSlug: "wolfenstein-et",
      discordChannelId: "123456789012345678",
    };

    const { CHANNEL_RENAME_COOLDOWN_MS } = await import("../src/lib/status-board");

    try {
      // First sight of this server: nothing is known about the heading, so the
      // dot is written even though the players are not — "is it up?" is the
      // question the heading answers.
      const first = await syncChannelHeading(server);
      assert.equal(first.renamed, true, `expected a green dot, got ${first.skipped}`);
      assert.equal(first.name, "🟢 et: (?) - unknown-map");
      assert.equal(renames, 1);

      // From here the dot on screen is already correct. Once the cool-down has
      // passed and the query port still does not answer, the count and map are
      // left alone rather than downgraded again.
      const later = await syncChannelHeading(server, { now: Date.now() + CHANNEL_RENAME_COOLDOWN_MS + 1_000 });
      assert.equal(later.skipped, "probe-failed");
      assert.equal(renames, 1, "a failed probe must not spend a rename");
    } finally {
      globalThis.fetch = realFetch;
      delete process.env.DISCORD_BOT_TOKEN;
      delete process.env.DISCORD_GUILD_ID;
      await new Promise<void>((r) => srv.close(() => r()));
      silent.close();
    }
  });

  test("a 429 backs the heading off instead of burning the next tick", async () => {
    process.env.DATABASE_URL = "postgres://u:p@127.0.0.1:5432/db";
    process.env.DISCORD_BOT_TOKEN = "test-bot-token";
    process.env.DISCORD_GUILD_ID = "100000000000000001";

    const { createServer } = await import("node:http");
    const { syncChannelHeading, resetChannelHeadingState } = await import("../src/lib/status-board");
    resetChannelHeadingState();

    let attempts = 0;
    const srv = createServer((req, res) => {
      attempts++;
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "You are being rate limited.", retry_after: 300 }));
    });
    await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", () => resolve()));
    const apiPort = (srv.address() as { port: number }).port;

    const realFetch = globalThis.fetch;
    globalThis.fetch = ((url: string, init: RequestInit) =>
      realFetch(`http://127.0.0.1:${apiPort}${new URL(String(url)).pathname}`, init)) as typeof fetch;

    const server = {
      id: 4712, name: "Rate Limited", ipv4: "127.0.0.1", ipv6: null,
      port: 27960, queryPort: 27961, variables: null, config: null,
      status: "stopped", gameName: "WolfET", gameSlug: "wolfenstein-et",
      discordChannelId: "123456789012345678",
    };

    try {
      const first = await syncChannelHeading(server);
      assert.equal(first.ok, false);
      assert.match(String(first.error), /rate limit/i);
      assert.equal(attempts, 1);

      // Discord said "wait 300s": the next attempt must not even call out.
      const second = await syncChannelHeading(server);
      assert.equal(second.skipped, "backoff");
      assert.equal(attempts, 1, "no second request inside the retry-after window");
    } finally {
      globalThis.fetch = realFetch;
      delete process.env.DISCORD_BOT_TOKEN;
      delete process.env.DISCORD_GUILD_ID;
      await new Promise<void>((r) => srv.close(() => r()));
    }
  });
});
