import { db } from "@/db";
import { auditLog, nodeMetrics, serverMetrics, settings } from "@/db/schema";
import { lt, sql, inArray } from "drizzle-orm";

/**
 * Retention for the append-only tables.
 *
 * `node_metrics`, `server_metrics` and `audit_log` only ever grow. A node
 * heartbeating every 10 seconds writes ~8,600 metric rows a day, so a modest
 * five-node panel reaches roughly 16 million rows and a couple of gigabytes
 * within a year. Nothing in the app ever deleted a single row, and the
 * dashboards only ever read the recent tail.
 *
 * Rather than require an external cron, pruning is amortised onto the writes
 * themselves: a heartbeat occasionally (see PRUNE_PROBABILITY) deletes rows
 * older than the retention window. That keeps a default install bounded with
 * no extra moving parts, while staying cheap because the delete is driven by
 * the `recorded_at` / `created_at` indexes.
 *
 * Windows are overridable so an operator who wants long history can keep it.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function envDays(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  // 0 is meaningful: it disables pruning for that table.
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

/** Days of node/server metric samples to keep. 0 disables pruning. */
export const METRICS_RETENTION_DAYS = envDays("METRICS_RETENTION_DAYS", 30);

/**
 * Days of audit history to keep. Defaults to a year because audit trails are
 * usually a compliance concern; 0 disables pruning.
 */
export const AUDIT_RETENTION_DAYS = envDays("AUDIT_RETENTION_DAYS", 365);

/**
 * Effective windows, with the database taking precedence over the environment.
 *
 * The exported constants above are the base layer, read once at module load.
 * The Settings panel writes overrides into the `settings` table so an operator
 * can change retention without editing .env and restarting, matching how the
 * Discord configuration already behaves.
 *
 * Cached briefly because pruning runs on the heartbeat path and must not add a
 * settings query to every write.
 */
let windowCache: { metrics: number; audit: number; at: number } | null = null;
const WINDOW_TTL_MS = 30_000;

export async function retentionWindows(): Promise<{ metrics: number; audit: number }> {
  const now = Date.now();
  if (windowCache && now - windowCache.at < WINDOW_TTL_MS) {
    return { metrics: windowCache.metrics, audit: windowCache.audit };
  }

  let metrics = METRICS_RETENTION_DAYS;
  let audit = AUDIT_RETENTION_DAYS;
  try {
    const rows = await db
      .select({ key: settings.key, value: settings.value })
      .from(settings)
      .where(inArray(settings.key, ["metrics_retention_days", "audit_retention_days"]));
    for (const row of rows) {
      const n = Number.parseInt(String(row.value ?? ""), 10);
      if (!Number.isFinite(n) || n < 0) continue;
      if (row.key === "metrics_retention_days") metrics = n;
      if (row.key === "audit_retention_days") audit = n;
    }
  } catch {
    // No settings table yet (fresh install) — fall back to the environment.
  }

  windowCache = { metrics, audit, at: now };
  return { metrics, audit };
}

/** Drop the cache so a save in the Settings panel takes effect immediately. */
export function invalidateRetentionCache() {
  windowCache = null;
}

/**
 * Fraction of eligible writes that trigger a prune. Running it on every
 * heartbeat would add a DELETE to the hot path for no benefit; at 2% a
 * five-node panel still prunes many times an hour.
 */
const PRUNE_PROBABILITY = 0.02;

let lastPrune = 0;
/** Never prune more than once a minute, however many nodes are reporting. */
const MIN_PRUNE_INTERVAL_MS = 60_000;

function cutoff(days: number): Date {
  return new Date(Date.now() - days * DAY_MS);
}

/**
 * Delete metric samples older than the retention window.
 * Returns the number of rows removed (0 when pruning is disabled).
 */
export async function pruneMetrics(): Promise<number> {
  const { metrics: windowDays } = await retentionWindows();
  if (windowDays <= 0) return 0;
  const before = cutoff(windowDays);

  const [nodeRes, serverRes] = await Promise.all([
    db.delete(nodeMetrics).where(lt(nodeMetrics.recordedAt, before)),
    db.delete(serverMetrics).where(lt(serverMetrics.recordedAt, before)),
  ]);

  const count =
    ((nodeRes as unknown as { rowCount?: number }).rowCount ?? 0) +
    ((serverRes as unknown as { rowCount?: number }).rowCount ?? 0);
  return count;
}

/** Delete audit entries older than the retention window. */
export async function pruneAuditLog(): Promise<number> {
  const { audit: windowDays } = await retentionWindows();
  if (windowDays <= 0) return 0;
  const res = await db.delete(auditLog).where(lt(auditLog.createdAt, cutoff(windowDays)));
  return (res as unknown as { rowCount?: number }).rowCount ?? 0;
}

/**
 * Probabilistically prune from a hot write path.
 *
 * Never throws and never blocks the caller's own work: retention failing is
 * not a reason to fail a heartbeat.
 */
export function maybePruneInBackground(): void {
  // The window is read inside pruneMetrics(), which returns 0 when pruning is
  // disabled -- so the cheap dice roll happens first and the settings lookup
  // only runs on the ~2% of heartbeats that would actually prune.
  if (Math.random() > PRUNE_PROBABILITY) return;

  const now = Date.now();
  if (now - lastPrune < MIN_PRUNE_INTERVAL_MS) return;
  lastPrune = now;

  void pruneMetrics()
    .then((n) => {
      if (n > 0) console.log(`[retention] pruned ${n} metric row(s)`);
    })
    .catch((e) => {
      console.error("[retention] metric prune failed:", e instanceof Error ? e.message : e);
    });
}

/** Row counts for the growth-prone tables, for the admin UI. */
export async function retentionStats(): Promise<{
  nodeMetrics: number;
  serverMetrics: number;
  auditLog: number;
  metricsRetentionDays: number;
  auditRetentionDays: number;
}> {
  const [nm] = await db.select({ n: sql<number>`count(*)::int` }).from(nodeMetrics);
  const [sm] = await db.select({ n: sql<number>`count(*)::int` }).from(serverMetrics);
  const [al] = await db.select({ n: sql<number>`count(*)::int` }).from(auditLog);
  // Report the *effective* windows, so the UI shows what is actually in force
  // rather than whatever the environment said at boot.
  const { metrics, audit } = await retentionWindows();
  return {
    nodeMetrics: nm?.n ?? 0,
    serverMetrics: sm?.n ?? 0,
    auditLog: al?.n ?? 0,
    metricsRetentionDays: metrics,
    auditRetentionDays: audit,
  };
}
