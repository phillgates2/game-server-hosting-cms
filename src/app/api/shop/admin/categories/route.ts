import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { shopCategories } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
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
    const rows = await db.select().from(shopCategories).orderBy(asc(shopCategories.sortOrder));
    return NextResponse.json({ categories: rows });
  } catch (e: unknown) {
    return apiError(e, "Could not load categories", 500);
  }
}

export async function POST(req: NextRequest) {
  const { auth, res } = await requireShopAdmin(req);
  if (!auth) return res ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const b = (body ?? {}) as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  const slug = typeof b.slug === "string" ? b.slug.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 64) : "";
  if (!name || name.length > 64) return NextResponse.json({ error: "Name required (max 64)" }, { status: 400 });
  if (!slug || slug.length < 2) return NextResponse.json({ error: "Slug required (min 2)" }, { status: 400 });
  const description = typeof b.description === "string" ? b.description.trim().slice(0, 500) : null;
  const icon = typeof b.icon === "string" ? b.icon.trim().slice(0, 8) : "🛒";
  try {
    await ensureShopTables();
    const [row] = await db.insert(shopCategories).values({ name, slug, description, icon }).returning({ id: shopCategories.id });
    return NextResponse.json({ ok: true, id: row.id });
  } catch (e: unknown) {
    return apiError(e, "Could not create category", 500);
  }
}

export async function PATCH(req: NextRequest) {
  const { auth, res } = await requireShopAdmin(req);
  if (!auth) return res ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const b = (body ?? {}) as Record<string, unknown>;
  const id = Number(b.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "id required" }, { status: 400 });
  const updates: Record<string, unknown> = {};
  if (typeof b.name === "string" && b.name.trim()) updates.name = b.name.trim().slice(0, 64);
  if (typeof b.active === "boolean") updates.active = b.active;
  if (typeof b.icon === "string") updates.icon = b.icon.trim().slice(0, 8);
  if (typeof b.description === "string") updates.description = b.description.trim().slice(0, 500) || null;
  if (typeof b.sortOrder === "number" && Number.isInteger(b.sortOrder)) updates.sortOrder = b.sortOrder;
  if (Object.keys(updates).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  try {
    await ensureShopTables();
    const [row] = await db.update(shopCategories).set(updates).where(eq(shopCategories.id, id)).returning({ id: shopCategories.id });
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return apiError(e, "Could not update category", 500);
  }
}
