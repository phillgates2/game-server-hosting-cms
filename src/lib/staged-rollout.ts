/**
 * Staged rollouts: update one canary server first, verify it actually boots
 * on the new build, and only then sweep the rest of the batch.
 *
 * Pure planning + parsing helpers live here so the behaviour is unit-tested;
 * the batch-update route wires them to the real per-server handlers so every
 * existing rail (ownership, permissions, backups, remote dispatch) applies.
 *
 * Contract (mirrors plain batch-update):
 *   - only "stopped" servers are eligible; anything else is blocked with a
 *     reason instead of being silently dropped;
 *   - the canary is the FIRST eligible server in the caller's order;
 *   - if the canary update fails, or the canary does not survive its boot
 *     verification window, the rollout HALTS — the rest stay untouched.
 */

export interface RolloutServer {
  id: number;
  name: string;
  status: string;
}

export interface RolloutPlan<T extends RolloutServer> {
  /** First eligible server — updated and boot-verified before anything else. */
  canary: T | null;
  /** Everyone swept after the canary proves the build boots. */
  rest: T[];
  /** Servers left out of the rollout, each with a human reason. */
  blocked: Array<{ server: T; reason: string }>;
}

/**
 * Split the batch into canary / rest / blocked.
 * Only "stopped" servers are eligible — the per-server update handler
 * requires a stopped server, and boot verification needs a clean start.
 */
export function planStagedRollout<T extends RolloutServer>(servers: T[]): RolloutPlan<T> {
  const eligible: T[] = [];
  const blocked: Array<{ server: T; reason: string }> = [];
  for (const server of servers) {
    if (server.status === "stopped") {
      eligible.push(server);
    } else if (server.status === "installing") {
      blocked.push({ server, reason: "already installing" });
    } else {
      blocked.push({ server, reason: `status is ${server.status} — stop it first` });
    }
  }
  const canary = eligible.length > 0 ? eligible[0] : null;
  return { canary, rest: eligible.slice(1), blocked };
}

/** Read the staged flag from a batch-update request body. */
export function parseStagedFlag(body: unknown): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  return (body as Record<string, unknown>).staged === true;
}

/**
 * How long the canary must stay alive after boot before we trust the build.
 * Short enough to keep rollouts snappy, long enough to catch crash-on-start.
 */
export const BOOT_GRACE_MS = 10_000;

export type RolloutHaltReason = "canary-update-failed" | "canary-boot-failed" | null;

/**
 * Decide whether to sweep the rest of the batch.
 * Both the update itself AND surviving the boot grace window must pass.
 */
export function shouldSweepRest(canaryUpdateOk: boolean, canaryBootAlive: boolean): boolean {
  return canaryUpdateOk && canaryBootAlive;
}

/** One-line audit/summary of a staged rollout outcome. */
export function formatRolloutSummary(input: {
  canaryName: string;
  halted: RolloutHaltReason;
  updated: number;
  failed: number;
  blockedCount: number;
}): string {
  const { canaryName, halted, updated, failed, blockedCount } = input;
  if (halted === "canary-update-failed") {
    return `staged rollout HALTED: canary "${canaryName}" failed to update — fleet untouched`;
  }
  if (halted === "canary-boot-failed") {
    return `staged rollout HALTED: canary "${canaryName}" updated but did not survive boot verification — fleet untouched`;
  }
  const tail = blockedCount > 0 ? ` (${blockedCount} blocked)` : "";
  return `staged rollout complete: canary "${canaryName}" verified, ${updated} updated${failed > 0 ? `, ${failed} failed` : ""}${tail}`;
}
