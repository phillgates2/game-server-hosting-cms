import { NextResponse } from "next/server";

/**
 * True when a database error is the Postgres unique-violation code (23505).
 *
 * Several routes check-then-insert a unique column; the check is a race and
 * the insert is the arbiter. Races resolved here still need a friendly 409
 * rather than a raw 500.
 */
export function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "23505";
}

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
