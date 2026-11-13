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
  /**
   * A webhook is recorded but the panel did not create its channel, so the
   * only way to learn whether it still works is to ask Discord.
   */
  | { kind: "verify-webhook" }
  /** Leave alone, with a human-readable reason. */
  | { kind: "skip"; reason: string };

/**
 * Decide what to do with one server, before any Discord call is made.
 *
 * A hand-entered webhook is never *replaced* on the strength of its URL alone:
 * the panel does not own that channel, and silently redirecting someone's
 * notifications somewhere else would be worse than the gap it is fixing. But
 * it is still checked, because a deleted webhook (`10015 Unknown Webhook`) is
 * exactly the failure an operator reports as "the bot stopped posting": Discord
 * takes the webhook with it when the channel is deleted, and nothing in the
 * panel ever noticed. If the check is possible and says the webhook is gone,
 * the caller re-creates one in the same channel (which needs the channel id the
 * panel may not have) or reports it plainly.
 */
export function planForServer(server: BackfillCandidate): BackfillAction {
  if (server.discordChannelId) return { kind: "verify" };
  if (server.discordWebhook) return { kind: "verify-webhook" };
  return { kind: "create", reason: "no channel" };
}

/**
 * What to do after Discord says a stored webhook no longer exists.
 *
 *  - `"recreate-webhook"` — the panel knows the channel, so it can create a
 *    fresh webhook inside it and keep the operator's channel. This is the
 *    repair for `10015`.
 *  - `"report"` — a hand-entered webhook whose channel the panel does not know.
 *    Only the operator can supply a new URL; the outcome carries the message
 *    that says so.
 */
export function repairForGoneWebhook(
  server: BackfillCandidate
): { kind: "recreate-webhook" } | { kind: "report"; reason: string } {
  if (server.discordChannelId) return { kind: "recreate-webhook" };
  return {
    kind: "report",
    reason:
      "The stored webhook no longer exists in Discord (Unknown Webhook, 10015) — " +
      "paste a new webhook URL on this server, or give it a panel-managed channel",
  };
}

/** Outcome for a single server, reported back to the caller. */
export interface BackfillOutcome {
  serverId: number;
  serverName: string;
  status: "created" | "recreated" | "repaired" | "ok" | "skipped" | "failed";
  channelName?: string;
  detail?: string;
}

/** Aggregate summary of a backfill run. */
export interface BackfillSummary {
  scanned: number;
  created: number;
  recreated: number;
  /** Webhooks that were deleted in Discord and re-created in their channel. */
  repaired: number;
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
    repaired: results.filter((r) => r.status === "repaired").length,
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
  if (s.repaired) parts.push(`${s.repaired} webhook${s.repaired === 1 ? "" : "s"} repaired`);
  if (s.alreadyOk) parts.push(`${s.alreadyOk} already fine`);
  if (s.skipped) parts.push(`${s.skipped} skipped`);
  if (s.failed) parts.push(`${s.failed} failed`);
  return parts.length ? parts.join(", ") : "Nothing to do.";
}
