/**
 * Scheduled maintenance windows: drain a node at a planned time and release
 * it automatically afterwards — no 6am alarm clocks to take a node out of
 * rotation, no forgetting to bring it back.
 *
 * Pure validation + transition logic live at the top (unit-tested); the
 * scheduler calls applyMaintenanceWindows on every tick.
 */

export const MAINTENANCE_WINDOW_MAX_HOURS = 24;
export const MAINTENANCE_REASON_MAX = 200;
/** Windows may start at most this far in the past (covers tick lag). */
export const MAINTENANCE_START_GRACE_MS = 15 * 60_000;

export type WindowPhase = "pending" | "active" | "expired";

/** Where a window sits relative to `nowMs`. Pure and boundary-exact. */
export function windowPhase(input: { startsAtMs: number; endsAtMs: number }, nowMs: number): WindowPhase {
  if (nowMs < input.startsAtMs) return "pending";
  if (nowMs < input.endsAtMs) return "active";
  return "expired";
}

export interface MaintenanceWindowValidation {
  ok: boolean;
  error?: string;
  value?: { nodeId: number; startsAt: Date; endsAt: Date; reason: string | null };
}

/** Validate + normalise a window payload from the API. */
export function validateMaintenanceWindowInput(body: unknown, nowMs: number): MaintenanceWindowValidation {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Invalid maintenance window payload" };
  }
  const b = body as Record<string, unknown>;

  const nodeId = Number(b.nodeId);
  if (!Number.isInteger(nodeId) || nodeId <= 0) {
    return { ok: false, error: "A valid nodeId is required" };
  }

  const startsAt = new Date(typeof b.startsAt === "string" || typeof b.startsAt === "number" ? b.startsAt : NaN);
  const endsAt = new Date(typeof b.endsAt === "string" || typeof b.endsAt === "number" ? b.endsAt : NaN);
  if (!Number.isFinite(startsAt.getTime())) return { ok: false, error: "startsAt must be a valid date" };
  if (!Number.isFinite(endsAt.getTime())) return { ok: false, error: "endsAt must be a valid date" };

  if (startsAt.getTime() < nowMs - MAINTENANCE_START_GRACE_MS) {
    return { ok: false, error: "The window must not start more than 15 minutes in the past" };
  }
  if (endsAt.getTime() <= startsAt.getTime()) {
    return { ok: false, error: "endsAt must be after startsAt" };
  }
  const maxMs = MAINTENANCE_WINDOW_MAX_HOURS * 3_600_000;
  if (endsAt.getTime() - startsAt.getTime() > maxMs) {
    return { ok: false, error: `A maintenance window can last at most ${MAINTENANCE_WINDOW_MAX_HOURS} hours` };
  }

  const reason =
    typeof b.reason === "string" && b.reason.trim() ? b.reason.trim().slice(0, MAINTENANCE_REASON_MAX) : null;

  return { ok: true, value: { nodeId, startsAt, endsAt, reason } };
}

// ── Scheduler applier ───────────────────────────────────────────────────────

/** Idempotent — upgrades predate the table. */
export async function ensureMaintenanceWindowsTable(): Promise<void> {
  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS maintenance_windows (
      id SERIAL PRIMARY KEY,
      node_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      starts_at TIMESTAMP NOT NULL,
      ends_at TIMESTAMP NOT NULL,
      reason TEXT,
      created_by INTEGER REFERENCES users(id),
      applied_at TIMESTAMP,
      completed_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
}

/**
 * Tick hook: apply due windows.
 *   pending → nothing yet
 *   active  → maintenance mode ON (once; appliedAt marks it)
 *   expired → maintenance mode OFF if WE turned it on; mark completed
 * Windows that were never applied (created late, scheduler was down) are
 * simply marked completed — they must not flip a node mid-window.
 */
export async function applyMaintenanceWindows(nowMs: number = Date.now()): Promise<void> {
  const { db } = await import("@/db");
  const { maintenanceWindows, nodes } = await import("@/db/schema");
  const { eq, and, isNull } = await import("drizzle-orm");
  await ensureMaintenanceWindowsTable();

  const open = await db
    .select()
    .from(maintenanceWindows)
    .where(isNull(maintenanceWindows.completedAt));

  for (const win of open) {
    const phase = windowPhase(
      { startsAtMs: new Date(win.startsAt).getTime(), endsAtMs: new Date(win.endsAt).getTime() },
      nowMs
    );
    if (phase === "active" && !win.appliedAt) {
      await db.update(nodes).set({ maintenanceMode: true }).where(eq(nodes.id, win.nodeId));
      await db
        .update(maintenanceWindows)
        .set({ appliedAt: new Date(nowMs) })
        .where(and(eq(maintenanceWindows.id, win.id), isNull(maintenanceWindows.appliedAt)));
    } else if (phase === "expired") {
      if (win.appliedAt) {
        // Only release what this window turned on. If an operator flipped the
        // node back manually already, the set is a harmless no-op.
        await db.update(nodes).set({ maintenanceMode: false }).where(eq(nodes.id, win.nodeId));
      }
      await db.update(maintenanceWindows).set({ completedAt: new Date(nowMs) }).where(eq(maintenanceWindows.id, win.id));
    }
  }
}
