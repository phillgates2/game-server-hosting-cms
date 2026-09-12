import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { apiError } from "@/lib/api-error";
import {
  maskWebhookSecret,
  normalizeWebhookSecret,
  validateWebhookUrl,
  buildWebhookPayload,
  signWebhookPayload,
  WEBHOOK_TIMEOUT_MS,
} from "@/lib/outbound-webhook";
import {
  getWebhookConfig,
  upsertSetting,
  WEBHOOK_URL_KEY,
  WEBHOOK_SECRET_KEY,
} from "@/lib/webhook-dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return { auth: null, res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (auth.role !== "admin") return { auth: null, res: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { auth, res: null };
}

// GET — current config (secret masked, never raw)
export async function GET(req: NextRequest) {
  const { auth, res } = await requireAdmin(req);
  if (!auth) return res ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { url, secret } = await getWebhookConfig();
    return NextResponse.json({
      url,
      secretConfigured: secret !== null,
      secretMasked: maskWebhookSecret(secret),
    });
  } catch (e: unknown) {
    return apiError(e, "Could not load the webhook settings", 500);
  }
}

// POST — { url?: string|null, secret?: string|null, test?: boolean }
// test:true delivers a test event to the provided url WITHOUT saving.
export async function POST(req: NextRequest) {
  const { auth, res } = await requireAdmin(req);
  if (!auth) return res ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;

  try {
    if (b.test === true) {
      // No URL supplied? Test the SAVED configuration end to end.
      let testUrl: unknown = b.url;
      let testSecret: unknown = b.secret;
      if (b.url === undefined) {
        const saved = await getWebhookConfig();
        if (!saved.url) {
          return NextResponse.json({ error: "No webhook is configured yet — save one first or pass a url to test." }, { status: 400 });
        }
        testUrl = saved.url;
        testSecret = b.secret === undefined ? saved.secret : b.secret;
      }
      const urlCheck = validateWebhookUrl(testUrl);
      if (!urlCheck.ok || !urlCheck.url) {
        return NextResponse.json({ error: urlCheck.error || "Invalid webhook URL" }, { status: 400 });
      }
      const secretCheck = normalizeWebhookSecret(testSecret === undefined ? null : testSecret);
      if (!secretCheck.ok) {
        return NextResponse.json({ error: secretCheck.error }, { status: 400 });
      }

      const payload = JSON.stringify(
        buildWebhookPayload(
          { action: "webhook.test", details: { message: "GameServer Manager webhook test" } },
          { panel: "GameServer Manager", version: "1.43" },
          new Date().toISOString()
        )
      );
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (secretCheck.secret) headers["x-gsm-signature"] = signWebhookPayload(payload, secretCheck.secret);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
      try {
        const delivered = await fetch(urlCheck.url, {
          method: "POST",
          headers,
          body: payload,
          signal: controller.signal,
        });
        const { recordWebhookDelivery } = await import("@/lib/webhook-delivery-log");
        recordWebhookDelivery({
          atMs: Date.now(),
          action: "webhook.test",
          attempted: true,
          ok: delivered.ok,
          status: delivered.status,
          error: delivered.ok ? null : `HTTP ${delivered.status}`,
        });
        return NextResponse.json({ delivered: delivered.ok, status: delivered.status });
      } catch (e: unknown) {
        return NextResponse.json(
          { error: `The endpoint could not be reached (${e instanceof Error ? e.message : "network error"})` },
          { status: 502 }
        );
      } finally {
        clearTimeout(timeout);
      }
    }

    if (b.url !== undefined) {
      if (b.url === null || b.url === "") {
        await upsertSetting(WEBHOOK_URL_KEY, null);
      } else {
        const urlCheck = validateWebhookUrl(b.url);
        if (!urlCheck.ok || !urlCheck.url) {
          return NextResponse.json({ error: urlCheck.error || "Invalid webhook URL" }, { status: 400 });
        }
        await upsertSetting(WEBHOOK_URL_KEY, urlCheck.url);
      }
    }
    if (b.secret !== undefined) {
      if (b.secret === null || b.secret === "") {
        await upsertSetting(WEBHOOK_SECRET_KEY, null);
      } else {
        const secretCheck = normalizeWebhookSecret(b.secret);
        if (!secretCheck.ok) {
          return NextResponse.json({ error: secretCheck.error }, { status: 400 });
        }
        await upsertSetting(WEBHOOK_SECRET_KEY, secretCheck.secret ?? null);
      }
    }

    const { url, secret } = await getWebhookConfig();
    return NextResponse.json({
      url,
      secretConfigured: secret !== null,
      secretMasked: maskWebhookSecret(secret),
    });
  } catch (e: unknown) {
    return apiError(e, "Could not save the webhook settings", 500);
  }
}
