/**
 * Runtime ownership of the panel's FTP/FTPS listener.
 *
 * The panel process is the only thing that can spawn this server (it needs the
 * database for logins and the same disk the game servers live on), so it is
 * started from `instrumentation.ts` exactly like the scheduler and the status
 * boards, and re-read whenever the operator changes a setting.
 *
 * Everything here is best-effort by design: a port already in use, a bad TLS
 * certificate or an unreachable database must leave the rest of the panel
 * working. The failure is recorded so the File Transfer panel can show it
 * instead of an operator wondering why nothing connects.
 */

import { readFile } from "node:fs/promises";
import { FtpServer, type FtpEvent, type FtpServerStats } from "./ftp-server";
import {
  authenticateTransferLogin,
  loadTransferSettings,
  recordTransferAudit,
  type TransferSettings,
} from "./file-transfer";
import { clearFailedLogins, loginRetryAfter, recordFailedLogin } from "./auth";
import { createLogger } from "./logger";

const log = createLogger("transfer");

interface TransferRuntime {
  server: FtpServer;
  settings: TransferSettings;
}

/**
 * Module state lives on globalThis so a Next dev-server hot reload does not
 * leave a second listener bound to the same port (and a stale instance holding
 * the old credentials).
 */
const globalForTransfer = globalThis as typeof globalThis & {
  __gsmFileTransfer?: TransferRuntime;
  __gsmFileTransferStarting?: Promise<FtpServerStats | null>;
  __gsmFileTransferError?: string | null;
  __gsmFileTransferTlsError?: string | null;
};

async function readTlsMaterial(settings: TransferSettings): Promise<{ cert: string; key: string } | null> {
  if (!settings.tlsCertPath || !settings.tlsKeyPath) {
    globalForTransfer.__gsmFileTransferTlsError = null;
    return null;
  }
  try {
    const [cert, key] = await Promise.all([
      readFile(/* turbopackIgnore: true */ settings.tlsCertPath, "utf8"),
      readFile(/* turbopackIgnore: true */ settings.tlsKeyPath, "utf8"),
    ]);
    globalForTransfer.__gsmFileTransferTlsError = null;
    return { cert, key };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    globalForTransfer.__gsmFileTransferTlsError = `Could not read the TLS certificate or key: ${message}`;
    log.warn(globalForTransfer.__gsmFileTransferTlsError);
    return null;
  }
}

/**
 * Translate server events into the panel's log and audit trail.
 *
 * Uploads, deletes, renames and logins are audited; downloads are only logged.
 * A busy server pulling world files every night would otherwise bury every
 * other audit entry.
 */
function handleEvent(event: FtpEvent): void {
  const who = event.username ?? "unknown";
  switch (event.type) {
    case "login":
      log.info(`${who} logged in from ${event.ip ?? "unknown"}`);
      void recordTransferAudit({
        userId: event.userId ?? null,
        action: "file_transfer.login",
        details: { username: who },
        ip: event.ip ?? "unknown",
      });
      return;
    case "login-failed":
      log.warn(`failed login for "${who}" from ${event.ip ?? "unknown"}`);
      void recordTransferAudit({
        userId: null,
        action: "file_transfer.login_failed",
        details: { username: event.username ?? "unknown" },
        ip: event.ip ?? "unknown",
      });
      return;
    case "upload":
      if (!event.ok) return;
      log.info(`${who} uploaded ${event.bytes ?? 0} bytes to ${event.path ?? "?"}`);
      void recordTransferAudit({
        userId: event.userId ?? null,
        action: "file_transfer.upload",
        serverId: event.serverId ?? null,
        details: { path: event.path, bytes: event.bytes, username: who },
        ip: event.ip ?? "unknown",
      });
      return;
    case "download":
      log.debug(`${who} downloaded ${event.path ?? "?"} (${event.bytes ?? 0} bytes)`);
      return;
    case "delete":
      log.info(`${who} deleted ${event.path ?? "?"}`);
      void recordTransferAudit({
        userId: event.userId ?? null,
        action: "file_transfer.delete",
        serverId: event.serverId ?? null,
        details: { path: event.path, username: who },
        ip: event.ip ?? "unknown",
      });
      return;
    case "mkdir":
      log.info(`${who} created ${event.path ?? "?"}`);
      void recordTransferAudit({
        userId: event.userId ?? null,
        action: "file_transfer.mkdir",
        serverId: event.serverId ?? null,
        details: { path: event.path, username: who },
        ip: event.ip ?? "unknown",
      });
      return;
    case "rename":
      log.info(`${who} renamed to ${event.path ?? "?"}`);
      void recordTransferAudit({
        userId: event.userId ?? null,
        action: "file_transfer.rename",
        serverId: event.serverId ?? null,
        details: { path: event.path, username: who },
        ip: event.ip ?? "unknown",
      });
      return;
    case "disconnect":
      log.debug(`${who} disconnected from ${event.ip ?? "unknown"}`);
      return;
    default:
      return;
  }
}

