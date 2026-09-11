/**
 * Tests for node health scoring — the smart node picker's brain.
 *
 * The picker must never recommend an offline node, must disqualify nodes
 * that are out of disk/RAM, must treat stale heartbeats as mediocre rather
 * than great, and must always produce an answer when any node is online.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  scoreNode,
  recommendNodeId,
  nodeWarnings,
  diskFreeMb,
  ramFreeMb,
  isMetricFresh,
  nodeLoadLabel,
  FRESH_METRIC_AGE_MS,
  MIN_FREE_DISK_MB,
  MIN_FREE_RAM_MB,
  type NodeCandidate,
  type NodeLoad,
} from "../src/lib/node-health";

const NOW = 1_700_000_000_000;

function load(partial: Partial<NodeLoad> = {}): NodeLoad {
  return {
    cpuPercent: 10,
    ramUsedMb: 2_048,
    ramTotalMb: 16_384,
    diskUsedMb: 100_000,
    diskTotalMb: 500_000,
    recordedAt: NOW - 60_000,
    ...partial,
  };
}

function candidate(partial: Partial<NodeCandidate> = {}): NodeCandidate {
  return { id: 1, online: true, load: load(), serverCount: 2, ...partial };
}

describe("maintenance mode", () => {
  test("maintenance nodes are never eligible", () => {
    assert.equal(scoreNode(candidate({ maintenance: true }), NOW), Infinity);
  });

  test("the recommendation skips maintenance nodes", () => {
    const draining = candidate({ id: 1, maintenance: true, load: load({ cpuPercent: 1 }) });
    const normal = candidate({ id: 2, load: load({ cpuPercent: 80 }) });
    assert.equal(recommendNodeId([draining, normal], NOW), 2);
  });

  test("maintenance nodes carry a warning even without metrics", () => {
    const w = nodeWarnings(candidate({ maintenance: true, load: null }), NOW);
    assert.ok(w.some((m) => m.includes("Under maintenance")), w.join("; "));
  });
});

describe("free-space helpers", () => {
  test("computes disk and RAM free space", () => {
    assert.equal(diskFreeMb(load()), 400_000);
    assert.equal(ramFreeMb(load()), 14_336);
  });

  test("clamps negative free space at zero", () => {
    assert.equal(diskFreeMb(load({ diskUsedMb: 600_000 })), 0);
    assert.equal(ramFreeMb(load({ ramUsedMb: 99_999 })), 0);
  });

  test("missing load or fields yield null", () => {
    assert.equal(diskFreeMb(null), null);
    assert.equal(ramFreeMb(load({ ramTotalMb: null })), null);
    assert.equal(diskFreeMb(load({ diskUsedMb: null })), null);
  });
});

describe("freshness", () => {
  test("a recent heartbeat is fresh", () => {
    assert.equal(isMetricFresh(load(), NOW), true);
    assert.equal(isMetricFresh(load({ recordedAt: NOW - FRESH_METRIC_AGE_MS }), NOW), true);
  });

  test("an old or missing heartbeat is stale", () => {
    assert.equal(isMetricFresh(load({ recordedAt: NOW - FRESH_METRIC_AGE_MS - 1 }), NOW), false);
    assert.equal(isMetricFresh(load({ recordedAt: null }), NOW), false);
    assert.equal(isMetricFresh(null, NOW), false);
  });
});

describe("scoreNode", () => {
  test("offline nodes are never eligible", () => {
    assert.equal(scoreNode(candidate({ online: false }), NOW), Infinity);
  });

  test("nodes under the disk floor are disqualified", () => {
    const c = candidate({ load: load({ diskTotalMb: 100_000, diskUsedMb: 100_000 - MIN_FREE_DISK_MB + 1 }) });
    assert.equal(scoreNode(c, NOW), Infinity);
  });

  test("nodes under the RAM floor are disqualified", () => {
    const c = candidate({ load: load({ ramTotalMb: 4_096, ramUsedMb: 4_096 - MIN_FREE_RAM_MB + 1 }) });
    assert.equal(scoreNode(c, NOW), Infinity);
  });

  test("a busier node scores higher (worse)", () => {
    const idle = scoreNode(candidate({ load: load({ cpuPercent: 5, ramUsedMb: 1_024 }) }), NOW);
    const busy = scoreNode(candidate({ load: load({ cpuPercent: 80, ramUsedMb: 12_000 }) }), NOW);
    assert.ok(busy > idle, `busy ${busy} should exceed idle ${idle}`);
  });

  test("more existing servers raises the score", () => {
    const few = scoreNode(candidate({ serverCount: 0 }), NOW);
    const many = scoreNode(candidate({ serverCount: 10 }), NOW);
    assert.ok(many > few);
  });

  test("no metrics → mediocre penalty, still finite", () => {
    const s = scoreNode(candidate({ load: null }), NOW);
    assert.ok(Number.isFinite(s), "nodes without metrics must remain eligible");
  });

  test("stale metrics are penalised like missing metrics", () => {
    const stale = scoreNode(candidate({ load: load({ recordedAt: NOW - FRESH_METRIC_AGE_MS - 5_000 }) }), NOW);
    const missing = scoreNode(candidate({ load: null }), NOW);
    assert.equal(stale, missing);
  });

  test("CPU contribution is clamped to 0..100", () => {
    const wild = scoreNode(candidate({ load: load({ cpuPercent: 5_000 }) }), NOW);
    const capped = scoreNode(candidate({ load: load({ cpuPercent: 100 }) }), NOW);
    assert.equal(wild, capped);
  });
});

describe("recommendNodeId", () => {
  test("picks the lowest-scoring online node", () => {
    const busy = candidate({ id: 1, load: load({ cpuPercent: 90, ramUsedMb: 15_000 }) });
    const calm = candidate({ id: 2, load: load({ cpuPercent: 5, ramUsedMb: 1_000 }) });
    assert.equal(recommendNodeId([busy, calm], NOW), 2);
  });

  test("skips offline and disqualified nodes", () => {
    const offline = candidate({ id: 1, online: false });
    const full = candidate({ id: 2, load: load({ diskTotalMb: 10_000, diskUsedMb: 9_999 }) });
    const ok = candidate({ id: 3 });
    assert.equal(recommendNodeId([offline, full, ok], NOW), 3);
  });

  test("still answers when every eligible node is mediocre (stale)", () => {
    const stale = candidate({ id: 7, load: load({ recordedAt: NOW - FRESH_METRIC_AGE_MS - 1_000 }) });
    assert.equal(recommendNodeId([stale], NOW), 7);
  });

  test("returns null with no candidates or only offline nodes", () => {
    assert.equal(recommendNodeId([], NOW), null);
    assert.equal(recommendNodeId([candidate({ online: false })], NOW), null);
  });
});

describe("nodeWarnings", () => {
  test("flags nearly-full disks", () => {
    const w = nodeWarnings(candidate({ load: load({ diskTotalMb: 100_000, diskUsedMb: 95_000 }) }), NOW);
    assert.ok(w.some((m) => m.includes("Disk nearly full (95% used)")), w.join("; "));
  });

  test("flags low RAM", () => {
    const w = nodeWarnings(candidate({ load: load({ ramTotalMb: 4_096, ramUsedMb: 3_600 }) }), NOW);
    assert.ok(w.some((m) => m.includes("RAM free")), w.join("; "));
  });

  test("flags stale heartbeats with age", () => {
    const w = nodeWarnings(candidate({ load: load({ recordedAt: NOW - 30 * 60_000 }) }), NOW);
    assert.ok(w.some((m) => m.includes("~30 min ago")), w.join("; "));
  });

  test("a healthy node has no warnings", () => {
    assert.deepEqual(nodeWarnings(candidate(), NOW), []);
  });

  test("no metrics means nothing to warn about", () => {
    assert.deepEqual(nodeWarnings(candidate({ load: null }), NOW), []);
  });
});

describe("nodeLoadLabel", () => {
  test("renders cpu/ram/disk summary", () => {
    assert.equal(nodeLoadLabel(load({ cpuPercent: 12.4 })), "CPU 12% · RAM 2.0/16.0 GB · Disk 20%");
  });

  test("skips missing fields and handles null load", () => {
    assert.equal(nodeLoadLabel(null), null);
    assert.equal(nodeLoadLabel(load({ cpuPercent: null, diskTotalMb: null })), "RAM 2.0/16.0 GB");
    assert.equal(nodeLoadLabel({ cpuPercent: null, ramUsedMb: null, ramTotalMb: null, diskUsedMb: null, diskTotalMb: null, recordedAt: null }), null);
  });
});
