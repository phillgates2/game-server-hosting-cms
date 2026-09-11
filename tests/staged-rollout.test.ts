/**
 * Tests for staged rollout planning (pure layer).
 *
 * The safety contract: a canary is chosen deterministically, non-stopped
 * servers are blocked with reasons, and the rest of the fleet is only swept
 * when BOTH the canary update and its boot verification succeed.
 *
 *   npm test
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  planStagedRollout,
  parseStagedFlag,
  shouldSweepRest,
  formatRolloutSummary,
  BOOT_GRACE_MS,
} from "../src/lib/staged-rollout";

const srv = (id: number, status: string, name = `srv-${id}`) => ({ id, name, status });

describe("planStagedRollout", () => {
  test("first eligible (stopped) server is the canary; rest follow in order", () => {
    const plan = planStagedRollout([srv(1, "stopped"), srv(2, "stopped"), srv(3, "stopped")]);
    assert.equal(plan.canary?.id, 1);
    assert.deepEqual(plan.rest.map((s) => s.id), [2, 3]);
    assert.equal(plan.blocked.length, 0);
  });

  test("running/installing servers are blocked with human reasons, never dropped", () => {
    const plan = planStagedRollout([srv(1, "running"), srv(2, "installing"), srv(3, "stopped"), srv(4, "crashed")]);
    assert.equal(plan.canary?.id, 3);
    assert.deepEqual(plan.rest, []);
    assert.deepEqual(plan.blocked.map((b) => b.server.id), [1, 2, 4]);
    assert.match(plan.blocked[0].reason, /stop it first/);
    assert.match(plan.blocked[1].reason, /already installing/);
    assert.match(plan.blocked[2].reason, /crashed/);
  });

  test("no eligible servers means no canary and an empty sweep", () => {
    const plan = planStagedRollout([srv(1, "running"), srv(2, "installing")]);
    assert.equal(plan.canary, null);
    assert.deepEqual(plan.rest, []);
    assert.equal(plan.blocked.length, 2);
  });

  test("empty batch yields an empty plan", () => {
    const plan = planStagedRollout([]);
    assert.equal(plan.canary, null);
    assert.deepEqual(plan.rest, []);
    assert.deepEqual(plan.blocked, []);
  });

  test("canary is never included in the sweep", () => {
    const plan = planStagedRollout([srv(7, "stopped")]);
    assert.equal(plan.canary?.id, 7);
    assert.deepEqual(plan.rest, []);
  });

  test("deterministic: canary is the first eligible in caller order", () => {
    const plan = planStagedRollout([srv(9, "running"), srv(5, "stopped"), srv(2, "stopped")]);
    assert.equal(plan.canary?.id, 5);
    assert.deepEqual(plan.rest.map((s) => s.id), [2]);
  });
});

describe("parseStagedFlag", () => {
  test("only an explicit true counts as staged", () => {
    assert.equal(parseStagedFlag({ serverIds: [1], staged: true }), true);
    assert.equal(parseStagedFlag({ serverIds: [1], staged: false }), false);
    assert.equal(parseStagedFlag({ serverIds: [1], staged: "true" }), false);
    assert.equal(parseStagedFlag({ serverIds: [1] }), false);
    assert.equal(parseStagedFlag(null), false);
    assert.equal(parseStagedFlag([true]), false);
  });
});

describe("shouldSweepRest", () => {
  test("sweep requires BOTH update success and boot survival", () => {
    assert.equal(shouldSweepRest(true, true), true);
    assert.equal(shouldSweepRest(true, false), false);
    assert.equal(shouldSweepRest(false, true), false);
    assert.equal(shouldSweepRest(false, false), false);
  });
});

describe("formatRolloutSummary", () => {
  test("halted on update failure names the canary and says fleet untouched", () => {
    const s = formatRolloutSummary({ canaryName: "alpha", halted: "canary-update-failed", updated: 0, failed: 1, blockedCount: 0 });
    assert.match(s, /HALTED/);
    assert.match(s, /alpha/);
    assert.match(s, /fleet untouched/);
  });

  test("halted on boot failure is distinguished from update failure", () => {
    const s = formatRolloutSummary({ canaryName: "alpha", halted: "canary-boot-failed", updated: 1, failed: 0, blockedCount: 0 });
    assert.match(s, /boot verification/);
  });

  test("success summary reports verified canary and counts", () => {
    const s = formatRolloutSummary({ canaryName: "alpha", halted: null, updated: 5, failed: 0, blockedCount: 2 });
    assert.match(s, /verified/);
    assert.match(s, /5 updated/);
    assert.match(s, /2 blocked/);
  });

  test("success summary mentions failures when present", () => {
    const s = formatRolloutSummary({ canaryName: "alpha", halted: null, updated: 3, failed: 1, blockedCount: 0 });
    assert.match(s, /1 failed/);
    assert.doesNotMatch(s, /blocked/);
  });
});

test("BOOT_GRACE_MS is a sane positive window", () => {
  assert.ok(BOOT_GRACE_MS >= 5_000 && BOOT_GRACE_MS <= 60_000);
});
