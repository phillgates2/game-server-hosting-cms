import { NextResponse } from "next/server";

/**
 * Return a safe error response.
 *
 * Raw exception messages routinely carry SQL fragments, absolute filesystem
 * paths and driver internals. Those are useful in a server log and dangerous in
 * an HTTP body, so the detail is logged and the client gets `publicMessage`.
 *
 * Outside production the detail is echoed back as well, because losing it makes
 * local debugging painful.
 */
export function apiError(
  error: unknown,
  publicMessage = "Request failed",
  status = 500
): NextResponse {
  const detail = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  console.error(`[api] ${publicMessage}:`, stack || detail);

  if (process.env.NODE_ENV !== "production") {
    return NextResponse.json({ error: publicMessage, detail }, { status });
  }

  return NextResponse.json({ error: publicMessage }, { status });
}
