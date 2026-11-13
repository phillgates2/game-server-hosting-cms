/**
 * Discord error payloads, turned into something an operator can act on.
 *
 * Discord answers a failed webhook call with a JSON body like
 * `{"message": "Unknown Webhook", "code": 10015}`, and the panel used to
 * surface that raw — `Discord API error: 404 - {"message":"Unknown Webhook",
 * "code":10015}` — which says what went wrong but not what to do about it, and
 * nothing anywhere noticed that the webhook was *gone* rather than briefly
 * unhappy.
 *
 * 10015 is the one an operator will actually hit: the webhook was deleted in
 * Discord (Server Settings → Integrations → Webhooks, or the whole channel was
 * deleted). Every notification then 404s forever, silently, because webhook
 * delivery never throws. Recognising the code lets the panel say "this webhook
 * no longer exists, here is how to fix it" and lets the backfill re-create it
 * instead of leaving the server mute.
 *
 * Pure and dependency-free so it can be tested without a network or a database
 * — and so client components may import it without pulling in server code.
 */

/** The subset of Discord's documented JSON error codes the panel cares about. */
export const DISCORD_ERROR_CODES = {
  /** The webhook id/token pair does not exist. */
  UNKNOWN_WEBHOOK: 10015,
  /** The webhook exists but its token was rotated (re-created). */
  INVALID_WEBHOOK_TOKEN: 50027,
  /** The channel a webhook lives in no longer exists. */
  UNKNOWN_CHANNEL: 10003,
  /** The message a webhook tried to edit no longer exists. */
  UNKNOWN_MESSAGE: 10008,
} as const;

export type DiscordFailureKind =
  /** The webhook itself is gone — nothing will ever be delivered again. */
  | "webhook-gone"
  /**
   * The *message* a webhook posted no longer exists. Recoverable: post a new
   * one. Deliberately not `gone`, because a board that re-posts is healthy
   * while a board that retries a dead webhook never recovers.
   */
  | "message-gone"
  /** The bot/webhook credentials are wrong or lack permission. */
  | "unauthorized"
  /** Discord asked us to slow down. */
  | "rate-limited"
  /** Discord refused the payload (empty message, oversized embed…). */
  | "bad-request"
  /** Discord is unwell; the request may succeed later. */
  | "server-error"
  /** Anything else — including a body that was not Discord's JSON at all. */
  | "other";

export interface DiscordFailure {
  kind: DiscordFailureKind;
  /**
   * True when the endpoint no longer exists, so retrying is pointless: the
   * webhook has to be re-created (or a new URL pasted in) before anything can
   * be delivered again.
   */
  gone: boolean;
  /** Discord's numeric error code, when the body carried one (e.g. 10015). */
  code?: number;
  /** Discord's own message, verbatim (`Unknown Webhook`). */
  message?: string;
  /** Operator-readable sentence, safe to show in the panel. */
  error: string;
  /** How long Discord asked us to wait, in milliseconds (429 only). */
  retryAfterMs?: number;
}

/** Parse a Discord error body without assuming it is JSON (proxies are not). */
export function parseDiscordError(body: string): {
  code?: number;
  message?: string;
  retryAfterMs?: number;
} {
  const raw = (body ?? "").trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as {
      code?: unknown;
      message?: unknown;
      retry_after?: unknown;
    };
    const code = typeof parsed.code === "number" && Number.isFinite(parsed.code) ? parsed.code : undefined;
    const message = typeof parsed.message === "string" ? parsed.message : undefined;
    const retryAfterMs =
      typeof parsed.retry_after === "number" && Number.isFinite(parsed.retry_after) && parsed.retry_after >= 0
        // A tiny pad so a retry after "0.5s" is not rejected for being 3ms early.
        ? Math.ceil(parsed.retry_after * 1000) + 250
        : undefined;
    const out: { code?: number; message?: string; retryAfterMs?: number } = {};
    if (code !== undefined) out.code = code;
    if (message !== undefined) out.message = message;
    if (retryAfterMs !== undefined) out.retryAfterMs = retryAfterMs;
    return out;
  } catch {
    // Not JSON. HTML error pages and proxy bodies land here; the caller still
    // gets a status-derived message and the truncated text.
    return {};
  }
}

/**
 * The actionable sentence for a failed Discord call.
 *
 * `retryAfterSeconds` is the header value, used when the body carried no
 * `retry_after` (older gateway versions only send the header).
 */
