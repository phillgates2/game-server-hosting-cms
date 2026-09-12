import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { apiError } from "@/lib/api-error";
import { upsertSetting } from "@/lib/webhook-dispatch";
import {
  IDLE_POLICY_ENABLED_KEY,
  IDLE_POLICY_HOURS_KEY,
  IDLE_DEFAULT_THRESHOLD_HOURS,
} from "@/lib/idle-math";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const IDLE_POLICY_MIN_HOURS = 1;
export const IDLE_POLICY_MAX_HOURS = 72;

async function requireAdmin(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return { auth: null, res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (auth.role !== "admin") return { auth: null, res: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { auth, res: null };
}

async function readPolicy() {
  const rows = await db
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(eq(settings.key, IDLE_POLICY_ENABLED_KEY))
    .limit(1);
  const hoursRows = await db
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(eq(settings.key, IDLE_POLICY_HOURS_KEY))
    .limit(1);
  const hours = Number(hoursRows[0]?.value);
  return {
    enabled: rows[0]?.value === "true",
    hours:
      Number.isFinite(hours) && hours >= IDLE_POLICY_MIN_HOURS && hours <= IDLE_POLICY_MAX_HOURS
        ? hours
        : IDLE_DEFAULT_THRESHOLD_HOURS,
  };
}

// GET — current idle auto-stop policy (admin only)
export async function GET(req: NextRequest) {
  const { auth, res } = await requireAdmin(req);
  if (!auth) return res ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await readPolicy());
  } catch (e: unknown) {
    return apiError(e, "Could not load the idle policy", 500);
  }
}

// POST — { enabled?: boolean, hours?: number }
export async function POST(req: NextRequest) {
  const { auth, res } = await requireAdmin(req);
  if (!auth) return res ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;

  try {
    if (b.enabled !== undefined) {
      if (typeof b.enabled !== "boolean") {
        return NextResponse.json({ error: "enabled must be true or false" }, { status: 400 });
      }
      await upsertSetting(IDLE_POLICY_ENABLED_KEY, String(b.enabled));
    }
    if (b.hours !== undefined) {
      const hours = Number(b.hours);
      if (!Number.isInteger(hours) || hours < IDLE_POLICY_MIN_HOURS || hours > IDLE_POLICY_MAX_HOURS) {
        return NextResponse.json(
          { error: `hours must be a whole number between ${IDLE_POLICY_MIN_HOURS} and ${IDLE_POLICY_MAX_HOURS}` },
          { status: 400 }
        );
      }
      await upsertSetting(IDLE_POLICY_HOURS_KEY, String(hours));
    }
    return NextResponse.json(await readPolicy());
  } catch (e: unknown) {
    return apiError(e, "Could not save the idle policy", 500);
  }
}
