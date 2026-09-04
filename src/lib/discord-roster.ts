/**
 * Discord role colors for in-game player names.
 *
 * The status board shows players by name; when a player has verified
 * (GUID-linked) on Discord, the board can annotate their roster line with
 * the role color name — `• Rifleman [12ms] 🎨 Vivid Azurite` — like the
 * role color you see next to their name in Discord's member list.
 *
 * The matching is pure (tests drive it); the gateway lookup lives in
 * discord-bot.ts and calls back into this module.
 */

import { cleanName } from "./et-stats";
import { stripColorCodes, rosterKey } from "./status-board-embed";

export { rosterKey, rosterLine } from "./status-board-embed";

export interface RosterMember {
  /** The verified Discord user's name as stored (`discord_name`). */
  discordName: string;
  /** Current server nickname / display name when known. */
  displayName?: string;
  /** Role color as hex (#rrggbb) — the member's highest role, or null. */
  colorHex: string | null;
  /** Role name for the annotation fallback when the color is null. */
  roleName?: string | null;
}

/**
 * Match in-game names to members (exact cleaned match, then partial) and
 * return the raw hex color per roster key. Bots are never matched (they have
 * no Discord account).
 */
export function matchRoleColors(
  names: string[],
  members: RosterMember[]
): Record<string, string> {
  const byKey = new Map<string, string>();
  for (const m of members) {
    if (!m.colorHex) continue;
    const keys = [m.discordName, m.displayName ?? ""]
      .map(rosterKey)
      .filter((k) => k.length > 0);
    // Earliest member for a key wins — the same rule the panel uses elsewhere.
    for (const k of keys) {
      if (!byKey.has(k)) byKey.set(k, m.colorHex);
    }
  }

  const out: Record<string, string> = {};
  for (const raw of names) {
    if (/\[BOT\]|\(BOT\)|<BOT>/i.test(raw)) continue;
    const key = rosterKey(raw);
    if (!key) continue;
    const exact = byKey.get(key);
    if (exact) {
      out[key] = exact;
      continue;
    }
    // Partial: the in-game name is inside a stored member name.
    for (const [memberKey, hex] of byKey) {
      if (memberKey.includes(key)) {
        out[key] = hex;
        break;
      }
    }
  }
  return out;
}


