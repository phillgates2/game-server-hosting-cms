import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { shopProducts } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import { ensureShopTables, isValidProductPrice, SHOP_PRODUCT_NAME_MAX, PRODUCT_TYPES, SHOP_CATEGORIES } from "@/lib/shop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireShopAdmin(req: NextRequest) {
  const { authorizeMasterOrSession } = await import("@/lib/master-key");
  return authorizeMasterOrSession(req, "shop.manage");
}

// GET — all products (incl. inactive) for the admin list
export async function GET(req: NextRequest) {
  const { auth, res } = await requireShopAdmin(req);
  if (!auth) return res ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await ensureShopTables();
    const rows = await db.select().from(shopProducts).orderBy(asc(shopProducts.sortOrder), asc(shopProducts.id));
    return NextResponse.json({ products: rows });
  } catch (e: unknown) {
    return apiError(e, "Could not load products", 500);
  }
}

function parseOptionalInt(v: unknown, min: number, max: number): number | null | "invalid" {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) return "invalid";
  return n;
}

// POST — create a product
export async function POST(req: NextRequest) {
  const { auth, res } = await requireShopAdmin(req);
  if (!auth) return res ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const b = (body ?? {}) as Record<string, unknown>;

  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name || name.length > SHOP_PRODUCT_NAME_MAX) {
    return NextResponse.json({ error: `Product name required (max ${SHOP_PRODUCT_NAME_MAX} chars)` }, { status: 400 });
  }
  if (!isValidProductPrice(b.priceCents)) {
    return NextResponse.json({ error: "priceCents must be a whole number of cents (0–1,000,000.00)" }, { status: 400 });
  }
  const maxActivations = Number(b.maxActivations);
  if (!Number.isInteger(maxActivations) || maxActivations < 1 || maxActivations > 100) {
    return NextResponse.json({ error: "maxActivations must be 1–100" }, { status: 400 });
  }
  let durationDays: number | null = null;
  if (b.durationDays !== undefined && b.durationDays !== null && b.durationDays !== "") {
    const d = Number(b.durationDays);
    if (!Number.isInteger(d) || d < 1 || d > 3650) {
      return NextResponse.json({ error: "durationDays must be 1–3650 (or blank for no expiry)" }, { status: 400 });
    }
    durationDays = d;
  }
  const currency = typeof b.currency === "string" && /^[a-zA-Z]{3}$/.test(b.currency.trim()) ? b.currency.trim().toLowerCase() : "usd";
  const description = typeof b.description === "string" && b.description.trim() ? b.description.trim().slice(0, 2000) : null;
  const kind = b.kind === "subscription" ? "subscription" : "onetime";
  const billingInterval = kind === "subscription" ? (b.billingInterval === "year" ? "year" : "month") : null;

  // Extended fields
  const imageUrl = typeof b.imageUrl === "string" && b.imageUrl.trim() ? b.imageUrl.trim().slice(0, 500) : null;
  const categoryRaw = typeof b.category === "string" ? b.category.trim().toLowerCase() : "general";
  const category = (SHOP_CATEGORIES as readonly string[]).includes(categoryRaw) || /^[a-z0-9_-]{2,32}$/.test(categoryRaw) ? categoryRaw : "general";
  const productTypeRaw = typeof b.productType === "string" ? b.productType.trim().toLowerCase() : "license";
  const productType = (PRODUCT_TYPES as readonly string[]).includes(productTypeRaw) ? productTypeRaw : "license";
  const stockQuantity = parseOptionalInt(b.stockQuantity, 0, 1000000);
  if (stockQuantity === "invalid") return NextResponse.json({ error: "stockQuantity must be 0–1,000,000 or blank for unlimited" }, { status: 400 });
  const featured = typeof b.featured === "boolean" ? b.featured : false;
  const sku = typeof b.sku === "string" && b.sku.trim() ? b.sku.trim().slice(0, 64) : null;
  const badge = typeof b.badge === "string" && b.badge.trim() ? b.badge.trim().slice(0, 32) : null;
  let compareAtPriceCents: number | null = null;
  if (b.compareAtPriceCents !== undefined && b.compareAtPriceCents !== null && b.compareAtPriceCents !== "") {
    if (!isValidProductPrice(b.compareAtPriceCents)) return NextResponse.json({ error: "compareAtPriceCents invalid" }, { status: 400 });
    compareAtPriceCents = b.compareAtPriceCents as number;
  }
  const allowQuantity = typeof b.allowQuantity === "boolean" ? b.allowQuantity : true;
  const gameIdRaw = parseOptionalInt(b.gameId, 1, 1000000);
  if (gameIdRaw === "invalid") return NextResponse.json({ error: "gameId invalid" }, { status: 400 });
  const sortOrderRaw = parseOptionalInt(b.sortOrder, -1000, 1000);
  const sortOrder = sortOrderRaw === null || sortOrderRaw === "invalid" ? 0 : sortOrderRaw;

  try {
    await ensureShopTables();
    const [row] = await db
      .insert(shopProducts)
      .values({
        name,
        description,
        priceCents: b.priceCents as number,
        currency,
        maxActivations,
        durationDays,
        kind,
        billingInterval,
        imageUrl,
        category,
        productType,
        stockQuantity,
        featured,
        sku,
        badge,
        compareAtPriceCents,
        allowQuantity,
        gameId: gameIdRaw,
        sortOrder,
      })
      .returning({ id: shopProducts.id });
    return NextResponse.json({ ok: true, id: row.id });
  } catch (e: unknown) {
    return apiError(e, "Could not create the product", 500);
  }
}