export function classifyDiscordFailure(
  status: number,
  body: string,
  retryAfterSeconds?: number | string | null
): DiscordFailure {
  const parsed = parseDiscordError(body);
  const headerSeconds = Number(retryAfterSeconds);
  const retryAfterMs =
    parsed.retryAfterMs
    ?? (Number.isFinite(headerSeconds) && headerSeconds >= 0 ? Math.ceil(headerSeconds * 1000) + 250 : undefined);

  const code = parsed.code;

  // What Discord called it, for the log and for the operator who will google it.
  const label = (fallback: string) =>
    parsed.message ? `${parsed.message}${code !== undefined ? `, code ${code}` : ""}` : fallback;

  // A deleted message is not a deleted webhook. Webhooks own their messages, so
  // this is recoverable by posting again — and must never be read as "the
  // webhook is dead", which would disable a board whose channel is healthy.
  if (code === DISCORD_ERROR_CODES.UNKNOWN_MESSAGE) {
    return {
      kind: "message-gone",
      gone: false,
      code,
      message: parsed.message,
      error: `That message no longer exists in Discord (${parsed.message ?? "Unknown Message, code 10008"}) — it will be posted again.`,
    };
  }

  // ── The webhook no longer exists ──────────────────────────────────────────
  // 10015 is what a deleted webhook (or a deleted channel's webhook) answers.
  // 10003 and 50027 are the same class of loss for the channel or token it
  // points at: the panel is holding something that is already gone.
  if (
    code === DISCORD_ERROR_CODES.UNKNOWN_WEBHOOK ||
    code === DISCORD_ERROR_CODES.UNKNOWN_CHANNEL ||
    code === DISCORD_ERROR_CODES.INVALID_WEBHOOK_TOKEN
  ) {
    const rotated = code === DISCORD_ERROR_CODES.INVALID_WEBHOOK_TOKEN;
    return {
      kind: "webhook-gone",
      gone: true,
      code,
      message: parsed.message,
      error:
        // Lead with Discord's own words (so the code is searchable), then the
        // meaning, then the fix. An operator reading a server page should not
        // have to look up 10015.
        `This Discord webhook no longer exists (${label("unknown webhook")}). ` +
        (rotated
          ? "The webhook was re-created in Discord, so the stored URL is stale. "
          : "It was deleted in Discord — or its whole channel was. ") +
        "Paste a new webhook URL for this server, or run “Create missing channels” " +
        "to have the panel create one.",
    };
  }

  switch (status) {
    case 401:
      return {
        kind: "unauthorized",
        gone: false,
        code,
        message: parsed.message,
        error: `Discord rejected the credentials (${label("401 Unauthorized")}). Check the webhook URL or bot token.`,
      };
    case 403:
      return {
        kind: "unauthorized",
        gone: false,
        code,
        message: parsed.message,
        error: `Discord refused the request (${label("403 Forbidden")}) — the bot needs Manage Webhooks in that channel.`,
      };
    case 404:
      // A 404 on a webhook route can only mean the webhook or its channel is
      // gone, even when the body was swallowed by a proxy and carried no code.
      return {
        kind: "webhook-gone",
        gone: true,
        code,
        message: parsed.message,
        error:
          `This Discord webhook no longer exists (${label("404 Not Found")}). ` +
          "It was deleted in Discord — or its whole channel was. " +
          "Paste a new webhook URL for this server, or run “Create missing channels” " +
          "to have the panel create one.",
      };
    case 429: {
      const seconds = retryAfterMs !== undefined ? Math.round(retryAfterMs / 1000) : undefined;
      return {
        kind: "rate-limited",
        gone: false,
        code,
        message: parsed.message,
        retryAfterMs,
        error: `Rate limited by Discord (retry-after: ${seconds !== undefined ? `${seconds}s` : "?"})`,
      };
    }
    default:
      break;
  }

  if (status >= 500) {
    return {
      kind: "server-error",
      gone: false,
      code,
      message: parsed.message,
      error: `Discord is having trouble (${label(`HTTP ${status}`)}) — the notification will be retried on the next event.`,
    };
  }

  if (status === 400) {
    return {
      kind: "bad-request",
      gone: false,
      code,
      message: parsed.message,
      error: `Discord rejected the notification (${label("400 Bad Request")}).`,
    };
  }

  // Not JSON, or a status we have no story for: say what we saw, briefly.
  const detail = parsed.message || body.trim().slice(0, 200) || "no response body";
  return {
    kind: "other",
    gone: false,
    code,
    message: parsed.message,
    error: `Discord API error: ${status} - ${detail}`,
  };
}

/**
 * Whether a stored webhook URL should be treated as dead.
 *
 * Used by the repair paths so that "gone" is decided in exactly one place.
 */
export function isWebhookGone(failure: Pick<DiscordFailure, "gone">): boolean {
  return failure.gone;
}
