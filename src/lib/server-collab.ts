/**
 * Server sharing / collaborators.
 *
 * An owner (or admin) can grant per-server access to other panel users:
 *   - viewer:   read-only — sees the server, may not control the process
 *   - operator: may start/stop/restart the server (no config, no delete)
 *
 * Pure role/access decisions live at the top so they are unit-tested; the
 * DB-dependent helpers are below them.
 */

export const COLLABORATOR_ROLES = ["viewer", "operator"] as const;
export type CollaboratorRole = (typeof COLLABORATOR_ROLES)[number];

export function isCollaboratorRole(v: unknown): v is CollaboratorRole {
  return typeof v === "string" && (COLLABORATOR_ROLES as readonly string[]).includes(v);
}

/** Effective access level for a user on a specific server. */
export type ServerAccess = "owner" | "operator" | "viewer" | "none";

export function resolveServerAccess(input: {
  isAdmin: boolean;
  isOwner: boolean;
  collaboratorRole: CollaboratorRole | null;
}): ServerAccess {
  // Admins and owners get full control regardless of any collaborator row.
  if (input.isAdmin || input.isOwner) return "owner";
  if (input.collaboratorRole === "operator") return "operator";
  if (input.collaboratorRole === "viewer") return "viewer";
  return "none";
}

export function accessCanView(access: ServerAccess): boolean {
  return access !== "none";
}

/** Only operator-and-above may start/stop/restart the process. */
export function accessCanControl(access: ServerAccess): boolean {
  return access === "owner" || access === "operator";
}

/** Only owner-level may change sharing, config, or delete the server. */
export function accessCanManage(access: ServerAccess): boolean {
  return access === "owner";
}

/**
 * May this user put files on this server — over FTP or the file manager?
 *
 * Deliberately NOT "any collaborator": sharing a server for watching it (a
 * viewer) or for start/stop (an operator) must not silently hand over the
 * disk. The per-server `canTransfer` flag is the grant, and the owner always
 * has it. Panel-wide authority (`transfer.any`) is checked by the caller, which
 * is the only way to reach servers that were never shared.
 */
export function accessCanTransfer(access: ServerAccess, collaboratorCanTransfer: boolean): boolean {
  if (access === "owner") return true;
  return collaboratorCanTransfer;
}

/** One server a user may reach, and what they may do with it. */
export interface CollaboratorGrant {
  role: CollaboratorRole;
  /** Per-server file-transfer grant (FTP + the panel file manager). */
  canTransfer: boolean;
}

// ── DB helpers ──────────────────────────────────────────────────────────────

