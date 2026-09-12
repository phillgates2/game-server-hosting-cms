import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { shopCoupons } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureShopTables, normalizeCouponCode, couponUsable, applyCoupon, type CouponKind } from "@/lib/shop";
import { checkRateLimit, type RateLimitEntry } from "@/lib/licensing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const hits = new Map<string, RateLimitEntry>();

// GET /api/shop/coupons/check?code=X&priceCents=N — live discount preview
export async function GET(req: NextRequest) {
  const ip = (req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown").slice(0, 45);
  if (checkRateLimit(hits, ip, Date.now(), 60_000, 20)) {
    return NextResponse.json({ ok: false, error: "Too many checks — slow down." }, { status: 429 });
  }

  const url = new URL(req.url);
  const code = normalizeCouponCode(url.searchParams.get("code"));
  const priceCents = Number(url.searchParams.get("priceCents"));
  if (!code) return NextResponse.json({ ok: false, error: "Enter a coupon code." }, { status: 400 });
  if (!Number.isInteger(priceCents) || priceCents < 0) return NextResponse.json({ ok: false, error: "Missing price." }, { status: 400 });

  try {
    await ensureShopTables();
    const [row] = await db.select().from(shopCoupons).where(eq(shopCoupons.code, code)).limit(1);
    // Same answer for every failure class — no coupon-existence oracle.
    if (!row || !couponUsable({
      active: row.active,
      expiresAtMs: row.expiresAt ? new Date(row.expiresAt).getTime() : null,
      maxUses: row.maxUses,
      usedCount: row.usedCount,
    }, Date.now())) {
      return NextResponse.json({ ok: false, error: "That coupon is not valid." }, { status: 402 });
    }
    const discounted = applyCoupon({ kind: row.kind as CouponKind, value: row.value }, priceCents);
    return NextResponse.json({
      ok: true,
      code: row.code,
      kind: row.kind,
      value: row.value,
      scopedToProduct: row.productId,
      priceCents,
      discountedCents: discounted,
      savingsCents: priceCents - discounted,
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Coupon check failed." }, { status: 500 });
  }
}
