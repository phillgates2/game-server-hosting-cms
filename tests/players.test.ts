/**
 * Tests for live player-count probes.
 *
 * The parsers are pure functions driven by hand-built protocol fixtures, and
 * the probes are exercised end-to-end against fake servers bound to
 * 127.0.0.1 — no real game server or external network required.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createSocket, type Socket } from "node:dgram";
import { createServer, type Server } from "node:net";
import type { AddressInfo } from "node:net";

import {
  parseA2sInfo,
  parseA2sChallenge,
  parseA2sPlayers,
  parseMinecraftStatus,
  parseMinecraftStatusFrame,
  parseBedrockPing,
  parseQuake3Status,
  probeSpecFor,
  maxPlayersFrom,
  probePlayers,
} from "../src/lib/players";

// ── Fixture builders ─────────────────────────────────────────────────────────

function a2sInfoModern(opts: { players: number; maxPlayers: number; name?: string }): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xff, 0xff, 0xff, 0x49, 0x11]),
    Buffer.from(`${opts.name ?? "Test Server"}\0`),
    Buffer.from("de_dust2\0"),
    Buffer.from("csgo\0"),
    Buffer.from("Counter-Strike\0"),
    Buffer.from([0x0a, 0x00]), // app id
    Buffer.from([opts.players, opts.maxPlayers, 0, 0x64, 0x6c, 0, 1]),
  ]);
}

function a2sInfoLegacy(players: number, maxPlayers: number): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xff, 0xff, 0xff, 0x6d]),
    Buffer.from("127.0.0.1:27015\0"),
    Buffer.from("Legacy Server\0"),
    Buffer.from("map1\0"),
    Buffer.from("folder\0"),
    Buffer.from("Game\0"),
    Buffer.from([players, maxPlayers, 0x11, 0x64, 0x6c, 0]),
  ]);
}

function a2sPlayerList(names: string[]): Buffer {
  const parts = [Buffer.from([0xff, 0xff, 0xff, 0xff, 0x44, names.length])];
  names.forEach((name, i) => {
    const score = Buffer.alloc(4);
    score.writeInt32LE(i, 0);
    const duration = Buffer.alloc(4);
    duration.writeFloatLE(10.5, 0);
    parts.push(Buffer.concat([Buffer.from([i]), Buffer.from(`${name}\0`), score, duration]));
  });
  return Buffer.concat(parts);
}

const RAKNET_MAGIC = Buffer.from([
  0x00, 0xff, 0xff, 0x00, 0xfe, 0xfe, 0xfe, 0xfe,
  0xfd, 0xfd, 0xfd, 0xfd, 0x12, 0x34, 0x56, 0x78,
]);

function bedrockPong(players: number, max: number): Buffer {
  const motd = `MCPE;Dedicated Server;766;1.21.0;${players};${max};123456789;Survival;1;19132;19133;`;
  const b = Buffer.alloc(35 + motd.length);
  b[0] = 0x1c;
  RAKNET_MAGIC.copy(b, 17);
  b.writeUInt16BE(motd.length, 33);
  b.write(motd, 35, "utf8");
  return b;
}

function quake3Status(): Buffer {
  const text =
    "\xff\xff\xff\xffstatusResponse\n" +
    "\\challenge\\-163654063\\clients\\4\\g_needpass\\0\\mapname\\ctf_well\\sv_maxclients\\16\\sv_hostname\\^5OZ^7 Team Server\\version\\ioq3 1.36\n" +
    '0 12 "^5Alice^7"\n' +
    '1 8 "Bob"\n' +
    '2 3 "Carol"\n' +
    '3 0 "^o[BOT]^7Omni Bot"\n';
  return Buffer.from(text, "latin1");
}

function writeVarInt(value: number): Buffer {
  const out: number[] = [];
  let v = value >>> 0;
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v !== 0) b |= 0x80;
    out.push(b);
  } while (v !== 0);
  return Buffer.from(out);
}

function minecraftResponse(online: number, max: number): Buffer {
  const json = JSON.stringify({
    version: { name: "1.21", protocol: 769 },
    players: { online, max, sample: [] },
    description: { text: "Hi" },
  });
  const jsonBuf = Buffer.from(json, "utf8");
  const payload = Buffer.concat([Buffer.from([0x00]), writeVarInt(jsonBuf.length), jsonBuf]);
  return Buffer.concat([writeVarInt(payload.length), payload]);
}

// ── Pure parsers ─────────────────────────────────────────────────────────────

describe("parseA2sInfo", () => {
  test("parses the modern (0x49) encoding", () => {
    const info = parseA2sInfo(a2sInfoModern({ players: 0, maxPlayers: 20, name: "My Server" }));
    assert.ok(info);
    assert.equal(info.name, "My Server");
    assert.equal(info.map, "de_dust2");
    assert.equal(info.players, 0, "split protocol reports a placeholder zero");
    assert.equal(info.maxPlayers, 20);
  });

  test("parses the legacy (0x6D) encoding, which carries the real count", () => {
    const info = parseA2sInfo(a2sInfoLegacy(7, 24));
    assert.ok(info);
    assert.equal(info.players, 7);
    assert.equal(info.maxPlayers, 24);
    assert.equal(info.map, "map1");
  });

  test("rejects non-A2S bytes", () => {
    assert.equal(parseA2sInfo(Buffer.from("hello world")), null);
    assert.equal(parseA2sInfo(Buffer.from([0xff, 0xff, 0xff, 0xff, 0x99])), null);
  });
});

describe("parseA2sChallenge / parseA2sPlayers", () => {
  test("extracts the challenge int", () => {
    const challenge = parseA2sChallenge(Buffer.from([0xff, 0xff, 0xff, 0xff, 0x41, 0x78, 0x56, 0x34, 0x12]));
    assert.equal(challenge, 0x12345678);
  });

  test("reads a player list", () => {
    const list = parseA2sPlayers(a2sPlayerList(["Alice", "Bob"]));
    assert.ok(list);
    assert.equal(list.players, 2);
    assert.deepEqual(list.names, ["Alice", "Bob"]);
  });

  test("accepts an empty player list", () => {
    const list = parseA2sPlayers(a2sPlayerList([]));
    assert.ok(list);
    assert.equal(list.players, 0);
    assert.deepEqual(list.names, []);
  });
});

describe("Minecraft ping parsing", () => {
  test("extracts online and max from the status JSON", () => {
    const parsed = parseMinecraftStatus(
      JSON.stringify({ version: { name: "1.21" }, players: { online: 5, max: 20 } })
    );
    assert.deepEqual(parsed, { players: 5, maxPlayers: 20 });
  });

  test("rejects malformed JSON and non-status shapes", () => {
    assert.equal(parseMinecraftStatus("not json"), null);
    assert.equal(parseMinecraftStatus(JSON.stringify({ players: {} })), null);
  });

  test("unwraps a full response frame", () => {
    const frame = minecraftResponse(5, 20);
    const json = parseMinecraftStatusFrame(frame);
    assert.ok(json);
    assert.deepEqual(parseMinecraftStatus(json), { players: 5, maxPlayers: 20 });
  });

  test("rejects a truncated frame", () => {
    assert.equal(parseMinecraftStatusFrame(Buffer.from([0x10, 0x00])), null);
  });
});

describe("parseBedrockPing", () => {
  test("extracts players and max from the MOTD string", () => {
    const parsed = parseBedrockPing(bedrockPong(3, 20));
    assert.deepEqual(parsed, { players: 3, maxPlayers: 20 });
  });

  test("rejects short or non-pong datagrams", () => {
    assert.equal(parseBedrockPing(Buffer.from([0x1c, 0x00])), null);
    assert.equal(parseBedrockPing(Buffer.from([0x99, 0x00, 0x00])), null);
  });
});

describe("parseQuake3Status", () => {
  test("reads players, pings, map, hostname — and filters bots like the original", () => {
    const parsed = parseQuake3Status(quake3Status());
    assert.ok(parsed);
    assert.equal(parsed.players, 3, "the ping-0 BOT line is excluded");
    assert.equal(parsed.maxPlayers, 16);
    assert.equal(parsed.map, "ctf_well");
    assert.equal(parsed.hostname, "OZ Team Server", "colour codes stripped from sv_hostname");
    assert.deepEqual(parsed.names, ["^5Alice^7", "Bob", "Carol"], "raw names; colour codes are stripped when displayed");
    assert.deepEqual(parsed.pings, [12, 8, 3], "pings ride along with the roster");
  });

  test("falls back to counting player lines when clients is absent", () => {
    const text =
      "\xff\xff\xff\xffstatusResponse\n" +
      "\\challenge\\-1\\mapname\\q3dm17\\sv_maxclients\\8\n" +
      '0 12 "^5Alice^7"\n' +
      '1 8 "Bob"\n';
    const parsed = parseQuake3Status(Buffer.from(text, "latin1"));
    assert.ok(parsed);
    assert.equal(parsed.players, 2);
    assert.equal(parsed.maxPlayers, 8);
    assert.equal(parsed.map, "q3dm17");
    assert.deepEqual(parsed.names, ["^5Alice^7", "Bob"]);
    assert.deepEqual(parsed.pings, [12, 8]);
  });
});

// ── Spec resolution ──────────────────────────────────────────────────────────

describe("probeSpecFor", () => {
  test("maps the engines this panel ships", () => {
    assert.deepEqual(probeSpecFor("cs2"), { kind: "a2s", port: "query" });
    assert.deepEqual(probeSpecFor("rust"), { kind: "a2s", port: "query" });
    assert.deepEqual(probeSpecFor("minecraft-java"), { kind: "minecraft", port: "game" });
    assert.deepEqual(probeSpecFor("minecraft-bedrock"), { kind: "bedrock", port: "game" });
    assert.deepEqual(probeSpecFor("quake-live"), { kind: "quake3", port: "game" });
  });

  test("games without a query protocol are 'none', not a guess", () => {
    assert.equal(probeSpecFor("valheim").kind, "none");
    assert.equal(probeSpecFor("factorio").kind, "none");
    assert.equal(probeSpecFor("openra").kind, "none");
  });

  test("unknown and custom games are 'none'", () => {
    assert.equal(probeSpecFor("totally-custom-game").kind, "none");
  });
});

describe("maxPlayersFrom", () => {
  test("the wizard entry wins over the template default", () => {
    assert.equal(maxPlayersFrom({ MAX_PLAYERS: "24" }, { MAX_PLAYERS: 32 }), 24);
  });

  test("falls back to the default config", () => {
    assert.equal(maxPlayersFrom({}, { MAX_PLAYERS: 32 }), 32);
  });

  test("accepts numbers, rejects nonsense and absurd values", () => {
    assert.equal(maxPlayersFrom({ MAX_PLAYERS: 16 }, {}), 16);
    assert.equal(maxPlayersFrom({ MAX_PLAYERS: "9999" }, {}), undefined);
    assert.equal(maxPlayersFrom({ MAX_PLAYERS: "abc" }, {}), undefined);
    assert.equal(maxPlayersFrom(null, undefined), undefined);
  });
});

// ── End-to-end probes against local fake servers ──────────────────────────────

async function listenUdp(handler: (msg: Buffer, reply: (data: Buffer) => void) => void): Promise<{ port: number; close: () => Promise<void> }> {
  const sock: Socket = createSocket("udp4");
  sock.on("message", (msg, rinfo) => {
    handler(Buffer.from(msg), (data) => sock.send(data, rinfo.port, rinfo.address));
  });
  await new Promise<void>((resolve) => sock.bind(0, "127.0.0.1", () => resolve()));
  return {
    port: (sock.address() as AddressInfo).port,
    close: () =>
      new Promise<void>((resolve) => {
        try { sock.close(() => resolve()); } catch { resolve(); }
      }),
  };
}

describe("probePlayers — A2S", () => {
  test("completes the full challenge flow and returns the live count", async () => {
    const fake = await listenUdp((msg, reply) => {
      if (msg[4] === 0x54) {
        reply(a2sInfoModern({ players: 0, maxPlayers: 20, name: "Fake CS2" }));
      } else if (msg[4] === 0x55 && msg[5] === 0xff && msg[6] === 0xff && msg[7] === 0xff && msg[8] === 0xff) {
        // The bare 0xffffffff challenge request for a player query.
        reply(Buffer.from([0xff, 0xff, 0xff, 0xff, 0x41, 0x78, 0x56, 0x34, 0x12]));
      } else if (msg[4] === 0x55) {
        reply(a2sPlayerList(["Alice", "Bob"]));
      }
    });
    try {
      const probe = await probePlayers({
        gameSlug: "cs2",
        host: "127.0.0.1",
        port: 27000,
        queryPort: fake.port,
        timeoutMs: 800,
      });
      assert.equal(probe.ok, true);
      assert.equal(probe.players, 2);
      assert.equal(probe.maxPlayers, 20);
      assert.equal(probe.map, "de_dust2", "the status board needs the map");
      assert.deepEqual(probe.names, ["Alice", "Bob"], "the status board needs the roster");
      assert.equal(probe.protocol, "A2S");
    } finally {
      await fake.close();
    }
  });

  test("a legacy (0x6D) reply needs no challenge round", async () => {
    const fake = await listenUdp((msg, reply) => {
      if (msg[4] === 0x54) reply(a2sInfoLegacy(7, 24));
    });
    try {
      const probe = await probePlayers({
        gameSlug: "cs2", host: "127.0.0.1", port: 27000, queryPort: fake.port, timeoutMs: 800,
      });
      assert.equal(probe.ok, true);
      assert.equal(probe.players, 7);
      assert.equal(probe.maxPlayers, 24);
    } finally {
      await fake.close();
    }
  });

  test("a server that blocks A2S_PLAYER still reports max players", async () => {
    const fake = await listenUdp((msg, reply) => {
      if (msg[4] === 0x54) reply(a2sInfoModern({ players: 0, maxPlayers: 16 }));
      // never answer the challenge
    });
    try {
      const probe = await probePlayers({
        gameSlug: "tf2", host: "127.0.0.1", port: 27000, queryPort: fake.port, timeoutMs: 400,
      });
      assert.equal(probe.ok, true);
      assert.equal(probe.players, undefined);
      assert.equal(probe.maxPlayers, 16);
    } finally {
      await fake.close();
    }
  });
});

describe("probePlayers — Minecraft and Bedrock", () => {
  test("Java ping via TCP", async () => {
    const srv: Server = createServer((socket) => {
      socket.once("data", () => socket.end(minecraftResponse(5, 20)));
      socket.on("error", () => {});
    });
    await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", () => resolve()));
    const port = (srv.address() as AddressInfo).port;
    try {
      const probe = await probePlayers({
        gameSlug: "minecraft-java", host: "127.0.0.1", port, timeoutMs: 2000,
      });
      assert.equal(probe.ok, true);
      assert.equal(probe.players, 5);
      assert.equal(probe.maxPlayers, 20);
      assert.equal(probe.protocol, "Minecraft");
    } finally {
      await new Promise<void>((r) => srv.close(() => r()));
    }
  });

  test("Bedrock RakNet ping via UDP", async () => {
    const fake = await listenUdp((_msg, reply) => reply(bedrockPong(3, 20)));
    try {
      const probe = await probePlayers({
        gameSlug: "minecraft-bedrock", host: "127.0.0.1", port: fake.port, timeoutMs: 800,
      });
      assert.equal(probe.ok, true);
      assert.equal(probe.players, 3);
      assert.equal(probe.maxPlayers, 20);
      assert.equal(probe.protocol, "Bedrock");
    } finally {
      await fake.close();
    }
  });

  test("Quake3 getstatus via UDP", async () => {
    const fake = await listenUdp((_msg, reply) => reply(quake3Status()));
    try {
      const probe = await probePlayers({
        gameSlug: "quake-live", host: "127.0.0.1", port: fake.port, timeoutMs: 800,
      });
      assert.equal(probe.ok, true);
      assert.equal(probe.players, 3);
      assert.equal(probe.maxPlayers, 16);
      assert.equal(probe.map, "ctf_well");
      assert.equal(probe.hostname, "OZ Team Server");
      assert.deepEqual(probe.pings, [12, 8, 3]);
      assert.equal(probe.protocol, "Quake3");
    } finally {
      await fake.close();
    }
  });
});

describe("probePlayers — graceful failure", () => {
  test("an unreachable query port returns ok:false instead of throwing", async () => {
    // Bind then release a UDP port so we know it is free, then probe it.
    const probe = await probePlayers({
      gameSlug: "cs2", host: "127.0.0.1", port: 1, queryPort: 1, timeoutMs: 300, attempts: 1,
    });
    assert.equal(probe.ok, false);
    assert.equal(probe.protocol, "A2S");
  });

  test("games without a query protocol short-circuit", async () => {
    const started = Date.now();
    const probe = await probePlayers({ gameSlug: "valheim", host: "127.0.0.1", port: 2456 });
    assert.equal(probe.ok, false);
    assert.equal(probe.protocol, "none");
    assert.ok(Date.now() - started < 200, "should not wait on a dead port");
  });

  test("uses the game port when the slug has no separate query port", async () => {
    const fake = await listenUdp((msg, reply) => {
      if (msg[4] === 0x54) reply(a2sInfoModern({ players: 0, maxPlayers: 8 }));
      else reply(a2sPlayerList(["Solo"]));
    });
    try {
      const probe = await probePlayers({
        gameSlug: "xonotic", host: "127.0.0.1", port: fake.port, timeoutMs: 800,
      });
      assert.equal(probe.ok, true);
      assert.equal(probe.players, 1);
    } finally {
      await fake.close();
    }
  });
});
