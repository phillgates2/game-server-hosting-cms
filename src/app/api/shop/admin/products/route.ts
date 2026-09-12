import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { shopProducts } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq, asc } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import { ensureShopTables, isValidProductPrice, SHOP_PRODUCT_NAME_MAX } from "@/lib/shop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireShopAdmin(req: NextRequest) {
  // Session OR unified master key (X-Master-Key header).
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
  const description = typeof b.description === "string" && b.description.trim() ? b.description.trim().slice(0, 500) : null;
  const kind = b.kind === "subscription" ? "subscription" : "onetime";
  const billingInterval = kind === "subscription" ? (b.billingInterval === "year" ? "year" : "month") : null;

  try {
    await ensureShopTables();
    const [row] = await db
      .insert(shopProducts)
      .values({ name, description, priceCents: b.priceCents as number, currency, maxActivations, durationDays, kind, billingInterval })
      .returning({ id: shopProducts.id });
    return NextResponse.json({ ok: true, id: row.id });
  } catch (e: unknown) {
    return apiError(e, "Could not create the product", 500);
  }
}

// PATCH — { id, active?, name?, priceCents?, maxActivations?, durationDays?, description? }
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
    if (typeof b.name === "string" && b.name.trim()) updates.name = b.name.trim().slice(0, SHOP_PRODUCT_NAME_MAX);
    if (b.priceCents !== undefined) {
      if (!isValidProductPrice(b.priceCents)) return NextResponse.json({ error: "Invalid priceCents" }, { status: 400 });
      updates.priceCents = b.priceCents;
    }
    if (b.maxActivations !== undefined) {
      const n = Number(b.maxActivations);
      if (!Number.isInteger(n) || n < 1 || n > 100) return NextResponse.json({ error: "maxActivations must be 1–100" }, { status: 400 });
      updates.maxActivations = n;
    }
    if (b.description !== undefined) {
      updates.description = typeof b.description === "string" ? b.description.trim().slice(0, 500) : null;
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
