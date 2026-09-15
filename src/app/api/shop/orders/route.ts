import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { shopProducts, shopOrders, shopCoupons, shopResellers } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import { ensureShopTables, isValidOrderEmail, normalizeCouponCode, couponUsable, applyCoupon, normalizeResellerToken, hashResellerToken, commissionFor, type ShopProvider, type CouponKind } from "@/lib/shop";
import { checkRateLimit, type RateLimitEntry } from "@/lib/licensing";
import { stripeEnabled, createStripeCheckoutSession } from "@/lib/shop-stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 15;
const hits = new Map<string, RateLimitEntry>();

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  ).slice(0, 45);
}

type CartItemInput = { productId: number; quantity?: number };

async function resolveReseller(req: NextRequest, amountCents: number) {
  let resellerId: number | null = null;
  let commissionCents: number | null = null;
  // Support both header and body token
  const headerToken = normalizeResellerToken(req.headers.get("x-reseller-token"));
  // body token will be checked by caller via param
  if (headerToken) {
    const resellerHash = await hashResellerToken(headerToken);
    const [reseller] = await db.select().from(shopResellers).where(eq(shopResellers.tokenHash, resellerHash)).limit(1);
    if (reseller && reseller.active) {
      resellerId = reseller.id;
      commissionCents = commissionFor(amountCents, reseller.commissionPct);
      await db.update(shopResellers).set({ lastUsedAt: new Date() }).where(eq(shopResellers.id, reseller.id));
    }
  }
  return { resellerId, commissionCents };
}

