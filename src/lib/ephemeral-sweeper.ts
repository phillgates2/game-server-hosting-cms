/**
 * The TTL sweeper: stops and deletes ephemeral servers whose time has come.
 *
 * Safety rules, in order:
 *  - local servers only (remote file deletion needs an agent RPC we don't
 *    have yet — remote expiries delete the row only, never remote files);
 *  - the install path must pass isSafeInstallPath before any rm runs;
 *  - at most EXPIRE_SWEEP_LIMIT servers per sweep;
 *  - every deletion is audit-logged.
 */

import { db } from "@/db";
import {
  gameServers,
  nodes,
  scheduledTasks,
  serverIdleState,
  serverChanges,
  serverUptimeHistory,
  serverEvents,
  auditLog,
} from "@/db/schema";
import { and, eq, isNotNull, lt } from "drizzle-orm";
import { rm } from "node:fs/promises";
import { isExpired, isSafeInstallPath, EXPIRE_SWEEP_LIMIT } from "./ephemeral";
import { createLogger } from "@/lib/logger";

const log = createLogger("ephemeral");

async function ensureExpiresColumn(): Promise<void> {
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`ALTER TABLE game_servers ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP`);
}

/** Stop the process if alive; never throws. */
async function stopIfRunning(pid: number | null): Promise<void> {
  if (!pid) return;
  try {
    const { killProcess } = await import("./process-control");
    await killProcess(pid);
  } catch {
    /* the row is about to disappear anyway */
  }
}

export async function sweepExpiredServers(): Promise<number> {
  try {
    await ensureExpiresColumn();
    const now = new Date();

    const expired = await db
      .select({
        id: gameServers.id,
        name: gameServers.name,
        userId: gameServers.userId,
        status: gameServers.status,
        pid: gameServers.pid,
        installPath: gameServers.installPath,
        expiresAt: gameServers.expiresAt,
        nodeIsLocal: nodes.isLocal,
      })
      .from(gameServers)
      .leftJoin(nodes, eq(gameServers.nodeId, nodes.id))
      .where(and(isNotNull(gameServers.expiresAt), lt(gameServers.expiresAt, now)))
      .limit(EXPIRE_SWEEP_LIMIT);

    let swept = 0;
    for (const server of expired) {
      if (!isExpired(server.expiresAt, now.getTime())) continue;
      try {
        await stopIfRunning(server.pid);

        // Local servers: remove the files, but only from a delete-safe path.
        if (server.nodeIsLocal !== false && isSafeInstallPath(server.installPath)) {
          await rm(server.installPath, { recursive: true, force: true }).catch(() => undefined);
        }

        await db.delete(scheduledTasks).where(eq(scheduledTasks.serverId, server.id));
        await db.delete(serverIdleState).where(eq(serverIdleState.serverId, server.id));
        await db.delete(serverChanges).where(eq(serverChanges.serverId, server.id));
        await db.delete(serverUptimeHistory).where(eq(serverUptimeHistory.serverId, server.id));
        await db.delete(serverEvents).where(eq(serverEvents.serverId, server.id));
        await db.delete(gameServers).where(eq(gameServers.id, server.id));

        await db.insert(auditLog).values({
          userId: server.userId,
          action: "server.expired",
          entityType: "server",
          entityId: server.id,
          details: { name: server.name, expiredAt: server.expiresAt?.toISOString() ?? null },
          ipAddress: "panel",
        });
        log.info(`ephemeral server "${server.name}" expired and was deleted`);
        swept += 1;
      } catch (e: unknown) {
        log.warn(`failed to expire server ${server.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return swept;
  } catch (e: unknown) {
    log.warn(`expire sweep failed: ${e instanceof Error ? e.message : String(e)}`);
    return 0;
  }
}
