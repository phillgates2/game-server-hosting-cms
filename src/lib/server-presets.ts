/**
 * Server presets: saved one-click setups ("TF2 casual 24-slot").
 *
 * A preset is a game plus pre-filled template variables. Applying one only
 * ever OVERRIDES the template defaults — it cannot inject variables the game
 * template does not declare, which keeps presets from becoming a smuggle
 * route for arbitrary environment at server-creation time.
 */

export const PRESET_NAME_MAX = 128;
export const PRESET_DESCRIPTION_MAX = 500;
/** Hard cap: a preset cannot carry a megabyte of variables. */
export const PRESET_MAX_VARIABLES = 200;
const PRESET_VALUE_MAX = 2000;

export interface PresetValidation {
  ok: boolean;
  error?: string;
  value?: {
    name: string;
    description: string | null;
    gameId: number;
    variables: Record<string, string>;
  };
}

/** Validate + normalise a preset payload from the API. */
export function validatePresetInput(body: unknown): PresetValidation {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Invalid preset payload" };
  }
  const b = body as Record<string, unknown>;

  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) return { ok: false, error: "A preset name is required" };
  if (name.length > PRESET_NAME_MAX) {
    return { ok: false, error: `Preset name must be at most ${PRESET_NAME_MAX} characters` };
  }

  const description =
    typeof b.description === "string" && b.description.trim()
      ? b.description.trim().slice(0, PRESET_DESCRIPTION_MAX)
      : null;

  const gameId = Number(b.gameId);
  if (!Number.isInteger(gameId) || gameId <= 0) {
    return { ok: false, error: "A valid game is required" };
  }

  const rawVars = b.variables;
  const variables: Record<string, string> = {};
  if (rawVars !== undefined && rawVars !== null) {
    if (typeof rawVars !== "object" || Array.isArray(rawVars)) {
      return { ok: false, error: "Variables must be an object" };
    }
    const entries = Object.entries(rawVars as Record<string, unknown>);
    if (entries.length > PRESET_MAX_VARIABLES) {
      return { ok: false, error: `A preset can carry at most ${PRESET_MAX_VARIABLES} variables` };
    }
    for (const [key, value] of entries) {
      // Only declared template variables belong in a preset; the wizard
      // filters by this set on apply anyway, but refuse junk up front.
      if (!/^[A-Z0-9_]{1,64}$/.test(key)) {
        return { ok: false, error: `Invalid variable name: ${key}` };
      }
      const str = typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : null;
      if (str === null) return { ok: false, error: `Variable ${key} must be a string, number or boolean` };
      if (str.length > PRESET_VALUE_MAX) {
        return { ok: false, error: `Variable ${key} is too long` };
      }
      variables[key] = str;
    }
  }

  return { ok: true, value: { name, description, gameId, variables } };
}

/** Hard cap on presets accepted by one import request. */
export const PRESET_IMPORT_MAX = 20;

export interface PresetImportResult {
  ok: boolean;
  error?: string;
  value?: Array<{
    name: string;
    description: string | null;
    gameId: number;
    variables: Record<string, string>;
  }>;
}

/**
 * Validate an import payload: `{ presets: [ ... ] }`. Every item goes through
 * the same validation as a single preset, so an import can never smuggle
 * anything a manual save could not.
 */
export function validatePresetImport(body: unknown): PresetImportResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Invalid import payload" };
  }
  const list = (body as Record<string, unknown>).presets;
  if (!Array.isArray(list)) return { ok: false, error: "presets must be an array" };
  if (list.length === 0) return { ok: false, error: "No presets to import" };
  if (list.length > PRESET_IMPORT_MAX) {
    return { ok: false, error: `Import at most ${PRESET_IMPORT_MAX} presets at a time` };
  }
  const out: NonNullable<PresetImportResult["value"]> = [];
  for (const item of list) {
    const res = validatePresetInput(item);
    if (!res.ok || !res.value) return { ok: false, error: res.error || "Invalid preset in import" };
    out.push(res.value);
  }
  return { ok: true, value: out };
}

/**
 * Apply preset overrides on top of template defaults. Keys the template does
 * not declare are dropped — never passed through to the environment.
 */
export function mergePresetVariables(
  defaults: Record<string, string>,
  presetVariables: Record<string, string>,
  declared: ReadonlySet<string>
): Record<string, string> {
  const out: Record<string, string> = { ...defaults };
  for (const [key, value] of Object.entries(presetVariables)) {
    if (declared.has(key)) out[key] = value;
  }
  return out;
}