/** Idempotent — upgrades predate the table. */
export async function ensureServerCollaboratorsTable(): Promise<void> {
  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS server_collaborators (
      id SERIAL PRIMARY KEY,
      server_id INTEGER NOT NULL REFERENCES game_servers(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role VARCHAR(16) NOT NULL DEFAULT 'viewer',
      granted_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (server_id, user_id)
    )
  `);
  // File transfer is granted per server. Additive and defaulted off, so an
  // existing sharing row keeps exactly the access it had before.
  await db.execute(sql`ALTER TABLE server_collaborators ADD COLUMN IF NOT EXISTS can_transfer BOOLEAN NOT NULL DEFAULT FALSE`);
}

/** This user's collaborator grant on a server (role + transfer flag), or null. */
export async function getCollaboratorGrant(
  serverId: number,
  userId: number | string
): Promise<CollaboratorGrant | null> {
  const { db } = await import("@/db");
  const { serverCollaborators } = await import("@/db/schema");
  const { eq, and } = await import("drizzle-orm");
  await ensureServerCollaboratorsTable();
  const [row] = await db
    .select({ role: serverCollaborators.role, canTransfer: serverCollaborators.canTransfer })
    .from(serverCollaborators)
    .where(and(eq(serverCollaborators.serverId, serverId), eq(serverCollaborators.userId, Number(userId))))
    .limit(1);
  if (!row) return null;
  if (!isCollaboratorRole(row.role)) return null;
  return { role: row.role, canTransfer: row.canTransfer === true };
}

/** This user's collaborator role on a server, or null if they have none. */
export async function getCollaboratorRole(
  serverId: number,
  userId: number | string
): Promise<CollaboratorRole | null> {
  const { db } = await import("@/db");
  const { serverCollaborators } = await import("@/db/schema");
  const { eq, and } = await import("drizzle-orm");
  await ensureServerCollaboratorsTable();
  const [row] = await db
    .select({ role: serverCollaborators.role })
    .from(serverCollaborators)
    .where(and(eq(serverCollaborators.serverId, serverId), eq(serverCollaborators.userId, Number(userId))))
    .limit(1);
  if (!row) return null;
  return isCollaboratorRole(row.role) ? row.role : null;
}

/** Ids of servers shared with this user (they are a collaborator on them). */
export async function sharedServerIdsFor(userId: number | string): Promise<number[]> {
  const { db } = await import("@/db");
  const { serverCollaborators } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  await ensureServerCollaboratorsTable();
  const rows = await db
    .select({ serverId: serverCollaborators.serverId })
    .from(serverCollaborators)
    .where(eq(serverCollaborators.userId, Number(userId)));
  return rows.map((r) => r.serverId);
}

async function hasPermission(
  userId: number,
  permission: string,
  keyScope: import("./key-scope").KeyScope
): Promise<boolean> {
  const { hasPermission: check } = await import("@/lib/permissions");
  return check(userId, permission, keyScope);
}

/** Ids of servers this user may transfer files to, because they were shared. */
export async function transferSharedServerIdsFor(userId: number | string): Promise<number[]> {
  const { db } = await import("@/db");
  const { serverCollaborators } = await import("@/db/schema");
  const { eq, and } = await import("drizzle-orm");
  await ensureServerCollaboratorsTable();
  const rows = await db
    .select({ serverId: serverCollaborators.serverId })
    .from(serverCollaborators)
    .where(and(eq(serverCollaborators.userId, Number(userId)), eq(serverCollaborators.canTransfer, true)));
  return rows.map((r) => r.serverId);
}

/**
 * The one question every file path asks: may this user transfer files to this
 * server?
 *
 *   owner                                  -> yes
 *   per-server grant (can_transfer)        -> yes
 *   `transfer.any` (panel-wide authority)  -> yes, every server
 *   anything else                          -> no
 *
 * `keyScope` is threaded so a scoped API key cannot widen this: a key that
 * lists `transfer.any` keeps it, a key that does not gets its owner's
 * per-server grants at most. There is no "all servers by accident" path — a
 * global `servers.edit` deliberately does NOT appear here, so an operator role
 * can no longer reach every disk through the FTP door.
 */
export async function canTransferToServer(
  serverId: number,
  userId: number,
  keyScope: import("./key-scope").KeyScope
): Promise<boolean> {
  if (!Number.isInteger(serverId) || serverId <= 0) return false;
  // Panel-wide authority first: it is cheap and covers the admin case.
  if (await hasPermission(userId, "transfer.any", keyScope)) return true;

  const { db } = await import("@/db");
  const { gameServers, serverCollaborators } = await import("@/db/schema");
  const { eq, and } = await import("drizzle-orm");
  await ensureServerCollaboratorsTable();

  const [server] = await db
    .select({ userId: gameServers.userId })
    .from(gameServers)
    .where(eq(gameServers.id, serverId))
    .limit(1);
  if (!server) return false;
  if (server.userId === userId) return true;

  const [grant] = await db
    .select({ canTransfer: serverCollaborators.canTransfer })
    .from(serverCollaborators)
    .where(and(eq(serverCollaborators.serverId, serverId), eq(serverCollaborators.userId, userId)))
    .limit(1);
  return accessCanTransfer("viewer", grant?.canTransfer === true);
}
