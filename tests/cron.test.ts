/**
 * Tests for the scheduler's cron engine.
 *
 * The old scheduler "parsed" cron with parseInt on two fields: a step like
 * "every 30 minutes" became NaN (an invalid timestamp stored in the DB),
 * "5,10" was silently treated as 5, and anything unrecognised was quietly
 * scheduled an hour out. These tests pin the real parser and the next-run
 * calculation.
 *
 * All dates are constructed in local time so the assertions are timezone
 * independent.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseCron, nextRunAfter, nextCronRun, isValidCron } from "../src/lib/cron";

describe("parseCron", () => {
  test("accepts the standard daily schedule", () => {
    const s = parseCron("0 4 * * *");
    assert.ok(s);
    assert.deepEqual([...s.minutes], [0]);
    assert.deepEqual([...s.hours], [4]);
    assert.equal(s.domStar, true);
    assert.equal(s.dowStar, true);
  });

  test("accepts steps, lists, ranges and combinations", () => {
    const step = parseCron("*/30 * * * *");
    assert.ok(step);
    assert.deepEqual([...step.minutes], [0, 30]);

    const list = parseCron("0 2,14 * * *");
    assert.ok(list);
    assert.deepEqual([...list.hours], [2, 14]);

    const range = parseCron("15 2 * * 1-5");
    assert.ok(range);
    assert.deepEqual([...range.daysOfWeek], [1, 2, 3, 4, 5]);

    const combo = parseCron("*/5 0-6 * * 0,6");
    assert.ok(combo);
    assert.equal(combo.minutes.size, 12);
    assert.deepEqual([...combo.hours], [0, 1, 2, 3, 4, 5, 6]);
    assert.deepEqual([...combo.daysOfWeek], [0, 6]);
  });

  test("day 7 is Sunday, spelled 0", () => {
    const s = parseCron("0 4 * * 7");
    assert.ok(s);
    assert.deepEqual([...s.daysOfWeek], [0]);
  });

  test("rejects non-cron input instead of guessing", () => {
    assert.equal(parseCron(null), null);
    assert.equal(parseCron(""), null);
    assert.equal(parseCron("   "), null);
    assert.equal(parseCron("0 4 * *"), null, "4 fields");
    assert.equal(parseCron("0 4 * * * *"), null, "6 fields");
    assert.equal(parseCron("99 * * * *"), null, "minute out of range");
    assert.equal(parseCron("0 25 * * *"), null, "hour out of range");
    assert.equal(parseCron("0 4 32 * *"), null, "day of month out of range");
    assert.equal(parseCron("*/0 * * * *"), null, "zero step");
    assert.equal(parseCron("a b * * *"), null, "not numbers");
    assert.equal(parseCron("0 4 * * 8"), null, "dow out of range");
    assert.equal(parseCron("10-5 * * * *"), null, "reversed range");
  });

  test("isValidCron follows the parser", () => {
    assert.equal(isValidCron("0 4 * * *"), true);
    assert.equal(isValidCron("every tuesday"), false);
  });
});

describe("nextRunAfter", () => {
  const at = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo - 1, d, h, mi, 0, 0);
  const fmt = (d: Date | null) =>
    d ? `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}` : null;

  test("daily 4am: later today when the time has not passed", () => {
    const s = parseCron("0 4 * * *")!;
    assert.equal(fmt(nextRunAfter(s, at(2026, 8, 26, 3, 0))), "2026-8-26 4:00");
  });

  test("daily 4am: tomorrow once today's run has passed", () => {
    const s = parseCron("0 4 * * *")!;
    assert.equal(fmt(nextRunAfter(s, at(2026, 8, 26, 4, 30))), "2026-8-27 4:00");
  });

  test("the run at exactly 4:00 is not returned for a 4:00 check", () => {
    const s = parseCron("0 4 * * *")!;
    assert.equal(fmt(nextRunAfter(s, at(2026, 8, 26, 4, 0))), "2026-8-27 4:00");
  });

  test("every 30 minutes from an odd minute", () => {
    const s = parseCron("*/30 * * * *")!;
    assert.equal(fmt(nextRunAfter(s, at(2026, 8, 26, 10, 10))), "2026-8-26 10:30");
    assert.equal(fmt(nextRunAfter(s, at(2026, 8, 26, 10, 30))), "2026-8-26 11:00");
  });

  test("weekly Sunday 4am from a Wednesday", () => {
    const s = parseCron("0 4 * * 0")!;
    assert.equal(fmt(nextRunAfter(s, at(2026, 8, 26, 12, 0))), "2026-8-30 4:00");
  });

  test("monthly 1st at midnight rolls to next month", () => {
    const s = parseCron("0 0 1 * *")!;
    assert.equal(fmt(nextRunAfter(s, at(2026, 8, 26, 12, 0))), "2026-9-1 0:00");
  });

  test("a schedule that can never match yields null, not a guess", () => {
    // 31st of February has no real date; the horizon must give up honestly.
    const s = parseCron("0 0 31 2 *")!;
    assert.equal(nextRunAfter(s, at(2026, 8, 26, 12, 0)), null);
  });

  test("nextCronRun combines parse and compute", () => {
    assert.equal(fmt(nextCronRun("0 4 * * *", at(2026, 8, 26, 3, 0))), "2026-8-26 4:00");
    assert.equal(nextCronRun("not cron", at(2026, 8, 26, 3, 0)), null);
  });
});
