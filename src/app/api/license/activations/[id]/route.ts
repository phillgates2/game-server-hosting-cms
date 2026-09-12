import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { licenseActivations, licenseKeys, auditLog } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import { ensureLicenseTables } from "@/lib/licensing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// DELETE /api/license/activations/[id] — "transfer": free this activation
// slot so the customer's key can activate on new hardware. The activation
// row is removed; the key's cap then has room for exactly one new install.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "licenses.revoke"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const { id } = await params;
    await ensureLicenseTables();
    const [act] = await db
      .select({
        id: licenseActivations.id,
        keyId: licenseActivations.keyId,
        hostname: licenseActivations.hostname,
        fingerprint: licenseActivations.fingerprint,
      })
      .from(licenseActivations)
      .where(eq(licenseActivations.id, Number(id)))
      .limit(1);
    if (!act) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const [key] = await db
      .select({ id: licenseKeys.id, keyPrefix: licenseKeys.keyPrefix, label: licenseKeys.label, revokedAt: licenseKeys.revokedAt })
      .from(licenseKeys)
      .where(eq(licenseKeys.id, act.keyId))
      .limit(1);
    if (!key) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await db.delete(licenseActivations).where(eq(licenseActivations.id, act.id));

    try {
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
      await db.insert(auditLog).values({
        userId: auth.userId as number,
        action: "license.transfer",
        entityType: "license",
        entityId: key.id,
        details: { activationId: act.id, hostname: act.hostname, keyPrefix: key.keyPrefix, label: key.label },
        ipAddress: ip.slice(0, 45),
      });
    } catch { /* best-effort */ }

    return NextResponse.json({ ok: true, freedKeyPrefix: key.keyPrefix });
  } catch (e: unknown) {
    return apiError(e, "Transfer failed", 500);
  }
}
