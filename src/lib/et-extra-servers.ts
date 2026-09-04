/**
 * ET servers outside the panel for `!etallofoz`.
 *
 * The WolfET bot only knew its own fleet. This module lets the command also
 * check servers that are NOT installed in the panel, from two sources:
 *
 *   1. A configured list — `GSM_ET_EXTRA_SERVERS` / the Discord settings
 *      field, one `host:port[:queryPort]` per line ('#' comments allowed).
 *   2. Master-server discovery — a Quake3-style `getservers` query against
 *      community ET masters (`GSM_ET_MASTER_URLS` / settings field), whose
 *      replies are parsed and capped. Tolerant parser: old-style binary
 *      6-byte records (the format id's etmaster uses) and the classic ASCII
 *      `ip:port,ip:port` CSV variant are both understood.
 *
 * Parsing is pure (tests drive it directly); the UDP socket lives behind an
 * injectable `queryMaster` so no test touches the network.
 */

import { createSocket } from "node:dgram";

export interface ExtraEtServer {
  host: string;
  port: number;
  /** Where getstatus is answered; the game port unless overridden. */
  queryPort: number;
  /** True when found via a master server rather than the configured list. */
  discovered: boolean;
}

export interface MasterAddr {
  host: string;
  port: number;
}

const MASTER_DEFAULT_PORT = 27950;

/**
 * The classic community master list, in the order the games' sv_master*
 * lines use. note master3 also advertises on 27900; the default port for a
 * bare host is 27950. Dead masters simply don't answer and are skipped.
 */
export const DEFAULT_MASTER_URLS = [
  "etmaster.idsoftware.com",
  "master0.etmaster.net",
  "master3.idsoftware.com",
  "wolfmaster.idsoftware.com",
  "master3.idsoftware.com:27900",
  "master.etlegacy.com",
].join(", ");
/** Discovery is a bonus, not a flood: never probe more than this many. */
export const MAX_DISCOVERED_SERVERS = 25;
const MASTER_TIMEOUT_MS = 1500;

export function extraKey(host: string, port: number): string {
  return `${host.toLowerCase()}:${port}`;
}

// ── Configured list ──────────────────────────────────────────────────────────

export interface ParseListResult {
  servers: ExtraEtServer[];
  errors: string[];
}

/**
 * Parse the configured extra-servers text. One entry per line:
 *   `host:port`            — getstatus on the game port
 *   `host:port:queryPort`  — getstatus on a separate query port
 * Blank lines and `#` comments are ignored; malformed lines are reported in
 * `errors` (and skipped) rather than silently dropped.
 */
export function parseExtraServerList(text: string): ParseListResult {
  const servers: ExtraEtServer[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const entry = parseExtraServerEntry(line);
    if (!entry) {
      errors.push(`unrecognised extra server line: ${line} (expected host:port or host:port:queryPort)`);
      continue;
    }
    const key = extraKey(entry.host, entry.port);
    if (seen.has(key)) continue;
    seen.add(key);
    servers.push({ ...entry, discovered: false });
  }
  return { servers, errors };
}

export function parseExtraServerEntry(line: string): { host: string; port: number; queryPort: number } | null {
  const parts = line.split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  const host = parts[0]?.trim().toLowerCase() ?? "";
  if (!host || !/^[a-z0-9.-]+$/.test(host)) return null;
  const port = Number(parts[1]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  let queryPort = port;
  if (parts.length === 3) {
    queryPort = Number(parts[2]);
    if (!Number.isInteger(queryPort) || queryPort < 1 || queryPort > 65535) return null;
  }
  return { host, port, queryPort };
}

/** Parse the master list field: `host[:port]` entries, comma/space/newline separated. */
export function parseMasterUrlList(text: string): { masters: MasterAddr[]; errors: string[] } {
  const masters: MasterAddr[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/[\s,]+/)) {
    const tok = raw.trim();
    if (!tok || tok.startsWith("#")) continue;
    // A bare host means the default master port; host:port is also accepted.
    const entry = tok.includes(":")
      ? parseExtraServerEntry(tok)
      : /^[a-z0-9.-]+$/i.test(tok)
        ? { host: tok.toLowerCase(), port: MASTER_DEFAULT_PORT, queryPort: MASTER_DEFAULT_PORT }
        : null;
    if (!entry) {
      errors.push(`unrecognised master server: ${tok} (expected host or host:port)`);
      continue;
    }
    const key = extraKey(entry.host, entry.port);
    if (seen.has(key)) continue;
    seen.add(key);
    masters.push({ host: entry.host, port: entry.port });
  }
  return { masters, errors };
}

