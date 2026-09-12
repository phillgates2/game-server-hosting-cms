import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { licenseKeys, licenseActivations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import { ensureLicenseTables, hashLicenseKey, isValidLicenseKeyFormat, licenseCheckMessage, checkRateLimit, type RateLimitEntry } from "@/lib/licensing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Self-service key check for customers. Public and anonymous, so:
 *   - tight per-IP rate limit (tighter than validate — this is informational)
 *   - answers the SAME shape for every failure class (no existence oracle)
 *   - never includes activation hostnames or the key label
 */
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 5;
const hits = new Map<string, RateLimitEntry>();

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  ).slice(0, 45);
}

// POST /api/license/public/check — { key }
export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  if (checkRateLimit(hits, ip, Date.now(), RATE_WINDOW_MS, RATE_MAX)) {
    return NextResponse.json(
      { ok: false, status: "rate-limited", message: "Too many checks — try again in a minute." },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, status: "invalid", message: licenseCheckMessage("invalid") }, { status: 400 });
  }
  const key = (body as Record<string, unknown>)?.key;
  if (!isValidLicenseKeyFormat(key)) {
    return NextResponse.json({ ok: false, status: "invalid", message: licenseCheckMessage("invalid") }, { status: 402 });
  }

  try {
    await ensureLicenseTables();
    const keyHash = await hashLicenseKey(key as string);
    const [row] = await db.select().from(licenseKeys).where(eq(licenseKeys.keyHash, keyHash)).limit(1);
    if (!row) {
      return NextResponse.json({ ok: false, status: "invalid", message: licenseCheckMessage("invalid") }, { status: 402 });
    }

    const activations = await db
      .select({ id: licenseActivations.id })
      .from(licenseActivations)
      .where(eq(licenseActivations.keyId, row.id));

    const nowMs = Date.now();
    const expired = !!row.expiresAt && new Date(row.expiresAt).getTime() <= nowMs;
    const verdict = row.revokedAt !== null
      ? "revoked"
      : expired
        ? "expired"
        : activations.length >= row.maxActivations
          ? "fully-activated"
          : "valid";

    return NextResponse.json({
      ok: verdict === "valid" || verdict === "fully-activated",
      status: verdict,
      message:
        verdict === "valid"
          ? `Key is valid — ${activations.length}/${row.maxActivations} activations used.`
          : verdict === "fully-activated"
            ? `Key is valid and fully activated (${activations.length}/${row.maxActivations}). Ask your provider to transfer an activation before installing again.`
            : licenseCheckMessage(verdict as "revoked" | "expired"),
      activationsUsed: activations.length,
      maxActivations: row.maxActivations,
      expiresAt: row.expiresAt,
    });
  } catch (e: unknown) {
    return apiError(e, "License check failed", 500);
  }
}
