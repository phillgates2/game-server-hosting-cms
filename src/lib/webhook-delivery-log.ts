/**
 * Webhook delivery log: fire-and-forget dispatch used to be a black box —
 * admins had no way to see whether events were actually reaching their
 * endpoint. Every dispatch attempt now lands in a small in-memory ring
 * buffer the Settings panel can inspect.
 *
 * In-memory on purpose: it's diagnostics, not history — it resets on
 * restart and never needs a table.
 */

export const DELIVERY_LOG_MAX = 50;

export interface DeliveryEntry {
  atMs: number;
  action: string;
  attempted: boolean;
  ok: boolean;
  status: number | null;
  error: string | null;
}

/** Pure capped append: newest LAST, never longer than max. */
export function pushDelivery(
  entries: readonly DeliveryEntry[],
  entry: DeliveryEntry,
  max: number = DELIVERY_LOG_MAX
): DeliveryEntry[] {
  const next = [...entries, entry];
  return next.length > max ? next.slice(next.length - max) : next;
}

let ring: DeliveryEntry[] = [];

/** Record one attempt (server-side only). */
export function recordWebhookDelivery(entry: DeliveryEntry): void {
  ring = pushDelivery(ring, entry);
}

/** Newest-first for display. */
export function recentWebhookDeliveries(limit: number = 10): DeliveryEntry[] {
  return ring.slice(-Math.max(0, limit)).reverse();
}

/** Compact one-liner for the panel. */
export function formatDeliveryLine(entry: DeliveryEntry): string {
  const when = new Date(entry.atMs).toLocaleTimeString();
  if (!entry.attempted) return `${when} · ${entry.action} · skipped (${entry.error ?? "not configured"})`;
  if (entry.ok) return `${when} · ${entry.action} · delivered (HTTP ${entry.status})`;
  return `${when} · ${entry.action} · failed${entry.status !== null ? ` (HTTP ${entry.status})` : ""}${entry.error ? ` — ${entry.error}` : ""}`;
}
