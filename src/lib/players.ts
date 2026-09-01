/**
 * Live player counts for game servers.
 *
 * The panel knows process state from /proc, but never how many players are
 * actually connected — game servers do not expose that on disk. Each engine
 * family speaks its own tiny query protocol, as a short-lived socket:
 *
 *   a2s        Steam Server Query (CS2, TF2, Garry's Mod, L4D2, Rust, ARK,
 *              Palworld, Satisfactory, Squad, V Rising, Enshrouded,
 *              Insurgency: Sandstorm, 7 Days to Die, Xonotic)
 *   minecraft  Minecraft Java / Paper server list ping (TCP)
 *   bedrock    Minecraft Bedrock RakNet unconnected ping (UDP)
 *   quake3     Quake/ioquake3 "getstatus" (Quake Live, Wolfenstein: ET)
 *
 * Every probe is best-effort by contract: it never throws, is bounded by a
 * short timeout and returns { ok: false } on any failure, so a dead server or
 * a firewalled query port can never break a panel request that happens to
 * attach a player count to a Discord notification.
 */

import { createConnection } from "node:net";
import { createSocket } from "node:dgram";

export type ProbeKind = "a2s" | "minecraft" | "bedrock" | "quake3" | "none";
export type ProbeProtocol = "A2S" | "Minecraft" | "Bedrock" | "Quake3" | "none";

export interface ProbeSpec {
  kind: ProbeKind;
  /** Which port the query protocol listens on. */
  port: "query" | "game";
}

export interface ProbeInput {
  gameSlug: string;
  host: string;
  /** The game port. */
  port: number;
  /** The query port, when the game separates it (defaults to port + 1). */
  queryPort?: number | null;
  timeoutMs?: number;
  /** 1-3 passes; the second pass catches games still binding their socket. */
  attempts?: number;
}

export interface PlayerProbe {
  ok: boolean;
  players?: number;
  maxPlayers?: number;
  /** Current map, when the protocol reports one (A2S, Quake 3). */
  map?: string;
  /** Names of connected players (A2S split protocol, Quake 3). */
  names?: string[];
  /** Pings in ms, parallel to `names` (Quake 3 reports them; A2S does not). */
  pings?: number[];
  /** Server hostname when reported (Quake 3's sv_hostname). */
  hostname?: string;
  protocol?: ProbeProtocol;
  error?: string;
}

/**
 * The original bot's bot detector: a bracketed/coloured BOT tag in the name,
 * or a ping of zero (bots answer with no latency). Case-insensitive like the
 * community bot, and applied wherever a Quake 3 roster is parsed.
 */
export function isLikelyBot(name: string, ping: number): boolean {
  if (ping === 0) return true;
  // The original bot matched its indicator list case-sensitively, so "Bot"
  // inside an ordinary name does not disqualify a player.
  const indicators = ["^o[BOT]^7", "[BOT]", "^0[BOT]", "BOT", "(BOT)", "<BOT>"];
  return indicators.some((i) => name.includes(i));
}

/**
 * Query protocol per built-in game, keyed by template slug.
 *
 * Games without a public query protocol (Valheim, Project Zomboid, Factorio,
 * DST, Terraria, OpenRA, Arma 3, Assetto Corsa) are listed as "none" — and so
 * is any unknown or custom slug, rather than guessing and paying a timeout.
 */
const SPECS: Record<string, ProbeSpec> = {
  // Source / Source 2 with a query port (game port + 1 by convention)
  "cs2": { kind: "a2s", port: "query" },
  "tf2": { kind: "a2s", port: "query" },
  "gmod": { kind: "a2s", port: "query" },
  "l4d2": { kind: "a2s", port: "query" },
  // Games with an explicit QUERY_PORT variable
  "rust": { kind: "a2s", port: "query" },
  "ark": { kind: "a2s", port: "query" },
  "palworld": { kind: "a2s", port: "query" },
  "satisfactory": { kind: "a2s", port: "query" },
  "squad": { kind: "a2s", port: "query" },
  "vrising": { kind: "a2s", port: "query" },
  "enshrouded": { kind: "a2s", port: "query" },
  "insurgency-sandstorm": { kind: "a2s", port: "query" },
  // A2S on the game port itself
  "7dtd": { kind: "a2s", port: "game" },
  "xonotic": { kind: "a2s", port: "game" },
  // Quake 3 protocol "getstatus"
  "quake-live": { kind: "quake3", port: "game" },
  "wolfenstein-et": { kind: "quake3", port: "game" },
  // Minecraft family
  "minecraft-java": { kind: "minecraft", port: "game" },
  "minecraft-paper": { kind: "minecraft", port: "game" },
  "minecraft-bedrock": { kind: "bedrock", port: "game" },
};

