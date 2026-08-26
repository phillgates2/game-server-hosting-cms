import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { settings, roles } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission, invalidateRoleCache } from "@/lib/permissions";
import { eq, sql } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
// The ladder parser is the panel's general bounded-integer validator.
import { parseLadderStat as parseBoundedInt } from "@/lib/ladder-stats";

/** A hand-imported role must not hand the panel malformed permissions JSON:
 *  anything that is not a plain object becomes an empty permission set. */
function asPermissionSet(raw: unknown): Record<string, boolean> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "boolean") out[k] = v;
  }
  return out;
}

// POST /api/settings/import — Import panel config from JSON
export async function POST(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  const allowed = auth && ((await hasPermission(auth.userId, "panel.settings.import")) || (await hasPermission(auth.userId, "panel.settings")) || (await hasPermission(auth.userId, "database.import")));
  if (!allowed) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { settings: importSettings, roles: importRoles } = body;
    let imported = 0;

    // One transaction: an import is all-or-nothing. Previously a bad entry
    // halfway through left half the settings applied, with no way to tell
    // which half, and roles cached during the window the cache was never
    // invalidated.
    await db.transaction(async (tx) => {
      // Import settings with a single upsert per batch rather than a
      // select-then-write round trip per key.
      const rows = Array.isArray(importSettings)
        ? importSettings.filter((s: unknown): s is { key: string; value: unknown } =>
            Boolean(s && typeof (s as { key?: unknown }).key === "string" && String((s as { key: string }).key).trim()))
        : [];
      if (rows.length > 0) {
        await tx.insert(settings)
          .values(rows.map((s) => ({ key: String(s.key).trim(), value: s.value == null ? null : String(s.value) })))
          .onConflictDoUpdate({
            target: settings.key,
            set: { value: sql`excluded.value`, updatedAt: new Date() },
          });
        imported += rows.length;
      }

      // Import roles (merge — never overwrite system roles)
      if (Array.isArray(importRoles)) {
        for (const r of importRoles) {
          if (!r || typeof r.name !== "string" || !r.name.trim()) continue;
          const existing = await tx.select().from(roles).where(eq(roles.name, r.name.trim())).limit(1);
          const permissions = asPermissionSet(r.permissions);
          const priority = parseBoundedInt(r.priority, 0, 1000) ?? 0;
          if (existing.length > 0) {
            if (!existing[0].isSystem) {
              await tx.update(roles).set({
                displayName: String(r.displayName || r.display_name || r.name),
                color: r.color ? String(r.color).slice(0, 7) : existing[0].color,
                icon: r.icon ? String(r.icon).slice(0, 8) : existing[0].icon,
                permissions,
                priority,
                updatedAt: new Date(),
              }).where(eq(roles.name, r.name.trim()));
              imported++;
            }
          } else {
            await tx.insert(roles).values({
              name: r.name.trim(),
              displayName: String(r.displayName || r.display_name || r.name).slice(0, 128),
              color: String(r.color || "#3b82f6").slice(0, 7),
              icon: String(r.icon || "👤").slice(0, 8),
              isSystem: false,
              isDefault: false,
              priority,
              permissions,
            });
            imported++;
          }
        }
      }
    });

    // Only after the commit: the permission cache must not hold pre-import
    // values while the new ones are already visible in queries.
    invalidateRoleCache();

    return NextResponse.json({ ok: true, imported, message: `Imported ${imported} items` });
  } catch (e: unknown) {
    return apiError(e, "Import failed", 500);
  }
}
