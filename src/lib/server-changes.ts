/**
 * Field-level change history for servers: who changed what, from what, to
 * what. The diff is computed from the pre-PATCH row versus the final
 * normalised updates — identical values never produce a row.
 */

export const CHANGE_VALUE_MAX = 2_000;
export const CHANGE_LIST_MAX = 50;

export interface ServerChange {
  field: string;
  from: string;
  to: string;
}

/** Render any stored value as a compact string for the history row. */
export function renderChangeValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/** Two values are "the same" when their rendered forms match. */
export function sameChangeValue(a: unknown, b: unknown): boolean {
  return renderChangeValue(a) === renderChangeValue(b);
}

/**
 * Diff the pre-PATCH row against the incoming updates. Only fields present
 * in `updates` are considered; unchanged values are skipped; rendered values
 * are capped so a giant blob cannot blow up the history table.
 */
export function diffServerPatch(
  before: Record<string, unknown>,
  updates: Record<string, unknown>
): ServerChange[] {
  const changes: ServerChange[] = [];
  for (const [field, to] of Object.entries(updates)) {
    if (to === undefined) continue;
    const from = before[field];
    if (sameChangeValue(from, to)) continue;
    changes.push({
      field: field.slice(0, 64),
      from: renderChangeValue(from).slice(0, CHANGE_VALUE_MAX),
      to: renderChangeValue(to).slice(0, CHANGE_VALUE_MAX),
    });
  }
  return changes;
}
