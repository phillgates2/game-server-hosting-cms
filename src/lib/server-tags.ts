/**
 * Server tags: short operator labels for grouping servers ("tf2", "eu",
 * "tournament"). Tags are stored as a JSON string array on the server row
 * and flow through the PATCH allowlist, so validation lives here and is
 * unit-tested in isolation.
 */

export const SERVER_TAGS_MAX_COUNT = 8;
export const SERVER_TAG_MAX_LENGTH = 32;

/** Tags are lower-cased and restricted to a shell/path-safe alphabet. */
export const SERVER_TAG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export interface TagValidation {
  ok: boolean;
  value?: string[];
  error?: string;
}

/**
 * Validate + normalise a tags value from a PATCH body.
 *
 * - arrays of strings only (null clears, empty array clears)
 * - each tag trimmed, lower-cased, pattern-checked
 * - duplicates collapsed, order preserved
 * - at most SERVER_TAGS_MAX_COUNT distinct tags
 */
export function normalizeServerTags(value: unknown): TagValidation {
  if (value === null) return { ok: true, value: [] };
  if (!Array.isArray(value)) return { ok: false, error: "Tags must be an array of strings" };
  if (value.length > SERVER_TAGS_MAX_COUNT * 2) {
    // A grossly oversized array is rejected before any per-item work.
    return { ok: false, error: `A server can have at most ${SERVER_TAGS_MAX_COUNT} tags` };
  }

  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "string") {
      return { ok: false, error: "Tags must be strings" };
    }
    const tag = raw.trim().toLowerCase();
    if (tag.length === 0) continue; // blanks are silently dropped
    if (!SERVER_TAG_PATTERN.test(tag)) {
      return {
        ok: false,
        error: `Invalid tag "${tag.slice(0, 40)}" — use letters, numbers, - and _ (max ${SERVER_TAG_MAX_LENGTH} chars)`,
      };
    }
    if (!seen.has(tag)) {
      seen.add(tag);
      out.push(tag);
    }
  }

  if (out.length > SERVER_TAGS_MAX_COUNT) {
    return { ok: false, error: `A server can have at most ${SERVER_TAGS_MAX_COUNT} tags` };
  }
  return { ok: true, value: out };
}

/** Split a comma-separated editor string into the same normalised form. */
export function tagsFromInput(input: string): TagValidation {
  const parts = input
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return normalizeServerTags(parts);
}

/** Render chips in a stable order for display/filters. */
export function sortTags(tags: string[] | null | undefined): string[] {
  return [...(tags ?? [])].sort();
}
