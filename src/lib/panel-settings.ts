/**
 * Operational panel settings.
 *
 * These are deliberately kept out of `/api/site-settings`, whose GET is public
 * and serves the marketing page. Nothing here should be readable by an
 * anonymous visitor, and none of it is about appearance.
 *
 * Every value follows the same precedence as the Discord configuration: the
 * environment provides the base layer, and a row in the `settings` table
 * overrides it, so an operator can change behaviour without editing .env and
 * restarting the process.
 *
 * The file also owns the *registry*: one description per setting (label, help
 * text, bounds, default, and which screen it belongs to). The API validates
 * against it and the settings screen renders from it, so the two can never
 * disagree about what a legal value is — a class of bug the old screen had,
 * where the input's `max` and the server's bound were written out twice.
 */

export const PANEL_SETTING_KEYS = [
  "metrics_retention_days",
  "audit_retention_days",
  "default_max_servers",
  "registration_enabled",
  "login_throttle_attempts",
  "session_days",
  "update_auto_backup",
  "age_verification_enabled",
  "minimum_account_age",
  "scheduler_discord_notify",
  "backup_retention_count",
  "alert_cpu_percent",
  "alert_ram_percent",
  "alert_disk_percent",
] as const;

export type PanelSettingKey = (typeof PANEL_SETTING_KEYS)[number];

export interface PanelSettings {
  /** Days of node/server metric samples to keep. 0 disables pruning. */
  metricsRetentionDays: number;
  /** Days of audit history to keep. 0 disables pruning. */
  auditRetentionDays: number;
  /** Server quota applied to newly registered users. 0 means unlimited. */
  defaultMaxServers: number;
  /** Whether self-registration is open. */
  registrationEnabled: boolean;
  /** Failed logins before an address is throttled. */
  loginThrottleAttempts: number;
  /** Session lifetime in days. */
  sessionDays: number;
  /** Create a backup automatically before running a server update. */
  updateAutoBackup: boolean;
  /** Whether registration requires a date of birth meeting the minimum age. */
  ageVerificationEnabled: boolean;
  /** Minimum age to hold an account. 16 follows Australian law. */
  minimumAccountAge: number;
  /** Post a Discord message when a scheduled task runs. */
  schedulerDiscordNotify: boolean;
  /** Archives kept per server after each backup. 0 keeps everything. */
  backupRetentionCount: number;
  /** Host alert thresholds in %. 0 disables that check. */
  alertCpuPercent: number;
  alertRamPercent: number;
  alertDiskPercent: number;
}

/**
 * Screens that share the panel's single explicit Save button. Sections that
 * save immediately (Discord, webhooks, the IP allowlist…) live only in the UI
 * layer and deliberately do not appear here.
 */
export type PanelSettingsSection =
  | "accounts"
  | "signin"
  | "retention"
  | "automation"
  | "alerts";

export interface PanelSettingField {
  /** Column name in the `settings` table. */
  key: PanelSettingKey;
  /** Property on `PanelSettings`, as used by the API responses and UI. */
  prop: keyof PanelSettings;
  label: string;
  hint: string;
  kind: "number" | "boolean";
  /** Inclusive bounds for numeric fields; ignored for booleans. */
  min?: number;
  max?: number;
  /** Shown after the input, e.g. "days". */
  unit?: string;
  defaultValue: number | boolean;
  section: PanelSettingsSection;
  /** Extra words the settings search should match. */
  keywords?: readonly string[];
}

/**
 * The registry.
 *
 * `Record<PanelSettingKey, …>` makes this exhaustive at compile time: adding a
 * key without describing it is a type error, so the UI can never silently drop
 * a setting — or invent a bound the API does not enforce.
 */
