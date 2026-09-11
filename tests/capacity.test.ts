/**
 * Tests for capacity forecasting.
 *
 * The contract: honest projections only — too few samples, flat/shrinking
 * trends, or absurd horizons must return null, never a scary wrong number.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  linearFit,
  forecastDaysUntil,
  capacityVerdict,
  CAPACITY_MIN_SAMPLES,
  CAPACITY_MAX_FORECAST_DAYS,
  type CapacitySample,
} from "../src/lib/capacity";

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

/** Samples growing by `perDay` units per day over `days` days. */
function growing(perDay: number, days: number, stepDays = 1): CapacitySample[] {
  const out: CapacitySample[] = [];
  for (let d = 0; d <= days; d += stepDays) {
    out.push({ t: NOW - (days - d) * DAY, v: 100 + perDay * d });
  }
  return out;
}

describe("linearFit", () => {
  test("recovers a perfect slope", () => {
    const fit = linearFit(growing(10, 7));
    assert.ok(fit);
    assert.ok(Math.abs((fit?.slopePerDay ?? 0) - 10) < 0.001);
  });

  test("needs at least two distinct instants", () => {
    assert.equal(linearFit([{ t: NOW, v: 5 }]), null);
    assert.equal(linearFit([]), null);
    assert.equal(linearFit([{ t: NOW, v: 5 }, { t: NOW, v: 9 }]), null);
  });
});

describe("forecastDaysUntil", () => {
  test("projects growth to the target", () => {
    // 10 units/day, currently at 170, target 270 → 10 days.
    const fc = forecastDaysUntil(growing(10, 7), 270, NOW);
    assert.equal(fc.daysUntilTarget, 10);
  });

  test("already at/over target → zero days", () => {
    const fc = forecastDaysUntil(growing(10, 7), 100, NOW);
    assert.equal(fc.daysUntilTarget, 0);
  });

  test("flat or shrinking trends → no forecast", () => {
    assert.equal(forecastDaysUntil(growing(0, 7), 9999, NOW).daysUntilTarget, null);
    assert.equal(forecastDaysUntil(growing(-5, 7), 9999, NOW).daysUntilTarget, null);
  });

  test("too few samples → no forecast", () => {
    const few = growing(10, CAPACITY_MIN_SAMPLES - 2);
    assert.ok(few.length < CAPACITY_MIN_SAMPLES);
    assert.equal(forecastDaysUntil(few, 9999, NOW).daysUntilTarget, null);
  });

  test("absurd horizons are capped to null", () => {
    // 0.001 units/day to a far target would be ~100M days.
    const fc = forecastDaysUntil(growing(0.001, 7), 100_000, NOW);
    assert.equal(fc.daysUntilTarget, null);
    assert.ok(CAPACITY_MAX_FORECAST_DAYS <= 730);
  });
});

describe("capacityVerdict", () => {
  test("bands", () => {
    assert.equal(capacityVerdict(null).tone, "unknown");
    assert.equal(capacityVerdict(0).tone, "critical");
    assert.equal(capacityVerdict(7).tone, "critical");
    assert.equal(capacityVerdict(30).tone, "warning");
    assert.equal(capacityVerdict(200).tone, "ok");
  });
});
