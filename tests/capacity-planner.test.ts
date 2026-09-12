/**
 * Tests for the fleet capacity planner (pure layer).
 *
 * The contract: the smallest headroom wins, ties list every binding
 * limiter, headroom never goes negative, and null limits are unbounded.
 *
 *   npm test
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  estimateCapacity,
  footprintForSlug,
  formatCapacityAnswer,
  GAME_FOOTPRINT_DEFAULTS,
  DEFAULT_GAME_FOOTPRINT,
} from "../src/lib/capacity-planner";

const tf2 = GAME_FOOTPRINT_DEFAULTS.tf2;

describe("footprintForSlug", () => {
  test("known slugs resolve, unknown fall back", () => {
    assert.deepEqual(footprintForSlug("tf2"), GAME_FOOTPRINT_DEFAULTS.tf2);
    assert.deepEqual(footprintForSlug("no-such-game"), DEFAULT_GAME_FOOTPRINT);
    assert.deepEqual(footprintForSlug(null), DEFAULT_GAME_FOOTPRINT);
  });
});

describe("estimateCapacity", () => {
  test("RAM is the binding limit", () => {
    const est = estimateCapacity(
      { maxRamMb: 16_000, maxDiskMb: 1_000_000, maxServers: null, usedRamMb: 12_000, usedDiskMb: 0, serverCount: 2 },
      tf2
    );
    assert.equal(est.fits, 2); // 4000 left / 2000 per server
    assert.deepEqual(est.limiters, ["RAM"]);
    assert.equal(est.approximate, false);
  });

  test("disk is the binding limit", () => {
    const est = estimateCapacity(
      { maxRamMb: 64_000, maxDiskMb: 100_000, maxServers: null, usedRamMb: 0, usedDiskMb: 70_000, serverCount: 1 },
      tf2
    );
    assert.equal(est.fits, 1); // 30k left / 20k each
    assert.deepEqual(est.limiters, ["disk"]);
  });

  test("server slots bind when limits are generous", () => {
    const est = estimateCapacity(
      { maxRamMb: 64_000, maxDiskMb: 1_000_000, maxServers: 10, usedRamMb: 0, usedDiskMb: 0, serverCount: 8 },
      tf2
    );
    assert.equal(est.fits, 2);
    assert.deepEqual(est.limiters, ["server slots"]);
  });

  test("ties list every binding limiter", () => {
    const est = estimateCapacity(
      { maxRamMb: 2_000, maxDiskMb: 20_000, maxServers: 1, usedRamMb: 0, usedDiskMb: 0, serverCount: 0 },
      tf2
    );
    assert.equal(est.fits, 1);
    assert.deepEqual(est.limiters.sort(), ["RAM", "disk", "server slots"]);
  });

  test("full nodes report zero, never negative", () => {
    const est = estimateCapacity(
      { maxRamMb: 4_000, maxDiskMb: 20_000, maxServers: 5, usedRamMb: 9_000, usedDiskMb: 999_999, serverCount: 9 },
      tf2
    );
    assert.equal(est.fits, 0);
  });

  test("no limits at all means unbounded", () => {
    const est = estimateCapacity(
      { maxRamMb: null, maxDiskMb: null, maxServers: null, usedRamMb: null, usedDiskMb: null, serverCount: 3 },
      tf2
    );
    assert.equal(est.fits, Infinity);
    assert.deepEqual(est.limiters, []);
  });

  test("missing usage data degrades to limits-only and says so", () => {
    const est = estimateCapacity(
      { maxRamMb: 16_000, maxDiskMb: null, maxServers: null, usedRamMb: null, usedDiskMb: null, serverCount: 0 },
      tf2
    );
    assert.equal(est.fits, 8); // assumes zero usage
    assert.equal(est.approximate, true);
  });
});

describe("formatCapacityAnswer", () => {
  test("full, roomy, and unlimited phrasings", () => {
    const full = formatCapacityAnswer({
      nodeName: "alpha", gameName: "TF2",
      estimate: { fits: 0, limiters: ["disk"], approximate: false },
    });
    assert.match(full, /full/);
    assert.match(full, /disk/);

    const roomy = formatCapacityAnswer({
      nodeName: "alpha", gameName: "TF2",
      estimate: { fits: 3, limiters: ["RAM"], approximate: false },
    });
    assert.match(roomy, /~3 more TF2 servers/);

    const unlimited = formatCapacityAnswer({
      nodeName: "alpha", gameName: "TF2",
      estimate: { fits: Infinity, limiters: [], approximate: false },
    });
    assert.match(unlimited, /no configured limits/);

    const one = formatCapacityAnswer({
      nodeName: "alpha", gameName: "TF2",
      estimate: { fits: 1, limiters: ["RAM"], approximate: false },
    });
    assert.match(one, /1 more TF2 server\b/);
    assert.doesNotMatch(one, /servers/);
  });
});
