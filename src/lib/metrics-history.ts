/**
 * Metric-history helpers shared by the metrics routes.
 *
 * The panel has collected per-server samples (server_metrics) and node
 * heartbeat samples (node_metrics) since the metrics pipeline landed, but
 * nothing ever turned them into history a human could look at. These are the
 * pure pieces — range clamping and downsampling — so the decision logic is
 * unit-testable and the routes stay thin.
 */

export interface MetricPoint {
  /** Unix milliseconds. */
  t: number;
  /** Sample value (CPU percent, RAM MB, …). */
  v: number;
}

/** Hard caps so a crafted query string cannot ask for the whole table. */
export const MIN_RANGE_HOURS = 1;
export const MAX_RANGE_HOURS = 24 * 14; // two weeks
export const DEFAULT_RANGE_HOURS = 6;

/** Charts beyond this many points are visually identical and waste bandwidth. */
export const MAX_CHART_POINTS = 360;

/**
 * Parse and clamp a `?hours=` value. Accepts anything a query string can be
 * (missing, junk, negative, huge) and always returns a sane integer.
 */
export function clampRangeHours(raw: unknown, fallback: number = DEFAULT_RANGE_HOURS): number {
  // Missing means "use the default", not "the smallest window".
  if (raw === null || raw === undefined || raw === "") return fallback;
  const n = typeof raw === "string" ? Number.parseFloat(raw) : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_RANGE_HOURS, Math.max(MIN_RANGE_HOURS, Math.floor(n)));
}

/**
 * Thin an ordered series down to at most `maxPoints` entries.
 *
 * Stride-based: take every Nth point, and always keep the final point so the
 * chart reaches the present moment. The input must already be sorted by time
 * ascending (which the route's ORDER BY guarantees).
 */
export function downsampleSeries<T>(points: readonly T[], maxPoints: number = MAX_CHART_POINTS): T[] {
  if (points.length <= maxPoints) return [...points];
  const stride = Math.ceil(points.length / maxPoints);
  const out: T[] = [];
  for (let i = 0; i < points.length; i += stride) {
    out.push(points[i]);
  }
  const last = points[points.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}