export const PANEL_SETTING_FIELDS: Record<PanelSettingKey, PanelSettingField> = {
  metrics_retention_days: {
    key: "metrics_retention_days",
    prop: "metricsRetentionDays",
    label: "Metrics retention",
    hint: "CPU, RAM and network samples. A busy five-node panel writes around 43,000 rows a day. 0 keeps everything.",
    kind: "number",
    min: 0,
    max: 3650,
    unit: "days",
    defaultValue: 30,
    section: "retention",
    keywords: ["metrics", "history", "graphs", "prune", "monitor"],
  },
  audit_retention_days: {
    key: "audit_retention_days",
    prop: "auditRetentionDays",
    label: "Audit retention",
    hint: "Who did what, and when. Keep this at least as long as your own compliance window. 0 keeps everything.",
    kind: "number",
    min: 0,
    max: 3650,
    unit: "days",
    defaultValue: 365,
    section: "retention",
    keywords: ["audit", "history", "prune", "compliance", "activity"],
  },
  default_max_servers: {
    key: "default_max_servers",
    prop: "defaultMaxServers",
    label: "Default server limit",
    hint: "Applied to new accounts only. Existing accounts keep their current limit. 0 means unlimited.",
    kind: "number",
    min: 0,
    max: 1000,
    unit: "servers",
    defaultValue: 5,
    section: "accounts",
    keywords: ["quota", "limit", "servers", "new users"],
  },
  registration_enabled: {
    key: "registration_enabled",
    prop: "registrationEnabled",
    label: "Allow self-registration",
    hint: "When off, only an administrator can create accounts. Existing users are unaffected.",
    kind: "boolean",
    defaultValue: true,
    section: "accounts",
    keywords: ["signup", "register", "invite", "public signup"],
  },
  login_throttle_attempts: {
    key: "login_throttle_attempts",
    prop: "loginThrottleAttempts",
    label: "Login attempts",
    hint: "Failed sign-ins before an address is temporarily throttled. Lower is stricter.",
    kind: "number",
    min: 1,
    max: 100,
    unit: "attempts",
    defaultValue: 5,
    section: "signin",
    keywords: ["brute force", "throttle", "lockout", "rate limit", "password"],
  },
  session_days: {
    key: "session_days",
    prop: "sessionDays",
    label: "Session length",
    hint: "How long a login lasts before signing out. Shorter is safer on shared machines.",
    kind: "number",
    min: 1,
    max: 365,
    unit: "days",
    defaultValue: 7,
    section: "signin",
    keywords: ["session", "login", "expiry", "cookie", "keep me signed in"],
  },
  update_auto_backup: {
    key: "update_auto_backup",
    prop: "updateAutoBackup",
    label: "Automatic backup before update",
    hint: "The Update button archives the server first. If the backup fails, the update is aborted and no files are changed.",
    kind: "boolean",
    defaultValue: true,
    section: "retention",
    keywords: ["update", "steam", "restore point", "rollback", "safety"],
  },
  age_verification_enabled: {
    key: "age_verification_enabled",
    prop: "ageVerificationEnabled",
    label: "Age verification at registration",
    hint: "New accounts must provide a date of birth and meet the minimum age. Required by Australian law (Online Safety Amendment Act 2024) for platforms with community features.",
    kind: "boolean",
    defaultValue: true,
    section: "accounts",
    keywords: ["age", "dob", "date of birth", "minors", "compliance", "online safety"],
  },
  minimum_account_age: {
    key: "minimum_account_age",
    prop: "minimumAccountAge",
    label: "Minimum account age",
    hint: "Accounts younger than this cannot register. 16 is the Australian legal minimum; it can only be raised.",
    kind: "number",
    min: 16,
    max: 120,
    unit: "years",
    defaultValue: 16,
    section: "accounts",
    keywords: ["age", "dob", "limit", "compliance", "online safety"],
  },
  scheduler_discord_notify: {
    key: "scheduler_discord_notify",
    prop: "schedulerDiscordNotify",
    label: "Announce scheduled tasks in Discord",
    hint: "Posts to the server's Discord webhook (or the panel-wide one) whenever a scheduled restart, backup, update or command runs — including failures.",
    kind: "boolean",
    defaultValue: true,
    section: "automation",
    keywords: ["scheduler", "cron", "restart", "announce", "discord"],
  },
  backup_retention_count: {
    key: "backup_retention_count",
    prop: "backupRetentionCount",
    label: "Backup retention",
    hint: "Archives kept per server after each backup (manual, scheduled or pre-update). 0 keeps them all.",
    kind: "number",
    min: 0,
    max: 100,
    unit: "files",
    defaultValue: 10,
    section: "retention",
    keywords: ["backup", "archive", "prune", "disk", "history"],
  },
  alert_cpu_percent: {
    key: "alert_cpu_percent",
    prop: "alertCpuPercent",
    label: "CPU alert threshold",
    hint: "Load per core as a percentage; multi-core bursts can pass 100. 0 disables the check.",
    kind: "number",
    min: 0,
    max: 1000,
    unit: "%",
    defaultValue: 90,
    section: "alerts",
    keywords: ["alerts", "cpu", "load", "discord", "threshold", "host"],
  },
  alert_ram_percent: {
    key: "alert_ram_percent",
    prop: "alertRamPercent",
    label: "RAM alert threshold",
    hint: "Share of host memory in use (MemAvailable-based). 0 disables the check.",
    kind: "number",
    min: 0,
    max: 100,
    unit: "%",
    defaultValue: 90,
    section: "alerts",
    keywords: ["alerts", "ram", "memory", "discord", "threshold", "host"],
  },
  alert_disk_percent: {
    key: "alert_disk_percent",
    prop: "alertDiskPercent",
    label: "Disk alert threshold",
    hint: "Share of the root filesystem used. 0 disables the check.",
    kind: "number",
    min: 0,
    max: 100,
    unit: "%",
    defaultValue: 90,
    section: "alerts",
    keywords: ["alerts", "disk", "storage", "discord", "threshold", "host"],
  },
};

