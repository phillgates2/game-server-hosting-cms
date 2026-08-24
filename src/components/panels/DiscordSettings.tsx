"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Discord integration settings.
 *
 * Rendered inside the dashboard Settings panel, but saves through its own
 * endpoint rather than the panel's: the bot token is a credential, so it goes
 * to /api/settings/discord (admin only, write-only, never echoed back) instead
 * of /api/site-settings, whose GET is public.
 *
 * That is also why it keeps its own save button — mixing a credential into a
 * bulk save alongside retention numbers would make it far too easy to leak the
 * token into the wrong endpoint later.
 *
 * Declared at module scope so React keeps a stable component type across
 * renders — nesting it would remount the inputs on every keystroke.
 */

interface DiscordConfig {
  panelWebhook: string;
  panelWebhookValid: boolean;
  hasBotToken: boolean;
  guildId: string;
  categoryId: string;
  autoChannel: boolean;
  channelPrefix: string;
  botReady: boolean;
}

const inputCls =
  "w-full px-3 sm:px-4 py-2.5 bg-bg-secondary border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent";

export default function DiscordSettings() {
  const [cfg, setCfg] = useState<DiscordConfig | null>(null);
  const [panelWebhook, setPanelWebhook] = useState("");
  const [botToken, setBotToken] = useState("");
  const [guildId, setGuildId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [channelPrefix, setChannelPrefix] = useState("");
  const [autoChannel, setAutoChannel] = useState(false);
  const [busy, setBusy] = useState<"" | "save" | "test" | "verify">("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/discord");
      if (!res.ok) return;
      const data: DiscordConfig = await res.json();
      setCfg(data);
      setPanelWebhook(data.panelWebhook || "");
      setGuildId(data.guildId || "");
      setCategoryId(data.categoryId || "");
      setChannelPrefix(data.channelPrefix || "");
      setAutoChannel(Boolean(data.autoChannel));
    } catch {
      /* leave the form empty; the save call will surface any real problem */
    }
  }, []);

  const didLoad = useRef(false);
  useEffect(() => {
    // Guarded and deferred: the lint rule (rightly) rejects a synchronous
    // setState inside an effect, and this only ever needs to run once.
    if (didLoad.current) return;
    didLoad.current = true;
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  async function post(body: Record<string, unknown>, kind: "save" | "test" | "verify") {
    setBusy(kind);
    setMsg(null);
    try {
      const res = await fetch("/api/settings/discord", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ kind: "err", text: data.error || "Request failed" });
      } else if (kind === "verify") {
        setMsg({ kind: "ok", text: `✅ Connected to “${data.guildName}”` });
      } else if (kind === "test") {
        setMsg({ kind: "ok", text: "✅ Test message sent — check the channel" });
      } else {
        setMsg({ kind: "ok", text: "✅ Saved" });
        // The token is never returned, so clear the field once it is stored.
        setBotToken("");
        await load();
      }
    } catch (e: unknown) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Request failed" });
    } finally {
      setBusy("");
    }
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = {
      panelWebhook,
      guildId,
      categoryId,
      channelPrefix,
      autoChannel,
    };
    // Only send the token when the admin actually typed one, so saving other
    // fields does not wipe the stored credential.
    if (botToken.trim()) body.botToken = botToken.trim();
    void post(body, "save");
  }

  return (
    <form onSubmit={save} className="space-y-4 sm:space-y-6">
      {/* ── Panel webhook ─────────────────────────────────────────────── */}
      <div className="bg-bg-card border border-border rounded-xl p-4 sm:p-6 space-y-4">
        <div>
          <h3 className="font-semibold text-lg">Panel Webhook</h3>
          <p className="text-xs text-text-muted mt-1">
            Used for any server that has no webhook of its own. Create one in Discord under
            <span className="text-text-secondary"> Server Settings → Integrations → Webhooks</span>.
          </p>
        </div>

        <div>
          <label className="block text-xs text-text-muted mb-1">Webhook URL</label>
          <input
            value={panelWebhook}
            onChange={(e) => setPanelWebhook(e.target.value)}
            placeholder="https://discord.com/api/webhooks/..."
            className={inputCls}
            spellCheck={false}
          />
          {panelWebhook && !/^https:\/\/(canary\.|ptb\.)?discord(app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(panelWebhook.trim()) && (
            <p className="text-[11px] text-warning mt-1">That does not look like a Discord webhook URL.</p>
          )}
        </div>

        <button
          type="button"
          onClick={() => void post({ panelWebhook, action: "test" }, "test")}
          disabled={busy !== "" || !panelWebhook.trim()}
          className="px-4 py-2 bg-accent/15 text-accent rounded-lg text-xs font-medium disabled:opacity-40"
        >
          {busy === "test" ? "Sending…" : "Send Test Message"}
        </button>
      </div>

      {/* ── Bot / auto channels ───────────────────────────────────────── */}
      <div className="bg-bg-card border border-border rounded-xl p-4 sm:p-6 space-y-4">
        <div>
          <h3 className="font-semibold text-lg">Automatic Channels</h3>
          <p className="text-xs text-text-muted mt-1">
            Give each new game server its own Discord channel. This needs a{" "}
            <strong className="text-text-secondary">bot</strong>, not just a webhook — webhooks can only
            post to a channel that already exists, they cannot create one.
          </p>
        </div>

        <details className="text-xs text-text-muted bg-bg-secondary rounded-lg p-3">
          <summary className="cursor-pointer text-text-secondary font-medium">How do I set the bot up?</summary>
          <ol className="mt-2 space-y-1 list-decimal list-inside">
            <li>Open the <span className="text-accent">Discord Developer Portal</span> → New Application.</li>
            <li>Under <em>Bot</em>, click Reset Token and copy it.</li>
            <li>Under <em>OAuth2 → URL Generator</em>, tick <em>bot</em>, then the
              <em> Manage Channels</em> and <em> Manage Webhooks</em> permissions.</li>
            <li>Open the generated URL and invite the bot to your server.</li>
            <li>In Discord, enable <em>Advanced → Developer Mode</em>, then right-click your server
              and <em>Copy Server ID</em>.</li>
          </ol>
        </details>

        <div>
          <label className="block text-xs text-text-muted mb-1">
            Bot Token {cfg?.hasBotToken && <span className="text-success">— a token is saved</span>}
          </label>
          <input
            type="password"
            value={botToken}
            onChange={(e) => setBotToken(e.target.value)}
            placeholder={cfg?.hasBotToken ? "•••••••• (leave blank to keep)" : "Paste the bot token"}
            className={inputCls}
            spellCheck={false}
            autoComplete="new-password"
          />
          <p className="text-[11px] text-text-muted mt-1">
            Stored server-side and never sent back to the browser.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-text-muted mb-1">Server (Guild) ID</label>
            <input value={guildId} onChange={(e) => setGuildId(e.target.value)} placeholder="123456789012345678" className={inputCls} spellCheck={false} />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Category ID (optional)</label>
            <input value={categoryId} onChange={(e) => setCategoryId(e.target.value)} placeholder="Nest new channels here" className={inputCls} spellCheck={false} />
          </div>
        </div>

        <button
          type="button"
          onClick={() => void post({ botToken: botToken.trim() || undefined, guildId, action: "verify" }, "verify")}
          disabled={busy !== "" || (!botToken.trim() && !cfg?.hasBotToken) || !guildId.trim()}
          className="px-4 py-2 bg-accent/15 text-accent rounded-lg text-xs font-medium disabled:opacity-40"
        >
          {busy === "verify" ? "Checking…" : "Verify Bot Connection"}
        </button>

        <div className="border-t border-border pt-4 space-y-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={autoChannel}
              onChange={(e) => setAutoChannel(e.target.checked)}
              className="rounded mt-0.5 w-4 h-4 accent-accent"
            />
            <span>
              <span className="text-sm font-medium">Create a channel for every new server</span>
              <span className="block text-[11px] text-text-muted">
                On creation the panel makes the channel, adds a webhook to it, and uses that webhook
                for all of that server&apos;s notifications. Deleting the server removes the channel.
              </span>
            </span>
          </label>

          <div>
            <label className="block text-xs text-text-muted mb-1">Channel Name Prefix (optional)</label>
            <input value={channelPrefix} onChange={(e) => setChannelPrefix(e.target.value)} placeholder="gs-" className={inputCls} spellCheck={false} />
            <p className="text-[11px] text-text-muted mt-1">
              &ldquo;{channelPrefix}My Server&rdquo; becomes{" "}
              <code className="text-accent">
                #{`${channelPrefix}my-server`.toLowerCase().replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "my-server"}
              </code>
            </p>
          </div>

          {autoChannel && !cfg?.botReady && !botToken.trim() && (
            <p className="text-[11px] text-warning">
              A bot token and server ID are required before channels can be created.
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4">
        <button
          type="submit"
          disabled={busy !== ""}
          className="px-6 py-2.5 bg-success hover:opacity-90 text-white rounded-lg text-sm font-medium disabled:opacity-50 w-full sm:w-auto"
        >
          {busy === "save" ? "Saving…" : "💾 Save Discord Settings"}
        </button>
        {msg && (
          <span className={`text-sm ${msg.kind === "ok" ? "text-success" : "text-danger"}`}>{msg.text}</span>
        )}
      </div>
    </form>
  );
}
