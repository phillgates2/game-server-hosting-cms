/**
 * Throttle for the anonymous endpoints.
 *
 * The public status surface (share links, the board, their JSON twins)
 * deliberately has no auth — the token is the key. But each request can
 * trigger UDP probes of real game servers, so an unauthenticated visitor
 * hammering them becomes a probe storm aimed at the operator's own fleet.
 * This is a per-key sliding-window counter, pure and in-process like the
 * login throttle, that caps how often one client may ask.
 *
 * Memory: every distinct key (an IP, a share token) gets an entry. Entries
 * whose window has fully elapsed are swept at most once per window, so the
 * map is bounded by the number of distinct clients seen in the last window
 * rather than growing for the life of the process.
 */

export const PUBLIC_THROTTLE_MAX = 30;      // requests…
export const PUBLIC_THROTTLE_WINDOW_MS = 60_000; // …per key per minute

const counters = new Map<string, number[]>();
/** When the last full sweep ran; sweeps are amortised to once per window. */
let lastSweep = 0;

/** Drop timestamps that fell out of the window so keys cannot grow forever. */
function prune(hits: number[], cutoff: number): number[] {
  return hits.filter((t) => t > cutoff);
}

/**
 * Forget every key with no hit inside the window. Cheap enough to run once
 * per window; the cutoff is the same one the caller uses for its own check.
 */
function sweep(now: number, windowMs: number): void {
  const cutoff = now - windowMs;
  for (const [key, hits] of counters) {
    // Hits are appended in time order, so the last one is the newest.
    const newest = hits[hits.length - 1];
    if (newest === undefined || newest <= cutoff) counters.delete(key);
  }
  lastSweep = now;
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
  if (now - lastSweep >= windowMs) sweep(now, windowMs);

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
  if (key === undefined) {
    counters.clear();
    lastSweep = 0;
  } else counters.delete(key);
}

/** Test hook: how many keys are currently held. */
export function publicThrottleSize(): number {
  return counters.size;
}
