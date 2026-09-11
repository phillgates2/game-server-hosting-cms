/**
 * Webhook delivery. Server-only: reads the operator's webhook config from
 * the settings table and pushes the event fire-and-forget. Delivery must
 * never delay or break the action that produced the event.
 */

import { db } from "@/db";
import { settings } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  buildWebhookPayload,
  signWebhookPayload,
  validateWebhookUrl,
  WEBHOOK_TIMEOUT_MS,
  type WebhookEventInput,
} from "./outbound-webhook";

export const WEBHOOK_URL_KEY = "outbound_webhook_url";
export const WEBHOOK_SECRET_KEY = "outbound_webhook_secret";

export async function getWebhookConfig(): Promise<{ url: string | null; secret: string | null }> {
  const rows = await db
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(eq(settings.key, WEBHOOK_URL_KEY))
    .limit(1);
  const secretRows = await db
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(eq(settings.key, WEBHOOK_SECRET_KEY))
    .limit(1);
  return {
    url: rows[0]?.value ?? null,
    secret: secretRows[0]?.value ?? null,
  };
}

export async function upsertSetting(key: string, value: string | null): Promise<void> {
  const [existing] = await db.select({ id: settings.id }).from(settings).where(eq(settings.key, key)).limit(1);
  if (value === null) {
    if (existing) await db.delete(settings).where(eq(settings.key, key));
    return;
  }
  if (existing) {
    await db.update(settings).set({ value, updatedAt: new Date() }).where(eq(settings.key, key));
  } else {
    await db.insert(settings).values({ key, value });
  }
}

/**
 * Deliver one event. Returns true when a delivery was attempted against a
 * configured, valid URL; callers treat every outcome as informational.
 */
export async function dispatchWebhookEvent(event: WebhookEventInput): Promise<boolean> {
  try {
    const { url, secret } = await getWebhookConfig();
    if (!url) return false;
    const valid = validateWebhookUrl(url);
    if (!valid.ok || !valid.url) return false;

    const body = JSON.stringify(
      buildWebhookPayload(event, { panel: "GameServer Manager", version: "1.43" }, new Date().toISOString())
    );
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (secret) headers["x-gsm-signature"] = signWebhookPayload(body, secret);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
    try {
      await fetch(valid.url, { method: "POST", headers, body, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    return true;
  } catch {
    return false;
  }
}

/** Fire-and-forget wrapper for hot paths (audit writes, process control). */
export function fireWebhookEvent(event: WebhookEventInput): void {
  void dispatchWebhookEvent(event).catch(() => undefined);
}
