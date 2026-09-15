import { NextResponse } from "next/server";
import { db } from "@/db";
import { shopProducts, shopCategories } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import { ensureShopTables, formatPrice } from "@/lib/shop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/shop/products — public storefront catalog (active only)
export async function GET() {
  try {
    await ensureShopTables();
    const [rows, cats] = await Promise.all([
      db
        .select()
        .from(shopProducts)
        .where(eq(shopProducts.active, true))
        .orderBy(asc(shopProducts.sortOrder), asc(shopProducts.id)),
      db.select().from(shopCategories).where(eq(shopCategories.active, true)).orderBy(asc(shopCategories.sortOrder)),
    ]);
    return NextResponse.json({
      stripeEnabled: (await import("@/lib/shop-stripe")).stripeEnabled(),
      categories: cats,
      products: rows.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        priceCents: p.priceCents,
        currency: p.currency,
        priceLabel: formatPrice(p.priceCents, p.currency),
        compareAtPriceCents: p.compareAtPriceCents ?? null,
        compareAtLabel: p.compareAtPriceCents ? formatPrice(p.compareAtPriceCents, p.currency) : null,
        maxActivations: p.maxActivations,
        durationDays: p.durationDays,
        imageUrl: p.imageUrl ?? null,
        category: p.category ?? "general",
        productType: p.productType ?? "license",
        stockQuantity: p.stockQuantity ?? null,
        featured: p.featured ?? false,
        sku: p.sku ?? null,
        badge: p.badge ?? null,
        allowQuantity: p.allowQuantity ?? true,
        kind: p.kind ?? "onetime",
        billingInterval: p.billingInterval ?? null,
        gameId: p.gameId ?? null,
      })),
    });
  } catch (e: unknown) {
    return apiError(e, "Could not load the shop", 500);
  }
}
