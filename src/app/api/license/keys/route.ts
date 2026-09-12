import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { licenseKeys, licenseActivations, auditLog } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq, sql, desc } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import {
  ensureLicenseTables,
  generateLicenseKey,
  hashLicenseKey,
  licenseKeyDisplayLabel,
  clampMaxActivations,
  LICENSE_LABEL_MAX,
} from "@/lib/licensing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/license/keys — list (admins / licenses.view)
export async function GET(req: NextRequest) {
  const { authorizeMasterOrSession } = await import("@/lib/master-key");
  const { auth, res: gateRes } = await authorizeMasterOrSession(req, "licenses.view");
  if (!auth) return gateRes ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    await ensureLicenseTables();
    const rows = await db
      .select({
        id: licenseKeys.id,
        keyPrefix: licenseKeys.keyPrefix,
        label: licenseKeys.label,
        maxActivations: licenseKeys.maxActivations,
        expiresAt: licenseKeys.expiresAt,
        revokedAt: licenseKeys.revokedAt,
        createdAt: licenseKeys.createdAt,
        activations: sql<number>`count(${licenseActivations.id})::int`,
      })
      .from(licenseKeys)
      .leftJoin(licenseActivations, eq(licenseActivations.keyId, licenseKeys.id))
      .groupBy(licenseKeys.id)
      .orderBy(desc(licenseKeys.createdAt));

    return NextResponse.json({
      keys: rows.map((r) => ({
        id: r.id,
        prefix: r.keyPrefix,
        label: r.label,
        maxActivations: r.maxActivations,
        expiresAt: r.expiresAt,
        revoked: r.revokedAt !== null,
        createdAt: r.createdAt,
        activations: r.activations,
      })),
    });
  } catch (e: unknown) {
    return apiError(e, "Failed to list license keys", 500);
  }
}

// POST /api/license/keys — issue a key; plaintext shown ONCE
export async function POST(req: NextRequest) {
  const { authorizeMasterOrSession } = await import("@/lib/master-key");
  const { auth, res: gateRes } = await authorizeMasterOrSession(req, "licenses.issue");
  if (!auth) return gateRes ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown = {};
  try { body = await req.json(); } catch { body = {}; }
  const b = (body ?? {}) as Record<string, unknown>;

  const label = typeof b.label === "string" && b.label.trim() ? b.label.trim().slice(0, LICENSE_LABEL_MAX) : null;
  const maxActivations = clampMaxActivations(b.maxActivations);
  let expiresAt: Date | null = null;
  if (b.expiresAt !== undefined && b.expiresAt !== null && b.expiresAt !== "") {
    const d = new Date(String(b.expiresAt));
    if (!Number.isFinite(d.getTime()) || d.getTime() <= Date.now()) {
      return NextResponse.json({ error: "expiresAt must be a valid future date" }, { status: 400 });
    }
    expiresAt = d;
  }

  try {
    await ensureLicenseTables();
    const key = await generateLicenseKey();
    const keyHash = await hashLicenseKey(key);
    const [row] = await db
      .insert(licenseKeys)
      .values({
        keyHash,
        keyPrefix: licenseKeyDisplayLabel(key),
        label,
        maxActivations,
        expiresAt,
        createdBy: auth.userId as number,
      })
      .returning({ id: licenseKeys.id });

    try {
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
      await db.insert(auditLog).values({
        userId: auth.userId || null,
        action: "license.issue",
        entityType: "license",
        entityId: row.id,
        details: { prefix: licenseKeyDisplayLabel(key), label, maxActivations, viaMasterKey: auth.userId === 0 },
        ipAddress: ip.slice(0, 45),
      });
    } catch { /* best-effort */ }

    // The ONLY response that ever contains the plaintext key.
    return NextResponse.json({ ok: true, id: row.id, key, prefix: licenseKeyDisplayLabel(key) });
  } catch (e: unknown) {
    return apiError(e, "Failed to issue license key", 500);
  }
}
