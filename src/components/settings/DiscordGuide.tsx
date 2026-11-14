"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Bell, Bot, Check, Copy, ExternalLink, KeyRound, ShieldCheck } from "lucide-react";
import { BTN, Badge, INPUT, SectionCard } from "./settingsUi";
import { discordBotInviteUrl, type DiscordSettingsTab } from "@/lib/discord-form";

export type DiscordNavigate = (tab: DiscordSettingsTab, focusId?: string) => void;

const PORTAL = "https://discord.com/developers/applications";

export function PortalLink({ children = "Open Discord Developer Portal" }: { children?: ReactNode }) {
  return (
    <a href={PORTAL} target="_blank" rel="noopener noreferrer" className={`${BTN.secondary} inline-flex items-center gap-2`}>
      {children}<ExternalLink size={14} aria-hidden />
    </a>
  );
}

/** Read-only, selectable value with a clipboard button and a manual fallback. */
export function CopyValue({ id, label, value, hint }: { id: string; label: string; value: string; hint?: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setStatus("copied");
    } catch {
      setStatus("error");
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus("idle"), 3000);
  }

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-text-secondary">{label}</label>
      <div className="flex items-stretch gap-2">
        <input
          id={id}
          readOnly
          value={value}
          onFocus={(e) => e.currentTarget.select()}
          className={`${INPUT} min-w-0 flex-1 font-mono text-xs`}
          aria-describedby={hint ? `${id}-hint` : undefined}
        />
        <button type="button" onClick={() => void copy()} disabled={!value} className={`${BTN.secondary} inline-flex shrink-0 items-center gap-1.5`} aria-label={`Copy ${label}`}>
          {status === "copied" ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
          <span className="hidden sm:inline">{status === "copied" ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <span className="sr-only" role="status">{status === "copied" ? `${label} copied to clipboard` : ""}</span>
      {status === "error" && <p role="status" className="mt-1 text-[11px] text-warning">Clipboard unavailable. Select the value above and copy it manually.</p>}
      {hint && <p id={`${id}-hint`} className="mt-1 text-[11px] leading-relaxed text-text-muted">{hint}</p>}
    </div>
  );
}

function SetupStep({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <li className="group relative flex gap-3 pb-6 last:pb-0">
      <div className="flex flex-col items-center" aria-hidden>
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-accent/30 bg-accent/10 text-xs font-semibold text-accent">{number}</span>
        <span className="mt-2 w-px flex-1 bg-border group-last:hidden" />
      </div>
      <div className="min-w-0 flex-1 pt-1">
        <h4 className="text-sm font-semibold">{title}</h4>
        <div className="mt-1.5 space-y-3 text-xs leading-relaxed text-text-secondary">{children}</div>
      </div>
    </li>
  );
}

function Permission({ children }: { children: ReactNode }) {
  return <span className="rounded-md border border-border bg-bg-secondary px-2 py-1 text-[10px] text-text-secondary">{children}</span>;
}

