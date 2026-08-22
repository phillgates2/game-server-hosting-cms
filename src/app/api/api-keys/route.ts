import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { apiKeys } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission, ALL_PERMISSIONS } from "@/lib/permissions";
import { and, eq } from "drizzle-orm";
import { randomBytes, createHash } from "crypto";
import { apiError } from "@/lib/api-error";
import { hashApiKey } from "@/lib/api-key-auth";
import { validateKeyScope } from "@/lib/server-lifecycle";

// Re-exported from the shared module so the generator and the verifier can
// never drift apart.
const hashKey = hashApiKey;

// GET /api/api-keys — List user's API keys
export async function GET(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "apikeys.view"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const keys = await db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        permissions: apiKeys.permissions,
        lastUsedAt: apiKeys.lastUsedAt,
        expiresAt: apiKeys.expiresAt,
        createdAt: apiKeys.createdAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.userId, auth.userId));

    return NextResponse.json({ keys });
  } catch {
    return NextResponse.json({ keys: [] });
  }
}

// POST /api/api-keys — Create a new API key
export async function POST(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "apikeys.create"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const { name, permissions, expiresInDays } = await req.json();
    if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });

    // A malformed scope would be stored and then deny every request, which
    // presents as a mysteriously broken key rather than a rejected one.
    const scopeCheck = validateKeyScope(permissions, ALL_PERMISSIONS);
    if (scopeCheck.error !== null) {
      return NextResponse.json({ error: scopeCheck.error }, { status: 400 });
    }

    // Generate a secure random key
    const rawKey = `gsm_${randomBytes(32).toString("hex")}`;
    const prefix = rawKey.slice(0, 11);
    const keyH = hashKey(rawKey);
    const expiresAt = expiresInDays ? new Date(Date.now() + expiresInDays * 86400000) : null;

    const [key] = await db.insert(apiKeys).values({
      userId: auth.userId,
      name,
      keyHash: keyH,
      keyPrefix: prefix,
      permissions: scopeCheck.scope,
      expiresAt,
    }).returning();

    // Return the full key ONLY on creation — it's never shown again
    return NextResponse.json({
      key: { id: key.id, name: key.name, keyPrefix: key.keyPrefix, createdAt: key.createdAt },
      secretKey: rawKey,
      message: "Save this key now — it will not be shown again.",
    }, { status: 201 });
  } catch (e: unknown) {
    return apiError(e, "Failed", 500);
  }
}

// DELETE /api/api-keys — Delete a key
export async function DELETE(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "apikeys.revoke")) && !(await hasPermission(auth.userId, "apikeys.create"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const { id } = await req.json();
    await db
      .delete(apiKeys)
      .where(and(eq(apiKeys.id, Number(id)), eq(apiKeys.userId, auth.userId)));
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return apiError(e, "Failed", 500);
  }
}
