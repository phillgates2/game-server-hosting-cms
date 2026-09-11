/**
 * Idle-server detector ticker.
 *
 * The clock math lives in idle-math.ts (client-safe, unit-tested); this
 * module owns the periodic probe pass. See idle-math.ts for the rules:
 * players clears the clock, zero players stamps it, unreachable changes
 * nothing.
 */

export * from "./idle-math";

import {
  IDLE_TICK_MS,
  IDLE_MAX_PROBES_PER_TICK,
  IDLE_MAX_STOPS_PER_TICK,
  IDLE_POLICY_ENABLED_KEY,
  IDLE_POLICY_HOURS_KEY,
  IDLE_DEFAULT_THRESHOLD_HOURS,
  nextIdleStamp,
  shouldIdleStop,
  idleDurationMs,
} from "./idle-math";
// ── Ticker ──────────────────────────────────────────────────────────────────

import { db } from "@/db";
import { gameServers, gameDefinitions, nodes, serverIdleState, settings, playerSamples } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { createLogger } from "@/lib/logger";

const log = createLogger("idle");

/** Idempotent — upgrades predate the table. */
export async function ensureIdleTable(): Promise<void> {
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS server_idle_state (
      server_id INTEGER PRIMARY KEY REFERENCES game_servers(id) ON DELETE CASCADE,
      zero_players_since TIMESTAMP,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `);
}

let timer: NodeJS.Timeout | null = null;

async function tick(): Promise<void> {
  try {
    await ensureIdleTable();
    const { probePlayers, probeSpecFor } = await import("@/lib/players");

    const servers = await db
      .select({
        id: gameServers.id,
        name: gameServers.name,
        ipv4: gameServers.ipv4,
        port: gameServers.port,
        queryPort: gameServers.queryPort,
        nodeIsLocal: nodes.isLocal,
        gameSlug: gameDefinitions.slug,
        discordWebhook: gameServers.discordWebhook,
        playerAlertThreshold: gameServers.playerAlertThreshold,
        playerAlertAbove: gameServers.playerAlertAbove,
      })
      .from(gameServers)
      .leftJoin(nodes, eq(gameServers.nodeId, nodes.id))
      .leftJoin(gameDefinitions, eq(gameServers.gameId, gameDefinitions.id))
      .leftJoin(serverIdleState, eq(serverIdleState.serverId, gameServers.id))
      .where(eq(gameServers.status, "running"))
      .orderBy(asc(serverIdleState.updatedAt))
      .limit(1_000);

    const probeable = servers.filter((s) => {
      if (s.nodeIsLocal === false) return false; // v1: local only
      if (!s.gameSlug || !s.ipv4 || s.ipv4 === "0.0.0.0") return false;
      return probeSpecFor(s.gameSlug).kind !== "none";
    });

    for (const server of probeable.slice(0, IDLE_MAX_PROBES_PER_TICK)) {
      try {
        const probe = await probePlayers({
          gameSlug: server.gameSlug ?? "",
          host: server.ipv4 ?? "",
          port: server.port,
          queryPort: server.queryPort,
          attempts: 1,
        });

        // Every successful probe also feeds the player-count history that
        // powers the peak-hours heatmap. Unreachable probes record nothing —
        // absence of data is not zero players.
        if (probe.ok && typeof probe.players === "number") {
          await db.insert(playerSamples).values({ serverId: server.id, players: probe.players }).catch(() => undefined);

          // Player-count alerts ride on the same probe (edge-triggered).
          if (server.playerAlertThreshold !== null) {
            try {
              const { ensurePlayerAlertColumns, processPlayerProbeForAlerts } = await import("./player-alerts");
              await ensurePlayerAlertColumns();
              await processPlayerProbeForAlerts({
                serverId: server.id,
                serverName: server.name,
                players: probe.players,
                threshold: server.playerAlertThreshold,
                wasAbove: server.playerAlertAbove === true,
                discordWebhook: server.discordWebhook,
              });
            } catch { /* alerting never breaks the probe pass */ }
          }
        }

        const [existing] = await db
          .select({ zeroPlayersSince: serverIdleState.zeroPlayersSince })
          .from(serverIdleState)
          .where(eq(serverIdleState.serverId, server.id))
          .limit(1);

        const next = nextIdleStamp(probe.ok, probe.players, existing?.zeroPlayersSince ?? null, new Date());
        if (next === undefined) continue; // unreachable: leave state untouched

        if (existing) {
          await db
            .update(serverIdleState)
            .set({ zeroPlayersSince: next, updatedAt: new Date() })
            .where(eq(serverIdleState.serverId, server.id));
        } else {
          await db.insert(serverIdleState).values({
            serverId: server.id,
            zeroPlayersSince: next,
            updatedAt: new Date(),
          });
        }
      } catch {
        /* one server never breaks the pass */
      }
    }

    await enforceIdleStops();
  } catch (e: unknown) {
    log.warn(`idle tick failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function getIdlePolicy(): Promise<{ enabled: boolean; thresholdMs: number }> {
  try {
    const rows = await db
      .select({ key: settings.key, value: settings.value })
      .from(settings)
      .where(eq(settings.key, IDLE_POLICY_ENABLED_KEY))
      .limit(1);
    const hoursRows = await db
      .select({ key: settings.key, value: settings.value })
      .from(settings)
      .where(eq(settings.key, IDLE_POLICY_HOURS_KEY))
      .limit(1);
    const enabled = rows[0]?.value === "true";
    const hours = Number(hoursRows[0]?.value);
    const thresholdHours =
      Number.isFinite(hours) && hours >= 1 && hours <= 72 ? hours : IDLE_DEFAULT_THRESHOLD_HOURS;
    return { enabled, thresholdMs: thresholdHours * 3_600_000 };
  } catch {
    return { enabled: false, thresholdMs: IDLE_DEFAULT_THRESHOLD_HOURS * 3_600_000 };
  }
}

/**
 * Stop servers whose zero-player streak crossed the policy threshold.
 * Local servers only, capped per tick, each stop recorded as an event.
 */
async function enforceIdleStops(): Promise<void> {
  const policy = await getIdlePolicy();
  if (!policy.enabled) return;

  const candidates = await db
    .select({
      serverId: serverIdleState.serverId,
      zeroPlayersSince: serverIdleState.zeroPlayersSince,
      status: gameServers.status,
      pid: gameServers.pid,
      name: gameServers.name,
      nodeIsLocal: nodes.isLocal,
    })
    .from(serverIdleState)
    .innerJoin(gameServers, eq(serverIdleState.serverId, gameServers.id))
    .leftJoin(nodes, eq(gameServers.nodeId, nodes.id))
    .limit(1_000);

  let stops = 0;
  const now = Date.now();
  for (const c of candidates) {
    if (stops >= IDLE_MAX_STOPS_PER_TICK) break;
    const idleFor = idleDurationMs(c.zeroPlayersSince, now);
    if (
      !shouldIdleStop({
        policyEnabled: true,
        serverStatus: c.status,
        nodeIsLocal: c.nodeIsLocal,
        idleForMs: idleFor,
        thresholdMs: policy.thresholdMs,
      })
    ) {
      continue;
    }
    try {
      const { killProcess } = await import("@/lib/process-control");
      if (c.pid) await killProcess(c.pid);
      await db
        .update(gameServers)
        .set({ status: "stopped", pid: null, lastStopped: new Date(), updatedAt: new Date() })
        .where(eq(gameServers.id, c.serverId));
      // Clear the idle clock: the server is down, the streak is over.
      await db
        .update(serverIdleState)
        .set({ zeroPlayersSince: null, updatedAt: new Date() })
        .where(eq(serverIdleState.serverId, c.serverId));
      const { recordServerEvent } = await import("@/lib/server-events");
      await recordServerEvent(c.serverId, "idle-stopped", `zero players for ${Math.round((idleFor ?? 0) / 3_600_000)}h`);
      log.info(`idle-stopped "${c.name}" after ${Math.round((idleFor ?? 0) / 3_600_000)}h with zero players`);
      stops += 1;
    } catch (e: unknown) {
      log.warn(`idle stop failed for "${c.name}": ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

export function startIdleDetector(): () => void {
  if (timer) return () => stopIdleDetector();
  timer = setInterval(() => void tick(), IDLE_TICK_MS);
  timer.unref?.();
  const first = setTimeout(() => void tick(), 45_000);
  first.unref?.();
  return () => stopIdleDetector();
}

export function stopIdleDetector(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
