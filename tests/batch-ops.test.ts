/**
 * Tests for batch process operations.
 *
 * The batch route delegates each server to the real per-server handler, so
 * the pure layer's job is strict input validation and never dispatching a
 * server the caller does not own.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  validateBatchRequest,
  validateBatchServerIds,
  partitionBatch,
  BATCH_MAX_SIZE,
} from "../src/lib/batch-ops";

describe("validateBatchRequest — happy paths", () => {
  test("accepts a valid restart batch", () => {
    const res = validateBatchRequest({ action: "restart", serverIds: [1, 2, 3] });
    assert.equal(res.ok, true);
    assert.deepEqual(res.value, { action: "restart", serverIds: [1, 2, 3] });
  });

  test("accepts all three actions", () => {
    for (const action of ["start", "stop", "restart"]) {
      assert.equal(validateBatchRequest({ action, serverIds: [1] }).ok, true, action);
    }
  });

  test("dedupes ids and preserves order", () => {
    const res = validateBatchRequest({ action: "start", serverIds: [5, 3, 5, 3, 9] });
    assert.deepEqual(res.value?.serverIds, [5, 3, 9]);
  });

  test("numeric strings are coerced to ids", () => {
    const res = validateBatchRequest({ action: "stop", serverIds: ["7", "11"] });
    assert.deepEqual(res.value?.serverIds, [7, 11]);
  });

  test("accepts exactly the cap", () => {
    const ids = Array.from({ length: BATCH_MAX_SIZE }, (_, i) => i + 1);
    assert.equal(validateBatchRequest({ action: "start", serverIds: ids }).ok, true);
  });
});

describe("validateBatchRequest — rejection", () => {
  test("rejects non-object bodies", () => {
    for (const bad of [null, undefined, "x", 5, [], true]) {
      assert.equal(validateBatchRequest(bad).ok, false, String(bad));
    }
  });

  test("rejects unknown or missing actions", () => {
    assert.equal(validateBatchRequest({ serverIds: [1] }).ok, false);
    assert.equal(validateBatchRequest({ action: "status", serverIds: [1] }).ok, false);
    assert.equal(validateBatchRequest({ action: "delete", serverIds: [1] }).ok, false);
    assert.equal(validateBatchRequest({ action: 42, serverIds: [1] }).ok, false);
  });

  test("rejects missing or empty serverIds", () => {
    assert.equal(validateBatchRequest({ action: "start" }).ok, false);
    assert.equal(validateBatchRequest({ action: "start", serverIds: [] }).ok, false);
    assert.equal(validateBatchRequest({ action: "start", serverIds: "1,2" }).ok, false);
  });

  test("rejects non-positive or fractional ids", () => {
    for (const ids of [[0], [-1], [1.5], [NaN], [null], [{}], [true]]) {
      assert.equal(validateBatchRequest({ action: "start", serverIds: ids }).ok, false, JSON.stringify(ids));
    }
  });

  test("rejects more than the cap", () => {
    const over = Array.from({ length: BATCH_MAX_SIZE + 1 }, (_, i) => i + 1);
    const res = validateBatchRequest({ action: "start", serverIds: over });
    assert.equal(res.ok, false);
    assert.match(res.error ?? "", /25/);
  });

  test("rejects grossly oversized payloads up front", () => {
    const huge = Array.from({ length: BATCH_MAX_SIZE * 2 + 1 }, (_, i) => i + 1);
    assert.equal(validateBatchRequest({ action: "start", serverIds: huge }).ok, false);
  });
});

describe("partitionBatch", () => {
  const rows = [
    { id: 1, name: "mine", userId: 10 },
    { id: 2, name: "someone-elses", userId: 99 },
    { id: 3, name: "unowned", userId: null },
  ];

  test("admins may dispatch every existing server", () => {
    const { dispatchable, skippedIds } = partitionBatch(rows, [1, 2, 3], true, 10);
    assert.deepEqual(dispatchable.map((r) => r.id), [1, 2, 3]);
    assert.deepEqual(skippedIds, []);
  });

  test("non-admins only dispatch their own servers", () => {
    const { dispatchable, skippedIds } = partitionBatch(rows, [1, 2], false, 10);
    assert.deepEqual(dispatchable.map((r) => r.id), [1]);
    assert.deepEqual(skippedIds, [2]);
  });

  test("unknown ids are skipped", () => {
    const { dispatchable, skippedIds } = partitionBatch(rows, [1, 404], true, 10);
    assert.deepEqual(dispatchable.map((r) => r.id), [1]);
    assert.deepEqual(skippedIds, [404]);
  });

  test("unowned servers are skipped for non-admins but fine for admins", () => {
    const nonAdmin = partitionBatch(rows, [3], false, 10);
    assert.deepEqual(nonAdmin.skippedIds, [3]);
    const admin = partitionBatch(rows, [3], true, 10);
    assert.deepEqual(admin.dispatchable.map((r) => r.id), [3]);
  });

  test("empty request dispatches nothing", () => {
    const { dispatchable, skippedIds } = partitionBatch(rows, [], false, 10);
    assert.deepEqual(dispatchable, []);
    assert.deepEqual(skippedIds, []);
  });
});

describe("validateBatchServerIds", () => {
  test("accepts and dedupes plain id lists", () => {
    assert.deepEqual(validateBatchServerIds({ serverIds: [3, 1, 3] }).value, [3, 1]);
    assert.deepEqual(validateBatchServerIds({ serverIds: ["7", 8] }).value, [7, 8]);
  });

  test("ignores extra verbs/fields but rejects bad ids", () => {
    assert.equal(validateBatchServerIds({ action: "delete", serverIds: [1] }).ok, true);
    assert.equal(validateBatchServerIds({ serverIds: [0] }).ok, false);
    assert.equal(validateBatchServerIds({ serverIds: [] }).ok, false);
    assert.equal(validateBatchServerIds({}).ok, false);
    assert.equal(validateBatchServerIds(null).ok, false);
  });

  test("honours a custom cap", () => {
    assert.equal(validateBatchServerIds({ serverIds: [1, 2, 3] }, 2).ok, false);
    assert.equal(validateBatchServerIds({ serverIds: [1, 2] }, 2).ok, true);
    const huge = Array.from({ length: 21 }, (_, i) => i + 1);
    assert.equal(validateBatchServerIds({ serverIds: huge }, 10).ok, false);
  });
});
