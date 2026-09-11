/**
 * Tests for the age-verification gate.
 *
 * The gate enforces the Australian Online Safety Amendment (Social Media
 * Minimum Age) Act 2024: nobody under 16 may hold an account. These tests
 * exercise the pure decision logic, so the boundary cases that decide
 * whether a real person is refused are pinned down without a database.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  AUSTRALIAN_MINIMUM_ACCOUNT_AGE,
  AGE_LAW_NOTICE,
  ageInYears,
  parseDateOfBirth,
  checkMinimumAge,
} from "../src/lib/age-verification";

const D = (s: string) => new Date(`${s}T00:00:00Z`);

describe("statutory floor", () => {
  test("the default minimum age is 16, per Australian law", () => {
    assert.equal(AUSTRALIAN_MINIMUM_ACCOUNT_AGE, 16);
  });
});

describe("ageInYears", () => {
  test("counts whole years, anniversary-based", () => {
    assert.equal(ageInYears(D("2010-05-01"), D("2026-05-01")), 16); // birthday itself
    assert.equal(ageInYears(D("2010-05-01"), D("2026-04-30")), 15); // day before
    assert.equal(ageInYears(D("2010-05-01"), D("2026-05-02")), 16); // day after
    assert.equal(ageInYears(D("2010-05-01"), D("2025-12-31")), 15); // same year, earlier month
  });

  test("handles a 29 February birthday across leap and non-leap years", () => {
    // 2010-02-28 is NOT a leap year... use 2008 for a real 29 Feb birth.
    const leapBirth = D("2008-02-29");
    // Non-leap year: the anniversary is treated as 1 March.
    assert.equal(ageInYears(leapBirth, D("2025-02-28")), 16); // 2025 non-leap, day before anniversary
    assert.equal(ageInYears(leapBirth, D("2025-03-01")), 17); // 2025 non-leap, anniversary
    // Leap year: the real date exists.
    assert.equal(ageInYears(leapBirth, D("2024-02-28")), 15);
    assert.equal(ageInYears(leapBirth, D("2024-02-29")), 16);
  });
});

describe("parseDateOfBirth", () => {
  test("accepts a valid ISO date", () => {
    const now = D("2026-09-10");
    const dob = parseDateOfBirth("2010-03-15", now);
    assert.ok(dob);
    assert.equal(dob.toISOString().slice(0, 10), "2010-03-15");
  });

  test("rejects malformed or impossible dates", () => {
    const now = D("2026-09-10");
    assert.equal(parseDateOfBirth("not-a-date", now), null);
    assert.equal(parseDateOfBirth("2010/03/15", now), null); // wrong separator
    assert.equal(parseDateOfBirth("2010-13-01", now), null); // month 13
    assert.equal(parseDateOfBirth("2010-02-31", now), null); // rolled-over date
    assert.equal(parseDateOfBirth("2010-3-5", now), null); // not zero-padded
    assert.equal(parseDateOfBirth("", now), null);
    assert.equal(parseDateOfBirth(null, now), null);
    assert.equal(parseDateOfBirth(20100315, now), null);
  });

  test("rejects a future date", () => {
    const now = D("2026-09-10");
    assert.equal(parseDateOfBirth("2026-09-11", now), null);
    // The boundary itself (today) is a valid date of birth.
    assert.ok(parseDateOfBirth("2026-09-10", now));
  });

  test("rejects implausibly old dates", () => {
    const now = D("2026-09-10");
    assert.equal(parseDateOfBirth("1900-01-01", now), null); // > 120 years
    assert.ok(parseDateOfBirth("1910-01-01", now)); // within range
  });
});

describe("checkMinimumAge", () => {
  const now = D("2026-09-10");
  const min = AUSTRALIAN_MINIMUM_ACCOUNT_AGE;

  test("accepts someone who is exactly 16 today", () => {
    const res = checkMinimumAge("2010-09-10", min, now);
    assert.equal(res.ok, true);
    assert.equal(res.age, 16);
  });

  test("refuses someone one day short of 16", () => {
    const res = checkMinimumAge("2010-09-11", min, now);
    assert.equal(res.ok, false);
    assert.equal(res.reason, "under-age");
    assert.equal(res.age, 15);
  });

  test("the refusal message names the age and cites Australian law", () => {
    const res = checkMinimumAge("2012-01-01", min, now);
    assert.equal(res.ok, false);
    assert.match(res.error ?? "", /at least 16 years old/);
    assert.match(res.error ?? "", /Australian law/);
    assert.ok(res.error?.includes(AGE_LAW_NOTICE));
  });

  test("treats a missing or malformed date as invalid, not under-age", () => {
    for (const bad of [undefined, "", "junk", "2010-02-31"]) {
      const res = checkMinimumAge(bad, min, now);
      assert.equal(res.ok, false);
      assert.equal(res.reason, "invalid");
      assert.equal(res.age, undefined);
    }
  });

  test("honours a raised minimum age from the settings", () => {
    const res = checkMinimumAge("2008-09-09", 18, now); // 18th birthday yesterday → fine
    assert.equal(res.ok, true);
    const tooYoung = checkMinimumAge("2009-01-01", 18, now); // only 17
    assert.equal(tooYoung.ok, false);
    assert.equal(tooYoung.reason, "under-age");
  });
});
