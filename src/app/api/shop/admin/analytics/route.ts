import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { shopOrders, shopProducts } from "@/db/schema";
import { eq, sql, desc } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import { ensureShopTables } from "@/lib/shop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireShopAdmin(req: NextRequest) {
  const { authorizeMasterOrSession } = await import("@/lib/master-key");
  return authorizeMasterOrSession(req, "shop.manage");
}

export async function GET(req: NextRequest) {
  const { auth, res } = await requireShopAdmin(req);
  if (!auth) return res ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await ensureShopTables();
    const [summaryRows, topProducts, recentOrders, statusCounts] = await Promise.all([
      db.select({
        totalOrders: sql<number>`count(*)::int`,
        totalRevenue: sql<number>`COALESCE(sum(case when status in ('paid','fulfilled') then amount_cents else 0 end),0)::int`,
        pendingOrders: sql<number>`count(*) filter (where status='pending')::int`,
        fulfilledOrders: sql<number>`count(*) filter (where status='fulfilled')::int`,
        refundedOrders: sql<number>`count(*) filter (where status='refunded')::int`,
      }).from(shopOrders),
      db.select({
        productId: shopOrders.productId,
        productName: shopProducts.name,
        orderCount: sql<number>`count(*)::int`,
        revenue: sql<number>`sum(case when ${shopOrders.status} in ('paid','fulfilled') then ${shopOrders.amountCents} else 0 end)::int`,
      }).from(shopOrders).leftJoin(shopProducts, eq(shopOrders.productId, shopProducts.id)).groupBy(shopOrders.productId, shopProducts.name).orderBy(desc(sql`count(*)`)).limit(10),
      db.select().from(shopOrders).orderBy(desc(shopOrders.createdAt)).limit(10),
      db.select({ status: shopOrders.status, count: sql<number>`count(*)::int` }).from(shopOrders).groupBy(shopOrders.status),
    ]);

    const summary = summaryRows[0] ?? { totalOrders: 0, totalRevenue: 0, pendingOrders: 0, fulfilledOrders: 0, refundedOrders: 0 };

    return NextResponse.json({
      summary,
      topProducts,
      recentOrders,
      statusCounts,
    });
  } catch (e: unknown) {
    return apiError(e, "Could not load analytics", 500);
  }
}