// ── Master-server response parsing ───────────────────────────────────────────

export interface MasterChunkResult {
  servers: Array<{ host: string; port: number }>;
  /** True once the EOT terminator has been seen — stop collecting. */
  done: boolean;
}

const MARKER = "getserversResponse";

/**
 * Parse one UDP chunk of a master reply. Two wire formats are accepted:
 *
 *  - the classic Q3 ASCII CSV: `\getserversResponse\ip:port,ip:port,...\EOT`
 *  - the ET/binary variant id's etmaster uses: `\getserversResponse\` followed
 *    by repeated 6-byte records (IPv4 + big-endian port), ended by `\EOT`.
 *
 * Either way, a chunk without the marker is still searched for records (the
 * list can span packets), and `done` flips as soon as EOT is seen.
 */
export function parseMasterChunk(chunk: Buffer): MasterChunkResult {
  const text = chunk.toString("latin1");
  const markerAt = text.toLowerCase().indexOf(MARKER.toLowerCase());
  const suffix = markerAt >= 0 ? text.slice(markerAt + MARKER.length) : text;

  const servers: Array<{ host: string; port: number }> = [];
  if (suffix) {
    const ascii = parseAsciiList(suffix);
    if (ascii) {
      servers.push(...ascii);
    } else {
      servers.push(...parseBinaryRecords(chunk, markerAt));
    }
  }
  const done = /\\EOT|EOT/i.test(suffix);
  return { servers, done };
}

/** ASCII variant: `ip:port,ip:port,...` (leading/trailing junk tolerated). */
function parseAsciiList(suffix: string): Array<{ host: string; port: number }> | null {
  const match = /((?:\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d{1,5})(?:,\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d{1,5})*)/.exec(suffix);
  if (!match) return null;
  const out: Array<{ host: string; port: number }> = [];
  for (const pair of match[1].split(",")) {
    const [host, portStr] = pair.split(":");
    const port = Number(portStr);
    if (host && Number.isInteger(port) && port >= 1 && port <= 65535) {
      out.push({ host, port });
    }
  }
  return out.length > 0 ? out : null;
}

/**
 * Binary variant: 6-byte records after the marker (IPv4 + BE port).
 *
 * Guards: the single backslash between the marker and the records is skipped,
 * record octets/ports must be plausible (a stream of printable ASCII is not
 * a record list — this keeps stray text from becoming pretend servers).
 */
function parseBinaryRecords(chunk: Buffer, markerAt: number): Array<{ host: string; port: number }> {
  const out: Array<{ host: string; port: number }> = [];
  let i = markerAt >= 0 ? markerAt + MARKER.length : 0;
  if (i < chunk.length && chunk[i] === 0x5c) i += 1;

  const rest = chunk.length - i;
  if (rest > 0) {
    let printable = 0;
    for (const b of chunk.subarray(i)) {
      if (b >= 32 && b <= 126) printable += 1;
    }
    if (printable / rest > 0.6) return [];
  }

  while (i + 6 <= chunk.length) {
    const a = chunk[i], b = chunk[i + 1], c = chunk[i + 2], d = chunk[i + 3];
    const port = (chunk[i + 4] << 8) | chunk[i + 5];
    if (a >= 1 && a <= 223 && b <= 254 && c <= 254 && d <= 254 && port >= 1024 && port <= 65535) {
      out.push({ host: `${a}.${b}.${c}.${d}`, port });
    }
    i += 6;
  }
  return out;
}

// ── UDP query (thin; injectable for tests) ───────────────────────────────────

export interface MasterQueryFn {
  (master: MasterAddr): Promise<Array<{ host: string; port: number }>>;
}

