"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/components/ToastProvider";
import { useConfirm } from "@/components/ConfirmDialog";
import { mutate } from "@/lib/api-client";
import {
  formatWhen,
  updateProgress,
  updateStepLabel,
  updateSummary,
  type UpdateState,
  type UpdateTone,
} from "@/lib/panel-update";

interface UpdateStatus {
  now: number;
  panel: {
    version: string | null;
    commit: string | null;
    branch: string | null;
    installDir: string;
    installedVersion: string | null;
    lastUpdate: string | null;
    port: string | null;
  };
  updater: {
    path: string;
    wrapperPath: string;
    present: boolean;
    wrapperPresent: boolean;
    isRoot: boolean;
    sudoAllowed: boolean;
    canUpdate: boolean;
    reason: string | null;
    command: string | null;
  };
  state: UpdateState | null;
  running: boolean;
  progress: number;
  summary: UpdateTone;
  logTail: string;
}

const POLL_RUNNING_MS = 2_500;
const POLL_IDLE_MS = 15_000;

/** A whole status, as GET sends it and as POST includes in its answer. */
function isStatus(data: Partial<UpdateStatus> | null): data is UpdateStatus {
  return !!data && typeof data === "object" && !!data.panel && !!data.updater && !!data.summary;
}

const TONE_STYLES: Record<UpdateTone["tone"], string> = {
  none: "border-border bg-bg-secondary/60 text-text-secondary",
  running: "border-accent/40 bg-accent/10 text-accent",
  stale: "border-warning/40 bg-warning/10 text-warning",
  ok: "border-success/40 bg-success/10 text-success",
  failed: "border-danger/40 bg-danger/10 text-danger",
};

/**
 * The panel's own update button.
 *
 * Everything here is deliberately explicit: which commit is running, what the
 * updater will do, whether this install is even allowed to self-update, and the
 * live output while it happens — because the operation ends by restarting the
 * panel the operator is looking at.
 */
