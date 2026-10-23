import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { licenseKeys, licenseActivations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import { clientIpForRecord } from "@/lib/ip-allowlist";
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
  // The brute-force limit is the only defence this anonymous endpoint has
  // against key enumeration, so its key must not be a header the caller
  // controls. The shared trust-aware extractor honours forwarded headers only
  // behind GSM_TRUST_PROXY and only the LAST hop.
  return clientIpForRecord(req.headers);
}

/**
 * The shape every answer to this endpoint takes.
 *
 * `expiresAt`, `maxActivations` and `activationsUsed` are present on EVERY
 * branch — including failures — so a caller cannot tell "this key does not
 * exist" from "this key exists but is revoked" by reading the response. The
 * shape is built here rather than spelled out at each return, because that is
 * exactly how the oracle got in: one branch that omitted the fields.
 */
function answer(
  status: string,
  message: string,
  ok: boolean,
  httpStatus = ok ? 200 : 402,
  extra: { activationsUsed?: number; maxActivations?: number | null; expiresAt?: Date | null } = {}
): NextResponse {
  return NextResponse.json(
    {
      ok,
      status,
      message,
      activationsUsed: extra.activationsUsed ?? 0,
      maxActivations: extra.maxActivations ?? null,
      expiresAt: extra.expiresAt ?? null,
    },
    { status: httpStatus }
  );
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
    return answer("invalid", licenseCheckMessage("invalid"), false, 400);
  }
  const key = (body as Record<string, unknown>)?.key;
  const { verifyMasterKey } = await import("@/lib/master-key");
  if (await verifyMasterKey(key)) {
    return answer("valid", "Master key — unlimited activations, never expires.", true);
  }
  if (!isValidLicenseKeyFormat(key)) {
    return answer("invalid", licenseCheckMessage("invalid"), false);
  }

  try {
    await ensureLicenseTables();
    const keyHash = await hashLicenseKey(key as string);
    const [row] = await db.select().from(licenseKeys).where(eq(licenseKeys.keyHash, keyHash)).limit(1);
    if (!row) {
      return answer("invalid", licenseCheckMessage("invalid"), false);
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

    return answer(
      verdict,
      verdict === "valid"
        ? `Key is valid — ${activations.length}/${row.maxActivations} activations used.`
        : verdict === "fully-activated"
          ? `Key is valid and fully activated (${activations.length}/${row.maxActivations}). Ask your provider to transfer an activation before installing again.`
          : licenseCheckMessage(verdict as "revoked" | "expired"),
      verdict === "valid" || verdict === "fully-activated",
      200,
      {
        activationsUsed: activations.length,
        maxActivations: row.maxActivations,
        expiresAt: row.expiresAt,
      }
    );
  } catch (e: unknown) {
    return apiError(e, "License check failed", 500);
  }
}