/**
 * Query a master server for its server list. Sends `\getservers 69\` (ET's
 * protocol) and collects UDP chunks until EOT arrives or the timeout passes.
 * Never throws — an unreachable master is an empty list.
 */
export async function queryMasterServer(
  master: MasterAddr,
  opts: { timeoutMs?: number; maxServers?: number } = {}
): Promise<Array<{ host: string; port: number }>> {
  const timeoutMs = opts.timeoutMs ?? MASTER_TIMEOUT_MS;
  const maxServers = opts.maxServers ?? MAX_DISCOVERED_SERVERS;
  const payload = Buffer.from("\\getservers 69\\", "latin1");

  return new Promise((resolve) => {
    const socket = createSocket("udp4");
    const out = new Map<string, { host: string; port: number }>();
    let timer: NodeJS.Timeout | undefined;
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try { socket.close(); } catch { /* already closed */ }
      resolve(Array.from(out.values()));
    };

    socket.on("message", (chunk) => {
      const parsed = parseMasterChunk(chunk);
      for (const s of parsed.servers) {
        const key = extraKey(s.host, s.port);
        if (!out.has(key)) out.set(key, s);
      }
      if (parsed.done || out.size >= maxServers) finish();
    });
    socket.on("error", finish);

    timer = setTimeout(finish, timeoutMs);
    socket.send(payload, master.port, master.host, (err) => {
      if (err) finish();
    });
  });
}

// ── Orchestration ────────────────────────────────────────────────────────────

export interface LoadExternalInput {
  /** Configured-list text (`GSM_ET_EXTRA_SERVERS` / settings field). */
  configText: string;
  /** Master list text (`GSM_ET_MASTER_URLS` / settings field). */
  mastersText: string;
  /** Panel ET servers, so duplicates are never probed twice. */
  panelServers: Array<{ host: string; port: number }>;
  /** Master query implementation; defaults to the real UDP socket. */
  queryMaster?: MasterQueryFn;
  /** Cap on discovered servers (default MAX_DISCOVERED_SERVERS). */
  maxDiscovered?: number;
}

export interface LoadExternalResult {
  servers: ExtraEtServer[];
  errors: string[];
  /** The master that answered, when discovery succeeded. */
  usedMaster?: string;
}

/**
 * Build the extra-server list: configured entries first, then (optional)
 * master discovery. Panel servers and duplicates are excluded; discovery is
 * best-effort — a dead master or an invalid config never breaks the command.
 */
export async function loadExternalEtServers(input: LoadExternalInput): Promise<LoadExternalResult> {
  const errors: string[] = [];
  const servers: ExtraEtServer[] = [];
  const excluded = new Set(input.panelServers.map((s) => extraKey(s.host, s.port)));
  const seen = new Set(excluded);

  const config = parseExtraServerList(input.configText);
  errors.push(...config.errors);
  for (const s of config.servers) {
    const key = extraKey(s.host, s.port);
    if (seen.has(key)) continue;
    seen.add(key);
    servers.push(s);
  }

  const { masters, errors: masterErrors } = parseMasterUrlList(input.mastersText);
  errors.push(...masterErrors);
  if (masters.length > 0) {
    const query = input.queryMaster ?? queryMasterServer;
    for (const master of masters) {
      let found: Array<{ host: string; port: number }> = [];
      try {
        found = await query(master);
      } catch {
        found = [];
      }
      if (found.length === 0) continue;
      const cap = Math.max(0, input.maxDiscovered ?? MAX_DISCOVERED_SERVERS);
      for (const m of found.slice(0, cap)) {
        const key = extraKey(m.host, m.port);
        if (seen.has(key)) continue;
        seen.add(key);
        servers.push({ host: m.host, port: m.port, queryPort: m.port, discovered: true });
      }
      if (servers.some((s) => s.discovered)) {
        errors.push(`discovered ${found.slice(0, cap).length} server(s) via ${master.host}:${master.port}`);
        return { servers, errors, usedMaster: `${master.host}:${master.port}` };
      }
      errors.push(`master ${master.host}:${master.port} answered with no usable servers`);
    }
    if (!servers.some((s) => s.discovered)) {
      errors.push("no master server answered");
    }
  }

  return { servers, errors };
}
