/**
 * Metric anomaly detection: a rolling z-score that answers "is this reading
 * weird for this node?" Pure math, unit-tested.
 *
 * Deliberately conservative: a point is only scored once enough history
 * exists, near-flat series are never flagged (zero variance means nothing is
 * anomalous), and spikes must clear a high threshold. False alarms erode
 * trust faster than missed ones.
 */

export interface MetricSample {
  t: number;
  v: number;
}

export interface AnomalyPoint extends MetricSample {
  z: number;
}

export interface AnomalyOptions {
  /** Baseline window: how many previous samples describe "normal". */
  window?: number;
  /** |z| at/above which a point is anomalous. */
  threshold?: number;
  /** Minimum baseline size before scoring starts. */
  minSamples?: number;
}

export const ANOMALY_DEFAULT_WINDOW = 40;
export const ANOMALY_DEFAULT_THRESHOLD = 3.5;
export const ANOMALY_MIN_SAMPLES = 12;
/** Below this spread the series is "flat" and nothing can be anomalous. */
const FLAT_SERIES_STD = 0.5;

export function detectAnomalies(
  samples: readonly MetricSample[],
  opts: AnomalyOptions = {}
): AnomalyPoint[] {
  const window = opts.window ?? ANOMALY_DEFAULT_WINDOW;
  const threshold = opts.threshold ?? ANOMALY_DEFAULT_THRESHOLD;
  const minSamples = opts.minSamples ?? ANOMALY_MIN_SAMPLES;

  const out: AnomalyPoint[] = [];
  for (let i = 0; i < samples.length; i++) {
    const baseline = samples.slice(Math.max(0, i - window), i);
    if (baseline.length < minSamples) continue;

    const mean = baseline.reduce((a, s) => a + s.v, 0) / baseline.length;
    const variance = baseline.reduce((a, s) => a + (s.v - mean) ** 2, 0) / baseline.length;
    const std = Math.sqrt(variance);
    if (std < FLAT_SERIES_STD) continue; // flat series: no anomaly concept

    const z = (samples[i].v - mean) / std;
    if (Math.abs(z) >= threshold) {
      out.push({ t: samples[i].t, v: samples[i].v, z: Math.round(z * 100) / 100 });
    }
  }
  return out;
}

/** Verdict wording for the UI. */
export function describeAnomalies(count: number): string | null {
  if (count <= 0) return null;
  return `${count} unusual spike${count === 1 ? "" : "s"} in this window`;
}
