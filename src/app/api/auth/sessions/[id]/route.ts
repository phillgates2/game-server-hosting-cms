import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { apiError } from "@/lib/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// DELETE /api/auth/sessions/[id] — revoke one session (owner or admin).
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
  }

  try {
    const { revokeSessionById } = await import("@/lib/session-store");
    const ok = await revokeSessionById(id, auth.userId, auth.role === "admin");
    if (!ok) return NextResponse.json({ error: "Session not found or already revoked" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return apiError(e, "Could not revoke the session", 500);
  }
}
