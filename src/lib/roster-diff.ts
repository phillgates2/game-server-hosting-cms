/**
 * Roster diffing for player join/leave notifications.
 *
 * The status poll compares this poll's player list against the previous one;
 * the difference IS the notification. Pure so the boundary cases (first
 * sighting, empty lists, names appearing in both) are unit-tested rather
 * than discovered as Discord spam.
 */

export interface RosterChange {
  joined: string[];
  left: string[];
}

/** Names listed in a single message before it switches to "N players". */
export const MAX_LISTED_NAMES = 10;

function normalise(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const t = n.trim();
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

/**
 * Compare the previous roster with the current one.
 *
 * `previous === undefined` means "first sighting": that poll only sets the
 * baseline — reporting every player on a server as "joined" at the moment
 * the panel starts would be noise, not information.
 */
export function diffRosters(
  previous: readonly string[] | undefined,
  current: readonly string[]
): RosterChange {
  const now = normalise(current);
  if (previous === undefined) return { joined: [], left: [] };
  const before = new Set(normalise(previous));
  const after = new Set(now);
  return {
    joined: now.filter((n) => !before.has(n)),
    left: [...before].filter((n) => !after.has(n)),
  };
}

function listNames(names: string[]): string {
  if (names.length <= MAX_LISTED_NAMES) return names.map((n) => `**${n}**`).join(", ");
  const shown = names.slice(0, MAX_LISTED_NAMES).map((n) => `**${n}**`).join(", ");
  return `${shown} and ${names.length - MAX_LISTED_NAMES} more`;
}

/**
 * Discord message for a roster change, or null when nothing changed.
 * The event type follows whichever side has names (joined wins when both do,
 * which is rare — a mid-poll swap).
 */
export function describeRosterChange(
  serverName: string,
  change: RosterChange
): { event: "player_joined" | "player_left"; message: string } | null {
  const lines: string[] = [];
  if (change.joined.length === 1) {
    lines.push(`👋 **${change.joined[0]}** joined **${serverName}**`);
  } else if (change.joined.length > 1) {
    lines.push(`👋 ${change.joined.length} players joined **${serverName}**: ${listNames(change.joined)}`);
  }
  if (change.left.length === 1) {
    lines.push(`👋 **${change.left[0]}** left **${serverName}**`);
  } else if (change.left.length > 1) {
    lines.push(`👋 ${change.left.length} players left **${serverName}**: ${listNames(change.left)}`);
  }
  if (lines.length === 0) return null;
  return {
    event: change.joined.length > 0 ? "player_joined" : "player_left",
    message: lines.join("\n"),
  };
}
