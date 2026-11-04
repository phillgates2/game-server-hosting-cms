/**
 * Session-expiry detection.
 *
 * The panel is meant to stay open all day in a browser tab. When its session
 * lapses every request starts answering `401` — but each panel only reports that
 * in its own toast, so the operator sees a scattering of "unauthorised" errors
 * with no explanation of the cause. This module watches same-origin API
 * responses and announces the first `401` once, so the shell can say what
 * actually happened and offer to sign in again.
 *
 * Deliberate exclusions: the auth endpoints themselves. A `401` from
 * `/api/auth/me` is the normal signed-out answer, and a `401` from
 * `/api/auth/login` is a wrong password — neither means a session died.
 */

export const SESSION_EXPIRED_EVENT = "gsm:session-expired";

const AUTH_PATHS = ["/api/auth/login", "/api/auth/me", "/api/auth/logout", "/api/auth/register"];

/** Should this response be read as "the panel's session has ended"? */
export function isSessionExpiryResponse(url: string, status: number): boolean {
  if (status !== 401) return false;

  let parsed: URL;
  try {
    parsed = new URL(url, "http://panel.invalid");
  } catch {
    return false;
  }

  // An absolute URL to a different origin says nothing about our session.
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
    const origin = typeof window === "undefined" ? "http://panel.invalid" : window.location.origin;
    if (parsed.origin !== origin) return false;
  }

  const path = parsed.pathname;
  if (!path.startsWith("/api/")) return false;
  return !AUTH_PATHS.some((authPath) => path === authPath || path.startsWith(`${authPath}/`));
}

let refCount = 0;
let restore: (() => void) | null = null;
let lastAnnounced = 0;

/** Minimum gap between announcements, so one expired session is not a storm. */
export const SESSION_EXPIRY_NOTICE_INTERVAL_MS = 5_000;

/**
 * Wrap `window.fetch` so every 401 is noticed. Returns an uninstaller; safe to
 * call from several components (only one wrapper is ever installed).
 */
export function installSessionExpiryWatch(): () => void {
  if (typeof window === "undefined") return () => {};

  refCount += 1;

  if (!restore) {
    const original = window.fetch;
    const wrapped: typeof window.fetch = async (...args) => {
      const response = await original.apply(window, args);
      try {
        const input = args[0];
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        if (isSessionExpiryResponse(url, response.status)) {
          const now = Date.now();
          if (now - lastAnnounced > SESSION_EXPIRY_NOTICE_INTERVAL_MS) {
            lastAnnounced = now;
            window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
          }
        }
      } catch {
        // The watch must never break a request.
      }
      return response;
    };
    window.fetch = wrapped;
    restore = () => {
      if (window.fetch === wrapped) window.fetch = original;
    };
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    refCount -= 1;
    if (refCount <= 0) {
      refCount = 0;
      restore?.();
      restore = null;
    }
  };
}
