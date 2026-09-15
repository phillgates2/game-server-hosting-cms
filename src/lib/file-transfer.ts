/**
 * File-transfer accounts, settings and login decisions (FTP/FTPS).
 *
 * The FTP server itself (src/lib/ftp-server.ts) knows nothing about the panel:
 * it takes an `authenticate` callback and a list of virtual folders. This
 * module is the other half — who may connect, which servers appear under their
 * root, how the server is configured, and what gets written to the audit log.
 *
 * Access model (identical to the web file manager, deliberately):
 *
 *   - the account owner sees the servers they own,
 *   - a user holding `servers.edit` sees every server on a **local** node,
 *   - a scoped account (`alice.12`) sees exactly one server, rooted at its
 *     install path with no wrapper folder.
 *
 * Remote-node servers are excluded: the FTP server runs inside the panel and
 * cannot write to another machine's disk. Those stay reachable through the
 * node agent's file manager.
 */

import { eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, ftpAccounts, gameServers, nodes, settings, users } from "@/db/schema";
import { hasPermission } from "@/lib/permissions";
import { createLogger } from "@/lib/logger";
import { generateTransferPassword, decryptSecret, encryptSecret, secretsMatch } from "@/lib/secret-box";
import type { FtpVirtualFolder, FtpSession } from "@/lib/ftp-server";

const log = createLogger("transfer");

// ── Settings ────────────────────────────────────────────────────────────────

/** `settings` keys the operator can set from the panel (they beat the env). */
export const TRANSFER_SETTING_KEYS = [
  "ftp_enabled",
  "ftp_port",
  "ftp_bind_host",
  "ftp_masquerade_host",
  "ftp_passive_min",
  "ftp_passive_max",
  "ftp_advertised_port",
  "ftp_tls_cert",
  "ftp_tls_key",
  "ftp_idle_timeout",
  "ftp_max_connections",
  "ftp_max_upload_mb",
] as const;

export type TransferSettingKey = (typeof TRANSFER_SETTING_KEYS)[number];

export const FTP_DEFAULT_PORT = 2121;
export const FTP_DEFAULT_PASSIVE_MIN = 50000;
export const FTP_DEFAULT_PASSIVE_MAX = 50100;
export const FTP_DEFAULT_IDLE_TIMEOUT = 300;
export const FTP_DEFAULT_MAX_CONNECTIONS = 64;

export interface TransferSettings {
  enabled: boolean;
  /** Control port. 2121 by default: 21 needs root and collides with a host sshd-era vsftpd. */
  port: number;
  bindHost: string;
  /** Public name/IP announced in PASV replies; "" = the control socket's own address. */
  masqueradeHost: string;
  passiveMin: number;
  passiveMax: number;
  /** Optional DNAT rewrite of the passive port advertised to clients. */
  advertisedPort: number;
  tlsCertPath: string;
  tlsKeyPath: string;
  idleTimeoutSeconds: number;
  maxConnections: number;
  /** Per-upload cap in MB; 0 = no cap (the point of the feature). */
  maxUploadMb: number;
}

/** Bounds for each numeric field, enforced on save and on env parsing. */
export const TRANSFER_SETTING_BOUNDS: Record<string, { min: number; max: number; label: string }> = {
  ftp_port: { min: 1, max: 65535, label: "FTP port" },
  ftp_passive_min: { min: 1024, max: 65535, label: "Passive range start" },
  ftp_passive_max: { min: 1024, max: 65535, label: "Passive range end" },
  ftp_advertised_port: { min: 0, max: 65535, label: "Advertised passive port" },
  ftp_idle_timeout: { min: 30, max: 86400, label: "Idle timeout" },
  ftp_max_connections: { min: 1, max: 1000, label: "Connection limit" },
  ftp_max_upload_mb: { min: 0, max: 1024 * 1024, label: "Upload limit" },
};

const BOOLEAN_KEYS: Record<string, string> = { ftp_enabled: "File transfer" };
const STRING_KEYS: Record<string, string> = {
  ftp_bind_host: "Bind address",
  ftp_masquerade_host: "Advertised host",
  ftp_tls_cert: "TLS certificate path",
  ftp_tls_key: "TLS key path",
};