/** Registry order, used by the UI so screens read the same way every time. */
export const PANEL_SETTING_ORDER: readonly PanelSettingKey[] =
  PANEL_SETTING_KEYS;

/** Bounds for each numeric field, enforced on save. Derived from the registry. */
export const PANEL_SETTING_BOUNDS: Record<
  string,
  { min: number; max: number; label: string }
> = Object.fromEntries(
  PANEL_SETTING_ORDER.filter((key) => PANEL_SETTING_FIELDS[key].kind === "number").map(
    (key) => {
      const field = PANEL_SETTING_FIELDS[key];
      return [key, { min: field.min ?? 0, max: field.max ?? 0, label: field.label }];
    }
  )
);

/** Fields belonging to one screen, in registry order. */
export function fieldsForSection(
  section: PanelSettingsSection
): PanelSettingField[] {
  return PANEL_SETTING_ORDER.map((key) => PANEL_SETTING_FIELDS[key]).filter(
    (field) => field.section === section
  );
}

/** Look up a field, tolerating an arbitrary string (for API input). */
export function panelSettingField(key: string): PanelSettingField | null {
  return Object.prototype.hasOwnProperty.call(PANEL_SETTING_FIELDS, key)
    ? PANEL_SETTING_FIELDS[key as PanelSettingKey]
    : null;
}

/** Every default, as a `PanelSettings` object. */
export function panelSettingsDefaults(
  overrides: Partial<PanelSettings> = {}
): PanelSettings {
  const out: Record<string, unknown> = {};
  for (const key of PANEL_SETTING_ORDER) {
    const field = PANEL_SETTING_FIELDS[key];
    out[field.prop] = field.defaultValue;
  }
  Object.assign(out, overrides);
  return out as unknown as PanelSettings;
}

/**
 * Validate one incoming value.
 *
 * Returns the normalised value, or an error naming the field — a settings
 * screen that silently discards a bad number is worse than one that refuses.
 */
export function validatePanelSetting(
  key: string,
  value: unknown
): { value: string; error: null } | { value: null; error: string } {
  const field = panelSettingField(key);
  if (!field) return { value: null, error: `Unknown setting: ${key}` };

  if (field.kind === "boolean") {
    if (typeof value === "boolean") return { value: String(value), error: null };
    if (value === "true" || value === "false") return { value: value, error: null };
    return { value: null, error: `${field.label} must be on or off` };
  }

  // `Number(null)` and `Number("")` are both 0; neither is a deliberate zero.
  if (value === null || value === undefined || value === "") {
    return { value: null, error: `${field.label} must be a whole number` };
  }
  const n = Number(value);
  if (!Number.isInteger(n)) {
    return { value: null, error: `${field.label} must be a whole number` };
  }
  const min = field.min ?? Number.MIN_SAFE_INTEGER;
  const max = field.max ?? Number.MAX_SAFE_INTEGER;
  if (n < min || n > max) {
    return {
      value: null,
      error: `${field.label} must be between ${min} and ${max}`,
    };
  }
  return { value: String(n), error: null };
}

/**
 * The short, inline version of the same check.
 *
 * The UI already shows the field's label beside the input, so repeating it in
 * the error ("Session length must be…" under a field called Session length)
 * wastes the one line the operator actually reads.
 */
export function fieldErrorMessage(key: string, value: unknown): string | null {
  const field = panelSettingField(key);
  if (!field) return "Unknown setting.";
  if (field.kind === "boolean") {
    return typeof value === "boolean" ? null : "Choose on or off.";
  }
  if (typeof value === "string" && value.trim() === "") return "Enter a value.";
  if (value === null || value === undefined) return "Enter a value.";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return "Enter a whole number.";
  const unit = field.unit ? ` ${field.unit}` : "";
  if (field.min !== undefined && n < field.min) {
    return `Must be at least ${field.min}${unit}.`;
  }
  if (field.max !== undefined && n > field.max) {
    return `Must be at most ${field.max}${unit}.`;
  }
  return null;
}

/** The nearest legal value, for the inline "use 3650" quick fix. */
export function clampPanelSettingValue(
  key: string,
  value: number
): number | null {
  const field = panelSettingField(key);
  if (!field || field.kind !== "number") return null;
  if (!Number.isFinite(value)) return null;
  const whole = Math.round(value);
  const min = field.min ?? whole;
  const max = field.max ?? whole;
  return Math.min(max, Math.max(min, whole));
}

