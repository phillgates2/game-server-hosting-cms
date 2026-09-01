/**
 * Short-lived cache of live server views.
 *
 * The original WolfET bot kept one `server_cache` so `!etwho` within three
 * minutes did not re-query the game. This module is that cache, shared by the
 * chat bot (reads) and the status-board loop (writes), so a board refresh and
 * a `!etwho` in the same window probe the game only once.
 *
 * Pure time-based, single-process — exactly like the login throttle and the
 * auto-restart guard.
 */

import type { BoardView } from "./status-board-embed";

export const STATUS_CACHE_MS = 3 * 60_000;

const cache = new Map<number, { view: BoardView; at: number }>();

export function setCachedView(key: number, view: BoardView, now: number = Date.now()): void {
  cache.set(key, { view, at: now });
}

/** A cached view, or null when absent or older than three minutes. */
export function getCachedView(key: number, now: number = Date.now()): BoardView | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (now - entry.at > STATUS_CACHE_MS) {
    cache.delete(key);
    return null;
  }
  return entry.view;
}

export function isCacheFresh(key: number, now: number = Date.now()): boolean {
  return getCachedView(key, now) !== null;
}

export function clearStatusCache(): void {
  cache.clear();
}

/** Test hook: how many entries are held. */
export function statusCacheSize(): number {
  return cache.size;
}
