/**
 * Boot decision for the app shell.
 *
 * The shell asks `/api/install` one question: is this panel set up? The first
 * implementation treated *any* answer other than `installed: true` as "not
 * installed", including a network failure and a 500. One dropped request, a
 * panel restarting under PM2, or a database that was briefly unavailable put
 * the operator in the install wizard on a panel that already had data — with
 * the wizard offering to claim it again.
 *
 * The decision is now explicit and lives here, away from the component, so the
 * rule can be tested without a browser:
 *
 *  - `installed: true`  → carry on to the public site;
 *  - `installed: false` → the wizard, because the panel said so;
 *  - anything else      → an "unreachable" screen with a retry, never a wizard.
 */

export type BootOutcome =
  /** A working, already-installed panel. */
  | { kind: "ready" }
  /** The panel answered and said it has not been set up yet. */
  | { kind: "install" }
  /** Something failed, but it was not an answer about the install state. */
  | { kind: "unreachable"; message: string };

/** How long the boot probe may take before it counts as unreachable. */
export const BOOT_TIMEOUT_MS = 12_000;

/** True for the abort/reason `fetchWithTimeout` raises on timeout. */
export function isTimeoutError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const name = (error as { name?: unknown }).name;
  return name === "TimeoutError" || name === "AbortError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Interpret the install probe's HTTP status and parsed body.
 *
 * A 200 with a boolean `installed` is the only response that may open the
 * wizard. A 200 whose body says nothing about the install state is treated as a
 * fault: the panel is talking, but not about the thing we asked.
 */
export function classifyInstallResponse(status: number, body: unknown): BootOutcome {
  if (status === 0) {
    return { kind: "unreachable", message: unreachableMessage("network") };
  }
  if (status === 503 || status >= 500) {
    return {
      kind: "unreachable",
      message: `The panel answered with an error (HTTP ${status}). It is running, but something it depends on — usually the database — is not.`,
    };
  }
  if (status === 404) {
    return {
      kind: "unreachable",
      message:
        "The panel is running but its install check is missing (HTTP 404). This usually means a half-finished update; reinstall or check the panel's logs.",
    };
  }
  if (status !== 200) {
    return {
      kind: "unreachable",
      message: `The panel refused the install check (HTTP ${status}). Check the panel's logs before trying again.`,
    };
  }
  if (!isRecord(body) || typeof body.installed !== "boolean") {
    return {
      kind: "unreachable",
      message:
        "The panel answered, but not with an install state. Something between the browser and the panel — a proxy or a captive portal — may be interfering.",
    };
  }
  return body.installed ? { kind: "ready" } : { kind: "install" };
}

/** Classify a thrown request: offline, timed out, or refused. */
export function classifyBootFailure(options: {
  online: boolean;
  timedOut?: boolean;
  detail?: string;
}): BootOutcome {
  if (!options.online) return { kind: "unreachable", message: unreachableMessage("offline") };
  if (options.timedOut) return { kind: "unreachable", message: unreachableMessage("timeout") };
  return {
    kind: "unreachable",
    message: options.detail?.trim()
      ? options.detail
      : unreachableMessage("network"),
  };
}

function unreachableMessage(reason: "offline" | "timeout" | "network"): string {
  switch (reason) {
    case "offline":
      return "Your browser is offline. Reconnect, then retry — nothing on the panel has changed.";
    case "timeout":
      return "The panel did not answer in time. It may be restarting or busy; retry in a moment.";
    default:
      return "The panel could not be reached. It may be restarting — retry in a moment, and check the service status if this persists.";
  }
}
