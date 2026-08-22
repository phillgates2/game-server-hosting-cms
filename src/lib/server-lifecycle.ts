/**
 * Pure decision helpers for server lifecycle behaviour.
 *
 * The route handlers that own these decisions are database-backed, so importing
 * them from a unit test fails on the missing DATABASE_URL. The rules themselves
 * are pure, and both encode a bug that shipped once already, so they live here
 * where they can be tested directly.
 */

/** The Discord fields a clone inherits from its source. */
export interface CloneDiscordSource {
  /** Webhook URL stored on the source server, if any. */
  discordWebhook: string | null;
  /** Set when the panel created the source's channel via the bot API. */
  discordChannelId: string | null;
}

/**
 * Decide which webhook URL a clone should start life with.
 *
 * A panel-provisioned channel belongs to the source server: the clone must not
 * inherit it, because deleting the source deletes the channel and the clone
 * would be left posting into a webhook that 404s. The clone provisions its own
 * channel instead.
 *
 * A hand-entered webhook has no such ownership, so sharing it is intended.
 */
export function inheritedWebhook(source: CloneDiscordSource): string | null {
  return source.discordChannelId ? null : source.discordWebhook;
}

/**
 * Whether a clone should be given a freshly provisioned channel of its own.
 *
 * Only when it ended up with no webhook at all — an inherited hand-entered
 * webhook is left alone rather than being replaced.
 */
export function shouldProvisionForClone(
  cloneWebhook: string | null,
  cfg: { autoChannel: boolean; botToken: string | null; guildId: string | null }
): boolean {
  return !cloneWebhook && cfg.autoChannel && !!cfg.botToken && !!cfg.guildId;
}

/** State a status poll observed for one server. */
export interface CrashState {
  /** The status column as stored in the database. */
  status: string;
  /** Whether the recorded pid is still alive right now. */
  alive: boolean;
  /** Per-server "bring it back up automatically" toggle. */
  autoRestart: boolean | null;
}

/**
 * Whether a status poll has just observed a crash.
 *
 * A crash is specifically "the database says it is running, but the process is
 * gone" — a server that was deliberately stopped is not a crash.
 */
export function hasCrashed(state: Pick<CrashState, "status" | "alive">): boolean {
  return state.status === "running" && !state.alive;
}

/**
 * Whether a status poll should trigger an automatic restart.
 *
 * `inFlight` guards the case of several browser tabs polling at once: each
 * would otherwise observe the same crash and spawn its own replacement,
 * leaving an orphaned process holding the port.
 */
export function shouldAutoRestart(state: CrashState, inFlight: boolean): boolean {
  return hasCrashed(state) && !!state.autoRestart && !inFlight;
}

/**
 * Fields a client is allowed to change through PATCH /api/servers/[id].
 *
 * The handler used to spread the request body straight into the UPDATE, so a
 * caller holding `servers.edit` could rewrite anything in the row — including
 * `installPath`, which the process route feeds to a shell script, and `userId`,
 * which reassigns ownership. Everything not listed here is server-owned.
 */
export const SERVER_PATCH_FIELDS = [
  "name",
  "ipv4",
  "ipv6",
  "port",
  "queryPort",
  "rconPort",
  "status",
  "config",
  "variables",
  "autoRestart",
  "autoStart",
  "maxRamMb",
  "maxCpuPercent",
  "discordWebhook",
  "discordNotifyStart",
  "discordNotifyStop",
  "discordNotifyRestart",
  "discordNotifyCrash",
] as const;

export type ServerPatchField = (typeof SERVER_PATCH_FIELDS)[number];

/**
 * Keep only the client-writable fields of a PATCH body.
 *
 * Returns the accepted subset plus the names that were dropped, so the route
 * can reject an unknown field loudly rather than silently ignoring it.
 */
export function pickServerPatch(body: unknown): {
  updates: Record<string, unknown>;
  rejected: string[];
} {
  const updates: Record<string, unknown> = {};
  const rejected: string[] = [];
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { updates, rejected };
  }
  const allowed = new Set<string>(SERVER_PATCH_FIELDS);
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (value === undefined) continue;
    if (allowed.has(key)) updates[key] = value;
    else rejected.push(key);
  }
  return { updates, rejected };
}

/**
 * Node columns that are safe to send to a browser.
 *
 * The nodes table stores SSH credentials and a node API key. `db.select()` with
 * no projection returns all of them, so GET /api/nodes/[id] was handing the SSH
 * password for every machine to anyone with `nodes.view` — a permission the
 * built-in moderator role holds.
 */
