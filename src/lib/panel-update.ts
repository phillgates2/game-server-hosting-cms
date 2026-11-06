/**
 * Panel self-update: the contract between the panel and `public/update.sh`.
 *
 * The updater has always existed as a shell command. This module lets the panel
 * offer it as a button without becoming a shell-execution service:
 *
 *   - The panel never passes operator input to the shell. It runs either the
 *     updater with fixed arguments (when the panel itself is root) or a single
 *     root-owned wrapper that accepts one optional flag — see
 *     `selfUpdateCommand`. Nothing here can be turned into `--install-dir /etc`.
 *   - The updater publishes its progress as JSON to a world-readable state file,
 *     because the panel restarts at the end of an update and cannot rely on a
 *     child process handle surviving that. Reading a file also means progress
 *     survives the restart, so the first page load afterwards can say what
 *     happened.
 *
 * Parsing and the command construction below are pure and unit-tested.
 */

/** Where the updater writes its progress (readable by the panel's user). */
export const DEFAULT_UPDATE_STATE_PATH = "/var/lib/gsm-panel-update/state.json";
/** Root-owned helper that runs the updater with fixed arguments. */
export const DEFAULT_SELF_UPDATE_WRAPPER = "/usr/local/bin/gsm-self-update";
/** Steps the updater performs; mirrors TOTAL_STEPS in public/update.sh. */
export const TOTAL_UPDATE_STEPS = 7;
/** A run that has not written progress for this long is abandoned, not running. */
export const UPDATE_STALE_MS = 45 * 60 * 1000;
/**
 * Output that happened before the updater took over — a sudo refusal, a missing
 * helper. It is kept separately because the updater truncates its own log when
 * it starts.
 */
export const DEFAULT_UPDATE_SPAWN_LOG = "/var/lib/gsm-panel-update/spawn.log";
/** Keep log tails small enough to render and to stream on every poll. */
export const UPDATE_LOG_TAIL_BYTES = 12_000;

export type UpdateStatus = "running" | "success" | "failed";

export interface UpdateState {
  status: UpdateStatus;
  phase: string;
  step: number;
  totalSteps: number;
  message: string;
  startedAt: string | null;
  updatedAt: string | null;
  finishedAt: string | null;
  branch: string | null;
  fromCommit: string | null;
  toCommit: string | null;
  exitCode: number | null;
  error: string | null;
}

export interface UpdateTone {
  tone: "none" | "running" | "stale" | "ok" | "failed";
  title: string;
  detail: string;
}

function text(value: unknown, max = 200): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
}

function isoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

function count(value: unknown, max: number): number {
  const n = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.floor(n), max);
}

/**
 * Parse the updater's state file. Anything malformed is `null` rather than a
 * guess: a wrong "success" banner after a failed update is worse than none.
 */
export function parseUpdateState(raw: unknown): UpdateState | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;

  const status = input.status;
  if (status !== "running" && status !== "success" && status !== "failed") return null;

  const totalSteps = count(input.totalSteps, 99) || TOTAL_UPDATE_STEPS;
  const step = Math.min(count(input.step, 99), totalSteps);
  const exitCodeRaw = input.exitCode;
  const exitCode =
    typeof exitCodeRaw === "number" && Number.isFinite(exitCodeRaw)
      ? Math.trunc(exitCodeRaw)
      : null;

  return {
    status,
    phase: text(input.phase, 60) || "unknown",
    step,
    totalSteps,
    message: text(input.message, 300),
    startedAt: isoDate(input.startedAt),
    updatedAt: isoDate(input.updatedAt),
    finishedAt: isoDate(input.finishedAt),
    branch: text(input.branch, 80) || null,
    fromCommit: text(input.fromCommit, 40) || null,
    toCommit: text(input.toCommit, 40) || null,
    exitCode,
    error: text(input.error, 300) || null,
  };
}

/** True when the updater is still working: running, and recently updated. */
export function updateIsRunning(
  state: UpdateState | null,
  nowMs: number,
  staleMs: number = UPDATE_STALE_MS
): boolean {
  if (!state || state.status !== "running") return false;
  const touched = Date.parse(state.updatedAt ?? state.startedAt ?? "");
  // No timestamp at all: assume it is running. The file existing at all means
  // the updater got that far, and a false "not running" would start a second
  // updater on top of the first.
  if (Number.isNaN(touched)) return true;
  return nowMs - touched <= staleMs;
}

