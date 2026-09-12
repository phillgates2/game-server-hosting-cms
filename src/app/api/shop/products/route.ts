import { NextResponse } from "next/server";
import { db } from "@/db";
import { shopProducts } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import { ensureShopTables, formatPrice } from "@/lib/shop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/shop/products — public storefront catalog (active only)
export async function GET() {
  try {
    await ensureShopTables();
    const rows = await db
      .select()
      .from(shopProducts)
      .where(eq(shopProducts.active, true))
      .orderBy(asc(shopProducts.sortOrder), asc(shopProducts.id));
    return NextResponse.json({
      stripeEnabled: (await import("@/lib/shop-stripe")).stripeEnabled(),
      products: rows.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        priceCents: p.priceCents,
        currency: p.currency,
        priceLabel: formatPrice(p.priceCents, p.currency),
        maxActivations: p.maxActivations,
        durationDays: p.durationDays,
      })),
    });
  } catch (e: unknown) {
    return apiError(e, "Could not load the shop", 500);
  }
}
