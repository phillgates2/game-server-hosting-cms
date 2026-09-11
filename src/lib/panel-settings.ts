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

/** Bounds for each numeric field, enforced on save. */
export const PANEL_SETTING_BOUNDS: Record<
  string,
  { min: number; max: number; label: string }
> = {
  metrics_retention_days: { min: 0, max: 3650, label: "Metrics retention" },
  audit_retention_days: { min: 0, max: 3650, label: "Audit retention" },
  default_max_servers: { min: 0, max: 1000, label: "Default server limit" },
  login_throttle_attempts: { min: 1, max: 100, label: "Login attempts" },
  session_days: { min: 1, max: 365, label: "Session length" },
  // The Australian statutory floor is 16; operators may only raise it.
  minimum_account_age: { min: 16, max: 120, label: "Minimum account age" },
  backup_retention_count: { min: 0, max: 100, label: "Backup retention" },
  // CPU is load-per-core, which can legitimately exceed 100.
  alert_cpu_percent: { min: 0, max: 1000, label: "CPU alert threshold" },
  alert_ram_percent: { min: 0, max: 100, label: "RAM alert threshold" },
  alert_disk_percent: { min: 0, max: 100, label: "Disk alert threshold" },
};

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
  const BOOLEAN_KEYS: Record<string, string> = {
    registration_enabled: "Registration",
    update_auto_backup: "Automatic update backup",
    age_verification_enabled: "Age verification",
    scheduler_discord_notify: "Scheduled task notifications",
  };
  if (key in BOOLEAN_KEYS) {
    if (typeof value === "boolean") return { value: String(value), error: null };
    if (value === "true" || value === "false") return { value: String(value), error: null };
    return { value: null, error: `${BOOLEAN_KEYS[key]} must be on or off` };
  }

  const bounds = PANEL_SETTING_BOUNDS[key];
  if (!bounds) return { value: null, error: `Unknown setting: ${key}` };

  const n = Number(value);
  if (!Number.isInteger(n)) {
    return { value: null, error: `${bounds.label} must be a whole number` };
  }
  if (n < bounds.min || n > bounds.max) {
    return {
      value: null,
      error: `${bounds.label} must be between ${bounds.min} and ${bounds.max}`,
    };
  }
  return { value: String(n), error: null };
}

/** Parse the stored rows into a typed object, applying defaults. */
export function parsePanelSettings(
  rows: ReadonlyArray<{ key: string; value: string | null }>,
  defaults: { metricsRetentionDays: number; auditRetentionDays: number }
): PanelSettings {
  const map = new Map(rows.map((r) => [r.key, r.value]));

  const num = (key: string, fallback: number): number => {
    const raw = map.get(key);
    if (raw === undefined || raw === null || raw === "") return fallback;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };

  return {
    metricsRetentionDays: num("metrics_retention_days", defaults.metricsRetentionDays),
    auditRetentionDays: num("audit_retention_days", defaults.auditRetentionDays),
    defaultMaxServers: num("default_max_servers", 5),
    registrationEnabled: (map.get("registration_enabled") ?? "true") !== "false",
    loginThrottleAttempts: num("login_throttle_attempts", 5),
    sessionDays: num("session_days", 7),
    // Safety net defaults ON: an update without a restore point is the
    // failure mode this feature exists to prevent.
    updateAutoBackup: (map.get("update_auto_backup") ?? "true") !== "false",
    ageVerificationEnabled: (map.get("age_verification_enabled") ?? "true") !== "false",
    minimumAccountAge: num("minimum_account_age", 16),
    schedulerDiscordNotify: (map.get("scheduler_discord_notify") ?? "true") !== "false",
    backupRetentionCount: num("backup_retention_count", 10),
    alertCpuPercent: num("alert_cpu_percent", 90),
    alertRamPercent: num("alert_ram_percent", 90),
    alertDiskPercent: num("alert_disk_percent", 90),
  };
}
