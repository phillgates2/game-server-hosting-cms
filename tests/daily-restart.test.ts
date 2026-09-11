/**
 * Tests for the one-click daily restart helpers.
 *
 * The toggle must build and recognise ONLY the strict daily shape
 * "M H * * *" — weekly/monthly/step schedules are custom and must never be
 * claimed or clobbered by the quick action.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  buildDailyRestartCron,
  parseDailyRestartCron,
  normalizeDailyRestartInput,
  isValidHour,
  isValidMinute,
  DAILY_RESTART_DEFAULT_HOUR,
  DAILY_RESTART_DEFAULT_MINUTE,
} from "../src/lib/daily-restart";

describe("buildDailyRestartCron", () => {
  test("builds the strict daily shape", () => {
    assert.equal(buildDailyRestartCron(4, 0), "0 4 * * *");
    assert.equal(buildDailyRestartCron(23, 59), "59 23 * * *");
    assert.equal(buildDailyRestartCron(0, 0), "0 0 * * *");
  });

  test("rejects out-of-range values", () => {
    assert.equal(buildDailyRestartCron(-1, 0), null);
    assert.equal(buildDailyRestartCron(24, 0), null);
    assert.equal(buildDailyRestartCron(4, 60), null);
    assert.equal(buildDailyRestartCron(4, -5), null);
    assert.equal(buildDailyRestartCron(4.5, 0), null);
    assert.equal(buildDailyRestartCron(NaN, 0), null);
  });
});

describe("parseDailyRestartCron", () => {
  test("recognises strict daily crons", () => {
    assert.deepEqual(parseDailyRestartCron("0 4 * * *"), { hour: 4, minute: 0 });
    assert.deepEqual(parseDailyRestartCron("30 23 * * *"), { hour: 23, minute: 30 });
    assert.deepEqual(parseDailyRestartCron("  15  6 * * *  "), { hour: 6, minute: 15 });
  });

  test("rejects custom schedules so the toggle leaves them alone", () => {
    assert.equal(parseDailyRestartCron("0 4 * * 1"), null); // weekly
    assert.equal(parseDailyRestartCron("0 4 1 * *"), null); // monthly
    assert.equal(parseDailyRestartCron("*/30 * * * *"), null); // step
    assert.equal(parseDailyRestartCron("0 4,16 * * *"), null); // list
    assert.equal(parseDailyRestartCron("0-5 4 * * *"), null); // range
  });

  test("rejects malformed input", () => {
    assert.equal(parseDailyRestartCron(null), null);
    assert.equal(parseDailyRestartCron(""), null);
    assert.equal(parseDailyRestartCron("0 4 * *"), null);
    assert.equal(parseDailyRestartCron("x y * * *"), null);
    assert.equal(parseDailyRestartCron("99 4 * * *"), null);
    assert.equal(parseDailyRestartCron("0 25 * * *"), null);
  });

  test("round-trips with the builder", () => {
    for (const [h, m] of [[0, 0], [4, 0], [12, 30], [23, 59]] as const) {
      const cron = buildDailyRestartCron(h, m);
      assert.deepEqual(parseDailyRestartCron(cron), { hour: h, minute: m });
    }
  });
});

describe("normalizeDailyRestartInput", () => {
  test("requires a boolean enabled", () => {
    assert.equal(normalizeDailyRestartInput({}).ok, false);
    assert.equal(normalizeDailyRestartInput({ enabled: "yes" }).ok, false);
    assert.equal(normalizeDailyRestartInput(null).ok, false);
    assert.equal(normalizeDailyRestartInput([]).ok, false);
  });

  test("applies defaults when hour/minute are omitted", () => {
    const res = normalizeDailyRestartInput({ enabled: true });
    assert.deepEqual(res.value, {
      enabled: true,
      hour: DAILY_RESTART_DEFAULT_HOUR,
      minute: DAILY_RESTART_DEFAULT_MINUTE,
    });
  });

  test("accepts valid explicit times", () => {
    const res = normalizeDailyRestartInput({ enabled: false, hour: 6, minute: 30 });
    assert.deepEqual(res.value, { enabled: false, hour: 6, minute: 30 });
  });

  test("coerces numeric strings", () => {
    const res = normalizeDailyRestartInput({ enabled: true, hour: "5", minute: "15" });
    assert.deepEqual(res.value, { enabled: true, hour: 5, minute: 15 });
  });

  test("rejects out-of-range or junk times", () => {
    assert.equal(normalizeDailyRestartInput({ enabled: true, hour: 24 }).ok, false);
    assert.equal(normalizeDailyRestartInput({ enabled: true, hour: -1 }).ok, false);
    assert.equal(normalizeDailyRestartInput({ enabled: true, minute: 60 }).ok, false);
    assert.equal(normalizeDailyRestartInput({ enabled: true, hour: "abc" }).ok, false);
  });
});

describe("range guards", () => {
  test("isValidHour / isValidMinute", () => {
    assert.equal(isValidHour(0), true);
    assert.equal(isValidHour(23), true);
    assert.equal(isValidHour(24), false);
    assert.equal(isValidMinute(59), true);
    assert.equal(isValidMinute(60), false);
    assert.equal(isValidMinute(1.5), false);
  });
});