/** The query spec a game uses. Unknown or custom games report "none". */
export function probeSpecFor(slug: string): ProbeSpec {
  return SPECS[slug] ?? { kind: "none", port: "game" };
}

/**
 * Resolve the configured slot count from a server's stored variables/config.
 *
 * Mirrors the install path's precedence: the operator's wizard entry wins over
 * the template's default config value. Returns undefined when neither is a
 * sane number, so callers can fall back to the probe's own figure.
 */
export function maxPlayersFrom(variables: unknown, config: unknown): number | undefined {
  for (const source of [variables, config]) {
    if (!source || typeof source !== "object") continue;
    const raw = (source as Record<string, unknown>).MAX_PLAYERS;
    const n = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10);
    if (Number.isInteger(n) && n > 0 && n <= 1024) return n;
  }
  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Packet parsing — pure functions, exported so tests can drive them directly
// ─────────────────────────────────────────────────────────────────────────────

export interface A2sInfo {
  name: string;
  /** Current map filename, when the encoding carries one. */
  map: string | null;
  protocol: number;
  players: number;
  maxPlayers: number;
}

function readCString(buf: Uint8Array, start: number): { value: string; next: number } | null {
  let end = start;
  while (end < buf.length && buf[end] !== 0) end++;
  if (end >= buf.length) return null;
  return { value: Buffer.from(buf.subarray(start, end)).toString("utf8"), next: end + 1 };
}

function hasA2sMagic(buf: Uint8Array): boolean {
  return buf.length >= 5 && buf[0] === 0xff && buf[1] === 0xff && buf[2] === 0xff && buf[3] === 0xff;
}

/** Parse an A2S_INFO reply (modern 0x49 or legacy 0x6D encoding). */
export function parseA2sInfo(buf: Uint8Array): A2sInfo | null {
  if (!hasA2sMagic(buf)) return null;
  const type = buf[4];
  try {
    if (type === 0x49) {
      // FF FF FF FF 49 <protocol> <name\0> <map\0> <folder\0> <game\0> <appid u16> <players u8> <max u8> ...
      let off = 5;
      const protocol = buf[off++];
      const name = readCString(buf, off);
      if (!name) return null;
      off = name.next;
      const map = readCString(buf, off);
      if (!map) return null;
      off = map.next;
      for (const _ of [0, 1]) {
        const s = readCString(buf, off);
        if (!s) return null;
        off = s.next;
      }
      off += 2; // app id
      const players = buf[off++];
      const maxPlayers = buf[off++];
      return { name: name.value, map: map.value || null, protocol, players, maxPlayers };
    }
    if (type === 0x6d) {
      // FF FF FF FF 6D <address\0> <name\0> <map\0> <folder\0> <game\0> <players u8> <max u8> <protocol u8> ...
      let off = 5;
      const address = readCString(buf, off);
      if (!address) return null;
      off = address.next;
      const name = readCString(buf, off);
      if (!name) return null;
      off = name.next;
      const map = readCString(buf, off);
      if (!map) return null;
      off = map.next;
      for (const _ of [0, 1]) {
        const s = readCString(buf, off);
        if (!s) return null;
        off = s.next;
      }
      const players = buf[off++];
      const maxPlayers = buf[off++];
      return { name: name.value, map: map.value || null, protocol: buf[off] ?? 0, players, maxPlayers };
    }
  } catch {
    return null;
  }
  return null;
}

/** Parse the challenge issued in reply to an A2S_PLAYER (0x55) request. */
export function parseA2sChallenge(buf: Uint8Array): number | null {
  if (!hasA2sMagic(buf) || buf[4] !== 0x41 || buf.length < 9) return null;
  return buf[5] | (buf[6] << 8) | (buf[7] << 16) | (buf[8] << 24);
}

