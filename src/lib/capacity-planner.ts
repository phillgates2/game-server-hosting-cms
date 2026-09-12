/**
 * Fleet capacity planner: "can this node host 10 more TF2 servers?"
 *
 * Answers with conservative per-game footprints (RAM/disk) against the
 * node's real usage and configured limits. Pure math, unit-tested.
 */

export interface GameFootprint {
  ramMb: number;
  diskMb: number;
}

/**
 * Conservative planning footprints by game slug. These are planning
 * estimates (game files + typical runtime), not guarantees — deliberately
 * rounded up so the planner under-promises.
 */
export const GAME_FOOTPRINT_DEFAULTS: Record<string, GameFootprint> = {
  tf2: { ramMb: 2_000, diskMb: 20_000 },
  gmod: { ramMb: 2_500, diskMb: 15_000 },
  l4d2: { ramMb: 1_500, diskMb: 14_000 },
  "core-keeper": { ramMb: 3_000, diskMb: 4_000 },
  unturned: { ramMb: 3_000, diskMb: 8_000 },
  "vintage-story": { ramMb: 2_000, diskMb: 2_000 },
  mindustry: { ramMb: 1_000, diskMb: 1_000 },
  terraria: { ramMb: 700, diskMb: 1_000 },
};

/** Unknown games get a generic mid-weight estimate. */
export const DEFAULT_GAME_FOOTPRINT: GameFootprint = { ramMb: 2_000, diskMb: 10_000 };

export function footprintForSlug(slug: string | null | undefined): GameFootprint {
  if (slug && GAME_FOOTPRINT_DEFAULTS[slug]) return GAME_FOOTPRINT_DEFAULTS[slug];
  return DEFAULT_GAME_FOOTPRINT;
}

export interface NodeCapacityInput {
  maxRamMb: number | null;
  maxDiskMb: number | null;
  maxServers: number | null;
  usedRamMb: number | null;
  usedDiskMb: number | null;
  serverCount: number;
}

export interface CapacityEstimate {
  /** How many MORE servers of this game fit (0 = full). */
  fits: number;
  /** Which resource(s) produced the binding limit. */
  limiters: string[];
  /** True when usage data was missing and the answer is slots-only. */
  approximate: boolean;
}

/**
 * Headroom per resource, floored at zero; a null limit means "unbounded".
 * The smallest non-null headroom wins; ties list every binding limiter.
 */
export function estimateCapacity(node: NodeCapacityInput, footprint: GameFootprint): CapacityEstimate {
  const headrooms: Array<{ name: string; count: number }> = [];

  if (node.maxServers !== null && node.maxServers > 0) {
    headrooms.push({ name: "server slots", count: Math.max(0, node.maxServers - node.serverCount) });
  }
  let approximate = false;
  if (node.maxRamMb !== null && node.maxRamMb > 0) {
    const used = node.usedRamMb ?? 0;
    if (node.usedRamMb === null) approximate = true;
    headrooms.push({ name: "RAM", count: Math.max(0, Math.floor((node.maxRamMb - used) / footprint.ramMb)) });
  }
  if (node.maxDiskMb !== null && node.maxDiskMb > 0) {
    const used = node.usedDiskMb ?? 0;
    if (node.usedDiskMb === null) approximate = true;
    headrooms.push({ name: "disk", count: Math.max(0, Math.floor((node.maxDiskMb - used) / footprint.diskMb)) });
  }

  if (headrooms.length === 0) {
    return { fits: Infinity, limiters: [], approximate };
  }

  const min = Math.min(...headrooms.map((h) => h.count));
  const limiters = headrooms.filter((h) => h.count === min).map((h) => h.name);
  return { fits: min, limiters, approximate };
}

/** Human answer for the UI/toasts. */
export function formatCapacityAnswer(input: {
  nodeName: string;
  gameName: string;
  estimate: CapacityEstimate;
}): string {
  const { nodeName, gameName, estimate } = input;
  if (estimate.fits === Infinity) {
    return `${nodeName} has no configured limits — it will take as many ${gameName} servers as you throw at it${estimate.approximate ? " (usage data missing)" : ""}.`;
  }
  if (estimate.fits === 0) {
    return `${nodeName} is full for ${gameName} — limited by ${estimate.limiters.join(" and ")}.`;
  }
  const approx = estimate.approximate ? " (usage data missing — slots/limits only)" : "";
  return `${nodeName} fits ~${estimate.fits} more ${gameName} server${estimate.fits === 1 ? "" : "s"} (limited by ${estimate.limiters.join(" and ")})${approx}.`;
}
