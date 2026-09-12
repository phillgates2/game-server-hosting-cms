import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { shopProducts, shopOrders, shopCoupons, shopResellers } from "@/db/schema";
import { eq } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import { ensureShopTables, isValidOrderEmail, normalizeCouponCode, couponUsable, applyCoupon, normalizeResellerToken, hashResellerToken, commissionFor, type ShopProvider, type CouponKind } from "@/lib/shop";
import { checkRateLimit, type RateLimitEntry } from "@/lib/licensing";
import { stripeEnabled, createStripeCheckoutSession } from "@/lib/shop-stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 10;
const hits = new Map<string, RateLimitEntry>();

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  ).slice(0, 45);
}

// POST /api/shop/orders — { productId, email, provider? } — start a purchase
export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  if (checkRateLimit(hits, ip, Date.now(), RATE_WINDOW_MS, RATE_MAX)) {
    return NextResponse.json({ error: "Too many orders — try again in a minute." }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const productId = Number(b.productId);
  const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
  const provider: ShopProvider = b.provider === "stripe" && stripeEnabled() ? "stripe" : "manual";

  if (!Number.isInteger(productId) || productId <= 0) {
    return NextResponse.json({ error: "Pick a product first." }, { status: 400 });
  }
  if (!isValidOrderEmail(email)) {
    return NextResponse.json({ error: "Enter a valid email — your key is delivered to it." }, { status: 400 });
  }

  try {
    await ensureShopTables();
    const [product] = await db
      .select()
      .from(shopProducts)
      .where(eq(shopProducts.id, productId))
      .limit(1);
    if (!product || !product.active) {
      return NextResponse.json({ error: "That product is not available." }, { status: 404 });
    }
    if (product.kind === "subscription" && provider !== "stripe") {
      return NextResponse.json(
        { error: "Subscriptions require card payments (Stripe) — the operator has not enabled it yet." },
        { status: 400 }
      );
    }

    // Coupon: validated + applied SERVER-SIDE against the product price.
    let couponId: number | null = null;
    let amountCents = product.priceCents;
    const rawCoupon = typeof b.couponCode === "string" ? b.couponCode.trim() : "";
    if (rawCoupon) {
      const code = normalizeCouponCode(rawCoupon);
      if (!code) {
        return NextResponse.json({ error: "That coupon code is not valid." }, { status: 400 });
      }
      const [coupon] = await db.select().from(shopCoupons).where(eq(shopCoupons.code, code)).limit(1);
      if (!coupon || !couponUsable({
        active: coupon.active,
        expiresAtMs: coupon.expiresAt ? new Date(coupon.expiresAt).getTime() : null,
        maxUses: coupon.maxUses,
        usedCount: coupon.usedCount,
      }, Date.now())) {
        return NextResponse.json({ error: "That coupon is not valid." }, { status: 402 });
      }
      if (coupon.productId !== null && coupon.productId !== product.id) {
        return NextResponse.json({ error: "That coupon does not apply to this product." }, { status: 402 });
      }
      amountCents = applyCoupon({ kind: coupon.kind as CouponKind, value: coupon.value }, product.priceCents);
      couponId = coupon.id;
      await db
        .update(shopCoupons)
        .set({ usedCount: coupon.usedCount + 1 })
        .where(eq(shopCoupons.id, coupon.id));
    }

    // Reseller attribution: an active reseller token in the header earns
    // its commission on this sale. Invalid tokens are simply ignored (the
    // customer's purchase must never fail because of a reseller typo).
    let resellerId: number | null = null;
    let commissionCents: number | null = null;
    const resellerToken = normalizeResellerToken(req.headers.get("x-reseller-token"));
    if (resellerToken) {
      const resellerHash = await hashResellerToken(resellerToken);
      const [reseller] = await db
        .select()
        .from(shopResellers)
        .where(eq(shopResellers.tokenHash, resellerHash))
        .limit(1);
      if (reseller && reseller.active) {
        resellerId = reseller.id;
        commissionCents = commissionFor(amountCents, reseller.commissionPct);
        await db.update(shopResellers).set({ lastUsedAt: new Date() }).where(eq(shopResellers.id, reseller.id));
      }
    }

    const [order] = await db
      .insert(shopOrders)
      .values({
        email,
        productId: product.id,
        provider,
        status: "pending",
        amountCents,
        currency: product.currency,
        couponId,
        resellerId,
        commissionCents,
      })
      .returning({ id: shopOrders.id });

    if (provider === "stripe") {
      const origin = req.headers.get("origin") || req.headers.get("referer")?.replace(/\/$/, "") || "";
      const result = await createStripeCheckoutSession({
        productName: couponId !== null ? `${product.name} (coupon applied)` : product.name,
        description: product.description || "GameServer Manager license key",
        amountCents,
        currency: product.currency,
        orderId: order.id,
        successUrl: `${origin}/shop/order/${order.id}?email=${encodeURIComponent(email)}&paid=1`,
        cancelUrl: `${origin}/shop?cancelled=1`,
        mode: product.kind === "subscription" ? "subscription" : "onetime",
        interval: product.billingInterval === "year" ? "year" : "month",
      });
      if ("error" in result) {
        await db.update(shopOrders).set({ status: "cancelled" }).where(eq(shopOrders.id, order.id));
        return NextResponse.json({ error: `Payment setup failed: ${result.error}` }, { status: 502 });
      }
      await db
        .update(shopOrders)
        .set({ providerRef: result.sessionId })
        .where(eq(shopOrders.id, order.id));
      return NextResponse.json({ ok: true, orderId: order.id, redirect: result.url });
    }

    return NextResponse.json({
      ok: true,
      orderId: order.id,
      provider: "manual",
      message:
        "Order placed. Complete payment with the provider the operator gave you — the key is issued automatically once the order is approved.",
    });
  } catch (e: unknown) {
    return apiError(e, "Could not place the order", 500);
  }
}
