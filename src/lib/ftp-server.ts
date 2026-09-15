/**
 * A small, dependency-free FTP/FTPS server for the panel.
 *
 * Why this exists: the browser upload path has to carry the whole file through
 * an HTTP request, and the panel's own file manager is a poor fit for the
 * things game servers actually need — a 4 GB world archive, a 20 GB mod pack,
 * a nightly map rotation. Operators expect an FTP account next to their server,
 * and every client they already own (FileZilla, WinSCP, lftp, Transmit,
 * `curl -T`, scripts with `ftplib`) speaks it.
 *
 * Design notes:
 *
 *   - **Uploads stream straight to disk.** A data connection is piped into a
 *     write stream; nothing is buffered in memory and there is no size cap
 *     beyond an optional operator limit and free disk space.
 *   - **Uploads are atomic.** A plain upload lands in a `.gsm-upload-*.part`
 *     file in the destination directory and is renamed into place only when the
 *     transfer ends successfully — a reset connection, a full disk or a failed
 *     write removes the part file instead of leaving something truncated where
 *     a game server will happily load it. (`APPE` and `REST`/resume write in
 *     place by definition, so they are the exceptions.) A clean end-of-stream is
 *     the end of the upload, which is what FTP itself defines: STOR carries no
 *     length, so only the client knows whether it meant to send more.
 *   - **The client never names a real path.** It navigates a virtual root built
 *     from the servers it may file-manage; every real path then goes through
 *     `safePath()` (src/lib/server-file-ops.ts) as a second, independent
 *     containment check.
 *   - **No dependencies.** Node's `net`/`tls`/`fs` only, so it ships inside the
 *     panel process (see instrumentation.ts) without a new supply chain.
 *
 * Deliberately not implemented: FXP (server-to-server relay), `SITE` commands,
 * and active-mode dialling to any address but the client's own (see
 * `activeTargetAllowed` in ftp-protocol.ts — that is the FTP bounce attack).
 */

import { createServer as createNetServer, connect as netConnect, type Server as NetServer, type Socket } from "node:net";
import { createServer as createTlsServer, type Server as TlsServer, type TLSSocket } from "node:tls";
import { createReadStream, createWriteStream, type WriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat, unlink } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { safePath } from "./server-file-ops";
import { createLogger } from "./logger";
import {
  FTP_FEATURES,
  activeTargetAllowed,
  formatEpsvReply,
  formatFeatReply,
  formatListLine,
  formatMlsdLine,
  formatMlstLine,
  formatPasvReply,
  ftpTimestamp,
  listingPathFromArg,
  nextPassivePort,
  normalizeVirtualPath,
  parseEprtArg,
  parseFtpCommand,
  parsePortArg,
  sanitizeEntryName,
  virtualBaseName,
  virtualDirName,
  type FtpListingEntry,
} from "./ftp-protocol";

const log = createLogger("ftp");

/** One server exposed under the virtual root. */
export interface FtpVirtualFolder {
  /** Folder name clients see at the root, e.g. `survival-12`. */
  name: string;
  /** Absolute install path on the machine running the panel. */
  absPath: string;
  serverId: number | null;
  /** Human label for logs and the activity feed. */
  label: string;
  /**
   * True when the operator does not own this server and reaches it through a
   * per-server file-transfer grant. Informational only — the folder list has
   * already been decided by the caller.
   */
  shared?: boolean;
}

/** Everything the server needs to know about a logged-in client. */
export interface FtpSession {
  accountId: number;
  username: string;
  userId: number;
  folders: FtpVirtualFolder[];
  /** Scoped account: the single folder *is* the root, with no wrapper folder. */
  rootedAtServer: boolean;
}

export type FtpEventType =
  | "connected"
  | "login"
  | "login-failed"
  | "disconnect"
  | "upload"
  | "download"
  | "delete"
  | "mkdir"
  | "rename";

export interface FtpEvent {
  type: FtpEventType;
  at: number;
  ip?: string;
  username?: string | null;
  userId?: number | null;
  serverId?: number | null;
  path?: string;
  bytes?: number;
  durationMs?: number;
  ok?: boolean;
  message?: string;
}

export interface FtpServerOptions {
  /** Bind address. `0.0.0.0` by default so the port is reachable off-box. */
  host?: string;
  port: number;
  passivePortMin: number;
  passivePortMax: number;
  /**
   * Address advertised in PASV replies. Empty = the control connection's own
   * local address, which is right for a directly reachable host and wrong
   * behind NAT — where the operator sets the public name here.
   */
  masqueradeHost?: string;
  /** Enables AUTH TLS when both parts are supplied. */
  tls?: { cert: string; key: string } | null;
  /** Overrides the port advertised in PASV offers (container DNAT). */
  passiveAdvertisedPort?: number | null;
  /** 0 disables the per-upload cap. */
  maxUploadBytes?: number;
  idleTimeoutMs?: number;
  dataTimeoutMs?: number;
  maxConnections?: number;
  maxConnectionsPerUser?: number;
  /** Resolve credentials → session. Return null to refuse the login. */
  authenticate: (
    username: string,
    password: string,
    context: { ip: string }
  ) => Promise<FtpSession | null>;
  /** Called after a failed login, for the panel's login throttle. */
  onLoginFailure?: (ip: string, username: string) => void;
  onEvent?: (event: FtpEvent) => void;
}

/** A single completed transfer, for the panel's activity list. */
export interface FtpTransferRecord {
  at: number;
  username: string;
  type: "upload" | "download";
  path: string;
  bytes: number;
  durationMs: number;
  ok: boolean;
}

export interface FtpServerStats {
  listening: boolean;
  port: number | null;
  host: string | null;
  connections: number;
  loggedIn: number;
  usernames: string[];
  uploads: number;
  downloads: number;
  bytesIn: number;
  bytesOut: number;
  startedAt: number | null;
  lastError: string | null;
  recent: FtpTransferRecord[];
}

const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_DATA_TIMEOUT_MS = 60 * 1000;
const DEFAULT_MAX_CONNECTIONS = 64;
const DEFAULT_MAX_CONNECTIONS_PER_USER = 8;
const MAX_LOGIN_ATTEMPTS = 3;
const RECENT_TRANSFER_LIMIT = 25;
/** CEILING for the control-line accumulator; a line itself is capped lower. */
const MAX_BUFFERED_COMMANDS = 64 * 1024;

/** Line endings differ by client; tolerate both, always reply with CRLF. */
const CRLF = "\r\n";

/**
 * Features advertised when TLS is *not* configured.
 *
 * Announcing AUTH TLS on a server with no certificate makes clients attempt an
 * upgrade that can only fail, so the TLS trio is dropped instead.
 */
export const FTP_FEATURES_CLEAR: readonly string[] = FTP_FEATURES.filter(
  (feature) => !["AUTH TLS", "PBSZ", "PROT"].includes(feature)
);

/**
 * Wrap a plain socket in TLS using a `tls.Server` instance.
 *
 * `new tls.TLSSocket(socket, { isServer: true })` would also work, but a real
 * `tls.Server` brings the session-ticket machinery with it — and clients
 * (FileZilla above all) refuse a data connection whose TLS session the control
 * connection did not establish. The server is never listened on; sockets are
 * handed to it with `emit("connection")`, the same path an accepted socket
 * takes.
 */
class TlsUpgrader {
  private readonly server: TlsServer;
  private readonly pending: Array<{
    socket: Socket;
    resolve: (socket: TLSSocket) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }> = [];

