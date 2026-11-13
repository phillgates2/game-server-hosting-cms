/**
 * Live progress for game-server installs and updates.
 *
 * Installs and updates are long, synchronous requests: the panel runs a bash
 * script (SteamCMD, curl, tar…) and only answers when it exits. Until now the
 * UI had nothing to show for the 2–40 minutes in between except a disabled
 * button. This module turns the script's own output into a status meter:
 *
 *   - `parseProgressLine` is a pure classifier that recognises what the
 *     common downloaders print (SteamCMD "Update state … progress: 42.10
 *     (123 / 456)", curl/wget progress bars, apt, and the templates' own
 *     "Downloading X…" / "═══ Installing mod ═══" announcements).
 *   - an in-memory store keyed by server id keeps the current phase, the item
 *     being downloaded, percent, bytes, speed, ETA and a short log tail. The
 *     UI polls it through GET /api/servers/[id]/progress.
 *   - `withProgressHelpers` adds a tiny bash shim to the script so file
 *     downloads made with `curl -s` still announce themselves and report a
 *     percentage (the templates silence curl, which would leave the meter
 *     with nothing to read).
 *
 * The store is process-local on purpose: progress is ephemeral, the panel
 * runs as a single Node process, and nothing here is worth a DB write every
 * second. A restart mid-install simply loses the meter, not the install.
 */

export type ProgressKind = "install" | "update";

export type ProgressPhase =
  | "preparing"
  | "backup"
  | "downloading"
  | "verifying"
  | "extracting"
  | "installing"
  | "configuring"
  | "finalizing"
  | "done"
  | "failed";

export interface ProgressSignal {
  phase?: ProgressPhase;
  /** One-line human description of the current step. */
  label?: string;
  /** What is being downloaded/installed right now (file, package, app). */
  item?: string;
  /** 0–100 for the current step; null resets to "unknown". */
  percent?: number | null;
  bytesDone?: number;
  bytesTotal?: number;
  /** True for high-frequency meter lines that should not flood the log tail. */
  transient?: boolean;
}

export interface ProgressState {
  serverId: number;
  kind: ProgressKind;
  /** Game / server display name for the header. */
  title: string;
  phase: ProgressPhase;
  label: string;
  item: string | null;
  percent: number | null;
  bytesDone: number | null;
  bytesTotal: number | null;
  bytesPerSec: number | null;
  etaSeconds: number | null;
  startedAt: number;
  updatedAt: number;
  finishedAt: number | null;
  ok: boolean | null;
  error: string | null;
  /** Milestones seen so far, oldest first (bounded). */
  steps: string[];
  /** Tail of the script output (bounded, progress bars collapsed). */
  log: string[];
  /** The script runs on a remote node agent. */
  remote: boolean;
  /** False when a remote agent is too old to stream output. */
  liveOutput: boolean;
}

const MAX_LOG_LINES = 40;
const MAX_STEPS = 12;
const MAX_LINE_LENGTH = 300;
/** Finished entries stay readable this long so the UI can show the outcome. */
const RETAIN_FINISHED_MS = 10 * 60_000;
/** Abandoned (never finished) entries are dropped after this long. */
const RETAIN_STALE_MS = 2 * 60 * 60_000;

// ── Parsing ─────────────────────────────────────────────────────────────────

const ANSI_RE = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

function trimLabel(s: string): string {
  const t = s.trim();
  return t.length > 140 ? `${t.slice(0, 139)}…` : t;
}

const STEAM_STATE: Record<string, { phase: ProgressPhase; label: string }> = {
  reconfiguring: { phase: "preparing", label: "Preparing the update" },
  preallocating: { phase: "preparing", label: "Reserving disk space" },
  downloading: { phase: "downloading", label: "Downloading game files" },
  "verifying install": { phase: "verifying", label: "Verifying installed files" },
  "verifying update": { phase: "verifying", label: "Verifying downloaded files" },
  validating: { phase: "verifying", label: "Verifying installed files" },
  committing: { phase: "installing", label: "Installing downloaded files" },
  staging: { phase: "installing", label: "Staging downloaded files" },
};

const VERB_PHASE: Array<[RegExp, ProgressPhase]> = [
  [/^(downloading|fetching|getting|pulling|trying)\b/i, "downloading"],
  [/^(extracting|unpacking|unzipping|inflating|decompressing)\b/i, "extracting"],
  [/^(verifying|validating|checking)\b/i, "verifying"],
  [/^(configuring|writing|generating)\b/i, "configuring"],
  [/^(installing|updating|setting up|copying|building|compiling|locating|resolving|using)\b/i, "installing"],
];

