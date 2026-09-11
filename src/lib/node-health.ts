/**
 * Node health scoring for the smart node picker.
 *
 * Pure functions only: given a node's latest heartbeat metrics and its server
 * count, decide how attractive it is for a new server and what to warn about.
 * The panel and the wizard share these so the recommendation logic lives in
 * exactly one place.
 */

/** Metrics older than this are treated as stale (agent/node went quiet). */
export const FRESH_METRIC_AGE_MS = 10 * 60_000;
/** A node with less free disk than this is not eligible for new servers. */
export const MIN_FREE_DISK_MB = 2_048;
/** A node with less free RAM than this is not eligible for new servers. */
export const MIN_FREE_RAM_MB = 512;
/** Warn when disk usage crosses this fraction. */
export const DISK_WARNING_USED_FRACTION = 0.9;

export interface NodeLoad {
  cpuPercent: number | null;
  ramUsedMb: number | null;
  ramTotalMb: number | null;
  diskUsedMb: number | null;
  diskTotalMb: number | null;
  /** Epoch ms of the heartbeat that produced these numbers. */
  recordedAt: number | null;
}

export interface NodeCandidate {
  id: number;
  online: boolean;
  load: NodeLoad | null;
  serverCount: number;
  /** Maintenance mode: never eligible for new servers. */
  maintenance?: boolean;
}

export function diskFreeMb(load: NodeLoad | null): number | null {
  if (!load || load.diskTotalMb == null || load.diskUsedMb == null) return null;
  return Math.max(0, load.diskTotalMb - load.diskUsedMb);
}

export function ramFreeMb(load: NodeLoad | null): number | null {
  if (!load || load.ramTotalMb == null || load.ramUsedMb == null) return null;
  return Math.max(0, load.ramTotalMb - load.ramUsedMb);
}

export function isMetricFresh(load: NodeLoad | null, nowMs: number): boolean {
  return load?.recordedAt != null && nowMs - load.recordedAt <= FRESH_METRIC_AGE_MS;
}

/**
 * Lower is better. Infinity means "do not place new servers here".
 *
 * Weighting rationale: disk pressure matters most (installs fail badly),
 * RAM next (game servers are RAM-hungry), CPU least (bursts are normal),
 * and existing server count is a mild spread-out nudge.
 */
export function scoreNode(candidate: NodeCandidate, nowMs: number): number {
  if (!candidate.online) return Infinity;
  if (candidate.maintenance) return Infinity;

  let score = candidate.serverCount * 4;
  const { load } = candidate;

  if (!load || !isMetricFresh(load, nowMs)) {
    // Unknown or stale: treat as mediocre rather than disqualifying, so a
    // single quiet node can still be picked when it is the only option.
    return score + 30;
  }

  const dfree = diskFreeMb(load);
  if (dfree !== null && dfree < MIN_FREE_DISK_MB) return Infinity;
  const rfree = ramFreeMb(load);
  if (rfree !== null && rfree < MIN_FREE_RAM_MB) return Infinity;

  if (load.cpuPercent != null) score += Math.max(0, Math.min(100, load.cpuPercent));
  if (load.ramTotalMb && load.ramUsedMb != null) {
    score += (Math.max(0, load.ramUsedMb) / load.ramTotalMb) * 100 * 1.5;
  }
  if (load.diskTotalMb && load.diskUsedMb != null) {
    score += (Math.max(0, load.diskUsedMb) / load.diskTotalMb) * 100 * 2;
  }
  return score;
}

/**
 * The least-loaded online node, or null when there is no candidate at all.
 * Every online node yields an answer (even a penalised one) so the wizard
 * always has something to suggest; Infinity-scored nodes are skipped.
 */
export function recommendNodeId(candidates: NodeCandidate[], nowMs: number): number | null {
  let bestId: number | null = null;
  let bestScore = Infinity;
  for (const c of candidates) {
    const s = scoreNode(c, nowMs);
    if (s < bestScore) {
      bestScore = s;
      bestId = c.id;
    }
  }
  return bestId;
}

/** Human-readable cautions about placing a server on this node. */
export function nodeWarnings(candidate: NodeCandidate, nowMs: number): string[] {
  const out: string[] = [];
  if (candidate.maintenance) out.push("🔧 Under maintenance — new servers are blocked");
  const { load } = candidate;
  if (!load) return out;

  if (load.diskTotalMb && load.diskUsedMb != null) {
    const usedFrac = load.diskUsedMb / load.diskTotalMb;
    if (usedFrac >= DISK_WARNING_USED_FRACTION) {
      out.push(`Disk nearly full (${Math.round(usedFrac * 100)}% used)`);
    }
  }
  const rfree = ramFreeMb(load);
  if (rfree !== null && rfree < 1_024) {
    out.push(`Only ${Math.round(rfree)} MB RAM free`);
  }
  if (!isMetricFresh(load, nowMs) && load.recordedAt != null) {
    const mins = Math.max(1, Math.round((nowMs - load.recordedAt) / 60_000));
    out.push(`Metrics stale (last heartbeat ~${mins} min ago)`);
  }
  return out;
}

/** Short human load summary for option labels: "CPU 12% · RAM 3.1/16 GB". */
export function nodeLoadLabel(load: NodeLoad | null): string | null {
  if (!load) return null;
  const parts: string[] = [];
  if (load.cpuPercent != null) parts.push(`CPU ${Math.round(load.cpuPercent)}%`);
  if (load.ramTotalMb && load.ramUsedMb != null) {
    parts.push(`RAM ${(load.ramUsedMb / 1024).toFixed(1)}/${(load.ramTotalMb / 1024).toFixed(1)} GB`);
  }
  if (load.diskTotalMb && load.diskUsedMb != null) {
    parts.push(`Disk ${Math.round((load.diskUsedMb / load.diskTotalMb) * 100)}%`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}
