/**
 * Disaster-recovery export/import — the pure half.
 *
 * An export is a JSON snapshot of panel settings, presets and schedules,
 * plus *reference* copies of server/node metadata (no secrets). Import is
 * deliberately conservative:
 *
 *  - settings: only the known panel-settings keys — never the access gate,
 *    webhook config, or anything security-critical;
 *  - presets: each item goes through the exact same validation as a manual
 *    save;
 *  - schedules: restart/backup/update tasks only — command tasks execute
 *    shell and are never imported;
 *  - servers and nodes are exported for reference/re-scripting, not
 *    re-created (their files live on disk, not in this JSON).
 */

import { parseCron } from "./cron";
import { validatePresetInput } from "./server-presets";

export const PANEL_EXPORT_KIND = "panel-export";
export const IMPORT_MAX_SETTINGS = 100;
export const IMPORT_MAX_PRESETS = 50;
export const IMPORT_MAX_TASKS = 100;

/** The only settings an import may touch (mirrors panel-settings). */
export const IMPORTABLE_SETTING_KEYS = new Set([
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
]);

export const IMPORTABLE_TASK_TYPES = new Set(["restart", "backup", "update"]);

export interface ImportableSetting {
  key: string;
  value: string;
}

export interface ImportableTask {
  serverName: string;
  taskType: string;
  cronExpression: string;
  enabled: boolean;
}

export interface PanelImportValidation {
  ok: boolean;
  error?: string;
  value?: {
    settings: ImportableSetting[];
    skippedSettings: number;
    presets: Array<{ name: string; description: string | null; gameId: number; variables: Record<string, string> }>;
    tasks: ImportableTask[];
    skippedTasks: number;
  };
}

/** Validate a panel-export JSON body for import. */
export function validatePanelImport(body: unknown): PanelImportValidation {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Invalid import payload" };
  }
  const b = body as Record<string, unknown>;
  if (b.kind !== PANEL_EXPORT_KIND) {
    return { ok: false, error: "Not a GameServer Manager panel export" };
  }

  const settings: ImportableSetting[] = [];
  let skippedSettings = 0;
  if (b.settings !== undefined) {
    if (!Array.isArray(b.settings) || b.settings.length > IMPORT_MAX_SETTINGS) {
      return { ok: false, error: `settings must be an array of at most ${IMPORT_MAX_SETTINGS}` };
    }
    for (const item of b.settings) {
      if (!item || typeof item !== "object") return { ok: false, error: "Each setting must be an object" };
      const { key, value } = item as Record<string, unknown>;
      if (typeof key !== "string" || !IMPORTABLE_SETTING_KEYS.has(key)) {
        skippedSettings += 1;
        continue;
      }
      if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
        skippedSettings += 1;
        continue;
      }
      settings.push({ key, value: String(value).slice(0, 500) });
    }
  }

  const presets: NonNullable<PanelImportValidation["value"]>["presets"] = [];
  if (b.presets !== undefined) {
    if (!Array.isArray(b.presets) || b.presets.length > IMPORT_MAX_PRESETS) {
      return { ok: false, error: `presets must be an array of at most ${IMPORT_MAX_PRESETS}` };
    }
    for (const item of b.presets) {
      const res = validatePresetInput(item);
      if (!res.ok || !res.value) {
        return { ok: false, error: `Invalid preset in import: ${res.error || "unknown"}` };
      }
      presets.push(res.value);
    }
  }

  const tasks: ImportableTask[] = [];
  let skippedTasks = 0;
  if (b.scheduledTasks !== undefined) {
    if (!Array.isArray(b.scheduledTasks) || b.scheduledTasks.length > IMPORT_MAX_TASKS) {
      return { ok: false, error: `scheduledTasks must be an array of at most ${IMPORT_MAX_TASKS}` };
    }
    for (const item of b.scheduledTasks) {
      if (!item || typeof item !== "object") return { ok: false, error: "Each task must be an object" };
      const t = item as Record<string, unknown>;
      if (
        typeof t.serverName !== "string" ||
        t.serverName.length === 0 ||
        t.serverName.length > 128 ||
        typeof t.taskType !== "string" ||
        !IMPORTABLE_TASK_TYPES.has(t.taskType) ||
        typeof t.cronExpression !== "string" ||
        !parseCron(t.cronExpression)
      ) {
        skippedTasks += 1;
        continue;
      }
      tasks.push({
        serverName: t.serverName.trim(),
        taskType: t.taskType,
        cronExpression: t.cronExpression.trim().slice(0, 64),
        enabled: t.enabled !== false,
      });
    }
  }

  return { ok: true, value: { settings, skippedSettings, presets, tasks, skippedTasks } };
}
