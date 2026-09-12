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
  updateAutoBackup: boolean;
  ageVerificationEnabled: boolean;
  minimumAccountAge: number;
  schedulerDiscordNotify: boolean;
  backupRetentionCount: number;
  alertCpuPercent: number;
  alertRamPercent: number;
  alertDiskPercent: number;
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

/** Copy-to-clipboard snippets for embedding the public status board. */
function PublicStatusEmbed() {
  const toast = useToast();
  // Lazy initializer reads the origin during render (guarded for SSR) instead
  // of a mount-time setState.
  const [origin] = useState(() => (typeof window !== "undefined" ? window.location.origin : ""));
  if (!origin) return null;

  const iframeSnippet =
    `<iframe src="${origin}/status" title="Server Status" loading="lazy" style="width:100%;max-width:920px;height:480px;border:0;border-radius:12px;background:#0b1020"></iframe>`;

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied", `${what} snippet copied to clipboard.`);
    } catch {
      toast.error("Copy Failed", "Select and copy the snippet manually.");
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <label className={labelCls}>Iframe (renders the panel&#39;s own page)</label>
        <div className="flex gap-2">
          <code className="flex-1 truncate rounded-lg border border-border bg-bg-secondary px-3 py-2 text-[11px] text-text-secondary">{iframeSnippet}</code>
          <button type="button" onClick={() => void copy(iframeSnippet, "Iframe")} className="rounded-lg border border-border bg-bg-secondary px-3 py-2 text-xs font-medium text-text-secondary hover:border-accent/40 hover:text-accent transition-colors">Copy</button>
        </div>
      </div>
      <div>
        <label className={labelCls}>JSON endpoint (for custom widgets)</label>
        <div className="flex gap-2">
          <code className="flex-1 truncate rounded-lg border border-border bg-bg-secondary px-3 py-2 text-[11px] text-text-secondary">{origin}/api/public/status</code>
          <button type="button" onClick={() => void copy(`${origin}/api/public/status`, "Endpoint")} className="rounded-lg border border-border bg-bg-secondary px-3 py-2 text-xs font-medium text-text-secondary hover:border-accent/40 hover:text-accent transition-colors">Copy</button>
        </div>
        <p className="text-[11px] text-text-muted mt-1">CORS is open on this endpoint, so any site can fetch it and render its own widget.</p>
      </div>
    </div>
  );
}

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

  // Outbound webhook config
  const [hookUrl, setHookUrl] = useState("");
  const [hookSecret, setHookSecret] = useState("");
  const [hookState, setHookState] = useState<{ url: string | null; secretConfigured: boolean; secretMasked: string | null } | null>(null);
  const [hookBusy, setHookBusy] = useState(false);
  const [hookDeliveries, setHookDeliveries] = useState<Array<{ line: string; ok: boolean; attempted: boolean }>>([]);
  const [drBusy, setDrBusy] = useState(false);
  const [idlePolicy, setIdlePolicy] = useState<{ enabled: boolean; hours: number } | null>(null);
  const [idleBusy, setIdleBusy] = useState(false);
  const [alertMute, setAlertMute] = useState<{ mutedUntil: string | null; remaining: string | null } | null>(null);
  const [muteBusy, setMuteBusy] = useState(false);
  const [allowSpec, setAllowSpec] = useState("");
  const [allowState, setAllowState] = useState<{ rules: string[]; yourIp: string | null } | null>(null);
  const [allowBusy, setAllowBusy] = useState(false);
  const [digestTaskId, setDigestTaskId] = useState<number | null>(null);
  const [digestLoaded, setDigestLoaded] = useState(false);
  const [digestBusy, setDigestBusy] = useState(false);

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

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch("/api/settings/webhook");
        if (res.ok) {
          const data = await res.json();
          setHookState(data);
          setHookUrl(data.url || "");
        }
        const delRes = await fetch("/api/settings/webhook/deliveries");
        if (delRes.ok) {
          const delData = await delRes.json().catch(() => null);
          setHookDeliveries(delData?.deliveries ?? []);
        }
      } catch { /* non-admins simply see nothing */ }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch("/api/settings/idle-policy");
        if (res.ok) setIdlePolicy(await res.json());
      } catch { /* non-admins see nothing */ }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch("/api/settings/alert-mute");
        if (res.ok) setAlertMute(await res.json());
      } catch { /* non-admins see nothing */ }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch("/api/settings/ip-allowlist");
        if (res.ok) {
          const data = await res.json();
          setAllowSpec(data.spec || "");
          setAllowState({ rules: data.rules || [], yourIp: data.yourIp || null });
        }
      } catch { /* non-admins see nothing */ }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch("/api/scheduler");
        if (res.ok) {
          const tasks = ((await res.json()).tasks || []) as Array<{ id: number; taskType: string; enabled: boolean | null }>;
          const digest = tasks.find((t) => t.taskType === "fleet-digest" && t.enabled !== false);
          setDigestTaskId(digest?.id ?? null);
        }
      } catch { /* non-admins see nothing */ } finally {
        setDigestLoaded(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function toggleDigest() {
    setDigestBusy(true);
    try {
      if (digestTaskId !== null) {
        const res = await fetch(`/api/scheduler/${digestTaskId}`, { method: "DELETE" });
        if (!res.ok) { const d = await res.json().catch(() => null); toast.error("Fleet digest", d?.error || "Could not unschedule"); return; }
        setDigestTaskId(null);
        toast.success("Fleet digest", "Weekly digest unscheduled.");
      } else {
        const res = await fetch("/api/scheduler", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskType: "fleet-digest", serverId: null, cronExpression: "0 9 * * 1", enabled: true }),
        });
        const d = await res.json().catch(() => null);
        if (!res.ok) { toast.error("Fleet digest", d?.error || "Could not schedule"); return; }
        setDigestTaskId(d.task?.id ?? null);
        toast.success("Fleet digest", "Every Monday at 09:00 — fleet stats to the panel webhook + outbound webhooks.");
      }
    } finally {
      setDigestBusy(false);
    }
  }

  async function saveAllowlist(addSelf: boolean) {
    setAllowBusy(true);
    try {
      const res = await fetch("/api/settings/ip-allowlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(addSelf ? { addSelf: true } : { spec: allowSpec }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) { toast.error("IP allowlist", data?.error || "Could not save the allowlist"); return; }
      setAllowSpec(data.spec || "");
      setAllowState({ rules: data.rules || [], yourIp: data.yourIp || null });
      toast.success("IP allowlist saved", data.rules?.length ? `Only ${data.rules.length} rule${data.rules.length === 1 ? "" : "s"} may now use the panel (loopback always passes).` : "Allowlist cleared — the panel is open to all IPs again.");
    } catch {
      toast.error("IP allowlist", "Could not save the allowlist");
    } finally {
      setAllowBusy(false);
    }
  }

  async function setMute(hours: number | null) {
    setMuteBusy(true);
    try {
      const res = await fetch("/api/settings/alert-mute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(hours === null ? { clear: true } : { hours }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) { toast.error("Alert mute", data?.error || "Could not update the mute window"); return; }
      setAlertMute(data);
      toast.success("Alert mute", hours === null ? "Threshold alerts re-enabled." : `Threshold alerts muted for ${hours}h.`);
    } catch {
      toast.error("Alert mute", "Could not update the mute window");
    } finally {
      setMuteBusy(false);
    }
  }

  async function saveIdlePolicy(next: { enabled?: boolean; hours?: number }) {
    setIdleBusy(true);
    try {
      const res = await fetch("/api/settings/idle-policy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) { toast.error("Idle policy", data?.error || "Could not save the policy"); return; }
      setIdlePolicy(data);
      toast.success("Idle policy saved", data.enabled ? `Servers with zero players for ${data.hours}h+ will be stopped automatically.` : "Automatic idle stops disabled.");
    } catch {
      toast.error("Idle policy", "Could not save the policy");
    } finally {
      setIdleBusy(false);
    }
  }

  async function downloadExport() {
    setDrBusy(true);
    try {
      const res = await fetch("/api/maintenance/export");
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast.error("Export", data?.error || "Could not build the export");
        return;
      }
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `gsm-panel-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Export ready", "Settings, presets and schedules saved as JSON.");
    } catch {
      toast.error("Export", "Could not build the export");
    } finally {
      setDrBusy(false);
    }
  }

  async function importExportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const okConfirm = await confirm({
      title: "Import panel export",
      message: "Restore settings (safe keys), presets and matching schedules from this file? Existing values for restored settings will be overwritten.",
      confirmLabel: "Import",
    });
    if (!okConfirm) return;
    setDrBusy(true);
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const res = await fetch("/api/maintenance/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) { toast.error("Import", data?.error || "The file was rejected"); return; }
      toast.success(
        "Import complete",
        `${data.settingsRestored} settings, ${data.presetsRestored} presets, ${data.tasksRestored} schedules restored` +
          `${data.tasksUnmatched ? ` · ${data.tasksUnmatched} schedules skipped (server not on this panel)` : ""}` +
          `${data.skippedSettings ? ` · ${data.skippedSettings} settings skipped (not importable)` : ""}.`
      );
      void load();
    } catch {
      toast.error("Import", "That file is not valid export JSON.");
    } finally {
      setDrBusy(false);
    }
  }

  async function saveWebhook(testFirst: boolean) {
    setHookBusy(true);
    try {
      const payload: Record<string, unknown> = testFirst
        ? { test: true, url: hookUrl.trim(), secret: hookSecret.trim() || undefined }
        : { url: hookUrl.trim(), ...(hookSecret.trim() ? { secret: hookSecret.trim() } : {}) };
      const res = await fetch("/api/settings/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) { toast.error("Webhook", data?.error || "Could not save the webhook"); return; }
      if (testFirst) {
        toast.success("Webhook test", data.delivered ? `Delivered (HTTP ${data.status}).` : `Endpoint answered HTTP ${data.status}.`);
        return;
      }
      setHookState(data);
      setHookSecret("");
      toast.success("Webhook saved", data.url ? "Panel events will now be pushed to your endpoint." : "Webhook disabled.");
    } catch {
      toast.error("Webhook", "Could not reach the panel");
    } finally {
      setHookBusy(false);
    }
  }

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
            update_auto_backup: cfg.updateAutoBackup,
            age_verification_enabled: cfg.ageVerificationEnabled,
            minimum_account_age: cfg.minimumAccountAge,
            scheduler_discord_notify: cfg.schedulerDiscordNotify,
            backup_retention_count: cfg.backupRetentionCount,
            alert_cpu_percent: cfg.alertCpuPercent,
            alert_ram_percent: cfg.alertRamPercent,
            alert_disk_percent: cfg.alertDiskPercent,
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

        <div className="grid sm:grid-cols-3 gap-4">
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
          <NumberField
            label="Backup retention"
            hint="Archives kept per server after each backup (manual, scheduled or pre-update). 0 keeps them all."
            value={cfg.backupRetentionCount}
            onChange={(n) => patch({ backupRetentionCount: n })}
            min={0}
            max={100}
            suffix="files"
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

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={cfg.ageVerificationEnabled}
            onChange={(e) => patch({ ageVerificationEnabled: e.target.checked })}
            className="mt-1"
          />
          <span>
            <span className="text-sm font-medium">Age verification at registration</span>
            <span className="block text-[11px] text-text-muted">
              New accounts must provide a date of birth and meet the minimum
              age below. Required by Australian law (Online Safety Amendment
              Act 2024) for platforms with community features.
            </span>
          </span>
        </label>

        <div className="grid sm:grid-cols-3 gap-4">
          <NumberField
            label="Minimum account age"
            hint="Users younger than this cannot register. 16 is the Australian legal minimum; it can only be raised."
            value={cfg.minimumAccountAge}
            onChange={(n) => patch({ minimumAccountAge: n })}
            min={16}
            max={120}
            suffix="years"
          />
        </div>
      </div>

      {/* ── Update safety ──────────────────────────────────────────── */}
      <div className={card}>
        <div>
          <h3 className="text-lg font-semibold">🛟 Update Safety</h3>
          <p className="text-xs text-text-muted mt-1">
            A restore point before every Steam update.
          </p>
        </div>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={cfg.updateAutoBackup}
            onChange={(e) => patch({ updateAutoBackup: e.target.checked })}
            className="mt-1"
          />
          <span>
            <span className="text-sm font-medium">Automatic backup before update</span>
            <span className="block text-[11px] text-text-muted">
              The Update button archives the server first. If the backup
              fails, the update is aborted and no files are changed.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={cfg.schedulerDiscordNotify}
            onChange={(e) => patch({ schedulerDiscordNotify: e.target.checked })}
            className="mt-1"
          />
          <span>
            <span className="text-sm font-medium">Discord notification for scheduled tasks</span>
            <span className="block text-[11px] text-text-muted">
              Posts a message to the server&apos;s Discord webhook (or the
              panel-wide one) whenever a scheduled restart, backup, update or
              command runs — including failures.
            </span>
          </span>
        </label>
      </div>

      {/* ── Outbound webhook ───────────────────────────────────────── */}
      <div className={card}>
        <div>
          <h3 className="text-lg font-semibold">📡 Outbound Webhook</h3>
          <p className="text-sm text-text-secondary">
            Push every panel event (starts, stops, installs, batches…) to your own HTTP endpoint as JSON.
          </p>
        </div>
        {hookState === null ? (
          <p className="text-xs text-text-muted">Only administrators can view the webhook settings.</p>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Endpoint URL (https recommended)</label>
              <input value={hookUrl} onChange={(e) => setHookUrl(e.target.value)} placeholder="https://hooks.example.com/gsm" className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/40" />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">
                HMAC secret {hookState.secretConfigured ? `(stored: ${hookState.secretMasked})` : "(optional)"}
              </label>
              <input value={hookSecret} onChange={(e) => setHookSecret(e.target.value)} placeholder={hookState.secretConfigured ? "Leave blank to keep the stored secret" : "Signs every delivery as X-GSM-Signature"} type="password" className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/40" />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={() => void saveWebhook(false)} disabled={hookBusy} className="px-4 py-2 bg-accent hover:bg-accent-hover disabled:opacity-40 text-white rounded-lg text-sm font-medium">{hookBusy ? "Working…" : "Save webhook"}</button>
              <button onClick={() => void saveWebhook(true)} disabled={hookBusy || !hookUrl.trim()} className="px-4 py-2 bg-bg-tertiary hover:bg-bg-hover disabled:opacity-40 text-text-secondary rounded-lg text-sm font-medium">Send test event</button>
              {hookState.url && <button onClick={() => { void (async () => { setHookBusy(true); try { const res = await fetch("/api/settings/webhook", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ test: true }) }); const data = await res.json().catch(() => null); if (res.ok && data?.delivered) toast.success("Saved config works", `Endpoint answered HTTP ${data.status}.`); else toast.error("Test failed", data?.error || `Endpoint answered HTTP ${data?.status ?? "?"}.`); const delRes = await fetch("/api/settings/webhook/deliveries"); if (delRes.ok) { const delData = await delRes.json().catch(() => null); setHookDeliveries(delData?.deliveries ?? []); } } finally { setHookBusy(false); } })(); }} disabled={hookBusy} className="px-4 py-2 bg-bg-tertiary hover:bg-bg-hover disabled:opacity-40 text-text-secondary rounded-lg text-sm font-medium">Test saved config</button>}
              {hookState.url && <button onClick={() => { setHookUrl(""); void (async () => { setHookBusy(true); try { const res = await fetch("/api/settings/webhook", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: null }) }); if (res.ok) { setHookState(await res.json()); setHookUrl(""); toast.success("Webhook disabled", ""); } } finally { setHookBusy(false); } })(); }} disabled={hookBusy} className="px-4 py-2 text-sm text-text-muted hover:text-danger">Disable</button>}
            </div>
            {hookDeliveries.length > 0 && (
              <div className="rounded-lg border border-border bg-bg-secondary/60 p-3 space-y-1">
                <p className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Recent deliveries (newest first, kept until restart)</p>
                {hookDeliveries.map((d, i) => (
                  <p key={i} className={`font-mono text-[11px] ${d.attempted && d.ok ? "text-success" : d.attempted ? "text-danger" : "text-text-muted"}`}>{d.line}</p>
                ))}
              </div>
            )}
            <p className="text-[11px] text-text-muted">
              Deliveries are fire-and-forget and never block panel actions. Local/private addresses are rejected (SSRF guard).
            </p>
          </div>
        )}
      </div>

      {/* ── Idle auto-stop ─────────────────────────────────────────── */}
      <div className={card}>
        <div>
          <h3 className="text-lg font-semibold">😴 Idle Auto-Stop</h3>
          <p className="text-sm text-text-secondary">
            Automatically stop running servers that report zero players for the whole threshold window. Stops are
            recorded in each server&apos;s event history. Off by default.
          </p>
        </div>
        {idlePolicy === null ? (
          <p className="text-xs text-text-muted">Only administrators can change the idle policy.</p>
        ) : (
          <div className="flex items-center gap-3 flex-wrap">
            <label className="text-sm font-medium">Stop after</label>
            <select
              value={idlePolicy.hours}
              disabled={idleBusy}
              onChange={(e) => void saveIdlePolicy({ hours: Number(e.target.value) })}
              className="px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/40"
            >
              {[2, 4, 6, 8, 12, 16, 24, 48, 72].map((h) => <option key={h} value={h}>{h} hours</option>)}
            </select>
            <label className="text-sm font-medium">of zero players</label>
            <button
              onClick={() => void saveIdlePolicy({ enabled: !idlePolicy.enabled })}
              disabled={idleBusy}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 ${idlePolicy.enabled ? "bg-success/15 text-success hover:bg-success/25" : "bg-bg-tertiary text-text-secondary hover:bg-bg-hover"}`}
            >
              {idleBusy ? "Working…" : idlePolicy.enabled ? "✅ Enabled — click to disable" : "Enable idle auto-stop"}
            </button>
          </div>
        )}
      </div>

      {/* ── Weekly fleet digest ────────────────────────────────────── */}
      <div className={card}>
        <div>
          <h3 className="text-lg font-semibold">📬 Weekly Fleet Digest</h3>
          <p className="text-sm text-text-secondary">
            Every Monday at 09:00: servers running, crashes, watchdog stops, idle auto-stops and the three
            least-stable servers — delivered to the panel Discord webhook and any outbound webhook subscribers.
          </p>
        </div>
        {!digestLoaded ? (
          <p className="text-xs text-text-muted">Checking schedule…</p>
        ) : (
          <button
            onClick={() => void toggleDigest()}
            disabled={digestBusy}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 ${digestTaskId !== null ? "bg-success/15 text-success hover:bg-success/25" : "bg-bg-tertiary text-text-secondary hover:bg-bg-hover"}`}
          >
            {digestBusy ? "Working…" : digestTaskId !== null ? "✅ Scheduled — click to unschedule" : "Schedule weekly digest"}
          </button>
        )}
      </div>

      {/* ── IP allowlist ───────────────────────────────────────────── */}
      <div className={card}>
        <div>
          <h3 className="text-lg font-semibold">🛡️ IP Allowlist</h3>
          <p className="text-sm text-text-secondary">
            When set, only these client IPs can use the authenticated panel and API. Loopback (the panel&apos;s own
            machine) always passes so you can never lock yourself out at the console. Unknown IPs fail closed.
          </p>
        </div>
        {allowState === null ? (
          <p className="text-xs text-text-muted">Only administrators can manage the allowlist.</p>
        ) : (
          <div className="space-y-2">
            <textarea
              value={allowSpec}
              onChange={(e) => setAllowSpec(e.target.value)}
              placeholder={"One rule per line or comma-separated. Exact IPs or subnet globs.\n203.0.113.9\n10.0.0.*"}
              rows={3}
              className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm font-mono text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={() => void saveAllowlist(false)} disabled={allowBusy} className="px-4 py-2 bg-accent hover:bg-accent-hover disabled:opacity-40 text-white rounded-lg text-sm font-medium">{allowBusy ? "Saving…" : "Save allowlist"}</button>
              <button onClick={() => void saveAllowlist(true)} disabled={allowBusy} className="px-4 py-2 bg-bg-tertiary hover:bg-bg-hover disabled:opacity-40 text-text-secondary rounded-lg text-sm font-medium" title="Append your current public IP to the list">➕ Add my IP{allowState.yourIp ? ` (${allowState.yourIp})` : ""}</button>
            </div>
            {allowState.rules.length > 0 && !allowState.rules.some((r) => allowState.yourIp !== null && (r === allowState.yourIp || r === "*")) && (
              <p className="text-xs text-warning font-medium">⚠️ Your current IP is not covered by a rule. Make sure it is listed before relying on the allowlist (loopback still works).</p>
            )}
          </div>
        )}
      </div>

      {/* ── Disaster recovery ──────────────────────────────────────── */}
      <div className={card}>
        <div>
          <h3 className="text-lg font-semibold">🧯 Disaster Recovery</h3>
          <p className="text-sm text-text-secondary">
            Snapshot panel settings, presets and schedules as JSON. Servers and nodes are exported for reference
            only — their files live on disk. Credentials are never exported.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => void downloadExport()} disabled={drBusy} className="px-4 py-2 bg-accent hover:bg-accent-hover disabled:opacity-40 text-white rounded-lg text-sm font-medium">{drBusy ? "Working…" : "⬇️ Download export"}</button>
          <label className="px-4 py-2 bg-bg-tertiary hover:bg-bg-hover text-text-secondary rounded-lg text-sm font-medium cursor-pointer">
            ⬆️ Restore from export…
            <input type="file" accept=".json,application/json" className="hidden" onChange={(ev) => void importExportFile(ev)} disabled={drBusy} />
          </label>
        </div>
      </div>

      {/* ── Threshold alerts ───────────────────────────────────────── */}
      <div className={card}>
        <div>
          <h3 className="text-lg font-semibold">🚨 Host Threshold Alerts</h3>
          <p className="text-xs text-text-muted mt-1">
            A Discord message when the machine itself is heading for trouble:
            CPU load, RAM or disk usage over a threshold for three
            consecutive checks (~3 minutes). One alert per episode — it
            re-arms once the reading drops back under. Set a threshold to{" "}
            <b>0</b> to disable that check. Uses the panel-wide webhook.
          </p>
        </div>
        {alertMute && (
          <div className="flex items-center gap-2 flex-wrap rounded-lg border border-border bg-bg-secondary/50 px-3 py-2">
            {alertMute.mutedUntil ? (
              <>
                <span className="text-sm text-warning font-medium">🔕 Alerts muted — {alertMute.remaining} left</span>
                <button onClick={() => void setMute(null)} disabled={muteBusy} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-bg-tertiary text-text-secondary hover:bg-bg-hover disabled:opacity-40">Unmute now</button>
              </>
            ) : (
              <>
                <span className="text-sm text-text-secondary">🔕 Mute during planned work:</span>
                {[1, 4, 24].map((h) => (
                  <button key={h} onClick={() => void setMute(h)} disabled={muteBusy} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-bg-tertiary text-text-secondary hover:bg-bg-hover disabled:opacity-40">{h}h</button>
                ))}
              </>
            )}
          </div>
        )}
        <div className="grid sm:grid-cols-3 gap-4">
          <NumberField
            label="CPU alert threshold"
            hint="Load per core as a percentage; multi-core bursts can pass 100."
            value={cfg.alertCpuPercent}
            onChange={(n) => patch({ alertCpuPercent: n })}
            min={0}
            max={1000}
            suffix="%"
          />
          <NumberField
            label="RAM alert threshold"
            hint="Share of host memory in use (MemAvailable-based)."
            value={cfg.alertRamPercent}
            onChange={(n) => patch({ alertRamPercent: n })}
            min={0}
            max={100}
            suffix="%"
          />
          <NumberField
            label="Disk alert threshold"
            hint="Share of the root filesystem used."
            value={cfg.alertDiskPercent}
            onChange={(n) => patch({ alertDiskPercent: n })}
            min={0}
            max={100}
            suffix="%"
          />
        </div>
      </div>

      {/* ── Public status page ─────────────────────────────────────── */}
      <div className={card}>
        <div>
          <h3 className="text-lg font-semibold">🌐 Public Status Page</h3>
          <p className="text-xs text-text-muted mt-1">
            The board at <code>/status</code> lists servers whose owners
            flipped “Public listing” on. Share the page itself, or embed it
            on a community website with one of these snippets.
          </p>
        </div>
        <PublicStatusEmbed />
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
