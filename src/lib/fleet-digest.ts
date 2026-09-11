/**
 * The weekly fleet digest: one message summarising the last 7 days —
 * crashes, watchdog stops, idle auto-stops, and the least-stable servers.
 * Formatting is pure so the wording is unit-tested; collection lives in
 * collectFleetDigestStats.
 */

export const DIGEST_WINDOW_DAYS = 7;
export const DIGEST_MAX_LENGTH = 1_900; // Discord hard limit is 2000

export interface FleetDigestStats {
  serversTotal: number;
  serversRunning: number;
  crashed: number;
  watchdogStops: number;
  idleStops: number;
  /** Worst-first stability rows (percent over the window). */
  uptime: Array<{ name: string; percent: number | null }>;
}

export function formatFleetDigest(stats: FleetDigestStats): string {
  const lines: string[] = [];
  lines.push(`📬 Fleet digest — last ${DIGEST_WINDOW_DAYS} days`);
  lines.push(`Servers: ${stats.serversRunning} running / ${stats.serversTotal} total`);
  lines.push(
    `Incidents: ${stats.crashed} crash${stats.crashed === 1 ? "" : "es"} · ` +
      `${stats.watchdogStops} watchdog stop${stats.watchdogStops === 1 ? "" : "s"} · ` +
      `${stats.idleStops} idle auto-stop${stats.idleStops === 1 ? "" : "s"}`
  );

  const ranked = stats.uptime.filter((u) => u.percent !== null);
  if (ranked.length > 0) {
    const worst = ranked.slice(0, 3);
    lines.push(
      `Stability: ${worst
        .map((u) => `${u.name} ${u.percent}%`)
        .join(" · ")}`
    );
    const allStable = ranked.every((u) => (u.percent ?? 0) >= 99);
    if (allStable) lines.push("Everything held ≥99% — a quiet week. 🌙");
  }

  const text = lines.join("\n");
  return text.length > DIGEST_MAX_LENGTH ? `${text.slice(0, DIGEST_MAX_LENGTH - 1)}…` : text;
}

/** Collect the stats from the database. Best-effort fields fall back to 0. */
export async function collectFleetDigestStats(): Promise<FleetDigestStats> {
  const { db } = await import("@/db");
  const { gameServers, serverEvents, serverUptimeHistory } = await import("@/db/schema");
  const { eq, gte, sql, and } = await import("drizzle-orm");

  const since = new Date(Date.now() - DIGEST_WINDOW_DAYS * 86_400_000);

  const [totals] = await db
    .select({
      total: sql<number>`count(*)::int`,
      running: sql<number>`count(*) filter (where ${gameServers.status} = 'running')::int`,
    })
    .from(gameServers);

  const events = await db
    .select({ kind: serverEvents.kind, count: sql<number>`count(*)::int` })
    .from(serverEvents)
    .where(gte(serverEvents.createdAt, since))
    .groupBy(serverEvents.kind);

  const byKind = new Map(events.map((e) => [e.kind, e.count]));

  const uptimeRows = await db
    .select({
      serverId: serverUptimeHistory.serverId,
      name: gameServers.name,
      checks: sql<number>`count(*)::int`,
      online: sql<number>`count(*) filter (where ${serverUptimeHistory.online})::int`,
    })
    .from(serverUptimeHistory)
    .innerJoin(gameServers, eq(serverUptimeHistory.serverId, gameServers.id))
    .where(gte(serverUptimeHistory.checkedAt, since))
    .groupBy(serverUptimeHistory.serverId, gameServers.name);

  const uptime = uptimeRows
    .map((r) => ({
      name: r.name,
      percent: r.checks > 0 ? Math.round((r.online / r.checks) * 10000) / 100 : null,
    }))
    .sort((a, b) => (a.percent ?? 101) - (b.percent ?? 101))
    .slice(0, 20);

  void and;
  return {
    serversTotal: totals?.total ?? 0,
    serversRunning: totals?.running ?? 0,
    crashed: byKind.get("crashed") ?? 0,
    watchdogStops: byKind.get("watchdog-stop") ?? 0,
    idleStops: byKind.get("idle-stopped") ?? 0,
    uptime,
  };
}

/** Build and deliver the digest: Discord (panel webhook) + outbound webhooks. */
export async function sendFleetDigest(): Promise<boolean> {
  const { createLogger } = await import("./logger");
  const log = createLogger("digest");
  try {
    const stats = await collectFleetDigestStats();
    const text = formatFleetDigest(stats);

    // 1) Outbound webhook subscribers (event form).
    try {
      const { fireWebhookEvent } = await import("./webhook-dispatch");
      fireWebhookEvent({ action: "fleet.digest", entityType: "panel", details: { digest: text, stats } });
    } catch { /* optional channel */ }

    // 2) The panel-wide Discord webhook, as plain content.
    try {
      const { resolveWebhookUrl, isValidWebhookUrl } = await import("./discord");
      const hook = resolveWebhookUrl(null);
      if (hook && isValidWebhookUrl(hook)) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8_000);
        try {
          await fetch(hook, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ content: text }),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeout);
        }
      }
    } catch { /* optional channel */ }

    log.info("fleet digest sent");
    return true;
  } catch (e: unknown) {
    log.warn(`fleet digest failed: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}
