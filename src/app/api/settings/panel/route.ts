import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { settings, auditLog } from "@/db/schema";
import { inArray, sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { apiError } from "@/lib/api-error";
import { clientIpForRecord } from "@/lib/ip-allowlist";
import {
  PANEL_SETTING_KEYS,
  normalisePanelSettingsInput,
  parsePanelSettings,
} from "@/lib/panel-settings";
import {
  METRICS_RETENTION_DAYS,
  AUDIT_RETENTION_DAYS,
  invalidateRetentionCache,
  retentionStats,
} from "@/lib/retention";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Operational settings for the panel itself.
 *
 * Separate from /api/site-settings, whose GET is public: none of this should
 * be visible to an anonymous visitor.
 */
export async function GET(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "panel.settings", auth.keyScope))) {
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

/**
 * POST /api/settings/panel
 *
 * Body: `{ settings: { session_days: 14, registration_enabled: false } }`.
 * Both the stored column names and the camelCase names used by GET are
 * accepted, because an integration written against the GET payload should not
 * have to translate before it can save.
 *
 * Every field is validated and every failure is returned at once, keyed by
 * column name, so the screen can mark each bad input instead of making the
 * operator resubmit until the messages stop. Only the values supplied are
 * touched — the whole object is not rewritten from a possibly stale copy.
 */
export async function POST(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "panel.settings", auth.keyScope))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        { error: "Provide { settings: { ... } }" },
        { status: 400 }
      );
    }

    // Accept the documented wrapper, and also a bare map of settings, which is
    // what a hand-written curl call usually sends.
    const envelope = body as Record<string, unknown>;
    const incoming =
      envelope.settings !== undefined &&
      envelope.settings !== null &&
      typeof envelope.settings === "object" &&
      !Array.isArray(envelope.settings)
        ? (envelope.settings as Record<string, unknown>)
        : envelope;

    const result = normalisePanelSettingsInput(incoming);

    if (result.unknown.length > 0) {
      return NextResponse.json(
        {
          error: `Unknown setting: ${result.unknown[0]}`,
          errors: Object.fromEntries(
            result.unknown.map((key) => [key, "Not a panel setting."])
          ),
          unknown: result.unknown,
        },
        { status: 400 }
      );
    }

    const errorKeys = Object.keys(result.errors);
    if (errorKeys.length > 0) {
      return NextResponse.json(
        {
          error: result.errors[errorKeys[0]],
          errors: result.errors,
        },
        { status: 400 }
      );
    }

    const keys = Object.keys(result.updates) as (keyof typeof result.updates)[];
    if (keys.length === 0) {
      return NextResponse.json({ error: "No settings provided" }, { status: 400 });
    }

    // One transaction: read the previous values for the audit trail, then
    // upsert all of them in a single statement. The old loop read each key and
    // then wrote it back, which could drop a simultaneous change from another
    // administrator and left a half-applied save behind on error.
    let changes: Array<{ key: string; from: string | null; to: string }> = [];
    await db.transaction(async (tx) => {
      const existing = await tx
        .select({ key: settings.key, value: settings.value })
        .from(settings)
        .where(inArray(settings.key, keys as string[]));
      const before = new Map(existing.map((row) => [row.key, row.value]));

      changes = keys
        .filter((key) => before.get(key) !== result.updates[key])
        .map((key) => ({
          key,
          from: before.get(key) ?? null,
          to: result.updates[key] as string,
        }));

      if (changes.length === 0) return;

      await tx
        .insert(settings)
        .values(keys.map((key) => ({ key, value: result.updates[key] as string })))
        .onConflictDoUpdate({
          target: settings.key,
          set: { value: sql`excluded.value`, updatedAt: new Date() },
        });
    });

    if (changes.length > 0) {
      // Both caches are short-lived by design; drop them so a change here takes
      // effect on the next request rather than up to 30 seconds later.
      invalidateRetentionCache();
      const { invalidateAuthPolicy, getAuthPolicy } = await import("@/lib/auth-policy");
      invalidateAuthPolicy();
      // Re-read immediately so the throttle and session length inside auth.ts
      // are refreshed now, not on the next login.
      await getAuthPolicy();

      // Best-effort: a failed audit write must not fail a save that already
      // committed, but a silent settings change is exactly what the trail is for.
      try {
        await db.insert(auditLog).values({
          userId: auth.userId || null,
          action: "panel.settings.update",
          entityType: "panel",
          entityId: null,
          details: { changed: changes },
          ipAddress: clientIpForRecord(req.headers),
        });
      } catch {
        /* best-effort */
      }
    }

    return NextResponse.json({
      ok: true,
      saved: changes.length,
      unchanged: keys.length - changes.length,
      changed: changes,
    });
  } catch (e: unknown) {
    return apiError(e, "Could not save settings", 500);
  }
}
