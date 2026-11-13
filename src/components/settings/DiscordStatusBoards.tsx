"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { BTN, Badge, INPUT, SectionCard } from "./settingsUi";
import type { DiscordNavigate } from "./DiscordGuide";
import { fetchWithTimeout, messageForStatus, mutate } from "@/lib/api-client";

interface BoardServer {
  id: number;
  name: string;
  gameName: string;
  status: string;
  hasWebhook: boolean;
  enabled: boolean;
  messageId: string | null;
  updatedAt: string | null;
  error: string | null;
  hasChannel: boolean;
  heading: { name: string | null; updatedAt: string | null; error: string | null };
}

type BoardAction = "enable" | "disable" | "refresh" | "heading";
interface Feedback { kind: "ok" | "err" | "info"; text: string }

/** Immediate actions, deliberately outside the credentials form's Save bar. */
export function DiscordStatusBoards({ botReady, revision, onNavigate }: {
  botReady: boolean;
  revision: number;
  onNavigate: DiscordNavigate;
}) {
  const [boards, setBoards] = useState<BoardServer[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [interval, setInterval] = useState(3);
  const [savedInterval, setSavedInterval] = useState(3);
  const [busy, setBusy] = useState<number | "interval" | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetchWithTimeout("/api/settings/discord/boards", { cache: "no-store", signal });
      const data = await res.json().catch(() => null);
      if (signal?.aborted) return;
      if (!res.ok || !data || !Array.isArray(data.servers)) {
        setLoadError(messageForStatus(res.ok ? 500 : res.status, data?.error));
        return;
      }
      setBoards(data.servers);
      const minutes = Number(data?.intervalMinutes) || 3;
      setInterval(minutes);
      setSavedInterval(minutes);
    } catch {
      if (!signal?.aborted) setLoadError("Could not load status boards. Check your connection and try again.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => void load(controller.signal), 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [load, revision]);

  async function action(body: Record<string, unknown>, label: number | "interval") {
    setBusy(label);
    setFeedback(null);
    const result = await mutate<{
      servers?: BoardServer[];
      intervalMinutes?: number;
      error?: string;
      gone?: boolean;
      skipped?: boolean;
      message?: string;
      name?: string;
    }>("/api/settings/discord/boards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!result.ok) {
      setFeedback({ kind: "err", text: result.error || "The action could not be completed." });
    } else {
      const data = result.data;
      if (data?.servers) setBoards(data.servers);
      if (label === "interval" && data?.intervalMinutes) {
        setInterval(data.intervalMinutes);
        setSavedInterval(data.intervalMinutes);
        setFeedback({ kind: "ok", text: `Refresh interval saved: every ${data.intervalMinutes} minutes.` });
      } else if (data?.error) {
        setFeedback({ kind: "err", text: data.error });
        if (data.gone) void load();
      } else if (body.action === "heading") {
        setFeedback({ kind: data?.skipped ? "info" : "ok", text: data?.skipped ? data.message || "The heading was left unchanged." : `Channel heading updated to “${data?.name}”.` });
      } else {
        const messages: Record<string, string> = {
          enable: "Status board posted. Automatic updates are on.",
          disable: "Automatic updates stopped. The existing Discord message was left in place.",
          refresh: "Status board refreshed.",
        };
        setFeedback({ kind: "ok", text: messages[String(body.action)] || "Status board updated." });
      }
    }
    setBusy(null);
  }

  const live = boards?.filter((s) => s.enabled && s.messageId && !s.error).length ?? 0;
  const attention = boards?.filter((s) => s.error || s.heading.error || (s.enabled && !s.messageId)).length ?? 0;

  return (
    <div className="space-y-5">
      <SectionCard
        icon="📋"
        title="Live status boards"
        description="One message per game server, kept up to date with online/offline status, the current map and connected players. Each server needs its own webhook; the panel-wide fallback is not used for boards."
        actions={<button type="button" onClick={() => void load()} disabled={loading || busy !== null} className={`${BTN.ghost} inline-flex items-center gap-1.5`}><RefreshCw size={13} aria-hidden />Refresh list</button>}
      >
        <details className="rounded-lg border border-border bg-bg-secondary/50 p-3 text-xs" open>
          <summary className="cursor-pointer font-medium text-text-secondary">How to get a board into Discord</summary>
          <ol className="mt-2 list-inside list-decimal space-y-1 leading-relaxed text-text-muted">
            <li>Give the server a webhook in its server settings, or use <button type="button" onClick={() => onNavigate("bot", "discord-existing-servers")} className="text-accent underline-offset-2 hover:underline">Bot & channels → Existing servers</button> to create a channel and webhook.</li>
            <li>Choose a refresh interval below and press <strong>Apply interval</strong>. This saves immediately.</li>
            <li>Press <strong>Post board</strong> beside the server. The panel posts the first message and keeps it updated.</li>
          </ol>
          <p className="mt-2 text-[11px] leading-relaxed text-text-muted">Channel headings are separate: they show 🟢/🔴 even with the board off, but require a bot and a channel created by this panel. Discord limits renames to two per channel every ten minutes.</p>
        </details>

        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-3">
          <div className="min-w-32">
            <label htmlFor="discord-board-interval" className="mb-1 block text-xs font-medium text-text-secondary">Refresh every</label>
            <select id="discord-board-interval" value={interval} onChange={(e) => setInterval(Number(e.target.value))} disabled={busy !== null || loading} className={INPUT}>
              {[1, 2, 3, 5, 10, 15, 30, 60].map((m) => <option key={m} value={m}>{m} {m === 1 ? "minute" : "minutes"}</option>)}
            </select>
          </div>
          <button type="button" onClick={() => void action({ action: "interval", minutes: interval }, "interval")} disabled={busy !== null || loading || interval === savedInterval} className={BTN.primary}>
            {busy === "interval" ? "Saving…" : "Apply interval"}
          </button>
          <p className="pb-2 text-[11px] text-text-muted">{interval === savedInterval ? `Saved · every ${savedInterval} min` : "Unsaved interval · press Apply"}</p>
        </div>

        {loadError && <p role="alert" className="rounded-lg border border-danger/30 bg-danger/5 p-3 text-xs text-danger">{loadError} <button type="button" onClick={() => void load()} className="underline">Retry</button></p>}
        {loading && boards === null ? (
          <p role="status" className="py-4 text-xs text-text-muted">Loading your servers…</p>
        ) : boards?.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center">
            <p className="text-sm font-medium">No game servers yet</p>
            <p className="mt-1 text-xs text-text-muted">Create a game server in the panel first, then return here to post its status board.</p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2"><Badge tone="success">{live} live</Badge><Badge tone="neutral">{boards?.length ?? 0} servers</Badge>{attention > 0 && <Badge tone="warning">{attention} need attention</Badge>}</div>
            <ul className="divide-y divide-border" aria-busy={loading || busy !== null}>
              {boards?.map((srv) => {
                const working = busy === srv.id;
                const state = srv.error || (srv.enabled && !srv.messageId) ? "Needs attention" : srv.enabled ? "Live" : "Off";
                return (
                  <li key={srv.id} className="flex flex-col gap-3 py-4 xl:flex-row xl:items-start">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{srv.name}</span>
                        <span className={`h-2 w-2 rounded-full ${srv.status === "running" ? "bg-success" : "bg-text-muted"}`} aria-label={srv.status === "running" ? "Server running" : "Server not running"} />
                        <Badge tone={state === "Live" ? "success" : state === "Off" ? "neutral" : "warning"}>{state}</Badge>
                      </div>
                      <p className="mt-1 text-[11px] text-text-muted">{srv.gameName}{srv.updatedAt && ` · Updated ${new Date(srv.updatedAt).toLocaleString()}`}</p>
                      {!srv.hasWebhook && <p className="mt-1 text-[11px] text-warning">No server webhook. <button type="button" onClick={() => onNavigate("bot", "discord-existing-servers")} className="underline">Create missing channels</button> or add one in that server’s settings.</p>}
                      {srv.error && <p className="mt-1 break-words text-[11px] text-danger">{srv.error}</p>}
                      <div className="mt-2 text-[11px] text-text-muted">
                        <span className="text-text-secondary">Heading:</span> {srv.heading.name ? <code className="break-all">{srv.heading.name}</code> : "not updated yet"}
                        {srv.heading.updatedAt && ` · ${new Date(srv.heading.updatedAt).toLocaleTimeString()}`}
                        {!srv.hasChannel && <span className="block text-warning">No panel-owned channel. Use Existing servers to create one.</span>}
                        {srv.hasChannel && !botReady && <span className="block text-warning">Save a bot token and server ID to update headings.</span>}
                        {srv.heading.error && <span className="block break-words text-danger">{srv.heading.error}</span>}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <button type="button" onClick={() => void action({ serverId: srv.id, action: "heading" satisfies BoardAction }, srv.id)} disabled={busy !== null || !srv.hasChannel || !botReady} title={!srv.hasChannel ? "Create a panel-owned channel first" : !botReady ? "Save bot credentials first" : "Discord allows two heading renames per channel every ten minutes"} className={BTN.secondary}>
                        {working ? "Working…" : "Update heading"}
                      </button>
                      <button type="button" onClick={() => void action({ serverId: srv.id, action: "refresh" satisfies BoardAction }, srv.id)} disabled={busy !== null || !srv.hasWebhook} className={BTN.secondary}>{working ? "Working…" : "Refresh now"}</button>
                      {srv.enabled ? (
                        <button type="button" onClick={() => void action({ serverId: srv.id, action: "disable" satisfies BoardAction }, srv.id)} disabled={busy !== null} className={BTN.danger}>{working ? "Working…" : "Stop updates"}</button>
                      ) : (
                        <button type="button" onClick={() => void action({ serverId: srv.id, action: "enable" satisfies BoardAction }, srv.id)} disabled={busy !== null || !srv.hasWebhook} className={BTN.primary}>{working ? "Posting…" : "Post board"}</button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {feedback && <p role={feedback.kind === "err" ? "alert" : "status"} className={`rounded-lg border p-3 text-xs ${feedback.kind === "ok" ? "border-success/30 bg-success/5 text-success" : feedback.kind === "info" ? "border-border bg-bg-secondary text-text-secondary" : "border-danger/30 bg-danger/5 text-danger"}`}>{feedback.text}</p>}
      </SectionCard>
    </div>
  );
}
