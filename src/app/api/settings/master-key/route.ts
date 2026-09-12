import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { settings, auditLog } from "@/db/schema";
import { eq } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import { authorizeMasterOrSession } from "@/lib/master-key";
import {
  generateMasterKey,
  hashMasterKey,
  masterKeyConfigured,
  MASTER_KEY_SETTING,
} from "@/lib/master-key";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function ipOf(req: NextRequest): Promise<string> {
  return (req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown").slice(0, 45);
}

// GET — status only (never the key itself)
export async function GET(req: NextRequest) {
  const { auth, res } = await authorizeMasterOrSession(req, "panel.settings");
  if (!auth) return res ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const state = await masterKeyConfigured();
    return NextResponse.json(state);
  } catch (e: unknown) {
    return apiError(e, "Could not load master key status", 500);
  }
}

// POST — generate/rotate; the plaintext is shown EXACTLY ONCE
export async function POST(req: NextRequest) {
  const { auth, res } = await authorizeMasterOrSession(req, "panel.settings");
  if (!auth) return res ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const key = await generateMasterKey();
    const keyHash = await hashMasterKey(key);
    const [existing] = await db.select({ id: settings.id }).from(settings).where(eq(settings.key, MASTER_KEY_SETTING)).limit(1);
    if (existing) {
      await db.update(settings).set({ value: keyHash }).where(eq(settings.key, MASTER_KEY_SETTING));
    } else {
      await db.insert(settings).values({ key: MASTER_KEY_SETTING, value: keyHash });
    }
    try {
      await db.insert(auditLog).values({
        userId: auth.userId || null,
        action: "master-key.rotate",
        entityType: "panel",
        entityId: null,
        details: {},
        ipAddress: await ipOf(req),
      });
    } catch { /* best-effort */ }
    // The ONLY response that ever contains the plaintext master key.
    return NextResponse.json({ ok: true, key });
  } catch (e: unknown) {
    return apiError(e, "Could not generate the master key", 500);
  }
}

// DELETE — revoke the stored master key (the env key, if any, still works)
export async function DELETE(req: NextRequest) {
  const { auth, res } = await authorizeMasterOrSession(req, "panel.settings");
  if (!auth) return res ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await db.delete(settings).where(eq(settings.key, MASTER_KEY_SETTING));
    try {
      await db.insert(auditLog).values({
        userId: auth.userId || null,
        action: "master-key.revoke",
        entityType: "panel",
        entityId: null,
        details: {},
        ipAddress: await ipOf(req),
      });
    } catch { /* best-effort */ }
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return apiError(e, "Could not revoke the master key", 500);
  }
}
