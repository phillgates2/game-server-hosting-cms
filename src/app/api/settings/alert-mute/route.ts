import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { apiError } from "@/lib/api-error";
import { upsertSetting } from "@/lib/webhook-dispatch";
import {
  ALERT_MUTE_SETTING_KEY,
  clampMuteHours,
  describeRemainingMute,
  isAlertMuted,
  muteUntilIso,
} from "@/lib/alert-mute";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return { auth: null, res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (auth.role !== "admin") return { auth: null, res: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { auth, res: null };
}

async function readMute() {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, ALERT_MUTE_SETTING_KEY))
    .limit(1);
  const until = row?.value ?? null;
  return {
    mutedUntil: isAlertMuted(until, Date.now()) ? until : null,
    remaining: describeRemainingMute(until, Date.now()),
  };
}

// GET — current mute window (admin only)
export async function GET(req: NextRequest) {
  const { auth, res } = await requireAdmin(req);
  if (!auth) return res;
  try {
    return NextResponse.json(await readMute());
  } catch (e: unknown) {
    return apiError(e, "Could not load the mute window", 500);
  }
}

// POST — { hours?: number } to mute, { clear: true } to unmute
export async function POST(req: NextRequest) {
  const { auth, res } = await requireAdmin(req);
  if (!auth) return res;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;

  try {
    if (b.clear === true) {
      await upsertSetting(ALERT_MUTE_SETTING_KEY, null);
      return NextResponse.json({ mutedUntil: null, remaining: null });
    }
    const hours = clampMuteHours(b.hours);
    if (hours === null) {
      return NextResponse.json({ error: "hours must be a number between 1 and 72" }, { status: 400 });
    }
    const until = muteUntilIso(hours, Date.now());
    await upsertSetting(ALERT_MUTE_SETTING_KEY, until);
    return NextResponse.json(await readMute());
  } catch (e: unknown) {
    return apiError(e, "Could not update the mute window", 500);
  }
}
