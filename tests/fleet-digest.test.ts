/**
 * Tests for the weekly fleet digest formatting.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { formatFleetDigest, DIGEST_MAX_LENGTH, type FleetDigestStats } from "../src/lib/fleet-digest";

const base: FleetDigestStats = {
  serversTotal: 12,
  serversRunning: 8,
  crashed: 2,
  watchdogStops: 1,
  idleStops: 3,
  uptime: [
    { name: "TF2 #2", percent: 91.5 },
    { name: "MC lobby", percent: 99.9 },
    { name: "Valheim", percent: 100 },
  ],
};

describe("formatFleetDigest", () => {
  test("covers counts, incidents and stability", () => {
    const text = formatFleetDigest(base);
    assert.match(text, /Fleet digest — last 7 days/);
    assert.match(text, /8 running \/ 12 total/);
    assert.match(text, /2 crashes · 1 watchdog stop · 3 idle auto-stops/);
    assert.match(text, /TF2 #2 91\.5%/);
  });

  test("singular forms", () => {
    const text = formatFleetDigest({ ...base, crashed: 1, watchdogStops: 0, idleStops: 1 });
    assert.match(text, /1 crash · 0 watchdog stops · 1 idle auto-stop/);
  });

  test("quiet week gets its line", () => {
    const text = formatFleetDigest({ ...base, uptime: [{ name: "a", percent: 100 }] });
    assert.match(text, /quiet week/);
  });

  test("null uptime rows are skipped", () => {
    const text = formatFleetDigest({ ...base, uptime: [{ name: "ghost", percent: null }] });
    assert.doesNotMatch(text, /Stability:/);
  });

  test("output never exceeds the cap", () => {
    const huge: FleetDigestStats = {
      ...base,
      uptime: Array.from({ length: 20 }, (_, i) => ({ name: `server-${i}-with-a-long-name`, percent: 90 + i * 0.1 })),
    };
    assert.ok(formatFleetDigest(huge).length <= DIGEST_MAX_LENGTH);
  });
});
