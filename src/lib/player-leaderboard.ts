/**
 * Player leaderboard: who's the busiest server in the fleet, from the
 * player-count samples the idle-detection probes already collect.
 *
 * Pure aggregation is unit-tested; the route feeds it raw samples.
 */

export interface LeaderboardSample {
  serverId: number;
  players: number;
  recordedAtMs: number;
}

export interface LeaderboardStats {
  serverId: number;
  peakPlayers: number;
  avgPlayers: number;
  sampleCount: number;
  lastSeenMs: number;
}

/**
 * Aggregate samples per server. peak = max observed, avg over all samples,
 * lastSeen = newest sample time. Servers with zero samples don't appear.
 */
export function aggregateLeaderboard(samples: LeaderboardSample[]): LeaderboardStats[] {
  const byServer = new Map<number, { peak: number; sum: number; count: number; last: number }>();
  for (const s of samples) {
    if (!Number.isFinite(s.players) || s.players < 0) continue; // garbage-proof
    const cur = byServer.get(s.serverId);
    if (!cur) {
      byServer.set(s.serverId, { peak: s.players, sum: s.players, count: 1, last: s.recordedAtMs });
    } else {
      cur.peak = Math.max(cur.peak, s.players);
      cur.sum += s.players;
      cur.count += 1;
      cur.last = Math.max(cur.last, s.recordedAtMs);
    }
  }
  return Array.from(byServer.entries()).map(([serverId, v]) => ({
    serverId,
    peakPlayers: v.peak,
    avgPlayers: Math.round((v.sum / v.count) * 10) / 10,
    sampleCount: v.count,
    lastSeenMs: v.last,
  }));
}

export type LeaderboardSort = "peak" | "average";

/** Rank stats; ties break on the other metric, then serverId for stability. */
export function rankLeaderboard(stats: LeaderboardStats[], sortBy: LeaderboardSort, topN: number): LeaderboardStats[] {
  const sorted = [...stats].sort((a, b) => {
    if (sortBy === "peak") {
      if (b.peakPlayers !== a.peakPlayers) return b.peakPlayers - a.peakPlayers;
      if (b.avgPlayers !== a.avgPlayers) return b.avgPlayers - a.avgPlayers;
    } else {
      if (b.avgPlayers !== a.avgPlayers) return b.avgPlayers - a.avgPlayers;
      if (b.peakPlayers !== a.peakPlayers) return b.peakPlayers - a.peakPlayers;
    }
    return a.serverId - b.serverId;
  });
  return sorted.slice(0, Math.max(0, topN));
}

export const LEADERBOARD_DEFAULT_DAYS = 7;
export const LEADERBOARD_MAX_DAYS = 30;
export const LEADERBOARD_TOP_N = 10;

export function clampLeaderboardDays(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1) return LEADERBOARD_DEFAULT_DAYS;
  return Math.min(Math.floor(n), LEADERBOARD_MAX_DAYS);
}
