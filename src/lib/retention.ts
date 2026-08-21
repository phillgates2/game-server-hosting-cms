import { db } from "@/db";
import { auditLog, nodeMetrics, serverMetrics } from "@/db/schema";
import { lt, sql } from "drizzle-orm";

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
  if (METRICS_RETENTION_DAYS <= 0) return 0;
  const before = cutoff(METRICS_RETENTION_DAYS);

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
  if (AUDIT_RETENTION_DAYS <= 0) return 0;
  const res = await db.delete(auditLog).where(lt(auditLog.createdAt, cutoff(AUDIT_RETENTION_DAYS)));
  return (res as unknown as { rowCount?: number }).rowCount ?? 0;
}

/**
 * Probabilistically prune from a hot write path.
 *
 * Never throws and never blocks the caller's own work: retention failing is
 * not a reason to fail a heartbeat.
 */
export function maybePruneInBackground(): void {
  if (METRICS_RETENTION_DAYS <= 0) return;
  if (Math.random() > PRUNE_PROBABILITY) return;

  const now = Date.now();
  if (now - lastPrune < MIN_PRUNE_INTERVAL_MS) return;
  lastPrune = now;

  void pruneMetrics()
    .then((n) => {
      if (n > 0) console.log(`[retention] pruned ${n} metric row(s) older than ${METRICS_RETENTION_DAYS}d`);
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
  return {
    nodeMetrics: nm?.n ?? 0,
    serverMetrics: sm?.n ?? 0,
    auditLog: al?.n ?? 0,
    metricsRetentionDays: METRICS_RETENTION_DAYS,
    auditRetentionDays: AUDIT_RETENTION_DAYS,
  };
}
