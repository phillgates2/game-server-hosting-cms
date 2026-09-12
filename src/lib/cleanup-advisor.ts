/**
 * Fleet cleanup advisor: spot abandoned servers so a human can decide.
 *
 * Strictly ADVISORY — nothing here ever deletes anything. A server becomes
 * a candidate only when it has been stopped for a long time AND nobody has
 * played on it in the sample window. Ephemeral (TTL) servers are exempt:
 * the sweeper already owns their lifecycle.
 */

export const CLEANUP_CANDIDATE_STOPPED_DAYS = 14;
export const CLEANUP_REVIEW_STOPPED_DAYS = 7;
export const CLEANUP_SAMPLE_WINDOW_DAYS = 14;

export type CleanupLevel = "healthy" | "review" | "candidate";

export interface CleanupAssessmentInput {
  status: string;
  lastStoppedMs: number | null;
  /** Newest player-sample timestamp for this server, if any. */
  lastSampleMs: number | null;
  /** Ephemeral servers (expiresAt set) are managed by the TTL sweeper. */
  isEphemeral: boolean;
}

export interface CleanupAssessment {
  level: CleanupLevel;
  reason: string;
}

/** Pure assessment relative to `nowMs`. */
export function assessServerForCleanup(
  input: CleanupAssessmentInput,
  nowMs: number
): CleanupAssessment {
  if (input.isEphemeral) {
    return { level: "healthy", reason: "ephemeral — the TTL sweeper owns this lifecycle" };
  }
  if (input.status === "running" || input.status === "installing") {
    return { level: "healthy", reason: `${input.status}` };
  }

  const stoppedMs = input.lastStoppedMs ?? nowMs; // unknown: assume recent, be conservative
  const stoppedDays = Math.max(0, Math.floor((nowMs - stoppedMs) / 86_400_000));
  const sampleWindowMs = CLEANUP_SAMPLE_WINDOW_DAYS * 86_400_000;
  const hadRecentPlayers = input.lastSampleMs !== null && nowMs - input.lastSampleMs <= sampleWindowMs;

  if (hadRecentPlayers) {
    return { level: "healthy", reason: "players sampled recently — not abandoned" };
  }
  if (stoppedDays >= CLEANUP_CANDIDATE_STOPPED_DAYS) {
    return {
      level: "candidate",
      reason: `stopped ${stoppedDays}d ago with no players sampled in ${CLEANUP_SAMPLE_WINDOW_DAYS}d`,
    };
  }
  if (stoppedDays >= CLEANUP_REVIEW_STOPPED_DAYS) {
    return { level: "review", reason: `stopped ${stoppedDays}d ago — worth a look soon` };
  }
  return { level: "healthy", reason: `stopped ${stoppedDays}d ago` };
}
