/**
 * Tests for disaster-recovery import validation.
 *
 * The import must stay conservative: unknown/security settings dropped,
 * presets fully validated, command tasks never importable, and junk cron
 * expressions skipped.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  validatePanelImport,
  IMPORTABLE_SETTING_KEYS,
  PANEL_EXPORT_KIND,
} from "../src/lib/panel-export";

const base = { app: "game-server-manager", kind: PANEL_EXPORT_KIND, exportedAt: "2026-01-01T00:00:00Z" };

describe("validatePanelImport — envelope", () => {
  test("rejects non-exports", () => {
    assert.equal(validatePanelImport(null).ok, false);
    assert.equal(validatePanelImport([]).ok, false);
    assert.equal(validatePanelImport({ kind: "something-else" }).ok, false);
    assert.equal(validatePanelImport({ ...base, kind: "server-presets" }).ok, false);
  });

  test("accepts an empty export", () => {
    const res = validatePanelImport(base);
    assert.equal(res.ok, true);
    assert.deepEqual(res.value?.settings, []);
    assert.deepEqual(res.value?.presets, []);
    assert.deepEqual(res.value?.tasks, []);
  });
});

describe("settings import", () => {
  test("whitelisted keys pass, everything else is skipped", () => {
    const res = validatePanelImport({
      ...base,
      settings: [
        { key: "backup_retention_count", value: 7 },
        { key: "registration_enabled", value: "false" },
        { key: "outbound_webhook_url", value: "http://evil.example" },
        { key: "accessGateEnabled", value: "false" },
        { key: "made_up_key", value: "x" },
      ],
    });
    assert.equal(res.ok, true);
    assert.deepEqual(res.value?.settings.map((s) => s.key), ["backup_retention_count", "registration_enabled"]);
    assert.equal(res.value?.skippedSettings, 3);
  });

  test("security-sensitive keys are never importable", () => {
    assert.equal(IMPORTABLE_SETTING_KEYS.has("outbound_webhook_url"), false);
    assert.equal(IMPORTABLE_SETTING_KEYS.has("outbound_webhook_secret"), false);
    assert.equal(IMPORTABLE_SETTING_KEYS.has("accessGateEnabled"), false);
    assert.equal(IMPORTABLE_SETTING_KEYS.has("installed"), false);
  });

  test("oversized settings arrays are rejected", () => {
    const many = Array.from({ length: 101 }, (_, i) => ({ key: "session_days", value: String(i) }));
    assert.equal(validatePanelImport({ ...base, settings: many }).ok, false);
  });
});

describe("preset import", () => {
  test("each preset goes through full validation", () => {
    const good = validatePanelImport({
      ...base,
      presets: [{ name: "TF2", gameId: 7, variables: { MAX_PLAYERS: "24" } }],
    });
    assert.equal(good.ok, true);
    assert.equal(good.value?.presets.length, 1);

    const bad = validatePanelImport({
      ...base,
      presets: [{ name: "", gameId: 7 }],
    });
    assert.equal(bad.ok, false);
  });
});

describe("task import", () => {
  test("restart/backup/update with valid cron import; command never does", () => {
    const res = validatePanelImport({
      ...base,
      scheduledTasks: [
        { serverName: "TF2 #1", taskType: "restart", cronExpression: "0 4 * * *", enabled: true },
        { serverName: "TF2 #1", taskType: "backup", cronExpression: "30 3 * * *", enabled: false },
        { serverName: "evil", taskType: "command", cronExpression: "* * * * *", command: "rm -rf /" },
        { serverName: "junk", taskType: "restart", cronExpression: "not cron" },
      ],
    });
    assert.equal(res.ok, true);
    assert.deepEqual(res.value?.tasks.map((t) => t.taskType), ["restart", "backup"]);
    assert.equal(res.value?.tasks[1].enabled, false);
    assert.equal(res.value?.skippedTasks, 2);
  });

  test("oversized task arrays are rejected", () => {
    const many = Array.from({ length: 101 }, () => ({ serverName: "s", taskType: "restart", cronExpression: "0 4 * * *" }));
    assert.equal(validatePanelImport({ ...base, scheduledTasks: many }).ok, false);
  });
});