export interface A2sPlayerList {
  players: number;
  names: string[];
}

/** Parse an A2S_PLAYER (0x44) reply — the only reliable count under the
 *  split protocol, where A2S_INFO reports a placeholder zero. */
export function parseA2sPlayers(buf: Uint8Array): A2sPlayerList | null {
  if (!hasA2sMagic(buf) || buf[4] !== 0x44 || buf.length < 6) return null;
  const count = buf[5];
  const names: string[] = [];
  let off = 6;
  for (let i = 0; i < count; i++) {
    off += 1; // index
    const name = readCString(buf, off);
    if (!name) return null;
    names.push(name.value);
    off = name.next + 8; // score (i32) + duration (f32)
  }
  return { players: count, names };
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

function readVarInt(buf: Uint8Array, start: number): { value: number; next: number } | null {
  let value = 0;
  let shift = 0;
  let off = start;
  for (let i = 0; i < 5; i++) {
    if (off >= buf.length) return null;
    const b = buf[off++];
    value |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) return { value: value >>> 0, next: off };
    shift += 7;
  }
  return null;
}

/** Pull the JSON status document out of a Minecraft server-list ping frame. */
export function parseMinecraftStatusFrame(buf: Uint8Array): string | null {
  const len = readVarInt(buf, 0);
  if (!len || 1 + len.value > buf.length) return null;
  let off = len.next;
  if (buf[off] !== 0x00) return null; // response packet id
  off += 1;
  const strLen = readVarInt(buf, off);
  if (!strLen) return null;
  off = strLen.next;
  if (off + strLen.value > buf.length) return null;
  return Buffer.from(buf.subarray(off, off + strLen.value)).toString("utf8");
}

/** Interpret a Minecraft ping JSON body. */
export function parseMinecraftStatus(text: string): { players?: number; maxPlayers?: number } | null {
  try {
    const data = JSON.parse(text) as {
      players?: { online?: unknown; max?: unknown };
    };
    const online = typeof data.players?.online === "number" ? data.players.online : undefined;
    const max = typeof data.players?.max === "number" ? data.players.max : undefined;
    if (online === undefined && max === undefined) return null;
    return { players: online, maxPlayers: max };
  } catch {
    return null;
  }
}

const RAKNET_MAGIC = Buffer.from([
  0x00, 0xff, 0xff, 0x00, 0xfe, 0xfe, 0xfe, 0xfe,
  0xfd, 0xfd, 0xfd, 0xfd, 0x12, 0x34, 0x56, 0x78,
]);

/** Parse a RakNet unconnected pong (Bedrock server list ping). */
export function parseBedrockPing(buf: Uint8Array): { players?: number; maxPlayers?: number } | null {
  // 0x1C | ping time (8) | GUID (8) | magic (16) | string len u16 BE | string
  if (buf.length < 35 || buf[0] !== 0x1c) return null;
  const strLen = (buf[33] << 8) | buf[34];
  if (35 + strLen > buf.length) return null;
  const motd = Buffer.from(buf.subarray(35, 35 + strLen)).toString("utf8");
  const parts = motd.split(";");
  // MCPE;<name>;<protocol>;<version>;<players>;<max>;<serverId>;...
  const players = parts.length > 4 ? Number.parseInt(parts[4], 10) : NaN;
  const max = parts.length > 5 ? Number.parseInt(parts[5], 10) : NaN;
  return {
    players: Number.isInteger(players) && players >= 0 ? players : undefined,
    maxPlayers: Number.isInteger(max) && max > 0 ? max : undefined,
  };
}

