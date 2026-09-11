/**
 * Idle-server detection: a running server that answers the player probe with
 * zero players for hours on end is burning electricity for nobody.
 *
 * Every 10 minutes the detector probes a bounded slice of the running local
 * servers that have a queryable protocol. A successful probe with players
 * clears the idle clock; zero players stamps it (first sighting only); an
 * UNREACHABLE probe changes nothing — unknown is not empty.
 *
 * Pure helpers first so the clock math is unit-tested.
 */

export const IDLE_DEFAULT_THRESHOLD_HOURS = 6;
export const IDLE_POLICY_ENABLED_KEY = "idle_auto_stop";
export const IDLE_POLICY_HOURS_KEY = "idle_auto_stop_hours";

/**
 * Resolve the configured "treat as idle after N hours" threshold in ms.
 * Falls back to IDLE_DEFAULT_THRESHOLD_HOURS for missing/invalid/out-of-range
 * values (valid range: 1-72h). Pure: takes already-loaded settings rows.
 */
export function resolveIdleThresholdMs(
  settingsRows: Array<{ key?: string; value: string | null | undefined }>
): number {
  const row = settingsRows.find((r) => r.key === IDLE_POLICY_HOURS_KEY);
  const hours = Number(row?.value);
  const valid = Number.isFinite(hours) && hours >= 1 && hours <= 72 ? hours : IDLE_DEFAULT_THRESHOLD_HOURS;
  return valid * 3_600_000;
}
/** Stop at most this many servers per tick so one sweep never storms. */
export const IDLE_MAX_STOPS_PER_TICK = 5;
export const IDLE_TICK_MS = 10 * 60_000;
/** Probes are UDP work against real game servers — cap the storm. */
export const IDLE_MAX_PROBES_PER_TICK = 10;

/** How long has the zero-player streak lasted, or null when not idle-tracking. */
export function idleDurationMs(
  zeroPlayersSince: string | number | Date | null | undefined,
  nowMs: number
): number | null {
  if (zeroPlayersSince == null) return null;
  const t = zeroPlayersSince instanceof Date ? zeroPlayersSince.getTime() : new Date(zeroPlayersSince).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, nowMs - t);
}

export function isServerIdle(
  zeroPlayersSince: string | number | Date | null | undefined,
  nowMs: number,
  thresholdMs: number
): boolean {
  const dur = idleDurationMs(zeroPlayersSince, nowMs);
  return dur !== null && dur >= thresholdMs;
}

/** Compact human duration for badges ("3h 20m", "2d 4h"). */
export function describeIdleDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export interface IdleStopDecisionInput {
  policyEnabled: boolean;
  serverStatus: string;
  nodeIsLocal: boolean | null;
  idleForMs: number | null;
  thresholdMs: number;
}

/**
 * Should this server be stopped right now for idleness? All of: policy on,
 * server running, on a local node we control, and idle at/over threshold.
 */
export function shouldIdleStop(input: IdleStopDecisionInput): boolean {
  return (
    input.policyEnabled &&
    input.serverStatus === "running" &&
    input.nodeIsLocal !== false &&
    input.idleForMs !== null &&
    input.idleForMs >= input.thresholdMs
  );
}

/** Decide the new idle-clock value from one probe outcome. */
export function nextIdleStamp(
  probeOk: boolean,
  players: number | undefined,
  previousStamp: Date | null,
  now: Date
): Date | null | undefined {
  if (!probeOk) return undefined; // unreachable: keep whatever we had
  if (typeof players === "number" && players > 0) return null; // activity: clear
  return previousStamp ?? now; // empty: keep first sighting
}
