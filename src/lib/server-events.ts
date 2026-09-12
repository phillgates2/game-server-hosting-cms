/**
 * Per-server lifecycle events: the crash/restart history that answers "has
 * this server been stable?" next to the CPU/RAM charts.
 *
 * Events are recorded at the moments that matter — a crash detected, the
 * watchdog stopping a runaway server, an auto-restart recovering one — and
 * pruned per server on write so the table cannot grow unbounded.
 */

export const SERVER_EVENT_KINDS = ["crashed", "watchdog-stop", "auto-restarted", "idle-stopped", "update-report", "updated", "restored"] as const;
export type ServerEventKind = (typeof SERVER_EVENT_KINDS)[number];

/** Events older than this are pruned on the next write for that server. */
export const SERVER_EVENT_RETENTION_DAYS = 14;

// Labels moved to event-labels.ts (client-safe); re-exported for existing callers.
export { eventLabel } from "./event-labels";

/** Ensure the table exists (upgrades predate it) — idempotent. */
export async function ensureServerEventsTable(): Promise<void> {
  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS server_events (
      id SERIAL PRIMARY KEY,
      server_id INTEGER REFERENCES game_servers(id) NOT NULL,
      kind VARCHAR(32) NOT NULL,
      detail TEXT,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `);
}

/**
 * Record one event and prune the server's history beyond the retention
 * window. Best-effort: history must never break the flow that records it.
 */
export async function recordServerEvent(
  serverId: number,
  kind: ServerEventKind,
  detail?: string
): Promise<void> {
  try {
    const { db } = await import("@/db");
    const { serverEvents } = await import("@/db/schema");
    const { eq, lt, and } = await import("drizzle-orm");
    await ensureServerEventsTable();
    await db.insert(serverEvents).values({ serverId, kind, detail: detail ?? null });
    const cutoff = new Date(Date.now() - SERVER_EVENT_RETENTION_DAYS * 24 * 3_600_000);
    await db
      .delete(serverEvents)
      .where(and(eq(serverEvents.serverId, serverId), lt(serverEvents.createdAt, cutoff)))
      .catch(() => undefined);
  } catch {
    /* history is best-effort */
  }
}

/** The newest events for a server (for the Metrics view). */
export async function recentServerEvents(serverId: number, limit = 8): Promise<Array<{ kind: string; detail: string | null; createdAt: Date }>> {
  try {
    const { db } = await import("@/db");
    const { serverEvents } = await import("@/db/schema");
    const { eq, desc } = await import("drizzle-orm");
    await ensureServerEventsTable();
    const rows = await db
      .select({ kind: serverEvents.kind, detail: serverEvents.detail, createdAt: serverEvents.createdAt })
      .from(serverEvents)
      .where(eq(serverEvents.serverId, serverId))
      .orderBy(desc(serverEvents.createdAt))
      .limit(limit);
    return rows;
  } catch {
    return [];
  }
}