export interface ChangedPanelSetting {
  key: PanelSettingKey;
  prop: keyof PanelSettings;
  label: string;
  from: number | boolean;
  to: number | boolean;
}

/**
 * Which values actually changed between two snapshots.
 *
 * The screen saves only these, and the API audits only these, so two admins
 * editing different screens no longer overwrite each other's work with stale
 * copies of every other field.
 */
export function diffPanelSettings(
  next: PanelSettings,
  saved: PanelSettings
): ChangedPanelSetting[] {
  const changes: ChangedPanelSetting[] = [];
  for (const key of PANEL_SETTING_ORDER) {
    const field = PANEL_SETTING_FIELDS[key];
    const to = next[field.prop];
    const from = saved[field.prop];
    const same =
      to === from ||
      (typeof to === "number" && typeof from === "number" && Number.isNaN(to) && Number.isNaN(from));
    if (same) continue;
    changes.push({ key, prop: field.prop, label: field.label, from, to });
  }
  return changes;
}

/** Build the API payload for a snapshot, optionally only the given keys. */
export function panelSettingsPayload(
  settings: PanelSettings,
  only?: readonly PanelSettingKey[]
): Record<string, number | boolean> {
  const keys = only ?? PANEL_SETTING_ORDER;
  const payload: Record<string, number | boolean> = {};
  for (const key of keys) {
    payload[key] = settings[PANEL_SETTING_FIELDS[key].prop];
  }
  return payload;
}

export interface PanelSettingsInput {
  /** Valid values, ready to persist, keyed by column name. */
  updates: Partial<Record<PanelSettingKey, string>>;
  /** Per-field messages, keyed by column name, for the UI to pin to inputs. */
  errors: Record<string, string>;
  /** Keys that are not panel settings at all. */
  unknown: string[];
}

/** Map both accepted spellings — `session_days` and `sessionDays` — to a key. */
const KEY_ALIASES: Record<string, PanelSettingKey> = Object.fromEntries(
  PANEL_SETTING_ORDER.flatMap((key) => {
    const prop = PANEL_SETTING_FIELDS[key].prop;
    return [
      [key, key],
      [prop, key],
      [key.toLowerCase(), key],
    ];
  })
) as Record<string, PanelSettingKey>;

/**
 * Validate a whole request body in one pass.
 *
 * Returning *every* error rather than the first one means the screen can mark
 * each offending input at once; an operator fixing a form should never have to
 * submit it five times to discover five problems.
 */
export function normalisePanelSettingsInput(input: unknown): PanelSettingsInput {
  const result: PanelSettingsInput = { updates: {}, errors: {}, unknown: [] };
  if (!input || typeof input !== "object" || Array.isArray(input)) return result;

  for (const [rawKey, rawValue] of Object.entries(input as Record<string, unknown>)) {
    if (rawValue === undefined) continue;
    const key = KEY_ALIASES[rawKey] ?? KEY_ALIASES[rawKey.toLowerCase()];
    if (!key) {
      result.unknown.push(rawKey);
      continue;
    }
    const checked = validatePanelSetting(key, rawValue);
    if (checked.error !== null) {
      result.errors[key] = checked.error;
      continue;
    }
    result.updates[key] = checked.value;
  }

  return result;
}

/**
 * Parse the stored rows into a typed object, applying defaults.
 *
 * A stored value that is malformed or outside its bounds falls back to the
 * default instead of being used. A hostile or hand-edited row should never be
 * able to, say, set the session length to one hour or the minimum age to 8.
 */
export function parsePanelSettings(
  rows: ReadonlyArray<{ key: string; value: string | null }>,
  defaults: { metricsRetentionDays: number; auditRetentionDays: number }
): PanelSettings {
  const out = panelSettingsDefaults({
    metricsRetentionDays: defaults.metricsRetentionDays,
    auditRetentionDays: defaults.auditRetentionDays,
  });
  const values = new Map(rows.map((row) => [row.key, row.value]));
  const writable = out as unknown as Record<string, unknown>;

  for (const key of PANEL_SETTING_ORDER) {
    const field = PANEL_SETTING_FIELDS[key];
    const raw = values.get(key);
    if (raw === undefined || raw === null) continue;
    const trimmed = raw.trim();
    if (trimmed === "") continue;

    if (field.kind === "boolean") {
      const normalised = trimmed.toLowerCase();
      if (normalised === "true" || normalised === "1") writable[field.prop] = true;
      else if (normalised === "false" || normalised === "0") writable[field.prop] = false;
      continue;
    }

    const n = Number(trimmed);
    const min = field.min ?? Number.MIN_SAFE_INTEGER;
    const max = field.max ?? Number.MAX_SAFE_INTEGER;
    if (Number.isInteger(n) && n >= min && n <= max) writable[field.prop] = n;
  }

  return out;
}
