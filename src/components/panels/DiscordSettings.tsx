"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowRight, BookOpen, MessagesSquare, RefreshCw, Save, X } from "lucide-react";
import { useConfirm } from "@/components/ConfirmDialog";
import { BTN, Badge, INPUT, SectionCard } from "@/components/settings/settingsUi";
import { CopyValue, DiscordGuide, PortalLink, type DiscordNavigate } from "@/components/settings/DiscordGuide";
import { DiscordStatusBoards } from "@/components/settings/DiscordStatusBoards";
import { fetchWithTimeout, messageForStatus, mutate } from "@/lib/api-client";
import {
  DISCORD_FORM_TABS,
  discordChannelPreview,
  discordFormChanges,
  discordFormFromConfig,
  discordFormPayload,
  validateDiscordForm,
  type DiscordConfigResponse,
  type DiscordFormField,
  type DiscordFormValues,
  type DiscordSettingsTab,
} from "@/lib/discord-form";

/**
 * Discord settings, split by job rather than stacked into one credential form.
 * Configuration is staged across tabs and saved through the admin-only Discord
 * endpoint. Status-board controls remain immediate actions with their own Apply
 * button. Bot/OAuth secrets are never read back from the API.
 */
export default function DiscordSettings({ children }: { children?: ReactNode }) {
  const confirm = useConfirm();
  const [cfg, setCfg] = useState<DiscordConfigResponse | null>(null);
  const [form, setForm] = useState<DiscordFormValues | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<DiscordSettingsTab>("guide");
  const [busy, setBusy] = useState<"" | "save" | "test" | "verify">("");
  const [statusBusy, setStatusBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "ok" | "err" | "info"; text: string } | null>(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [inviteAppId, setInviteAppId] = useState("");
  const [includeEtCommands, setIncludeEtCommands] = useState(false);
  const [origin] = useState(() => typeof window === "undefined" ? "" : window.location.origin);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const load = useCallback(async (signal?: AbortSignal, initial = false) => {
    if (initial) setLoading(true);
    setLoadError(null);
    try {
      const res = await fetchWithTimeout("/api/settings/discord", { cache: "no-store", signal });
      const data = await res.json().catch(() => null);
      if (signal?.aborted) return false;
      if (!res.ok || !data || typeof data.hasBotToken !== "boolean") {
        setLoadError(messageForStatus(res.ok ? 500 : res.status, data?.error));
        return false;
      }
      setCfg(data);
      setForm(discordFormFromConfig(data));
      return true;
    } catch {
      if (!signal?.aborted) setLoadError("Could not load Discord settings. Check your connection and try again.");
      return false;
    } finally {
      if (initial && !signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => void load(controller.signal, true), 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [load]);

  const savedForm = useMemo(() => cfg ? discordFormFromConfig(cfg) : null, [cfg]);
  const changes = useMemo(() => form && savedForm ? discordFormChanges(form, savedForm) : [], [form, savedForm]);
  const errors = useMemo(() => form ? validateDiscordForm(form) : {}, [form]);
  const visibleErrors = submitAttempted ? errors : Object.fromEntries(
    Object.entries(errors).filter(([key]) => {
      const value = form?.[key as DiscordFormField];
      return key === "panelWebhook" || (typeof value === "string" && value.trim());
    })
  );

  useEffect(() => {
    if (!changes.length) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [changes.length]);

  useEffect(() => {
    if (!focusTarget) return;
    const timer = setTimeout(() => {
      const target = document.getElementById(focusTarget);
      target?.scrollIntoView({ block: "center", behavior: "smooth" });
      target?.focus({ preventScroll: true });
      setFocusTarget(null);
    }, 80);
    return () => clearTimeout(timer);
  }, [focusTarget, tab]);

  // Keep the selected pill visible when a guide/summary link jumps to a tab
  // that is off-screen in the horizontal strip on phones.
  useEffect(() => {
    tabRefs.current[tab]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [tab]);

  const navigate: DiscordNavigate = (nextTab, focusId) => {
    setTab(nextTab);
    setFocusTarget(focusId ?? null);
  };

  function patch(key: DiscordFormField, value: string | boolean) {
    setForm((previous) => previous ? { ...previous, [key]: value } : previous);
  }

  function fieldProps(key: DiscordFormField) {
    return {
      id: `discord-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`,
      value: String(form?.[key] ?? ""),
      onChange: (value: string) => patch(key, value),
      error: visibleErrors[key],
      disabled: busy !== "",
    };
  }

  async function refreshBotStatus() {
    setStatusBusy(true);
    try {
      const res = await fetchWithTimeout("/api/settings/discord", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setFeedback({ kind: "err", text: messageForStatus(res.status, data?.error) });
        return;
      }
      // Status refresh must never replace a credential the admin is editing.
      setCfg((previous) => previous ? { ...previous, bot: data.bot } : previous);
    } catch {
      setFeedback({ kind: "err", text: "Could not refresh the bot status. Check your connection." });
    } finally {
      setStatusBusy(false);
    }
  }

  async function check(kind: "test" | "verify") {
    if (!form) return;
    if (kind === "test" && errors.panelWebhook) {
      setSubmitAttempted(true);
      navigate("notifications", "discord-panel-webhook");
      return;
    }
    if (kind === "verify" && errors.guildId) {
      setSubmitAttempted(true);
      navigate("bot", "discord-guild-id");
      return;
    }
    setBusy(kind);
    setFeedback(null);
    const body = kind === "test"
      ? { action: "test", panelWebhook: form.panelWebhook }
      : { action: "verify", botToken: form.botToken.trim() || undefined, guildId: form.guildId };
    const result = await mutate<{ guildName?: string; error?: string }>("/api/settings/discord", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!result.ok) {
      setFeedback({ kind: "err", text: result.error || "The check failed." });
    } else if (kind === "verify") {
      setFeedback({ kind: "ok", text: `Connected to “${result.data?.guildName || "your Discord server"}”. Server access is working; the chat bot’s gateway status is shown separately below.` });
      void refreshBotStatus();
    } else {
      const unsaved = changes.some((change) => change.key === "panelWebhook");
      setFeedback({ kind: "ok", text: `Test message sent to the URL in the field. Check Discord.${unsaved ? " Save changes to use this URL for notifications." : ""}` });
    }
    setBusy("");
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form || busy) return;
    if (Object.keys(errors).length) {
      setSubmitAttempted(true);
      const first = Object.keys(errors)[0] as DiscordFormField;
      const destination = DISCORD_FORM_TABS.find((entry) => entry.id === (first === "panelWebhook" ? "notifications" : first.startsWith("oauth") ? "signin" : "bot"));
      navigate(destination?.id ?? "bot", fieldProps(first).id);
      setFeedback({ kind: "err", text: "Fix the highlighted fields before saving." });
      return;
    }
    if (!changes.length) {
      setFeedback({ kind: "info", text: "Everything already matches the saved configuration." });
      return;
    }
    setBusy("save");
    setFeedback(null);
    const result = await mutate("/api/settings/discord", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(discordFormPayload(form, changes)),
    });
    if (!result.ok) {
      setFeedback({ kind: "err", text: result.error || "Could not save. Your changes are still here." });
    } else {
      // The POST succeeded even if the follow-up GET fails: never leave a
      // just-saved secret sitting in the draft while the operator retries.
      setForm((previous) => previous ? { ...previous, botToken: "", oauthClientSecret: "" } : previous);
      const refreshed = await load();
      setRevision((value) => value + 1);
      setSubmitAttempted(false);
      setFeedback(refreshed
        ? { kind: "ok", text: "Discord settings saved. Your changes are now active." }
        : { kind: "info", text: "Settings were saved, but the page could not refresh. Retry loading before making more changes." });
      void refreshBotStatus();
    }
    setBusy("");
  }

  async function discard() {
    if (!cfg || !changes.length || busy) return;
    const ok = await confirm({
      title: "Discard Discord changes?",
      message: `${changes.length} unsaved change${changes.length === 1 ? "" : "s"} will be reverted. Saved credentials will not be removed.`,
      confirmLabel: "Discard changes",
      danger: true,
    });
    if (!ok) return;
    setForm(discordFormFromConfig(cfg));
    setSubmitAttempted(false);
    setFeedback({ kind: "info", text: "Unsaved changes discarded." });
  }

  function tabKeyDown(event: React.KeyboardEvent, index: number) {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % DISCORD_FORM_TABS.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + DISCORD_FORM_TABS.length) % DISCORD_FORM_TABS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = DISCORD_FORM_TABS.length - 1;
    else return;
    event.preventDefault();
    const id = DISCORD_FORM_TABS[next].id;
    setTab(id);
    tabRefs.current[id]?.focus();
  }

  if (loading && !form) {
    return <div className="space-y-4" aria-busy="true" aria-label="Loading Discord settings"><div className="h-32 animate-pulse rounded-xl border border-border bg-bg-card" /><div className="h-12 animate-pulse rounded-xl bg-bg-card" /><div className="h-64 animate-pulse rounded-xl border border-border bg-bg-card" /><p className="text-xs text-text-muted">Loading Discord settings…</p></div>;
  }

  if (!form || !cfg) {
    return <SectionCard icon="🔌" title="Discord settings unavailable" description={loadError || "The panel did not return a configuration."}><button type="button" onClick={() => void load(undefined, true)} className={BTN.primary}>Try again</button></SectionCard>;
  }

  const credentialsReady = cfg.botReady || Boolean(form.botToken.trim() && form.guildId.trim());
  const redirectUrl = origin ? `${origin}/api/auth/discord/callback` : "/api/auth/discord/callback";
  const summaries = [
    { tab: "notifications" as const, label: "Notifications", value: cfg.panelWebhookValid ? "Configured" : "Not configured", hint: "Panel webhook", ready: cfg.panelWebhookValid },
    { tab: "bot" as const, label: "Chat bot", value: cfg.bot?.state === "online" ? "Online" : cfg.botReady ? "Credentials saved" : "Not configured", hint: cfg.bot?.state === "online" ? "Gateway connected" : "Bot & automatic channels", ready: cfg.bot?.state === "online" },
    { tab: "signin" as const, label: "Discord sign-in", value: cfg.oauthConfigured ? "Enabled" : "Not configured", hint: "OAuth application", ready: cfg.oauthConfigured },
  ];

  return (
    <div className="space-y-5">
      <div className="overflow-hidden rounded-xl border border-[#5865F2]/30 bg-gradient-to-br from-[#5865F2]/10 via-bg-card to-bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#5865F2] text-white shadow-lg shadow-[#5865F2]/20"><MessagesSquare size={23} aria-hidden /></span>
            <div>
              <h3 className="text-base font-semibold sm:text-lg">Your servers, in your community</h3>
              <p className="mt-1 max-w-xl text-xs leading-relaxed text-text-secondary">Notifications, live status and Discord sign-in. Follow the guide, connect only what you need, and test it before you finish.</p>
            </div>
          </div>
          {tab !== "guide" && <button type="button" onClick={() => navigate("guide")} className={`${BTN.secondary} inline-flex items-center gap-2`}><BookOpen size={14} aria-hidden />Setup guide</button>}
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {summaries.map((item) => (
            <button key={item.tab} type="button" onClick={() => navigate(item.tab)} className="rounded-lg border border-border/70 bg-bg-secondary/60 p-3 text-left transition-colors hover:border-accent/40">
              <span className="flex items-center justify-between gap-2 text-[11px] text-text-muted">{item.label}<ArrowRight size={12} aria-hidden /></span>
              <span className="mt-1 flex items-center gap-1.5 text-xs font-medium"><span className={`h-1.5 w-1.5 rounded-full ${item.ready ? "bg-success" : "bg-text-muted"}`} aria-hidden />{item.value}</span>
              <span className="mt-0.5 block text-[10px] text-text-muted">{item.hint}</span>
            </button>
          ))}
        </div>
      </div>

      {loadError && <p role="alert" className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs text-warning">{loadError} <button type="button" onClick={() => void load()} className="underline">Retry loading</button></p>}

      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <div role="tablist" aria-label="Discord settings" className="flex min-w-max gap-1 rounded-xl border border-border bg-bg-secondary/60 p-1">
          {DISCORD_FORM_TABS.map((entry, index) => {
            const active = tab === entry.id;
            const count = changes.filter((change) => change.tab === entry.id).length;
            return (
              <button
                key={entry.id}
                ref={(node) => { tabRefs.current[entry.id] = node; }}
                type="button"
                role="tab"
                id={`discord-tab-${entry.id}`}
                aria-selected={active}
                aria-controls={`discord-panel-${entry.id}`}
                tabIndex={active ? 0 : -1}
                onClick={() => setTab(entry.id)}
                onKeyDown={(event) => tabKeyDown(event, index)}
                className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${active ? "bg-bg-card text-accent shadow-sm ring-1 ring-border" : "text-text-muted hover:bg-bg-hover hover:text-text-primary"}`}
              >
                {entry.label}
                {count > 0 && <span className="rounded-full bg-accent/15 px-1.5 text-[10px] text-accent" aria-label={`${count} unsaved changes`}>{count}</span>}
              </button>
            );
          })}
        </div>
      </div>

      <form id="discord-settings-form" onSubmit={(event) => void save(event)}>
        <div role="tabpanel" id={`discord-panel-${tab}`} aria-labelledby={`discord-tab-${tab}`} tabIndex={0} className="space-y-5 outline-none">
          {tab === "guide" && <DiscordGuide applicationId={inviteAppId} onApplicationIdChange={setInviteAppId} includeEtCommands={includeEtCommands} onIncludeEtCommandsChange={setIncludeEtCommands} onNavigate={navigate} />}

          {tab === "notifications" && (
            <SectionCard icon="🔔" title="Panel notifications" description="The fallback destination for servers without their own webhook. A server-specific webhook always takes priority." actions={<Badge tone={cfg.panelWebhookValid ? "success" : "neutral"}>{cfg.panelWebhookValid ? "Configured" : "Not configured"}</Badge>}>
              <DiscordField {...fieldProps("panelWebhook")} label="Panel webhook URL" placeholder="https://discord.com/api/webhooks/…" hint="Paste the full URL from Discord. Leave empty and save to remove the panel-wide fallback." autoComplete="off" />
              <details open={!cfg.panelWebhook} className="rounded-lg border border-border bg-bg-secondary/50 p-3 text-xs">
                <summary className="cursor-pointer font-medium text-text-secondary">How to create a webhook in Discord</summary>
                <ol className="mt-2 list-inside list-decimal space-y-1.5 leading-relaxed text-text-muted">
                  <li>Open the destination text channel and choose <strong>Edit Channel</strong>.</li>
                  <li>Go to <strong>Integrations → Webhooks → New Webhook</strong>. Give it a name and confirm the channel.</li>
                  <li>Choose <strong>Copy Webhook URL</strong>, paste it above, and press <strong>Save changes</strong>.</li>
                  <li>Press <strong>Send test message</strong> and check that it appears in Discord.</li>
                </ol>
              </details>
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" onClick={() => void check("test")} disabled={busy !== "" || !form.panelWebhook.trim() || Boolean(errors.panelWebhook)} className={BTN.secondary}>{busy === "test" ? "Sending…" : "Send test message"}</button>
                <p className="text-[11px] text-text-muted">Tests the URL in the field without saving it. A test does not change where notifications go.</p>
              </div>
              <div className="rounded-lg border border-border bg-bg-secondary/30 p-3 text-[11px] leading-relaxed text-text-muted">
                <strong className="text-text-secondary">Where will notifications go?</strong> A server’s own webhook first; otherwise this panel webhook. To dedicate a channel to each server, connect a bot and create channels automatically.
                <button type="button" onClick={() => navigate("bot", "discord-guild-id")} className="ml-1 text-accent hover:underline">Set up channels →</button>
              </div>
            </SectionCard>
          )}

          {tab === "bot" && (
            <>
              <SectionCard icon="🤖" title="Bot connection" description="The bot creates channels and runs the WolfET chat commands. A webhook alone cannot do either." actions={<PortalLink>Developer Portal</PortalLink>}>
                <DiscordField {...fieldProps("botToken")} label="Bot token" type="password" placeholder={cfg.hasBotToken ? "Leave blank to keep the saved token" : "Paste the token from the Bot page"} hint={cfg.hasBotToken ? "A token is saved. It is never sent back to the browser; a new token replaces it only when you save." : "Find this in Developer Portal → your application → Bot → Reset Token. Not the client secret."} autoComplete="new-password" labelExtra={cfg.hasBotToken ? <Badge tone="success">Saved</Badge> : undefined} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <DiscordField {...fieldProps("guildId")} label="Discord server (guild) ID" placeholder="123456789012345678" hint="Enable Developer Mode in Discord, then right-click the server → Copy Server ID." inputMode="numeric" />
                  <DiscordField {...fieldProps("categoryId")} label="Category ID (optional)" placeholder="Leave empty for no category" hint="Right-click a category → Copy Category ID. New channels will be grouped there." inputMode="numeric" />
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button type="button" onClick={() => void check("verify")} disabled={busy !== "" || (!form.botToken.trim() && !cfg.hasBotToken) || !form.guildId.trim() || Boolean(errors.guildId)} className={BTN.secondary}>{busy === "verify" ? "Checking…" : "Verify bot connection"}</button>
                  <p className="text-[11px] text-text-muted">Checks the token and server ID in the fields. Save changes to activate them.</p>
                </div>
                {!form.botToken.trim() && !cfg.hasBotToken && <p className="text-[11px] text-text-muted">No token entered. Follow the <button type="button" onClick={() => navigate("guide", "discord-invite-app-id")} className="text-accent hover:underline">setup guide</button> to create and invite your bot.</p>}
                {cfg.bot && <ChatBotStatus bot={cfg.bot} busy={statusBusy} onRefresh={() => void refreshBotStatus()} />}
              </SectionCard>

              <SectionCard icon="📺" title="Automatic channels" description="Give each new game server a channel and its own webhook. Existing servers are handled separately below.">
                <button type="button" role="switch" aria-checked={form.autoChannel} aria-describedby="discord-auto-channel-hint" disabled={busy !== ""} onClick={() => patch("autoChannel", !form.autoChannel)} className={`flex w-full items-start gap-3 rounded-lg border p-4 text-left transition-colors ${form.autoChannel ? "border-accent/40 bg-accent/5" : "border-border bg-bg-secondary/40"}`}>
                  <span aria-hidden className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 rounded-full ${form.autoChannel ? "bg-success" : "bg-bg-hover"}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${form.autoChannel ? "left-[18px]" : "left-0.5"}`} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2 text-sm font-medium">Create a channel for every new server<Badge tone={form.autoChannel ? "success" : "neutral"}>{form.autoChannel ? "On" : "Off"}</Badge>{form.autoChannel !== cfg.autoChannel && <Badge tone="accent">Unsaved</Badge>}</span>
                    <span id="discord-auto-channel-hint" className="mt-1 block text-[11px] leading-relaxed text-text-muted">On creation, the panel creates the channel and webhook. Deleting that game server also removes the channel. This setting does not create channels for servers that already exist.</span>
                  </span>
                </button>
                {form.autoChannel && !credentialsReady && <p className="text-[11px] text-warning">You can stage this setting, but channels need a saved bot token and Discord server ID before they can be created.</p>}
                <DiscordField {...fieldProps("channelPrefix")} label="Channel name prefix (optional)" placeholder="gs-" hint={<>“My Game Server” becomes <code className="text-accent">{discordChannelPreview(form.channelPrefix)}</code>. Names are lowercased, spaces become dashes, and Discord’s 100-character limit applies.</>} />
              </SectionCard>

              {children}

              <details className="rounded-xl border border-border bg-bg-card p-4 sm:p-5">
                <summary className="cursor-pointer text-sm font-semibold">WolfET chat commands & server discovery</summary>
                <div className="mt-4 space-y-4">
                  <p className="text-xs leading-relaxed text-text-secondary">With the bot connected, use <code className="text-accent">!etwho</code>, <code className="text-accent">!etallofoz</code>, <code className="text-accent">!stats &lt;player&gt;</code>, <code className="text-accent">!ettop10</code>, <code className="text-accent">!etverify &lt;GUID&gt;</code> (DM only), <code className="text-accent">!etsync</code> and <code className="text-accent">!desync</code>. Verified users can have their XP synced into their nickname every ten minutes.</p>
                  <p className="rounded-lg border border-warning/25 bg-warning/5 p-3 text-[11px] leading-relaxed text-text-secondary">Enable <strong>Server Members Intent</strong> and <strong>Message Content Intent</strong> in the portal’s Bot → Privileged Gateway Intents. Nickname sync also needs Manage Nicknames and a bot role above the target member. XP comes from the ET server’s <code>user.sqlite</code>; override with <code>GSM_ET_USER_SQLITE</code>. Disable the gateway with <code>GSM_DISABLE_DISCORD_BOT=true</code>.</p>
                  <DiscordField {...fieldProps("extraServers")} label="Extra ET servers for !etallofoz" multiline rows={3} placeholder={"203.44.23.44:27960\nfriends-server.duckdns.org:27960:27961"} hint={<>Servers not installed in this panel. One <code>host:port</code> per line; append <code>:queryPort</code> if different. <code>#</code> starts a comment. Also available as <code>GSM_ET_EXTRA_SERVERS</code>.</>} />
                  <DiscordField {...fieldProps("masterUrls")} label="Master servers for discovery (optional)" placeholder="master0.etmaster.net, master.etlegacy.com" hint={<>Comma- or space-separated host[:port] entries queried by !etallofoz. Discovered servers are marked 🌐, capped at 25 and deduplicated against panel servers. Clear to disable discovery. Also available as <code>GSM_ET_MASTER_URLS</code>.</>} />
                </div>
              </details>
            </>
          )}

          {tab === "boards" && <DiscordStatusBoards botReady={cfg.botReady} revision={revision} onNavigate={navigate} />}

          {tab === "signin" && (
            <SectionCard icon="🔑" title="Sign in with Discord" description="Optional passwordless sign-in for existing accounts. This uses an OAuth application and is separate from the notification webhook." actions={<Badge tone={cfg.oauthConfigured ? "success" : "neutral"}>{cfg.oauthConfigured ? "Enabled" : "Not configured"}</Badge>}>
              <ol className="list-inside list-decimal space-y-2 rounded-lg border border-border bg-bg-secondary/50 p-3 text-xs leading-relaxed text-text-secondary">
                <li>Open the <PortalLink>Developer Portal</PortalLink> and create an application (or use the same application as your bot).</li>
                <li>Copy its <strong>Client ID</strong> and <strong>Client Secret</strong> from OAuth2 into the fields below.</li>
                <li>In <strong>OAuth2 → Redirects</strong>, add the exact redirect URL below and save in Discord.</li>
                <li>Press <strong>Save changes</strong> here. Both credentials are required to enable sign-in.</li>
              </ol>
              <div className="grid gap-4 sm:grid-cols-2">
                <DiscordField {...fieldProps("oauthClientId")} label="Client ID" placeholder="123456789012345678" hint="The numeric application ID from General Information / OAuth2." inputMode="numeric" />
                <DiscordField {...fieldProps("oauthClientSecret")} label="Client secret" type="password" placeholder={cfg.oauthConfigured ? "Leave blank to keep the saved secret" : "Paste the OAuth client secret"} hint="Write-only. A saved secret is never shown again. This is not the bot token." autoComplete="new-password" labelExtra={cfg.oauthConfigured ? <Badge tone="success">Saved</Badge> : undefined} />
              </div>
              <CopyValue id="discord-oauth-redirect" label="Redirect URL — add this exact value in Discord" value={redirectUrl} hint="Use the public HTTPS address of this panel. The path must be /api/auth/discord/callback." />
              <div className="space-y-2 rounded-lg border border-border bg-bg-secondary/30 p-3 text-[11px] leading-relaxed text-text-muted">
                <p><strong className="text-text-secondary">Scopes:</strong> <code>identify email</code>. Accounts are matched by verified Discord email.</p>
                <p><strong className="text-text-secondary">Security:</strong> accounts with 2FA still use password + code. While age verification is on, Discord sign-in is for existing accounts only; new accounts must register with a date of birth.</p>
              </div>
            </SectionCard>
          )}
        </div>
      </form>

      {(changes.length > 0 || busy === "save" || feedback) && (
        <div className="sticky bottom-3 z-20 space-y-2 rounded-xl border border-border bg-bg-card/95 p-3 shadow-xl backdrop-blur sm:p-4">
          {feedback && <div className={`flex items-start justify-between gap-3 text-xs ${feedback.kind === "ok" ? "text-success" : feedback.kind === "err" ? "text-danger" : "text-text-secondary"}`}><p role={feedback.kind === "err" ? "alert" : "status"} className="min-w-0 flex-1 leading-relaxed">{feedback.text}</p><button type="button" onClick={() => setFeedback(null)} aria-label="Dismiss message" className={BTN.ghost}><X size={14} aria-hidden /></button></div>}
          {(changes.length > 0 || busy === "save") && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-2 first:border-0 first:pt-0"><div><p className="text-sm font-medium">{changes.length} unsaved change{changes.length === 1 ? "" : "s"}</p><p className="mt-0.5 text-[11px] text-text-muted">Across Discord tabs · nothing is active until you save.</p></div><div className="flex items-center gap-2"><button type="button" onClick={() => void discard()} disabled={busy !== ""} className={BTN.secondary}>Discard</button><button type="submit" form="discord-settings-form" disabled={busy !== ""} className={`${BTN.success} inline-flex items-center gap-2`}><Save size={14} aria-hidden />{busy === "save" ? "Saving…" : "Save changes"}</button></div></div>}
        </div>
      )}
    </div>
  );
}

function DiscordField({ id, label, value, onChange, hint, error, disabled, type = "text", placeholder, autoComplete = "off", inputMode, multiline = false, rows = 3, labelExtra }: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: ReactNode;
  error?: string;
  disabled?: boolean;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  inputMode?: "numeric" | "text";
  multiline?: boolean;
  rows?: number;
  labelExtra?: ReactNode;
}) {
  const shared = {
    id,
    value,
    placeholder,
    disabled,
    autoComplete,
    spellCheck: false,
    "aria-invalid": Boolean(error),
    "aria-describedby": `${id}-hint${error ? ` ${id}-error` : ""}`,
    className: `${INPUT} mt-1 ${error ? "border-danger focus:ring-danger/40" : ""} ${multiline ? "font-mono text-xs" : ""}`,
  };
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2"><label htmlFor={id} className="block text-xs font-medium text-text-secondary">{label}</label>{labelExtra}</div>
      {multiline ? <textarea {...shared} rows={rows} onChange={(event) => onChange(event.target.value)} /> : <input {...shared} type={type} inputMode={inputMode} onChange={(event) => onChange(event.target.value)} />}
      {hint && <p id={`${id}-hint`} className="mt-1 text-[11px] leading-relaxed text-text-muted">{hint}</p>}
      {error && <p id={`${id}-error`} role="alert" className="mt-1 text-[11px] font-medium text-danger">{error}</p>}
    </div>
  );
}

function ChatBotStatus({ bot, busy, onRefresh }: { bot: NonNullable<DiscordConfigResponse["bot"]>; busy: boolean; onRefresh: () => void }) {
  const views: Record<typeof bot.state, { dot: string; tone: string; title: string; hint: string }> = {
    online: { dot: "bg-success", tone: "border-success/30 bg-success/5", title: `Chat bot online${bot.tag ? ` as ${bot.tag}` : ""}`, hint: bot.commandsHandled > 0 ? `${bot.commandsHandled} command${bot.commandsHandled === 1 ? "" : "s"} received since connecting.` : "Connected and listening. If commands get no reply, check channel permissions and Message Content Intent." },
    connecting: { dot: "bg-warning", tone: "border-warning/30 bg-warning/5", title: "Chat bot connecting…", hint: bot.error || "Logging in to Discord. Refresh in a moment." },
    error: { dot: "bg-danger", tone: "border-danger/30 bg-danger/5", title: "Chat bot is not connected", hint: bot.error || "The last login attempt failed. The panel retries every minute; check the token and privileged intents." },
    unconfigured: { dot: "bg-text-muted", tone: "border-border bg-bg-secondary", title: "Chat bot not configured", hint: "Save a bot token and Discord server ID to start the command bot." },
    stopped: { dot: "bg-text-muted", tone: "border-border bg-bg-secondary", title: "Chat bot is not running", hint: "It starts with the panel. If this persists, check GSM_DISABLE_AUTOSTART and the panel logs." },
    disabled: { dot: "bg-text-muted", tone: "border-border bg-bg-secondary", title: "Chat bot disabled", hint: "GSM_DISABLE_DISCORD_BOT=true is set in the panel environment." },
  };
  const view = views[bot.state] ?? views.stopped;
  return (
    <div role="status" className={`rounded-lg border p-3 text-xs ${view.tone}`}>
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="flex items-center gap-2 font-medium"><span className={`h-2 w-2 rounded-full ${view.dot}`} aria-hidden />{view.title}</p><button type="button" onClick={onRefresh} disabled={busy} className={`${BTN.ghost} inline-flex items-center gap-1.5`}><RefreshCw size={12} aria-hidden />{busy ? "Refreshing…" : "Refresh status"}</button></div>
      <p className="mt-1 break-words leading-relaxed text-text-secondary">{view.hint}</p>
      {bot.lastCommandAt && <p className="mt-1 text-[10px] text-text-muted">Last command: {new Date(bot.lastCommandAt).toLocaleString()}</p>}
    </div>
  );
}
