import { NextRequest, NextResponse } from "next/server";
import { accessGateRequired } from "@/lib/access-gate";
import { publicThrottleAllowed } from "@/lib/public-throttle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/auth/access-gate — the login form needs to know whether to show
// the key field. Deliberately unauthenticated; it leaks only one boolean,
// and it is throttled per IP like the other anonymous endpoints.
export async function GET(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  if (!publicThrottleAllowed(`access-gate:${ip}`)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  try {
    return NextResponse.json({ required: await accessGateRequired() });
  } catch {
    return NextResponse.json({ required: false });
  }
}