/** Parse `GSM_FTP_PASSIVE_PORTS=50000-50100` (or `50000`). */
export function parsePassiveRange(input: string | undefined): { min: number; max: number } | null {
  const raw = (input ?? "").trim();
  if (raw === "") return null;
  const match = raw.match(/^(\d{2,5})\s*(?:-\s*(\d{2,5}))?$/);
  if (!match) return null;
  const min = Number.parseInt(match[1], 10);
  const max = match[2] ? Number.parseInt(match[2], 10) : min;
  if (!Number.isInteger(min) || !Number.isInteger(max)) return null;
  if (min < 1024 || max > 65535 || min > max) return null;
  return { min, max };
}

/** Clamp a stored/env number into its bounds, falling back when nonsense. */
function boundedNumber(key: string, value: unknown, fallback: number): number {
  const bounds = TRANSFER_SETTING_BOUNDS[key];
  const n = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (!bounds) return n;
  if (n < bounds.min || n > bounds.max) return fallback;
  return n;
}

/** Validate one operator-supplied setting value (mirrors panel-settings.ts). */
export function validateTransferSetting(
  key: string,
  value: unknown
): { value: string; error: null } | { value: null; error: string } {
  if (!(TRANSFER_SETTING_KEYS as readonly string[]).includes(key)) {
    return { value: null, error: `Unknown setting: ${key}` };
  }
  if (key in BOOLEAN_KEYS) {
    if (typeof value === "boolean") return { value: String(value), error: null };
    if (value === "true" || value === "false") return { value: String(value), error: null };
    return { value: null, error: `${BOOLEAN_KEYS[key]} must be on or off` };
  }
  if (key in STRING_KEYS) {
    const raw = typeof value === "string" ? value.trim() : "";
    if (raw.length > 512) return { value: null, error: `${STRING_KEYS[key]} is too long` };
    if (/\s/.test(raw)) return { value: null, error: `${STRING_KEYS[key]} cannot contain spaces` };
    return { value: raw, error: null };
  }
  const bounds = TRANSFER_SETTING_BOUNDS[key];
  const n = Number(value);
  if (!Number.isInteger(n)) {
    return { value: null, error: `${bounds.label} must be a whole number` };
  }
  if (n < bounds.min || n > bounds.max) {
    return { value: null, error: `${bounds.label} must be between ${bounds.min} and ${bounds.max}` };
  }
  return { value: String(n), error: null };
}

/**
 * Merge the environment defaults with any stored overrides.
 *
 * The same precedence the Discord and panel settings use: the environment is
 * the base layer, a `settings` row wins, so an operator can change behaviour
 * without editing `.env` and restarting systemd.
 */
export function transferSettingsFromRows(
  rows: ReadonlyArray<{ key: string; value: string | null }>,
  env: Readonly<Record<string, string | undefined>> = process.env
): TransferSettings {
  const stored = new Map(rows.map((r) => [r.key, r.value]));
  const pick = (key: string): string | null => {
    const row = stored.get(key);
    if (row !== undefined && row !== null && row !== "") return row;
    return null;
  };
  const envRange = parsePassiveRange(env.GSM_FTP_PASSIVE_PORTS);

  const enabled = pick("ftp_enabled") !== null
    ? pick("ftp_enabled") === "true"
    : env.GSM_DISABLE_FTP === "true"
      ? false
      : env.GSM_FTP_ENABLED !== "false";

  return {
    enabled,
    port: boundedNumber("ftp_port", pick("ftp_port") ?? env.GSM_FTP_PORT, FTP_DEFAULT_PORT),
    bindHost: pick("ftp_bind_host") || env.GSM_FTP_BIND || "0.0.0.0",
    masqueradeHost: pick("ftp_masquerade_host") || env.GSM_FTP_MASQUERADE_HOST || "",
    passiveMin: boundedNumber("ftp_passive_min", pick("ftp_passive_min"), envRange?.min ?? FTP_DEFAULT_PASSIVE_MIN),
    passiveMax: boundedNumber("ftp_passive_max", pick("ftp_passive_max"), envRange?.max ?? FTP_DEFAULT_PASSIVE_MAX),
    advertisedPort: boundedNumber("ftp_advertised_port", pick("ftp_advertised_port"), 0),
    tlsCertPath: pick("ftp_tls_cert") || env.GSM_FTP_TLS_CERT || "",
    tlsKeyPath: pick("ftp_tls_key") || env.GSM_FTP_TLS_KEY || "",
    idleTimeoutSeconds: boundedNumber(
      "ftp_idle_timeout",
      pick("ftp_idle_timeout") ?? env.GSM_FTP_IDLE_TIMEOUT,
      FTP_DEFAULT_IDLE_TIMEOUT
    ),
    maxConnections: boundedNumber(
      "ftp_max_connections",
      pick("ftp_max_connections") ?? env.GSM_FTP_MAX_CONNECTIONS,
      FTP_DEFAULT_MAX_CONNECTIONS
    ),
    maxUploadMb: boundedNumber("ftp_max_upload_mb", pick("ftp_max_upload_mb") ?? env.GSM_FTP_MAX_UPLOAD_MB, 0),
  };
}

