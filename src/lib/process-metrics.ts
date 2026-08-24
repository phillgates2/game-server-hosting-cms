/**
 * Per-process resource sampling for running game servers.
 *
 * The `server_metrics` table has existed since the beginning, is pruned by the
 * retention job and counted by its stats call — but nothing ever inserted a
 * row, so per-server history was permanently empty. Monitoring only ever
 * showed host-wide figures, which cannot answer "which server is eating the
 * box?".
 *
 * Everything is read from /proc, matching how the host monitor already works.
 * No dependency, and it degrades to null on any platform without procfs
 * rather than throwing.
 */

import { readFile } from "node:fs/promises";

/** Bytes per memory page, used to convert the RSS figure in /proc/<pid>/stat. */
const PAGE_SIZE = 4096;

/** Clock ticks per second. Linux is 100 on every mainstream configuration. */
const CLOCK_TICKS = 100;

export interface ProcessSample {
  /** Resident memory in MB. */
  ramMb: number;
  /** Total CPU seconds consumed since the process started. */
  cpuSeconds: number;
  /** Seconds the process has been alive. */
  uptimeSeconds: number;
}

/** Previous sample per pid, so CPU can be expressed as a percentage. */
const previous = new Map<number, { cpuSeconds: number; at: number }>();

/** Read the system uptime, needed to work out how long a process has run. */
async function systemUptime(): Promise<number> {
  try {
    const raw = await readFile("/proc/uptime", "utf8");
    return Number.parseFloat(raw.split(" ")[0]) || 0;
  } catch {
    return 0;
  }
}

/**
 * Sample one process.
 *
 * Returns null when the pid is gone or /proc is unavailable — a server that
 * has just exited is an expected case, not an error worth logging.
 */
export async function sampleProcess(pid: number): Promise<ProcessSample | null> {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");

    // The comm field can contain spaces and brackets, so everything before the
    // final ") " has to be discarded rather than split naively.
    const close = stat.lastIndexOf(") ");
    if (close === -1) return null;
    const fields = stat.slice(close + 2).split(" ");

    // Offsets are relative to field 3 (state), which is fields[0] here.
    const utime = Number(fields[11]) || 0;
    const stime = Number(fields[12]) || 0;
    const starttime = Number(fields[19]) || 0;
    const rssPages = Number(fields[21]) || 0;

    const cpuSeconds = (utime + stime) / CLOCK_TICKS;
    const uptime = await systemUptime();
    const uptimeSeconds = Math.max(0, uptime - starttime / CLOCK_TICKS);

    return {
      ramMb: (rssPages * PAGE_SIZE) / (1024 * 1024),
      cpuSeconds,
      uptimeSeconds,
    };
  } catch {
    return null;
  }
}

/**
 * CPU usage as a percentage of one core, measured between two samples.
 *
 * The first call for a pid has nothing to compare against, so it reports usage
 * averaged over the process's whole life. That is a reasonable first data
 * point and avoids showing a misleading 0%.
 */
export function cpuPercentFor(pid: number, sample: ProcessSample): number {
  const now = Date.now();
  const prev = previous.get(pid);
  previous.set(pid, { cpuSeconds: sample.cpuSeconds, at: now });

  if (!prev) {
    if (sample.uptimeSeconds <= 0) return 0;
    return round(Math.min(100 * (sample.cpuSeconds / sample.uptimeSeconds), 10_000));
  }

  const elapsed = (now - prev.at) / 1000;
  if (elapsed <= 0) return 0;
  const used = sample.cpuSeconds - prev.cpuSeconds;
  // A restarted pid can report less CPU than last time; treat that as zero
  // rather than emitting a negative percentage.
  if (used < 0) return 0;
  return round(Math.min(100 * (used / elapsed), 10_000));
}

/** Forget a pid, so a restarted server does not inherit a stale baseline. */
export function forgetProcess(pid: number): void {
  previous.delete(pid);
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Minimum gap between stored samples for one server.
 *
 * The status poll fires every 15 seconds per open dashboard, which would be
 * 5,760 rows per server per day — 8.6 million retained rows on a fifty-server
 * panel at the default 30-day window, for a graph nobody reads at that
 * resolution. One sample a minute is plenty for a trend line and is a quarter
 * of the volume, and it also means two admins with the tab open do not double
 * the write rate.
 */
const SAMPLE_INTERVAL_MS = 60_000;

const lastStored = new Map<number, number>();

/** Whether enough time has passed to store another sample for this server. */
export function shouldStoreSample(serverId: number, now = Date.now()): boolean {
  const prev = lastStored.get(serverId);
  if (prev !== undefined && now - prev < SAMPLE_INTERVAL_MS) return false;
  lastStored.set(serverId, now);
  return true;
}

/** Clear the throttle for a server, used when it stops. */
export function forgetSampleThrottle(serverId: number): void {
  lastStored.delete(serverId);
}