/**
 * Classify one line of installer output. Returns null for lines that carry
 * no progress information (they still land in the log tail).
 */
export function parseProgressLine(rawLine: string): ProgressSignal | null {
  const line = rawLine.replace(ANSI_RE, "").trim();
  if (!line) return null;

  // SteamCMD app download:
  //   Update state (0x61) downloading, progress: 42.10 (1234 / 5678)
  let m = /Update state \(0x[0-9a-f]+\)\s+([a-z ]+?),\s*progress:\s*([\d.]+)\s*\((\d+)\s*\/\s*(\d+)\)/i.exec(line);
  if (m) {
    const stateText = m[1].trim().toLowerCase();
    const known = STEAM_STATE[stateText];
    const total = Number(m[4]);
    return {
      phase: known?.phase ?? "installing",
      label: known?.label ?? `SteamCMD: ${stateText}`,
      percent: clampPercent(Number(m[2])),
      bytesDone: Number(m[3]),
      bytesTotal: total,
      transient: true,
    };
  }

  // SteamCMD self-update: "[ 45%] Downloading update (1,234 of 56,789 KB)..."
  m = /^\[\s*(\d{1,3})%\]\s*(.+?)(?:\.\.\.)?$/.exec(line);
  if (m) {
    const text = m[2].replace(/\s*\([^)]*\)\s*$/, "").trim();
    const phase: ProgressPhase = /download/i.test(text)
      ? "downloading"
      : /extract/i.test(text)
        ? "extracting"
        : /verif|check/i.test(text)
          ? "verifying"
          : "installing";
    const sig: ProgressSignal = {
      phase,
      label: `SteamCMD: ${text}`,
      item: "SteamCMD",
      percent: clampPercent(Number(m[1])),
      transient: true,
    };
    const kb = /\(([\d,]+) of ([\d,]+) KB\)/.exec(m[2]);
    if (kb) {
      sig.bytesDone = Number(kb[1].replace(/,/g, "")) * 1024;
      sig.bytesTotal = Number(kb[2].replace(/,/g, "")) * 1024;
    }
    return sig;
  }

  m = /Success! App '(\d+)' (fully installed|already up to date)/i.exec(line);
  if (m) {
    return {
      phase: "finalizing",
      label: m[2].toLowerCase() === "already up to date" ? "Already up to date" : "Game files installed",
      percent: 100,
    };
  }

  if (/^Logging in user|^Connecting anonymously to Steam|^Loading Steam API/i.test(line)) {
    return { phase: "preparing", label: "Connecting to Steam" };
  }

  // curl --progress-bar: "#############            45.3%"
  m = /^[#=\-O\s]*?(\d{1,3}(?:[.,]\d+)?)\s?%$/.exec(line);
  if (m) {
    return { phase: "downloading", percent: clampPercent(Number(m[1].replace(",", "."))), transient: true };
  }

  // curl's bar for downloads of unknown size is a spinner: "##O#- #"
  if (/^[#=\-O ]{3,}$/.test(line) && /[#O]/.test(line)) return { phase: "downloading", transient: true };

  // wget dot style: "  1050K .......... .......... 12% 1.2M 3s"
  m = /^\d+[KMG]?\s+[. ]+\s(\d{1,3})%/.exec(line);
  if (m) return { phase: "downloading", percent: clampPercent(Number(m[1])), transient: true };

  // wget bar style: "file.zip   45%[=====>     ] 12.3M  1.2MB/s"
  m = /^(\S+)\s+(\d{1,3})%\s?\[/.exec(line);
  if (m) return { phase: "downloading", item: m[1], percent: clampPercent(Number(m[2])), transient: true };

  // apt / dpkg
  m = /^Get:\d+\s+\S+\s+\S+\s+\S+\s+(\S+)/.exec(line);
  if (m) return { phase: "downloading", item: m[1], label: `Downloading package ${m[1]}`, percent: null };
  m = /^(Unpacking|Setting up)\s+(\S+)/.exec(line);
  if (m) {
    return {
      phase: m[1] === "Unpacking" ? "extracting" : "installing",
      item: m[2],
      label: `${m[1]} ${m[2]}`,
      percent: null,
    };
  }

  // The panel's own wrapper banners.
  if (/^=== GameServer Manager Install ===$/.test(line)) return { phase: "preparing", label: "Starting the installer" };
  if (/^=== Installation Complete ===$/.test(line)) return { phase: "finalizing", label: "Download finished", percent: 100 };
  if (/^Update complete$/i.test(line)) return { phase: "finalizing", label: "Update finished", percent: 100 };

  // Decorated section headers: "═══ Installing mod: legacy ═══", "=== X ===", "→ Using …"
  m = /^(?:[═=─\-#*]{2,}\s*)(.+?)(?:\s*[═=─\-#*]{2,})$/.exec(line) || /^(?:→|=>|->|>>)\s*(.+)$/.exec(line);
  if (m) {
    const text = trimLabel(m[1]);
    if (/[A-Za-z]/.test(text)) return { phase: phaseForVerb(text) ?? undefined, label: text, percent: null };
  }

  // Plain announcements from the templates: "Downloading foo.zip...",
  // "Installing Valheim (AppID: 896660)...", "Verifying sha256 (…)..."
  const phase = phaseForVerb(line);
  if (phase && line.length <= 200) {
    const text = trimLabel(line.replace(/\s*(\.\.\.|…)\s*$/, ""));
    const sig: ProgressSignal = { phase, label: text, percent: null };
    const named = /^(?:downloading|fetching|installing|updating)\s+(.+)$/i.exec(text);
    if (named) sig.item = trimLabel(named[1]);
    return sig;
  }

  return null;
}

function phaseForVerb(text: string): ProgressPhase | null {
  for (const [re, phase] of VERB_PHASE) if (re.test(text)) return phase;
  return null;
}

/**
 * Drop carriage-return progress redraws ("###  12%\r###  13%\r…") from
 * captured output, keeping only the final state of each line. Without this a
 * one-minute curl download buries the real output under kilobytes of bars.
 */
export function collapseCarriageReturns(text: string): string {
  if (!text.includes("\r")) return text;
  return text.replace(/[^\n\r]*\r(?!\n)/g, "");
}

// ── Script shim ─────────────────────────────────────────────────────────────

/**
 * Bash prelude that makes silent curl *file* downloads visible.
 *
 * The templates call `curl -fsSL -o file URL`; `-s` hides curl's meter, so a
 * 400 MB download would show nothing at all. This wraps curl for the duration
 * of the script: when a call writes to a file (or fetches something that is
 * obviously an archive) it prints "Downloading <name>..." and re-enables the
 * one-line progress bar on stderr. Metadata calls (JSON APIs, HEAD probes,
 * anything captured into a variable) are passed through untouched, so their
 * output and any `2>&1` capture stay byte-for-byte the same.
 */
export const PROGRESS_SHIM = `# --- GSM progress helpers (status meter) ---
curl() {
  local __gsm_a __gsm_out=0 __gsm_head=0 __gsm_url=""
  for __gsm_a in "$@"; do
    case "$__gsm_a" in
      -I|--head|-[!-]*I*) __gsm_head=1 ;;
    esac
    case "$__gsm_a" in
      -o|-O|--output|--remote-name|--remote-name-all|-[!-]*[oO]*) __gsm_out=1 ;;
      http://*|https://*|ftp://*) __gsm_url="$__gsm_a" ;;
    esac
  done
  if [ "$__gsm_out" = "0" ]; then
    case "\${__gsm_url%%\\?*}" in
      *.zip|*.tar|*.tar.gz|*.tgz|*.tar.xz|*.txz|*.tar.bz2|*.tbz2|*.7z|*.jar|*.AppImage|*.deb|*.rpm|*.pk3|*.run|*.exe) __gsm_out=1 ;;
    esac
  fi
  if [ "$__gsm_head" = "1" ] || [ "$__gsm_out" = "0" ] || [ -z "$__gsm_url" ]; then
    command curl "$@"
    return $?
  fi
  local __gsm_name="\${__gsm_url%%\\?*}"
  __gsm_name="\${__gsm_name%/}"
  __gsm_name="\${__gsm_name##*/}"
  [ -n "$__gsm_name" ] || __gsm_name="$__gsm_url"
  echo "Downloading $__gsm_name..." >&2
  command curl "$@" --no-silent --progress-bar
}
# --- end GSM progress helpers ---
`;

/** Insert the progress shim after the script's shebang (or at the top). */
export function withProgressHelpers(script: string): string {
  if (script.includes("# --- GSM progress helpers")) return script;
  if (script.startsWith("#!")) {
    const nl = script.indexOf("\n");
    if (nl === -1) return `${script}\n${PROGRESS_SHIM}`;
    return `${script.slice(0, nl + 1)}${PROGRESS_SHIM}${script.slice(nl + 1)}`;
  }
  return `${PROGRESS_SHIM}${script}`;
}

// ── Store ───────────────────────────────────────────────────────────────────

interface Entry {
  state: ProgressState;
  token: number;
  /** Unterminated tail of the last chunk. */
  partial: string;
  lastLogTransient: boolean;
  /** Byte samples for the speed estimate. */
  sampleAt: number;
  sampleBytes: number;
  remote?: RemoteSource;
}

export interface RemoteSource {
  /** Fetch output produced since `offset` from the node agent. */
  fetchOutput: (offset: number) => Promise<{ output: string; offset: number } | null>;
  offset: number;
  lastPollAt: number;
  polling: boolean;
}

interface Store {
  entries: Map<number, Entry>;
  nextToken: number;
}

const globalStore = globalThis as unknown as { __gsmInstallProgress?: Store };

function store(): Store {
  if (!globalStore.__gsmInstallProgress) {
    globalStore.__gsmInstallProgress = { entries: new Map(), nextToken: 1 };
  }
  return globalStore.__gsmInstallProgress;
}

function sweep(now: number) {
  for (const [id, e] of store().entries) {
    const s = e.state;
    if (s.finishedAt !== null ? now - s.finishedAt > RETAIN_FINISHED_MS : now - s.updatedAt > RETAIN_STALE_MS) {
      store().entries.delete(id);
    }
  }
}

/**
 * Start tracking a run. Returns a token; pass it to the other calls so a
 * stale or rejected request can never overwrite a newer run's meter.
 */
export function beginProgress(opts: {
  serverId: number;
  kind: ProgressKind;
  title: string;
  remote?: boolean;
  now?: number;
}): number {
  const now = opts.now ?? Date.now();
  sweep(now);
  const s = store();
  const token = s.nextToken++;
  s.entries.set(opts.serverId, {
    token,
    partial: "",
    lastLogTransient: false,
    sampleAt: now,
    sampleBytes: 0,
    state: {
      serverId: opts.serverId,
      kind: opts.kind,
      title: opts.title,
      phase: "preparing",
      label: opts.kind === "install" ? "Preparing the install" : "Preparing the update",
      item: null,
      percent: null,
      bytesDone: null,
      bytesTotal: null,
      bytesPerSec: null,
      etaSeconds: null,
      startedAt: now,
      updatedAt: now,
      finishedAt: null,
      ok: null,
      error: null,
      steps: [],
      log: [],
      remote: Boolean(opts.remote),
      liveOutput: true,
    },
  });
  return token;
}

function entryFor(serverId: number, token: number): Entry | null {
  const e = store().entries.get(serverId);
  if (!e || e.token !== token || e.state.finishedAt !== null) return null;
  return e;
}

function pushStep(state: ProgressState, label: string) {
  if (state.steps[state.steps.length - 1] === label) return;
  state.steps.push(label);
  if (state.steps.length > MAX_STEPS) state.steps.splice(0, state.steps.length - MAX_STEPS);
}

function applySignal(e: Entry, sig: ProgressSignal, now: number) {
  const s = e.state;
  const phaseChanged = sig.phase !== undefined && sig.phase !== s.phase;
  const labelChanged = sig.label !== undefined && sig.label !== s.label;

  if (sig.phase) s.phase = sig.phase;
  if (sig.label) {
    s.label = sig.label;
    if (labelChanged) pushStep(s, sig.label);
  }
  if (sig.item !== undefined) s.item = sig.item;

  // A new step starts with unknown progress unless the line says otherwise.
  if ((phaseChanged || (labelChanged && !sig.transient)) && sig.percent === undefined) {
    s.percent = null;
  }
  if (sig.percent !== undefined) s.percent = sig.percent;

  const hasBytes = sig.bytesDone !== undefined && sig.bytesTotal !== undefined && sig.bytesTotal > 0;
  if (hasBytes) {
    const done = sig.bytesDone!;
    const restarted = phaseChanged || s.bytesDone === null || done < s.bytesDone || sig.bytesTotal !== s.bytesTotal;
    s.bytesDone = done;
    s.bytesTotal = sig.bytesTotal!;
    if (restarted) {
      e.sampleAt = now;
      e.sampleBytes = done;
      s.bytesPerSec = null;
      s.etaSeconds = null;
    } else if (now - e.sampleAt >= 1000) {
      const rate = ((done - e.sampleBytes) * 1000) / (now - e.sampleAt);
      // Smooth so one slow tick does not swing the ETA.
      s.bytesPerSec = s.bytesPerSec === null ? rate : s.bytesPerSec * 0.6 + rate * 0.4;
      e.sampleAt = now;
      e.sampleBytes = done;
      s.etaSeconds =
        s.bytesPerSec > 1 && s.phase === "downloading"
          ? Math.round((s.bytesTotal - done) / s.bytesPerSec)
          : null;
    }
  } else if (phaseChanged || (labelChanged && !sig.transient)) {
    s.bytesDone = null;
    s.bytesTotal = null;
    s.bytesPerSec = null;
    s.etaSeconds = null;
  }
}

function ingestLine(e: Entry, rawLine: string, now: number) {
  const line = rawLine.replace(ANSI_RE, "").replace(/\s+$/, "");
  if (!line.trim()) return;
  const sig = parseProgressLine(line);
  if (sig) applySignal(e, sig, now);

  const transient = Boolean(sig?.transient);
  const shown = line.length > MAX_LINE_LENGTH ? `${line.slice(0, MAX_LINE_LENGTH)}…` : line;
  const log = e.state.log;
  // Consecutive meter lines overwrite each other, like a terminal would.
  if (transient && e.lastLogTransient && log.length > 0) log[log.length - 1] = shown;
  else log.push(shown);
  if (log.length > MAX_LOG_LINES) log.splice(0, log.length - MAX_LOG_LINES);
  e.lastLogTransient = transient;
}

/** Feed raw stdout/stderr from the running script. */
export function feedProgress(serverId: number, token: number, chunk: string | Buffer, now = Date.now()): void {
  const e = entryFor(serverId, token);
  if (!e) return;
  const text = e.partial + (typeof chunk === "string" ? chunk : chunk.toString("utf8"));
  const parts = text.split(/\r\n|\n|\r/);
  e.partial = parts.pop() ?? "";
  // A runaway line without a terminator must not grow without bound.
  if (e.partial.length > 4000) e.partial = e.partial.slice(-4000);
  for (const part of parts) ingestLine(e, part, now);
  e.state.updatedAt = now;
}

/** Announce a panel-side step (backup, writing configs, verification…). */
export function setProgressStage(
  serverId: number,
  token: number,
  phase: ProgressPhase,
  label: string,
  now = Date.now()
): void {
  const e = entryFor(serverId, token);
  if (!e) return;
  applySignal(e, { phase, label, percent: null, item: undefined }, now);
  e.state.item = null;
  e.state.updatedAt = now;
}

export function finishProgress(
  serverId: number,
  token: number,
  result: { ok: boolean; error?: string | null },
  now = Date.now()
): void {
  const e = entryFor(serverId, token);
  if (!e) return;
  if (e.partial) {
    ingestLine(e, e.partial, now);
    e.partial = "";
  }
  const s = e.state;
  s.finishedAt = now;
  s.updatedAt = now;
  s.ok = result.ok;
  s.bytesPerSec = null;
  s.etaSeconds = null;
  if (result.ok) {
    s.phase = "done";
    s.percent = 100;
    s.label = s.kind === "install" ? "Installation complete" : "Update complete";
    s.error = null;
  } else {
    s.phase = "failed";
    s.error = (result.error || "Failed").slice(0, 500);
    s.label = s.kind === "install" ? "Installation failed" : "Update failed";
  }
  pushStep(s, s.label);
  e.remote = undefined;
}

/** Attach a remote output source (node agent) to a run. */
export function attachRemoteSource(
  serverId: number,
  token: number,
  fetchOutput: RemoteSource["fetchOutput"]
): void {
  const e = entryFor(serverId, token);
  if (!e) return;
  e.remote = { fetchOutput, offset: 0, lastPollAt: 0, polling: false };
  e.state.remote = true;
}

/**
 * Pull fresh output from the remote agent (at most once a second). Called by
 * the progress endpoint just before it answers, so remote progress costs
 * nothing while nobody is watching.
 */
export async function pollRemoteProgress(serverId: number, now = Date.now()): Promise<void> {
  const e = store().entries.get(serverId);
  const r = e?.remote;
  if (!e || !r || e.state.finishedAt !== null || r.polling || now - r.lastPollAt < 1000) return;
  r.polling = true;
  r.lastPollAt = now;
  try {
    const res = await r.fetchOutput(r.offset);
    if (res === null) {
      // Agent predates /rpc/install-progress: stop asking, say so in the UI.
      e.state.liveOutput = false;
      e.remote = undefined;
      return;
    }
    r.offset = res.offset;
    if (res.output) feedProgress(serverId, e.token, res.output);
  } catch {
    /* transient network error — try again on the next poll */
  } finally {
    r.polling = false;
  }
}

/** Snapshot for the API (a copy — callers may not mutate the store). */
export function getProgress(serverId: number, now = Date.now()): ProgressState | null {
  sweep(now);
  const e = store().entries.get(serverId);
  if (!e) return null;
  return { ...e.state, steps: [...e.state.steps], log: [...e.state.log] };
}

/** Test helper. */
export function resetProgressStore(): void {
  store().entries.clear();
}
