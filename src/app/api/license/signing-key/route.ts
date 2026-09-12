import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { apiError } from "@/lib/api-error";
import { b64urlEncode } from "@/lib/license-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGNING_KEY_SETTING = "license_signing_private_key";

async function loadSigningKey(): Promise<{ privatePem: string | null; publicPem: string | null }> {
  const { db } = await import("@/db");
  const { settings } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, SIGNING_KEY_SETTING)).limit(1);
  if (!row?.value) return { privatePem: null, publicPem: null };
  try {
    const { publicPemFromPrivateKeyPem } = await import("@/lib/signing");
    const publicPem = publicPemFromPrivateKeyPem(row.value);
    return { privatePem: row.value, publicPem };
  } catch {
    return { privatePem: null, publicPem: null };
  }
}

// GET — does a signing key exist, and what is the PUBLIC half
export async function GET(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "licenses.view", auth.keyScope))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }
  try {
    const { publicPem } = await loadSigningKey();
    return NextResponse.json({ configured: publicPem !== null, publicKey: publicPem });
  } catch (e: unknown) {
    return apiError(e, "Could not load the signing key", 500);
  }
}

// POST — generate a fresh Ed25519 pair (replaces any existing one)
export async function POST(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "licenses.issue", auth.keyScope))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }
  try {
    const { generateKeyPairSync } = await import("node:crypto");
    const { privatePem, publicPem } = await (async () => {
      const pair = generateKeyPairSync("ed25519");
      return {
        privatePem: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
        publicPem: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
      };
    })();

    const { upsertSetting } = await import("@/lib/webhook-dispatch");
    await upsertSetting(SIGNING_KEY_SETTING, privatePem);

    void b64urlEncode; // (shared helper module stays referenced for token routes)
    return NextResponse.json({ ok: true, publicKey: publicPem });
  } catch (e: unknown) {
    return apiError(e, "Could not generate the signing key", 500);
  }
}
