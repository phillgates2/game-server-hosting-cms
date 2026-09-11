import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accessKeys } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { desc } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import { ensureAccessKeysTable } from "@/lib/access-gate";
import { generateAccessKey, normalizeAccessKeyLabel } from "@/lib/access-keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The gate decides who may even log in — admin only, no delegation. */
async function requireAdmin(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return { auth: null, res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (auth.role !== "admin") {
    return { auth: null, res: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { auth, res: null };
}

// GET /api/access-keys — list keys (hashes never leave the server)
export async function GET(req: NextRequest) {
  const { auth, res } = await requireAdmin(req);
  if (!auth) return res;

  try {
    await ensureAccessKeysTable();
    const rows = await db
      .select({
        id: accessKeys.id,
        keyPrefix: accessKeys.keyPrefix,
        label: accessKeys.label,
        createdAt: accessKeys.createdAt,
        lastUsedAt: accessKeys.lastUsedAt,
        revokedAt: accessKeys.revokedAt,
      })
      .from(accessKeys)
      .orderBy(desc(accessKeys.createdAt))
      .limit(200);

    return NextResponse.json({
      keys: rows.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
        revokedAt: r.revokedAt?.toISOString() ?? null,
        active: r.revokedAt === null,
      })),
    });
  } catch (e: unknown) {
    return apiError(e, "Could not list access keys", 500);
  }
}

// POST /api/access-keys — mint a key. The plaintext is returned ONCE.
export async function POST(req: NextRequest) {
  const { auth, res } = await requireAdmin(req);
  if (!auth) return res;

  try {
    let body: unknown = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    const label = normalizeAccessKeyLabel((body as Record<string, unknown>).label);

    await ensureAccessKeysTable();
    const { key, hash, prefix } = generateAccessKey();
    const [created] = await db
      .insert(accessKeys)
      .values({ keyHash: hash, keyPrefix: prefix, label, createdBy: auth.userId })
      .returning({ id: accessKeys.id });

    return NextResponse.json(
      { key, id: created?.id ?? null, prefix, label },
      { status: 201 }
    );
  } catch (e: unknown) {
    return apiError(e, "Could not create the access key", 500);
  }
}


