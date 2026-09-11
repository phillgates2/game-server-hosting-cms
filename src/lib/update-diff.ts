/**
 * Pre/post-update snapshot diffing.
 *
 * Before an update we walk the install directory; after, we walk it again
 * and diff. The report shows what Steam actually touched — and flags config
 * files specifically, because a game update silently rewriting server.cfg is
 * exactly the surprise that takes a fleet down at peak hours.
 *
 * diffSnapshots / isConfigPath / formatUpdateReport are pure and unit-tested.
 */

export interface SnapshotEntry {
  path: string;
  size: number;
  mtimeMs: number;
}

export interface SnapshotDiff {
  added: string[];
  removed: string[];
  changed: string[];
  unchangedCount: number;
  /** True when either snapshot was cut off at the file cap. */
  truncated: boolean;
}

/** Hard cap so a pathological install can't exhaust memory. */
export const SNAPSHOT_MAX_FILES = 50_000;
/** Reports stay readable: cap each list. */
export const REPORT_MAX_PATHS = 100;

/** Extensions we treat as "configuration" for warning purposes. */
export const CONFIG_EXTENSIONS = [
  ".cfg", ".conf", ".config", ".ini", ".json", ".yaml", ".yml",
  ".xml", ".properties", ".txt", ".toml", ".env",
] as const;

/** A path is a config file if its (lowercased) extension is on the list. */
export function isConfigPath(path: string): boolean {
  const lower = path.toLowerCase();
  return CONFIG_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Diff two snapshots keyed by relative path.
 * "changed" = same path but different size OR mtime — a restore-in-place
 * with identical content is not reported as churn.
 */
export function diffSnapshots(
  before: SnapshotEntry[],
  after: SnapshotEntry[],
  beforeTruncated = false,
  afterTruncated = false
): SnapshotDiff {
  const beforeMap = new Map<string, SnapshotEntry>();
  for (const entry of before) beforeMap.set(entry.path, entry);

  const added: string[] = [];
  const changed: string[] = [];
  const seen = new Set<string>();
  let unchangedCount = 0;

  for (const entry of after) {
    seen.add(entry.path);
    const prev = beforeMap.get(entry.path);
    if (!prev) {
      added.push(entry.path);
    } else if (prev.size !== entry.size || prev.mtimeMs !== entry.mtimeMs) {
      changed.push(entry.path);
    } else {
      unchangedCount += 1;
    }
  }

  const removed: string[] = [];
  for (const key of beforeMap.keys()) {
    if (!seen.has(key)) removed.push(key);
  }

  added.sort();
  changed.sort();
  removed.sort();

  return {
    added: added.slice(0, REPORT_MAX_PATHS),
    removed: removed.slice(0, REPORT_MAX_PATHS),
    changed: changed.slice(0, REPORT_MAX_PATHS),
    unchangedCount,
    truncated: beforeTruncated || afterTruncated,
  };
}

/** The config-file subset of the changed list (sorted, already unique). */
export function configFilesChanged(diff: SnapshotDiff): string[] {
  return diff.changed.filter(isConfigPath);
}

/** One-line-ish human summary for events/toasts. */
export function formatUpdateReport(diff: SnapshotDiff): string {
  const configs = configFilesChanged(diff);
  const parts = [
    `${diff.added.length} file(s) added`,
    `${diff.changed.length} changed`,
    `${diff.removed.length} removed`,
  ];
  if (configs.length > 0) {
    parts.push(`⚠ config files changed: ${configs.slice(0, 5).join(", ")}${configs.length > 5 ? ` (+${configs.length - 5} more)` : ""}`);
  }
  if (diff.truncated) parts.push("(snapshot was capped)");
  return parts.join(", ");
}

/**
 * Walk an install directory into a snapshot. Symlinked directories are not
 * followed; the walk stops (with truncated=true) at SNAPSHOT_MAX_FILES.
 */
export async function snapshotInstallPath(
  root: string
): Promise<{ entries: SnapshotEntry[]; truncated: boolean }> {
  const { readdir, lstat } = await import("node:fs/promises");
  const { join, relative } = await import("node:path");

  const entries: SnapshotEntry[] = [];
  let truncated = false;
  const stack: string[] = [root];

  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let children;
    try {
      children = await readdir(dir);
    } catch {
      continue; // unreadable dir: skip, don't fail the whole snapshot
    }
    for (const child of children) {
      if (entries.length >= SNAPSHOT_MAX_FILES) {
        truncated = true;
        return { entries, truncated };
      }
      const full = join(/* turbopackIgnore: true */ dir, child);
      let st;
      try {
        st = await lstat(full);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        stack.push(full);
      } else if (st.isFile()) {
        entries.push({ path: relative(root, full), size: st.size, mtimeMs: st.mtimeMs });
      }
    }
  }
  return { entries, truncated };
}
