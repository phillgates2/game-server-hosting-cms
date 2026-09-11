/**
 * Tests for the resource-limit watchdog.
 *
 * The watchdog decides when a server that ignores its CPU/RAM limits gets
 * stopped, so the comparison and the strike accounting are pure and pinned
 * here — including the boundaries (exactly at a limit is fine, an unset
 * limit can never be breached).
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  checkResourceLimits,
  strikeDecision,
  LIMIT_STRIKES_WARN,
  LIMIT_STRIKES_ENFORCE,
} from "../src/lib/process-metrics";

describe("checkResourceLimits", () => {
  test("no limits configured means no violations, whatever the sample", () => {
    const sample = { ramMb: 999_999, cpuPercent: 40_000 };
    assert.deepEqual(checkResourceLimits(sample, { maxRamMb: null, maxCpuPercent: null }), []);
  });

  test("a zero or negative limit is treated as unset", () => {
    const sample = { ramMb: 5000, cpuPercent: 500 };
    assert.deepEqual(checkResourceLimits(sample, { maxRamMb: 0, maxCpuPercent: -1 }), []);
  });

  test("exactly at a limit is NOT a breach", () => {
    const sample = { ramMb: 4096, cpuPercent: 200 };
    assert.deepEqual(checkResourceLimits(sample, { maxRamMb: 4096, maxCpuPercent: 200 }), []);
  });

  test("a single breach names the limit and the reading", () => {
    const v = checkResourceLimits({ ramMb: 5000, cpuPercent: 10 }, { maxRamMb: 4096, maxCpuPercent: null });
    assert.equal(v.length, 1);
    assert.match(v[0], /RAM/);
    assert.match(v[0], /4 GB/);
  });

  test("RAM under 1 GB renders in MB", () => {
    const v = checkResourceLimits({ ramMb: 900, cpuPercent: 0 }, { maxRamMb: 512, maxCpuPercent: null });
    assert.match(v[0], /900 MB/);
    assert.match(v[0], /512 MB/);
  });

  test("both limits can breach at once", () => {
    const v = checkResourceLimits({ ramMb: 9000, cpuPercent: 350 }, { maxRamMb: 4096, maxCpuPercent: 200 });
    assert.equal(v.length, 2);
  });

  test("multi-threaded CPU over 100% is a normal number, not an error", () => {
    const v = checkResourceLimits({ ramMb: 100, cpuPercent: 240 }, { maxRamMb: null, maxCpuPercent: 200 });
    assert.equal(v.length, 1);
    assert.match(v[0], /240%/);
  });
});

describe("strikeDecision", () => {
  test("a clean sample always resets to zero", () => {
    assert.deepEqual(strikeDecision(3, false), { strikes: 0, warn: false, enforce: false });
  });

  test("the first breach warns but does not enforce", () => {
    const d = strikeDecision(0, true);
    assert.equal(d.strikes, 1);
    assert.equal(d.warn, true);
    assert.equal(d.enforce, false);
  });

  test("breaches between warn and enforce accumulate quietly", () => {
    const d = strikeDecision(1, true);
    assert.equal(d.strikes, 2);
    assert.equal(d.warn, false);
    assert.equal(d.enforce, false);
  });

  test("the fourth consecutive breach enforces", () => {
    let strikes = 0;
    for (let i = 0; i < LIMIT_STRIKES_ENFORCE; i++) {
      const d = strikeDecision(strikes, true);
      strikes = d.strikes;
    }
    assert.equal(strikes, LIMIT_STRIKES_ENFORCE);
    assert.equal(strikeDecision(LIMIT_STRIKES_ENFORCE - 1, true).enforce, true);
  });

  test("a clean sample between breaches prevents enforcement", () => {
    let strikes = 0;
    for (let i = 0; i < LIMIT_STRIKES_ENFORCE * 3; i++) {
      const breached = i % 2 === 0; // breach, clean, breach, clean…
      strikes = strikeDecision(strikes, breached).strikes;
      assert.ok(strikes < LIMIT_STRIKES_ENFORCE, "must never reach enforcement");
    }
  });

  test("constants match the documented behaviour", () => {
    assert.equal(LIMIT_STRIKES_WARN, 1);
    assert.equal(LIMIT_STRIKES_ENFORCE, 4);
  });
});
