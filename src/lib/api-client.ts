/**
 * Small fetch wrapper for panel mutations.
 *
 * Several panels called `await fetch(...)` for a POST/PATCH/DELETE and then
 * immediately reloaded the list without looking at the response. When the
 * request was refused — a 403 because the role lacks the permission, or a 400
 * from one of the validation guards — the reload simply redisplayed the
 * unchanged data and the user was told nothing at all. Deleting a forum thread
 * you are not allowed to delete looked identical to the thread refusing to
 * disappear.
 *
 * `mutate` makes the failure path explicit and gives the caller the server's
 * own error message, which is usually already written for a human.
 */

export interface MutateResult<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
  /** Human-readable reason, present whenever `ok` is false. */
  error?: string;
}

/** Turn a response into a message worth showing a user. */
export function messageForStatus(status: number, serverError?: string): string {
  if (serverError && serverError.trim()) return serverError;
  switch (status) {
    case 400:
      return "That request was rejected. Check the values and try again.";
    case 401:
      return "Your session has expired. Sign in again.";
    case 403:
      return "You do not have permission to do that.";
    case 404:
      return "That item no longer exists. It may have been deleted already.";
    case 409:
      return "That conflicts with something that already exists.";
    case 429:
      return "Too many requests. Wait a moment and try again.";
    default:
      return status >= 500
        ? "The server ran into a problem. Try again shortly."
        : `Request failed (${status}).`;
  }
}

/**
 * Perform a mutating request and always report the outcome.
 *
 * Never throws: a network failure comes back as `ok: false` with status 0, so
 * callers can handle every failure the same way.
 */
export async function mutate<T = unknown>(
  url: string,
  init: RequestInit = {}
): Promise<MutateResult<T>> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers || {}),
      },
    });

    let data: T | null = null;
    let serverError: string | undefined;
    try {
      const text = await res.text();
      if (text) {
        const parsed = JSON.parse(text);
        data = parsed as T;
        if (parsed && typeof parsed === "object" && "error" in parsed) {
          serverError = String((parsed as { error: unknown }).error);
        }
      }
    } catch {
      // A non-JSON body is not itself a failure; fall back to the status.
    }

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        data,
        error: messageForStatus(res.status, serverError),
      };
    }
    return { ok: true, status: res.status, data };
  } catch {
    return {
      ok: false,
      status: 0,
      data: null,
      error: "Could not reach the server. Check your connection.",
    };
  }
}

/**
 * How long a request may hang before it is treated as failed.
 *
 * `fetch` has no timeout of its own. If the panel process is wedged — a
 * blocked event loop, a half-open connection, a laptop whose Wi-Fi dropped —
 * the promise never settles and the screen sits on a spinner forever with no
 * way to tell "slow" from "never". Fifteen seconds is longer than any panel
 * request should take and short enough that the user gets an answer.
 */
export const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * `fetch` with a deadline.
 *
 * Aborting produces a rejection whose reason names the timeout, so callers can
 * distinguish "you are offline", "the server said no" and "it never answered".
 * A caller-supplied signal still works: it is forwarded to the inner
 * controller, so either deadline can cancel the request.
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(
      new DOMException(`Request timed out after ${timeoutMs}ms`, "TimeoutError")
    );
  }, timeoutMs);

  const outer = init.signal;
  const forwardAbort = () => controller.abort(outer?.reason);
  if (outer) {
    if (outer.aborted) forwardAbort();
    else outer.addEventListener("abort", forwardAbort, { once: true });
  }

  try {
    // Already cancelled before we started: do not bother the network.
    if (controller.signal.aborted) {
      throw controller.signal.reason ?? new DOMException("Request aborted", "AbortError");
    }
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", forwardAbort);
  }
}
