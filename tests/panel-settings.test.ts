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

  test("refuses unknown keys rather than storing junk", () => {
    assert.match(String(validatePanelSetting("drop_all_tables", 1).error), /Unknown setting/);
  });

  test("every advertised key validates", () => {
    for (const key of PANEL_SETTING_KEYS) {
      const probe = key === "registration_enabled" ? true : 1;
      assert.equal(
        validatePanelSetting(key, probe).error,
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