// POST /api/shop/orders — { productId, email, quantity?, customerName?, provider?, couponCode?, items?: [{productId, quantity}] } — start a purchase
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
  const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
  const customerName = typeof b.customerName === "string" ? b.customerName.trim().slice(0, 128) : null;
  const provider: ShopProvider = b.provider === "stripe" && stripeEnabled() ? "stripe" : "manual";
  const quantityRaw = b.quantity !== undefined ? Number(b.quantity) : 1;
  const quantity = Number.isInteger(quantityRaw) && quantityRaw >= 1 && quantityRaw <= 100 ? quantityRaw : 1;

  // Support cart: items array or single productId
  let cartItems: CartItemInput[] = [];
  if (Array.isArray(b.items) && b.items.length > 0) {
    for (const it of b.items as unknown[]) {
      const obj = it as Record<string, unknown>;
      const pid = Number(obj.productId);
      const q = obj.quantity !== undefined ? Number(obj.quantity) : 1;
      if (!Number.isInteger(pid) || pid <= 0) continue;
      if (!Number.isInteger(q) || q < 1 || q > 100) continue;
      cartItems.push({ productId: pid, quantity: q });
    }
    if (cartItems.length === 0) {
      return NextResponse.json({ error: "Cart is empty or invalid." }, { status: 400 });
    }
  } else {
    const productId = Number(b.productId);
    if (!Number.isInteger(productId) || productId <= 0) {
      return NextResponse.json({ error: "Pick a product first." }, { status: 400 });
    }
    cartItems = [{ productId, quantity }];
  }

  if (!isValidOrderEmail(email)) {
    return NextResponse.json({ error: "Enter a valid email — your key is delivered to it." }, { status: 400 });
  }

  try {
    await ensureShopTables();

    // Fetch all products in cart
    const productIds = [...new Set(cartItems.map((i) => i.productId))];
    const products = await db.select().from(shopProducts).where(inArray(shopProducts.id, productIds));
    const productMap = new Map(products.map((p) => [p.id, p]));

    // Validate all
    for (const item of cartItems) {
      const p = productMap.get(item.productId);
      const qty = item.quantity ?? 1;
      if (!p || !p.active) {
        return NextResponse.json({ error: `Product #${item.productId} is not available.` }, { status: 404 });
      }
      if (p.stockQuantity !== null && p.stockQuantity !== undefined && p.stockQuantity < qty) {
        return NextResponse.json({ error: `${p.name} is out of stock (only ${p.stockQuantity} left).` }, { status: 400 });
      }
      if (p.kind === "subscription" && provider !== "stripe" && cartItems.length === 1) {
        return NextResponse.json(
          { error: "Subscriptions require card payments (Stripe) — the operator has not enabled it yet." },
          { status: 400 }
        );
      }
    }

    // Coupon: validated once, applies to whole cart if scoped to any product or all
    let couponId: number | null = null;
    let couponObj: { kind: CouponKind; value: number; productId: number | null } | null = null;
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
      // If coupon is scoped to a product, ensure that product is in cart
      if (coupon.productId !== null && !productIds.includes(coupon.productId)) {
        return NextResponse.json({ error: "That coupon does not apply to items in your cart." }, { status: 402 });
      }
      couponId = coupon.id;
      couponObj = { kind: coupon.kind as CouponKind, value: coupon.value, productId: coupon.productId };
      await db.update(shopCoupons).set({ usedCount: coupon.usedCount + 1 }).where(eq(shopCoupons.id, coupon.id));
    }

    // Reseller: try header first, then body token
    let resellerId: number | null = null;
    let commissionCentsTotal: number | null = null;
    const bodyResellerToken = typeof b.resellerToken === "string" ? normalizeResellerToken(b.resellerToken) : null;
    const effectiveToken = bodyResellerToken || normalizeResellerToken(req.headers.get("x-reseller-token"));
    if (effectiveToken) {
      const resellerHash = await hashResellerToken(effectiveToken);
      const [reseller] = await db.select().from(shopResellers).where(eq(shopResellers.tokenHash, resellerHash)).limit(1);
      if (reseller && reseller.active) {
        resellerId = reseller.id;
        await db.update(shopResellers).set({ lastUsedAt: new Date() }).where(eq(shopResellers.id, reseller.id));
      }
    }

    // Calculate totals and create orders
    const createdOrders: { id: number; productName: string; quantity: number; amountCents: number }[] = [];
    let grandTotal = 0;

    for (const item of cartItems) {
      const product = productMap.get(item.productId)!;
      const qty = item.quantity ?? 1;
      let amountCents = product.priceCents * qty;
      if (couponObj) {
        if (couponObj.productId === null || couponObj.productId === product.id) {
          const discountedUnit = applyCoupon({ kind: couponObj.kind, value: couponObj.value }, product.priceCents);
          amountCents = discountedUnit * qty;
        }
      }
      grandTotal += amountCents;

      let commissionCents: number | null = null;
      if (resellerId !== null) {
        const [reseller] = await db.select().from(shopResellers).where(eq(shopResellers.id, resellerId)).limit(1);
        if (reseller) {
          commissionCents = commissionFor(amountCents, reseller.commissionPct);
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
          quantity: qty,
          customerName,
        })
        .returning({ id: shopOrders.id });

      createdOrders.push({ id: order.id, productName: product.name, quantity: qty, amountCents });

      if (product.stockQuantity !== null && product.stockQuantity !== undefined) {
        await db.update(shopProducts).set({ stockQuantity: product.stockQuantity - qty }).where(eq(shopProducts.id, product.id));
      }
    }

    // If Stripe and single item, redirect to checkout. For multi-item, create combined session with total
    if (provider === "stripe") {
      if (createdOrders.length === 1) {
        const singleProduct = productMap.get(cartItems[0].productId)!;
        const origin = req.headers.get("origin") || req.headers.get("referer")?.replace(/\/$/, "") || "";
        const result = await createStripeCheckoutSession({
          productName: couponId !== null ? `${singleProduct.name} (coupon applied)` : singleProduct.name,
          description: singleProduct.description || `Order #${createdOrders[0].id}`,
          amountCents: grandTotal,
          currency: singleProduct.currency,
          orderId: createdOrders[0].id,
          successUrl: `${origin}/shop/order/${createdOrders[0].id}?email=${encodeURIComponent(email)}&paid=1`,
          cancelUrl: `${origin}/shop?cancelled=1`,
          mode: singleProduct.kind === "subscription" ? "subscription" : "onetime",
          interval: singleProduct.billingInterval === "year" ? "year" : "month",
        });
        if ("error" in result) {
          await db.update(shopOrders).set({ status: "cancelled" }).where(eq(shopOrders.id, createdOrders[0].id));
          return NextResponse.json({ error: `Payment setup failed: ${result.error}` }, { status: 502 });
        }
        await db.update(shopOrders).set({ providerRef: result.sessionId }).where(eq(shopOrders.id, createdOrders[0].id));
        return NextResponse.json({ ok: true, orderId: createdOrders[0].id, orderIds: createdOrders.map((o) => o.id), redirect: result.url, totalCents: grandTotal });
      } else {
        // Multi-item: use first order as primary for Stripe, but note total
        const origin = req.headers.get("origin") || req.headers.get("referer")?.replace(/\/$/, "") || "";
        const first = createdOrders[0];
        const result = await createStripeCheckoutSession({
          productName: `Cart (${createdOrders.length} items)`,
          description: createdOrders.map((o) => `${o.productName} x${o.quantity}`).join(", ").slice(0, 400),
          amountCents: grandTotal,
          currency: productMap.get(cartItems[0].productId)!.currency,
          orderId: first.id,
          successUrl: `${origin}/shop/order/${first.id}?email=${encodeURIComponent(email)}&paid=1&cart=${encodeURIComponent(createdOrders.map((o) => o.id).join(","))}`,
          cancelUrl: `${origin}/shop?cancelled=1`,
          mode: "onetime",
          interval: "month",
        });
        if ("error" in result) {
          // Cancel all
          for (const o of createdOrders) {
            await db.update(shopOrders).set({ status: "cancelled" }).where(eq(shopOrders.id, o.id));
          }
          return NextResponse.json({ error: `Payment setup failed: ${result.error}` }, { status: 502 });
        }
        // Attach same session to all orders for tracking
        for (const o of createdOrders) {
          await db.update(shopOrders).set({ providerRef: result.sessionId }).where(eq(shopOrders.id, o.id));
        }
        return NextResponse.json({ ok: true, orderId: first.id, orderIds: createdOrders.map((o) => o.id), redirect: result.url, totalCents: grandTotal });
      }
    }

    return NextResponse.json({
      ok: true,
      orderId: createdOrders[0].id,
      orderIds: createdOrders.map((o) => o.id),
      provider: "manual",
      totalCents: grandTotal,
      message:
        createdOrders.length === 1
          ? "Order placed. Complete payment with the provider the operator gave you — the key is issued automatically once the order is approved."
          : `${createdOrders.length} orders placed. Complete payment — items are issued once approved.`,
    });
  } catch (e: unknown) {
    return apiError(e, "Could not place the order", 500);
  }
}
