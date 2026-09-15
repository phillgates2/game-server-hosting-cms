import { NextResponse } from "next/server";
import { db } from "@/db";
import { shopCategories } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import { ensureShopTables } from "@/lib/shop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureShopTables();
    const rows = await db.select().from(shopCategories).where(eq(shopCategories.active, true)).orderBy(asc(shopCategories.sortOrder), asc(shopCategories.id));
    return NextResponse.json({ categories: rows });
  } catch (e: unknown) {
    return apiError(e, "Could not load categories", 500);
  }
}
