/**
 * Batch process operations: one click to start/stop/restart every server in
 * the current panel view (e.g. everything tagged "tournament").
 *
 * Pure validation and partitioning live here; the route delegates each
 * server to the real per-server process handler so every existing rail —
 * ownership, permissions, crash-loop breaker, remote-node dispatch, Discord
 * notifications — applies unchanged.
 */

export const BATCH_MAX_SIZE = 25;

export const BATCH_ACTIONS = ["start", "stop", "restart"] as const;
export type BatchAction = (typeof BATCH_ACTIONS)[number];

export interface BatchValidation {
  ok: boolean;
  error?: string;
  value?: { action: BatchAction; serverIds: number[] };
}

/** Validate + normalise a batch request body. */
export function validateBatchRequest(body: unknown): BatchValidation {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Invalid batch payload" };
  }
  const b = body as Record<string, unknown>;

  const action = b.action;
  if (typeof action !== "string" || !(BATCH_ACTIONS as readonly string[]).includes(action)) {
    return { ok: false, error: "Action must be start, stop or restart" };
  }

  const raw = b.serverIds;
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: "serverIds must be a non-empty array" };
  }
  if (raw.length > BATCH_MAX_SIZE * 2) {
    // Reject grossly oversized payloads before any per-item work.
    return { ok: false, error: `A batch can contain at most ${BATCH_MAX_SIZE} servers` };
  }

  const seen = new Set<number>();
  const ids: number[] = [];
  for (const item of raw) {
    const n = typeof item === "string" ? Number(item) : item;
    if (typeof n !== "number" || !Number.isInteger(n) || n <= 0) {
      return { ok: false, error: "Every serverId must be a positive integer" };
    }
    if (!seen.has(n)) {
      seen.add(n);
      ids.push(n);
    }
  }

  if (ids.length > BATCH_MAX_SIZE) {
    return { ok: false, error: `A batch can contain at most ${BATCH_MAX_SIZE} servers` };
  }
  return { ok: true, value: { action: action as BatchAction, serverIds: ids } };
}

export interface BatchIdsValidation {
  ok: boolean;
  error?: string;
  value?: number[];
}

/**
 * Validate only the id array of a batch body (no action verb) — used by
 * batch operations like batch-update where the verb is the endpoint itself.
 * Shares the dedupe / positivity / cap rules of validateBatchRequest.
 */
export function validateBatchServerIds(body: unknown, maxSize: number = BATCH_MAX_SIZE): BatchIdsValidation {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Invalid batch payload" };
  }
  const raw = (body as Record<string, unknown>).serverIds;
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: "serverIds must be a non-empty array" };
  }
  if (raw.length > maxSize * 2) {
    return { ok: false, error: `A batch can contain at most ${maxSize} servers` };
  }
  const seen = new Set<number>();
  const ids: number[] = [];
  for (const item of raw) {
    const n = typeof item === "string" ? Number(item) : item;
    if (typeof n !== "number" || !Number.isInteger(n) || n <= 0) {
      return { ok: false, error: "Every serverId must be a positive integer" };
    }
    if (!seen.has(n)) {
      seen.add(n);
      ids.push(n);
    }
  }
  if (ids.length > maxSize) {
    return { ok: false, error: `A batch can contain at most ${maxSize} servers` };
  }
  return { ok: true, value: ids };
}

export interface BatchServerRow {
  id: number;
  name: string;
  userId: number | null;
}

/**
 * Split requested ids into servers the caller may act on and the rest.
 * Unknown ids and other users' servers (for non-admins) are skipped rather
 * than acted on; the caller is told which ids were skipped.
 */
export function partitionBatch<T extends BatchServerRow>(
  rows: T[],
  requestedIds: number[],
  isAdmin: boolean,
  userId: number
): { dispatchable: T[]; skippedIds: number[] } {
  const byId = new Map<number, T>(rows.map((r) => [r.id, r]));
  const dispatchable: T[] = [];
  const skippedIds: number[] = [];
  for (const id of requestedIds) {
    const row = byId.get(id);
    if (!row) {
      skippedIds.push(id);
      continue;
    }
    if (!isAdmin && row.userId !== userId) {
      skippedIds.push(id);
      continue;
    }
    dispatchable.push(row);
  }
  return { dispatchable, skippedIds };
}
