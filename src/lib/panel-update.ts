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
 *   - The updater only starts publishing once it is about to change something.
 *     Before that — sudo, the fetch, the pre-flight checks — the panel has only
 *     its own account of what it launched: a launch record and the launched
 *     process's output, kept where the panel's user can write. `resolveUpdateStatus`
 *     decides which of the two accounts is the truth at any moment.
 *
 * Parsing, the status decision and the command construction below are pure and
 * unit-tested.
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
 * Where the panel keeps its own account of an update it started: the output of
 * the process it launched (a sudo refusal, a failed fetch, a pre-flight check
 * that said no) and a note of when it launched it.
 *
 * Deliberately NOT the updater's state directory. That one belongs to root: the
 * panel can read it and nothing else. The button first redirected the launch
 * output into it, the shell could not create the file, and a failed redirect
 * means the command is never executed — so the button reported "started" and
 * nothing ran. The panel's log directory is created by the installer and owned
 * by the panel's user.
 */
export const DEFAULT_UPDATE_LAUNCH_DIR = "/var/log/gsm-panel";
export const UPDATE_LAUNCH_LOG_NAME = "panel-update-launch.log";
export const UPDATE_LAUNCH_RECORD_NAME = "panel-update-launch.json";
/**
 * How long a launch whose process cannot be checked may stay silent before it
 * is called failed. Generous: the fetch happens before the first progress.
 */
export const UPDATE_LAUNCH_GRACE_MS = 2 * 60 * 1000;
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

/**
 * The panel's note of an update it launched. Written by the panel, for the
 * panel: the updater never reads it.
 */
export interface UpdateLaunch {
  /** When the panel launched the updater. */
  launchedAt: string;
  /** The detached updater process, when the launcher reported one. */
  pid: number | null;
  /**
   * That process's kernel start time (clock ticks since boot). A process id is
   * reused eventually; the pair is not, so a later stranger with the same id
   * is not mistaken for the updater.
   */
  startTime: string | null;
  noBackup: boolean;
  /** Whether the launched process's output was captured beside this record. */
  logged: boolean;
  /** Why the launch failed, when the panel itself knows (it could not run the launcher). */
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

/** Linux never hands out a process id above this (PID_MAX_LIMIT). */
const MAX_PROCESS_ID = 4_194_304;

/** Parse the panel's launch record. Malformed is `null`, as for the state file. */
export function parseUpdateLaunch(raw: unknown): UpdateLaunch | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;

  const launchedAt = isoDate(input.launchedAt);
  if (!launchedAt) return null;

  // The id is only ever probed with signal 0, but 0, 1 and negative ids mean
  // "a whole group" or "init" to kill(2), which is never what was launched.
  const pidRaw = input.pid;
  const pid =
    typeof pidRaw === "number" && Number.isInteger(pidRaw) && pidRaw > 1 && pidRaw <= MAX_PROCESS_ID
      ? pidRaw
      : null;
  const startRaw = input.startTime;
  const startTime = typeof startRaw === "string" && /^\d{1,24}$/.test(startRaw) ? startRaw : null;

