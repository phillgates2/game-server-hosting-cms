/**
 * Stripe provider for the shop — raw REST, no SDK, matching the panel's
 * zero-dependency style.
 *
 * Two halves:
 *   1. createStripeCheckoutSession — server-side session creation using the
 *      secret key (form-encoded, exactly as Stripe's API expects).
 *   2. verifyStripeSignature — PURE webhook signature verification
 *      (Stripe-Signature: t=<ts>,v1=<hmac> over "<ts>.<payload>"), unit
 *      tested with a constructed header.
 */

export const STRIPE_SECRET_KEY_ENV = "STRIPE_SECRET_KEY";
export const STRIPE_WEBHOOK_SECRET_ENV = "STRIPE_WEBHOOK_SECRET";
export const STRIPE_API_BASE = "https://api.stripe.com";
/** Webhook timestamps older than this are rejected (replay protection). */
export const STRIPE_SIGNATURE_TOLERANCE_MS = 5 * 60_000;

export function stripeEnabled(): boolean {
  const key = process.env[STRIPE_SECRET_KEY_ENV]?.trim() ?? "";
  return key.length > 0;
}

/** Pure form-encoder for Stripe's application/x-www-form-urlencoded API. */
export function stripeFormEncode(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

/**
 * Pure Stripe webhook signature verification.
 * header: `t=1614556828,v1=5257a869e7e...,v0=...`
 * Returns false on ANY mismatch: bad shape, stale timestamp, or HMAC.
 */
export function verifyStripeSignature(input: {
  header: string | null | undefined;
  payload: string;
  secret: string;
  nowMs: number;
  toleranceMs?: number;
}): boolean {
  const { header, payload, secret, nowMs } = input;
  const tolerance = input.toleranceMs ?? STRIPE_SIGNATURE_TOLERANCE_MS;
  if (!header || !secret) return false;

  const parts = new Map<string, string>();
  for (const chunk of header.split(",")) {
    const idx = chunk.indexOf("=");
    if (idx <= 0) continue;
    const k = chunk.slice(0, idx).trim();
    const v = chunk.slice(idx + 1).trim();
    if (!parts.has(k)) parts.set(k, v);
  }
  const tRaw = parts.get("t");
  const v1 = parts.get("v1");
  if (!tRaw || !v1) return false;

  const tSec = Number(tRaw);
  if (!Number.isFinite(tSec)) return false;
  if (Math.abs(nowMs - tSec * 1000) > tolerance) return false;

  try {
    const { createHmac, timingSafeEqual } = require("node:crypto") as typeof import("node:crypto");
    const expected = createHmac("sha256", secret).update(`${tRaw}.${payload}`).digest("hex");
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(v1, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Build the signed header (used by tests and anyone simulating Stripe). */
export function buildStripeSignatureHeader(input: {
  payload: string;
  secret: string;
  timestampSec: number;
}): string {
  const { createHmac } = require("node:crypto") as typeof import("node:crypto");
  const sig = createHmac("sha256", input.secret)
    .update(`${input.timestampSec}.${input.payload}`)
    .digest("hex");
  return `t=${input.timestampSec},v1=${sig}`;
}

/**
 * Create a Checkout Session. Returns the redirect URL, or {error}.
 * Requires STRIPE_SECRET_KEY; line_items use price_data so no pre-created
 * Stripe products are needed.
 */
export async function createStripeCheckoutSession(input: {
  productName: string;
  description: string;
  amountCents: number;
  currency: string;
  orderId: number;
  successUrl: string;
  cancelUrl: string;
  /** "onetime" (default) or "subscription" with an interval. */
  mode?: "onetime" | "subscription";
  interval?: "month" | "year";
}): Promise<{ url: string; sessionId: string } | { error: string }> {
  const secret = process.env[STRIPE_SECRET_KEY_ENV]?.trim() ?? "";
  if (!secret) return { error: "Stripe is not configured (STRIPE_SECRET_KEY missing)" };

  const isSub = input.mode === "subscription";
  const priceFields: Record<string, string> = {
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": input.currency.toLowerCase(),
    "line_items[0][price_data][unit_amount]": String(input.amountCents),
    "line_items[0][price_data][product_data][name]": input.productName,
    "line_items[0][price_data][product_data][description]": input.description,
  };
  if (isSub) {
    priceFields["line_items[0][price_data][recurring][interval]"] = input.interval === "year" ? "year" : "month";
    priceFields["line_items[0][price_data][recurring][interval_count]"] = "1";
  }
  const body = stripeFormEncode({
    "mode": isSub ? "subscription" : "payment",
    "success_url": input.successUrl,
    "cancel_url": input.cancelUrl,
    "client_reference_id": String(input.orderId),
    "metadata[order_id]": String(input.orderId),
    ...priceFields,
  });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(`${STRIPE_API_BASE}/v1/checkout/sessions`, {
        method: "POST",
        headers: {
          "authorization": `Bearer ${secret}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body,
        signal: controller.signal,
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; id?: string; error?: { message?: string } };
      if (!res.ok || !data.url || !data.id) {
        return { error: data.error?.message || `Stripe returned HTTP ${res.status}` };
      }
      return { url: data.url, sessionId: data.id };
    } finally {
      clearTimeout(timeout);
    }
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : "Stripe request failed" };
  }
}


/**
 * Best-effort Stripe refund: resolve the session's payment_intent, refund
 * it in full. Returns the outcome for the admin UI; never throws.
 */
export async function refundStripeSession(sessionId: string): Promise<{ ok: boolean; detail: string }> {
  const secret = process.env[STRIPE_SECRET_KEY_ENV]?.trim() ?? "";
  if (!secret) return { ok: false, detail: "Stripe not configured — mark the refund manually with your PSP." };
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const sessionRes = await fetch(`${STRIPE_API_BASE}/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
        headers: { authorization: `Bearer ${secret}` },
        signal: controller.signal,
      });
      const session = (await sessionRes.json().catch(() => ({}))) as { payment_intent?: string };
      if (!sessionRes.ok || !session.payment_intent) {
        return { ok: false, detail: sessionRes.ok ? "No payment intent on that session (subscription? cancel it instead)." : `Stripe returned HTTP ${sessionRes.status}` };
      }
      const refundRes = await fetch(`${STRIPE_API_BASE}/v1/refunds`, {
        method: "POST",
        headers: { authorization: `Bearer ${secret}`, "content-type": "application/x-www-form-urlencoded" },
        body: stripeFormEncode({ payment_intent: session.payment_intent }),
        signal: controller.signal,
      });
      const refund = (await refundRes.json().catch(() => ({}))) as { status?: string; error?: { message?: string } };
      if (!refundRes.ok) return { ok: false, detail: refund.error?.message || `Stripe returned HTTP ${refundRes.status}` };
      return { ok: true, detail: `Refund ${refund.status ?? "submitted"} via Stripe.` };
    } finally {
      clearTimeout(timeout);
    }
  } catch (e: unknown) {
    return { ok: false, detail: e instanceof Error ? e.message : "Stripe refund request failed" };
  }
}
