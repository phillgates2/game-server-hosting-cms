/**
 * Update changelog: every Steam update leaves a durable, human-readable
 * trace in the server's event history — what the file diff looked like,
 * whether configs were touched, and which pre-update backup to restore
 * from if the new build turns out to be cursed.
 *
 * Pure formatting is unit-tested; the update route records the event.
 */

export const UPDATE_DETAIL_MAX = 500;

export interface UpdateEventInput {
  backupName: string | null;
  /** From stage-13 snapshot diffing; null when the walk wasn't possible. */
  report: {
    added: number;
    removed: number;
    changed: number;
    configsChanged: string[];
  } | null;
}

/** Compact one-line detail stored in server_events.detail. */
export function formatUpdateEventDetail(input: UpdateEventInput): string {
  const parts: string[] = [];
  if (input.backupName) parts.push(`backup=${input.backupName}`);
  if (input.report) {
    const r = input.report;
    parts.push(`files +${r.added} ~${r.changed} -${r.removed}`);
    if (r.configsChanged.length > 0) {
      const names = r.configsChanged.slice(0, 3).join(", ");
      parts.push(`configs touched: ${names}${r.configsChanged.length > 3 ? ` (+${r.configsChanged.length - 3})` : ""}`);
    }
  } else {
    parts.push("file report unavailable");
  }
  return parts.join("; ").slice(0, UPDATE_DETAIL_MAX);
}