  return {
    launchedAt,
    pid,
    startTime,
    noBackup: input.noBackup === true,
    logged: input.logged === true,
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

/**
 * "Step 3/7: Installing dependencies" — or just what is happening, before the
 * first step: there is no step number to show yet, and "Step 0/7" reads as stuck.
 */
export function updateStepLabel(state: UpdateState): string {
  const what = state.message || state.phase;
  return state.step > 0 ? `Step ${state.step}/${state.totalSteps}: ${what}` : what;
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
      title: state.phase === "starting" ? "Starting the update…" : "Updating the panel…",
      detail: `${updateStepLabel(state)}. The panel restarts at the end, so this page will reconnect.`,
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

  // The updater stopped before its first step: the panel was never stopped and
  // is still running the version it was. Say that, rather than "failed", which
  // reads as "half-applied".
  if (state.phase === "launch") {
    return {
      tone: "failed",
      title: "The update did not start",
      detail: [
        state.error || state.message,
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
 * PM2 stops the panel by killing its whole process tree, so anything still
 * parented to the panel dies with it. The updater therefore runs under
 * `setsid nohup … &` from a shell that exits immediately: it is reparented away
 * from the panel before the restart can reach it.
 *
 * The line redirects no output, on purpose. A shell performs a redirect before
 * it executes the command, and when the redirect fails the command never runs
 * — while the launching shell, having backgrounded it, still exits 0. That is
 * how the button once reported "started" without starting anything. The caller
 * passes an already-open log (or nothing at all) as this shell's stdout and
 * stderr instead, so starting the updater cannot depend on a file.
 *
 * File descriptor 3 carries one line back: the process id of the detached
 * command, which is what lets the panel tell "still starting" from "exited
 * without doing anything". The command itself gets that descriptor closed, so
 * the caller's read ends the moment this shell exits.
 */
export function detachedUpdateCommand(command: UpdateCommand): { file: string; args: string[] } {
  const line = [
    "setsid",
    "nohup",
    [command.file, ...command.args].map(shellQuote).join(" "),
    "< /dev/null 3>&- &",
    'echo "$!" >&3',
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

/** The lines of output that say something. */
function meaningfulLines(text: string): string[] {
  return (text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    // Rules and box edges from the updater's own banner are not an explanation.
    .filter((line) => line !== "" && !/^[-=\s\u2500-\u257f]+$/.test(line));
}

/** How the updater prefixes its lines: log, ok, warn and err in public/update.sh. */
const OUTPUT_MARK = /^\[(?:GSM|✓|!|✗)\]\s*/;
const ERROR_MARK = /^\[✗\]\s*/;

/**
 * Why a launch stopped, in the updater's own words.
 *
 * The updater marks what went wrong with "[✗]", and often says it in two
 * lines — what is wrong, then what to do about it — with detail in between:
 *
 *   [✗] Local tracked code changes would be overwritten:
 *    M README.md
 *   [✗] Commit or back up those changes, then run the updater again.
 *
 * The last line alone is advice without a problem, so the marked lines are
 * read together. Output with no such line — sudo's refusal, the helper's — is
 * somebody else's, and there the last line is the message.
 */
export function launchFailureReason(launchLog: string, max = 300): string {
  const lines = meaningfulLines(launchLog);
  const marked = lines
    .filter((line) => ERROR_MARK.test(line))
    .map((line) => line.replace(ERROR_MARK, "").trim())
    .filter(Boolean)
    .slice(-3);
  if (marked.length > 0) return marked.join(" ").slice(0, max);
  return lines.length > 0 ? lines[lines.length - 1].replace(OUTPUT_MARK, "").slice(0, max) : "";
}

/** What a launch that printed nothing is reported with. */
export const UPDATE_SILENT_LAUNCH_ERROR =
  "The updater exited without printing anything. Run it from a shell to see why.";

function emptyState(): Omit<UpdateState, "status" | "phase" | "message"> {
  return {
    step: 0,
    totalSteps: TOTAL_UPDATE_STEPS,
    startedAt: null,
    updatedAt: null,
    finishedAt: null,
    branch: null,
    fromCommit: null,
    toCommit: null,
    exitCode: null,
    error: null,
  };
}

/**
 * The seconds between the click and the updater's first published step: sudo,
 * the fetch, the pre-flight checks. Something honest to show, and the reason a
 * second click is refused.
 */
export function launchStartingState(launch: UpdateLaunch): UpdateState {
  return {
    ...emptyState(),
    status: "running",
    phase: "starting",
    message: "Fetching the latest code and checking the installation",
    startedAt: launch.launchedAt,
    // Deliberately the launch time, not "now": a launch that hangs here for
    // longer than UPDATE_STALE_MS is reported as stale like any other run.
    updatedAt: launch.launchedAt,
  };
}

/**
 * The launched process is gone and the updater never published a step. The
 * attempt failed — say so with what it printed, instead of showing whatever the
 * previous run left behind, or nothing.
 */
export function launchFailureState(launch: UpdateLaunch, launchLog: string): UpdateState {
  return {
    ...emptyState(),
    status: "failed",
    phase: "launch",
    message: "The updater stopped before its first step",
    startedAt: launch.launchedAt,
    updatedAt: launch.launchedAt,
    finishedAt: launch.launchedAt,
    error: launch.error || launchFailureReason(launchLog) || UPDATE_SILENT_LAUNCH_ERROR,
  };
}

function latestTimestamp(state: UpdateState): number {
  const times = [state.startedAt, state.updatedAt, state.finishedAt]
    .map((value) => Date.parse(value ?? ""))
    .filter((ms) => !Number.isNaN(ms));
  return times.length > 0 ? Math.max(...times) : Number.NaN;
}

/** Is the state's newest stamp at or after `sinceMs`? */
function stampedSince(state: UpdateState | null, sinceMs: number): boolean {
  if (!state || Number.isNaN(sinceMs)) return false;
  const latest = latestTimestamp(state);
  return !Number.isNaN(latest) && latest >= sinceMs;
}

/**
 * Did the updater write this state after the panel launched it?
 *
 * The updater stamps whole seconds, rounded down. A stamp in the launch's own
 * second is therefore ambiguous: written just after the launch, or just before
 * it by the run that came before. Only a stamp in a later second proves "after"
 * — and taking the earlier run's result for this one is the worse mistake: it
 * would show a stale verdict and leave the button free to start a second
 * updater on top of the first. A run that publishes within its first second is
 * not lost by this: while it is going, `resolveUpdateStatus` shows it because
 * it is running, and its next stamp is in a later second.
 *
 * Any of the three timestamps counts — a run keeps touching `updatedAt`, so one
 * that is still going is recognised even if the clock was stepped at its start.
 */
export function stateIsFromLaunch(state: UpdateState | null, launch: UpdateLaunch): boolean {
  return stampedSince(state, Math.ceil(Date.parse(launch.launchedAt) / 1000) * 1000);
}

export interface ResolvedUpdateStatus {
  /** What the Updates tab should show. */
  state: UpdateState | null;
  /** The output that explains `state`. */
  logTail: string;
  /** Whose account `state` is: the updater's own file, or the panel's launch record. */
  source: "updater" | "launch";
}

/**
 * Decide what is true about the panel's update, from two accounts of it.
 *
 * The updater's state file is the authority once the updater has written to it
 * — it survives the restart and it is written by the process doing the work.
 * But the updater publishes nothing until it is about to change something, and
 * a launch can end before that: sudo refuses, the fetch fails, a pre-flight
 * check says no. Looking at the state file alone, such an attempt is invisible:
 * the tab keeps showing the previous run's result (or "never run") beside a
 * button that apparently does nothing. So until the updater has published a
 * state newer than the launch, the panel's own launch record speaks:
 *
 *   - the launched process is still there  → "starting"
 *   - it is gone                           → the launch failed, with its output
 */
export function resolveUpdateStatus(input: {
  /** The updater's published state, if any. */
  stored: UpdateState | null;
  /** The panel's record of the last update it launched, if any. */
  launch: UpdateLaunch | null;
  /** Whether the launched process still exists; null when that cannot be told. */
  launchAlive: boolean | null;
  /** Tail of the updater's stable log. */
  updaterLog: string;
  /** Tail of the launched process's output. */
  launchLog: string;
  nowMs: number;
}): ResolvedUpdateStatus {
  const { stored, launch, updaterLog, launchLog, nowMs } = input;

  const fromUpdater = (ownLaunch: boolean): ResolvedUpdateStatus => ({
    state: stored,
    // The updater's log starts at its first step. If it could not be written
    // or read, the launch output is the same text and better than nothing —
    // but only when it is the output of this very run.
    logTail: updaterLog.trim() ? updaterLog : ownLaunch ? launchLog : "",
    source: "updater",
  });

  if (!launch) return fromUpdater(false);

  // The updater has taken over.
  if (stateIsFromLaunch(stored, launch)) return fromUpdater(true);

  const launchedMs = Date.parse(launch.launchedAt);

  // A run is demonstrably in progress. Never report "not running" over a live
  // updater: that is how a second one gets started on top of it. It is this
  // launch's own run in its first second — stamped in the launch's second, so
  // not yet provably newer — or one started some other way; only the first may
  // borrow the launch output while the updater's log is still empty.
  if (updateIsRunning(stored, nowMs)) {
    return fromUpdater(stampedSince(stored, Math.floor(launchedMs / 1000) * 1000));
  }

  const alive = launch.error
    ? false
    : (input.launchAlive ?? nowMs - launchedMs <= UPDATE_LAUNCH_GRACE_MS);

  return {
    state: alive ? launchStartingState(launch) : launchFailureState(launch, launchLog),
    logTail: launchLog,
    source: "launch",
  };
}
