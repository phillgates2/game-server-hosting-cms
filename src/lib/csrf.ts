/**
 * Cross-site request forgery protection.
 *
 * The panel authenticates with a cookie, so the browser attaches credentials
 * to *any* request a page can cause — including one triggered by a page on
 * another site. `sameSite: "lax"` blocks most of that, but deliberately not
 * top-level navigations, which includes an auto-submitting `<form method=POST>`
 * on an attacker's page. The file-upload route accepts `multipart/form-data`,
 * which a cross-site form can send without any CORS preflight at all.
 *
 * Rather than issue and track per-session tokens, this validates the request's
 * declared origin against the host it actually arrived at. For a same-origin
 * API that is equivalent protection and has no state to store, rotate or leak:
 *
 *   - Browsers set `Origin` on every POST/PUT/PATCH/DELETE and refuse to let
 *     script forge it, so a cross-site form submission is identifiable.
 *   - `Referer` is used as a fallback for the rare client that omits Origin.
 *   - API keys are exempt: they are sent in a header a cross-site form cannot
 *     set, so they are not a CSRF vector, and rejecting them would break every
 *     script and integration.
 */

/** Methods that can change state and therefore need checking. */
const PROTECTED_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Extract the `scheme://host` of a URL, or null when unparseable. */
function originOf(value: string | null): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/**
 * The origin this request was actually addressed to.
 *
 * Behind a reverse proxy the scheme in the URL is http even when the client
 * used https, so `x-forwarded-proto` wins when present — the same rule the
 * session cookie already uses to decide its `secure` flag.
 */
export function expectedOrigin(req: {
  url: string;
  headers: Headers;
}): string | null {
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  if (!host) return null;
  const proto =
    req.headers.get("x-forwarded-proto") ||
    (() => {
      try {
        return new URL(req.url).protocol.replace(":", "");
      } catch {
        return "http";
      }
    })();
  return `${proto}://${host}`;
}

export interface CsrfVerdict {
  ok: boolean;
  /** Why it was rejected, for the response and the log. */
  reason?: string;
}

/**
 * Decide whether a request may proceed.
 *
 * Exported separately from the middleware so the rule can be unit tested
 * without constructing a Next.js request pipeline.
 */
export function checkCsrf(args: {
  method: string;
  origin: string | null;
  referer: string | null;
  expected: string | null;
  /** True when the caller authenticated with an API key rather than a cookie. */
  hasApiKey: boolean;
}): CsrfVerdict {
  const { method, origin, referer, expected, hasApiKey } = args;

  if (!PROTECTED_METHODS.has(method.toUpperCase())) return { ok: true };

  // An API key travels in a header that a cross-site form cannot set, so it
  // cannot be replayed by a third-party page. Blocking it would break every
  // integration for no security gain.
  if (hasApiKey) return { ok: true };

  // Without a host we cannot form an expectation; failing closed here would
  // break local tooling that omits Host, so allow and rely on sameSite.
  if (!expected) return { ok: true };

  // Browsers always send Origin on a cross-origin state-changing request, and
  // on same-origin ones for these methods. Non-browser clients that send
  // neither header are not driving a victim's browser, so they are not the
  // threat this defends against.
  const declared = originOf(origin) ?? originOf(referer);
  if (!declared) return { ok: true };

  if (declared !== expected) {
    return {
      ok: false,
      reason: `Cross-site request blocked (from ${declared})`,
    };
  }
  return { ok: true };
}
