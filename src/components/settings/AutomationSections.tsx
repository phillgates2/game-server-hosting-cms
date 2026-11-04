"use client";

import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/components/ToastProvider";
import { BTN, Badge, SectionCard } from "./settingsUi";

const IDLE_MIN_HOURS = 1;
const IDLE_MAX_HOURS = 72;
/** Offered in the picker; anything else can be typed into the number box. */
const IDLE_PRESETS = [2, 4, 6, 8, 12, 16, 24, 48, 72];

interface IdlePolicy {
  enabled: boolean;
  hours: number;
}

/**
 * Idle auto-stop.
 *
 * The old control saved on every click of the toggle and every change of the
 * select, so a stray scroll through the hours list quietly changed production
 * behaviour. Edits are staged here and applied together with one Save.
 */
export function IdleAutoStopBlock() {
  const toast = useToast();
  const [saved, setSaved] = useState<IdlePolicy | null>(null);
  const [draft, setDraft] = useState<IdlePolicy | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/idle-policy");
      if (!res.ok) {
        setUnavailable(true);
        return;
      }
      const data = (await res.json()) as IdlePolicy;
      setSaved({ enabled: Boolean(data.enabled), hours: Number(data.hours) });
      setDraft({ enabled: Boolean(data.enabled), hours: Number(data.hours) });
    } catch {
      setUnavailable(true);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    // Deferred one turn so the mount render finishes before the fetch's
    // first setState — the same pattern the other panels use.
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const dirty =
    Boolean(saved) &&
    Boolean(draft) &&
    (saved?.enabled !== draft?.enabled || saved?.hours !== draft?.hours);
  const hoursValid =
    Boolean(draft) &&
    Number.isInteger(draft?.hours) &&
    (draft?.hours ?? 0) >= IDLE_MIN_HOURS &&
    (draft?.hours ?? 0) <= IDLE_MAX_HOURS;

  async function save() {
    if (!draft || !hoursValid) return;
    setBusy(true);
    try {
      const res = await fetch("/api/settings/idle-policy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: draft.enabled, hours: draft.hours }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error("Idle policy", data?.error || "Could not save the policy");
        return;
      }
      const next = { enabled: Boolean(data.enabled), hours: Number(data.hours) };
      setSaved(next);
      setDraft(next);
      toast.success(
        "Idle policy saved",
        next.enabled
          ? `Servers with zero players for ${next.hours}h or more are now stopped automatically.`
          : "Automatic idle stops are off."
      );
    } catch {
      toast.error("Idle policy", "Could not reach the panel");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard
      icon="😴"
      title="Idle auto-stop"
      description="Stop servers that report zero players for the whole threshold window. Each stop is recorded in the server's event history."
      actions={
        draft && (
          <Badge tone={draft.enabled ? "success" : "neutral"}>
            {draft.enabled
              ? `Stops after ${draft.hours}h idle`
              : "Disabled"}
          </Badge>
        )
      }
    >
      {!loaded ? (
        <p className="text-xs text-text-muted">Loading…</p>
      ) : unavailable || !draft || !saved ? (
        <p className="text-xs text-text-muted">
          Only full administrators can change the idle policy.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-text-muted">
              <span className="mb-1 block">Stop after</span>
              <input
                type="number"
                min={IDLE_MIN_HOURS}
                max={IDLE_MAX_HOURS}
                step={1}
                value={Number.isFinite(draft.hours) ? draft.hours : ""}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    hours:
                      e.target.value.trim() === ""
                        ? Number.NaN
                        : Number(e.target.value),
                  })
                }
                className={`w-24 rounded-lg border bg-bg-secondary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/40 ${
                  hoursValid ? "border-border" : "border-danger"
                }`}
                aria-invalid={!hoursValid}
                aria-label="Idle threshold in hours"
              />
            </label>
            <div className="flex flex-wrap gap-1.5 pb-2">
              {IDLE_PRESETS.map((hours) => (
                <button
                  key={hours}
                  type="button"
                  onClick={() => setDraft({ ...draft, hours })}
                  className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                    draft.hours === hours
                      ? "border-accent/50 bg-accent/15 text-accent"
                      : "border-border bg-bg-secondary text-text-muted hover:text-text-primary"
                  }`}
                >
                  {hours}h
                </button>
              ))}
            </div>
            <span className="pb-2 text-xs text-text-muted">
              of zero players
            </span>
          </div>

          {!hoursValid && (
            <p role="alert" className="text-[11px] font-medium text-danger">
              Enter a whole number of hours between {IDLE_MIN_HOURS} and{" "}
              {IDLE_MAX_HOURS}.
            </p>
          )}

          <button
            type="button"
            role="switch"
            aria-checked={draft.enabled}
            onClick={() => setDraft({ ...draft, enabled: !draft.enabled })}
            className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
              draft.enabled
                ? "border-success/40 bg-success/15 text-success"
                : "border-border bg-bg-tertiary text-text-secondary hover:bg-bg-hover"
            }`}
          >
            <span
              aria-hidden
              className={`relative inline-flex h-5 w-9 rounded-full transition-colors ${
                draft.enabled ? "bg-success" : "bg-bg-hover"
              }`}
            >
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
                  draft.enabled ? "left-[18px]" : "left-0.5"
                }`}
              />
            </span>
            {draft.enabled ? "Enabled" : "Disabled"}
          </button>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy || !dirty || !hoursValid}
              className={BTN.primary}
            >
              {busy ? "Saving…" : dirty ? "Save idle policy" : "Saved"}
            </button>
            <button
              type="button"
              onClick={() => setDraft(saved)}
              disabled={busy || !dirty}
              className={BTN.secondary}
            >
              Discard
            </button>
            {dirty && <span className="text-[11px] text-accent">Unsaved change</span>}
          </div>
        </div>
      )}
    </SectionCard>
  );
}

interface DigestTask {
  id: number;
  taskType: string;
  enabled: boolean | null;
  nextRun: string | null;
}

/**
 * Weekly fleet digest.
 *
 * The digest is a real scheduler task, so this reads it back rather than
 * keeping a local flag — if somebody deletes it in the Scheduler panel, this
 * screen says so instead of claiming it is scheduled.
 */
export function FleetDigestBlock() {
  const toast = useToast();
  const [task, setTask] = useState<DigestTask | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/scheduler");
      if (!res.ok) {
        setUnavailable(true);
        return;
      }
      const data = await res.json();
      const tasks = (data.tasks ?? []) as DigestTask[];
      setTask(tasks.find((t) => t.taskType === "fleet-digest" && t.enabled !== false) ?? null);
    } catch {
      setUnavailable(true);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    // Deferred one turn so the mount render finishes before the fetch's
    // first setState — the same pattern the other panels use.
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function toggle() {
    setBusy(true);
    try {
      if (task) {
        const res = await fetch(`/api/scheduler/${task.id}`, { method: "DELETE" });
        if (!res.ok) {
          const d = await res.json().catch(() => null);
          toast.error("Fleet digest", d?.error || "Could not unschedule");
          return;
        }
        setTask(null);
        toast.success("Fleet digest", "The weekly digest is no longer scheduled.");
        return;
      }

      const res = await fetch("/api/scheduler", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskType: "fleet-digest",
          serverId: null,
          cronExpression: "0 9 * * 1",
          enabled: true,
        }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error("Fleet digest", d?.error || "Could not schedule the digest");
        return;
      }
      setTask(d.task ?? null);
      void load();
      toast.success(
        "Fleet digest scheduled",
        "Every Monday at 09:00 the fleet summary goes to the panel Discord webhook and any outbound webhooks."
      );
    } catch {
      toast.error("Fleet digest", "Could not reach the panel");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard
      icon="📬"
      title="Weekly fleet digest"
      description="Servers running, crashes, watchdog stops, idle auto-stops and the three least-stable servers — every Monday at 09:00, to Discord and to any outbound webhook."
      actions={
        task ? (
          <Badge tone="success">
            {task.nextRun
              ? `Next: ${new Date(task.nextRun).toLocaleString()}`
              : "Scheduled"}
          </Badge>
        ) : (
          <Badge tone="neutral">Not scheduled</Badge>
        )
      }
    >
      {!loaded ? (
        <p className="text-xs text-text-muted">Checking the schedule…</p>
      ) : unavailable ? (
        <p className="text-xs text-text-muted">
          Reading the schedule needs the scheduler permission. You can still
          manage it under <b>Scheduler</b>.
        </p>
      ) : (
        <button
          type="button"
          onClick={() => void toggle()}
          disabled={busy}
          className={task ? BTN.success : BTN.secondary}
        >
          {busy
            ? "Working…"
            : task
              ? "✅ Scheduled — click to unschedule"
              : "Schedule the weekly digest"}
        </button>
      )}
    </SectionCard>
  );
}

interface AlertMute {
  mutedUntil: string | null;
  remaining: string | null;
}

/** Quiet window for host threshold alerts during planned maintenance. */
export function AlertMuteBlock() {
  const toast = useToast();
  const [mute, setMute] = useState<AlertMute | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/settings/alert-mute");
        if (res.ok && !cancelled) setMute(await res.json());
      } catch {
        /* non-admins simply see nothing */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function setMuteFor(hours: number | null) {
    setBusy(true);
    try {
      const res = await fetch("/api/settings/alert-mute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(hours === null ? { clear: true } : { hours }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error("Alert mute", data?.error || "Could not update the mute window");
        return;
      }
      setMute(data);
      toast.success(
        "Alert mute",
        hours === null
          ? "Threshold alerts are back on."
          : `Threshold alerts muted for ${hours}h.`
      );
    } catch {
      toast.error("Alert mute", "Could not reach the panel");
    } finally {
      setBusy(false);
    }
  }

  if (!mute) return null;

  return (
    <SectionCard
      icon="🔕"
      title="Quiet during planned work"
      description="Mute host threshold alerts for a while — a big update or a migration is expected to be loud."
    >
      <div className="flex flex-wrap items-center gap-2">
        {mute.mutedUntil ? (
          <>
            <Badge tone="warning">🔕 Muted — {mute.remaining} left</Badge>
            <button
              type="button"
              onClick={() => void setMuteFor(null)}
              disabled={busy}
              className={BTN.secondary}
            >
              Unmute now
            </button>
          </>
        ) : (
          <>
            <span className="text-xs text-text-muted">Mute for</span>
            {[1, 4, 24].map((hours) => (
              <button
                key={hours}
                type="button"
                onClick={() => void setMuteFor(hours)}
                disabled={busy}
                className={BTN.secondary}
              >
                {hours}h
              </button>
            ))}
          </>
        )}
      </div>
    </SectionCard>
  );
}
