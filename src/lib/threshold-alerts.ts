/**
 * Host threshold alerts.
 *
 * The resource-limit watchdog protects against one server breaking its own
 * caps; these alerts answer the wider question — "is the machine itself
 * heading for trouble?" (CPU pegged, RAM nearly gone, disk nearly full).
 *
 * The decision logic is pure so the firing boundary and the one-alert-per-
 * episode rule are unit-tested; the scheduler tick owns the sampling and the
 * Discord send.
 */

export interface ThresholdConfig {
  /** Fire when host CPU utilisation exceeds this %. 0 disables. */
  cpuPercent: number;
  /** Fire when host RAM usage exceeds this %. 0 disables. */
  ramPercent: number;
  /** Fire when the filesystem usage exceeds this %. 0 disables. */
  diskPercent: number;
  /** Consecutive breaches required before an alert fires. */
  sustained: number;
}

export const DEFAULT_ALERT_SUSTAINED = 3;

export interface HostReading {
  cpuPercent: number | null;
  ramPercent: number | null;
  diskPercent: number | null;
}

/**
 * Which thresholds a reading breaches. A threshold of 0 (or less) is "off"
 * and can never breach; a null reading (metric unavailable) never breaches —
 * a missing number is not an emergency.
 */
export function evaluateThresholds(reading: HostReading, cfg: ThresholdConfig): string[] {
  const breaches: string[] = [];
  if (cfg.cpuPercent > 0 && reading.cpuPercent !== null && reading.cpuPercent > cfg.cpuPercent) {
    breaches.push(`CPU ${Math.round(reading.cpuPercent)}% is over ${cfg.cpuPercent}%`);
  }
  if (cfg.ramPercent > 0 && reading.ramPercent !== null && reading.ramPercent > cfg.ramPercent) {
    breaches.push(`RAM ${Math.round(reading.ramPercent)}% used is over ${cfg.ramPercent}%`);
  }
  if (cfg.diskPercent > 0 && reading.diskPercent !== null && reading.diskPercent > cfg.diskPercent) {
    breaches.push(`disk ${Math.round(reading.diskPercent)}% full is over ${cfg.diskPercent}%`);
  }
  return breaches;
}

export interface AlertEpisode {
  /** Consecutive breach checks seen so far. */
  strikes: number;
  /** Whether this episode has already fired its alert. */
  alerted: boolean;
}

/**
 * Episode state machine. A breach adds a strike; once `sustained` strikes
 * accumulate the alert fires — exactly once per episode, so a pegged host
 * does not spam Discord every check. A clean reading closes the episode and
 * re-arms the alert.
 */
export function alertDecision(
  previous: AlertEpisode,
  breached: boolean,
  sustained: number = DEFAULT_ALERT_SUSTAINED
): { episode: AlertEpisode; fire: boolean } {
  if (!breached) return { episode: { strikes: 0, alerted: false }, fire: false };
  const strikes = previous.strikes + 1;
  const fire = !previous.alerted && strikes >= sustained;
  return { episode: { strikes, alerted: previous.alerted || fire }, fire };
}
