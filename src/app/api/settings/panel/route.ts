import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { apiError } from "@/lib/api-error";
import {
  PANEL_SETTING_KEYS,
  parsePanelSettings,
  validatePanelSetting,
} from "@/lib/panel-settings";
import {
  METRICS_RETENTION_DAYS,
  AUDIT_RETENTION_DAYS,
  invalidateRetentionCache,
  retentionStats,
} from "@/lib/retention";

/**
 * Operational settings for the panel itself.
 *
 * Separate from /api/site-settings, whose GET is public: none of this should
 * be visible to an anonymous visitor.
 */
export async function GET(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "panel.settings"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const rows = await db
      .select({ key: settings.key, value: settings.value })
      .from(settings)
      .where(inArray(settings.key, PANEL_SETTING_KEYS as unknown as string[]));

    const parsed = parsePanelSettings(rows, {
      metricsRetentionDays: METRICS_RETENTION_DAYS,
      auditRetentionDays: AUDIT_RETENTION_DAYS,
    });

    // Row counts give the numbers context: "30 days" means more when you can
    // see it is currently holding 2.1 million rows.
    let stats: Awaited<ReturnType<typeof retentionStats>> | null = null;
    try {
      stats = await retentionStats();
    } catch {
      stats = null;
    }

    return NextResponse.json({ settings: parsed, stats });
  } catch (e: unknown) {
    return apiError(e, "Could not load settings", 500);
  }
}

export async function POST(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "panel.settings"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const incoming = body?.settings;
    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
      return NextResponse.json({ error: "Provide { settings: { ... } }" }, { status: 400 });
    }

    const allowed = new Set<string>(PANEL_SETTING_KEYS);
    const updates: Record<string, string> = {};

    for (const [key, raw] of Object.entries(incoming as Record<string, unknown>)) {
      if (raw === undefined) continue;
      if (!allowed.has(key)) {
        return NextResponse.json(
          { error: `Unknown setting: ${key}` },
          { status: 400 }
        );
      }
      const checked = validatePanelSetting(key, raw);
      if (checked.error !== null) {
        return NextResponse.json({ error: checked.error }, { status: 400 });
      }
      updates[key] = checked.value;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No settings provided" }, { status: 400 });
    }

    for (const [key, value] of Object.entries(updates)) {
      const existing = await db
        .select({ key: settings.key })
        .from(settings)
        .where(eq(settings.key, key))
        .limit(1);
      if (existing.length === 0) {
        await db.insert(settings).values({ key, value });
      } else {
        await db
          .update(settings)
          .set({ value, updatedAt: new Date() })
          .where(eq(settings.key, key));
      }
    }

    // Both caches are short-lived by design; drop them so a change here takes
    // effect on the next request rather than up to 30 seconds later.
    invalidateRetentionCache();
    const { invalidateAuthPolicy, getAuthPolicy } = await import("@/lib/auth-policy");
    invalidateAuthPolicy();
    // Re-read immediately so the throttle and session length inside auth.ts
    // are refreshed now, not on the next login.
    await getAuthPolicy();

    return NextResponse.json({ ok: true, saved: Object.keys(updates).length });
  } catch (e: unknown) {
    return apiError(e, "Could not save settings", 500);
  }
}
