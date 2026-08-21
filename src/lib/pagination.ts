/**
 * Query-parameter parsing for list endpoints.
 *
 * `parseInt(searchParams.get("limit") || "100")` has three failure modes that
 * all reached the database:
 *
 *   ?limit=abc        -> NaN, which Postgres rejects with a syntax error
 *   ?limit=-1         -> negative LIMIT, also a SQL error
 *   ?limit=999999999  -> reads the entire table into memory
 *
 * The last one is the dangerous one: on a busy panel `audit_log` and
 * `node_metrics` grow without bound, so a single request can exhaust server
 * memory. These helpers always return a sane integer inside a fixed ceiling.
 */

/** Largest page size any list endpoint will serve. */
export const MAX_LIMIT = 500;

/** Largest offset accepted, to stop absurd deep-paging scans. */
export const MAX_OFFSET = 1_000_000;

/**
 * Parse a positive integer query parameter, clamped to [min, max].
 * Returns `fallback` when the value is missing, non-numeric or NaN.
 */
export function intParam(
  value: string | null | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (value === null || value === undefined || value.trim() === "") return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

/** Standard `?limit=` handling for a list endpoint. */
export function limitParam(
  params: URLSearchParams,
  fallback = 100,
  max: number = MAX_LIMIT
): number {
  return intParam(params.get("limit"), fallback, 1, max);
}

/** Standard `?offset=` handling for a list endpoint. */
export function offsetParam(params: URLSearchParams, fallback = 0): number {
  return intParam(params.get("offset"), fallback, 0, MAX_OFFSET);
}

/** Standard 1-based `?page=` handling. */
export function pageParam(params: URLSearchParams, fallback = 1): number {
  return intParam(params.get("page"), fallback, 1, MAX_OFFSET);
}
