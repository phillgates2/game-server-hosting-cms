/**
 * Capacity forecasting: fit a line through recent usage samples and answer
 * "how many days until this node runs out?" Pure math, unit-tested.
 *
 * Honest about uncertainty: fewer than MIN_SAMPLES samples, a flat or
 * shrinking trend, or a projection beyond the horizon all return null —
 * "no forecast" is better than a scary wrong number.
 */

export const CAPACITY_MIN_SAMPLES = 6;
/** Don't report projections further out than this — the fit is fantasy by then. */
export const CAPACITY_MAX_FORECAST_DAYS = 730;

export interface CapacitySample {
  /** Epoch ms. */
  t: number;
  v: number;
}

export interface CapacityForecast {
  /** Least-squares growth per day (units/day). Negative = shrinking. */
  slopePerDay: number | null;
  /** Days until the fit reaches `target`, or null when not forecastable. */
  daysUntilTarget: number | null;
}

/** Ordinary least squares over time (days) → intercept + slope. */
export function linearFit(samples: readonly CapacitySample[]): { intercept: number; slopePerDay: number } | null {
  if (samples.length < 2) return null;
  const t0 = samples[0].t;
  const xs = samples.map((s) => (s.t - t0) / 86_400_000);
  const ys = samples.map((s) => s.v);
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  if (den === 0) return null; // all samples at one instant
  const slopePerDay = num / den;
  return { intercept: meanY - slopePerDay * meanX, slopePerDay };
}

/**
 * Forecast days until the trend reaches `target` (e.g. disk total MB).
 * Null when: too few samples, flat/shrinking trend, already at/over target
 * (returns 0), or the projection exceeds the horizon.
 */
export function forecastDaysUntil(
  samples: readonly CapacitySample[],
  target: number,
  nowMs: number,
  minSamples: number = CAPACITY_MIN_SAMPLES
): CapacityForecast {
  if (samples.length < minSamples) return { slopePerDay: null, daysUntilTarget: null };
  const fit = linearFit(samples);
  if (!fit) return { slopePerDay: null, daysUntilTarget: null };

  const current = samples[samples.length - 1].v;
  if (current >= target) return { slopePerDay: fit.slopePerDay, daysUntilTarget: 0 };
  if (fit.slopePerDay <= 0) return { slopePerDay: fit.slopePerDay, daysUntilTarget: null };

  const days = (target - current) / fit.slopePerDay;
  if (!Number.isFinite(days) || days > CAPACITY_MAX_FORECAST_DAYS) {
    return { slopePerDay: fit.slopePerDay, daysUntilTarget: null };
  }
  return { slopePerDay: fit.slopePerDay, daysUntilTarget: Math.max(0, Math.round(days)) };
}

export type CapacityTone = "critical" | "warning" | "ok" | "unknown";

/** Verdict bands for the UI. */
export function capacityVerdict(daysUntilFull: number | null): { tone: CapacityTone; label: string } {
  if (daysUntilFull === null) return { tone: "unknown", label: "no clear trend" };
  if (daysUntilFull <= 0) return { tone: "critical", label: "full now" };
  if (daysUntilFull <= 14) return { tone: "critical", label: `~${daysUntilFull}d until full` };
  if (daysUntilFull <= 45) return { tone: "warning", label: `~${daysUntilFull}d until full` };
  return { tone: "ok", label: `~${daysUntilFull}d headroom` };
}