/**
 * Build (but do not start) the server for the current settings.
 *
 * Login is wrapped with the panel's existing failed-login throttle, keyed per
 * client address: the FTP port is internet-facing, so it gets the same brute
 * force protection as the login form rather than a private counter of its own.
 */
async function buildServer(settings: TransferSettings): Promise<FtpServer> {
  const tls = await readTlsMaterial(settings);
  return new FtpServer({
    host: settings.bindHost,
    port: settings.port,
    passivePortMin: settings.passiveMin,
    passivePortMax: settings.passiveMax,
    masqueradeHost: settings.masqueradeHost,
    passiveAdvertisedPort: settings.advertisedPort || null,
    tls,
    maxUploadBytes: settings.maxUploadMb > 0 ? settings.maxUploadMb * 1024 * 1024 : 0,
    idleTimeoutMs: settings.idleTimeoutSeconds * 1000,
    maxConnections: settings.maxConnections,
    maxConnectionsPerUser: Math.min(8, settings.maxConnections),
    authenticate: async (username, password, context) => {
      const throttleKey = `ftp:${context.ip}`;
      const wait = loginRetryAfter(throttleKey);
      if (wait > 0) {
        log.warn(`refused a login from ${context.ip} — throttled for another ${wait}s`);
        return null;
      }
      const session = await authenticateTransferLogin(username, password, context);
      if (!session) {
        recordFailedLogin(throttleKey);
        return null;
      }
      clearFailedLogins(throttleKey);
      return session;
    },
    onLoginFailure: (ip) => {
      // The per-connection attempt counter already cuts the connection off; the
      // shared throttle is fed by the authenticate wrapper above.
      log.debug(`login attempt rejected from ${ip}`);
    },
    onEvent: handleEvent,
  });
}

/**
 * Start (or restart) the listener from the current settings.
 *
 * Returns the live stats, or null when the transfer server is disabled or
 * cannot bind. Never throws: callers are boot hooks and HTTP handlers.
 */
export async function startFileTransferService(force = false): Promise<FtpServerStats | null> {
  if (globalForTransfer.__gsmFileTransferStarting) return globalForTransfer.__gsmFileTransferStarting;

  const run = async (): Promise<FtpServerStats | null> => {
    const settings = await loadTransferSettings();
    const existing = globalForTransfer.__gsmFileTransfer;
    if (existing && !force) return existing.server.stats();

    if (existing) {
      await existing.server.stop();
      globalForTransfer.__gsmFileTransfer = undefined;
    }

    if (!settings.enabled) {
      globalForTransfer.__gsmFileTransferError = null;
      log.info("file transfer is disabled — not listening");
      return null;
    }

    const server = await buildServer(settings);
    try {
      await server.start();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      globalForTransfer.__gsmFileTransferError = `Could not listen on ${settings.bindHost}:${settings.port} — ${message}`;
      log.warn(globalForTransfer.__gsmFileTransferError);
      return null;
    }

    globalForTransfer.__gsmFileTransfer = { server, settings };
    globalForTransfer.__gsmFileTransferError = null;
    log.info(
      `FTP listening on ${settings.bindHost}:${settings.port} (passive ${settings.passiveMin}-${settings.passiveMax}` +
        `${settings.masqueradeHost ? `, advertised as ${settings.masqueradeHost}` : ""}${server.config.tls ? ", FTPS enabled" : ""})`
    );
    return server.stats();
  };

  const pending = run().finally(() => {
    globalForTransfer.__gsmFileTransferStarting = undefined;
  });
  globalForTransfer.__gsmFileTransferStarting = pending;
  return pending;
}

/** Stop the listener, if one is running. */
export async function stopFileTransferService(): Promise<void> {
  const existing = globalForTransfer.__gsmFileTransfer;
  globalForTransfer.__gsmFileTransfer = undefined;
  if (!existing) return;
  await existing.server.stop();
  log.info("file transfer stopped");
}

/** Apply a settings (or account) change without waiting for a restart. */
export async function restartFileTransferService(reason: string): Promise<FtpServerStats | null> {
  log.info(`restarting the file transfer server (${reason})`);
  return startFileTransferService(true);
}

/** Live stats for the panel, or null when nothing is listening. */
export function fileTransferStats(): FtpServerStats | null {
  return globalForTransfer.__gsmFileTransfer?.server.stats() ?? null;
}

/** The settings the running server was built from (may lag a saved change). */
export function fileTransferRuntimeSettings(): TransferSettings | null {
  return globalForTransfer.__gsmFileTransfer?.settings ?? null;
}

/** Bind/TLS failure to show in the UI instead of a silent no-op. */
export function fileTransferRuntimeError(): { error: string | null; tlsError: string | null } {
  return {
    error: globalForTransfer.__gsmFileTransferError ?? null,
    tlsError: globalForTransfer.__gsmFileTransferTlsError ?? null,
  };
}

/** Drop live sessions for an account (password rotation, revoke, disable). */
export function kickTransferSessions(username: string): number {
  return globalForTransfer.__gsmFileTransfer?.server.disconnectUser(username) ?? 0;
}