  /**
   * Certificate and key go straight into `tls.createServer`.
   *
   * Passing a pre-built `SecureContext` through the `secureContext` option
   * fails every handshake on Node 22 ("no suitable signature algorithm": the
   * context reaches OpenSSL without its key), so the material is handed over
   * as-is and Node builds the context. One server instance serves every
   * connection, which is also what makes TLS session resumption work for data
   * connections.
   */
  constructor(material: { cert: string; key: string }) {
    this.server = createTlsServer({ cert: material.cert, key: material.key, minVersion: "TLSv1.2" }, (tlsSocket) =>
      this.settle(tlsSocket)
    );
    this.server.on("tlsClientError", (error: Error, socket: Socket) => this.fail(error, socket));
  }

  upgrade(socket: Socket, timeoutMs = 20_000): Promise<TLSSocket> {
    return new Promise<TLSSocket>((resolveUpgrade, rejectUpgrade) => {
      const timer = setTimeout(() => {
        this.drop(socket);
        socket.destroy();
        rejectUpgrade(new Error("TLS handshake timed out"));
      }, timeoutMs);
      timer.unref?.();
      this.pending.push({ socket, resolve: resolveUpgrade, reject: rejectUpgrade, timer });
      this.server.emit("connection", socket);
    });
  }

  private settle(tlsSocket: TLSSocket): void {
    const parent = (tlsSocket as unknown as { _parent?: Socket })._parent;
    let index = parent ? this.pending.findIndex((p) => p.socket === parent) : -1;
    // One shared upgrader serves every connection, so a socket that cannot be
    // matched to a waiter is closed rather than handed to the wrong session.
    if (index === -1 && this.pending.length === 1) index = 0;
    const entry = index >= 0 ? this.pending.splice(index, 1)[0] : undefined;
    if (!entry) {
      tlsSocket.destroy();
      return;
    }
    clearTimeout(entry.timer);
    entry.resolve(tlsSocket);
  }

  private fail(error: Error, socket: Socket): void {
    let index = this.pending.findIndex((p) => p.socket === socket);
    if (index === -1 && this.pending.length === 1) index = 0;
    if (index === -1) return;
    const entry = this.pending.splice(index, 1)[0];
    if (!entry) return;
    clearTimeout(entry.timer);
    socket.destroy();
    entry.reject(error);
  }

  private drop(socket: Socket): void {
    const index = this.pending.findIndex((p) => p.socket === socket);
    if (index >= 0) this.pending.splice(index, 1);
  }
}

/** Resolve inside the virtual root → what to do on the real filesystem. */
type ResolvedPath =
  | { kind: "root" }
  | { kind: "entry"; folder: FtpVirtualFolder; virtualPath: string; abs: string }
  | { kind: "denied" };

export class FtpServer {
  private readonly options: FtpServerOptions & {
    host: string;
    idleTimeoutMs: number;
    dataTimeoutMs: number;
    maxConnections: number;
    maxConnectionsPerUser: number;
  };
  private listener: NetServer | null = null;
  /** Actual bound port — differs from the requested one when 0 was asked for. */
  private boundPort: number | null = null;
  private readonly connections = new Set<FtpConnection>();
  private readonly passiveInUse = new Set<number>();
  private passiveCursor = 0;
  private startedAt: number | null = null;
  private lastError: string | null = null;
  private uploads = 0;
  private downloads = 0;
  private bytesIn = 0;
  private bytesOut = 0;
  private readonly recent: FtpTransferRecord[] = [];
  private tlsUpgrader: TlsUpgrader | null | undefined;

  constructor(options: FtpServerOptions) {
    this.options = {
      ...options,
      host: options.host || "0.0.0.0",
      idleTimeoutMs: options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
      dataTimeoutMs: options.dataTimeoutMs ?? DEFAULT_DATA_TIMEOUT_MS,
      maxConnections: options.maxConnections ?? DEFAULT_MAX_CONNECTIONS,
      maxConnectionsPerUser: options.maxConnectionsPerUser ?? DEFAULT_MAX_CONNECTIONS_PER_USER,
    };
  }

  /** Begin listening. Rejects when the port is taken so the caller can report it. */
  async start(): Promise<{ port: number; host: string }> {
    if (this.listener) return { port: this.boundPort ?? this.options.port, host: this.options.host };
    const listener = createNetServer({ allowHalfOpen: false });
    this.listener = listener;

    listener.on("connection", (socket) => {
      if (this.connections.size >= this.options.maxConnections) {
        socket.end(`421 Too many connections — try again shortly.${CRLF}`);
        return;
      }
      const connection = new FtpConnection(socket, this);
      this.connections.add(connection);
      connection.start();
    });

    listener.on("error", (error: NodeJS.ErrnoException) => {
      this.lastError = error.message;
      log.warn(`listener error: ${error.message}`);
    });

    await new Promise<void>((resolveListen, rejectListen) => {
      const onError = (error: Error) => {
        listener.off("listening", onListening);
        rejectListen(error);
      };
      const onListening = () => {
        listener.off("error", onError);
        resolveListen();
      };
      listener.once("error", onError);
      listener.once("listening", onListening);
      listener.listen(this.options.port, this.options.host);
    });

    const address = listener.address();
    this.boundPort = typeof address === "object" && address ? address.port : this.options.port;
    this.startedAt = Date.now();
    return { port: this.boundPort, host: this.options.host };
  }

  /** Close the listener and every live control connection. */
  async stop(): Promise<void> {
    const listener = this.listener;
    this.listener = null;
    this.startedAt = null;
    this.boundPort = null;
    for (const connection of [...this.connections]) {
      connection.destroy("421 Server shutting down.");
    }
    this.connections.clear();
    this.passiveInUse.clear();
    if (!listener) return;
    await new Promise<void>((resolveClose) => listener.close(() => resolveClose()));
  }

  get listening(): boolean {
    return this.listener !== null && this.listener.listening;
  }

  get config(): FtpServerOptions & {
    host: string;
    idleTimeoutMs: number;
    dataTimeoutMs: number;
    maxConnections: number;
    maxConnectionsPerUser: number;
  } {
    return this.options;
  }

  /**
   * The shared TLS upgrader, or null when no certificate is configured.
   *
   * Built lazily so a server without TLS never touches the certificate code
   * path, and shared so the control and data connections of one session agree
   * on a session-ticket context (clients refuse data connections otherwise).
   */
  getTlsUpgrader(): TlsUpgrader | null {
    if (this.tlsUpgrader !== undefined) return this.tlsUpgrader;
    this.tlsUpgrader = this.options.tls
      ? new TlsUpgrader({ cert: this.options.tls.cert, key: this.options.tls.key })
      : null;
    return this.tlsUpgrader;
  }

  /** Force-close sessions for one account (credential rotation, revoke). */
  disconnectUser(username: string): number {
    let closed = 0;
    for (const connection of this.connections) {
      if (connection.sessionUsername?.toLowerCase() === username.toLowerCase()) {
        connection.destroy("421 Your credentials were changed — reconnect.");
        closed += 1;
      }
    }
    return closed;
  }

  stats(): FtpServerStats {
    const usernames = [...this.connections]
      .map((c) => c.sessionUsername)
      .filter((u): u is string => Boolean(u));
    return {
      listening: this.listening,
      port: this.listening ? this.boundPort : null,
      host: this.listening ? this.options.host : null,
      connections: this.connections.size,
      loggedIn: usernames.length,
      usernames,
      uploads: this.uploads,
      downloads: this.downloads,
      bytesIn: this.bytesIn,
      bytesOut: this.bytesOut,
      startedAt: this.startedAt,
      lastError: this.lastError,
      recent: [...this.recent],
    };
  }

  // ── Internal API used by connections ──────────────────────────────────────

  /** @internal Close bookkeeping for a control connection. */
  detachConnection(connection: FtpConnection): boolean {
    return this.connections.delete(connection);
  }

