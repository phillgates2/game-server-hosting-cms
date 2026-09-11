import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  // Revoke the session before clearing the cookie so a leaked token cannot
  // keep working after the user logs out.
  try {
    const token = req.cookies.get("gsm_token")?.value;
    if (token) {
      const { revokeIssuedSession } = await import("@/lib/auth");
      await revokeIssuedSession(token);
    }
  } catch {
    /* best-effort */
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set("gsm_token", "", { path: "/", maxAge: 0 });
  return res;
}
