/**
 * FTP protocol primitives — pure, zero-dependency, unit-tested.
 *
 * The panel ships its own FTP server (src/lib/ftp-server.ts) so players and
 * admins can push multi-gigabyte files (world archives, mod packs, map
 * rotations) at the game servers without dragging them through a browser
 * upload. Everything here is the text-level half of that protocol: parsing a
 * command line, keeping a client inside its virtual root, and rendering the
 * directory listings that FileZilla, WinSCP, lftp, curl and Transmit expect.
 *
 * It is deliberately free of sockets and of the filesystem so the awkward
 * parts — path containment above all — are testable without opening a port.
 */

/** A single `COMMAND arg` line off the control connection. */
export interface ParsedCommand {
  /** Upper-cased verb, e.g. `STOR`. */
  command: string;
  /** Everything after the first space, trimmed. `""` when absent. */
  arg: string;
}

/**
 * Reject absurd control lines before they are parsed.
 *
 * RFC 959 caps a command line at 512 bytes; real clients (and every SFTP-to-FTP
 * bridge) stick to that, but a hostile one can stream gigabytes of junk down a
 * socket we are responsible for reading. 8 KB is far beyond any legitimate
 * command and still bounded.
 */
export const MAX_COMMAND_LINE = 8 * 1024;

/**
 * Parse one control-channel line.
 *
 * Returns null for a blank or oversized line so the caller answers `500` and
 * keeps reading instead of throwing inside a socket callback.
 */
export function parseFtpCommand(line: string): ParsedCommand | null {
  if (typeof line !== "string") return null;
  if (line.length > MAX_COMMAND_LINE) return null;
  const withoutEol = line.replace(/[\r\n]+$/, "");
  if (withoutEol.trim() === "") return null;
  const spaceIndex = withoutEol.indexOf(" ");
  if (spaceIndex === -1) {
    return { command: withoutEol.trim().toUpperCase(), arg: "" };
  }
  return {
    command: withoutEol.slice(0, spaceIndex).trim().toUpperCase(),
    arg: withoutEol.slice(spaceIndex + 1),
  };
}

/** Longest path a client may address, and how deep it may nest. */
export const MAX_VIRTUAL_PATH = 4096;
export const MAX_PATH_DEPTH = 64;
/** Longest single entry name; the Linux NAME_MAX is 255 bytes. */
export const MAX_ENTRY_NAME = 255;

/**
 * Resolve a client-supplied path against the session's current directory.
 *
 * Returns a canonical absolute *virtual* path (`"/"`, `"/survival-12"`, …) or
 * null when the request tries to climb above the virtual root, is absurdly
 * long, or nests too deep. Backslashes are ordinary characters: the target
 * filesystem is Linux, where `..\..\etc` is just a filename that does not
 * exist, so treating it as a separator would invent a traversal.
 */
export function normalizeVirtualPath(cwd: string, input: string | null | undefined): string | null {
  const raw = typeof input === "string" ? input : "";
  if (raw.includes("\0")) return null;
  if (raw.length > MAX_VIRTUAL_PATH) return null;

  const start = raw.startsWith("/") ? "/" : normalizeVirtualPath2(cwd);
  const parts = start === "/" ? [] : start.slice(1).split("/");
  const segments = raw.split("/");

  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      // Popping an empty stack means the client walked off the root.
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }
    if (parts.length >= MAX_PATH_DEPTH) return null;
    parts.push(segment);
  }

  const joined = `/${parts.join("/")}`;
  if (joined.length > MAX_VIRTUAL_PATH) return null;
  return joined;
}

/** Internal: treat a malformed cwd as the root rather than trusting it. */
function normalizeVirtualPath2(cwd: string): string {
  if (typeof cwd !== "string" || !cwd.startsWith("/")) return "/";
  return cwd;
}

/** The final segment of a virtual path (`"/a/b"` → `"b"`, `"/"` → `""`). */
export function virtualBaseName(virtualPath: string): string {
  if (!virtualPath || virtualPath === "/") return "";
  const parts = virtualPath.split("/");
  return parts[parts.length - 1] ?? "";
}

/** Parent of a virtual path (`"/a/b"` → `"/a"`, `"/a"` → `"/"`). */
export function virtualDirName(virtualPath: string): string {
  if (!virtualPath || virtualPath === "/") return "/";
  const parts = virtualPath.split("/").filter(Boolean);
  parts.pop();
  return parts.length === 0 ? "/" : `/${parts.join("/")}`;
}