export const NODE_PUBLIC_FIELDS = [
  "id",
  "name",
  "description",
  "hostname",
  "ipv4",
  "ipv6",
  "sshPort",
  "apiUrl",
  "maxServers",
  "maxRamMb",
  "maxDiskMb",
  "gameServerPath",
  "steamcmdPath",
  "status",
  "isLocal",
  "isDefault",
  "lastHeartbeat",
  "location",
  "provider",
  "tags",
  "createdAt",
  "updatedAt",
] as const;

/**
 * Columns a client may write through PATCH /api/nodes/[id].
 *
 * Credentials are deliberately included — an admin has to be able to set them —
 * but identity and panel-owned state are not.
 */
export const NODE_PATCH_FIELDS = [
  "name",
  "description",
  "hostname",
  "ipv4",
  "ipv6",
  "sshPort",
  "sshUser",
  "sshKeyPath",
  "sshPassword",
  "apiUrl",
  "apiKey",
  "maxServers",
  "maxRamMb",
  "maxDiskMb",
  "gameServerPath",
  "steamcmdPath",
  "isDefault",
  "location",
  "provider",
  "tags",
] as const;

/** Strip secret columns from a node row before it leaves the server. */
export function publicNode<T extends Record<string, unknown>>(node: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of NODE_PUBLIC_FIELDS) {
    if (key in node) out[key as keyof T] = node[key as keyof T];
  }
  return out;
}

/** Keep only the client-writable fields of a node PATCH body. */
export function pickNodePatch(body: unknown): {
  updates: Record<string, unknown>;
  rejected: string[];
} {
  const updates: Record<string, unknown> = {};
  const rejected: string[] = [];
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { updates, rejected };
  }
  const allowed = new Set<string>(NODE_PATCH_FIELDS);
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (value === undefined) continue;
    if (allowed.has(key)) updates[key] = value;
    else rejected.push(key);
  }
  return { updates, rejected };
}

/**
 * User columns that are safe to send to a browser.
 *
 * Mirrors the projection the user detail endpoint already used. The admin
 * PATCH did not use it: `.returning()` sends every column, so updating a user
 * echoed back their bcrypt hash and TOTP secret.
 */
export const USER_PUBLIC_FIELDS = [
  "id",
  "username",
  "email",
  "role",
  "roleId",
  "status",
  "avatarUrl",
  "bio",
  "location",
  "website",
  "themeConfig",
  "twoFactorEnabled",
  "maxServers",
  "lastLoginAt",
  "lastLoginIp",
  "loginCount",
  "createdAt",
  "updatedAt",
] as const;

/** Strip the password hash and TOTP secret from a user row. */
export function publicUser<T extends Record<string, unknown>>(user: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of USER_PUBLIC_FIELDS) {
    if (key in user) out[key as keyof T] = user[key as keyof T];
  }
  return out;
}

/**
 * Lowest port a game server may bind.
 *
 * Ports below 1024 need root on Linux, and the panel would be handing them out
 * to unprivileged users who cannot use them — while letting someone reserve 22
 * or 80 and collide with SSH or the web server.
 */
export const MIN_SERVER_PORT = 1024;
export const MAX_SERVER_PORT = 65535;

/**
 * Parse and validate a port supplied by a client.
 *
 * `Number(port)` alone accepts NaN, negatives, decimals and values past 65535,
 * all of which were reaching both the database and the `ufw` command line.
 * Returns null when the value is unusable.
 */
export function parsePort(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return null;
  const n = Number(value);
  if (!Number.isInteger(n)) return null;
  if (n < MIN_SERVER_PORT || n > MAX_SERVER_PORT) return null;
  return n;
}

/** Ports a server occupies, for collision checks. */
export interface PortTriple {
  port: number;
  queryPort?: number | null;
  rconPort?: number | null;
}

/** Every distinct port a server will occupy. */
export function occupiedPorts(p: PortTriple): number[] {
  const set = new Set<number>([p.port]);
  if (p.queryPort) set.add(p.queryPort);
  if (p.rconPort) set.add(p.rconPort);
  return [...set].sort((a, b) => a - b);
}

/**
 * Find ports that clash with those already taken on the same node.
 *
 * Nothing checked this, so two servers could be created on identical ports:
 * the second silently fails to bind at launch and reports itself "crashed"
 * with no indication of why.
 */
