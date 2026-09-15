import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { settings as settingsTable } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { apiError } from "@/lib/api-error";
import {
  TRANSFER_SETTING_KEYS,
  loadTransferSettings,
  transferSettingsFromEnvOnly,
  transferSettingsSummary,
  validateTransferSetting,
} from "@/lib/file-transfer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Operator settings for the built-in FTP/FTPS server.
 *
 * Kept out of `/api/settings/panel` on purpose: that route validates numbers
 * with a shared bounds table and has no place for paths and hostnames, and the
 * transfer server is a service that has to be told when its configuration
 * changes. Saving here restarts the listener immediately.
 *
 * Gated on `transfer.settings` rather than `panel.settings`: running the FTP
 * listener is its own job, so it can be delegated to whoever runs the file
 * service without handing them the rest of the panel's settings.
 */
async function requireOperator(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) {
    return { auth: null, res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as NextResponse };
  }
  if (!(await hasPermission(auth.userId, "transfer.settings", auth.keyScope))) {
    return { auth: null, res: NextResponse.json({ error: "Permission denied" }, { status: 403 }) as NextResponse };
  }
  return { auth, res: null };
}

export async function GET(req: NextRequest) {
  const { auth, res } = await requireOperator(req);
  if (!auth) return res ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { fileTransferStats, fileTransferRuntimeError } = await import("@/lib/file-transfer-service");
    const effective = await loadTransferSettings();
    const envDefaults = transferSettingsFromEnvOnly();
    const stats = fileTransferStats();
    const runtime = fileTransferRuntimeError();

    return NextResponse.json({
      settings: transferSettingsSummary(effective),
      /** What `.env` alone would give — the UI marks fields as overridden. */
      envDefaults: transferSettingsSummary(envDefaults),
      keys: TRANSFER_SETTING_KEYS,
      running: Boolean(stats?.listening),
      error: runtime.error,
      tlsError: runtime.tlsError,
      stats,
    });
  } catch (e: unknown) {
    return apiError(e, "Could not load file transfer settings", 500);
  }
}

export async function POST(req: NextRequest) {
  const { auth, res } = await requireOperator(req);
  if (!auth) return res ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Firewall actions are one-shot commands, not settings: nothing to store,
  // just a UFW rule (or its removal) for the control port + passive range.
  if (body.firewall === "open" || body.firewall === "close") {
    try {
      const { allowTransferPorts, denyTransferPorts } = await import("@/lib/firewall");
      const effective = await loadTransferSettings();
      if (body.firewall === "open") {
        const result = await allowTransferPorts(effective.port, effective.passiveMin, effective.passiveMax);
        if (!result.ok) {
          return NextResponse.json(
            { error: "ufw refused the rules — is it installed and is the panel running as root?" },
            { status: 502 }
          );
        }
        return NextResponse.json({ ok: true, rules: result.rules });
      }
      await denyTransferPorts(effective.port, effective.passiveMin, effective.passiveMax);
      return NextResponse.json({ ok: true, rules: [] });
    } catch (e: unknown) {
      return apiError(e, "Could not update the firewall", 500);
    }
  }

  const incoming = body.settings;
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
    return NextResponse.json({ error: "Provide { settings: { ... } }" }, { status: 400 });
  }

  const allowed = new Set<string>(TRANSFER_SETTING_KEYS);
  const updates: Record<string, string> = {};
  for (const [key, raw] of Object.entries(incoming as Record<string, unknown>)) {
    if (raw === undefined) continue;
    if (!allowed.has(key)) return NextResponse.json({ error: `Unknown setting: ${key}` }, { status: 400 });
    const checked = validateTransferSetting(key, raw);
    if (checked.error !== null) return NextResponse.json({ error: checked.error }, { status: 400 });
    updates[key] = checked.value;
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No settings provided" }, { status: 400 });
  }

  // The passive range is two independent fields that are only meaningful
  // together; catch a reversed pair here rather than letting every PASV fail.
  const effective = await loadTransferSettings();
  const nextMin = updates.ftp_passive_min ? Number(updates.ftp_passive_min) : effective.passiveMin;
  const nextMax = updates.ftp_passive_max ? Number(updates.ftp_passive_max) : effective.passiveMax;
  if (nextMin > nextMax) {
    return NextResponse.json(
      { error: "The passive range start must not be above its end" },
      { status: 400 }
    );
  }

  try {
    for (const [key, value] of Object.entries(updates)) {
      const existing = await db
        .select({ key: settingsTable.key })
        .from(settingsTable)
        .where(eq(settingsTable.key, key))
        .limit(1);
      if (existing.length === 0) {
        await db.insert(settingsTable).values({ key, value });
      } else {
        await db
          .update(settingsTable)
          .set({ value, updatedAt: new Date() })
          .where(eq(settingsTable.key, key));
      }
    }

    // Apply immediately: port, range, TLS and advertised address only take
    // effect on a fresh listener, and "save then wonder why nothing changed"
    // is the failure mode worth engineering away.
    const { restartFileTransferService, fileTransferRuntimeError } = await import("@/lib/file-transfer-service");
    const stats = await restartFileTransferService("settings saved");
    const runtime = fileTransferRuntimeError();
    const saved = await loadTransferSettings();

    return NextResponse.json({
      ok: true,
      saved: Object.keys(updates).length,
      running: Boolean(stats?.listening),
      error: runtime.error,
      tlsError: runtime.tlsError,
      settings: transferSettingsSummary(saved),
    });
  } catch (e: unknown) {
    return apiError(e, "Could not save file transfer settings", 500);
  }
}