/** Read the effective settings (stored rows over environment defaults). */
export async function loadTransferSettings(): Promise<TransferSettings> {
  try {
    const rows = await db
      .select({ key: settings.key, value: settings.value })
      .from(settings)
      .where(inArray(settings.key, TRANSFER_SETTING_KEYS as unknown as string[]));
    return transferSettingsFromRows(rows);
  } catch {
    // No database (or no settings table yet): the environment still decides.
    return transferSettingsFromRows([]);
  }
}

/** Which settings are pinned by the environment (shown in the UI). */
export function transferSettingsFromEnvOnly(
  env: Readonly<Record<string, string | undefined>> = process.env
): TransferSettings {
  return transferSettingsFromRows([], env);
}

// ── Usernames and folder names ──────────────────────────────────────────────

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]$/;

/** Is this a well-formed transfer username (panel side, not the client's)? */
export function isValidTransferUsername(value: unknown): value is string {
  return typeof value === "string" && USERNAME_RE.test(value);
}

/**
 * Derive a transfer username from a panel username.
 *
 * Panels allow spaces, dots and non-ASCII in usernames; FTP clients (and the
 * `user:pass@host` URL form) do not. Uniqueness is enforced by the table, so
 * the caller retries with a numeric suffix rather than losing the login.
 */
export function transferUsernameFor(panelUsername: string, serverId: number | null = null, attempt = 0): string {
  const base = (panelUsername || "user")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 48) || "user";
  const suffix = attempt > 0 ? `-${attempt + 1}` : "";
  return serverId ? `${base}${suffix}.${serverId}` : `${base}${suffix}`;
}

/**
 * The folder a server occupies under a multi-server root.
 *
 * The id suffix guarantees uniqueness (two servers may share a name) and makes
 * it obvious to the operator which panel server a folder belongs to.
 */
