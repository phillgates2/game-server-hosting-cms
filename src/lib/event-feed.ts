/**
 * Fleet-wide incident feed: crash/watchdog/auto-restart events across all
 * servers the caller may see, newest first. Pure parsing lives here so the
 * clamping rules are unit-tested.
 */

/** Default window shown by the overview widget. */
export const FEED_DEFAULT_HOURS = 24;
/** Longest window the endpoint will honour (one week). */
export const FEED_MAX_HOURS = 168;
/** Hard cap on rows returned, regardless of window. */
export const FEED_MAX_EVENTS = 200;

/** Parse the `hours` query param; anything odd falls back to the default. */
export function clampFeedHours(param: string | null | undefined): number {
  if (param == null || param.trim() === "") return FEED_DEFAULT_HOURS;
  const n = Number(param);
  if (!Number.isFinite(n)) return FEED_DEFAULT_HOURS;
  return Math.max(1, Math.min(FEED_MAX_HOURS, Math.floor(n)));
}

export interface FleetEvent {
  id: number;
  kind: string;
  detail: string | null;
  createdAt: string;
  serverId: number;
  serverName: string | null;
  gameName: string | null;
  gameIcon: string | null;
}
