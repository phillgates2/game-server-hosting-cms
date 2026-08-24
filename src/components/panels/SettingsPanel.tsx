"use client";

import { useEffect, useState, useCallback } from "react";
import { useToast } from "@/components/ToastProvider";
import { useConfirm } from "@/components/ConfirmDialog";
import DiscordSettings from "./DiscordSettings";

interface PanelSettings {
  metricsRetentionDays: number;
  auditRetentionDays: number;
  defaultMaxServers: number;
  registrationEnabled: boolean;
  loginThrottleAttempts: number;
  sessionDays: number;
}

interface RetentionStats {
  nodeMetrics: number;
  serverMetrics: number;
  auditLog: number;
}

interface BackfillResult {
  serverId: number;
  serverName: string;
  status: "created" | "recreated" | "ok" | "skipped" | "failed";
  channelName?: string;
  detail?: string;
}

interface BackfillResponse {
  ok: boolean;
  dryRun: boolean;
  scanned: number;
  created: number;
  recreated: number;
  alreadyOk: number;
  skipped: number;
  failed: number;
  results: BackfillResult[];
  error?: string;
}

const card =
  "bg-bg-card border border-border rounded-xl p-4 sm:p-6 space-y-4";
const input =
  "w-full px-3 py-2 gaming-chip rounded-lg text-sm bg-bg-secondary border border-border";
const labelCls = "block text-xs text-text-muted mb-1";

/** A number field with its explanation, kept out of the component body. */
function NumberField({
  label,
  hint,
  value,
  onChange,
  min,
  max,
  suffix,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  suffix?: string;
}) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={min}
          max={max}
          value={Number.isFinite(value) ? value : ""}
          onChange={(e) => onChange(Number(e.target.value))}
          className={input}
        />
        {suffix && (
          <span className="text-xs text-text-muted whitespace-nowrap">{suffix}</span>
        )}
      </div>
      <p className="text-[11px] text-text-muted mt-1">{hint}</p>
    </div>
  );
}