/** Parse a Quake 3 "statusResponse" datagram. */
export function parseQuake3Status(buf: Uint8Array): {
  players?: number;
  maxPlayers?: number;
  map?: string;
  names?: string[];
  pings?: number[];
  hostname?: string;
} | null {
  const text = Buffer.from(buf).toString("latin1");
  const lines = text.split("\n");
  const info = lines.find((l) => l.startsWith("\\"));
  if (!info) return null;

  const names: string[] = [];
  const pings: number[] = [];
  for (const line of lines) {
    // ET/ioq3 roster: "<score> <ping> <'name with optional spaces'>"
    const match = line.match(/^\s*(\d+)\s+(-?\d+)\s+(.+)$/);
    if (!match) continue;
    const ping = Number.parseInt(match[2], 10);
    const rawName = match[3].replace(/^"+|"+$/g, "").trim();
    if (!rawName) continue;
    // The original bot reports only real players; bots are filtered here.
    if (isLikelyBot(rawName, ping)) continue;
    names.push(rawName);
    pings.push(ping);
  }

  const maxMatch = info.match(/\\sv_maxclients\\(\d+)/);
  const maxPlayers = maxMatch ? Number.parseInt(maxMatch[1], 10) : undefined;
  const mapMatch = info.match(/\\mapname\\([^\\\n]+)/);

  let hostname: string | undefined;
  const hostMatch = info.match(/\\sv_hostname\\([^\\\n]+)/);
  if (hostMatch) hostname = hostMatch[1].replace(/\^[0-9a-zA-Z]/g, "");

  return {
    players: names.length,
    maxPlayers,
    map: mapMatch ? mapMatch[1] : undefined,
    names,
    pings,
    hostname,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Transport — short-lived sockets, always resolve, never throw
// ─────────────────────────────────────────────────────────────────────────────

function usableHost(host: string | null | undefined): string {
  const h = (host ?? "").trim();
  // The create flow default "0.0.0.0" means "all interfaces on this host",
  // which is where process control runs anyway — dial loopback instead.
  if (!h || h === "0.0.0.0" || h === "::" || h === "::0" || h === "0:0:0:0:0:0:0:0") {
    return "127.0.0.1";
  }
  return h;
}

function udpExchange(payload: Buffer, host: string, port: number, timeoutMs: number): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const sock = createSocket("udp4");
    let done = false;
    const finish = (data: Buffer | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { sock.close(); } catch { /* already closed */ }
      resolve(data);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    sock.once("error", () => finish(null));
    sock.once("message", (msg) => finish(msg));
    sock.send(payload, port, host, (err) => {
      if (err) finish(null);
    });
  });
}

function tcpExchange(payload: Buffer, host: string, port: number, timeoutMs: number, wants: (buf: Buffer) => boolean): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    let buf = Buffer.alloc(0);
    let done = false;
    const finish = (data: Buffer | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(data);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    socket.once("error", () => finish(null));
    socket.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (wants(buf)) finish(buf);
    });
    socket.once("connect", () => socket.write(payload));
  });
}

const A2S_INFO_PACKET = Buffer.concat([
  Buffer.from([0xff, 0xff, 0xff, 0xff, 0x54]),
  Buffer.from("Source Engine Query\0", "utf8"),
]);
const A2S_CHALLENGE_PACKET = Buffer.from([0xff, 0xff, 0xff, 0xff, 0x55, 0xff, 0xff, 0xff, 0xff]);
const QUAKE3_STATUS_PACKET = Buffer.concat([Buffer.from([0xff, 0xff, 0xff, 0xff]), Buffer.from("getstatus\n", "latin1")]);

const BEDROCK_PING_PACKET = (() => {
  const time = Buffer.alloc(8);
  time.writeBigUInt64LE(BigInt(Date.now()));
  return Buffer.concat([Buffer.from([0x01]), time, RAKNET_MAGIC]);
})();