/**
 * Validate a name the client wants to *create* (MKD, RNTO, and the file name
 * behind STOR when the panel's own uploader uses it).
 *
 * Only the basename is ever accepted — a name containing `/` is an attempt to
 * smuggle a path, and `.`/`..` are never real entries.
 */
export function sanitizeEntryName(input: string | null | undefined): string | null {
  if (typeof input !== "string") return null;
  const name = input.trim();
  if (name === "" || name === "." || name === "..") return null;
  if (name.includes("/") || name.includes("\0")) return null;
  if (name.length > MAX_ENTRY_NAME) return null;
  return name;
}

/** Strip the option flags real clients put in front of a listing path. */
export function listingPathFromArg(arg: string): string {
  const trimmed = (arg || "").trim();
  if (!trimmed) return "";
  if (!trimmed.startsWith("-")) return trimmed;
  const tokens = trimmed.split(/\s+/);
  const rest = tokens.filter((t) => !t.startsWith("-"));
  return rest[0] ?? "";
}

/** One directory entry as the listing renderers need it. */
export interface FtpListingEntry {
  name: string;
  isDir: boolean;
  size: number;
  /** Modification time in milliseconds since the epoch. */
  mtimeMs: number;
  /** Permission bits straight from `stat` (0 when unknown). */
  mode: number;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `YYYYMMDDHHMMSS` in UTC — the format SIZE/MDTM/MLSD all use. */
export function ftpTimestamp(mtimeMs: number): string {
  const d = new Date(Number.isFinite(mtimeMs) ? mtimeMs : 0);
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
  );
}

/** Render the permission column of a `LIST` line (e.g. `drwxr-xr-x`). */
export function permissionString(entry: FtpListingEntry): string {
  // A zeroed mode means `stat` failed for this entry; showing it readable is
  // friendlier than refusing to list the directory at all.
  const mode = entry.mode || (entry.isDir ? 0o755 : 0o644);
  const bits = ["r", "w", "x"];
  let out = entry.isDir ? "d" : "-";
  for (let shift = 6; shift >= 0; shift -= 3) {
    for (let bit = 2; bit >= 0; bit--) {
      out += (mode >> (shift + bit)) & 1 ? bits[2 - bit] : "-";
    }
  }
  return out;
}

/**
 * Unix-style `LIST` line.
 *
 * The shape is fixed by decades of client parsers: permissions (10), link
 * count, owner, group, size, date, name. Names are emitted verbatim (UTF-8);
 * the FEAT reply advertises UTF8 so clients decode them correctly.
 */
export function formatListLine(entry: FtpListingEntry): string {
  const d = new Date(Number.isFinite(entry.mtimeMs) ? entry.mtimeMs : 0);
  const month = MONTHS[d.getUTCMonth()] ?? "Jan";
  const day = String(d.getUTCDate()).padStart(2, " ");
  const pad2 = (n: number) => String(n).padStart(2, "0");
  // Files older than six months show the year, as `ls -l` does — some clients
  // mis-parse the time column otherwise.
  const recent = Date.now() - entry.mtimeMs < 1000 * 60 * 60 * 24 * 180 && entry.mtimeMs <= Date.now();
  const stamp = recent
    ? `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`
    : String(d.getUTCFullYear());
  const size = entry.isDir ? 4096 : entry.size;
  return `${permissionString(entry)} 1 0 0 ${String(size).padStart(10)} ${month} ${day} ${stamp} ${entry.name}`;
}

/** One `MLSD` fact set. Only the facts advertised in FEAT are emitted. */
export function formatMlsdLine(entry: FtpListingEntry): string {
  const type = entry.isDir ? "dir" : "file";
  const perm = entry.isDir ? "elcmp" : "adfrw";
  const size = entry.isDir ? "" : `;size=${entry.size}`;
  return `type=${type}${size};modify=${ftpTimestamp(entry.mtimeMs)};perm=${perm}; ${entry.name}`;
}

/** The `MLST` reply body (a single 250 line describing one path). */
export function formatMlstLine(virtualPath: string, entry: FtpListingEntry): string {
  const type = entry.isDir ? "dir" : "file";
  const perm = entry.isDir ? "elcmp" : "adfrw";
  const size = entry.isDir ? "" : `;size=${entry.size}`;
  return ` type=${type}${size};modify=${ftpTimestamp(entry.mtimeMs)};perm=${perm}; ${virtualPath}`;
}

