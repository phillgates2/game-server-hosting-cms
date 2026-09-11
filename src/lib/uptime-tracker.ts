/**
 * The stability sampler: every 5 minutes, for each server the panel believes
 * is running on a local node, check whether the process is actually alive
 * and append a row to server_uptime_history. Rows older than the retention
 * window are pruned on the same pass.
 *
 * Remote servers are skipped in v1 — the panel cannot see their processes
 * and the agent has no "am I alive" RPC yet. Everything is best-effort:
 * sampling must never take the panel down.
 */

import { db } from "@/db";
import { gameServers, nodes, serverUptimeHistory } from "@/db/schema";
import { eq, lt } from "drizzle-orm";
import { isProcessAlive } from "@/lib/process-control";
import { createLogger } from "@/lib/logger";
import {
  UPTIME_CHECK_INTERVAL_MS,
  UPTIME_RETENTION_DAYS,
  uptimeCutoffMs,
} from "@/lib/uptime";

const log = createLogger("uptime");

let timer: NodeJS.Timeout | null = null;

/** Idempotent — upgrades predate the table. */
export async function ensureUptimeTable(): Promise<void> {
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS server_uptime_history (
      id SERIAL PRIMARY KEY,
      server_id INTEGER REFERENCES game_servers(id) NOT NULL,
      online BOOLEAN NOT NULL,
      checked_at TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS server_uptime_history_server_idx
      ON server_uptime_history (server_id, checked_at)
  `);
}

async function tick(): Promise<void> {
  try {
    await ensureUptimeTable();

    const servers = await db
      .select({
        id: gameServers.id,
        status: gameServers.status,
        pid: gameServers.pid,
        nodeIsLocal: nodes.isLocal,
      })
      .from(gameServers)
      .leftJoin(nodes, eq(gameServers.nodeId, nodes.id));

    const now = Date.now();
    for (const server of servers) {
      try {
        if (server.status !== "running") continue;
        // Remote nodes: no local process to inspect (v1 limitation).
        if (server.nodeIsLocal === false) continue;
        const alive = server.pid ? isProcessAlive(server.pid) : false;
        await db.insert(serverUptimeHistory).values({
          serverId: server.id,
          online: alive,
          checkedAt: new Date(),
        });
      } catch {
        /* one server failing never breaks the pass */
      }
    }

    // Prune beyond retention in one statement.
    const cutoff = new Date(uptimeCutoffMs(now));
    await db.delete(serverUptimeHistory).where(lt(serverUptimeHistory.checkedAt, cutoff));
  } catch (e: unknown) {
    log.warn(`uptime tick failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export function startUptimeTracker(): () => void {
  if (timer) return () => stopUptimeTracker();
  timer = setInterval(() => void tick(), UPTIME_CHECK_INTERVAL_MS);
  timer.unref?.();
  // First sample shortly after boot (30s), not immediately — the panel may
  // still be starting services.
  const first = setTimeout(() => void tick(), 30_000);
  first.unref?.();
  return () => stopUptimeTracker();
}

export function stopUptimeTracker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export const UPTIME_TRACKER_INFO = {
  intervalMs: UPTIME_CHECK_INTERVAL_MS,
  retentionDays: UPTIME_RETENTION_DAYS,
};
