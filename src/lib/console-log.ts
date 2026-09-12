/**
 * Live console plumbing: detached game servers get their stdout/stderr
 * captured into gsm-console.log inside the install directory, and the panel
 * tails that file.
 *
 * Pure helpers (capping, tailing, rotation decisions) are unit-tested; the
 * process routes pass the log path into startDetachedScript.
 */

import { join } from "node:path";

export const CONSOLE_LOG_NAME = "gsm-console.log";
export const CONSOLE_LOG_ROTATED_NAME = "gsm-console.log.1";
/** Rotate at start once the log passes this size. */
export const CONSOLE_MAX_BYTES = 10 * 1024 * 1024;
/** Tail size limits for the API. */
export const CONSOLE_DEFAULT_TAIL_LINES = 200;
export const CONSOLE_MAX_TAIL_LINES = 500;

export function consoleLogPath(installPath: string): string {
  return join(/* turbopackIgnore: true */ installPath, CONSOLE_LOG_NAME);
}

/** Clamp a requested line count into the allowed window. */
export function clampTailLines(n: unknown): number {
  const v = Number(n);
  if (!Number.isInteger(v) || v < 10) return CONSOLE_DEFAULT_TAIL_LINES;
  return Math.min(v, CONSOLE_MAX_TAIL_LINES);
}

/**
 * Take the last `maxLines` lines of file content. The first line of the
 * chunk is dropped when it may be partial (content did not start at a line
 * boundary), unless the chunk IS the whole file.
 */
export function tailLines(content: string, maxLines: number, chunkIsWholeFile: boolean): string[] {
  if (!content) return [];
  const hadTrailingNewline = content.endsWith("\n");
  const lines = content.split("\n");
  if (hadTrailingNewline) lines.pop(); // artifact of split
  if (lines.length <= maxLines) return chunkIsWholeFile ? lines : lines.slice(1);
  return lines.slice(lines.length - maxLines);
}

/** Rotation decision: size-based, at start time only. */
export function shouldRotateLog(sizeBytes: number): boolean {
  return sizeBytes > CONSOLE_MAX_BYTES;
}
