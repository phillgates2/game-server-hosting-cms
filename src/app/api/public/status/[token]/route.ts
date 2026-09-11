import { NextRequest, NextResponse } from "next/server";
import { publicThrottleAllowed } from "@/lib/public-throttle";
import { lookupPublicStatus } from "@/lib/status-lookup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/public/status/[token] — anonymous status lookup.
 *
 * Deliberately has NO auth: this is the share link. The token is the
 * authorisation (256 random bits), and the response is the whitelisted
 * publicStatusPayload — nothing internal ever leaves this route. Unknown or
 * malformed tokens get a bare 404 so they cannot be probed for shape.
 */
function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "anon";
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  // Anonymous + probe-triggering: cap how often one client may ask.
  if (!publicThrottleAllowed(`public-status:${clientIp(req)}`)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  const { token } = await params;
  try {
    const payload = await lookupPublicStatus(token);
    if (!payload) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(payload, {
      headers: {
        // The page is shareable by design, but a CDN must not serve one
        // server's status under another token.
        "cache-control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
