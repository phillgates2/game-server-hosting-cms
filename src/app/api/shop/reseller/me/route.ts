import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { shopResellers, shopOrders } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import { ensureShopTables, normalizeResellerToken, hashResellerToken, totalCommission } from "@/lib/shop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/shop/reseller/me — reseller self-service via X-Reseller-Token
export async function GET(req: NextRequest) {
  const token = normalizeResellerToken(req.headers.get("x-reseller-token"));
  if (!token) {
    return NextResponse.json({ error: "Provide your reseller token in the X-Reseller-Token header." }, { status: 401 });
  }

  try {
    await ensureShopTables();
    const tokenHash = await hashResellerToken(token);
    const [reseller] = await db.select().from(shopResellers).where(eq(shopResellers.tokenHash, tokenHash)).limit(1);
    if (!reseller || !reseller.active) {
      // Same answer for unknown and disabled — no existence oracle.
      return NextResponse.json({ error: "That reseller token is not valid." }, { status: 401 });
    }

    await db.update(shopResellers).set({ lastUsedAt: new Date() }).where(eq(shopResellers.id, reseller.id));

    const orders = await db
      .select({
        id: shopOrders.id,
        status: shopOrders.status,
        amountCents: shopOrders.amountCents,
        commissionCents: shopOrders.commissionCents,
        createdAt: shopOrders.createdAt,
      })
      .from(shopOrders)
      .where(eq(shopOrders.resellerId, reseller.id))
      .orderBy(desc(shopOrders.createdAt))
      .limit(200);

    const settled = orders.filter((o) => o.status === "paid" || o.status === "fulfilled");
    return NextResponse.json({
      reseller: { label: reseller.label, commissionPct: reseller.commissionPct },
      totals: {
        orders: orders.length,
        settledOrders: settled.length,
        salesCents: settled.reduce((s, o) => s + o.amountCents, 0),
        commissionCents: totalCommission(settled),
      },
      orders,
    });
  } catch (e: unknown) {
    return apiError(e, "Reseller lookup failed", 500);
  }
}
