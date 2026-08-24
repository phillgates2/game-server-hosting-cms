/**
 * Backfill Discord channels for servers that do not have one.
 *
 * Auto-provisioning only runs when a server is created, so any server that
 * existed before the bot was configured never got a channel. This gives those
 * servers one, and repairs servers whose channel was deleted by hand in
 * Discord — a case that is otherwise invisible, because webhook delivery never
 * throws, so the notifications just silently stop arriving.
 */

/** One server as the backfill sees it. */
export interface BackfillCandidate {
  id: number;
  name: string;
  /** Webhook currently stored on the server, if any. */
  discordWebhook: string | null;
  /** Channel the panel provisioned for it, if any. */
  discordChannelId: string | null;
}

/** What should happen to a given server. */
export type BackfillAction =
  /** No channel recorded — create one. */
  | { kind: "create"; reason: "no channel" }
  /** Channel recorded; confirm it still exists before deciding. */
  | { kind: "verify" }
  /** Leave alone, with a human-readable reason. */
  | { kind: "skip"; reason: string };

/**
 * Decide what to do with one server, before any Discord call is made.
 *
 * A hand-entered webhook is deliberately left alone: the panel does not own
 * that channel, and replacing it would silently redirect someone's
 * notifications somewhere else.
 */
export function planForServer(server: BackfillCandidate): BackfillAction {
  if (server.discordChannelId) return { kind: "verify" };
  if (server.discordWebhook) {
    return { kind: "skip", reason: "has a webhook that the panel did not create" };
  }
  return { kind: "create", reason: "no channel" };
}

/** Outcome for a single server, reported back to the caller. */
export interface BackfillOutcome {
  serverId: number;
  serverName: string;
  status: "created" | "recreated" | "ok" | "skipped" | "failed";
  channelName?: string;
  detail?: string;
}

/** Aggregate summary of a backfill run. */
export interface BackfillSummary {
  scanned: number;
  created: number;
  recreated: number;
  alreadyOk: number;
  skipped: number;
  failed: number;
  results: BackfillOutcome[];
}

/** Roll individual outcomes up into the summary the UI displays. */
export function summarise(results: BackfillOutcome[]): BackfillSummary {
  return {
    scanned: results.length,
    created: results.filter((r) => r.status === "created").length,
    recreated: results.filter((r) => r.status === "recreated").length,
    alreadyOk: results.filter((r) => r.status === "ok").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    failed: results.filter((r) => r.status === "failed").length,
    results,
  };
}

/**
 * A short sentence describing the run, for the toast in the UI.
 *
 * Worth being precise here: "Done" tells an operator nothing about whether
 * their servers actually got channels.
 */
export function describeSummary(s: BackfillSummary): string {
  if (s.scanned === 0) return "No servers to check.";
  const parts: string[] = [];
  if (s.created) parts.push(`${s.created} created`);
  if (s.recreated) parts.push(`${s.recreated} re-created`);
  if (s.alreadyOk) parts.push(`${s.alreadyOk} already fine`);
  if (s.skipped) parts.push(`${s.skipped} skipped`);
  if (s.failed) parts.push(`${s.failed} failed`);
  return parts.length ? parts.join(", ") : "Nothing to do.";
}