export default function SettingsPanel() {
  const toast = useToast();
  const confirm = useConfirm();

  const [cfg, setCfg] = useState<PanelSettings | null>(null);
  const [stats, setStats] = useState<RetentionStats | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  const [backfilling, setBackfilling] = useState(false);
  const [backfill, setBackfill] = useState<BackfillResponse | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/panel");
      if (res.ok) {
        const data = await res.json();
        setCfg(data.settings);
        setStats(data.stats);
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error("Could not load settings", data.error || "Please try again.");
      }
    } catch {
      toast.error("Could not load settings", "Please try again.");
    } finally {
      setLoaded(true);
    }
  }, [toast]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  function patch(next: Partial<PanelSettings>) {
    setCfg((prev) => (prev ? { ...prev, ...next } : prev));
  }

  async function save() {
    if (!cfg) return;
    setSaving(true);
    try {
      const res = await fetch("/api/settings/panel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: {
            metrics_retention_days: cfg.metricsRetentionDays,
            audit_retention_days: cfg.auditRetentionDays,
            default_max_servers: cfg.defaultMaxServers,
            registration_enabled: cfg.registrationEnabled,
            login_throttle_attempts: cfg.loginThrottleAttempts,
            session_days: cfg.sessionDays,
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success("Settings saved", "Changes take effect immediately.");
        void load();
      } else {
        toast.error("Could not save", data.error || "Please try again.");
      }
    } catch {
      toast.error("Could not save", "Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function runBackfill(dryRun: boolean) {
    if (!dryRun) {
      const ok = await confirm({
        title: "Create Discord channels",
        message:
          "This creates a channel for every server that does not have one, and re-creates any channel that was deleted in Discord. Servers with a webhook you entered by hand are left alone.",
        confirmLabel: "Run",
      });
      if (!ok) return;
    }

    setBackfilling(true);
    setBackfill(null);
    try {
      const res = await fetch("/api/settings/discord/backfill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun }),
      });
      const data: BackfillResponse = await res.json();
      if (!res.ok) {
        toast.error("Backfill failed", data.error || "Please try again.");
        return;
      }
      setBackfill(data);
      const parts = [
        data.created && `${data.created} created`,
        data.recreated && `${data.recreated} re-created`,
        data.alreadyOk && `${data.alreadyOk} already fine`,
        data.skipped && `${data.skipped} skipped`,
        data.failed && `${data.failed} failed`,
      ].filter(Boolean);
      const summary = parts.length ? parts.join(", ") : "Nothing to do.";
      if (data.failed > 0) toast.warning(dryRun ? "Preview" : "Finished", summary);
      else toast.success(dryRun ? "Preview" : "Finished", summary);
    } catch {
      toast.error("Backfill failed", "Please try again.");
    } finally {
      setBackfilling(false);
    }
  }

  if (!loaded) {
    return <p className="text-text-secondary text-sm">Loading settings…</p>;
  }
  if (!cfg) {
    return (
      <p className="text-text-secondary text-sm">
        Settings unavailable. You need the <code>panel.settings</code> permission.
      </p>
    );
  }

  const fmt = (n: number) => n.toLocaleString();

  return (
    <div className="space-y-6 max-w-4xl">
      {/* ── Data retention ─────────────────────────────────────────── */}
      <div className={card}>
        <div>
          <h3 className="text-lg font-semibold">🗄️ Data Retention</h3>
          <p className="text-xs text-text-muted mt-1">
            Metrics and audit history only ever grow. Old rows are pruned
            automatically in the background. Set a value to <b>0</b> to keep
            everything forever.
          </p>
        </div>

        {stats && (
          <div className="grid grid-cols-3 gap-3 text-center">
            {[
              ["Node metrics", stats.nodeMetrics],
              ["Server metrics", stats.serverMetrics],
              ["Audit entries", stats.auditLog],
            ].map(([label, n]) => (
              <div key={String(label)} className="rounded-lg bg-bg-secondary p-3">
                <div className="text-lg font-semibold">{fmt(Number(n))}</div>
                <div className="text-[11px] text-text-muted">{label}</div>
              </div>
            ))}
          </div>
        )}

        <div className="grid sm:grid-cols-2 gap-4">
          <NumberField
            label="Metrics retention"
            hint="CPU, RAM and network samples. A busy 5-node panel writes ~43,000 rows a day."
            value={cfg.metricsRetentionDays}
            onChange={(n) => patch({ metricsRetentionDays: n })}
            min={0}
            max={3650}
            suffix="days"
          />
          <NumberField
            label="Audit retention"
            hint="Who did what, and when. Usually worth keeping longer than metrics."
            value={cfg.auditRetentionDays}
            onChange={(n) => patch({ auditRetentionDays: n })}
            min={0}
            max={3650}
            suffix="days"
          />
        </div>
      </div>

      {/* ── Accounts ───────────────────────────────────────────────── */}
      <div className={card}>
        <div>
          <h3 className="text-lg font-semibold">👥 Accounts &amp; Access</h3>
          <p className="text-xs text-text-muted mt-1">
            Defaults applied to new accounts, and how sessions behave.
          </p>
        </div>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={cfg.registrationEnabled}
            onChange={(e) => patch({ registrationEnabled: e.target.checked })}
            className="mt-1"
          />
          <span>
            <span className="text-sm font-medium">Allow self-registration</span>
            <span className="block text-[11px] text-text-muted">
              When off, only an administrator can create accounts. Existing
              users are unaffected.
            </span>
          </span>
        </label>

        <div className="grid sm:grid-cols-3 gap-4">
          <NumberField
            label="Default server limit"
            hint="Applied to new accounts. 0 means unlimited."
            value={cfg.defaultMaxServers}
            onChange={(n) => patch({ defaultMaxServers: n })}
            min={0}
            max={1000}
          />
          <NumberField
            label="Login attempts"
            hint="Failed logins before an address is temporarily throttled."
            value={cfg.loginThrottleAttempts}
            onChange={(n) => patch({ loginThrottleAttempts: n })}
            min={1}
            max={100}
          />
          <NumberField
            label="Session length"
            hint="How long a login lasts before signing out."
            value={cfg.sessionDays}
            onChange={(n) => patch({ sessionDays: n })}
            min={1}
            max={365}
            suffix="days"
          />
        </div>
      </div>

      {/* ── Discord configuration ──────────────────────────────────── */}
      <div className="space-y-2">
        <div>
          <h3 className="text-lg font-semibold">🔔 Discord</h3>
          <p className="text-xs text-text-muted mt-1">
            Notifications for server start, stop, restart, crash, auto-restart
            and delete — and, with a bot, a channel for each server.
          </p>
        </div>
        {/* Saves through its own admin-only endpoint: the bot token is a
            credential and must not go near /api/site-settings. */}
        <DiscordSettings />
      </div>

      {/* ── Discord backfill ───────────────────────────────────────── */}
      <div className={card}>
        <div>
          <h3 className="text-lg font-semibold">📺 Existing Servers</h3>
          <p className="text-xs text-text-muted mt-1">
            New servers get a channel automatically. This gives one to servers
            that already existed before the bot was set up — and re-creates any
            channel that was deleted in Discord, which otherwise leaves
            notifications silently going nowhere.
          </p>
          <p className="text-[11px] text-text-muted mt-2">
            Uses the bot configured above. A webhook alone cannot create
            channels; that needs a bot token and server ID.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => runBackfill(true)}
            disabled={backfilling}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-bg-secondary border border-border hover:bg-bg-hover disabled:opacity-50"
          >
            {backfilling ? "Checking…" : "Preview changes"}
          </button>
          <button
            type="button"
            onClick={() => runBackfill(false)}
            disabled={backfilling}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-accent text-white hover:opacity-90 disabled:opacity-50"
          >
            {backfilling ? "Working…" : "Create missing channels"}
          </button>
        </div>

        {backfill && (
          <div className="rounded-lg border border-border overflow-hidden">
            <div className="px-3 py-2 bg-bg-secondary text-xs text-text-muted">
              {backfill.dryRun ? "Preview — nothing was changed." : "Result"} ·{" "}
              {backfill.scanned} server{backfill.scanned === 1 ? "" : "s"} checked
            </div>
            {backfill.results.length === 0 ? (
              <p className="px-3 py-3 text-sm text-text-muted">
                No servers found.
              </p>
            ) : (
              <ul className="divide-y divide-border max-h-72 overflow-y-auto">
                {backfill.results.map((r) => {
                  const tone =
                    r.status === "failed"
                      ? "text-danger"
                      : r.status === "skipped"
                        ? "text-text-muted"
                        : r.status === "ok"
                          ? "text-text-secondary"
                          : "text-success";
                  const verb =
                    r.status === "created"
                      ? backfill.dryRun ? "would create" : "created"
                      : r.status === "recreated"
                        ? backfill.dryRun ? "would re-create" : "re-created"
                        : r.status === "ok"
                          ? "already has one"
                          : r.status === "skipped"
                            ? "skipped"
                            : "failed";
                  return (
                    <li
                      key={r.serverId}
                      className="px-3 py-2 text-sm flex items-start justify-between gap-3"
                    >
                      <span className="font-medium truncate">{r.serverName}</span>
                      <span className={`text-xs text-right ${tone}`}>
                        {verb}
                        {r.channelName && ` · #${r.channelName}`}
                        {r.detail && (
                          <span className="block text-[11px] text-text-muted">
                            {r.detail}
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

      {/* ── Save ───────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="px-6 py-2.5 bg-success hover:opacity-90 text-white rounded-lg text-sm font-medium disabled:opacity-50"
        >
          {saving ? "Saving…" : "💾 Save Settings"}
        </button>
        <span className="text-xs text-text-muted">
          Saves retention and account settings. Discord has its own save
          button. Appearance lives under <b>Site Editor</b>.
        </span>
      </div>
    </div>
  );
}
