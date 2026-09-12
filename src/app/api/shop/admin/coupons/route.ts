import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { shopCoupons, shopProducts } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq, asc } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import { ensureShopTables, normalizeCouponCode } from "@/lib/shop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireShopAdmin(req: NextRequest) {
  // Session OR unified master key (X-Master-Key header).
  const { authorizeMasterOrSession } = await import("@/lib/master-key");
  return authorizeMasterOrSession(req, "shop.manage");
}

// GET — all coupons
export async function GET(req: NextRequest) {
  const { auth, res } = await requireShopAdmin(req);
  if (!auth) return res ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await ensureShopTables();
    const rows = await db
      .select({
        id: shopCoupons.id,
        code: shopCoupons.code,
        kind: shopCoupons.kind,
        value: shopCoupons.value,
        maxUses: shopCoupons.maxUses,
        usedCount: shopCoupons.usedCount,
        expiresAt: shopCoupons.expiresAt,
        active: shopCoupons.active,
        productId: shopCoupons.productId,
        productName: shopProducts.name,
      })
      .from(shopCoupons)
      .leftJoin(shopProducts, eq(shopCoupons.productId, shopProducts.id))
      .orderBy(asc(shopCoupons.id));
    return NextResponse.json({ coupons: rows });
  } catch (e: unknown) {
    return apiError(e, "Could not load coupons", 500);
  }
}

// POST — create { code, kind, value, maxUses?, expiresAt?, productId? }
export async function POST(req: NextRequest) {
  const { auth, res } = await requireShopAdmin(req);
  if (!auth) return res ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const b = (body ?? {}) as Record<string, unknown>;

  const code = normalizeCouponCode(b.code);
  if (!code) return NextResponse.json({ error: "Coupon code must be 3–64 chars: letters, digits, - and _." }, { status: 400 });
  const kind = b.kind === "fixed" ? "fixed" : "percent";
  const value = Number(b.value);
  if (kind === "percent" && (!Number.isInteger(value) || value < 1 || value > 100)) {
    return NextResponse.json({ error: "Percent coupons need a whole number 1–100." }, { status: 400 });
  }
  if (kind === "fixed" && (!Number.isInteger(value) || value < 1)) {
    return NextResponse.json({ error: "Fixed coupons need a positive whole number of cents." }, { status: 400 });
  }
  let maxUses: number | null = null;
  if (b.maxUses !== undefined && b.maxUses !== null && b.maxUses !== "") {
    const m = Number(b.maxUses);
    if (!Number.isInteger(m) || m < 1 || m > 100000) return NextResponse.json({ error: "maxUses must be 1–100000 (or blank)." }, { status: 400 });
    maxUses = m;
  }
  let expiresAt: Date | null = null;
  if (b.expiresAt !== undefined && b.expiresAt !== null && b.expiresAt !== "") {
    const d = new Date(String(b.expiresAt));
    if (!Number.isFinite(d.getTime()) || d.getTime() <= Date.now()) {
      return NextResponse.json({ error: "expiresAt must be in the future." }, { status: 400 });
    }
    expiresAt = d;
  }
  let productId: number | null = null;
  if (b.productId !== undefined && b.productId !== null && b.productId !== "") {
    const p = Number(b.productId);
    if (!Number.isInteger(p) || p <= 0) return NextResponse.json({ error: "Invalid productId." }, { status: 400 });
    productId = p;
  }

  try {
    await ensureShopTables();
    const [dup] = await db.select({ id: shopCoupons.id }).from(shopCoupons).where(eq(shopCoupons.code, code)).limit(1);
    if (dup) return NextResponse.json({ error: "That code already exists." }, { status: 409 });
    const [row] = await db
      .insert(shopCoupons)
      .values({ code, kind, value, maxUses, expiresAt, productId })
      .returning({ id: shopCoupons.id });
    return NextResponse.json({ ok: true, id: row.id });
  } catch (e: unknown) {
    return apiError(e, "Could not create the coupon", 500);
  }
}

// PATCH — { id, active? } toggle (and nothing else: coupons are immutable otherwise)
export async function PATCH(req: NextRequest) {
  const { auth, res } = await requireShopAdmin(req);
  if (!auth) return res ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const b = (body ?? {}) as Record<string, unknown>;
  const id = Number(b.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Coupon id required" }, { status: 400 });
  if (typeof b.active !== "boolean") return NextResponse.json({ error: "Only {id, active} may change" }, { status: 400 });

  try {
    await ensureShopTables();
    const [row] = await db.update(shopCoupons).set({ active: b.active }).where(eq(shopCoupons.id, id)).returning({ id: shopCoupons.id });
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return apiError(e, "Could not update the coupon", 500);
  }
}
