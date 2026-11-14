"use client";

import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/components/ToastProvider";
import { useConfirm } from "@/components/ConfirmDialog";
import { BTN, Badge, INPUT, SectionCard } from "./settingsUi";

interface WebhookState {
  url: string | null;
  secretConfigured: boolean;
  secretMasked: string | null;
}

interface DeliveryLine {
  line: string;
  ok: boolean;
  attempted: boolean;
}

/**
 * Outbound webhook.
 *
 * Now validates the URL before it leaves the browser, keeps the "test" buttons
 * apart from "save" (testing an unsaved URL used to save it as a side effect of
 * the same request), and shows what is actually configured rather than an empty
 * box that could mean either "not set" or "failed to load".
 */
export function WebhookBlock() {
  const toast = useToast();
  const [state, setState] = useState<WebhookState | null>(null);
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [deliveries, setDeliveries] = useState<DeliveryLine[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadDeliveries = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/webhook/deliveries");
      if (res.ok) {
        const data = await res.json().catch(() => null);
        setDeliveries(data?.deliveries ?? []);
      }
    } catch {
      /* the log is a convenience, not a requirement */
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/webhook");
      if (!res.ok) {
        setUnavailable(true);
        return;
      }
      const data = (await res.json()) as WebhookState;
      setState(data);
      setUrl(data.url ?? "");
      await loadDeliveries();
    } catch {
      setUnavailable(true);
    } finally {
      setLoaded(true);
    }
  }, [loadDeliveries]);

  useEffect(() => {
    // Deferred one turn so the mount render finishes before the fetch's
    // first setState — the same pattern the other panels use.
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const trimmedUrl = url.trim();
  const urlValid =
    trimmedUrl === "" ||
    (() => {
      try {
        const parsed = new URL(trimmedUrl);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
      } catch {
        return false;
      }
    })();
  const insecure = trimmedUrl.startsWith("http://");
  // A new signing secret is a change even when the URL is untouched.
  const dirty = trimmedUrl !== (state?.url ?? "") || secret.trim() !== "";

  async function post(payload: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch("/api/settings/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error("Webhook", data?.error || "The request was refused");
        return null;
      }
      await loadDeliveries();
      return data;
    } catch {
      toast.error("Webhook", "Could not reach the panel");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!urlValid) {
      toast.error("Webhook", "That is not a valid http(s) URL.");
      return;
    }
    const data = await post({
      url: trimmedUrl,
      ...(secret.trim() ? { secret: secret.trim() } : {}),
    });
    if (!data) return;
    setState(data);
    setUrl(data.url ?? "");
    setSecret("");
    toast.success(
      "Webhook saved",
      data.url
        ? "Panel events will now be pushed to this endpoint."
        : "Webhook disabled."
    );
  }

  async function test(target: "draft" | "saved") {
    const payload =
      target === "draft"
        ? {
            test: true,
            url: trimmedUrl,
            ...(secret.trim() ? { secret: secret.trim() } : {}),
          }
        : { test: true };
    const data = await post(payload);
    if (!data) return;
    if (data.delivered) {
      toast.success("Test delivered", `Endpoint answered HTTP ${data.status}.`);
    } else {
      toast.warning(
        "Test reached the endpoint",
        `It answered HTTP ${data.status}, which is not a 2xx.`
      );
    }
  }

  async function disable() {
    const data = await post({ url: null });
    if (!data) return;
    setState(data);
    setUrl("");
    setSecret("");
    toast.success("Webhook disabled", "No further events will be pushed.");
  }

  if (!loaded) {
    return (
      <SectionCard icon="📡" title="Endpoint">
        <p className="text-xs text-text-muted">Loading…</p>
      </SectionCard>
    );
  }

  if (unavailable || !state) {
    return (
      <SectionCard
        icon="📡"
        title="Endpoint"
        description="Only full administrators can read or change the outbound webhook."
      >
        <p className="text-xs text-text-muted">
          Your account cannot view this configuration.
        </p>
      </SectionCard>
    );
  }

  return (
    <div className="space-y-5">
      <SectionCard
        icon="📡"
        title="Endpoint"
        description="Every panel event (starts, stops, installs, batches…) is posted as JSON. Deliveries are fire-and-forget and never block the action that caused them; private and loopback addresses are refused."
        actions={
          <Badge tone={state.url ? "success" : "neutral"}>
            {state.url ? "Configured" : "Not configured"}
          </Badge>
        }
      >
        <div className="space-y-3">
          <div>
            <label
              htmlFor="webhook-url"
              className="mb-1 block text-xs font-medium text-text-secondary"
            >
              Endpoint URL
            </label>
            <input
              id="webhook-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://hooks.example.com/gsm"
              spellCheck={false}
              autoComplete="off"
              aria-invalid={!urlValid}
              className={`${INPUT} ${urlValid ? "" : "border-danger focus:ring-danger/40"}`}
            />
            {!urlValid ? (
              <p role="alert" className="mt-1 text-[11px] font-medium text-danger">
                Enter a full http:// or https:// URL.
              </p>
            ) : insecure ? (
              <p className="mt-1 text-[11px] font-medium text-warning">
                ⚠️ http:// sends panel events in clear text. Use https:// unless
                the endpoint is on this machine&apos;s private network.
              </p>
            ) : (
              <p className="mt-1 text-[11px] text-text-muted">
                Leave empty and use Disable to switch the webhook off.
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="webhook-secret"
              className="mb-1 block text-xs font-medium text-text-secondary"
            >
              HMAC signing secret{" "}
              {state.secretConfigured
                ? `(stored: ${state.secretMasked})`
                : "(optional)"}
            </label>
            <input
              id="webhook-secret"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              type="password"
              autoComplete="new-password"
              placeholder={
                state.secretConfigured
                  ? "Leave blank to keep the stored secret"
                  : "Signs every delivery as X-GSM-Signature"
              }
              className={INPUT}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy || !urlValid || !dirty}
              className={BTN.primary}
              title={
                dirty
                  ? "Save this endpoint"
                  : "The saved endpoint already matches this URL"
              }
            >
              {busy ? "Working…" : dirty ? "Save webhook" : "Saved"}
            </button>
            <button
              type="button"
              onClick={() => {
                setUrl(state.url ?? "");
                setSecret("");
              }}
              disabled={busy || !dirty}
              className={BTN.secondary}
            >
              Discard
            </button>
            <button
              type="button"
              onClick={() => void test("draft")}
              disabled={busy || !trimmedUrl || !urlValid}
              className={BTN.secondary}
              title="Send a test event to the URL in the box, without saving it"
            >
              Send test event
            </button>
            {state.url && (
              <>
                <button
                  type="button"
                  onClick={() => void test("saved")}
                  disabled={busy}
                  className={BTN.secondary}
                  title="Send a test event using the stored configuration"
                >
                  Test saved config
                </button>
                <button
                  type="button"
                  onClick={() => void disable()}
                  disabled={busy}
                  className="text-xs text-text-muted hover:text-danger"
                >
                  Disable webhook
                </button>
              </>
            )}
          </div>
          {dirty && (
            <p className="text-[11px] text-accent">
              This URL is not saved yet. “Send test event” uses the box above;
              panel events keep going to the saved endpoint until you save.
            </p>
          )}
        </div>
      </SectionCard>

      <SectionCard
        icon="🧾"
        title="Recent deliveries"
        description="Newest first, kept for the life of this panel process. A red line is a delivery the endpoint refused or that failed outright."
        actions={
          <button
            type="button"
            onClick={() => void loadDeliveries()}
            className={BTN.ghost}
          >
            Refresh
          </button>
        }
      >
        {deliveries.length === 0 ? (
          <p className="text-xs text-text-muted">
            Nothing delivered yet. Events appear here as the panel produces them.
          </p>
        ) : (
          <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border bg-bg-secondary/60 p-3">
            {deliveries.map((delivery, index) => (
              <p
                key={`${delivery.line}-${index}`}
                className={`font-mono text-[11px] break-all ${
                  delivery.attempted && delivery.ok
                    ? "text-success"
                    : delivery.attempted
                      ? "text-danger"
                      : "text-text-muted"
                }`}
              >
                {delivery.line}
              </p>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

/** Copy-to-clipboard snippets for embedding the public status board. */
export function PublicStatusBlock() {
  const toast = useToast();
  const [origin] = useState(() =>
    typeof window !== "undefined" ? window.location.origin : ""
  );
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      window.setTimeout(() => setCopied(null), 2000);
      toast.success("Copied", `${what} copied to the clipboard.`);
    } catch {
      toast.error("Copy failed", "Select the snippet and copy it manually.");
    }
  }

  const iframeSnippet = origin
    ? `<iframe src="${origin}/status" title="Server Status" loading="lazy" style="width:100%;max-width:920px;height:480px;border:0;border-radius:12px;background:#0b1020"></iframe>`
    : "";
  const endpoint = origin ? `${origin}/api/public/status` : "";

  return (
    <div className="space-y-4">
      <SectionCard
        icon="🌐"
        title="Embed on your website"
        description="The board at /status lists every server whose owner switched on “Public listing”. The iframe renders the panel's own page; the JSON endpoint is for your own widget."
      >
        <div className="space-y-3">
          <div>
            <p className="mb-1 text-xs font-medium text-text-secondary">
              Iframe snippet
            </p>
            <div className="flex gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-bg-secondary px-3 py-2 text-[11px] text-text-secondary">
                {iframeSnippet || "Loading…"}
              </code>
              <button
                type="button"
                onClick={() => void copy(iframeSnippet, "Iframe snippet")}
                disabled={!iframeSnippet}
                className={BTN.secondary}
              >
                {copied === "Iframe snippet" ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-text-secondary">
              JSON endpoint
            </p>
            <div className="flex gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-bg-secondary px-3 py-2 text-[11px] text-text-secondary">
                {endpoint || "Loading…"}
              </code>
              <button
                type="button"
                onClick={() => void copy(endpoint, "JSON endpoint")}
                disabled={!endpoint}
                className={BTN.secondary}
              >
                {copied === "JSON endpoint" ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="mt-1 text-[11px] text-text-muted">
              CORS is open on this endpoint, so any site can fetch it and draw
              its own widget.
            </p>
          </div>
          {origin && (
            <a
              href="/status"
              target="_blank"
              rel="noreferrer"
              className="inline-flex text-xs font-medium text-accent hover:underline"
            >
              Open the status page ↗
            </a>
          )}
        </div>
      </SectionCard>
    </div>
  );
}

interface BackfillResult {
  serverId: number;
  serverName: string;
  status: "created" | "recreated" | "repaired" | "ok" | "skipped" | "failed";
  channelName?: string;
  detail?: string;
}

interface BackfillResponse {
  ok: boolean;
  dryRun: boolean;
  scanned: number;
  created: number;
  recreated: number;
  repaired: number;
  alreadyOk: number;
  skipped: number;
  failed: number;
  results: BackfillResult[];
  error?: string;
}

/**
 * Give existing servers a Discord channel.
 *
 * Kept out of the save flow entirely: it is an action, not a setting, and the
 * preview step makes it safe to run on a live guild.
 */
export function DiscordBackfillBlock() {
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BackfillResponse | null>(null);

  async function run(dryRun: boolean) {
    if (!dryRun) {
      const ok = await confirm({
        title: "Create Discord channels",
        message:
          "This creates a channel for every server that has none, and re-creates any channel that was deleted in Discord. Servers with a webhook you entered by hand are left alone.",
        confirmLabel: "Run",
      });
      if (!ok) return;
    }

    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/settings/discord/backfill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun }),
      });
      const data = (await res.json()) as BackfillResponse;
      if (!res.ok) {
        toast.error("Backfill failed", data.error || "Please try again.");
        return;
      }
      setResult(data);
      const parts = [
        data.created && `${data.created} created`,
        data.recreated && `${data.recreated} re-created`,
        data.repaired && `${data.repaired} webhook${data.repaired === 1 ? "" : "s"} repaired`,
        data.alreadyOk && `${data.alreadyOk} already fine`,
        data.skipped && `${data.skipped} skipped`,
        data.failed && `${data.failed} failed`,
      ].filter(Boolean);
      const summary = parts.length ? parts.join(", ") : "Nothing to do.";
      if (data.failed > 0) toast.warning(dryRun ? "Preview" : "Finished", summary);
      else toast.success(dryRun ? "Preview" : "Finished", summary);
    } catch {
      toast.error("Backfill failed", "Could not reach the panel");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard
      id="discord-existing-servers"
      icon="📺"
      title="Existing servers"
      description="New servers get a channel automatically. This gives one to servers that existed before the bot was set up, re-creates channels deleted in Discord, and repairs webhooks deleted inside a channel that still exists — otherwise their notifications go nowhere (Discord reports that as ‘Unknown Webhook’, 10015). A bot token and server ID are required; a webhook alone cannot create channels."
    >
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void run(true)}
            disabled={busy}
            className={BTN.secondary}
          >
            {busy ? "Checking…" : "Preview changes"}
          </button>
          <button
            type="button"
            onClick={() => void run(false)}
            disabled={busy}
            className={BTN.primary}
          >
            {busy ? "Working…" : "Create missing channels"}
          </button>
        </div>

        {result && (
          <div className="overflow-hidden rounded-lg border border-border">
            <div className="bg-bg-secondary px-3 py-2 text-xs text-text-muted">
              {result.dryRun ? "Preview — nothing was changed." : "Result"} ·{" "}
              {result.scanned} server{result.scanned === 1 ? "" : "s"} checked
            </div>
            {result.results.length === 0 ? (
              <p className="px-3 py-3 text-sm text-text-muted">
                No servers found.
              </p>
            ) : (
              <ul className="max-h-72 divide-y divide-border overflow-y-auto">
                {result.results.map((entry) => {
                  const tone =
                    entry.status === "failed"
                      ? "text-danger"
                      : entry.status === "skipped"
                        ? "text-text-muted"
                        : entry.status === "ok"
                          ? "text-text-secondary"
                          : "text-success";
                  const verb =
                    entry.status === "created"
                      ? result.dryRun
                        ? "would create"
                        : "created"
                      : entry.status === "recreated"
                        ? result.dryRun
                          ? "would re-create"
                          : "re-created"
                        : entry.status === "repaired"
                          ? result.dryRun
                            ? "would repair webhook"
                            : "webhook repaired"
                        : entry.status === "ok"
                          ? "already has one"
                          : entry.status === "skipped"
                            ? "skipped"
                            : "failed";
                  return (
                    <li
                      key={entry.serverId}
                      className="flex items-start justify-between gap-3 px-3 py-2 text-sm"
                    >
                      <span className="truncate font-medium">
                        {entry.serverName}
                      </span>
                      <span className={`text-right text-xs ${tone}`}>
                        {verb}
                        {entry.channelName && ` · #${entry.channelName}`}
                        {entry.detail && (
                          <span className="block text-[11px] text-text-muted">
                            {entry.detail}
                          </span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </SectionCard>
  );
}
