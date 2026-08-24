/**
 * Minimal structured logger.
 *
 * Most of the codebase already tagged its output `[subsystem] message`, which
 * is genuinely useful when grepping a PM2 log — but it was applied by hand, so
 * some call sites had no tag, and none carried a level or a timestamp. Under
 * PM2 every stream lands in one file, which makes untagged lines hard to place
 * and impossible to filter.
 *
 * This keeps the existing human-readable shape by default and adds JSON output
 * for anyone shipping logs somewhere that wants to parse them. No dependency:
 * a logging library would be a lot of weight for what is a formatting concern.
 *
 *   GSM_LOG_FORMAT=json   emit one JSON object per line
 *   GSM_LOG_LEVEL=warn    suppress anything below the given level
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function configuredLevel(): number {
  const raw = (process.env.GSM_LOG_LEVEL || "info").toLowerCase();
  return LEVEL_ORDER[raw as LogLevel] ?? LEVEL_ORDER.info;
}

function jsonOutput(): boolean {
  return (process.env.GSM_LOG_FORMAT || "").toLowerCase() === "json";
}

/** Extra key/value pairs attached to a line. */
export type LogFields = Record<string, unknown>;

/**
 * Reduce an unknown thrown value to something loggable.
 *
 * Errors carry a stack worth keeping; anything else is stringified rather than
 * printed as "[object Object]".
 */
export function describeError(e: unknown): string {
  if (e instanceof Error) return e.stack || e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

function emit(level: LogLevel, subsystem: string, message: string, fields?: LogFields) {
  if (LEVEL_ORDER[level] < configuredLevel()) return;

  const sink =
    level === "error" ? console.error : level === "warn" ? console.warn : console.log;

  if (jsonOutput()) {
    sink(
      JSON.stringify({
        ts: new Date().toISOString(),
        level,
        subsystem,
        message,
        ...(fields ?? {}),
      })
    );
    return;
  }

  // Human format, matching what the codebase already produced so existing
  // greps and runbooks keep working.
  const extra = fields && Object.keys(fields).length
    ? " " +
      Object.entries(fields)
        .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
        .join(" ")
    : "";
  sink(`[${subsystem}] ${message}${extra}`);
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** Log a caught value at error level, preserving its stack. */
  exception(message: string, e: unknown, fields?: LogFields): void;
}

/**
 * A logger bound to one subsystem.
 *
 * `const log = createLogger("discord")` then `log.warn("rate limited")`.
 */
export function createLogger(subsystem: string): Logger {
  return {
    debug: (m, f) => emit("debug", subsystem, m, f),
    info: (m, f) => emit("info", subsystem, m, f),
    warn: (m, f) => emit("warn", subsystem, m, f),
    error: (m, f) => emit("error", subsystem, m, f),
    exception: (m, e, f) => emit("error", subsystem, m, { ...(f ?? {}), error: describeError(e) }),
  };
}
