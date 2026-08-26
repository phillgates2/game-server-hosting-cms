/**
 * Validation for panel settings stored in the `settings` table.
 *
 * The site-settings endpoint is admin-only, but its upsert path accepted any
 * key and any value: one stray character in a bulk editor save created a
 * junk row, and a 50 MB paste sat in `custom_css` forever. Values that are
 * consumed as JSON (features, nav links) are validated as JSON so a bad
 * save breaks the public site immediately rather than at render time.
 */

/** Same shape the panel has always used: lowercase snake_case. */
const KEY_RE = /^[a-z][a-z0-9_]{0,95}$/;

/** Values are rendered into pages and stored in text columns; a soft cap. */
export const MAX_SETTING_VALUE_LENGTH = 100_000;
/** `custom_css` is inlined into the public page; a tighter cap than the rest. */
export const MAX_CSS_LENGTH = 50_000;

export interface SettingCheck {
  ok: boolean;
  error?: string;
  value?: string;
}

export function isValidSettingKey(key: string): SettingCheck {
  if (typeof key !== "string" || !KEY_RE.test(key)) {
    return {
      ok: false,
      error: `Invalid setting key — use lowercase letters, numbers and underscores (max 96 characters)`,
    };
  }
  return { ok: true };
}

/**
 * Normalise and check a setting value.
 *
 * Keys ending in `_json` or named after the JSON ones must be valid JSON
 * documents (objects or arrays — a bare number is not a feature list).
 * `custom_css` is capped harder: it is inlined into the public page.
 */
export function validateSettingValue(key: string, raw: string): SettingCheck {
  const value = typeof raw === "string" ? raw : String(raw ?? "");
  if (value.length > MAX_SETTING_VALUE_LENGTH) {
    return { ok: false, error: `Value too long (max ${MAX_SETTING_VALUE_LENGTH} characters)` };
  }
  if (key === "custom_css" && value.length > MAX_CSS_LENGTH) {
    return { ok: false, error: `custom_css is limited to ${MAX_CSS_LENGTH} characters` };
  }

  const isJson = /_json$/.test(key) || key === "features_json" || key === "nav_links_json";
  if (isJson) {
    if (value.trim() === "") return { ok: true, value: "" };
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed === null || typeof parsed !== "object") {
        return { ok: false, error: `${key} must be a JSON object or array` };
      }
    } catch {
      return { ok: false, error: `${key} must be valid JSON` };
    }
  }

  return { ok: true, value };
}
