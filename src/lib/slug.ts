/**
 * URL slug generation.
 *
 * Six call sites each rolled their own regex pair, and they disagreed. The
 * game-import and CMS versions collapsed runs of punctuation ("My Game!!" ->
 * "my-game"), while the custom-game version replaced each character
 * individually and only stripped ONE leading and ONE trailing dash, so:
 *
 *   "My Game!!"  -> "my-game-"    trailing dash
 *   "  spaced  " -> "-spaced-"    leading AND trailing dash
 *   "a  b"       -> "a--b"        doubled separator
 *
 * Worse, every site validated the caller's raw input and then normalized it,
 * so "-" or "   " passed the "slug is required" check and became the empty
 * string. An empty slug makes the row unreachable by slug and permanently
 * occupies the unique index, blocking every later empty-slug insert.
 */

/**
 * Default cap, matching the narrowest slug column (game_definitions,
 * varchar(64)). Forum categories allow 128 and CMS pages 256, so those
 * callers pass their own limit rather than being silently truncated.
 */
export const MAX_SLUG_LENGTH = 64;

/**
 * Convert arbitrary text into a URL-safe slug.
 *
 * Lowercases, collapses every run of non-alphanumerics into a single dash,
 * and trims dashes from both ends. Returns "" when the input has nothing
 * slug-worthy in it (e.g. "---" or an emoji) - callers must treat that as
 * invalid rather than storing it.
 */
export function slugify(
  input: string | null | undefined,
  maxLength: number = MAX_SLUG_LENGTH
): string {
  if (!input) return "";
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    // A trim-then-slice can leave a trailing dash when the cut lands mid-run.
    .replace(/-+$/g, "");
}

/**
 * Slugify and report whether the result is usable.
 *
 * Use this at API boundaries so the "required" check runs against what will
 * actually be stored, not against the raw input.
 */
export function toValidSlug(
  input: string | null | undefined,
  maxLength: number = MAX_SLUG_LENGTH
): string | null {
  const slug = slugify(input, maxLength);
  return slug.length > 0 ? slug : null;
}
