import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { licenseKeys, licenseActivations, auditLog } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq, asc } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import { ensureLicenseTables } from "@/lib/licensing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/license/keys/[id] — activations for one key
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { authorizeMasterOrSession } = await import("@/lib/master-key");
  const { auth, res: gateRes } = await authorizeMasterOrSession(req, "licenses.view");
  if (!auth) return gateRes;

  try {
    const { id } = await params;
    await ensureLicenseTables();
    const [key] = await db.select({ id: licenseKeys.id }).from(licenseKeys).where(eq(licenseKeys.id, Number(id))).limit(1);
    if (!key) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const rows = await db
      .select()
      .from(licenseActivations)
      .where(eq(licenseActivations.keyId, key.id))
      .orderBy(asc(licenseActivations.createdAt));
    return NextResponse.json({ activations: rows });
  } catch (e: unknown) {
    return apiError(e, "Failed to list activations", 500);
  }
}

// POST /api/license/keys/[id] — { action: "revoke" } — revoke a key
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { authorizeMasterOrSession } = await import("@/lib/master-key");
  const { auth, res: gateRes } = await authorizeMasterOrSession(req, "licenses.revoke");
  if (!auth) return gateRes;

  let body: unknown = {};
  try { body = await req.json(); } catch { body = {}; }
  const action = (body as Record<string, unknown>)?.action;
  if (action !== "revoke") {
    return NextResponse.json({ error: "Only action=revoke is supported" }, { status: 400 });
  }

  try {
    const { id } = await params;
    await ensureLicenseTables();
    const [key] = await db
      .select({ id: licenseKeys.id, revokedAt: licenseKeys.revokedAt, keyPrefix: licenseKeys.keyPrefix, label: licenseKeys.label })
      .from(licenseKeys)
      .where(eq(licenseKeys.id, Number(id)))
      .limit(1);
    if (!key) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (key.revokedAt) return NextResponse.json({ error: "Already revoked" }, { status: 400 });

    await db.update(licenseKeys).set({ revokedAt: new Date() }).where(eq(licenseKeys.id, key.id));

    // Tell the operator's channels the moment a key is revoked.
    try {
      const { notifyLicenseEvent } = await import("@/lib/license-expiry");
      await notifyLicenseEvent("revoked", key.keyPrefix, key.label);
    } catch { /* notifications never break revocation */ }

    try {
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
      await db.insert(auditLog).values({
        userId: auth.userId as number,
        action: "license.revoke",
        entityType: "license",
        entityId: key.id,
        details: {},
        ipAddress: ip.slice(0, 45),
      });
    } catch { /* best-effort */ }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return apiError(e, "Failed to revoke license key", 500);
  }
}
