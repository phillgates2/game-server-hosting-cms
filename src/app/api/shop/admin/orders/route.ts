import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { shopOrders, shopProducts } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq, desc } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import { ensureShopTables, formatPrice } from "@/lib/shop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET — order book for the admin panel (newest first, capped)
export async function GET(req: NextRequest) {
  const { authorizeMasterOrSession } = await import("@/lib/master-key");
  const { auth, res: gateRes } = await authorizeMasterOrSession(req, "shop.view");
  if (!auth) return gateRes;

  try {
    await ensureShopTables();
    const rows = await db
      .select({
        id: shopOrders.id,
        email: shopOrders.email,
        productId: shopOrders.productId,
        provider: shopOrders.provider,
        status: shopOrders.status,
        amountCents: shopOrders.amountCents,
        currency: shopOrders.currency,
        licenseKeyId: shopOrders.licenseKeyId,
        createdAt: shopOrders.createdAt,
        fulfilledAt: shopOrders.fulfilledAt,
        productName: shopProducts.name,
      })
      .from(shopOrders)
      .leftJoin(shopProducts, eq(shopOrders.productId, shopProducts.id))
      .orderBy(desc(shopOrders.createdAt))
      .limit(200);

    return NextResponse.json({
      orders: rows.map((r) => ({
        ...r,
        amountLabel: formatPrice(r.amountCents, r.currency),
      })),
    });
  } catch (e: unknown) {
    return apiError(e, "Could not load orders", 500);
  }
}