/** 0–100, for a progress bar. */
export function updateProgress(state: UpdateState | null): number {
  if (!state) return 0;
  if (state.status === "success") return 100;
  const total = state.totalSteps || TOTAL_UPDATE_STEPS;
  return Math.max(0, Math.min(100, Math.round((state.step / total) * 100)));
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}m ${String(rest).padStart(2, "0")}s`;
}

/** The one sentence the Updates panel shows at the top. */
export function updateSummary(state: UpdateState | null, nowMs: number): UpdateTone {
  if (!state) {
    return {
      tone: "none",
      title: "No update has been run from the panel yet",
      detail: "You can update from here, or with the command line described below.",
    };
  }

  const started = Date.parse(state.startedAt ?? "");
  const finished = Date.parse(state.finishedAt ?? "");
  const duration =
    Number.isNaN(started) || Number.isNaN(finished) ? null : formatDuration(finished - started);

  if (updateIsRunning(state, nowMs)) {
    return {
      tone: "running",
      title: "Updating the panel…",
      detail: `Step ${state.step}/${state.totalSteps}: ${state.message || state.phase}. The panel restarts at the end, so this page will reconnect.`,
    };
  }

  if (state.status === "running") {
    return {
      tone: "stale",
      title: "The last update stopped part-way",
      detail: `It was on step ${state.step}/${state.totalSteps} (${state.phase}) and has not reported since ${formatWhen(state.updatedAt ?? state.startedAt, nowMs)}. Check the log, then run the updater again from a shell.`,
    };
  }

  if (state.status === "success") {
    return {
      tone: "ok",
      title: "The panel updated successfully",
      detail: [
        state.fromCommit && state.toCommit
          ? `${state.fromCommit} → ${state.toCommit}`
          : null,
        duration ? `took ${duration}` : null,
        state.finishedAt ? formatWhen(state.finishedAt, nowMs) : null,
      ]
        .filter(Boolean)
        .join(" · "),
    };
  }

  return {
    tone: "failed",
    title: "The update failed",
    detail: [
      state.error || state.message || `It stopped on step ${state.step}/${state.totalSteps}.`,
      state.exitCode !== null ? `exit code ${state.exitCode}` : null,
      state.finishedAt ? formatWhen(state.finishedAt, nowMs) : null,
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

/** "just now", "12 minutes ago" — a timestamp an operator can act on. */
export function formatWhen(iso: string | null, nowMs: number): string {
  if (!iso) return "an unknown time";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "an unknown time";
  const delta = Math.max(0, nowMs - then);
  if (delta < 60_000) return "just now";
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)} minutes ago`;
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)} hours ago`;
  return `${Math.round(delta / 86_400_000)} days ago`;
}

/** Quote a value for safe embedding in a `bash -c` string. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export interface UpdateCommand {
  file: string;
  args: string[];
}

/**
 * The exact command the panel runs.
 *
 * Root installs call the updater directly. Otherwise the panel calls the
 * root-owned wrapper through passwordless sudo — and that wrapper accepts only
 * `--no-backup`, so an operator can never steer the updater at another
 * directory, branch or repository.
 */
export function selfUpdateCommand(options: {
  isRoot: boolean;
  updaterPath: string;
  wrapperPath?: string;
  noBackup?: boolean;
}): UpdateCommand {
  const noBackup = options.noBackup === true;
  if (options.isRoot) {
    return {
      file: "/bin/bash",
      args: [options.updaterPath, "--force", ...(noBackup ? ["--no-backup"] : [])],
    };
  }

  return {
    file: "sudo",
    args: [
      "-n",
      options.wrapperPath ?? DEFAULT_SELF_UPDATE_WRAPPER,
      ...(noBackup ? ["--no-backup"] : []),
    ],
  };
}

/**
 * Wrap a command so it survives the panel restart it causes.
 *
 * PM2 restarts the panel, and anything still parented to it dies with it. The
 * updater therefore runs under `setsid nohup … &` from a shell that exits
 * immediately: it is reparented away from the panel before the restart can
 * reach it.
 */
export function detachedUpdateCommand(
  command: UpdateCommand,
  logPath: string
): { file: string; args: string[] } {
  const line = [
    "setsid",
    "nohup",
    [command.file, ...command.args].map(shellQuote).join(" "),
    // Truncate: this file only describes the current attempt.
    ">",
    shellQuote(logPath),
    "2>&1",
    "< /dev/null &",
  ].join(" ");

  return { file: "/bin/bash", args: ["-c", line] };
}

/** Whether the button can do anything, and why not when it cannot. */
export function updateAvailability(input: {
  updaterPresent: boolean;
  isRoot: boolean;
  wrapperPresent: boolean;
  sudoAllowed: boolean;
}): { canUpdate: boolean; reason: string | null } {
  if (!input.updaterPresent) {
    return {
      canUpdate: false,
      reason:
        "public/update.sh was not found in this installation, so the panel cannot update itself. Update from a shell instead.",
    };
  }
  if (input.isRoot || input.sudoAllowed) return { canUpdate: true, reason: null };
  if (!input.wrapperPresent) {
    return {
      canUpdate: false,
      reason:
        "The update helper is not installed yet. Run the updater once from a shell (sudo bash public/update.sh) — it installs the helper and the sudo rule, and from then on this button works.",
    };
  }
  return {
    canUpdate: false,
    reason:
      "The panel runs without root and its sudo rule for the update helper is missing. Re-run the updater from a shell to restore it.",
  };
}

/** Parse `.install-info` as data — it is never sourced. */
export function readInstallInfo(text: string | null): {
  version: string | null;
  lastUpdate: string | null;
  port: string | null;
} {
  const out: Record<string, string> = {};
  for (const line of (text ?? "").split(/\r?\n/)) {
    const match = /^([A-Z0-9_]{1,60})=(.*)$/.exec(line.trim());
    if (!match) continue;
    out[match[1]] = match[2].trim().slice(0, 200);
  }
  return {
    version: out.PANEL_VERSION || null,
    lastUpdate: out.LAST_UPDATE || null,
    port: out.PANEL_PORT || out.PORT || null,
  };
}

/** The last line of output that says something, for a launch failure. */
export function lastMeaningfulLine(text: string, max = 300): string {
  const lines = (text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    // Progress noise from the updater's own banner is not an explanation.
    if (/^[-━=─\s]+$/.test(line)) continue;
    return line.slice(0, max);
  }
  return "";
}

/**
 * When the updater never wrote a state file but something was printed, the
 * attempt still failed — say so with the output, instead of pretending nothing
 * happened.
 */
export function stateFromLaunchFailure(spawnLog: string): UpdateState | null {
  const line = lastMeaningfulLine(spawnLog);
  if (!line) return null;
  return {
    status: "failed",
    phase: "launch",
    step: 0,
    totalSteps: TOTAL_UPDATE_STEPS,
    message: "The updater did not start",
    startedAt: null,
    updatedAt: null,
    finishedAt: null,
    branch: null,
    fromCommit: null,
    toCommit: null,
    exitCode: null,
    error: line,
  };
}