export default function UpdatesPanel() {
  const toast = useToast();
  const confirm = useConfirm();

  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  // The request that starts an update got no answer at all: see startUpdate.
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startedHere, setStartedHere] = useState(false);
  // The commit the panel was on when this page first heard from it. A different
  // one later means this page's own code is from before an update.
  const [commitAtOpen, setCommitAtOpen] = useState<string | null>(null);
  const [noBackup, setNoBackup] = useState(false);
  const [probing, setProbing] = useState(false);
  const logRef = useRef<HTMLPreElement | null>(null);

  // Set while a start request is unanswered: the run that was on screen before
  // the click, so the next status can tell whether anything came of it.
  const unansweredRef = useRef<{ startedAt: string | null } | null>(null);

  // Read inside `load` (an async callback) without making it a dependency of
  // itself; updated in an effect so render stays pure.
  const runningRef = useRef(false);
  useEffect(() => {
    runningRef.current = status?.running === true;
  }, [status?.running]);

  // Everything a status from the panel settles, whichever request brought it.
  const applyStatus = useCallback((data: UpdateStatus) => {
    setStatus(data);
    setLoadError(null);
    setReconnecting(false);
    setUnconfirmed(false);
    setCommitAtOpen((seen) => seen ?? data.panel.commit);
    // Not left to the effect above: the very next request may already fail
    // because the updater has stopped the panel, and whether that is an error
    // or the expected restart is decided by this.
    runningRef.current = data.running === true;
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/system/update", { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setLoadError(body?.error || `Could not read the update status (HTTP ${res.status}).`);
        // A failed request while an update is running usually means the panel is
        // restarting, which is expected — say so instead of showing an error.
        if (runningRef.current) setReconnecting(true);
        return;
      }
      const data = (await res.json()) as UpdateStatus;
      const wasRunning = runningRef.current;
      const unanswered = unansweredRef.current;
      unansweredRef.current = null;
      applyStatus(data);

      if (unanswered) {
        // The click was never answered; this is the first word from the panel
        // since. Say plainly what became of it.
        const sameRunAsBefore = (data.state?.startedAt ?? null) === unanswered.startedAt;
        if (data.running) {
          setStartedHere(true);
          toast.info("Update started", "The panel is answering again and the update is running.");
        } else if (sameRunAsBefore) {
          toast.warning(
            "The update did not start",
            "The panel is answering again and reports that no update ran. Try again."
          );
        } else if (data.state?.status === "success") {
          setStartedHere(true);
          toast.success("Panel updated", "The panel is back on the new version.");
        } else {
          const outcome = updateSummary(data.state, data.now);
          toast.error(outcome.title, outcome.detail);
        }
        return;
      }

      if (data.state?.status === "success" && wasRunning) {
        toast.success("Panel updated", "The panel is back on the new version.");
      }
    } catch {
      if (runningRef.current) setReconnecting(true);
      else setLoadError("Could not reach the panel.");
    } finally {
      setLoading(false);
    }
  }, [toast, applyStatus]);

  useEffect(() => {
    // Deferred: loading sets state, which must not happen synchronously in an
    // effect body.
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const running = status?.running === true;
  useEffect(() => {
    const interval = running || reconnecting ? POLL_RUNNING_MS : POLL_IDLE_MS;
    const id = window.setInterval(() => void load(), interval);
    return () => window.clearInterval(id);
  }, [running, reconnecting, load]);

  // Follow the newest output while an update is running; the interesting lines
  // are always the last ones.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [status?.logTail]);

  async function startUpdate() {
    if (!status || starting) return;
    const ok = await confirm({
      title: "Update the panel now?",
      message: [
        "The updater will back up the current install, pull the latest code, install dependencies, apply database migrations, rebuild the panel and restart it.",
        "This page will disconnect for a minute or two while the panel restarts, then reconnect. Servers keep running.",
        noBackup ? "The pre-update backup is DISABLED for this run." : "A backup is taken first, so rollback stays possible.",
      ].join("\n\n"),
      confirmLabel: "Update now",
      cancelLabel: "Cancel",
      danger: true,
    });
    if (!ok) return;

    const runBeforeClick = status.state?.startedAt ?? null;
    setStarting(true);
    const result = await mutate<Partial<UpdateStatus>>("/api/system/update", {
      method: "POST",
      body: JSON.stringify({ confirm: "update", noBackup }),
    });
    setStarting(false);

    // A started update and one that stopped at once are both answered with the
    // status as of that moment. Show it rather than asking again: within a
    // second or two of starting, the updater stops the panel, and a page that
    // still believed nothing was running would report that as an error.
    const answered = isStatus(result.data) ? result.data : null;
    if (answered) applyStatus(answered);

    if (!result.ok) {
      if (result.status === 0) {
        // No answer at all. The updater can stop the panel while this request
        // is still open, so silence may well mean "it started". The panel knows
        // which; keep asking it rather than announcing a failure that might
        // not be one. `load` reports the outcome once the panel answers.
        unansweredRef.current = { startedAt: runBeforeClick };
        setUnconfirmed(true);
        setReconnecting(true);
        toast.info(
          "Waiting for the panel",
          "It did not answer the request. If the update started, the panel is restarting; this page keeps checking."
        );
        void load();
        return;
      }
      toast.error("Could not start the update", result.error ?? "Try again in a moment.");
      if (!answered) void load();
      return;
    }

    setStartedHere(true);
    toast.info("Update started", "You can watch the progress here; the panel restarts at the end.");
    if (!answered) void load();
  }

  async function recheck() {
    setProbing(true);
    await load();
    setProbing(false);
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-28 animate-pulse rounded-2xl border border-border bg-bg-card" />
        <div className="h-40 animate-pulse rounded-2xl border border-border bg-bg-card" />
      </div>
    );
  }

  // The server sends the clock it used, so the component stays pure and every
  // "3 minutes ago" is measured against one coherent timestamp.
  const nowMs = status?.now ?? 0;
  const summary = status ? updateSummary(status.state, nowMs) : null;
  const tone = summary?.tone ?? "none";
  const progress = status ? updateProgress(status.state) : 0;
  const canUpdate = status?.updater.canUpdate === true && !running;
  const state = status?.state ?? null;
  const codeChanged =
    commitAtOpen !== null && !!status?.panel.commit && status.panel.commit !== commitAtOpen;

  return (
    <div className="space-y-5">
      {/* ── Version ─────────────────────────────────────────────────────── */}
      <section className="gaming-surface rounded-2xl p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="heading-font text-lg font-bold uppercase tracking-[0.08em]">Panel software</h2>
            <p className="mt-1 text-xs text-text-muted">
              The panel updates itself from its git checkout using{" "}
              <code className="text-text-secondary">public/update.sh</code>.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <Chip label="Version" value={status?.panel.version ?? "unknown"} />
            <Chip label="Commit" value={status?.panel.commit ?? "unknown"} />
            <Chip label="Branch" value={status?.panel.branch ?? "unknown"} />
          </div>
        </div>

        <dl className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
          <Detail label="Install directory" value={status?.panel.installDir ?? "—"} mono />
          <Detail
            label="Last successful update"
            value={
              state?.status === "success" && state.finishedAt
                ? `${formatWhen(state.finishedAt, nowMs)}${state.toCommit ? ` (${state.toCommit})` : ""}`
                : status?.panel.installedVersion
                  ? `${status.panel.installedVersion}${status.panel.lastUpdate ? ` · ${status.panel.lastUpdate}` : ""}`
                  : "not recorded"
            }
          />
        </dl>
      </section>

      {/* ── Status + action ─────────────────────────────────────────────── */}
      <section className="gaming-surface rounded-2xl p-4 sm:p-6">
        {loadError && !reconnecting && (
          <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
            <span className="min-w-0 flex-1">{loadError}</span>
            <button
              type="button"
              onClick={() => void recheck()}
              disabled={probing}
              className="rounded-lg border border-danger/40 px-3 py-1.5 text-xs font-medium hover:bg-danger/20 disabled:opacity-40"
            >
              {probing ? "Checking…" : "Retry"}
            </button>
          </div>
        )}

        {reconnecting && (
          <div role="status" className="mb-4 rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-accent">
            {unconfirmed
              ? "The panel did not answer the request to start the update. If the update started, the panel is restarting. This page keeps checking and will show what happened — nothing needs to be clicked."
              : "The panel is restarting to finish the update. This page will reconnect by itself — nothing needs to be clicked."}
          </div>
        )}

        {summary && (
          <div className={`rounded-xl border px-4 py-3 text-sm ${TONE_STYLES[tone]}`}>
            <p className="font-medium">{summary.title}</p>
            {summary.detail && <p className="mt-1 text-xs opacity-90">{summary.detail}</p>}
            {state?.status === "failed" && state.phase === "launch" && status && (
              <p className="mt-2 text-xs opacity-90">
                The updater stopped before its first step, so the panel was never
                stopped and is still running the version shown above. Whatever the
                updater printed is below; to watch it first-hand, run{" "}
                <code className="font-mono text-[11px]">sudo bash {status.updater.path}</code>{" "}
                from a shell.
              </p>
            )}
          </div>
        )}

        {running && (
          <div className="mt-4">
            <div className="mb-1 flex items-center justify-between text-[11px] text-text-muted">
              <span>{state ? updateStepLabel(state) : "Starting"}</span>
              <span>{progress}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-bg-tertiary" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void startUpdate()}
            disabled={!canUpdate || starting}
            className="rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            {starting ? "Starting…" : running ? "Update in progress…" : "Update panel now"}
          </button>

          <button
            type="button"
            onClick={() => void recheck()}
            disabled={probing}
            className="rounded-lg border border-border bg-bg-tertiary px-4 py-2.5 text-sm font-medium text-text-secondary transition-colors hover:bg-bg-hover disabled:opacity-40"
          >
            {probing ? "Checking…" : "Refresh status"}
          </button>

          <label className="flex items-center gap-2 text-xs text-text-secondary">
            <input
              type="checkbox"
              checked={noBackup}
              onChange={(e) => setNoBackup(e.target.checked)}
              disabled={running}
              className="h-3.5 w-3.5 accent-current"
            />
            Skip the pre-update backup
          </label>
        </div>

        {((startedHere && tone === "ok") || codeChanged) && !running && (
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-3 text-xs font-medium text-accent hover:underline"
          >
            Reload the panel to pick up the new version →
          </button>
        )}

        {status && !status.updater.canUpdate && (
          <div role="note" className="mt-4 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-xs text-warning">
            <p className="font-medium">This install cannot update itself from the panel.</p>
            <p className="mt-1 opacity-90">{status.updater.reason}</p>
            <p className="mt-2 font-mono text-[11px] opacity-90">
              sudo bash {status.updater.path} --force
            </p>
          </div>
        )}
      </section>

      {/* ── What it does ────────────────────────────────────────────────── */}
      <section className="gaming-surface rounded-2xl p-4 sm:p-6">
        <h3 className="text-sm font-semibold">What the updater does</h3>
        <ol className="mt-2 grid gap-1 text-xs text-text-secondary sm:grid-cols-2">
          <li>1. Backs up config and the database</li>
          <li>2. Pulls the latest code for the branch</li>
          <li>3. Installs npm dependencies</li>
          <li>4. Applies database migrations</li>
          <li>5. Builds the production bundle</li>
          <li>6. Restarts the panel and health-checks it</li>
        </ol>
        <p className="mt-3 text-xs text-text-muted">
          Game servers keep running throughout — only the panel itself restarts.
          Rollback:{" "}
          <code className="text-text-secondary">sudo bash {status?.updater.path ?? "public/update.sh"} --rollback</code>
        </p>
      </section>

      {/* ── Log ─────────────────────────────────────────────────────────── */}
      <section className="gaming-surface rounded-2xl p-4 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">Update output</h3>
          <span className="text-[11px] text-text-muted">
            {status?.logTail ? "last 12 kB" : "nothing yet"}
          </span>
        </div>
        <pre ref={logRef} className="mt-3 max-h-80 overflow-auto rounded-xl border border-border bg-bg-secondary/70 p-3 text-[11px] leading-relaxed text-text-secondary">
          {status?.logTail
            ? status.logTail
            : state
              ? "The updater has not printed anything."
              : "No update has been run from the panel yet. The log appears here as soon as one starts."}
        </pre>
      </section>
    </div>
  );
}

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <span className="gaming-chip rounded-lg px-2.5 py-1">
      <span className="text-[10px] uppercase tracking-[0.14em] text-text-muted">{label}</span>{" "}
      <span className="font-mono text-text-secondary">{value}</span>
    </span>
  );
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
      <dt className="text-[10px] uppercase tracking-[0.14em] text-text-muted">{label}</dt>
      <dd className={`min-w-0 break-all text-text-secondary ${mono ? "font-mono text-[11px]" : ""}`}>{value}</dd>
    </div>
  );
}
