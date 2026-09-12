import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { shopResellers, shopOrders } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq, sql, desc } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import {
  ensureShopTables,
  generateResellerToken,
  hashResellerToken,
  commissionFor,
  COMMISSION_MAX_PCT,
} from "@/lib/shop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireShopAdmin(req: NextRequest) {
  // Session OR unified master key (X-Master-Key header).
  const { authorizeMasterOrSession } = await import("@/lib/master-key");
  return authorizeMasterOrSession(req, "shop.manage");
}

// GET — resellers with lifetime sales/commission totals
export async function GET(req: NextRequest) {
  const { auth, res } = await requireShopAdmin(req);
  if (!auth) return res;
  try {
    await ensureShopTables();
    const rows = await db
      .select({
        id: shopResellers.id,
        label: shopResellers.label,
        email: shopResellers.email,
        tokenPrefix: shopResellers.tokenPrefix,
        commissionPct: shopResellers.commissionPct,
        active: shopResellers.active,
        createdAt: shopResellers.createdAt,
        lastUsedAt: shopResellers.lastUsedAt,
        orderCount: sql<number>`count(${shopOrders.id})::int`,
        salesCents: sql<number>`COALESCE(sum(${shopOrders.amountCents}) FILTER (WHERE ${shopOrders.status} IN ('paid','fulfilled'), 0)::bigint, 0)::int`,
        commissionCents: sql<number>`COALESCE(sum(${shopOrders.commissionCents}) FILTER (WHERE ${shopOrders.status} IN ('paid','fulfilled'), 0)::bigint, 0)::int`,
      })
      .from(shopResellers)
      .leftJoin(shopOrders, eq(shopOrders.resellerId, shopResellers.id))
      .groupBy(shopResellers.id)
      .orderBy(desc(shopResellers.createdAt));
    return NextResponse.json({ resellers: rows });
  } catch (e: unknown) {
    return apiError(e, "Could not load resellers", 500);
  }
}

// POST — create { label, email?, commissionPct? } → plaintext token ONCE
export async function POST(req: NextRequest) {
  const { auth, res } = await requireShopAdmin(req);
  if (!auth) return res;

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const b = (body ?? {}) as Record<string, unknown>;

  const label = typeof b.label === "string" ? b.label.trim() : "";
  if (!label || label.length > 128) return NextResponse.json({ error: "Reseller label required (max 128 chars)." }, { status: 400 });
  const email = typeof b.email === "string" && b.email.trim() ? b.email.trim().slice(0, 254) : null;
  const pct = Number(b.commissionPct ?? 10);
  if (!Number.isInteger(pct) || pct < 0 || pct > COMMISSION_MAX_PCT) {
    return NextResponse.json({ error: `commissionPct must be 0–${COMMISSION_MAX_PCT}.` }, { status: 400 });
  }

  try {
    await ensureShopTables();
    const token = await generateResellerToken();
    const tokenHash = await hashResellerToken(token);
    const [row] = await db
      .insert(shopResellers)
      .values({ label, email, tokenHash, tokenPrefix: token.slice(0, 12), commissionPct: pct })
      .returning({ id: shopResellers.id });
    // The ONLY response that ever contains the plaintext token.
    return NextResponse.json({ ok: true, id: row.id, token, prefix: token.slice(0, 12) });
  } catch (e: unknown) {
    return apiError(e, "Could not create the reseller", 500);
  }
}

// PATCH — { id, active?, commissionPct? }
export async function PATCH(req: NextRequest) {
  const { auth, res } = await requireShopAdmin(req);
  if (!auth) return res;

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const b = (body ?? {}) as Record<string, unknown>;
  const id = Number(b.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Reseller id required" }, { status: 400 });

  const updates: Record<string, unknown> = {};
  if (typeof b.active === "boolean") updates.active = b.active;
  if (b.commissionPct !== undefined) {
    const pct = Number(b.commissionPct);
    if (!Number.isInteger(pct) || pct < 0 || pct > COMMISSION_MAX_PCT) {
      return NextResponse.json({ error: `commissionPct must be 0–${COMMISSION_MAX_PCT}.` }, { status: 400 });
    }
    updates.commissionPct = pct;
  }
  if (Object.keys(updates).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  try {
    await ensureShopTables();
    const [row] = await db.update(shopResellers).set(updates).where(eq(shopResellers.id, id)).returning({ id: shopResellers.id });
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return apiError(e, "Could not update the reseller", 500);
  }
}

void commissionFor;