/** `227 Entering Passive Mode (h1,h2,h3,h4,p1,p2).` */
export function formatPasvReply(host: string, port: number): string {
  const octets = host.split(".").map((part) => Number.parseInt(part, 10));
  if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    // A hostname (or IPv6 literal) cannot be expressed in a PASV reply at all;
    // the caller falls back to EPSV or a configured masquerade address.
    return "";
  }
  const p1 = Math.floor(port / 256);
  const p2 = port % 256;
  return `227 Entering Passive Mode (${octets.join(",")},${p1},${p2}).`;
}

/** `229 Entering Extended Passive Mode (|||port|)` */
export function formatEpsvReply(port: number): string {
  return `229 Entering Extended Passive Mode (|||${port}|)`;
}

/**
 * Features advertised by FEAT.
 *
 * MLSD/MLST is the important one: without it clients fall back to parsing the
 * `LIST` text, and `TVFS` tells them the server already presents one unified
 * tree (which is exactly what the virtual root is).
 */
export const FTP_FEATURES = [
  "UTF8",
  "MLST type*;size*;modify*;perm*;",
  "MLSD",
  "SIZE",
  "MDTM",
  "REST STREAM",
  "TVFS",
  "EPSV",
  "EPRT",
  "PASV",
  "AUTH TLS",
  "PBSZ",
  "PROT",
] as const;

/** Multi-line 211 reply for FEAT. */
export function formatFeatReply(features: readonly string[] = FTP_FEATURES): string {
  return ["211-Features:", ...features.map((f) => ` ${f}`), "211 End"].join("\r\n");
}

/**
 * Does an active-mode target match the client that asked for it?
 *
 * `PORT`/`EPRT` tell the server to open a TCP connection to an arbitrary
 * address — the classic FTP bounce attack, where the server is tricked into
 * port-scanning or attacking a third party from the inside. Only ever dial the
 * address the control connection already came from.
 */
export function activeTargetAllowed(peerAddress: string, targetAddress: string): boolean {
  const peer = normalizeAddress(peerAddress);
  const target = normalizeAddress(targetAddress);
  if (!peer || !target) return false;
  if (peer === target) return true;
  // IPv4-mapped IPv6 (`::ffff:1.2.3.4`) vs plain IPv4 is the same host.
  return stripV4Mapped(peer) === stripV4Mapped(target);
}

function normalizeAddress(value: string): string {
  return (value || "").trim().toLowerCase().replace(/^\[|\]$/g, "");
}

function stripV4Mapped(value: string): string {
  return value.startsWith("::ffff:") ? value.slice("::ffff:".length) : value;
}

/** Parse the six comma-separated numbers of a PORT argument. */
export function parsePortArg(arg: string): { host: string; port: number } | null {
  const parts = (arg || "").split(",").map((p) => p.trim());
  if (parts.length !== 6) return null;
  const nums = parts.map((p) => Number.parseInt(p, 10));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return {
    host: nums.slice(0, 4).join("."),
    port: nums[4] * 256 + nums[5],
  };
}

/** Parse an EPRT argument: `|1|1.2.3.4|1234|` (delimiter is chosen by the client). */
export function parseEprtArg(arg: string): { host: string; port: number } | null {
  const raw = (arg || "").trim();
  if (raw.length < 5) return null;
  const delimiter = raw[0];
  const parts = raw.split(delimiter);
  // Leading empty string before the first delimiter, empty string after the last.
  if (parts.length < 5) return null;
  const [, family, host, portRaw] = parts;
  if (family !== "1" && family !== "2") return null;
  const port = Number.parseInt(portRaw, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  if (!host || host.includes(" ") || host.length > 64) return null;
  return { host, port };
}

/**
 * Pick a passive port from the configured range, skipping the ones already in
 * use. Deterministic (a rotating cursor) so an operator reading logs can see
 * that the range really is being cycled.
 */
export function nextPassivePort(
  cursor: number,
  range: { min: number; max: number },
  isFree: (port: number) => boolean
): { port: number; cursor: number } | null {
  const size = range.max - range.min + 1;
  if (size <= 0) return null;
  for (let i = 0; i < size; i++) {
    const port = range.min + ((cursor + i) % size);
    if (isFree(port)) return { port, cursor: (port - range.min + 1) % size };
  }
  return null;
}

/** Human-readable byte count for the panel UI and logs. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes < 1024 ** 4) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  return `${(bytes / 1024 ** 4).toFixed(2)} TB`;
}