export function folderNameFor(server: { id: number; name: string; gameSlug?: string | null }): string {
  const base = (server.name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  if (base === "") {
    const game = (server.gameSlug ?? "").replace(/[^a-z0-9-]/gi, "").slice(0, 24);
    return `${game || "server"}-${server.id}`;
  }
  return `${base}-${server.id}`;
}

// ── Schema ──────────────────────────────────────────────────────────────────

/**
 * Create the credential table if it is missing.
 *
 * Same lazy-create pattern the collaborators, licences and shop tables use:
 * panels built before this feature existed never run `drizzle-kit push`, so a
 * migration that only lives in the ORM schema would leave those installs with
 * a "relation does not exist" error the moment somebody opens the panel.
 */
export async function ensureFtpAccountsTable(): Promise<void> {
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS ftp_accounts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      username VARCHAR(64) NOT NULL UNIQUE,
      password_encrypted TEXT NOT NULL,
      server_id INTEGER REFERENCES game_servers(id) ON DELETE CASCADE,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      last_login_at TIMESTAMP,
      last_login_ip VARCHAR(64)
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS ftp_accounts_user_idx ON ftp_accounts (user_id)`);
}

export interface TransferAccount {
  id: number;
  userId: number;
  username: string;
  serverId: number | null;
  enabled: boolean;
  createdAt: Date;
  lastLoginAt: Date | null;
  lastLoginIp: string | null;
  /** False when the stored password can no longer be decrypted (key rotated). */
  readable: boolean;
  password: string | null;
}

function toAccountView(row: typeof ftpAccounts.$inferSelect): TransferAccount {
  const password = decryptSecret(row.passwordEncrypted);
  return {
    id: row.id,
    userId: row.userId,
    username: row.username,
    serverId: row.serverId ?? null,
    enabled: row.enabled ?? true,
    createdAt: row.createdAt,
    lastLoginAt: row.lastLoginAt ?? null,
    lastLoginIp: row.lastLoginIp ?? null,
    readable: password !== null,
    password,
  };
}

// ── Accounts ────────────────────────────────────────────────────────────────

export async function listAccountsForUser(userId: number): Promise<TransferAccount[]> {
  await ensureFtpAccountsTable();
  const rows = await db.select().from(ftpAccounts).where(eq(ftpAccounts.userId, userId));
  return rows.map(toAccountView).sort((a, b) => a.username.localeCompare(b.username));
}

export async function listAllAccounts(): Promise<
  Array<TransferAccount & { ownerUsername: string | null; serverName: string | null }>
> {
  await ensureFtpAccountsTable();
  const rows = await db
    .select({
      account: ftpAccounts,
      ownerUsername: users.username,
      serverName: gameServers.name,
    })
    .from(ftpAccounts)
    .leftJoin(users, eq(ftpAccounts.userId, users.id))
    .leftJoin(gameServers, eq(ftpAccounts.serverId, gameServers.id));
  return rows
    .map((r) => ({
      ...toAccountView(r.account),
      ownerUsername: r.ownerUsername ?? null,
      serverName: r.serverName ?? null,
    }))
    .sort((a, b) => a.username.localeCompare(b.username));
}

async function insertAccount(userId: number, serverId: number | null, password: string): Promise<TransferAccount> {
  const { username: panelName } = await lookupPanelUsername(userId);
  for (let attempt = 0; attempt < 25; attempt++) {
    const username = transferUsernameFor(panelName, serverId, attempt);
    if (!isValidTransferUsername(username)) continue;
    try {
      const [row] = await db
        .insert(ftpAccounts)
        .values({
          userId,
          username,
          serverId,
          passwordEncrypted: encryptSecret(password),
        })
        .returning();
      return toAccountView(row);
    } catch (error: unknown) {
      const code = (error as { code?: string }).code;
      // 23505 = unique violation: this name is taken, try the next suffix.
      if (code === "23505") continue;
      throw error;
    }
  }
  throw new Error("Could not allocate a unique transfer username");
}

async function lookupPanelUsername(userId: number): Promise<{ username: string }> {
  const [row] = await db.select({ username: users.username }).from(users).where(eq(users.id, userId)).limit(1);
  return { username: row?.username ?? `user${userId}` };
}

/**
 * The account every user gets automatically: one login, every server they may
 * file-manage. Created on first view of the transfer panel, so a fresh install
 * needs no provisioning step.
 */
export async function ensureAccountForUser(userId: number): Promise<TransferAccount> {
  const existing = await listAccountsForUser(userId);
  const general = existing.find((a) => a.serverId === null);
  if (general) return general;
  return insertAccount(userId, null, generateTransferPassword());
}

/** A login scoped to a single server, rooted at its install path. */
export async function ensureServerAccount(userId: number, serverId: number): Promise<TransferAccount> {
  const existing = await listAccountsForUser(userId);
  const scoped = existing.find((a) => a.serverId === serverId);
  if (scoped) return scoped;
  return insertAccount(userId, serverId, generateTransferPassword());
}

/** Replace the password, returning the plaintext exactly once to the caller. */
export async function rotateAccountPassword(accountId: number): Promise<TransferAccount | null> {
  await ensureFtpAccountsTable();
  const password = generateTransferPassword();
  const [row] = await db
    .update(ftpAccounts)
    .set({ passwordEncrypted: encryptSecret(password), enabled: true })
    .where(eq(ftpAccounts.id, accountId))
    .returning();
  return row ? toAccountView(row) : null;
}

export async function setAccountEnabled(accountId: number, enabled: boolean): Promise<boolean> {
  await ensureFtpAccountsTable();
  const rows = await db.update(ftpAccounts).set({ enabled }).where(eq(ftpAccounts.id, accountId)).returning();
  return rows.length > 0;
}

export async function deleteAccount(accountId: number): Promise<boolean> {
  await ensureFtpAccountsTable();
  const rows = await db.delete(ftpAccounts).where(eq(ftpAccounts.id, accountId)).returning();
  return rows.length > 0;
}

export async function findAccountByUsername(username: string): Promise<TransferAccount | null> {
  await ensureFtpAccountsTable();
  const [row] = await db
    .select()
    .from(ftpAccounts)
    .where(eq(ftpAccounts.username, username.trim().toLowerCase()))
    .limit(1);
  return row ? toAccountView(row) : null;
}

// ── Which servers a login may see ───────────────────────────────────────────

/**
 * Folders for a user's virtual root.
 *
 * Access is decided per server, never globally:
 *
 *   - a server the user owns,
 *   - a server shared with them **with file transfer enabled** (the per-server
 *     grant an owner sets in Sharing),
 *   - every server only for `transfer.any` (panel-wide transfer authority).
 *
 * `servers.edit` deliberately does not appear: an operator role that may edit
 * settings on every server must still be handed a server before FTP will serve
 * its disk. That is the difference between "may administer" and "may upload".
 *
 * A server is included only when it lives on the panel's own machine — the FTP
 * server cannot write to a remote node's disk, and pretending otherwise would
 * list a folder whose contents are invisible.
 */
export async function foldersForUser(userId: number): Promise<FtpVirtualFolder[]> {
  const seesAll = await hasPermission(userId, "transfer.any", null);
  const { transferSharedServerIdsFor } = await import("@/lib/server-collab");
  const sharedIds = seesAll ? [] : await transferSharedServerIdsFor(userId);

  // An empty IN () is invalid SQL, so the predicate is built per case.
  const scope = seesAll
    ? undefined
    : sharedIds.length > 0
      ? or(eq(gameServers.userId, userId), inArray(gameServers.id, sharedIds))
      : eq(gameServers.userId, userId);

  const rows = await db
    .select({
      id: gameServers.id,
      name: gameServers.name,
      userId: gameServers.userId,
      installPath: gameServers.installPath,
      nodeIsLocal: nodes.isLocal,
      gameSlug: sql<string | null>`(SELECT gd.slug FROM game_definitions gd WHERE gd.id = ${gameServers.gameId})`,
    })
    .from(gameServers)
    .leftJoin(nodes, eq(gameServers.nodeId, nodes.id))
    .where(scope);

  return rows
    .filter((row) => row.nodeIsLocal !== false && Boolean(row.installPath))
    .map((row) => ({
      name: folderNameFor({ id: row.id, name: row.name, gameSlug: row.gameSlug }),
      absPath: row.installPath,
      serverId: row.id,
      label: row.name,
      /** Not owned: reached through a per-server grant. */
      shared: row.userId !== userId,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ── Login ───────────────────────────────────────────────────────────────────

export interface TransferLoginContext {
  ip: string;
}

/**
 * Decide an FTP login: credentials, account state, permission, and the folder
 * list to expose. Returning null is the only "no" — the server reports a generic
 * 530 so a failed login never reveals which half was wrong.
 */
export async function authenticateTransferLogin(
  username: string,
  password: string,
  context: TransferLoginContext
): Promise<FtpSession | null> {
  const account = await findAccountByUsername(username);
  if (!account || !account.enabled) return null;

  const stored = account.password;
  if (stored === null) {
    log.warn(
      `account "${account.username}" cannot be decrypted (secret rotated?) — rotate its password to restore access`
    );
    return null;
  }
  if (!secretsMatch(password, stored)) return null;

  const [owner] = await db
    .select({ id: users.id, status: users.status })
    .from(users)
    .where(eq(users.id, account.userId))
    .limit(1);
  if (!owner || owner.status !== "active") return null;
  // `transfer.view` is the "may use file transfer" key: revoking it stops the
  // panel *and* every login the account holds, which is what an operator
  // revoking access means. `transfer.manage` only decides who may mint and
  // re-key credentials, so taking that away leaves a working login alone.
  // The permission is checked against the owner, not the caller: an FTP login
  // is used with a password, never with an API key, so there is no key scope.
  if (!(await hasPermission(owner.id, "transfer.view", null))) return null;

  let folders = await foldersForUser(owner.id);
  const rootedAtServer = account.serverId !== null;
  if (rootedAtServer) {
    folders = folders.filter((f) => f.serverId === account.serverId);
  }
  // Nothing to serve: a suspended owner, a revoked permission, a deleted
  // server, or only remote-node servers.
  if (folders.length === 0) return null;

  try {
    await db
      .update(ftpAccounts)
      .set({ lastLoginAt: new Date(), lastLoginIp: context.ip.slice(0, 64) })
      .where(eq(ftpAccounts.id, account.id));
  } catch {
    // The login itself already succeeded; a failed bookkeeping write (a
    // read-only replica, say) must not turn into a refused login.
  }

  return {
    accountId: account.id,
    username: account.username,
    userId: owner.id,
    folders,
    rootedAtServer,
  };
}

/** Write one audit row (best-effort: auditing never fails an operation). */
export async function recordTransferAudit(entry: {
  userId: number | null;
  action: string;
  serverId?: number | null;
  details: Record<string, unknown>;
  ip: string;
}): Promise<void> {
  try {
    await db.insert(auditLog).values({
      userId: entry.userId ?? null,
      action: entry.action,
      entityType: entry.serverId ? "server" : "file_transfer",
      entityId: entry.serverId ?? null,
      details: entry.details,
      ipAddress: entry.ip.slice(0, 45),
    });
  } catch {
    // Never let the audit trail break a transfer.
  }
}

// ── Presentation helpers (pure, shared with the panel UI) ───────────────────

/** What the operator needs to see about the configured listener. */
export interface TransferSettingsSummary {
  enabled: boolean;
  port: number;
  bindHost: string;
  masqueradeHost: string;
  passiveMin: number;
  passiveMax: number;
  /** True when a certificate + key are configured (FTPS available). */
  ftps: boolean;
  tlsCertPath: string;
  tlsKeyPath: string;
  idleTimeoutSeconds: number;
  maxConnections: number;
  maxUploadMb: number;
  /** Every field an operator could still change from the panel. */
  editableKeys: readonly string[];
}

export function transferSettingsSummary(settings: TransferSettings): TransferSettingsSummary {
  return {
    enabled: settings.enabled,
    port: settings.port,
    bindHost: settings.bindHost,
    masqueradeHost: settings.masqueradeHost,
    passiveMin: settings.passiveMin,
    passiveMax: settings.passiveMax,
    ftps: Boolean(settings.tlsCertPath && settings.tlsKeyPath),
    tlsCertPath: settings.tlsCertPath,
    tlsKeyPath: settings.tlsKeyPath,
    idleTimeoutSeconds: settings.idleTimeoutSeconds,
    maxConnections: settings.maxConnections,
    maxUploadMb: settings.maxUploadMb,
    editableKeys: TRANSFER_SETTING_KEYS,
  };
}

/** Everything a client needs to connect, plus ready-made commands to copy. */
export interface TransferEndpoint {
  /** Host clients should use: the masquerade address, else the panel's own host. */
  host: string;
  port: number;
  /** True when the operator set an explicit advertised address. */
  advertised: boolean;
  passivePorts: string;
  /** Hostname only, no port — what an FTP client's "Host" field wants. */
  hostOnly: string;
  ftps: boolean;
  /** Shown as the fallback when FTPS is off. */
  insecure: boolean;
  maxUploadMb: number;
  /** Ready-to-paste examples for the panel UI. */
  curlExample: (username: string) => string;
  lftpExample: (username: string) => string;
}

/**
 * The endpoint to show a user.
 *
 * `requestHost` is the hostname the panel itself was requested through — behind
 * a reverse proxy that is the public name, which is exactly what an FTP client
 * should be told when no masquerade address is configured.
 */
export function describeTransferEndpoint(settings: TransferSettings, requestHost: string | null): TransferEndpoint {
  const hostOnly = (settings.masqueradeHost || (requestHost ?? "").split(":")[0] || "localhost").trim();
  const port = settings.port;
  return {
    host: `${hostOnly}:${port}`,
    hostOnly,
    port,
    advertised: Boolean(settings.masqueradeHost),
    passivePorts: `${settings.passiveMin}-${settings.passiveMax}`,
    ftps: Boolean(settings.tlsCertPath && settings.tlsKeyPath),
    insecure: !(settings.tlsCertPath && settings.tlsKeyPath),
    maxUploadMb: settings.maxUploadMb,
    curlExample: (username: string) =>
      `curl -T ./big-world.tar.gz -u '${username}:PASSWORD' ${settings.tlsCertPath ? "--ssl-reqd " : ""}ftp://${hostOnly}:${port}/`,
    lftpExample: (username: string) =>
      `lftp -u '${username},PASSWORD' ${settings.tlsCertPath ? "--use-ssl " : ""}${hostOnly}:${port} -e 'mirror -R ./world /survival-12/world; bye'`,
  };
}
