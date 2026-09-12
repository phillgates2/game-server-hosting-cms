/**
 * Tests for the shop: pricing, buyer emails, fulfilment rules, and the
 * Stripe webhook signature verification (with real HMAC construction).
 *
 *   npm test
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  isValidOrderEmail,
  formatPrice,
  orderCanFulfil,
  isValidProductPrice,
  normalizeCouponCode,
  couponUsable,
  applyCoupon,
} from "../src/lib/shop";
import {
  verifyStripeSignature,
  buildStripeSignatureHeader,
  stripeFormEncode,
  STRIPE_SIGNATURE_TOLERANCE_MS,
} from "../src/lib/shop-stripe";

describe("isValidOrderEmail", () => {
  test("accepts normal addresses", () => {
    assert.equal(isValidOrderEmail("buyer@example.com"), true);
    assert.equal(isValidOrderEmail("a.b+tag@shop.example.co"), true);
    assert.equal(isValidOrderEmail("  buyer@example.com  "), true);
  });

  test("rejects broken shapes", () => {
    for (const bad of ["", "no-at-sign", "@nodomain.com", "no@domain", "no@.com", "no@domain.", "a b@c.com", "x".repeat(300) + "@a.co"]) {
      assert.equal(isValidOrderEmail(bad), false, JSON.stringify(bad));
    }
    assert.equal(isValidOrderEmail(null), false);
    assert.equal(isValidOrderEmail(42), false);
  });
});

describe("formatPrice", () => {
  test("cents become human prices per currency", () => {
    assert.equal(formatPrice(900, "usd"), "$9.00");
    assert.equal(formatPrice(99, "usd"), "$0.99");
    assert.equal(formatPrice(2500, "eur"), "€25.00");
    assert.equal(formatPrice(100, "aud"), "AUD 1.00");
  });
});

describe("orderCanFulfil", () => {
  test("only payable states fulfil; double-fulfil impossible", () => {
    assert.equal(orderCanFulfil("pending"), true);
    assert.equal(orderCanFulfil("paid"), true);
    assert.equal(orderCanFulfil("fulfilled"), false);
    assert.equal(orderCanFulfil("cancelled"), false);
  });
});

describe("isValidProductPrice", () => {
  test("whole cents within the cap", () => {
    assert.equal(isValidProductPrice(0), true);
    assert.equal(isValidProductPrice(999), true);
    assert.equal(isValidProductPrice(-1), false);
    assert.equal(isValidProductPrice(10.5), false);
    assert.equal(isValidProductPrice("abc"), false);
    assert.equal(isValidProductPrice(100_000_001), false);
  });
});

describe("stripeFormEncode", () => {
  test("form-encodes like Stripe expects", () => {
    assert.equal(
      stripeFormEncode({ mode: "payment", "metadata[order_id]": "7", "line_items[0][price_data][product_data][name]": "Solo license & more" }),
      "mode=payment&metadata%5Border_id%5D=7&line_items%5B0%5D%5Bprice_data%5D%5Bproduct_data%5D%5Bname%5D=Solo%20license%20%26%20more"
    );
  });
});

describe("verifyStripeSignature (real HMAC)", () => {
  const secret = "whsec_test_secret";
  const payload = '{"type":"checkout.session.completed","data":{"object":{"id":"cs_1","metadata":{"order_id":"7"}}}}';
  const NOW = 1_700_000_000_000;
  const tSec = Math.floor(NOW / 1000);

  test("a correctly signed, fresh webhook passes", () => {
    const header = buildStripeSignatureHeader({ payload, secret, timestampSec: tSec });
    assert.equal(verifyStripeSignature({ header, payload, secret, nowMs: NOW }), true);
  });

  test("tampered payload fails", () => {
    const header = buildStripeSignatureHeader({ payload, secret, timestampSec: tSec });
    assert.equal(verifyStripeSignature({ header, payload: payload.replace("cs_1", "cs_2"), secret, nowMs: NOW }), false);
  });

  test("wrong secret fails", () => {
    const header = buildStripeSignatureHeader({ payload, secret, timestampSec: tSec });
    assert.equal(verifyStripeSignature({ header, payload, secret: "whsec_other", nowMs: NOW }), false);
  });

  test("stale timestamps outside the replay window fail", () => {
    const staleSec = Math.floor((NOW - STRIPE_SIGNATURE_TOLERANCE_MS - 60_000) / 1000);
    const header = buildStripeSignatureHeader({ payload, secret, timestampSec: staleSec });
    assert.equal(verifyStripeSignature({ header, payload, secret, nowMs: NOW }), false);
  });

  test("malformed headers fail closed", () => {
    assert.equal(verifyStripeSignature({ header: null, payload, secret, nowMs: NOW }), false);
    assert.equal(verifyStripeSignature({ header: "", payload, secret, nowMs: NOW }), false);
    assert.equal(verifyStripeSignature({ header: "t=123", payload, secret, nowMs: NOW }), false);
    assert.equal(verifyStripeSignature({ header: "v1=abc", payload, secret, nowMs: NOW }), false);
    assert.equal(verifyStripeSignature({ header: "t=notanumber,v1=abc", payload, secret, nowMs: NOW }), false);
    assert.equal(verifyStripeSignature({ header: "t=123,v1=abc", payload, secret: "", nowMs: NOW }), false);
  });
});

// ── Coupons ─────────────────────────────────────────────────────────────────
describe("coupons", () => {
const NOW = 1_700_000_000_000;

describe("normalizeCouponCode", () => {
  test("uppercases and trims valid codes", () => {
    assert.equal(normalizeCouponCode(" summer25 "), "SUMMER25");
    assert.equal(normalizeCouponCode("VIP-2026_X"), "VIP-2026_X");
  });
  test("rejects junk", () => {
    assert.equal(normalizeCouponCode("ab"), null); // too short
    assert.equal(normalizeCouponCode("has space"), null);
    assert.equal(normalizeCouponCode("-leading"), null);
    assert.equal(normalizeCouponCode(null), null);
    assert.equal(normalizeCouponCode("x".repeat(70)), null);
  });
});

describe("couponUsable", () => {
  const base = { active: true, expiresAtMs: null as number | null, maxUses: null as number | null, usedCount: 0 };
  test("happy path", () => assert.equal(couponUsable(base, NOW), true));
  test("inactive refused", () => assert.equal(couponUsable({ ...base, active: false }, NOW), false));
  test("expired refused at the boundary", () => {
    assert.equal(couponUsable({ ...base, expiresAtMs: NOW }, NOW), false);
    assert.equal(couponUsable({ ...base, expiresAtMs: NOW + 1 }, NOW), true);
  });
  test("used-up refused at the cap", () => {
    assert.equal(couponUsable({ ...base, maxUses: 5, usedCount: 5 }, NOW), false);
    assert.equal(couponUsable({ ...base, maxUses: 5, usedCount: 4 }, NOW), true);
  });
});

describe("applyCoupon", () => {
  test("percent discounts round to whole cents, floored at zero", () => {
    assert.equal(applyCoupon({ kind: "percent", value: 25 }, 999), 749); // 749.25 -> 749
    assert.equal(applyCoupon({ kind: "percent", value: 100 }, 999), 0);
    assert.equal(applyCoupon({ kind: "percent", value: 250 }, 999), 0); // clamped
  });
  test("fixed discounts subtract cents, floored at zero", () => {
    assert.equal(applyCoupon({ kind: "fixed", value: 200 }, 999), 799);
    assert.equal(applyCoupon({ kind: "fixed", value: 5000 }, 999), 0);
    assert.equal(applyCoupon({ kind: "fixed", value: -50 }, 999), 999); // negatives ignored
  });
});

});

// ── Subscriptions ───────────────────────────────────────────────────────────
describe("subscriptions", () => {
  test("intervalToDays: generous periods, never short", () => {
    const { intervalToDays } = require("../src/lib/shop") as typeof import("../src/lib/shop");
    assert.equal(intervalToDays("month"), 31);
    assert.equal(intervalToDays("year"), 366);
  });

  test("nextRenewalExpiryMs stacks on a live expiry, restarts from now when lapsed", () => {
    const { nextRenewalExpiryMs } = require("../src/lib/shop") as typeof import("../src/lib/shop");
    const now = 1_700_000_000_000;
    const month = 31 * 86_400_000;
    // live expiry: stack
    assert.equal(
      nextRenewalExpiryMs({ currentExpiryMs: now + 10 * 86_400_000, intervalMs: month, nowMs: now }),
      now + 10 * 86_400_000 + month
    );
    // lapsed: renew from now
    assert.equal(
      nextRenewalExpiryMs({ currentExpiryMs: now - 5 * 86_400_000, intervalMs: month, nowMs: now }),
      now + month
    );
    // never had one
    assert.equal(nextRenewalExpiryMs({ currentExpiryMs: null, intervalMs: month, nowMs: now }), now + month);
    // boundary: expiry exactly now counts as lapsed
    assert.equal(nextRenewalExpiryMs({ currentExpiryMs: now, intervalMs: month, nowMs: now }), now + month);
  });
});

// ── Resellers ───────────────────────────────────────────────────────────────
describe("resellers", () => {
  test("commissionFor: floored cents, clamped percent", () => {
    const { commissionFor } = require("../src/lib/shop") as typeof import("../src/lib/shop");
    assert.equal(commissionFor(1000, 10), 100);
    assert.equal(commissionFor(999, 33), 329); // 329.67 -> 329
    assert.equal(commissionFor(1000, 150), 900); // clamped to 90%
    assert.equal(commissionFor(1000, -5), 0);
    assert.equal(commissionFor(0, 50), 0);
  });

  test("totalCommission ignores nulls", () => {
    const { totalCommission } = require("../src/lib/shop") as typeof import("../src/lib/shop");
    assert.equal(totalCommission([{ commissionCents: 100 }, { commissionCents: null }, { commissionCents: 50 }]), 150);
    assert.equal(totalCommission([]), 0);
  });

  test("normalizeResellerToken shape", () => {
    const { normalizeResellerToken } = require("../src/lib/shop") as typeof import("../src/lib/shop");
    assert.equal(normalizeResellerToken("GSMR_" + "a".repeat(40)), "GSMR_" + "a".repeat(40));
    assert.equal(normalizeResellerToken("gsmr_" + "a".repeat(40)), null); // prefix case-sensitive
    assert.equal(normalizeResellerToken("GSMR_short"), null);
    assert.equal(normalizeResellerToken("XXXX_" + "a".repeat(40)), null);
    assert.equal(normalizeResellerToken(null), null);
  });
});

// ── Refunds ─────────────────────────────────────────────────────────────────
describe("refunds", () => {
  test("orderCanRefund: only money-moved states; pending cancels instead", () => {
    const { orderCanRefund, orderCanCancel } = require("../src/lib/shop") as typeof import("../src/lib/shop");
    assert.equal(orderCanRefund("paid"), true);
    assert.equal(orderCanRefund("fulfilled"), true);
    assert.equal(orderCanRefund("pending"), false);
    assert.equal(orderCanRefund("cancelled"), false);
    assert.equal(orderCanRefund("refunded"), false); // no double-refunds
    assert.equal(orderCanCancel("pending"), true);
    assert.equal(orderCanCancel("paid"), false);
    assert.equal(orderCanCancel("fulfilled"), false);
  });
});
