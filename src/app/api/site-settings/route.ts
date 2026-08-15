import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq } from "drizzle-orm";

// Public settings keys that are safe to expose without auth
const PUBLIC_KEYS = [
  "panel_name",
  "hero_title",
  "hero_subtitle",
  "hero_cta_text",
  "hero_cta_link",
  "features_json",
  "footer_text",
  "announcement",
  "announcement_type",
  "custom_css",
  "nav_links_json",
];

/**
 * GET /api/site-settings — Read public site settings (no auth required)
 */
export async function GET() {
  try {
    const rows = await db.select().from(settings);
    const result: Record<string, string> = {};
    for (const row of rows) {
      if (PUBLIC_KEYS.includes(row.key) && row.value !== null) {
        result[row.key] = row.value;
      }
    }
    return NextResponse.json({ settings: result });
  } catch {
    return NextResponse.json({ settings: {} });
  }
}

/**
 * POST /api/site-settings — Update site settings (admin only)
 * Body: { key: string, value: string } or { settings: Record<string, string> }
 */
export async function POST(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "panel.settings"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const body = await req.json();

    // Support both single key-value and bulk update
    const updates: Record<string, string> = {};
    if (body.key && body.value !== undefined) {
      updates[body.key] = String(body.value);
    } else if (body.settings && typeof body.settings === "object") {
      for (const [k, v] of Object.entries(body.settings)) {
        updates[k] = String(v);
      }
    } else {
      return NextResponse.json({ error: "Provide { key, value } or { settings: { ... } }" }, { status: 400 });
    }

    for (const [key, value] of Object.entries(updates)) {
      const existing = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
      if (existing.length === 0) {
        await db.insert(settings).values({ key, value });
      } else {
        await db.update(settings).set({ value, updatedAt: new Date() }).where(eq(settings.key, key));
      }
    }

    return NextResponse.json({ ok: true, updated: Object.keys(updates) });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
