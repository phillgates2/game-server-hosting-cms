import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accessKeys } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { and, eq, isNull } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import { ensureAccessKeysTable } from "@/lib/access-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// DELETE /api/access-keys/[id] — revoke a key (admin only).
// Revocation stamps revoked_at instead of deleting so the audit trail of who
// handed out which key survives.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid key id" }, { status: 400 });
  }

  try {
    await ensureAccessKeysTable();
    const [updated] = await db
      .update(accessKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(accessKeys.id, id), isNull(accessKeys.revokedAt)))
      .returning({ id: accessKeys.id });
    if (!updated) {
      return NextResponse.json({ error: "Key not found or already revoked" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return apiError(e, "Could not revoke the access key", 500);
  }
}
