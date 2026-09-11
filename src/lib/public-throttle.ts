/**
 * Throttle for the anonymous endpoints.
 *
 * The public status surface (share links, the board, their JSON twins)
 * deliberately has no auth — the token is the key. But each request can
 * trigger UDP probes of real game servers, so an unauthenticated visitor
 * hammering them becomes a probe storm aimed at the operator's own fleet.
 * This is a per-key sliding-window counter, pure and in-process like the
 * login throttle, that caps how often one client may ask.
 */

export const PUBLIC_THROTTLE_MAX = 30;      // requests…
export const PUBLIC_THROTTLE_WINDOW_MS = 60_000; // …per key per minute

const counters = new Map<string, number[]>();

/** Drop timestamps that fell out of the window so keys cannot grow forever. */
function prune(hits: number[], cutoff: number): number[] {
  return hits.filter((t) => t > cutoff);
}

/**
 * Record a request for `key` and say whether it is allowed. Pure with an
 * injectable clock so the boundary is unit-testable.
 */
export function publicThrottleAllowed(
  key: string,
  now: number = Date.now(),
  max: number = PUBLIC_THROTTLE_MAX,
  windowMs: number = PUBLIC_THROTTLE_WINDOW_MS
): boolean {
  const cutoff = now - windowMs;
  const recent = prune(counters.get(key) ?? [], cutoff);
  if (recent.length >= max) {
    counters.set(key, recent);
    return false;
  }
  recent.push(now);
  counters.set(key, recent);
  return true;
}

/** Test/admin escape hatch: forget a key (or everything). */
export function resetPublicThrottle(key?: string): void {
  if (key === undefined) counters.clear();
  else counters.delete(key);
}
