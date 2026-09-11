/**
 * Tests for the peak-hours heatmap math.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildHeatmap, describePeak, type PlayerSample } from "../src/lib/player-history";

/** Timestamp for a given local day/hour. */
function at(day: number, hour: number, players: number): PlayerSample {
  // 2026-09-06 is a Sunday; day offset keeps getDay() predictable.
  const base = new Date(2026, 8, 6 + day, hour, 15, 0);
  return { ts: base.getTime(), players };
}

describe("buildHeatmap", () => {
  test("averages samples inside the same day/hour bucket", () => {
    const h = buildHeatmap([at(0, 19, 10), at(0, 19, 20), at(0, 19, 30)]);
    assert.equal(h.cells.length, 1);
    assert.equal(h.cells[0].avg, 20);
    assert.equal(h.cells[0].samples, 3);
  });

  test("keeps buckets separate across days and hours", () => {
    const h = buildHeatmap([at(0, 19, 5), at(1, 19, 9), at(0, 20, 3)]);
    assert.equal(h.cells.length, 3);
  });

  test("empty buckets are omitted, not zeroed", () => {
    const h = buildHeatmap([at(2, 10, 4)]);
    assert.equal(h.cells.length, 1);
    assert.equal(h.totalSamples, 1);
  });

  test("garbage samples are ignored", () => {
    const h = buildHeatmap([
      { ts: NaN, players: 5 },
      { ts: Date.now(), players: -3 },
      { ts: Date.now(), players: NaN },
      at(0, 12, 2),
    ]);
    assert.equal(h.totalSamples, 4);
    assert.equal(h.cells.length, 1);
  });

  test("peak needs at least two sightings", () => {
    const one = buildHeatmap([at(5, 20, 99)]);
    assert.equal(one.peak, null);
    const two = buildHeatmap([at(5, 20, 99), at(5, 20, 97), at(1, 3, 5), at(1, 3, 5)]);
    assert.equal(two.peak?.avg, 98);
    assert.equal(two.peak?.day, 5);
    assert.equal(two.peak?.hour, 20);
  });
});

describe("describePeak", () => {
  test("labels and nulls", () => {
    assert.equal(describePeak(null), null);
    assert.equal(describePeak({ day: 5, hour: 9, avg: 1, samples: 2 }), "Fri 09:00");
    assert.equal(describePeak({ day: 0, hour: 23, avg: 1, samples: 2 }), "Sun 23:00");
  });
});