// PATCH — { id, active?, name?, priceCents?, maxActivations?, durationDays?, description?, ...extended }
export async function PATCH(req: NextRequest) {
  const { auth, res } = await requireShopAdmin(req);
  if (!auth) return res ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const b = (body ?? {}) as Record<string, unknown>;
  const id = Number(b.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Product id required" }, { status: 400 });
  }

  try {
    await ensureShopTables();
    const updates: Record<string, unknown> = {};
    if (typeof b.active === "boolean") updates.active = b.active;
    if (typeof b.featured === "boolean") updates.featured = b.featured;
    if (typeof b.allowQuantity === "boolean") updates.allowQuantity = b.allowQuantity;
    if (typeof b.name === "string" && b.name.trim()) updates.name = b.name.trim().slice(0, SHOP_PRODUCT_NAME_MAX);
    if (b.priceCents !== undefined) {
      if (!isValidProductPrice(b.priceCents)) return NextResponse.json({ error: "Invalid priceCents" }, { status: 400 });
      updates.priceCents = b.priceCents;
    }
    if (b.compareAtPriceCents !== undefined) {
      if (b.compareAtPriceCents === null || b.compareAtPriceCents === "") updates.compareAtPriceCents = null;
      else {
        if (!isValidProductPrice(b.compareAtPriceCents)) return NextResponse.json({ error: "Invalid compareAtPriceCents" }, { status: 400 });
        updates.compareAtPriceCents = b.compareAtPriceCents;
      }
    }
    if (b.maxActivations !== undefined) {
      const n = Number(b.maxActivations);
      if (!Number.isInteger(n) || n < 1 || n > 100) return NextResponse.json({ error: "maxActivations must be 1–100" }, { status: 400 });
      updates.maxActivations = n;
    }
    if (b.description !== undefined) {
      updates.description = typeof b.description === "string" ? b.description.trim().slice(0, 2000) : null;
    }
    if (b.imageUrl !== undefined) {
      updates.imageUrl = typeof b.imageUrl === "string" && b.imageUrl.trim() ? b.imageUrl.trim().slice(0, 500) : null;
    }
    if (b.category !== undefined) {
      const c = typeof b.category === "string" ? b.category.trim().toLowerCase() : "general";
      updates.category = c.slice(0, 64);
    }
    if (b.productType !== undefined) {
      const pt = typeof b.productType === "string" ? b.productType.trim().toLowerCase() : "license";
      if ((PRODUCT_TYPES as readonly string[]).includes(pt)) updates.productType = pt;
    }
    if (b.stockQuantity !== undefined) {
      if (b.stockQuantity === null || b.stockQuantity === "") updates.stockQuantity = null;
      else {
        const n = Number(b.stockQuantity);
        if (!Number.isInteger(n) || n < 0 || n > 1000000) return NextResponse.json({ error: "stockQuantity must be 0–1,000,000 or blank" }, { status: 400 });
        updates.stockQuantity = n;
      }
    }
    if (b.sku !== undefined) {
      updates.sku = typeof b.sku === "string" && b.sku.trim() ? b.sku.trim().slice(0, 64) : null;
    }
    if (b.badge !== undefined) {
      updates.badge = typeof b.badge === "string" && b.badge.trim() ? b.badge.trim().slice(0, 32) : null;
    }
    if (b.sortOrder !== undefined) {
      const n = Number(b.sortOrder);
      if (Number.isInteger(n) && n >= -1000 && n <= 1000) updates.sortOrder = n;
    }
    if (b.kind !== undefined) {
      updates.kind = b.kind === "subscription" ? "subscription" : "onetime";
      if (updates.kind === "subscription") {
        updates.billingInterval = b.billingInterval === "year" ? "year" : "month";
      } else {
        updates.billingInterval = null;
      }
    }
    if (b.durationDays !== undefined) {
      if (b.durationDays === null || b.durationDays === "") updates.durationDays = null;
      else {
        const d = Number(b.durationDays);
        if (!Number.isInteger(d) || d < 1 || d > 3650) return NextResponse.json({ error: "durationDays must be 1–3650 or blank" }, { status: 400 });
        updates.durationDays = d;
      }
    }
    if (b.gameId !== undefined) {
      if (b.gameId === null || b.gameId === "") updates.gameId = null;
      else {
        const g = Number(b.gameId);
        if (!Number.isInteger(g) || g <= 0) return NextResponse.json({ error: "gameId invalid" }, { status: 400 });
        updates.gameId = g;
      }
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const [row] = await db.update(shopProducts).set(updates).where(eq(shopProducts.id, id)).returning({ id: shopProducts.id });
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return apiError(e, "Could not update the product", 500);
  }
}

// DELETE — ?id= — hard delete (only when no orders reference it, else soft-disable)
export async function DELETE(req: NextRequest) {
  const { auth, res } = await requireShopAdmin(req);
  if (!auth) return res ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const id = Number(url.searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Product id required" }, { status: 400 });
  try {
    await ensureShopTables();
    // Check if orders exist
    const { shopOrders } = await import("@/db/schema");
    const existing = await db.select({ id: shopOrders.id }).from(shopOrders).where(eq(shopOrders.productId, id)).limit(1);
    if (existing.length > 0) {
      // Soft disable instead
      await db.update(shopProducts).set({ active: false }).where(eq(shopProducts.id, id));
      return NextResponse.json({ ok: true, soft: true, message: "Product has orders — disabled instead of deleted" });
    }
    const [row] = await db.delete(shopProducts).where(eq(shopProducts.id, id)).returning({ id: shopProducts.id });
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return apiError(e, "Could not delete product", 500);
  }
}
