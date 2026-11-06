/**
 * The panel-settings registry and the save-time validation built on it.
 *
 * The registry is the single description of every operational setting: label,
 * help text, bounds, default and screen. The API validates against it and the
 * Settings UI renders from it, so these tests guard the properties both rely
 * on — exhaustiveness, sane defaults, and errors that identify the field.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  PANEL_SETTING_BOUNDS,
  PANEL_SETTING_FIELDS,
  PANEL_SETTING_KEYS,
  PANEL_SETTING_ORDER,
  PANEL_SETTING_FIELDS as FIELDS,
  clampPanelSettingValue,
  diffPanelSettings,
  fieldErrorMessage,
  fieldsForSection,
  normalisePanelSettingsInput,
  panelSettingField,
  panelSettingsDefaults,
  panelSettingsPayload,
  parsePanelSettings,
  validatePanelSetting,
  type PanelSettings,
  type PanelSettingsSection,
} from "../src/lib/panel-settings";

const SECTIONS: PanelSettingsSection[] = [
  "accounts",
  "signin",
  "retention",
  "automation",
  "alerts",
];

describe("settings registry", () => {
  test("describes every key exactly once", () => {
    assert.equal(PANEL_SETTING_ORDER.length, PANEL_SETTING_KEYS.length);
    assert.equal(new Set(PANEL_SETTING_ORDER).size, PANEL_SETTING_KEYS.length);
    for (const key of PANEL_SETTING_KEYS) {
      const field = PANEL_SETTING_FIELDS[key];
      assert.equal(field.key, key, `${key} must know its own column name`);
      assert.ok(field.label.trim().length > 0, `${key} needs a label`);
      assert.ok(field.hint.trim().length > 0, `${key} needs help text`);
    }
  });

  test("the camelCase property matches the column name", () => {
    // A mismatch would make the API save one field and the UI read another.
    const camel = (snake: string) =>
      snake.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    for (const key of PANEL_SETTING_KEYS) {
      assert.equal(PANEL_SETTING_FIELDS[key].prop, camel(key));
    }
  });

  test("every screen has fields and every field has a known screen", () => {
    for (const section of SECTIONS) {
      assert.ok(
        fieldsForSection(section).length > 0,
        `screen ${section} has no settings`
      );
    }
    for (const key of PANEL_SETTING_KEYS) {
      assert.ok(
        SECTIONS.includes(PANEL_SETTING_FIELDS[key].section),
        `${key} points at an unknown screen`
      );
    }
  });

  test("every default is itself a legal value", () => {
    for (const key of PANEL_SETTING_KEYS) {
      const field = PANEL_SETTING_FIELDS[key];
      assert.equal(
        validatePanelSetting(key, field.defaultValue).error,
        null,
        `${key}'s default must pass its own validation`
      );
      if (field.kind === "boolean") {
        assert.equal(typeof field.defaultValue, "boolean", `${key} default type`);
        assert.equal(field.min, undefined, `${key} is a boolean, not a range`);
      } else {
        assert.equal(typeof field.defaultValue, "number", `${key} default type`);
        const value = field.defaultValue as number;
        assert.ok(Number.isInteger(value), `${key} default is whole`);
        assert.ok(
          (field.min ?? 0) <= value && value <= (field.max ?? 0),
          `${key} default must sit inside its bounds`
        );
        assert.ok((field.max ?? 0) > (field.min ?? 0), `${key} needs a real range`);
      }
    }
  });

  test("bounds are derived from the registry, not written twice", () => {
    for (const key of PANEL_SETTING_KEYS) {
      const field = PANEL_SETTING_FIELDS[key];
      if (field.kind !== "number") {
        assert.equal(PANEL_SETTING_BOUNDS[key], undefined);
        continue;
      }
      assert.deepEqual(PANEL_SETTING_BOUNDS[key], {
        min: field.min,
        max: field.max,
        label: field.label,
      });
    }
  });

  test("lookup tolerates junk without throwing", () => {
    assert.equal(panelSettingField("not_a_setting"), null);
    assert.equal(panelSettingField("constructor"), null, "prototype keys are not settings");
    assert.equal(panelSettingField("session_days")?.label, "Session length");
  });
});

describe("settings defaults", () => {
  test("every property is populated", () => {
    const defaults = panelSettingsDefaults();
    for (const key of PANEL_SETTING_KEYS) {
      const field = PANEL_SETTING_FIELDS[key];
      assert.equal(defaults[field.prop], field.defaultValue);
    }
  });

  test("overrides win without disturbing the rest", () => {
    const defaults = panelSettingsDefaults({
      metricsRetentionDays: 3,
      registrationEnabled: false,
    });
    assert.equal(defaults.metricsRetentionDays, 3);
    assert.equal(defaults.registrationEnabled, false);
    assert.equal(defaults.auditRetentionDays, 365);
  });
});

describe("field-level error messages", () => {
  test("names the problem without repeating the label", () => {
    const message = fieldErrorMessage("session_days", 0);
    assert.match(String(message), /at most 365|at least 1/);
    assert.doesNotMatch(String(message), /session length/i);
  });

  test("missing and non-numeric values are refused", () => {
    assert.match(String(fieldErrorMessage("session_days", Number.NaN)), /whole number/);
    assert.match(String(fieldErrorMessage("session_days", "")), /Enter a value/);
    assert.match(String(fieldErrorMessage("session_days", "seven")), /whole number/);
    assert.match(String(fieldErrorMessage("session_days", 1.5)), /whole number/);
  });

  test("out-of-range values name the limit and its unit", () => {
    assert.equal(fieldErrorMessage("metrics_retention_days", -1), "Must be at least 0 days.");
    assert.equal(
      fieldErrorMessage("metrics_retention_days", 4000),
      "Must be at most 3650 days."
    );
  });

  test("a legal value has no message", () => {
    assert.equal(fieldErrorMessage("session_days", 7), null);
    assert.equal(fieldErrorMessage("registration_enabled", true), null);
    assert.notEqual(fieldErrorMessage("registration_enabled", "yes"), null);
  });
});

describe("nearest legal value", () => {
  test("clamps to the bounds and rounds", () => {
    assert.equal(clampPanelSettingValue("session_days", 0), 1);
    assert.equal(clampPanelSettingValue("session_days", 9999), 365);
    assert.equal(clampPanelSettingValue("session_days", 7.4), 7);
    assert.equal(clampPanelSettingValue("registration_enabled", 1), null);
    assert.equal(clampPanelSettingValue("nope", 1), null);
    assert.equal(clampPanelSettingValue("session_days", Number.NaN), null);
  });
});

describe("change detection", () => {
  const base = panelSettingsDefaults({ metricsRetentionDays: 30 });

  test("reports nothing when the snapshots match", () => {
    assert.deepEqual(diffPanelSettings(base, { ...base }), []);
  });

  test("detects a value moving to zero or false", () => {
    // The classic bug: `if (value)` treats a deliberate 0 as "no change".
    const next = { ...base, metricsRetentionDays: 0, registrationEnabled: false };
    const changed = diffPanelSettings(next, base);
    assert.deepEqual(
      changed.map((change) => change.key).sort(),
      ["metrics_retention_days", "registration_enabled"]
    );
    const retention = changed.find((c) => c.key === "metrics_retention_days");
    assert.equal(retention?.from, 30);
    assert.equal(retention?.to, 0);
    assert.equal(retention?.label, "Metrics retention");
  });

  test("only the changed keys are offered for saving", () => {
    const next = { ...base, sessionDays: 14 };
    assert.deepEqual(panelSettingsPayload(next, ["session_days"]), {
      session_days: 14,
    });
  });

  test("a full payload uses column names", () => {
    const payload = panelSettingsPayload(base);
    for (const key of PANEL_SETTING_KEYS) {
      assert.ok(key in payload, `${key} missing from the payload`);
      assert.equal(payload[key], base[PANEL_SETTING_FIELDS[key].prop]);
    }
  });
});

describe("request validation", () => {
  test("accepts column names and camelCase names", () => {
    const result = normalisePanelSettingsInput({
      session_days: 14,
      registrationEnabled: false,
    });
    assert.deepEqual(result.errors, {});
    assert.deepEqual(result.unknown, []);
    assert.deepEqual(result.updates, {
      session_days: "14",
      registration_enabled: "false",
    });
  });

  test("reports every bad field at once, with the field named", () => {
    const result = normalisePanelSettingsInput({
      session_days: 0,
      login_throttle_attempts: 0,
      minimum_account_age: 12,
      registration_enabled: "maybe",
    });
    assert.equal(Object.keys(result.errors).length, 4);
    assert.match(result.errors.session_days, /^Session length/);
    assert.match(result.errors.login_throttle_attempts, /^Login attempts/);
    assert.match(result.errors.minimum_account_age, /between 16 and 120/);
    assert.match(result.errors.registration_enabled, /on or off/);
    assert.deepEqual(result.updates, {}, "nothing invalid may be persisted");
  });

  test("separates unknown keys from invalid values", () => {
    const result = normalisePanelSettingsInput({ drop_tables: true, session_days: 3 });
    assert.deepEqual(result.unknown, ["drop_tables"]);
    assert.deepEqual(result.updates, { session_days: "3" });
  });

  test("undefined is skipped so a partial save stays partial", () => {
    const result = normalisePanelSettingsInput({
      session_days: undefined,
      audit_retention_days: 30,
    });
    assert.deepEqual(result.updates, { audit_retention_days: "30" });
    assert.deepEqual(result.errors, {});
  });

  test("null and empty strings are refused, not read as zero", () => {
    // Number(null) and Number("") are 0; silently storing that would turn
    // "clear the box" into "keep everything forever".
    const result = normalisePanelSettingsInput({
      metrics_retention_days: null,
      session_days: "",
    });
    assert.match(result.errors.metrics_retention_days, /whole number/);
    assert.match(result.errors.session_days, /whole number/);
    assert.deepEqual(result.updates, {});
  });

  test("nonsense bodies produce an empty, harmless result", () => {
    for (const body of [null, undefined, [], "x", 7]) {
      assert.deepEqual(normalisePanelSettingsInput(body), {
        updates: {},
        errors: {},
        unknown: [],
      });
    }
  });
});

describe("reading stored rows", () => {
  const defaults = { metricsRetentionDays: 30, auditRetentionDays: 365 };

  test("a stored value outside its bounds falls back to the default", () => {
    // Hand-edited or imported rows must not be able to weaken the panel: a
    // session of 0 days would log everyone out, and an age of 8 would defeat
    // the statutory minimum.
    const parsed = parsePanelSettings(
      [
        { key: "session_days", value: "0" },
        { key: "minimum_account_age", value: "8" },
        { key: "metrics_retention_days", value: "99999" },
      ],
      defaults
    );
    assert.equal(parsed.sessionDays, 7);
    assert.equal(parsed.minimumAccountAge, 16);
    assert.equal(parsed.metricsRetentionDays, 30);
  });

  test("a stored 0 inside its bounds is still respected", () => {
    const parsed = parsePanelSettings(
      [{ key: "metrics_retention_days", value: "0" }],
      defaults
    );
    assert.equal(parsed.metricsRetentionDays, 0, "0 means keep forever, not unset");
  });

  test("booleans accept the forms an import or SQL edit might leave", () => {
    const parsed = parsePanelSettings(
      [
        { key: "registration_enabled", value: "TRUE" },
        { key: "update_auto_backup", value: "0" },
        { key: "age_verification_enabled", value: "false" },
        { key: "scheduler_discord_notify", value: " maybe " },
      ],
      defaults
    );
    assert.equal(parsed.registrationEnabled, true);
    assert.equal(parsed.updateAutoBackup, false);
    assert.equal(parsed.ageVerificationEnabled, false);
    assert.equal(
      parsed.schedulerDiscordNotify,
      true,
      "an unreadable row keeps the safety default rather than guessing"
    );
  });

  test("parsing twice yields the same object", () => {
    const rows = [{ key: "session_days", value: "14" }];
    assert.deepEqual(
      parsePanelSettings(rows, defaults),
      parsePanelSettings(rows, defaults)
    );
  });
});

describe("the registry is usable as a whole", () => {
  test("a fresh install's defaults round-trip through the API shape", () => {
    const defaults: PanelSettings = panelSettingsDefaults();
    const payload = panelSettingsPayload(defaults);
    const result = normalisePanelSettingsInput(payload);
    assert.deepEqual(result.errors, {});
    assert.deepEqual(result.unknown, []);
    assert.equal(Object.keys(result.updates).length, PANEL_SETTING_KEYS.length);
    for (const key of PANEL_SETTING_KEYS) {
      assert.equal(
        result.updates[key],
        String(FIELDS[key].defaultValue),
        `${key} should survive the round trip`
      );
    }
  });
});
