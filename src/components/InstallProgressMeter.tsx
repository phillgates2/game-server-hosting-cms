"use client";

import { useEffect, useRef, useState } from "react";
import type { ProgressPhase, ProgressState } from "@/lib/install-progress";
import {
  formatBytes,
  formatDuration,
  formatRate,
  phaseIcon,
  phaseTitle,
} from "@/lib/install-progress-format";

/**
 * Live status meter for a game-server install or update.
 *
 * Polls GET /api/servers/[id]/progress while `active` (once a second while a
 * run is in flight, slower while waiting for one to start) and shows what is
 * being downloaded/installed, how far along it is, speed, ETA, the steps so
 * far and a collapsible tail of the installer output.
 */
export default function InstallProgressMeter({ serverId, active }: { serverId: number; active: boolean }) {
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [showLog, setShowLog] = useState(false);
  // Polls answered without a run to show (e.g. the panel restarted mid-install).
  const [emptyPolls, setEmptyPolls] = useState(0);
  const logRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let timer: number | undefined;
    // Ignore anything that finished before we started watching, so last
    // week's failed install never flashes up when a new one begins.
    const watchingSince = Date.now();

    const tick = async () => {
      let delay = 3000;
      try {
        const res = await fetch(`/api/servers/${serverId}/progress`, { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as { active?: boolean; progress?: ProgressState | null };
          const p = data.progress ?? null;
          if (!cancelled) {
            const stale = p !== null && p.finishedAt !== null && p.finishedAt < watchingSince - 2000;
            setProgress(stale ? null : p);
            setEmptyPolls((n) => (stale || p === null ? n + 1 : 0));
            setNow(Date.now());
          }
          if (data.active) delay = 1000;
        }
      } catch {
        /* transient — keep the last known state and try again */
      }
      if (!cancelled) timer = window.setTimeout(() => void tick(), delay);
    };
    void tick();

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [serverId, active]);

  // Keep the newest output in view while the log is open.
  useEffect(() => {
    if (showLog && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [showLog, progress]);

  if (!active) return null;

  // The request is in flight but the server has not registered the run yet.
  const p: ProgressState | null = progress;
  const phase: ProgressPhase = p?.phase ?? "preparing";
  const failed = phase === "failed";
  const done = phase === "done";
  const percent = p?.percent ?? null;
  const determinate = percent !== null;
  const elapsed = p ? Math.max(0, ((p.finishedAt ?? now) - p.startedAt) / 1000) : 0;
  const kindLabel = p?.kind === "update" ? "Updating" : "Installing";
  const barColor = failed ? "bg-danger" : done ? "bg-success" : "bg-accent";

  const details: string[] = [];
  if (p?.bytesDone != null && p.bytesTotal != null && p.bytesTotal > 0) {
    details.push(`${formatBytes(p.bytesDone)} / ${formatBytes(p.bytesTotal)}`);
  }
  if (p?.bytesPerSec != null && p.bytesPerSec > 0) details.push(formatRate(p.bytesPerSec));
  if (p?.etaSeconds != null && p.etaSeconds > 0) details.push(`about ${formatDuration(p.etaSeconds)} left`);
  if (p) details.push(`${formatDuration(elapsed)} elapsed`);

  return (
    <div
      className={`px-5 py-3 border-t ${failed ? "border-danger/30 bg-danger/5" : "border-accent/20 bg-accent/5"}`}
      data-testid="install-progress"
    >
      <div className="flex items-center justify-between gap-3 text-xs">
        <div className="min-w-0 flex items-center gap-2">
          <span aria-hidden="true">{phaseIcon(phase)}</span>
          <span className="font-semibold text-text-primary truncate">
            {p ? `${kindLabel} ${p.title}` : emptyPolls >= 3 ? "Working…" : "Starting…"}
          </span>
          <span className="text-text-muted shrink-0">· {phaseTitle(phase)}</span>
        </div>
        <span className="font-mono text-text-secondary shrink-0" aria-hidden="true">
          {determinate ? `${percent.toFixed(percent >= 10 || percent === 0 ? 0 : 1)}%` : failed ? "" : "…"}
        </span>
      </div>

      <div
        className="mt-2 h-2.5 w-full rounded-full bg-bg-secondary overflow-hidden border border-border"
        role="progressbar"
        aria-label={p ? `${kindLabel} ${p.title}: ${p.label}` : "Starting"}
        aria-valuemin={0}
        aria-valuemax={100}
        {...(determinate ? { "aria-valuenow": Math.round(percent) } : {})}
        aria-valuetext={determinate ? `${Math.round(percent)}% — ${p?.label ?? ""}` : (p?.label ?? "Starting")}
      >
        {determinate || failed ? (
          <div
            className={`h-full rounded-full ${barColor} transition-[width] duration-500 ease-out`}
            style={{ width: `${failed ? 100 : Math.max(2, percent ?? 0)}%` }}
          />
        ) : (
          <div className={`h-full w-1/3 rounded-full ${barColor} gsm-progress-indeterminate`} />
        )}
      </div>

      <div className="mt-2 flex items-start justify-between gap-3 text-xs">
        <p className="min-w-0 text-text-secondary" aria-live="polite">
          <span className="break-words">
            {p?.label ??
              (emptyPolls >= 3
                ? "In progress — live details are not available for this run."
                : "Waiting for the installer to start…")}
          </span>
          {p?.item && !p.label.includes(p.item) && (
            <span className="text-text-muted"> — <span className="font-mono break-all">{p.item}</span></span>
          )}
        </p>
        {details.length > 0 && (
          <p className="shrink-0 text-right font-mono text-[11px] text-text-muted">{details.join(" · ")}</p>
        )}
      </div>

      {failed && p?.error && <p className="mt-1 text-xs text-danger break-words">{p.error}</p>}
      {p && p.remote && !p.liveOutput && !done && !failed && (
        <p className="mt-1 text-[11px] text-text-muted">
          This node&apos;s agent is too old to report live progress — the work is still running. Update the agent
          (v1.1.0+) to see download details here.
        </p>
      )}

      {p && (p.steps.length > 1 || p.log.length > 0) && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowLog((v) => !v)}
            aria-expanded={showLog}
            className="text-[11px] text-text-muted hover:text-text-primary underline-offset-2 hover:underline"
          >
            {showLog ? "Hide details" : "Show details"}
          </button>
          {showLog && (
            <div className="mt-2 grid gap-2 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
              <ol className="space-y-1 text-[11px] text-text-secondary">
                {p.steps.map((step, i) => {
                  const current = i === p.steps.length - 1 && !done && !failed;
                  return (
                    <li key={`${i}-${step}`} className="flex gap-1.5">
                      <span aria-hidden="true" className={current ? "text-accent" : "text-text-muted"}>
                        {current ? "▸" : "✓"}
                      </span>
                      <span className={`break-words min-w-0 ${current ? "text-text-primary" : ""}`}>{step}</span>
                    </li>
                  );
                })}
              </ol>
              <pre
                ref={logRef}
                className="max-h-40 overflow-y-auto rounded-lg bg-[#0d1117] p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all text-text-secondary"
              >
                {p.log.length > 0 ? p.log.join("\n") : "No output yet."}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