async function runProbe(
  kind: ProbeKind,
  host: string,
  port: number,
  timeoutMs: number
): Promise<{ players?: number; maxPlayers?: number; map?: string; names?: string[]; pings?: number[]; hostname?: string; error?: string }> {
  switch (kind) {
    case "a2s": {
      const infoBuf = await udpExchange(A2S_INFO_PACKET, host, port, timeoutMs);
      if (!infoBuf) return { error: "no response" };
      const info = parseA2sInfo(infoBuf);
      if (!info) return { error: "unrecognised response" };
      const base = { map: info.map ?? undefined, maxPlayers: info.maxPlayers };
      // The legacy encoding carries the real count; under the split protocol
      // the player slot is a placeholder zero and only A2S_PLAYER knows more.
      if (info.players > 0) return { ...base, players: info.players };
      const challengeBuf = await udpExchange(A2S_CHALLENGE_PACKET, host, port, timeoutMs);
      // Some servers skip the challenge dance and answer directly.
      const listDirect = challengeBuf ? parseA2sPlayers(challengeBuf) : null;
      if (listDirect) return { ...base, players: listDirect.players, names: listDirect.names };
      const challenge = challengeBuf ? parseA2sChallenge(challengeBuf) : null;
      if (challenge === null || challenge < 0) return base;
      const chal = Buffer.alloc(4);
      chal.writeInt32LE(challenge, 0);
      const playersBuf = await udpExchange(
        Buffer.concat([Buffer.from([0xff, 0xff, 0xff, 0xff, 0x55]), chal]),
        host, port, timeoutMs
      );
      const list = playersBuf ? parseA2sPlayers(playersBuf) : null;
      return list ? { ...base, players: list.players, names: list.names } : base;
    }
    case "minecraft": {
      const hostStr = Buffer.from(host, "utf8");
      const handshake = Buffer.concat([
        writeVarInt(-1),            // protocol -1: "just ping, don't log in"
        writeVarInt(0x00),          // packet id: handshake
        writeVarInt(hostStr.length), hostStr,
        Buffer.from([(port >> 8) & 0xff, port & 0xff]),
        writeVarInt(0x01),          // next state: status
      ]);
      const frame = Buffer.concat([writeVarInt(handshake.length), handshake]);
      const request = Buffer.concat([writeVarInt(1), Buffer.from([0x01])]);
      const reply = await tcpExchange(
        Buffer.concat([frame, request]), host, port, timeoutMs,
        (b) => parseMinecraftStatusFrame(b) !== null
      );
      if (!reply) return { error: "no response" };
      const json = parseMinecraftStatusFrame(reply);
      const parsed = json ? parseMinecraftStatus(json) : null;
      return parsed ? { players: parsed.players, maxPlayers: parsed.maxPlayers } : { error: "unrecognised response" };
    }
    case "bedrock": {
      const reply = await udpExchange(BEDROCK_PING_PACKET, host, port, timeoutMs);
      if (!reply) return { error: "no response" };
      const parsed = parseBedrockPing(reply);
      return parsed ? { players: parsed.players, maxPlayers: parsed.maxPlayers } : { error: "unrecognised response" };
    }
    case "quake3": {
      const reply = await udpExchange(QUAKE3_STATUS_PACKET, host, port, timeoutMs);
      if (!reply) return { error: "no response" };
      const parsed = parseQuake3Status(reply);
      return parsed
        ? {
            players: parsed.players,
            maxPlayers: parsed.maxPlayers,
            map: parsed.map,
            names: parsed.names,
            pings: parsed.pings,
            hostname: parsed.hostname,
          }
        : { error: "unrecognised response" };
    }
    default:
      return { error: "no query protocol for this game" };
  }
}

const PROTOCOL_LABEL: Record<ProbeKind, ProbeProtocol> = {
  a2s: "A2S",
  minecraft: "Minecraft",
  bedrock: "Bedrock",
  quake3: "Quake3",
  none: "none",
};

/**
 * Best-effort player count for a running server.
 *
 * Resolves the query spec from the game slug, picks the right port (the
 * separate query port when the game has one, else the game port), and dials
 * through `attempts` passes. Never throws.
 */
export async function probePlayers(input: ProbeInput): Promise<PlayerProbe> {
  const spec = probeSpecFor(input.gameSlug);
  const host = usableHost(input.host);
  const port = spec.port === "query" ? (input.queryPort ?? input.port + 1) : input.port;
  const timeoutMs = input.timeoutMs ?? 1200;
  const attempts = Math.max(1, Math.min(input.attempts ?? 1, 3));

  if (spec.kind === "none") {
    return { ok: false, protocol: "none", error: "no query protocol for this game" };
  }

  let lastError = "no response";
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 350));
    const out = await runProbe(spec.kind, host, port, timeoutMs);
    if (out.players !== undefined || out.maxPlayers !== undefined || out.map !== undefined) {
      return {
        ok: true,
        players: out.players,
        maxPlayers: out.maxPlayers,
        map: out.map,
        names: out.names,
        pings: out.pings,
        hostname: out.hostname,
        protocol: PROTOCOL_LABEL[spec.kind],
      };
    }
    lastError = out.error ?? lastError;
  }
  return { ok: false, protocol: PROTOCOL_LABEL[spec.kind], error: lastError };
}
