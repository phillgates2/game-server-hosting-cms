import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, getTokenFromHeaders } from "@/lib/auth";
import { apiError } from "@/lib/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/auth/sessions — the caller's own active sessions (admin: ?userId=N)
export async function GET(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { listSessions } = await import("@/lib/session-store");
    let target = auth.userId;
    const q = req.nextUrl.searchParams.get("userId");
    if (q) {
      const n = Number(q);
      if (!Number.isInteger(n) || n <= 0) {
        return NextResponse.json({ error: "Invalid userId" }, { status: 400 });
      }
      if (auth.role !== "admin" && n !== auth.userId) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      target = n;
    }
    const currentToken = getTokenFromHeaders(req.headers);
    const sessions = await listSessions(target, currentToken);
    return NextResponse.json({ sessions });
  } catch (e: unknown) {
    return apiError(e, "Could not list sessions", 500);
  }
}
