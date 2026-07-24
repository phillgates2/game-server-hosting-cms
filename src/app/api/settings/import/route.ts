import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { settings, roles } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission, invalidateRoleCache } from "@/lib/permissions";
import { eq } from "drizzle-orm";

// POST /api/settings/import — Import panel config from JSON
export async function POST(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth || !(await hasPermission(auth.userId, "panel.settings"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { settings: importSettings, roles: importRoles } = body;
    let imported = 0;

    // Import settings
    if (importSettings && Array.isArray(importSettings)) {
      for (const s of importSettings) {
        if (!s.key) continue;
        const existing = await db.select().from(settings).where(eq(settings.key, s.key)).limit(1);
        if (existing.length > 0) {
          await db.update(settings).set({ value: s.value, updatedAt: new Date() }).where(eq(settings.key, s.key));
        } else {
          await db.insert(settings).values({ key: s.key, value: s.value });
        }
        imported++;
      }
    }

    // Import roles (merge — don't overwrite system roles)
    if (importRoles && Array.isArray(importRoles)) {
      for (const r of importRoles) {
        if (!r.name) continue;
        const existing = await db.select().from(roles).where(eq(roles.name, r.name)).limit(1);
        if (existing.length > 0) {
          if (!existing[0].isSystem) {
            await db.update(roles).set({
              displayName: r.displayName || r.display_name,
              color: r.color,
              icon: r.icon,
              permissions: r.permissions,
              priority: r.priority,
              updatedAt: new Date(),
            }).where(eq(roles.name, r.name));
            imported++;
          }
        } else {
          await db.insert(roles).values({
            name: r.name,
            displayName: r.displayName || r.display_name || r.name,
            color: r.color || "#3b82f6",
            icon: r.icon || "👤",
            isSystem: false,
            isDefault: false,
            priority: r.priority || 0,
            permissions: r.permissions || {},
          });
          imported++;
        }
      }
      invalidateRoleCache();
    }

    return NextResponse.json({ ok: true, imported, message: `Imported ${imported} items` });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Import failed" }, { status: 500 });
  }
}
