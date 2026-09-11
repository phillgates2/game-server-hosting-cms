/**
 * Tests for the Settings panel and the Discord channel backfill.
 *
 * Both encode rules that decide whether something destructive happens, so the
 * decision logic lives in pure modules that can be exercised without a
 * database or a Discord token.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  validatePanelSetting,
  parsePanelSettings,
  PANEL_SETTING_KEYS,
} from "../src/lib/panel-settings";
import {
  planForServer,
  summarise,
  describeSummary,
  type BackfillOutcome,
} from "../src/lib/discord-backfill";

describe("panel setting validation", () => {
  test("accepts sensible retention windows", () => {
    assert.deepEqual(validatePanelSetting("metrics_retention_days", 30), {
      value: "30",
      error: null,
    });
    assert.deepEqual(validatePanelSetting("audit_retention_days", "365"), {
      value: "365",
      error: null,
    });
  });

  test("0 is allowed and means 'keep forever'", () => {
    // Distinct from rejecting the value: 0 disables pruning.
    assert.equal(validatePanelSetting("metrics_retention_days", 0).error, null);
    assert.equal(validatePanelSetting("default_max_servers", 0).error, null);
  });

  test("rejects values that would silently break pruning", () => {
    assert.match(String(validatePanelSetting("metrics_retention_days", -1).error), /between/);
    assert.match(String(validatePanelSetting("metrics_retention_days", 1.5).error), /whole number/);
    assert.match(String(validatePanelSetting("metrics_retention_days", "abc").error), /whole number/);
    assert.match(String(validatePanelSetting("metrics_retention_days", 99999).error), /between/);
  });

  test("names the field in the error, so the UI can show it directly", () => {
    assert.match(String(validatePanelSetting("session_days", 0).error), /^Session length/);
    assert.match(String(validatePanelSetting("login_throttle_attempts", 0).error), /^Login attempts/);
  });

  test("a session length of zero is refused", () => {
    // Would log everyone out instantly.
    assert.notEqual(validatePanelSetting("session_days", 0).error, null);
    assert.equal(validatePanelSetting("session_days", 1).error, null);
  });

  test("a login limit of zero is refused", () => {
    // Would lock every account out on the first attempt.
    assert.notEqual(validatePanelSetting("login_throttle_attempts", 0).error, null);
  });

  test("registration accepts booleans and their string forms", () => {
    assert.deepEqual(validatePanelSetting("registration_enabled", true), { value: "true", error: null });
    assert.deepEqual(validatePanelSetting("registration_enabled", "false"), { value: "false", error: null });
    assert.notEqual(validatePanelSetting("registration_enabled", "maybe").error, null);
  });

  test("update_auto_backup and age_verification_enabled are boolean settings", () => {
    assert.deepEqual(validatePanelSetting("update_auto_backup", true), { value: "true", error: null });
    assert.deepEqual(validatePanelSetting("update_auto_backup", "false"), { value: "false", error: null });
    assert.match(String(validatePanelSetting("update_auto_backup", "maybe").error), /on or off/);
    assert.deepEqual(validatePanelSetting("age_verification_enabled", false), { value: "false", error: null });
    assert.match(String(validatePanelSetting("age_verification_enabled", 1).error), /on or off/);
  });

  test("minimum_account_age cannot go below the Australian floor of 16", () => {
    // The law sets 16; operators may raise the bar, never lower it.
    assert.equal(validatePanelSetting("minimum_account_age", 16).error, null);
    assert.equal(validatePanelSetting("minimum_account_age", 21).error, null);
    assert.match(String(validatePanelSetting("minimum_account_age", 15).error), /between 16 and 120/);
    assert.match(String(validatePanelSetting("minimum_account_age", 121).error), /between 16 and 120/);
    assert.match(String(validatePanelSetting("minimum_account_age", 16.5).error), /whole number/);
  });

  test("refuses unknown keys rather than storing junk", () => {
    assert.match(String(validatePanelSetting("drop_all_tables", 1).error), /Unknown setting/);
  });

  test("every advertised key validates", () => {
    const probeFor = (key: string): unknown => {
      if (
        key === "registration_enabled" ||
        key === "update_auto_backup" ||
        key === "age_verification_enabled" ||
        key === "scheduler_discord_notify"
      ) {
        return true;
      }
      if (key === "minimum_account_age") return 16;
      if (key === "backup_retention_count") return 10;
      return 1;
    };
    for (const key of PANEL_SETTING_KEYS) {
      assert.equal(
        validatePanelSetting(key, probeFor(key)).error,
        null,
        `${key} should accept a valid value`
      );
    }
  });
});

describe("parsing stored settings", () => {
  const defaults = { metricsRetentionDays: 30, auditRetentionDays: 365 };

  test("falls back to the environment defaults when unset", () => {
    const p = parsePanelSettings([], defaults);
    assert.equal(p.metricsRetentionDays, 30);
    assert.equal(p.auditRetentionDays, 365);
    assert.equal(p.registrationEnabled, true, "registration open unless turned off");
    assert.equal(p.defaultMaxServers, 5);
  });

  test("a stored value overrides the environment", () => {
    const p = parsePanelSettings(
      [{ key: "metrics_retention_days", value: "7" }],
      defaults
    );
    assert.equal(p.metricsRetentionDays, 7);
    assert.equal(p.auditRetentionDays, 365, "untouched keys keep their default");
  });

  test("keeps a stored 0 rather than treating it as absent", () => {
    // The bug this guards against: `value || fallback` would turn a
    // deliberate 0 back into 30 and quietly re-enable pruning.
    const p = parsePanelSettings(
      [{ key: "metrics_retention_days", value: "0" }],
      defaults
    );
    assert.equal(p.metricsRetentionDays, 0);
  });

  test("ignores corrupt rows instead of crashing", () => {
    const p = parsePanelSettings(
      [
        { key: "metrics_retention_days", value: "not-a-number" },
        { key: "audit_retention_days", value: null },
        { key: "session_days", value: "" },
      ],
      defaults
    );
    assert.equal(p.metricsRetentionDays, 30);
    assert.equal(p.auditRetentionDays, 365);
    assert.equal(p.sessionDays, 7);
  });

  test("registration is only off when explicitly 'false'", () => {
    assert.equal(
      parsePanelSettings([{ key: "registration_enabled", value: "false" }], defaults)
        .registrationEnabled,
      false
    );
    assert.equal(
      parsePanelSettings([{ key: "registration_enabled", value: "true" }], defaults)
        .registrationEnabled,
      true
    );
  });

  test("safety-net defaults: pre-update backup on, age gate on at 16", () => {
    // Both protections must be active on a fresh install without any
    // configuration: an unconfigured panel is exactly the one that needs
    // the safety nets most.
    const p = parsePanelSettings([], defaults);
    assert.equal(p.updateAutoBackup, true);
    assert.equal(p.ageVerificationEnabled, true);
    assert.equal(p.minimumAccountAge, 16);
  });

  test("stored overrides for the update-backup and age settings", () => {
    const p = parsePanelSettings(
      [
        { key: "update_auto_backup", value: "false" },
        { key: "age_verification_enabled", value: "false" },
        { key: "minimum_account_age", value: "18" },
      ],
      defaults
    );
    assert.equal(p.updateAutoBackup, false);
    assert.equal(p.ageVerificationEnabled, false);
    assert.equal(p.minimumAccountAge, 18);
  });

  test("a corrupt minimum-age row falls back to 16, never below", () => {
    const p = parsePanelSettings(
      [{ key: "minimum_account_age", value: "junk" }],
      defaults
    );
    assert.equal(p.minimumAccountAge, 16);
  });

  test("backup retention: defaults to 10, accepts 0 (keep all), rejects nonsense", () => {
    assert.equal(parsePanelSettings([], defaults).backupRetentionCount, 10);
    assert.equal(
      parsePanelSettings([{ key: "backup_retention_count", value: "0" }], defaults).backupRetentionCount,
      0,
      "a stored 0 means keep everything and must survive parsing"
    );
    assert.equal(validatePanelSetting("backup_retention_count", 25).error, null);
    assert.match(String(validatePanelSetting("backup_retention_count", -1).error), /between 0 and 100/);
    assert.match(String(validatePanelSetting("backup_retention_count", 101).error), /between 0 and 100/);
  });

  test("scheduled-task Discord notifications default on and can be silenced", () => {
    assert.equal(parsePanelSettings([], defaults).schedulerDiscordNotify, true);
    assert.equal(
      parsePanelSettings([{ key: "scheduler_discord_notify", value: "false" }], defaults)
        .schedulerDiscordNotify,
      false
    );
    assert.deepEqual(validatePanelSetting("scheduler_discord_notify", true), { value: "true", error: null });
    assert.match(String(validatePanelSetting("scheduler_discord_notify", "maybe").error), /on or off/);
  });
});

describe("Discord backfill planning", () => {
  test("creates a channel for a server that has neither", () => {
    const plan = planForServer({
      id: 1,
      name: "Old Server",
      discordWebhook: null,
      discordChannelId: null,
    });
    assert.deepEqual(plan, { kind: "create", reason: "no channel" });
  });

  test("verifies a channel the panel already provisioned", () => {
    // It may have been deleted in Discord, which the panel cannot see.
    const plan = planForServer({
      id: 2,
      name: "Has Channel",
      discordWebhook: "https://discord.com/api/webhooks/1/tok",
      discordChannelId: "555000111",
    });
    assert.deepEqual(plan, { kind: "verify" });
  });

  test("never touches a hand-entered webhook", () => {
    // The panel does not own that channel; replacing it would silently
    // redirect someone's notifications.
    const plan = planForServer({
      id: 3,
      name: "Manual Hook",
      discordWebhook: "https://discord.com/api/webhooks/9/tok",
      discordChannelId: null,
    });
    assert.equal(plan.kind, "skip");
    assert.match(String((plan as { reason: string }).reason), /did not create/);
  });
});

describe("backfill summary", () => {
  const results: BackfillOutcome[] = [
    { serverId: 1, serverName: "a", status: "created" },
    { serverId: 2, serverName: "b", status: "recreated" },
    { serverId: 3, serverName: "c", status: "ok" },
    { serverId: 4, serverName: "d", status: "skipped" },
    { serverId: 5, serverName: "e", status: "failed" },
  ];

  test("counts each outcome", () => {
    const s = summarise(results);
    assert.equal(s.scanned, 5);
    assert.equal(s.created, 1);
    assert.equal(s.recreated, 1);
    assert.equal(s.alreadyOk, 1);
    assert.equal(s.skipped, 1);
    assert.equal(s.failed, 1);
  });

  test("describes the run in words an operator can act on", () => {
    const text = describeSummary(summarise(results));
    assert.match(text, /1 created/);
    assert.match(text, /1 re-created/);
    assert.match(text, /1 failed/);
  });

  test("says so plainly when there was nothing to do", () => {
    assert.equal(describeSummary(summarise([])), "No servers to check.");
  });

  test("omits zero counts rather than listing them", () => {
    const text = describeSummary(
      summarise([{ serverId: 1, serverName: "a", status: "created" }])
    );
    assert.equal(text, "1 created");
  });
});
