import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { shopOrders, auditLog } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import { ensureShopTables, fulfilOrder } from "@/lib/shop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST — manual-provider approval: mark paid + fulfil (issue & email the key)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "shop.manage"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const { id } = await params;
    await ensureShopTables();
    const [order] = await db.select().from(shopOrders).where(eq(shopOrders.id, Number(id))).limit(1);
    if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (order.status === "fulfilled") {
      return NextResponse.json({ ok: true, already: true });
    }
    if (order.status !== "pending") {
      return NextResponse.json({ error: `Order is ${order.status} — only pending orders can be approved.` }, { status: 400 });
    }

    await db.update(shopOrders).set({ status: "paid", paidAt: new Date() }).where(eq(shopOrders.id, order.id));
    const result = await fulfilOrder(order.id);
    if (!result.ok) {
      return NextResponse.json({ error: result.reason || "Fulfilment failed" }, { status: 500 });
    }

    try {
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
      await db.insert(auditLog).values({
        userId: auth.userId as number,
        action: "shop.order.approve",
        entityType: "shop-order",
        entityId: order.id,
        details: { email: order.email, amountCents: order.amountCents },
        ipAddress: ip.slice(0, 45),
      });
    } catch { /* best-effort */ }

    return NextResponse.json({ ok: true, orderId: order.id });
  } catch (e: unknown) {
    return apiError(e, "Approval failed", 500);
  }
}
