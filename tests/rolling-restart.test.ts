/**
 * Tests for rolling-restart planning (pure layer).
 *
 * The safety contract: only running servers participate, each restart must be
 * verified before the sweep continues, and one failure halts the rest.
 *
 *   npm test
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  planRollingRestart,
  parseRollingFlag,
  shouldContinueRolling,
  formatRollingRestartSummary,
  SETTLE_MS,
} from "../src/lib/rolling-restart";

const srv = (id: number, status: string, name = `srv-${id}`) => ({ id, name, status });

describe("planRollingRestart", () => {
  test("only running servers participate, in caller order", () => {
    const plan = planRollingRestart([srv(1, "running"), srv(2, "running"), srv(3, "stopped")]);
    assert.deepEqual(plan.eligible.map((s) => s.id), [1, 2]);
    assert.deepEqual(plan.blocked.map((b) => b.server.id), [3]);
    assert.match(plan.blocked[0].reason, /not running/);
  });

  test("non-running statuses are blocked with reasons, never dropped", () => {
    const plan = planRollingRestart([srv(1, "stopped"), srv(2, "installing"), srv(3, "crashed")]);
    assert.deepEqual(plan.eligible, []);
    assert.equal(plan.blocked.length, 3);
    for (const b of plan.blocked) assert.match(b.reason, /status is/);
  });

  test("empty batch yields an empty plan", () => {
    const plan = planRollingRestart([]);
    assert.deepEqual(plan.eligible, []);
    assert.deepEqual(plan.blocked, []);
  });
});

describe("parseRollingFlag", () => {
  test("only an explicit true counts as rolling", () => {
    assert.equal(parseRollingFlag({ action: "restart", serverIds: [1], rolling: true }), true);
    assert.equal(parseRollingFlag({ action: "restart", serverIds: [1], rolling: false }), false);
    assert.equal(parseRollingFlag({ action: "restart", serverIds: [1], rolling: "true" }), false);
    assert.equal(parseRollingFlag({ action: "restart", serverIds: [1] }), false);
    assert.equal(parseRollingFlag(null), false);
    assert.equal(parseRollingFlag([true]), false);
  });
});

describe("shouldContinueRolling", () => {
  test("sweep continues only on a verified restart", () => {
    assert.equal(shouldContinueRolling(true), true);
    assert.equal(shouldContinueRolling(false), false);
  });
});

describe("formatRollingRestartSummary", () => {
  test("halt names the dark server and promises the fleet is untouched", () => {
    const s = formatRollingRestartSummary({ haltedAt: "alpha", restarted: 2, blockedCount: 1 });
    assert.match(s, /HALTED/);
    assert.match(s, /alpha/);
    assert.match(s, /remaining servers untouched/);
  });

  test("success reports the count and non-running skipped", () => {
    const s = formatRollingRestartSummary({ haltedAt: null, restarted: 4, blockedCount: 2 });
    assert.match(s, /4 restarted/);
    assert.match(s, /2 not running/);
  });

  test("success without skipped has no tail", () => {
    const s = formatRollingRestartSummary({ haltedAt: null, restarted: 3, blockedCount: 0 });
    assert.doesNotMatch(s, /not running/);
  });
});

test("SETTLE_MS is a sane positive window", () => {
  assert.ok(SETTLE_MS >= 5_000 && SETTLE_MS <= 60_000);
});
