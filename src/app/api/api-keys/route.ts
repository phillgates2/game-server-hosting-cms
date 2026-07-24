import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { apiKeys } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { randomBytes, createHash } from "crypto";

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

// GET /api/api-keys — List user's API keys
export async function GET(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

  try {
    const { name, permissions, expiresInDays } = await req.json();
    if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });

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
      permissions: permissions || null,
      expiresAt,
    }).returning();

    // Return the full key ONLY on creation — it's never shown again
    return NextResponse.json({
      key: { id: key.id, name: key.name, keyPrefix: key.keyPrefix, createdAt: key.createdAt },
      secretKey: rawKey,
      message: "Save this key now — it will not be shown again.",
    }, { status: 201 });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}

// DELETE /api/api-keys — Delete a key
export async function DELETE(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await req.json();
    await db.delete(apiKeys).where(eq(apiKeys.id, Number(id)));
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
