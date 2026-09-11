/**
 * Tests for rolling z-score anomaly detection.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { detectAnomalies, describeAnomalies, ANOMALY_MIN_SAMPLES } from "../src/lib/anomaly";

function flat(n: number, v = 50) {
  return Array.from({ length: n }, (_, i) => ({ t: i * 60_000, v }));
}

/** Realistic baseline: light jitter (std ≈ 2) — a pure-flat series has no
 * variance and therefore no concept of anomalous. */
function jitter(n: number, base = 50) {
  return Array.from({ length: n }, (_, i) => ({ t: i * 60_000, v: base + (i % 2 === 0 ? 2 : -2) }));
}

function withSpikeAt(n: number, idx: number, spike: number) {
  const s = jitter(n);
  s[idx].v = spike;
  return s;
}

describe("detectAnomalies", () => {
  test("flags a hard spike after enough calm history", () => {
    const s = withSpikeAt(30, 25, 500);
    const hits = detectAnomalies(s);
    assert.ok(hits.length >= 1);
    assert.equal(hits[0].t, s[25].t);
    assert.ok(hits[0].z >= 3.5);
  });

  test("flags dips too", () => {
    const s = withSpikeAt(30, 25, -400);
    assert.ok(detectAnomalies(s).length >= 1);
  });

  test("flat series are never anomalous", () => {
    assert.deepEqual(detectAnomalies(flat(60)), []);
  });

  test("not enough history → no verdicts", () => {
    const s = withSpikeAt(ANOMALY_MIN_SAMPLES + 2, 6, 999);
    assert.deepEqual(detectAnomalies(s, { minSamples: 12 }), []);
  });

  test("steady growth is normal, not anomalous", () => {
    const s = Array.from({ length: 80 }, (_, i) => ({ t: i * 60_000, v: 50 + i * 0.5 }));
    assert.deepEqual(detectAnomalies(s), []);
  });

  test("normal jitter stays quiet", () => {
    const s = Array.from({ length: 60 }, (_, i) => ({ t: i * 60_000, v: 50 + (i % 5) }));
    assert.deepEqual(detectAnomalies(s), []);
  });

  test("options are honoured", () => {
    const s = withSpikeAt(30, 25, 60);
    assert.ok(detectAnomalies(s, { threshold: 2 }).length >= 1);
    assert.deepEqual(detectAnomalies(s, { threshold: 50 }), []);
  });
});

describe("describeAnomalies", () => {
  test("wording", () => {
    assert.equal(describeAnomalies(0), null);
    assert.equal(describeAnomalies(1), "1 unusual spike in this window");
    assert.equal(describeAnomalies(3), "3 unusual spikes in this window");
  });
});
