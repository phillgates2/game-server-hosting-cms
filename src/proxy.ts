import { NextRequest, NextResponse } from "next/server";
import { checkCsrf, expectedOrigin } from "@/lib/csrf";

/**
 * Global CSRF guard for state-changing API requests.
 *
 * Applied here rather than per route so a new endpoint is protected the moment
 * it is added — earlier sweeps repeatedly found guards that existed on most
 * routes but had been forgotten on one.
 *
 * Next 16 renamed this convention from `middleware` to `proxy`; the old name
 * still works but warns on every build.
 *
 * Only reads headers and never touches the database, so it stays cheap.
 */
export function proxy(req: NextRequest) {
  const verdict = checkCsrf({
    method: req.method,
    origin: req.headers.get("origin"),
    referer: req.headers.get("referer"),
    expected: expectedOrigin({ url: req.url, headers: req.headers }),
    // An API key is sent in a header a cross-site form cannot set.
    hasApiKey: Boolean(req.headers.get("authorization") || req.headers.get("x-api-key")),
  });

  if (!verdict.ok) {
    console.warn(`[csrf] ${req.method} ${req.nextUrl.pathname}: ${verdict.reason}`);
    return NextResponse.json(
      { error: "Cross-site request blocked" },
      { status: 403 }
    );
  }

  return NextResponse.next();
}

export const config = {
  // Only the API needs this; page navigations are GETs and are unaffected.
  matcher: ["/api/:path*"],
};
