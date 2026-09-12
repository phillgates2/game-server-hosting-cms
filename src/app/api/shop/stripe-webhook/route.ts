import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { shopOrders, shopProducts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureShopTables, fulfilOrder, renewSubscriptionByKey, cancelSubscriptionByKey, intervalToDays } from "@/lib/shop";
import { verifyStripeSignature, STRIPE_WEBHOOK_SECRET_ENV } from "@/lib/shop-stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/shop/stripe-webhook — Stripe pushes checkout.session.completed.
// Signature-verified (t + v1 HMAC, 5-minute replay window); unverified
// payloads get a flat 400 and nothing else.
export async function POST(req: NextRequest) {
  const secret = process.env[STRIPE_WEBHOOK_SECRET_ENV]?.trim() ?? "";
  const payload = await req.text();
  const header = req.headers.get("stripe-signature");

  if (!secret) {
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });
  }
  if (!verifyStripeSignature({ header, payload, secret, nowMs: Date.now() })) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let event: { type?: string; data?: { object?: Record<string, unknown> } };
  try {
    event = JSON.parse(payload) as typeof event;
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const obj = (event.data?.object ?? {}) as Record<string, unknown>;

  try {
    await ensureShopTables();

    // Renewal: any paid subscription invoice extends the key's expiry.
    if (event.type === "invoice.paid") {
      const sub = typeof obj.subscription === "string" ? obj.subscription : null;
      if (!sub) return NextResponse.json({ received: true, ignored: "invoice without subscription" });
      const [linked] = await db.select({ id: shopOrders.id, productId: shopOrders.productId }).from(shopOrders).where(eq(shopOrders.providerSub, sub)).limit(1);
      if (!linked) return NextResponse.json({ received: true, ignored: "unknown subscription" });
      const [prod] = await db.select({ billingInterval: shopProducts.billingInterval }).from(shopProducts).where(eq(shopProducts.id, linked.productId)).limit(1);
      const intervalMs = intervalToDays(prod?.billingInterval === "year" ? "year" : "month") * 86_400_000;
      const renewed = await renewSubscriptionByKey(sub, intervalMs);
      return NextResponse.json({ received: true, renewed: renewed.ok });
    }

    // Cancellation: the subscription ended — revoke the key.
    if (event.type === "customer.subscription.deleted") {
      const subId = typeof obj.id === "string" ? obj.id : null;
      if (!subId) return NextResponse.json({ received: true, ignored: "no subscription id" });
      const cancelled = await cancelSubscriptionByKey(subId);
      return NextResponse.json({ received: true, revoked: cancelled.ok });
    }

    if (event.type !== "checkout.session.completed") {
      return NextResponse.json({ received: true, ignored: event.type });
    }

    const session = obj;
    const orderId = Number(session.metadata && (session.metadata as Record<string, unknown>).order_id);
    if (!Number.isInteger(orderId) || orderId <= 0) {
      return NextResponse.json({ error: "Missing order_id metadata" }, { status: 400 });
    }

    const [order] = await db.select().from(shopOrders).where(eq(shopOrders.id, orderId)).limit(1);
    if (!order) return NextResponse.json({ error: "Unknown order" }, { status: 404 });
    if (order.status === "paid" || order.status === "fulfilled") {
      return NextResponse.json({ received: true, already: true });
    }

    const subIdFromSession = typeof session.subscription === "string" ? session.subscription : null;
    await db
      .update(shopOrders)
      .set({
        status: "paid",
        paidAt: new Date(),
        providerRef: typeof session.id === "string" ? session.id : order.providerRef,
        providerSub: subIdFromSession,
      })
      .where(eq(shopOrders.id, order.id));

    const result = await fulfilOrder(order.id);
    return NextResponse.json({ received: true, fulfilled: result.ok, orderId: order.id });
  } catch {
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
