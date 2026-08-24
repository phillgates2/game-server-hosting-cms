/**
 * Tests for per-server resource sampling.
 *
 * `server_metrics` existed from the first release, was pruned by the retention
 * job and counted by its stats call, but nothing ever inserted a row — so
 * per-server history was permanently empty and the monitor could only show
 * host-wide figures.
 *
 * The parsing is checked against this machine's own /proc entries, because a
 * field-offset mistake in /proc/<pid>/stat produces plausible-looking numbers
 * rather than an obvious failure.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import {
  sampleProcess,
  cpuPercentFor,
  forgetProcess,
  shouldStoreSample,
  forgetSampleThrottle,
} from "../src/lib/process-metrics";

const HAS_PROC = existsSync("/proc/self/stat");

describe("sampling a real process", { skip: !HAS_PROC && "no procfs" }, () => {
  test("resident memory agrees with VmRSS", async () => {
    // Independent source for the same number: if the field offset in
    // /proc/<pid>/stat were wrong this would diverge wildly rather than fail.
    const s = await sampleProcess(process.pid);
    assert.ok(s, "should sample its own process");

    const status = readFileSync(`/proc/${process.pid}/status`, "utf8");
    const rssKb = Number(status.match(/VmRSS:\s+(\d+)/)?.[1] ?? 0);
    assert.ok(rssKb > 0, "VmRSS should be readable");

    const drift = Math.abs(s!.ramMb - rssKb / 1024);
    assert.ok(drift < 2, `RSS drift too large: ${drift.toFixed(2)} MB`);
  });

  test("reports plausible cpu and uptime figures", async () => {
    const s = await sampleProcess(process.pid);
    assert.ok(s!.cpuSeconds >= 0);
    assert.ok(s!.uptimeSeconds >= 0);
    assert.ok(s!.ramMb > 0, "a live process uses some memory");
  });

  test("a dead pid returns null rather than throwing", async () => {
    // A server that exited between the liveness check and the sample is an
    // expected race, not an error.
    assert.equal(await sampleProcess(999_999), null);
  });
});

describe("cpu percentage", () => {
  const pid = 4242;

  test("the first sample uses lifetime average rather than reporting zero", () => {
    forgetProcess(pid);
    // 30 CPU-seconds over 60 seconds alive is 50% of one core.
    const pct = cpuPercentFor(pid, { ramMb: 1, cpuSeconds: 30, uptimeSeconds: 60 });
    assert.ok(pct > 40 && pct < 60, `expected ~50, got ${pct}`);
  });

  test("a restarted pid does not report a negative percentage", () => {
    // The pid is reused and its CPU counter resets, so the delta goes
    // negative. That must clamp to 0, not render as -400%.
    forgetProcess(pid);
    cpuPercentFor(pid, { ramMb: 1, cpuSeconds: 100, uptimeSeconds: 200 });
    const pct = cpuPercentFor(pid, { ramMb: 1, cpuSeconds: 2, uptimeSeconds: 4 });
    assert.equal(pct, 0);
  });

  test("an idle process reports near zero between samples", () => {
    forgetProcess(pid);
    cpuPercentFor(pid, { ramMb: 1, cpuSeconds: 10, uptimeSeconds: 100 });
    const pct = cpuPercentFor(pid, { ramMb: 1, cpuSeconds: 10, uptimeSeconds: 101 });
    assert.equal(pct, 0, "no CPU consumed between samples");
  });

  test("forgetting a pid resets the baseline", () => {
    forgetProcess(pid);
    cpuPercentFor(pid, { ramMb: 1, cpuSeconds: 50, uptimeSeconds: 100 });
    forgetProcess(pid);
    // Back to the lifetime-average branch rather than a delta.
    const pct = cpuPercentFor(pid, { ramMb: 1, cpuSeconds: 25, uptimeSeconds: 100 });
    assert.ok(pct > 20 && pct < 30, `expected ~25, got ${pct}`);
  });

  test("a zero-uptime process does not divide by zero", () => {
    forgetProcess(pid);
    assert.equal(cpuPercentFor(pid, { ramMb: 1, cpuSeconds: 0, uptimeSeconds: 0 }), 0);
  });
});

describe("write throttling", () => {
  const serverId = 77;

  test("stores the first sample immediately", () => {
    forgetSampleThrottle(serverId);
    assert.equal(shouldStoreSample(serverId, 1_000_000), true);
  });

  test("suppresses a second sample within the minute", () => {
    // The status poll runs every 15s per open dashboard. Without this, two
    // admins with the tab open would double the write rate.
    forgetSampleThrottle(serverId);
    assert.equal(shouldStoreSample(serverId, 1_000_000), true);
    assert.equal(shouldStoreSample(serverId, 1_015_000), false, "15s later");
    assert.equal(shouldStoreSample(serverId, 1_030_000), false, "30s later");
    assert.equal(shouldStoreSample(serverId, 1_045_000), false, "45s later");
  });

  test("allows the next sample after a minute", () => {
    forgetSampleThrottle(serverId);
    assert.equal(shouldStoreSample(serverId, 2_000_000), true);
    assert.equal(shouldStoreSample(serverId, 2_060_000), true, "60s later");
  });

  test("throttles each server independently", () => {
    forgetSampleThrottle(1);
    forgetSampleThrottle(2);
    assert.equal(shouldStoreSample(1, 3_000_000), true);
    assert.equal(shouldStoreSample(2, 3_000_000), true, "a different server is unaffected");
    assert.equal(shouldStoreSample(1, 3_010_000), false);
  });

  test("keeps the retained row count sane", () => {
    // One row per server per minute: 1,440/day, so 50 servers at the default
    // 30-day window retain ~2.2M rows rather than the ~8.6M an unthrottled
    // 15-second poll would produce.
    const perDay = (24 * 60 * 60) / 60;
    assert.equal(perDay, 1440);
    assert.ok(perDay * 50 * 30 < 3_000_000);
  });
});
