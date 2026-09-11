/**
 * Rolling restarts: restart a fleet one server at a time, verifying each one
 * actually comes back before touching the next. If a server fails to return,
 * the sweep HALTS — better one dark server than a whole fleet down at once.
 *
 * Pure planning/parsing helpers live here so the behaviour is unit-tested;
 * the batch route wires them to the real per-server process handler.
 */

export interface RollingServer {
  id: number;
  name: string;
  status: string;
}

export interface RollingPlan<T extends RollingServer> {
  /** Restarted one at a time, in the caller's order. */
  eligible: T[];
  /** Left out (not running), each with a human reason. */
  blocked: Array<{ server: T; reason: string }>;
}

/**
 * Only RUNNING servers take part in a rolling restart — restarting a stopped
 * server is a no-op at best and a surprise at worst.
 */
export function planRollingRestart<T extends RollingServer>(servers: T[]): RollingPlan<T> {
  const eligible: T[] = [];
  const blocked: Array<{ server: T; reason: string }> = [];
  for (const server of servers) {
    if (server.status === "running") {
      eligible.push(server);
    } else {
      blocked.push({ server, reason: `status is ${server.status} — not running` });
    }
  }
  return { eligible, blocked };
}

/** Read the rolling flag from a batch request body. */
export function parseRollingFlag(body: unknown): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  return (body as Record<string, unknown>).rolling === true;
}

/**
 * How long a restarted server gets to prove it is alive before we move on.
 * Generous enough to cover slow game-server boots, short enough that a
 * rolling sweep of 20 servers stays under the request timeout.
 */
export const SETTLE_MS = 10_000;

/** Explicit halt decision: any unverified restart stops the sweep. */
export function shouldContinueRolling(lastVerified: boolean): boolean {
  return lastVerified;
}

/** One-line summary for audit/toasts. */
export function formatRollingRestartSummary(input: {
  haltedAt: string | null;
  restarted: number;
  blockedCount: number;
}): string {
  const { haltedAt, restarted, blockedCount } = input;
  if (haltedAt) {
    return `rolling restart HALTED: "${haltedAt}" did not come back — remaining servers untouched`;
  }
  const tail = blockedCount > 0 ? ` (${blockedCount} not running)` : "";
  return `rolling restart complete: ${restarted} restarted${tail}`;
}
