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
