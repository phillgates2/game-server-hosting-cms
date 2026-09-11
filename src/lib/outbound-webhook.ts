/**
 * Outbound webhooks: push panel events to an operator-owned HTTP endpoint.
 *
 * Pure core (client-safe): URL validation with an SSRF blocklist, payload
 * building and HMAC signing. The db-reading dispatch lives in
 * webhook-dispatch.ts and is only ever imported by server code.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export const WEBHOOK_SECRET_MAX = 200;
export const WEBHOOK_TIMEOUT_MS = 8_000;

/** Hosts/literals that must never receive a webhook (SSRF guard). */
const BLOCKED_HOSTS = new Set([
  "localhost",
  "0.0.0.0",
  "[::]",
  "[::1]",
  "::1",
  "metadata.google.internal",
]);

function isPrivateIp(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, "");
  if (/^127\./.test(bare)) return true;
  if (/^10\./.test(bare)) return true;
  if (/^192\.168\./.test(bare)) return true;
  if (/^169\.254\./.test(bare)) return true; // link-local / cloud metadata
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(bare)) return true;
  if (/^0\./.test(bare)) return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(bare)) return true; // unique-local IPv6
  if (/^fe80:/i.test(bare)) return true; // link-local IPv6
  if (bare === "::") return true;
  return false;
}

/**
 * Only absolute http(s) URLs to non-obviously-internal hosts pass.
 * Hostname privacy is the operator's call — we block the literals and the
 * private ranges, not arbitrary DNS names.
 */
export function validateWebhookUrl(raw: unknown): { ok: boolean; url?: string; error?: string } {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return { ok: false, error: "Webhook URL is required" };
  }
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return { ok: false, error: "That is not a valid URL" };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, error: "Webhook URL must be http(s)" };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: "Do not embed credentials in the webhook URL" };
  }
  const host = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host) || isPrivateIp(host)) {
    return { ok: false, error: "Webhook URL must not point at local or private addresses" };
  }
  return { ok: true, url: parsed.toString() };
}

export interface WebhookEventInput {
  action: string;
  entityType?: string | null;
  entityId?: number | null;
  details?: unknown;
  username?: string | null;
}

/** The JSON body every webhook delivery carries. */
export function buildWebhookPayload(
  event: WebhookEventInput,
  source: { panel: string; version: string },
  nowIso: string
): Record<string, unknown> {
  return {
    source: "game-server-manager",
    panel: source.panel,
    version: source.version,
    timestamp: nowIso,
    event: {
      action: event.action,
      entityType: event.entityType ?? null,
      entityId: event.entityId ?? null,
      details: event.details ?? null,
      username: event.username ?? null,
    },
  };
}

/** HMAC-SHA256 hex of the exact body string, sent as X-GSM-Signature. */
export function signWebhookPayload(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

/** Verify a signature the way a receiving service would (constant time). */
export function verifyWebhookSignature(body: string, secret: string, signature: string): boolean {
  const expected = signWebhookPayload(body, secret);
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Secret hygiene for storage. */
export function normalizeWebhookSecret(raw: unknown): { ok: boolean; secret?: string | null; error?: string } {
  if (raw === undefined || raw === null || raw === "") return { ok: true, secret: null };
  if (typeof raw !== "string") return { ok: false, error: "Secret must be a string" };
  const trimmed = raw.trim();
  if (trimmed.length < 12) return { ok: false, error: "Secret must be at least 12 characters" };
  if (trimmed.length > WEBHOOK_SECRET_MAX) return { ok: false, error: `Secret is limited to ${WEBHOOK_SECRET_MAX} characters` };
  return { ok: true, secret: trimmed };
}

/** Display masking: "secr…abcd". */
export function maskWebhookSecret(secret: string | null | undefined): string | null {
  if (!secret) return null;
  if (secret.length <= 6) return "••••";
  return `${secret.slice(0, 4)}…${secret.slice(-4)}`;
}
