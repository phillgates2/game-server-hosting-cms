import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { licenseKeys } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import { ensureLicenseTables } from "@/lib/licensing";
import { buildOfflineToken, normalizePublicKeyPem, OFFLINE_TOKEN_MAX_DAYS } from "@/lib/license-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGNING_KEY_SETTING = "license_signing_private_key";

// POST /api/license/keys/[id]/offline-token — { days } — sign an air-gap token
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "licenses.issue"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  let body: unknown = {};
  try { body = await req.json(); } catch { body = {}; }
  const daysRaw = Number((body as Record<string, unknown>)?.days ?? 90);
  const days = Number.isInteger(daysRaw) && daysRaw >= 1 ? Math.min(daysRaw, OFFLINE_TOKEN_MAX_DAYS) : 90;

  try {
    const { id } = await params;
    await ensureLicenseTables();
    const [key] = await db
      .select()
      .from(licenseKeys)
      .where(eq(licenseKeys.id, Number(id)))
      .limit(1);
    if (!key) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (key.revokedAt) return NextResponse.json({ error: "That key is revoked — it cannot issue offline tokens." }, { status: 400 });

    const { settings } = await import("@/db/schema");
    const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, SIGNING_KEY_SETTING)).limit(1);
    if (!row?.value) {
      return NextResponse.json({ error: "No signing key yet — generate one first (Signing key section)." }, { status: 400 });
    }
    const { createPrivateKey } = await import("node:crypto");
    let publicPem: string;
    try {
      publicPem = createPrivateKey(row.value).export({ type: "spki", format: "pem" }).toString();
    } catch {
      return NextResponse.json({ error: "The stored signing key is corrupt — regenerate it." }, { status: 500 });
    }

    const nowMs = Date.now();
    const token = await buildOfflineToken({
      keyId: key.id,
      label: key.label,
      issuedAtMs: nowMs,
      expiresAtMs: nowMs + days * 86_400_000,
      privateKeyPem: row.value,
    });

    return NextResponse.json({
      ok: true,
      token,
      days,
      expiresAt: new Date(nowMs + days * 86_400_000).toISOString(),
      publicKey: publicPem,
      publicKeyWrapped: Buffer.from(publicPem, "utf8").toString("base64"),
    });
  } catch (e: unknown) {
    return apiError(e, "Could not issue the offline token", 500);
  }
}