export function findPortConflicts(
  wanted: PortTriple,
  taken: readonly number[]
): number[] {
  const takenSet = new Set(taken);
  return occupiedPorts(wanted).filter((p) => takenSet.has(p));
}

/**
 * Validate the port triple for a create or update.
 *
 * Returns a human-readable error, or null when the ports are usable.
 */
export function validatePorts(
  raw: { port?: unknown; queryPort?: unknown; rconPort?: unknown },
  taken: readonly number[] = []
): { ports: PortTriple; error: null } | { ports: null; error: string } {
  const port = parsePort(raw.port);
  if (port === null) {
    return {
      ports: null,
      error: `Port must be a whole number between ${MIN_SERVER_PORT} and ${MAX_SERVER_PORT}`,
    };
  }

  let queryPort: number | null = null;
  if (raw.queryPort !== undefined && raw.queryPort !== null && raw.queryPort !== "") {
    queryPort = parsePort(raw.queryPort);
    if (queryPort === null) {
      return {
        ports: null,
        error: `Query port must be a whole number between ${MIN_SERVER_PORT} and ${MAX_SERVER_PORT}`,
      };
    }
  }

  let rconPort: number | null = null;
  if (raw.rconPort !== undefined && raw.rconPort !== null && raw.rconPort !== "") {
    rconPort = parsePort(raw.rconPort);
    if (rconPort === null) {
      return {
        ports: null,
        error: `RCON port must be a whole number between ${MIN_SERVER_PORT} and ${MAX_SERVER_PORT}`,
      };
    }
  }

  const wanted: PortTriple = { port, queryPort, rconPort };
  const conflicts = findPortConflicts(wanted, taken);
  if (conflicts.length) {
    return {
      ports: null,
      error: `Port ${conflicts.join(", ")} already in use on this node`,
    };
  }

  return { ports: wanted, error: null };
}

/**
 * Whether a user may create another server.
 *
 * `maxServers` is stored per user, editable by an admin holding `users.limits`,
 * and shown in the UI as "3/5" — but nothing enforced it, so the quota was
 * advisory and any user could create servers without limit.
 */
export function withinServerQuota(
  currentCount: number,
  maxServers: number | null | undefined
): boolean {
  if (maxServers === null || maxServers === undefined) return true;
  if (maxServers <= 0) return true; // 0 or negative = unlimited
  return currentCount < maxServers;
}

/**
 * Find the next free port triple at or after `from`.
 *
 * Used when cloning: the old code blindly took `source.port + 1`, which is
 * very likely already taken by the source's own query port. Erroring would be
 * a regression for a button that used to work, so search instead.
 *
 * Returns null when nothing is free below MAX_SERVER_PORT.
 */
export function nextFreePort(
  from: number,
  taken: readonly number[],
  span = 1
): number | null {
  const takenSet = new Set(taken);
  const start = Math.max(from, MIN_SERVER_PORT);
  for (let p = start; p + span - 1 <= MAX_SERVER_PORT; p++) {
    let free = true;
    for (let k = 0; k < span; k++) {
      if (takenSet.has(p + k)) {
        free = false;
        break;
      }
    }
    if (free) return p;
  }
  return null;
}

/**
 * Validate an API key permission scope supplied by a client.
 *
 * A scope is an object of `{ "permission.name": true }`. Anything else — an
 * array, a string, nested objects — would be stored and then silently deny
 * every request, which looks like a broken key rather than a rejected one.
 *
 * `null`/absent means "unrestricted" and is valid.
 */
export function validateKeyScope(
  value: unknown,
  knownPermissions: readonly string[]
): { scope: Record<string, boolean> | null; error: null } | { scope: null; error: string } {
  if (value === null || value === undefined) return { scope: null, error: null };
  if (typeof value !== "object" || Array.isArray(value)) {
    return { scope: null, error: "permissions must be an object of permission names to booleans" };
  }

  const known = new Set(knownPermissions);
  const out: Record<string, boolean> = {};
  const unknown: string[] = [];

  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v !== "boolean") {
      return { scope: null, error: `permissions.${key} must be true or false` };
    }
    if (!known.has(key)) {
      unknown.push(key);
      continue;
    }
    out[key] = v;
  }

  if (unknown.length) {
    return { scope: null, error: `Unknown permission(s): ${unknown.sort().join(", ")}` };
  }
  return { scope: out, error: null };
}