  /** @internal How many live sessions an account already holds. */
  sessionsFor(username: string, excluding: FtpConnection): number {
    return [...this.connections].filter(
      (c) => c !== excluding && c.sessionUsername?.toLowerCase() === username.toLowerCase()
    ).length;
  }

  /** @internal A data transfer is in flight; pause the idle timeout. */
  onTransferStart(connection: FtpConnection): void {
    connection.busy = true;
  }

  onTransferEnd(connection: FtpConnection, record: Omit<FtpTransferRecord, "at">): void {
    connection.busy = false;
    if (record.type === "upload") {
      this.uploads += 1;
      this.bytesIn += record.bytes;
    } else {
      this.downloads += 1;
      this.bytesOut += record.bytes;
    }
    this.recent.unshift({ at: Date.now(), ...record });
    if (this.recent.length > RECENT_TRANSFER_LIMIT) this.recent.pop();
  }

  /**
   * Listen for one passive data connection inside the configured port range.
   *
   * Busy ports (this server's own, plus anything else on the box) are skipped,
   * and the rotating cursor makes the range visibly used rather than pinned to
   * one port — some NAT setups only forward part of a range.
   */
  async listenPassive(bindHost: string): Promise<{ server: NetServer; port: number } | null> {
    const range = { min: this.options.passivePortMin, max: this.options.passivePortMax };
    for (let attempt = 0; attempt <= range.max - range.min; attempt++) {
      const picked = nextPassivePort(this.passiveCursor, range, (port) => !this.passiveInUse.has(port));
      if (!picked) return null;
      this.passiveCursor = picked.cursor;
      this.passiveInUse.add(picked.port);
      const server = createNetServer({ allowHalfOpen: false });
      try {
        await new Promise<void>((resolveListen, rejectListen) => {
          const onError = (error: Error) => rejectListen(error);
          server.once("error", onError);
          server.listen(picked.port, bindHost, () => {
            server.off("error", onError);
            resolveListen();
          });
        });
        return { server, port: picked.port };
      } catch {
        // Port busy — release it and try the next one in the range.
        this.passiveInUse.delete(picked.port);
        server.close();
      }
    }
    return null;
  }

  /** @internal Release a passive port once its listener is done. */
  releasePassivePort(port: number | null): void {
    if (port !== null) this.passiveInUse.delete(port);
  }

  emit(event: FtpEvent): void {
    try {
      this.options.onEvent?.(event);
    } catch {
      // An audit sink must never take down a transfer.
    }
  }
}

/**
 * One control connection: the FTP state machine, from `USER` to `QUIT`.
 *
 * A class per connection because nearly every command mutates session state
 * (cwd, transfer type, pending rename, data mode).
 */
export class FtpConnection {
  socket: Socket;
  private readonly server: FtpServer;
  private buffer: Buffer = Buffer.alloc(0);
  private readonly ip: string;
  private readonly folderRoots = new Map<string, FtpVirtualFolder>();
  private readonly onDataBound = (chunk: Buffer) => this.onData(chunk);
  private readonly onTimeoutBound = () => {
    if (this.busy) return;
    this.destroy("421 Idle timeout.");
  };

  session: FtpSession | null = null;
  /** Set while a transfer runs so the idle timeout does not cut it short. */
  busy = false;

  private pendingUser = "";
  private loginAttempts = 0;
  private cwd = "/";
  private transferType: "I" | "A" = "A";
  private restOffset = 0;
  private renameFrom: string | null = null;
  private passiveServer: NetServer | null = null;
  private passivePort: number | null = null;
  /**
   * Data connections that arrived before the transfer command did.
   *
   * Clients (FileZilla among them) connect to the advertised port the moment
   * PASV comes back, which is usually a few milliseconds *before* they send
   * RETR/STOR. Accepting at PASV time and queueing the socket here is the only
   * way not to miss that connection — waiting for it after the data command
   * would leave the client hanging until the data timeout.
   */
  private readonly passiveQueue: Array<Promise<Socket | null>> = [];
  /** Raw accepted sockets, kept only so teardown can destroy them. */
  private readonly passiveSockets: Socket[] = [];
  private passiveWaiter: (() => void) | null = null;
  private activeTarget: { host: string; port: number } | null = null;
  private dataSocket: Socket | null = null;
  private tlsActive = false;
  private dataProtected = false;
  private closed = false;

  constructor(socket: Socket, server: FtpServer) {
    this.socket = socket;
    this.server = server;
    this.ip = socket.remoteAddress ?? "unknown";
  }

  get sessionUsername(): string | null {
    return this.session?.username ?? null;
  }

  /** Greet the client and start reading commands. */
  start(): void {
    this.attachSocket(this.socket);
    this.server.emit({ type: "connected", at: Date.now(), ip: this.ip });
    this.reply(
      [
        "220-GSM File Transfer",
        "220 Uploads stream straight to disk — no size limit. UTF8, MLSD and REST supported.",
      ].join(CRLF)
    );
  }

  /** Common socket wiring, reused when the control connection upgrades to TLS. */
  private attachSocket(socket: Socket): void {
    socket.setTimeout(this.server.config.idleTimeoutMs);
    socket.setKeepAlive(true, 30_000);
    socket.setNoDelay(true);
    socket.on("data", this.onDataBound);
    socket.on("timeout", this.onTimeoutBound);
    socket.on("error", () => this.cleanup());
    socket.on("close", () => this.cleanup());
  }

  /** Close the connection, optionally with a final reply line. */
  destroy(replyLine?: string): void {
    if (this.closed) return;
    this.closed = true;
    this.closePassiveServer();
    this.dataSocket?.destroy();
    if (replyLine) {
      try {
        this.socket.end(`${replyLine}${CRLF}`);
      } catch {
        // The socket is already gone; nothing to report.
      }
    } else {
      this.socket.destroy();
    }
    this.cleanup();
  }

  private cleanup(): void {
    this.closePassiveServer();
    this.dataSocket?.destroy();
    // Reaching here twice is normal (error then close).
    if (!this.server.detachConnection(this)) return;
    this.server.emit({
      type: "disconnect",
      at: Date.now(),
      ip: this.ip,
      username: this.sessionUsername,
      userId: this.session?.userId ?? null,
    });
  }

  private reply(line: string): void {
    if (this.closed || this.socket.destroyed) return;
    this.socket.write(`${line}${CRLF}`);
  }

