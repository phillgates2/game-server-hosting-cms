/** Display helpers for the install/update status meter (pure, client-safe). */

import type { ProgressPhase } from "./install-progress";

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = unit === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

export function formatRate(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`;
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

const PHASE_TITLES: Record<ProgressPhase, string> = {
  preparing: "Preparing",
  backup: "Backing up",
  downloading: "Downloading",
  verifying: "Verifying",
  extracting: "Extracting",
  installing: "Installing",
  configuring: "Configuring",
  finalizing: "Finishing up",
  done: "Complete",
  failed: "Failed",
};

const PHASE_ICONS: Record<ProgressPhase, string> = {
  preparing: "⏳",
  backup: "💾",
  downloading: "⬇️",
  verifying: "🔍",
  extracting: "📦",
  installing: "⚙️",
  configuring: "📝",
  finalizing: "🏁",
  done: "✅",
  failed: "⚠️",
};

export function phaseTitle(phase: ProgressPhase): string {
  return PHASE_TITLES[phase] ?? "Working";
}

export function phaseIcon(phase: ProgressPhase): string {
  return PHASE_ICONS[phase] ?? "⏳";
}
