import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { shopOrders, licenseKeys, auditLog } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import { ensureShopTables, orderCanRefund, orderCanCancel, type ShopOrderStatus } from "@/lib/shop";
import { refundStripeSession } from "@/lib/shop-stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST — refund (paid/fulfilled → refunded + key revoked) or cancel (pending).
// { action?: "refund" | "cancel" } — auto-picks sensibly when omitted.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { authorizeMasterOrSession } = await import("@/lib/master-key");
  const { auth, res: gateRes } = await authorizeMasterOrSession(req, "shop.manage");
  if (!auth) return gateRes;

  let body: unknown = {};
  try { body = await req.json(); } catch { body = {}; }
  const requested = (body as Record<string, unknown>)?.action;

  try {
    const { id } = await params;
    await ensureShopTables();
    const [order] = await db.select().from(shopOrders).where(eq(shopOrders.id, Number(id))).limit(1);
    if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const status = order.status as ShopOrderStatus;
    const action = requested === "cancel" || requested === "refund"
      ? requested
      : status === "pending" ? "cancel" : "refund";

    if (action === "cancel") {
      if (!orderCanCancel(status)) {
        return NextResponse.json({ error: `Order is ${status} — only pending orders can be cancelled.` }, { status: 400 });
      }
      await db.update(shopOrders).set({ status: "cancelled" }).where(eq(shopOrders.id, order.id));
      await audit(auth.userId as number, order.id, order.email, "cancelled");
      return NextResponse.json({ ok: true, action: "cancelled" });
    }

    if (!orderCanRefund(status)) {
      return NextResponse.json({ error: `Order is ${status} — only paid/fulfilled orders can be refunded.` }, { status: 400 });
    }

    // 1) Revoke the key FIRST — the customer keeps nothing while money moves.
    if (order.licenseKeyId) {
      await db.update(licenseKeys).set({ revokedAt: new Date() }).where(eq(licenseKeys.id, order.licenseKeyId));
    }

    // 2) Money: Stripe refund when it was a Stripe payment (best-effort —
    //    manual PSPs get instructions back instead of a failure).
    let stripe: { ok: boolean; detail: string } | null = null;
    if (order.provider === "stripe" && order.providerRef) {
      stripe = await refundStripeSession(order.providerRef);
    }

    // 3) Mark the order refunded.
    await db.update(shopOrders).set({ status: "refunded" }).where(eq(shopOrders.id, order.id));
    await audit(auth.userId as number, order.id, order.email, "refunded");

    // 4) Tell the operator's channels.
    try {
      const { notifyLicenseEvent } = await import("@/lib/license-expiry");
      await notifyLicenseEvent("revoked", `order #${order.id}`, `Refund — ${order.email}`);
    } catch { /* notifications never break refunds */ }

    return NextResponse.json({ ok: true, action: "refunded", keyRevoked: order.licenseKeyId !== null, stripe });
  } catch (e: unknown) {
    return apiError(e, "Refund failed", 500);
  }
}

async function audit(userId: number, orderId: number, email: string, action: string): Promise<void> {
  try {
    const { db: db2 } = await import("@/db");
    await db2.insert(auditLog).values({
      userId: userId || null,
      action: `shop.order.${action}`,
      entityType: "shop-order",
      entityId: orderId,
      details: { email },
      ipAddress: null,
    });
  } catch { /* best-effort */ }
}
