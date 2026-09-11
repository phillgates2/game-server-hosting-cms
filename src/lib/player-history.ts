/**
 * Player-count history math: the peak-hours heatmap that answers "when does
 * my community actually play?" Pure so the bucketing is unit-tested.
 */

export interface PlayerSample {
  /** Epoch ms. */
  ts: number;
  players: number;
}

export interface HeatmapCell {
  /** 0=Sunday … 6=Saturday (JS convention). */
  day: number;
  /** 0-23 local hour. */
  hour: number;
  /** Average players across samples in this cell. */
  avg: number;
  samples: number;
}

export interface PlayerHeatmap {
  cells: HeatmapCell[];
  peak: HeatmapCell | null;
  totalSamples: number;
}

/**
 * Average players per (day, hour) bucket. Empty buckets are omitted (the UI
 * renders them as "no data", NOT zero players).
 */
export function buildHeatmap(samples: readonly PlayerSample[]): PlayerHeatmap {
  const sums = new Map<string, { sum: number; n: number }>();
  for (const s of samples) {
    if (!Number.isFinite(s.ts) || !Number.isFinite(s.players) || s.players < 0) continue;
    const d = new Date(s.ts);
    const key = `${d.getDay()}:${d.getHours()}`;
    const cell = sums.get(key) ?? { sum: 0, n: 0 };
    cell.sum += s.players;
    cell.n += 1;
    sums.set(key, cell);
  }

  const cells: HeatmapCell[] = [];
  for (const [key, { sum, n }] of sums) {
    const [dayStr, hourStr] = key.split(":");
    cells.push({
      day: Number(dayStr),
      hour: Number(hourStr),
      avg: Math.round((sum / n) * 100) / 100,
      samples: n,
    });
  }
  cells.sort((a, b) => a.day - b.day || a.hour - b.hour);

  let peak: HeatmapCell | null = null;
  for (const c of cells) {
    // Require a couple of sightings so one lucky probe cannot crown a peak.
    if (c.samples >= 2 && (peak === null || c.avg > peak.avg)) peak = c;
  }

  return { cells, peak, totalSamples: samples.length };
}

export const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** "Fri 19:00" style label for the peak cell. */
export function describePeak(peak: HeatmapCell | null): string | null {
  if (!peak) return null;
  return `${DAY_LABELS[peak.day]} ${String(peak.hour).padStart(2, "0")}:00`;
}
