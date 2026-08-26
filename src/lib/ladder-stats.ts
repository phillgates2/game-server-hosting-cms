/**
 * Numeric validation for league ladder statistics.
 *
 * The ladder columns are Postgres integers. `Number("abc")` is NaN and
 * `Number("1.5")` a float — both blow up at insert/update time as a 500
 * instead of a useful 400, while negative or absurdly large values were
 * accepted outright and silently corrupted standings. Every stat goes
 * through this one validator.
 */

/** Wins/losses/draws/streak — a million of any of them is already absurd. */
export const MAX_LADDER_COUNT = 1_000_000;
/** Points — kept under int4's 2.1B ceiling with room to spare. */
export const MAX_LADDER_POINTS = 1_000_000_000;

/**
 * Parse one ladder stat from untrusted input.
 *
 * Returns `fallback` when the caller omitted the field, a validated whole
 * number when it is sane, and `null` when the input is garbage — callers
 * turn `null` into a 400 naming the field.
 */
export function parseLadderStat(
  raw: unknown,
  fallback: number,
  max: number = MAX_LADDER_COUNT
): number | null {
  if (raw === undefined || raw === null || raw === "") return fallback;
  // Number(true) is 1 and Number([]) is 0; both are nonsense here.
  if (typeof raw === "boolean" || (typeof raw === "object" && raw !== null)) return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > max) return null;
  return n;
}

/** Field-specific 400 message. */
export function ladderStatError(field: string, max: number = MAX_LADDER_COUNT): string {
  return `${field} must be a whole number between 0 and ${max}`;
}
