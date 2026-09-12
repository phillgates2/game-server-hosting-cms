/**
 * License expiry sweep: the master panel notices expirations itself and
 * notifies (Discord + outbound webhooks) instead of finding out when a
 * customer calls.
 *
 * Pure selection is unit-tested; the orchestrator runs from the scheduler
 * tick on an hourly throttle and marks each notified expiry so a key only
 * ever produces ONE expiry notice per expiry instant.
 */

import { LICENSE_KEY_PREFIX } from "./licensing";

export const LICENSE_EXPIRY_SWEEP_INTERVAL_MS = 60 * 60_000; // hourly

export interface ExpiryCandidate {
  id: number;
  keyPrefix: string;
  label: string | null;
  expiresAtMs: number;
  expiryNotifiedAtMs: number | null;
}

/**
 * Keys whose expiry has passed and that have NOT been notified for this
 * expiry yet (never notified, or last notified before the current expiry —
 * which covers renewals: extend expiresAt and the key becomes eligible for
 * exactly one new notice when it lapses again).
 */
export function findNewlyExpiredKeys(candidates: ExpiryCandidate[], nowMs: number): ExpiryCandidate[] {
  return candidates.filter((k) => {
    if (k.expiresAtMs > nowMs) return false;
    if (k.expiryNotifiedAtMs === null) return true;
    return k.expiryNotifiedAtMs < k.expiresAtMs;
  });
}

/** Shared message for both notification channels. */
export function formatLicenseNotice(kind: "revoked" | "expired", prefix: string, label: string | null): string {
  const who = label ? `${label} (${prefix})` : prefix;
  if (kind === "revoked") {
    return `🔑 License ${who} has been REVOKED. Activations stop validating on their next heartbeat.`;
  }
  return `🔑 License ${who} has EXPIRED. Installations and re-validation will fail until it is renewed.`;
}

/** Deliver both channels, best-effort. */
export async function notifyLicenseEvent(
  kind: "revoked" | "expired",
  prefix: string,
  label: string | null
): Promise<void> {
  const message = formatLicenseNotice(kind, prefix, label);
  try {
    const { fireWebhookEvent } = await import("./webhook-dispatch");
    fireWebhookEvent({
      action: kind === "revoked" ? "license.revoked" : "license.expired",
      entityType: "license",
      details: { prefix, label, message },
    });
  } catch { /* optional channel */ }
  try {
    const { resolveWebhookUrl, isValidWebhookUrl } = await import("./discord");
    const hook = resolveWebhookUrl(null);
    if (hook && isValidWebhookUrl(hook)) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8_000);
      try {
        await fetch(hook, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content: message }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
    }
  } catch { /* Discord down never breaks the panel */ }
}

/** One sweep pass: find newly-expired keys, notify, mark them. */
export async function runLicenseExpirySweep(nowMs: number = Date.now()): Promise<number> {
  const { db } = await import("@/db");
  const { licenseKeys } = await import("@/db/schema");
  const { ensureLicenseTables } = await import("./licensing");
  const { isLicenseMasterMode } = await import("./license-client");
  const { isNull, lt, or, and, eq } = await import("drizzle-orm");

  // Only a master panel issues keys, so only a master panel announces lapses.
  if (!isLicenseMasterMode()) return 0;

  await ensureLicenseTables();
  const rows = await db
    .select({
      id: licenseKeys.id,
      keyPrefix: licenseKeys.keyPrefix,
      label: licenseKeys.label,
      expiresAt: licenseKeys.expiresAt,
      expiryNotifiedAt: licenseKeys.expiryNotifiedAt,
      revokedAt: licenseKeys.revokedAt,
    })
    .from(licenseKeys)
    .where(and(isNull(licenseKeys.revokedAt), lt(licenseKeys.expiresAt, new Date(nowMs))));

  const candidates: ExpiryCandidate[] = rows.map((r) => ({
    id: r.id,
    keyPrefix: r.keyPrefix,
    label: r.label,
    expiresAtMs: new Date(r.expiresAt as unknown as string).getTime(),
    expiryNotifiedAtMs: r.expiryNotifiedAt ? new Date(r.expiryNotifiedAt).getTime() : null,
  }));

  const fresh = findNewlyExpiredKeys(candidates, nowMs);
  for (const key of fresh) {
    await notifyLicenseEvent("expired", key.keyPrefix, key.label);
    await db
      .update(licenseKeys)
      .set({ expiryNotifiedAt: new Date(nowMs) })
      .where(eq(licenseKeys.id, key.id));
  }
  void LICENSE_KEY_PREFIX;
  void or;
  return fresh.length;
}