export function DiscordGuide({
  applicationId,
  onApplicationIdChange,
  includeEtCommands,
  onIncludeEtCommandsChange,
  onNavigate,
}: {
  applicationId: string;
  onApplicationIdChange: (value: string) => void;
  includeEtCommands: boolean;
  onIncludeEtCommandsChange: (value: boolean) => void;
  onNavigate: DiscordNavigate;
}) {
  const inviteUrl = discordBotInviteUrl(applicationId, includeEtCommands);
  const idInvalid = Boolean(applicationId.trim()) && !inviteUrl;

  return (
    <div className="space-y-5">
      <SectionCard icon="🧭" title="Choose your setup" description="You do not need every feature. Start with notifications, then add a bot or sign-in if your community needs it.">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="flex flex-col rounded-xl border border-border bg-bg-secondary/40 p-4">
            <div className="flex items-center justify-between gap-2">
              <Bell size={20} className="text-accent" aria-hidden />
              <Badge tone="success">Start here · no bot needed</Badge>
            </div>
            <h4 className="mt-3 text-sm font-semibold">Server notifications</h4>
            <p className="mt-1 flex-1 text-xs leading-relaxed text-text-muted">Post starts, stops, crashes, backups and player activity into an existing Discord channel.</p>
            <button type="button" onClick={() => onNavigate("notifications", "discord-panel-webhook")} className={`${BTN.secondary} mt-4 inline-flex items-center justify-between gap-2`}>
              Set up a webhook<ArrowRight size={14} aria-hidden />
            </button>
          </div>
          <div className="flex flex-col rounded-xl border border-border bg-bg-secondary/40 p-4">
            <div className="flex items-center justify-between gap-2">
              <Bot size={20} className="text-accent" aria-hidden />
              <Badge tone="accent">Bot required</Badge>
            </div>
            <h4 className="mt-3 text-sm font-semibold">A channel for every server</h4>
            <p className="mt-1 flex-1 text-xs leading-relaxed text-text-muted">Create channels automatically, keep their headings up to date, and enable the WolfET chat commands.</p>
            <button type="button" onClick={() => onNavigate("bot", "discord-bot-token")} className={`${BTN.secondary} mt-4 inline-flex items-center justify-between gap-2`}>
              Connect a bot<ArrowRight size={14} aria-hidden />
            </button>
          </div>
        </div>
        <button type="button" onClick={() => onNavigate("signin", "discord-oauth-client-id")} className="inline-flex items-center gap-2 text-xs font-medium text-accent hover:underline">
          <KeyRound size={14} aria-hidden />Just want “Sign in with Discord”? Set up sign-in separately<ArrowRight size={13} aria-hidden />
        </button>
      </SectionCard>

      <SectionCard icon="🔔" title="Webhook quick start" description="The quickest way to get notifications. A webhook posts into one existing channel; it cannot create channels or read commands." actions={<Badge tone="neutral">About 2 minutes</Badge>}>
        <ol className="grid gap-4 sm:grid-cols-3">
          {[
            ["Create a webhook", "In Discord, open your channel’s Edit Channel → Integrations → Webhooks. Choose New Webhook."],
            ["Copy its URL", "Select the webhook and copy its URL. Treat that URL like a password — anyone with it can post."],
            ["Paste, save, test", "Paste it into Notifications, press Save changes, then Send test message and check Discord."],
          ].map(([title, text], index) => (
            <li key={title} className="rounded-lg bg-bg-secondary/50 p-3">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-accent">Step {index + 1}</span>
              <h4 className="mt-1 text-xs font-semibold">{title}</h4>
              <p className="mt-1 text-[11px] leading-relaxed text-text-muted">{text}</p>
            </li>
          ))}
        </ol>
        <button type="button" onClick={() => onNavigate("notifications", "discord-panel-webhook")} className={`${BTN.primary} inline-flex items-center gap-2`}>
          Add your webhook<ArrowRight size={14} aria-hidden />
        </button>
      </SectionCard>

      <SectionCard icon="🤖" title="Bot setup, step by step" description="Use this for automatic channels and WolfET commands. Keep the Developer Portal and Discord open alongside this page." actions={<PortalLink />}>
        <ol>
          <SetupStep number={1} title="Create the application and copy its token">
            <p>In the Developer Portal, choose <strong>New Application</strong> and give it a name. Open the application’s <strong>Bot</strong> page, then <strong>Reset Token</strong> (or copy the existing token).</p>
            <p>Paste the token into <strong>Bot & channels</strong>. It is write-only: the panel never displays a saved token again. Do not use the OAuth client secret here.</p>
            <button type="button" className={BTN.ghost} onClick={() => onNavigate("bot", "discord-bot-token")}>Open bot credentials →</button>
          </SetupStep>
          <SetupStep number={2} title="Invite the bot to your Discord server">
            <p>Copy the <strong>Application ID</strong> from the portal’s <strong>General Information</strong> page and paste it below. This is not the bot token. The generated invite requests only the permissions this panel uses — never Administrator.</p>
            <div>
              <label htmlFor="discord-invite-app-id" className="mb-1 block text-xs font-medium text-text-secondary">Bot application ID</label>
              <input
                id="discord-invite-app-id"
                value={applicationId}
                onChange={(e) => onApplicationIdChange(e.target.value)}
                inputMode="numeric"
                autoComplete="off"
                spellCheck={false}
                placeholder="e.g. 123456789012345678"
                aria-invalid={idInvalid}
                aria-describedby="discord-invite-app-hint"
                className={`${INPUT} max-w-md ${idInvalid ? "border-danger" : ""}`}
              />
              <p id="discord-invite-app-hint" className={`mt-1 text-[11px] ${idInvalid ? "text-danger" : "text-text-muted"}`}>
                {idInvalid ? "Enter the numeric Application ID, not a token or secret." : "Used only to build this invite link; it is not saved as a credential."}
              </p>
            </div>
            <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border bg-bg-secondary/40 p-3">
              <input type="checkbox" checked={includeEtCommands} onChange={(e) => onIncludeEtCommandsChange(e.target.checked)} className="mt-0.5 h-4 w-4 accent-accent" />
              <span><span className="block font-medium text-text-primary">Include WolfET commands and nickname sync</span><span className="mt-0.5 block text-[11px] text-text-muted">Adds Manage Roles, Manage Nicknames and Manage Messages. Leave off for channels and status headings only.</span></span>
            </label>
            <div className="flex flex-wrap gap-1.5" aria-label="Requested bot permissions">
              {["View Channel", "Send Messages", "Embed Links", "Read Message History", "Manage Channels", "Manage Webhooks"].map((p) => <Permission key={p}>{p}</Permission>)}
              {includeEtCommands && ["Manage Roles", "Manage Nicknames", "Manage Messages"].map((p) => <Permission key={p}>{p}</Permission>)}
            </div>
            {inviteUrl ? (
              <div className="space-y-2">
                <CopyValue id="discord-invite-url" label="Your bot invite link" value={inviteUrl} />
                <a href={inviteUrl} target="_blank" rel="noopener noreferrer" className={`${BTN.primary} inline-flex items-center gap-2`}>Invite bot to Discord<ExternalLink size={14} aria-hidden /></a>
              </div>
            ) : <p className="text-[11px] text-text-muted">Enter your Application ID to generate the invite, or use the portal’s OAuth2 → URL Generator with the permissions above and the <code>bot</code> scope.</p>}
          </SetupStep>
          <SetupStep number={3} title="Copy the server ID and enable the intents">
            <p>In Discord, open <strong>User Settings → Advanced</strong> and turn on <strong>Developer Mode</strong>. Right-click your server and choose <strong>Copy Server ID</strong>. To group channels, right-click a category and copy its ID too.</p>
            <p>Back in the portal’s <strong>Bot → Privileged Gateway Intents</strong>, enable <strong>Server Members Intent</strong> and <strong>Message Content Intent</strong>, then save. The chat bot needs both to connect.</p>
            <div className="flex items-start gap-2 rounded-lg border border-warning/25 bg-warning/5 p-3 text-[11px] text-text-secondary">
              <ShieldCheck size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden />
              <p>For nickname sync, place the bot’s role above the members it renames. Channel-specific permissions can override server permissions — check View Channel, Send Messages and Embed Links in the target channel.</p>
            </div>
          </SetupStep>
          <SetupStep number={4} title="Save, verify, then bring your servers across">
            <p>Enter the bot token, server ID and optional category in <strong>Bot & channels</strong>, then press <strong>Save changes</strong>. Use <strong>Verify bot connection</strong> to check access to the server, and check the connection status below it.</p>
            <p>Turn on automatic channels for new servers. For existing servers, preview and run <strong>Create missing channels</strong>. Finally, post a status board or send a test notification.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={BTN.secondary} onClick={() => onNavigate("bot", "discord-guild-id")}>Enter server ID</button>
              <button type="button" className={BTN.secondary} onClick={() => onNavigate("bot", "discord-existing-servers")}>Set up existing servers</button>
              <button type="button" className={BTN.secondary} onClick={() => onNavigate("boards")}>Open status boards</button>
            </div>
          </SetupStep>
        </ol>
      </SectionCard>

      <details className="rounded-xl border border-border bg-bg-card p-4 text-xs">
        <summary className="cursor-pointer font-semibold text-text-secondary">Something not working? Start here</summary>
        <dl className="mt-3 grid gap-4 sm:grid-cols-2">
          <div><dt className="font-medium text-text-primary">Bot is offline or keeps retrying</dt><dd className="mt-1 leading-relaxed text-text-muted">Check the token and both privileged intents. Save the credentials again after changing them, then refresh the bot status.</dd></div>
          <div><dt className="font-medium text-text-primary">The bot does not answer commands</dt><dd className="mt-1 leading-relaxed text-text-muted">Check channel permissions and Message Content Intent. Commands use the <code>!</code> prefix, for example <code>!etwho</code>.</dd></div>
          <div><dt className="font-medium text-text-primary">“Unknown Webhook” or missing channels</dt><dd className="mt-1 leading-relaxed text-text-muted">Use Bot & channels → Existing servers → Preview changes. The repair replaces deleted webhooks without replacing a healthy channel.</dd></div>
          <div><dt className="font-medium text-text-primary">Channel heading did not change</dt><dd className="mt-1 leading-relaxed text-text-muted">Discord allows two renames per channel every ten minutes. The panel must own the channel and have a saved bot token and server ID.</dd></div>
        </dl>
      </details>
    </div>
  );
}
