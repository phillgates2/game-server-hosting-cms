/**
 * Player-count alerts: "tell me when this server reaches N players".
 *
 * Edge-triggered: the notification fires once per upward crossing and
 * re-arms only after the count drops back below the threshold, so a busy
 * server doesn't spam Discord every probe. Unreachable probes never change
 * the armed state — absence of data is not zero players.
 *
 * The pure evaluation/formatting is unit-tested; the idle-detection tick
 * calls processPlayerProbeForAlerts with each successful probe.
 */

export const PLAYER_ALERT_MAX_THRESHOLD = 1000;

/** Parse a threshold from API input; null disables the alert. */
export function parsePlayerAlertThreshold(value: unknown): number | null {
  if (value === null || value === "" || value === undefined) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > PLAYER_ALERT_MAX_THRESHOLD) return null;
  return n;
}

export interface PlayerAlertEvaluation {
  fire: boolean;
  above: boolean;
}

/**
 * Pure edge-trigger evaluation.
 * players === null (unreachable probe) leaves the armed state untouched.
 */
export function evaluatePlayerAlert(input: {
  threshold: number | null;
  players: number | null;
  wasAbove: boolean;
}): PlayerAlertEvaluation {
  if (input.threshold === null || input.players === null) {
    return { fire: false, above: input.wasAbove };
  }
  const above = input.players >= input.threshold;
  return { fire: above && !input.wasAbove, above };
}

/** The Discord message for a fired alert. */
export function formatPlayerAlertMessage(serverName: string, players: number, threshold: number): string {
  return `📣 **${serverName}** reached ${players}/${threshold} players — the party is full!`;
}

// ── Wiring used by the idle-detection tick ──────────────────────────────────

/** Idempotent — upgrades predate the columns. */
export async function ensurePlayerAlertColumns(): Promise<void> {
  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`ALTER TABLE game_servers ADD COLUMN IF NOT EXISTS player_alert_threshold INTEGER`);
  await db.execute(sql`ALTER TABLE game_servers ADD COLUMN IF NOT EXISTS player_alert_above BOOLEAN DEFAULT FALSE`);
}

export interface PlayerAlertProbe {
  serverId: number;
  serverName: string;
  /** null = unreachable probe — must not change the armed state. */
  players: number | null;
  threshold: number | null;
  wasAbove: boolean;
  discordWebhook: string | null;
}

/**
 * Evaluate one probe, persist the armed state, and deliver the notification
 * when the threshold is crossed upward. Best-effort everywhere: alerting
 * must never break the probe pass.
 */
export async function processPlayerProbeForAlerts(probe: PlayerAlertProbe): Promise<boolean> {
  const { ensurePlayerAlertColumns } = await import("./player-alerts");
  await ensurePlayerAlertColumns();

  const result = evaluatePlayerAlert({ threshold: probe.threshold, players: probe.players, wasAbove: probe.wasAbove });

  // Persist the armed state whenever it changed (or first-seen).
  if (result.above !== probe.wasAbove || probe.players !== null) {
    try {
      const { db } = await import("@/db");
      const { gameServers } = await import("@/db/schema");
      const { eq } = await import("drizzle-orm");
      await db
        .update(gameServers)
        .set({ playerAlertAbove: result.above })
        .where(eq(gameServers.id, probe.serverId));
    } catch { /* state lag is acceptable */ }
  }

  if (!result.fire) return false;

  const message = formatPlayerAlertMessage(probe.serverName, probe.players ?? 0, probe.threshold ?? 0);
  try {
    const { fireWebhookEvent } = await import("./webhook-dispatch");
    fireWebhookEvent({
      action: "server.player-alert",
      entityType: "server",
      details: { serverId: probe.serverId, serverName: probe.serverName, players: probe.players, threshold: probe.threshold },
    });
  } catch { /* optional channel */ }

  try {
    const { resolveWebhookUrl, isValidWebhookUrl } = await import("./discord");
    const hook = resolveWebhookUrl(probe.discordWebhook);
    if (hook && isValidWebhookUrl(hook)) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8_000);
      try {
        await fetch(hook, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content: message }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
    }
  } catch { /* Discord down never breaks the panel */ }

  return true;
}
