import { NextRequest, NextResponse } from "next/server";
import { publicThrottleAllowed } from "@/lib/public-throttle";
import { lookupPublicList } from "@/lib/status-lookup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/public/status — the aggregated status board as JSON.
 *
 * Anonymous like the token links: this is the share surface. Only servers
 * explicitly opted in (status_public) appear, and each entry is the
 * whitelisted publicStatusPayload — nothing internal leaves this route.
 */
function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "anon";
}

export async function GET(req: NextRequest) {
  // Anonymous + probe-triggering: cap how often one client may ask.
  if (!publicThrottleAllowed(`public-status:${clientIp(req)}`)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  try {
    const servers = await lookupPublicList();
    // Public data with a public CORS policy so community sites can embed a
    // live status widget straight from this endpoint.
    return NextResponse.json(
      { servers },
      { headers: { "cache-control": "no-store", "access-control-allow-origin": "*" } }
    );
  } catch {
    return NextResponse.json(
      { servers: [] },
      { headers: { "cache-control": "no-store", "access-control-allow-origin": "*" } }
    );
  }
}
