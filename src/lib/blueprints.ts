/**
 * Blueprints: reusable multi-server deploy definitions built on presets.
 *
 * A blueprint is a list of entries — each "deploy preset P, N times, naming
 * them with this pattern". Deploying one creates real servers through the
 * normal create path, so quotas, ports, paths and permissions all apply.
 *
 * Pure validation/expansion lives here so the behaviour is unit-tested.
 */

export const BLUEPRINT_NAME_MAX = 128;
export const BLUEPRINT_DESCRIPTION_MAX = 500;
export const BLUEPRINT_MAX_ENTRIES = 10;
/** Per-entry copies — a blueprint is a fleet helper, not a fork bomb. */
export const BLUEPRINT_MAX_PER_ENTRY = 5;
/** Hard cap across the whole blueprint. */
export const BLUEPRINT_MAX_TOTAL = 15;
export const BLUEPRINT_NAME_PATTERN_MAX = 100;

export interface BlueprintEntryInput {
  presetId: number;
  count: number;
  namePattern: string | null;
}

export interface BlueprintValidation {
  ok: boolean;
  error?: string;
  value?: {
    name: string;
    description: string | null;
    entries: BlueprintEntryInput[];
  };
}

/** Validate + normalise a blueprint payload from the API. */
export function validateBlueprintInput(body: unknown): BlueprintValidation {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Invalid blueprint payload" };
  }
  const b = body as Record<string, unknown>;

  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) return { ok: false, error: "A blueprint name is required" };
  if (name.length > BLUEPRINT_NAME_MAX) {
    return { ok: false, error: `Blueprint name must be at most ${BLUEPRINT_NAME_MAX} characters` };
  }

  const description =
    typeof b.description === "string" && b.description.trim()
      ? b.description.trim().slice(0, BLUEPRINT_DESCRIPTION_MAX)
      : null;

  const rawEntries = b.entries;
  if (!Array.isArray(rawEntries) || rawEntries.length === 0) {
    return { ok: false, error: "A blueprint needs at least one entry" };
  }
  if (rawEntries.length > BLUEPRINT_MAX_ENTRIES) {
    return { ok: false, error: `A blueprint can have at most ${BLUEPRINT_MAX_ENTRIES} entries` };
  }

  const entries: BlueprintEntryInput[] = [];
  let total = 0;
  for (const raw of rawEntries) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, error: "Every entry must be an object" };
    }
    const e = raw as Record<string, unknown>;
    const presetId = Number(e.presetId);
    if (!Number.isInteger(presetId) || presetId <= 0) {
      return { ok: false, error: "Every entry needs a valid presetId" };
    }
    const count = e.count === undefined ? 1 : Number(e.count);
    if (!Number.isInteger(count) || count < 1 || count > BLUEPRINT_MAX_PER_ENTRY) {
      return { ok: false, error: `Each entry can deploy at most ${BLUEPRINT_MAX_PER_ENTRY} copies` };
    }
    let namePattern: string | null = null;
    if (e.namePattern !== undefined && e.namePattern !== null) {
      if (typeof e.namePattern !== "string") {
        return { ok: false, error: "namePattern must be a string" };
      }
      namePattern = e.namePattern.trim().slice(0, BLUEPRINT_NAME_PATTERN_MAX) || null;
    }
    total += count;
    if (total > BLUEPRINT_MAX_TOTAL) {
      return { ok: false, error: `A blueprint can deploy at most ${BLUEPRINT_MAX_TOTAL} servers in total` };
    }
    entries.push({ presetId, count, namePattern });
  }

  return { ok: true, value: { name, description, entries } };
}

/**
 * Expand entries into the flat deploy order (entry order, then copy order).
 * Pure: trusts already-validated entries but re-checks the total cap so a
 * hand-crafted object can never smuggle a fork bomb past validation.
 */
export function expandBlueprintEntries(
  entries: BlueprintEntryInput[]
): { ok: true; plan: Array<{ presetId: number; ordinal: number }> } | { ok: false; error: string } {
  const plan: Array<{ presetId: number; ordinal: number }> = [];
  for (const entry of entries) {
    for (let i = 0; i < entry.count; i++) {
      plan.push({ presetId: entry.presetId, ordinal: plan.length + 1 });
      if (plan.length > BLUEPRINT_MAX_TOTAL) {
        return { ok: false, error: `A blueprint can deploy at most ${BLUEPRINT_MAX_TOTAL} servers in total` };
      }
    }
  }
  return { ok: true, plan };
}

/**
 * Render the display name for one deployed server.
 * `{n}` in the pattern becomes the ordinal; no pattern falls back to
 * "PresetName #n". Result is trimmed and length-capped.
 */
export function blueprintServerName(
  pattern: string | null,
  presetName: string,
  ordinal: number
): string {
  const base = pattern && pattern.trim() ? pattern.replace(/\{n\}/g, String(ordinal)).trim() : "";
  const name = base || `${presetName || "Server"} #${ordinal}`;
  return name.slice(0, 100);
}

/** Idempotent — upgrades predate the table. */
export async function ensureServerBlueprintsTable(): Promise<void> {
  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS server_blueprints (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      name VARCHAR(128) NOT NULL,
      description TEXT,
      entries JSONB NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
}
