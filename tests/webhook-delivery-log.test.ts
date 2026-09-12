/**
 * Tests for the webhook delivery log (pure layer).
 *
 *   npm test
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { pushDelivery, formatDeliveryLine, DELIVERY_LOG_MAX, type DeliveryEntry } from "../src/lib/webhook-delivery-log";

const e = (over: Partial<DeliveryEntry> = {}): DeliveryEntry => ({
  atMs: 1_700_000_000_000,
  action: "server.started",
  attempted: true,
  ok: true,
  status: 204,
  error: null,
  ...over,
});

describe("pushDelivery", () => {
  test("appends newest last and caps at max", () => {
    let ring: DeliveryEntry[] = [];
    for (let i = 0; i < DELIVERY_LOG_MAX + 10; i++) {
      ring = pushDelivery(ring, e({ action: `a${i}` }));
    }
    assert.equal(ring.length, DELIVERY_LOG_MAX);
    assert.equal(ring[ring.length - 1].action, `a${DELIVERY_LOG_MAX + 9}`);
    assert.equal(ring[0].action, "a10"); // the oldest 10 were dropped
  });

  test("never mutates the input array", () => {
    const before = [e()];
    pushDelivery(before, e({ action: "second" }));
    assert.equal(before.length, 1);
  });
});

describe("formatDeliveryLine", () => {
  test("delivered line shows the HTTP status", () => {
    assert.match(formatDeliveryLine(e()), /delivered \(HTTP 204\)/);
    assert.match(formatDeliveryLine(e()), /server\.started/);
  });

  test("skipped line explains why nothing went out", () => {
    const line = formatDeliveryLine(e({ attempted: false, ok: false, status: null, error: "no webhook URL configured" }));
    assert.match(line, /skipped/);
    assert.match(line, /no webhook URL configured/);
  });

  test("failed line carries the status and/or error", () => {
    assert.match(formatDeliveryLine(e({ ok: false, status: 500, error: "HTTP 500" })), /failed \(HTTP 500\)/);
    assert.match(formatDeliveryLine(e({ ok: false, status: null, error: "timeout" })), /failed — timeout/);
  });
});
