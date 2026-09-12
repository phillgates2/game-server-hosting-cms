import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { licenseKeys, licenseActivations } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import {
  ensureLicenseTables,
  hashLicenseKey,
  licenseFingerprint,
  decideLicenseCheck,
  licenseCheckMessage,
  isValidLicenseKeyFormat,
  checkRateLimit,
  type RateLimitEntry,
} from "@/lib/licensing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Per-IP rate limit for this anonymous endpoint. Brute force is the threat
 * model, so the window is tight and failures are counted too.
 */
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 10;
const hits = new Map<string, RateLimitEntry>();

function rateLimited(ip: string): boolean {
  return checkRateLimit(hits, ip, Date.now(), RATE_WINDOW_MS, RATE_MAX);
}

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  ).slice(0, 45);
}

// POST /api/license/validate — { key, hostname, panelUrl }
// Public (installers have no session), rate-limited, hash-compared.
export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  if (rateLimited(ip)) {
    return NextResponse.json(
      { ok: false, code: "rate-limited", error: "Too many attempts — try again in a minute." },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, code: "invalid", error: "Invalid JSON body" }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const key = b.key;
  const hostname = typeof b.hostname === "string" ? b.hostname.slice(0, 253) : "";
  const panelUrl = typeof b.panelUrl === "string" ? b.panelUrl.slice(0, 500) : "";

  // Fingerprint re-check: a licensed panel proves its activation without
  // ever holding key material. Finds the activation, re-evaluates the
  // parent key (revocation/expiry), refreshes lastSeenAt.
  if (typeof b.fingerprint === "string" && /^[0-9a-f]{64}$/.test(b.fingerprint) && key === undefined) {
    try {
      await ensureLicenseTables();
      const [act] = await db
        .select({
          id: licenseActivations.id,
          keyId: licenseActivations.keyId,
        })
        .from(licenseActivations)
        .where(eq(licenseActivations.fingerprint, b.fingerprint))
        .limit(1);
      if (!act) {
        return NextResponse.json({ ok: false, code: "invalid", error: licenseCheckMessage("invalid") }, { status: 402 });
      }
      const [parent] = await db
        .select()
        .from(licenseKeys)
        .where(eq(licenseKeys.id, act.keyId))
        .limit(1);
      if (!parent) {
        return NextResponse.json({ ok: false, code: "invalid", error: licenseCheckMessage("invalid") }, { status: 402 });
      }
      const code = decideLicenseCheck({
        keyFound: true,
        revoked: parent.revokedAt !== null,
        expired: !!parent.expiresAt && new Date(parent.expiresAt).getTime() <= Date.now(),
        activeActivations: 0,
        maxActivations: parent.maxActivations,
        sameFingerprintActive: true, // the re-check IS the fingerprint holder
      });
      if (code !== "ok") {
        const status = code === "invalid" || code === "revoked" ? 402 : 403;
        return NextResponse.json({ ok: false, code, error: licenseCheckMessage(code) }, { status });
      }
      await db
        .update(licenseActivations)
        .set({ lastSeenAt: new Date(), hostname: hostname || undefined, panelUrl: panelUrl || undefined, ipAddress: ip })
        .where(eq(licenseActivations.id, act.id));
      return NextResponse.json({ ok: true, code: "ok", message: licenseCheckMessage("ok") });
    } catch (e: unknown) {
      return apiError(e, "License validation failed", 500);
    }
  }

  if (!isValidLicenseKeyFormat(key)) {
    // Same shape as a real rejection — no free information.
    return NextResponse.json({ ok: false, code: "invalid", error: licenseCheckMessage("invalid") }, { status: 402 });
  }

  try {
    await ensureLicenseTables();
    const keyHash = await hashLicenseKey(key as string);
    const fingerprint = await licenseFingerprint(hostname, panelUrl);

    const [row] = await db
      .select()
      .from(licenseKeys)
      .where(eq(licenseKeys.keyHash, keyHash))
      .limit(1);

    const activeActivations = row
      ? (
          await db
            .select({ id: licenseActivations.id })
            .from(licenseActivations)
            .where(eq(licenseActivations.keyId, row.id))
        ).length
      : 0;
    const sameFingerprintActive = row
      ? (
          await db
            .select({ id: licenseActivations.id })
            .from(licenseActivations)
            .where(and(eq(licenseActivations.keyId, row.id), eq(licenseActivations.fingerprint, fingerprint)))
            .limit(1)
        ).length > 0
      : false;

    const code = decideLicenseCheck({
      keyFound: !!row,
      revoked: row?.revokedAt !== null && row?.revokedAt !== undefined,
      expired: !!row?.expiresAt && new Date(row.expiresAt).getTime() <= Date.now(),
      activeActivations,
      maxActivations: row?.maxActivations ?? 0,
      sameFingerprintActive,
    });

    if (code !== "ok") {
      const status = code === "invalid" || code === "revoked" ? 402 : 403;
      return NextResponse.json({ ok: false, code, error: licenseCheckMessage(code) }, { status });
    }

    // Record (or refresh) the activation.
    if (row) {
      if (sameFingerprintActive) {
        await db
          .update(licenseActivations)
          .set({ lastSeenAt: new Date(), hostname, panelUrl, ipAddress: ip })
          .where(and(eq(licenseActivations.keyId, row.id), eq(licenseActivations.fingerprint, fingerprint)));
      } else {
        await db.insert(licenseActivations).values({
          keyId: row.id,
          fingerprint,
          hostname,
          panelUrl,
          ipAddress: ip,
        });
      }
    }

    return NextResponse.json({ ok: true, code: "ok", message: licenseCheckMessage("ok") });
  } catch (e: unknown) {
    return apiError(e, "License validation failed", 500);
  }
}