  /**
   * Frame the control stream into command lines.
   *
   * Bytes, not strings: after `AUTH TLS` any leftover buffered bytes are a
   * partial TLS ClientHello and must be pushed back onto the socket verbatim —
   * decoding through UTF-8 first would corrupt them.
   */
  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > MAX_BUFFERED_COMMANDS) {
      this.destroy("421 Command line too long.");
      return;
    }
    for (;;) {
      const index = this.buffer.indexOf(0x0a);
      if (index === -1) break;
      const line = this.buffer.subarray(0, index).toString("utf8");
      this.buffer = this.buffer.subarray(index + 1);
      void this.handleLine(line);
    }
  }

  private async handleLine(line: string): Promise<void> {
    const parsed = parseFtpCommand(line);
    if (!parsed) {
      this.reply("500 Syntax error, command unrecognized.");
      return;
    }
    try {
      await this.dispatch(parsed.command, parsed.arg);
    } catch (error: unknown) {
      log.warn(
        `${parsed.command} failed for ${this.sessionUsername ?? "anonymous"}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      this.reply("451 Requested action aborted: local error in processing.");
    }
  }

  private async dispatch(command: string, arg: string): Promise<void> {
    switch (command) {
      // ── Session ────────────────────────────────────────────────────────────
      case "USER":
        this.handleUser(arg);
        return;
      case "PASS":
        await this.handlePass(arg);
        return;
      case "ACCT":
        this.reply("202 Account information not required.");
        return;
      case "QUIT":
        this.destroy("221 Goodbye.");
        return;
      case "NOOP":
        this.reply("200 NOOP ok.");
        return;
      case "SYST":
        this.reply("215 UNIX Type: L8");
        return;
      case "FEAT":
        this.reply(formatFeatReply(this.server.config.tls ? FTP_FEATURES : FTP_FEATURES_CLEAR));
        return;
      case "OPTS":
        this.handleOpts(arg);
        return;
      case "HELP":
        this.reply(
          "214 Commands: USER PASS QUIT FEAT SYST OPTS TYPE MODE STRU PWD CWD CDUP PASV EPSV PORT EPRT " +
            "LIST NLST MLSD MLST SIZE MDTM RETR STOR STOU APPE REST ABOR DELE MKD RMD RNFR RNTO NOOP AUTH PBSZ PROT"
        );
        return;
      case "STAT":
        this.reply(
          this.session
            ? `211 Connected as ${this.session.username}; ${this.session.folders.length} server folder(s).`
            : "211 Not logged in."
        );
        return;
      case "CLNT":
      case "HOST":
        this.reply("200 Noted.");
        return;
      case "SITE":
        this.reply("502 SITE commands are not supported.");
        return;

      // ── Transfer parameters ───────────────────────────────────────────────
      case "TYPE":
        this.handleType(arg);
        return;
      case "MODE":
        this.reply(
          arg.trim() === "" || arg.trim().toUpperCase() === "S"
            ? "200 Mode set to Stream."
            : "504 Only stream mode is supported."
        );
        return;
      case "STRU":
        this.reply(
          arg.trim() === "" || arg.trim().toUpperCase() === "F"
            ? "200 Structure set to File."
            : "504 Only file structure is supported."
        );
        return;

      // ── TLS ───────────────────────────────────────────────────────────────
      case "AUTH":
        await this.handleAuth(arg);
        return;
      case "PBSZ":
        this.reply(this.tlsActive ? "200 PBSZ=0" : "503 Send AUTH TLS first.");
        return;
      case "PROT":
        this.handleProt(arg);
        return;

      // ── Directory navigation ──────────────────────────────────────────────
      case "PWD":
      case "XPWD":
        // RFC 959 lists PWD as a logged-in command; answering it pre-login
        // hands an unauthenticated client a map of the root.
        if (!this.requireLogin()) return;
        this.reply(`257 "${this.cwd}" is the current directory.`);
        return;
      case "CWD":
      case "XCWD":
        await this.handleCwd(arg);
        return;
      case "CDUP":
      case "XCUP":
        await this.handleCwd("..");
        return;
      case "MLST":
        await this.handleMlst(arg);
        return;

      // ── Data connections ──────────────────────────────────────────────────
      case "PASV":
        await this.handlePasv(false);
        return;
      case "EPSV":
        await this.handlePasv(true);
        return;
      case "PORT":
        this.handlePort(arg);
        return;
      case "EPRT":
        this.handleEprt(arg);
        return;

      // ── Listings and file info ────────────────────────────────────────────
      case "LIST":
      case "NLST":
        await this.handleList(command === "NLST", arg);
        return;
      case "MLSD":
        await this.handleMlsd(arg);
        return;
      case "SIZE":
        await this.handleSize(arg);
        return;
      case "MDTM":
        await this.handleMdtm(arg);
        return;

      // ── Transfers ─────────────────────────────────────────────────────────
      case "RETR":
        await this.handleRetr(arg);
        return;
      case "STOR":
        await this.handleStor(arg, { append: false, unique: false });
        return;
      case "STOU":
        await this.handleStor(arg, { append: false, unique: true });
        return;
      case "APPE":
        await this.handleStor(arg, { append: true, unique: false });
        return;
      case "REST":
        this.handleRest(arg);
        return;
      case "ABOR":
        this.closeDataSocket();
        this.reply("226 ABOR ok.");
        return;

      // ── Mutations ─────────────────────────────────────────────────────────
      case "DELE":
        await this.handleDele(arg);
        return;
      case "MKD":
      case "XMKD":
        await this.handleMkd(arg);
        return;
      case "RMD":
      case "XRMD":
        await this.handleRmd(arg);
        return;
      case "RNFR":
        await this.handleRnfr(arg);
        return;
      case "RNTO":
        await this.handleRnto(arg);
        return;

      default:
        this.reply(`502 ${command} is not implemented.`);
    }
  }

  // ── Authentication ───────────────────────────────────────────────────────

  private handleUser(username: string): void {
    this.pendingUser = username.trim();
    // A reused connection that re-issues USER starts a fresh login.
    this.session = null;
    this.folderRoots.clear();
    if (this.pendingUser === "") {
      this.reply("501 USER requires a username.");
      return;
    }
    this.reply("331 Please supply your password.");
  }

  private async handlePass(password: string): Promise<void> {
    if (!this.pendingUser) {
      this.reply("503 Login with USER first.");
      return;
    }
    if (this.loginAttempts >= MAX_LOGIN_ATTEMPTS) {
      this.destroy("421 Too many failed logins.");
      return;
    }

    const session = await this.server.config.authenticate(this.pendingUser, password, { ip: this.ip });
    if (!session) {
      this.loginAttempts += 1;
      this.server.config.onLoginFailure?.(this.ip, this.pendingUser);
      this.server.emit({
        type: "login-failed",
        at: Date.now(),
        ip: this.ip,
        username: this.pendingUser,
        ok: false,
      });
      // Deliberately vague: distinguishing "no such user" from "wrong password"
      // hands an attacker a username oracle.
      this.reply("530 Login incorrect.");
      if (this.loginAttempts >= MAX_LOGIN_ATTEMPTS) this.destroy("421 Too many failed logins.");
      return;
    }

    if (this.server.sessionsFor(session.username, this) >= this.server.config.maxConnectionsPerUser) {
      this.reply("530 Too many simultaneous sessions for this account.");
      return;
    }

    this.session = session;
    this.folderRoots.clear();
    for (const folder of session.folders) this.folderRoots.set(folder.name, folder);
    this.cwd = "/";
    this.loginAttempts = 0;
    this.server.emit({
      type: "login",
      at: Date.now(),
      ip: this.ip,
      username: session.username,
      userId: session.userId,
    });
    this.reply(
      session.rootedAtServer
        ? `230 Logged in — this session is rooted at "${session.folders[0]?.label ?? "your server"}".`
        : `230 Logged in — ${session.folders.length} server folder(s) available.`
    );
  }

  private handleOpts(arg: string): void {
    const token = arg.trim().toUpperCase();
    if (token.startsWith("UTF8")) {
      this.reply("200 UTF8 mode enabled.");
      return;
    }
    if (token.startsWith("MLST")) {
      this.reply("200 MLST options accepted.");
      return;
    }
    this.reply("501 Unsupported OPTS argument.");
  }

  private handleType(arg: string): void {
    const value = arg.trim().toUpperCase();
    if (value === "I" || value === "L8" || value === "L 8") {
      this.transferType = "I";
      this.reply("200 Type set to I.");
      return;
    }
    if (value === "A" || value === "A N") {
      this.transferType = "A";
      this.reply("200 Type set to A.");
      return;
    }
    this.reply("504 Unsupported TYPE.");
  }

  private async handleAuth(arg: string): Promise<void> {
    const mechanism = arg.trim().toUpperCase();
    if (mechanism !== "SSL" && mechanism !== "TLS") {
      this.reply("504 Unsupported AUTH mechanism.");
      return;
    }
    const upgrader = this.server.getTlsUpgrader();
    if (!upgrader) {
      this.reply("534 TLS is not configured on this server.");
      return;
    }
    this.reply("234 AUTH TLS OK — starting handshake.");
    try {
      // Any bytes already read past the AUTH line belong to the TLS handshake.
      if (this.buffer.length > 0) {
        this.socket.unshift(this.buffer);
        this.buffer = Buffer.alloc(0);
      }
      this.socket.off("data", this.onDataBound);
      this.socket.off("timeout", this.onTimeoutBound);
      const upgraded = await upgrader.upgrade(this.socket, 20_000);
      this.socket = upgraded;
      this.attachSocket(upgraded);
      this.tlsActive = true;
    } catch (error: unknown) {
      log.warn(`TLS handshake failed for ${this.ip}: ${error instanceof Error ? error.message : error}`);
      this.destroy();
    }
  }

  private handleProt(arg: string): void {
    if (!this.tlsActive) {
      this.reply("503 Send AUTH TLS first.");
      return;
    }
    const level = arg.trim().toUpperCase();
    if (level === "P") {
      this.dataProtected = true;
      this.reply("200 Protection level set to Private.");
      return;
    }
    if (level === "C") {
      this.dataProtected = false;
      this.reply("200 Protection level set to Clear.");
      return;
    }
    this.reply("504 Unsupported PROT level.");
  }

  // ── Path resolution ──────────────────────────────────────────────────────

  /** Map a virtual path onto a real path, with containment enforced twice. */
  private resolveVirtual(virtualPath: string): ResolvedPath {
    const session = this.session;
    if (!session || session.folders.length === 0) return { kind: "denied" };

    if (session.rootedAtServer) {
      const folder = session.folders[0];
      const abs = this.containedPath(folder, virtualPath.replace(/^\//, ""));
      return abs ? { kind: "entry", folder, virtualPath, abs } : { kind: "denied" };
    }

    const segments = virtualPath.split("/").filter(Boolean);
    if (segments.length === 0) return { kind: "root" };
    const folder = this.folderRoots.get(segments[0]);
    if (!folder) return { kind: "denied" };
    const abs = this.containedPath(folder, segments.slice(1).join("/"));
    return abs ? { kind: "entry", folder, virtualPath, abs } : { kind: "denied" };
  }

  private containedPath(folder: FtpVirtualFolder, relative: string): string | null {
    // safePath is the same containment check the web file manager uses; the
    // virtual-path normaliser already refused upward traversal, so this is the
    // independent second opinion (and the one that catches a bad base path).
    return safePath(folder.absPath, relative || ".");
  }

  private virtualFor(folder: FtpVirtualFolder, abs: string): string {
    const base = resolve(folder.absPath);
    const relative = abs === base ? "" : abs.startsWith(base + sep) ? abs.slice(base.length + 1) : null;
    if (relative === null) return "/";
    const suffix = relative.split(sep).join("/");
    return this.session?.rootedAtServer ? `/${suffix}` : `/${folder.name}${suffix ? `/${suffix}` : ""}`;
  }

  /** Path of `abs` relative to its folder root ("" for the root itself). */
  private relativeInFolder(folder: FtpVirtualFolder, abs: string): string {
    const base = resolve(folder.absPath);
    if (abs === base) return "";
    return abs.startsWith(base + sep) ? abs.slice(base.length + 1) : "";
  }

  private async handleCwd(arg: string): Promise<void> {
    if (!this.requireLogin()) return;
    const target = normalizeVirtualPath(this.cwd, arg);
    if (!target) {
      this.reply("550 Not a directory or permission denied.");
      return;
    }
    const resolved = this.resolveVirtual(target);
    if (resolved.kind === "root") {
      this.cwd = "/";
      this.reply('250 Directory changed to "/".');
      return;
    }
    if (resolved.kind === "denied") {
      this.reply("550 Not a directory or permission denied.");
      return;
    }
    try {
      const info = await stat(resolved.abs);
      if (!info.isDirectory()) {
        this.reply("550 Not a directory.");
        return;
      }
    } catch {
      this.reply("550 Not a directory or permission denied.");
      return;
    }
    this.cwd = target;
    this.reply(`250 Directory changed to "${target}".`);
  }

  private requireLogin(): boolean {
    if (this.session) return true;
    this.reply("530 Please log in with USER and PASS.");
    return false;
  }

  // ── Directory listings ───────────────────────────────────────────────────

  /** Entries for a virtual directory, including the synthetic root. */
  private async listingFor(virtualPath: string): Promise<FtpListingEntry[] | null> {
    const resolved = this.resolveVirtual(virtualPath);
    if (resolved.kind === "denied") return null;

    if (resolved.kind === "root") {
      const entries: FtpListingEntry[] = [];
      for (const folder of this.session?.folders ?? []) {
        try {
          const info = await stat(folder.absPath);
          entries.push({ name: folder.name, isDir: true, size: info.size, mtimeMs: info.mtimeMs, mode: info.mode });
        } catch {
          // A folder whose install path is gone simply does not appear; the
          // real tree is the truth, not the database row.
        }
      }
      return entries;
    }

    try {
      const info = await stat(resolved.abs);
      if (!info.isDirectory()) {
        // `LIST /file` — clients do this to probe; answer with the file itself.
        return [
          {
            name: virtualBaseName(resolved.virtualPath),
            isDir: false,
            size: info.size,
            mtimeMs: info.mtimeMs,
            mode: info.mode,
          },
        ];
      }
      const dirents = await readdir(resolved.abs, { withFileTypes: true });
      const entries: FtpListingEntry[] = [];
      for (const dirent of dirents) {
        try {
          const entryPath = join(/* turbopackIgnore: true */ resolved.abs, dirent.name);
          const entryStat = await stat(entryPath);
          entries.push({
            name: dirent.name,
            isDir: entryStat.isDirectory(),
            size: entryStat.size,
            mtimeMs: entryStat.mtimeMs,
            mode: entryStat.mode,
          });
        } catch {
          // Broken symlink or a race with a delete: list it with zero size
          // rather than hiding the entry, which confuses `ls`-style output.
          entries.push({ name: dirent.name, isDir: false, size: 0, mtimeMs: 0, mode: 0 });
        }
      }
      return entries;
    } catch {
      return null;
    }
  }

  private static sortEntries(entries: FtpListingEntry[]): FtpListingEntry[] {
    return [...entries].sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  private async handleList(namesOnly: boolean, arg: string): Promise<void> {
    if (!this.requireLogin()) return;
    const requested = listingPathFromArg(arg);
    const target = normalizeVirtualPath(this.cwd, requested || ".");
    if (!target) {
      this.reply("550 Permission denied.");
      return;
    }
    const entries = await this.listingFor(target);
    if (!entries) {
      this.reply("550 Directory not found.");
      return;
    }
    await this.sendData(renderListingBody(FtpConnection.sortEntries(entries), namesOnly, false), "226 Transfer complete.");
  }

  private async handleMlsd(arg: string): Promise<void> {
    if (!this.requireLogin()) return;
    const target = normalizeVirtualPath(this.cwd, (arg || "").trim() || ".");
    if (!target) {
      this.reply("550 Permission denied.");
      return;
    }
    const entries = await this.listingFor(target);
    if (!entries) {
      this.reply("550 Directory not found.");
      return;
    }
    await this.sendData(renderListingBody(FtpConnection.sortEntries(entries), false, true), "226 Transfer complete.");
  }

  private async handleMlst(arg: string): Promise<void> {
    if (!this.requireLogin()) return;
    const target = normalizeVirtualPath(this.cwd, (arg || "").trim() || ".");
    const resolved = target ? this.resolveVirtual(target) : { kind: "denied" as const };
    if (resolved.kind !== "entry") {
      this.reply("550 Not a file or directory.");
      return;
    }
    try {
      const info = await stat(resolved.abs);
      const entry: FtpListingEntry = {
        name: virtualBaseName(target ?? "/"),
        isDir: info.isDirectory(),
        size: info.size,
        mtimeMs: info.mtimeMs,
        mode: info.mode,
      };
      this.reply(`250-Listing ${target}${CRLF}${formatMlstLine(target ?? "/", entry)}${CRLF}250 End`);
    } catch {
      this.reply("550 Not a file or directory.");
    }
  }

  private async handleSize(arg: string): Promise<void> {
    if (!this.requireLogin()) return;
    const target = normalizeVirtualPath(this.cwd, arg);
    const resolved = target ? this.resolveVirtual(target) : { kind: "denied" as const };
    if (resolved.kind !== "entry") {
      this.reply("550 Could not read that file.");
      return;
    }
    try {
      const info = await stat(resolved.abs);
      if (!info.isFile()) {
        this.reply("550 Not a regular file.");
        return;
      }
      this.reply(`213 ${info.size}`);
    } catch {
      this.reply("550 Could not read that file.");
    }
  }

  private async handleMdtm(arg: string): Promise<void> {
    if (!this.requireLogin()) return;
    const target = normalizeVirtualPath(this.cwd, arg);
    const resolved = target ? this.resolveVirtual(target) : { kind: "denied" as const };
    if (resolved.kind !== "entry") {
      this.reply("550 Could not read that file.");
      return;
    }
    try {
      const info = await stat(resolved.abs);
      this.reply(`213 ${ftpTimestamp(info.mtimeMs)}`);
    } catch {
      this.reply("550 Could not read that file.");
    }
  }

  // ── Data connection plumbing ─────────────────────────────────────────────

  private async handlePasv(extended: boolean): Promise<void> {
    if (!this.requireLogin()) return;
    // A second PASV supersedes the first: clients re-issue it freely.
    this.closeDataSocket();
    this.closePassiveServer();
    // PASV can only express IPv4; an IPv6 client must use EPSV, and one that
    // only speaks PASV gets the masquerade host (or the bind address).
    if (!extended && this.socket.remoteFamily === "IPv6") {
      this.reply("425 Use EPSV for IPv6 connections.");
      return;
    }
    const binding = await this.server.listenPassive(this.server.config.host);
    if (!binding) {
      this.reply("425 Cannot open a passive connection — the passive port range is exhausted.");
      return;
    }
    this.passiveServer = binding.server;
    this.passivePort = binding.port;
    this.activeTarget = null;
    binding.server.on("connection", (socket) => {
      socket.setNoDelay(true);
      socket.setKeepAlive(true, 30_000);
      // One data connection per PASV; anything beyond that is either a client
      // bug or a port-scanner, and neither gets a second socket.
      if (this.passiveQueue.length >= 1) {
        socket.destroy();
        return;
      }
      this.passiveSockets.push(socket);
      // PROT P: start the TLS handshake now rather than when the transfer
      // command arrives. Clients open the data connection and begin the
      // handshake immediately after PASV; waiting for RETR/STOR before
      // accepting the TLS session deadlocks both sides.
      this.passiveQueue.push(this.protectDataSocket(socket));
      const waiter = this.passiveWaiter;
      this.passiveWaiter = null;
      waiter?.();
    });

    if (extended) {
      this.reply(formatEpsvReply(binding.port));
      return;
    }
    const advertised = this.server.config.masqueradeHost || this.socket.localAddress || "";
    const advertisedPort = this.server.config.passiveAdvertisedPort || binding.port;
    const reply = formatPasvReply(advertised, advertisedPort);
    if (!reply) {
      this.reply("425 The server has no IPv4 address to advertise — set a masquerade host or use EPSV.");
      return;
    }
    this.reply(reply);
  }

  private handlePort(arg: string): void {
    if (!this.requireLogin()) return;
    const parsed = parsePortArg(arg);
    if (!parsed) {
      this.reply("501 Malformed PORT argument.");
      return;
    }
    if (!activeTargetAllowed(this.ip, parsed.host)) {
      log.warn(`refused PORT bounce from ${this.ip} to ${parsed.host}`);
      this.reply("501 PORT address must match your connection address.");
      return;
    }
    this.closePassiveServer();
    this.activeTarget = parsed;
    this.reply("200 PORT command successful.");
  }

  private handleEprt(arg: string): void {
    if (!this.requireLogin()) return;
    const parsed = parseEprtArg(arg);
    if (!parsed) {
      this.reply("501 Malformed EPRT argument.");
      return;
    }
    if (!activeTargetAllowed(this.ip, parsed.host)) {
      log.warn(`refused EPRT bounce from ${this.ip} to ${parsed.host}`);
      this.reply("501 EPRT address must match your connection address.");
      return;
    }
    this.closePassiveServer();
    this.activeTarget = parsed;
    this.reply("200 EPRT command successful.");
  }

  /** Establish the data connection described by the last PASV/EPSV/PORT/EPRT. */
  private async openData(): Promise<Socket | null> {
    const { dataTimeoutMs } = this.server.config;
    let socket: Socket | null = null;

    let alreadySecured = false;
    if (this.passiveServer || this.passiveQueue.length > 0) {
      // Already queued (the usual case) or still on its way. The queued value is
      // boxed so awaiting it cannot chain into the TLS handshake promise.
      let pending = this.takeQueuedDataSocket();
      if (!pending && this.passiveServer) {
        const box = await new Promise<{ value: Promise<Socket | null> } | null>((resolveAccept) => {
          const timer = setTimeout(() => {
            this.passiveWaiter = null;
            resolveAccept(null);
          }, dataTimeoutMs);
          timer.unref?.();
          this.passiveWaiter = () => {
            clearTimeout(timer);
            const next = this.takeQueuedDataSocket();
            resolveAccept(next ? { value: next } : null);
          };
        });
        pending = box?.value ?? null;
      }
      socket = pending ? await pending : null;
      alreadySecured = true;
      this.closePassiveServer();
    } else if (this.activeTarget) {
      const target = this.activeTarget;
      this.activeTarget = null;
      socket = await new Promise<Socket | null>((resolveConnect) => {
        const connection = netConnect({ host: target.host, port: target.port });
        const timer = setTimeout(() => {
          connection.destroy();
          resolveConnect(null);
        }, dataTimeoutMs);
        timer.unref?.();
        connection.once("connect", () => {
          clearTimeout(timer);
          resolveConnect(connection);
        });
        connection.once("error", () => {
          clearTimeout(timer);
          resolveConnect(null);
        });
      });
    }

    if (!socket) return null;
    socket.setNoDelay(true);
    socket.setTimeout(dataTimeoutMs);
    socket.on("timeout", () => socket?.destroy());
    this.dataSocket = socket;

    // Passive sockets were wrapped when they arrived; an active-mode socket is
    // dialled here and still needs the handshake.
    if (!alreadySecured && this.dataProtected && this.tlsActive) {
      const upgrader = this.server.getTlsUpgrader();
      if (!upgrader) return socket;
      try {
        const tlsSocket = await upgrader.upgrade(socket, 20_000);
        this.dataSocket = tlsSocket;
        return tlsSocket;
      } catch (error: unknown) {
        log.warn(`data TLS handshake failed: ${error instanceof Error ? error.message : error}`);
        socket.destroy();
        return null;
      }
    }
    return socket;
  }

  /**
   * Dequeue one accepted data connection, releasing it from teardown.
   *
   * The raw socket list exists so `closePassiveServer()` can destroy sockets
   * nobody ever used; a socket handed to a transfer must be removed from it, or
   * the transfer would be killed by the cleanup that follows.
   */
  private takeQueuedDataSocket(): Promise<Socket | null> | null {
    const next = this.passiveQueue.shift();
    if (!next) return null;
    this.passiveSockets.shift();
    return next;
  }

  /**
   * Wrap an accepted data socket in TLS when PROT is Private.
   *
   * A handshake failure resolves to null (the caller answers 425) instead of
   * rejecting, so one bad client cannot produce an unhandled rejection.
   */
  private async protectDataSocket(socket: Socket): Promise<Socket | null> {
    if (!this.dataProtected || !this.tlsActive) return socket;
    const upgrader = this.server.getTlsUpgrader();
    if (!upgrader) return socket;
    try {
      return await upgrader.upgrade(socket, 20_000);
    } catch (error: unknown) {
      log.warn(`data TLS handshake failed: ${error instanceof Error ? error.message : error}`);
      socket.destroy();
      return null;
    }
  }

  /** The 150 line clients expect in front of every transfer. */
  private preliminaryReply(): string {
    return this.transferType === "I"
      ? "150 Opening BINARY mode data connection."
      : "150 Opening data connection.";
  }

  private closePassiveServer(): void {
    this.passiveQueue.length = 0;
    for (const queued of this.passiveSockets.splice(0)) queued.destroy();
    this.passiveWaiter = null;
    if (this.passiveServer) {
      try {
        this.passiveServer.close();
      } catch {
        // Already closed.
      }
      this.server.releasePassivePort(this.passivePort);
    }
    this.passiveServer = null;
    this.passivePort = null;
  }

  private closeDataSocket(): void {
    this.dataSocket?.destroy();
    this.dataSocket = null;
  }

  /**
   * Send a generated body (listing, MLSD output) over the data connection.
   *
   * The preliminary 150 comes first: RFC 959 requires it before the transfer
   * starts, and clients use it as the signal to start reading the data socket.
   */
  private async sendData(body: string, successReply: string): Promise<void> {
    this.reply(this.preliminaryReply());
    const socket = await this.openData();
    if (!socket) {
      this.reply("425 Cannot open data connection.");
      return;
    }
    const bytes = Buffer.byteLength(body);
    this.server.onTransferStart(this);
    const startedAt = Date.now();
    const path = `${this.cwd} (listing)`;
    try {
      await new Promise<void>((resolveWrite, rejectWrite) => {
        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          resolveWrite();
        };
        socket.on("error", rejectWrite);
        socket.once("close", done);
        socket.once("finish", done);
        socket.end(body, done);
      });
      this.server.onTransferEnd(this, {
        username: this.sessionUsername ?? "unknown",
        type: "download",
        path,
        bytes,
        durationMs: Date.now() - startedAt,
        ok: true,
      });
      this.reply(successReply);
    } catch {
      this.reply("426 Connection closed; transfer aborted.");
    } finally {
      this.closeDataSocket();
    }
  }

  // ── File transfers ───────────────────────────────────────────────────────

  private handleRest(arg: string): void {
    const offset = Number.parseInt(arg.trim(), 10);
    if (!Number.isInteger(offset) || offset < 0) {
      this.reply("501 Invalid REST offset.");
      return;
    }
    this.restOffset = offset;
    this.reply(`350 Restarting at ${offset}. Send STOR or RETR.`);
  }

  private async handleRetr(arg: string): Promise<void> {
    if (!this.requireLogin()) return;
    const target = normalizeVirtualPath(this.cwd, arg);
    const resolved = target ? this.resolveVirtual(target) : { kind: "denied" as const };
    if (resolved.kind !== "entry") {
      this.reply("550 File not found.");
      return;
    }
    try {
      const info = await stat(resolved.abs);
      if (!info.isFile()) {
        this.reply("550 Not a regular file.");
        return;
      }
    } catch {
      this.reply("550 File not found.");
      return;
    }

    const offset = this.restOffset;
    this.restOffset = 0;
    const virtualPath = this.virtualFor(resolved.folder, resolved.abs);
    this.reply(this.preliminaryReply());
    const socket = await this.openData();
    if (!socket) {
      this.reply("425 Cannot open data connection.");
      return;
    }
    this.server.onTransferStart(this);
    const startedAt = Date.now();
    let bytesSent = 0;
    try {
      const stream = createReadStream(resolved.abs, offset > 0 ? { start: offset } : undefined);
      stream.on("data", (chunk: Buffer | string) => {
        bytesSent += typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;
      });
      await new Promise<void>((resolveTransfer, rejectTransfer) => {
        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          resolveTransfer();
        };
        stream.on("error", rejectTransfer);
        socket.on("error", rejectTransfer);
        socket.once("close", done);
        socket.once("finish", done);
        stream.pipe(socket);
      });
      this.finishTransfer("download", resolved.folder.serverId, virtualPath, bytesSent, startedAt, true);
      this.reply("226 Transfer complete.");
    } catch (error: unknown) {
      this.finishTransfer("download", resolved.folder.serverId, virtualPath, bytesSent, startedAt, false);
      log.warn(`download failed: ${error instanceof Error ? error.message : error}`);
      this.reply("426 Connection closed; transfer aborted.");
    } finally {
      this.closeDataSocket();
    }
  }

  private finishTransfer(
    type: "upload" | "download",
    serverId: number | null,
    path: string,
    bytes: number,
    startedAt: number,
    ok: boolean
  ): void {
    const durationMs = Date.now() - startedAt;
    this.server.onTransferEnd(this, {
      username: this.sessionUsername ?? "unknown",
      type,
      path,
      bytes,
      durationMs,
      ok,
    });
    this.server.emit({
      type,
      at: Date.now(),
      ip: this.ip,
      username: this.sessionUsername,
      userId: this.session?.userId ?? null,
      serverId,
      path,
      bytes,
      durationMs,
      ok,
    });
  }

  /**
   * STOR / APPE / STOU.
   *
   * Writes go through a hidden part file and are renamed into place on
   * success — a connection that drops halfway cannot leave a truncated world
   * file where the game will load it. `APPE` and `REST` (resume) have to write
   * in place by definition, so they are the exceptions.
   */
  private async handleStor(arg: string, options: { append: boolean; unique: boolean }): Promise<void> {
    if (!this.requireLogin()) return;

    let requested = (arg || "").trim();
    if (options.unique && requested === "") requested = "upload";
    const target = normalizeVirtualPath(this.cwd, requested);
    if (!target || target === "/") {
      this.reply("553 A file name is required.");
      return;
    }

    const parent = this.resolveVirtual(virtualDirName(target));
    if (parent.kind !== "entry") {
      this.reply("550 Destination directory is not writable.");
      return;
    }
    const name = options.unique
      ? `${virtualBaseName(target) || "upload"}-${randomBytes(4).toString("hex")}.${Date.now().toString(36)}`
      : sanitizeEntryName(virtualBaseName(target));
    if (!name) {
      this.reply("553 Invalid file name.");
      return;
    }

    const finalPath = safePath(
      parent.folder.absPath,
      join(/* turbopackIgnore: true */ this.relativeInFolder(parent.folder, parent.abs), name)
    );
    if (!finalPath) {
      this.reply("550 Destination outside this server's directory.");
      return;
    }

    const offset = this.restOffset;
    this.restOffset = 0;
    const inPlace = options.append || offset > 0;

    this.reply(this.preliminaryReply());
    const socket = await this.openData();
    if (!socket) {
      this.reply("425 Cannot open data connection.");
      return;
    }

    try {
      await mkdir(dirname(finalPath), { recursive: true });
    } catch {
      this.closeDataSocket();
      this.reply("550 Destination directory is not writable.");
      return;
    }

    const limit = this.server.config.maxUploadBytes ?? 0;
    const partPath = inPlace
      ? null
      : join(/* turbopackIgnore: true */ dirname(finalPath), `.gsm-upload-${randomBytes(8).toString("hex")}.part`);

    let writer: WriteStream;
    try {
      writer = createWriteStream(partPath ?? finalPath, {
        flags: options.append ? "a" : partPath ? "wx" : offset > 0 ? "r+" : "w",
        ...(!options.append && offset > 0 ? { start: offset } : {}),
      });
    } catch {
      this.closeDataSocket();
      this.reply("550 Cannot write to that location.");
      return;
    }

    const virtualPath = this.virtualFor(parent.folder, finalPath);
    this.server.onTransferStart(this);
    const startedAt = Date.now();
    let bytes = 0;
    let limitExceeded = false;
    let aborted = false;

    try {
      await new Promise<void>((resolveWrite, rejectWrite) => {
        socket.on("error", (error) => {
          aborted = true;
          writer.destroy();
          rejectWrite(error);
        });
        writer.on("error", rejectWrite);
        writer.on("finish", () => resolveWrite());
        socket.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          // Enforce the optional cap by aborting rather than buffering — the
          // connection is torn down and the part file removed below.
          if (limit > 0 && bytes > limit) {
            limitExceeded = true;
            socket.pause();
            writer.destroy(new Error("upload limit exceeded"));
          }
        });
        socket.pipe(writer);
      });

      if (partPath) await rename(partPath, finalPath);
      this.finishTransfer("upload", parent.folder.serverId, virtualPath, bytes, startedAt, true);
      log.info(`stored ${bytes} bytes at ${virtualPath} as ${this.sessionUsername ?? "unknown"}`);
      this.reply(`226 Transfer complete — ${bytes} bytes stored.`);
    } catch (error: unknown) {
      if (partPath) await rm(partPath, { force: true });
      this.finishTransfer("upload", parent.folder.serverId, virtualPath, bytes, startedAt, false);
      log.warn(
        `upload failed at ${virtualPath}: ${error instanceof Error ? error.message : String(error)}`
      );
      if (limitExceeded) {
        this.reply(`552 Upload exceeds the configured limit of ${limit} bytes.`);
      } else if ((error as NodeJS.ErrnoException).code === "ENOSPC") {
        this.reply("452 Insufficient storage space on the server.");
      } else if (aborted || (error as NodeJS.ErrnoException).code === "ECONNRESET") {
        this.reply("426 Connection closed; transfer aborted.");
      } else {
        this.reply("451 Local error while writing the file.");
      }
    } finally {
      this.closeDataSocket();
      if (!writer.destroyed) writer.destroy();
    }
  }

  // ── Mutations ────────────────────────────────────────────────────────────

  private async handleDele(arg: string): Promise<void> {
    if (!this.requireLogin()) return;
    const target = normalizeVirtualPath(this.cwd, arg);
    const resolved = target ? this.resolveVirtual(target) : { kind: "denied" as const };
    if (resolved.kind !== "entry") {
      this.reply("550 File not found.");
      return;
    }
    try {
      const info = await stat(resolved.abs);
      if (info.isDirectory()) {
        this.reply("550 That is a directory — use RMD.");
        return;
      }
      await unlink(resolved.abs);
      this.announce("delete", resolved.folder, resolved.abs);
      this.reply("250 File deleted.");
    } catch {
      this.reply("550 Could not delete that file.");
    }
  }

  private async handleMkd(arg: string): Promise<void> {
    if (!this.requireLogin()) return;
    const target = normalizeVirtualPath(this.cwd, arg);
    const name = sanitizeEntryName(virtualBaseName(target ?? ""));
    if (!target || !name) {
      this.reply("553 Invalid directory name.");
      return;
    }
    const parent = this.resolveVirtual(virtualDirName(target));
    if (parent.kind !== "entry") {
      this.reply("550 Parent directory is not writable.");
      return;
    }
    const fullPath = safePath(
      parent.folder.absPath,
      join(/* turbopackIgnore: true */ this.relativeInFolder(parent.folder, parent.abs), name)
    );
    if (!fullPath) {
      this.reply("550 Destination outside this server's directory.");
      return;
    }
    try {
      await mkdir(fullPath, { recursive: true });
      this.announce("mkdir", parent.folder, fullPath);
      this.reply(`257 "${target}" created.`);
    } catch {
      this.reply("550 Could not create that directory.");
    }
  }

  private async handleRmd(arg: string): Promise<void> {
    if (!this.requireLogin()) return;
    const target = normalizeVirtualPath(this.cwd, arg);
    const resolved = target ? this.resolveVirtual(target) : { kind: "denied" as const };
    if (resolved.kind !== "entry") {
      this.reply("550 Directory not found.");
      return;
    }
    // Never remove a server's own root directory.
    if (this.relativeInFolder(resolved.folder, resolved.abs) === "") {
      this.reply("550 Cannot remove the server root.");
      return;
    }
    try {
      const info = await stat(resolved.abs);
      if (!info.isDirectory()) {
        this.reply("550 Not a directory.");
        return;
      }
      await rm(resolved.abs, { recursive: true, force: false });
      this.announce("delete", resolved.folder, resolved.abs);
      this.reply("250 Directory removed.");
    } catch {
      this.reply("550 Could not remove that directory.");
    }
  }

  private async handleRnfr(arg: string): Promise<void> {
    if (!this.requireLogin()) return;
    const target = normalizeVirtualPath(this.cwd, arg);
    if (!target || target === "/") {
      this.reply("550 File not found.");
      return;
    }
    const resolved = this.resolveVirtual(target);
    if (resolved.kind !== "entry") {
      this.reply("550 File not found.");
      return;
    }
    try {
      await stat(resolved.abs);
    } catch {
      this.reply("550 File not found.");
      return;
    }
    this.renameFrom = target;
    this.reply("350 Ready for RNTO.");
  }

  private async handleRnto(arg: string): Promise<void> {
    if (!this.requireLogin()) return;
    if (!this.renameFrom) {
      this.reply("503 Send RNFR first.");
      return;
    }
    const from = this.renameFrom;
    this.renameFrom = null;
    const to = normalizeVirtualPath(this.cwd, arg);
    // Same-folder only: the two sides of a rename each carry their own server
    // root, and crossing them would need a copy rather than a rename.
    const source = from ? this.resolveVirtual(from) : { kind: "denied" as const };
    const destination = to ? this.resolveVirtual(to) : { kind: "denied" as const };
    if (source.kind !== "entry" || destination.kind !== "entry") {
      this.reply("550 Rename must stay inside the same server folder.");
      return;
    }
    if (source.folder.name !== destination.folder.name) {
      this.reply("550 Rename must stay inside the same server folder.");
      return;
    }
    const destinationName = sanitizeEntryName(virtualBaseName(to ?? ""));
    if (!destinationName) {
      this.reply("553 Invalid destination name.");
      return;
    }
    try {
      await mkdir(dirname(destination.abs), { recursive: true });
      await rename(source.abs, destination.abs);
      this.announce("rename", source.folder, destination.abs);
      this.reply("250 Rename successful.");
    } catch {
      this.reply("550 Rename failed.");
    }
  }

  private announce(type: FtpEventType, folder: FtpVirtualFolder, abs: string): void {
    this.server.emit({
      type,
      at: Date.now(),
      ip: this.ip,
      username: this.sessionUsername,
      userId: this.session?.userId ?? null,
      serverId: folder.serverId,
      path: this.virtualFor(folder, abs),
      ok: true,
    });
  }
}

/** Render a listing body from entries (LIST/NLST/MLSD share the plumbing). */
export function renderListingBody(entries: FtpListingEntry[], namesOnly = false, mlsd = false): string {
  const lines = entries.map((entry) => {
    if (namesOnly) return entry.name;
    return mlsd ? formatMlsdLine(entry) : formatListLine(entry);
  });
  return lines.length > 0 ? `${lines.join(CRLF)}${CRLF}` : "";
}
