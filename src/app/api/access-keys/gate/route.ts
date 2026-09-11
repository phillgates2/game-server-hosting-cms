import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accessKeys, settings } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { eq, isNull } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import { ensureAccessKeysTable, ACCESS_GATE_ENV } from "@/lib/access-gate";
import { ACCESS_GATE_SETTING_KEY, generateAccessKey } from "@/lib/access-keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function setGateSetting(enabled: boolean): Promise<void> {
  const [existing] = await db
    .select({ id: settings.id })
    .from(settings)
    .where(eq(settings.key, ACCESS_GATE_SETTING_KEY))
    .limit(1);
  if (existing) {
    await db
      .update(settings)
      .set({ value: String(enabled), updatedAt: new Date() })
      .where(eq(settings.key, ACCESS_GATE_SETTING_KEY));
  } else {
    await db.insert(settings).values({ key: ACCESS_GATE_SETTING_KEY, value: String(enabled) });
  }
}

// POST /api/access-keys/gate — { enabled: boolean }
// Enabling with zero active keys auto-mints one and returns it ONCE as
// bootstrapKey, so the operator is never staring at an enabled gate with no
// way in. Admin only.
export async function POST(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const enabled = (body as Record<string, unknown>).enabled;
  if (typeof enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be true or false" }, { status: 400 });
  }

  const forced = process.env[ACCESS_GATE_ENV];
  if (forced === "on" || forced === "off") {
    return NextResponse.json(
      {
        error: `The gate is force-${forced === "on" ? "enabled" : "disabled"} by the ${ACCESS_GATE_ENV} environment variable. Unset it to control the gate from the panel.`,
      },
      { status: 409 }
    );
  }

  try {
    await ensureAccessKeysTable();

    if (!enabled) {
      await setGateSetting(false);
      return NextResponse.json({ enabled: false });
    }

    // Enabling: guarantee at least one active key exists.
    const [active] = await db
      .select({ id: accessKeys.id })
      .from(accessKeys)
      .where(isNull(accessKeys.revokedAt))
      .limit(1);

    let bootstrapKey: string | null = null;
    if (!active) {
      const { key, hash, prefix } = generateAccessKey();
      await db
        .insert(accessKeys)
        .values({ keyHash: hash, keyPrefix: prefix, label: "Bootstrap key", createdBy: auth.userId });
      bootstrapKey = key;
    }

    await setGateSetting(true);
    return NextResponse.json({ enabled: true, bootstrapKey });
  } catch (e: unknown) {
    return apiError(e, "Could not update the access gate", 500);
  }
}
