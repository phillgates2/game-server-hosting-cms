/**
 * License usage analytics: which customers are actually phoning home?
 *
 * Health classes (per activation, from lastSeenAt):
 *   active — seen within the last ACTIVE window (default 7d)
 *   silent — seen within the last SILENT window (default 30d) but not active
 *   dark   — seen, but longer ago than the silent window
 *   never  — the key was issued but never validated anywhere
 *
 * Pure classification is unit-tested; the routes feed it real rows.
 */

export const LICENSE_ACTIVE_WINDOW_DAYS = 7;
export const LICENSE_SILENT_WINDOW_DAYS = 30;

export type ActivationHealth = "active" | "silent" | "dark" | "never";

export function classifyActivationHealth(
  lastSeenMs: number | null,
  nowMs: number
): ActivationHealth {
  if (lastSeenMs === null) return "never";
  const ageMs = nowMs - lastSeenMs;
  if (ageMs < 0) return "active"; // clock skew: future timestamp = seen recently
  if (ageMs <= LICENSE_ACTIVE_WINDOW_DAYS * 86_400_000) return "active";
  if (ageMs <= LICENSE_SILENT_WINDOW_DAYS * 86_400_000) return "silent";
  return "dark";
}

export interface LicenseKeyUsage {
  keyId: number;
  label: string | null;
  prefix: string;
  revoked: boolean;
  expired: boolean;
  maxActivations: number;
  activationCount: number;
  /** Newest lastSeenAt across the key's activations, if any. */
  lastSeenMs: number | null;
}

/** A key's health: the BEST health among its activations (any live install counts). */
export function classifyKeyHealth(key: LicenseKeyUsage, nowMs: number): ActivationHealth {
  if (key.activationCount === 0) return "never";
  return classifyActivationHealth(key.lastSeenMs, nowMs);
}

export interface LicenseFleetSummary {
  totalKeys: number;
  revokedKeys: number;
  unusedKeys: number;
  activeKeys: number;
  silentKeys: number;
  darkKeys: number;
  totalActivations: number;
  activeActivations: number;
}

export function summarizeLicenseFleet(
  keys: LicenseKeyUsage[],
  activationHealth: ActivationHealth[],
  nowMs: number
): LicenseFleetSummary {
  const summary: LicenseFleetSummary = {
    totalKeys: keys.length,
    revokedKeys: 0,
    unusedKeys: 0,
    activeKeys: 0,
    silentKeys: 0,
    darkKeys: 0,
    totalActivations: activationHealth.length,
    activeActivations: 0,
  };
  for (const key of keys) {
    if (key.revoked) summary.revokedKeys += 1;
    const health = classifyKeyHealth(key, nowMs);
    if (health === "never") summary.unusedKeys += 1;
    else if (health === "active") summary.activeKeys += 1;
    else if (health === "silent") summary.silentKeys += 1;
    else summary.darkKeys += 1;
  }
  for (const h of activationHealth) {
    if (h === "active") summary.activeActivations += 1;
  }
  return summary;
}

/** One-line digest for toasts/notifications. */
export function formatFleetUsageLine(s: LicenseFleetSummary): string {
  return `${s.activeKeys} active / ${s.totalKeys} keys · ${s.activeActivations}/${s.totalActivations} installs phoned home in the last ${LICENSE_ACTIVE_WINDOW_DAYS} days`;
}
