/**
 * Wolfenstein: Enemy Territory player statistics.
 *
 * The legacy ET stat mods (ntmod / etlegacy stats) keep their data in a
 * `user.sqlite` inside the server install directory. This module reads that
 * file and ports the pieces the WolfET bot needs from it:
 *
 *   - cleanName: strip ET colour codes (^5, ^o[BOT]^7, clan-tag prefixes)
 *   - decodeXp: the base64-encoded XP string -> 7 skill values + total
 *   - sanitizeInput: the bot's input guard for player-name lookups
 *   - findClosestPlayer: exact -> partial -> fuzzy, like the original
 *   - readEtUsers: the sqljs reader itself (waits on the wasm runtime)
 *
 * The database is read-only here; writing anything into a game's stats file
 * would be a corruption risk, and the panel has its own storage for links.
 */

import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

export const SKILL_NAMES = [
  "Battle Sense",
  "Engineering",
  "First Aid",
  "Field Ops",
  "Light Weapons",
  "Heavy Weapons",
  "Covert Ops",
] as const;

export interface EtUser {
  name: string;
  level: number;
  xp: string;
  guid: string;
  timestamp: number;
}

export interface XpBreakdown {
  skills: number[];
  total: number;
}

/** Largest stats file we are willing to load (protects the panel's memory). */
export const MAX_STATS_FILE_BYTES = 64 * 1024 * 1024;

/** Remove ET colour codes and the bot prefix, and any clan tag like ^2-^3O^2Z^3-. */
export function cleanName(name: string): string {
  if (!name) return "";
  const cleaned = name
    .replace(/\^o\[BOT\]\^7/gi, "")
    .replace(/\^[0-9a-zA-Z]-\^[0-9a-zA-Z]O\^[0-9a-zA-Z]Z\^[0-9a-zA-Z]-/gi, "")
    .replace(/\^[0-9a-zA-Z]/g, "");
  return cleaned.trim();
}

/**
 * Decode the base64 XP string used by the ET stat mods.
 *
 * The string base64-decodes to something like
 *   "S0\123\S1\456\..." — a backslash-separated token list where each
 * `S<n>` is followed by its value.
 */
export function decodeXp(xpString: string): XpBreakdown {
  const skills = [0, 0, 0, 0, 0, 0, 0];
  if (!xpString) return { skills, total: 0 };

  try {
    const decoded = Buffer.from(xpString, "base64").toString("utf8");
    // Tokenise on the backslash, exactly as the Python split('\\') did.
    const parts = decoded.split("\\").map((p) => p.trim());
    for (let i = 0; i < SKILL_NAMES.length; i++) {
      const idx = parts.indexOf(`S${i}`);
      if (idx !== -1 && idx + 1 < parts.length) {
        const n = Number.parseInt(parts[idx + 1], 10);
        if (Number.isInteger(n) && n >= 0) skills[i] = n;
      }
    }
  } catch {
    // Garbage XP string: report zeros rather than failing the lookup.
  }

  return { skills, total: skills.reduce((a, b) => a + b, 0) };
}

/** The bot's input sanitisation: strip SQL-ish tokens and cap at 50 chars. */
export function sanitizeInput(text: string): string {
  if (!text) return "";
  const forbidden = [";", "--", "/*", "*/", "xp_", "UNION", "SELECT", "DROP", "DELETE", "UPDATE"];
  let sanitized = text;
  for (const token of forbidden) {
    sanitized = sanitized.split(token.toLowerCase()).join("").split(token.toUpperCase()).join("");
  }
  return sanitized.slice(0, 50).trim();
}

/** 32 chars, uppercase A-Z0-9, first and last characters alphabetic. */
export function isValidGuid(guid: string): boolean {
  if (!guid) return false;
  const up = guid.toUpperCase();
  if (up.length !== 32) return false;
  if (!(up[0] >= "A" && up[0] <= "Z") || !(up[up.length - 1] >= "A" && up[up.length - 1] <= "Z")) return false;
  return /^[A-Z0-9]{32}$/.test(up);
}

/** Levenshtein similarity ratio, the stand-in for difflib.get_close_matches. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const dp: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = dp[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
      prev = cur;
    }
  }
  const distance = dp[b.length];
  const maxLen = Math.max(a.length, b.length);
  return 1 - distance / maxLen;
}

/**
 * Find the user row whose cleaned name best matches (exact, partial, then
 * fuzzy at ≥0.6), mirroring the original bot. Bots are excluded by their
 * `^o[BOT]^7` marker.
 */
export function findClosestPlayer(users: EtUser[], searchName: string): EtUser | null {
  const searchClean = cleanName(searchName).toLowerCase();
  if (!searchClean) return null;

  const human = users.filter((u) => !/^o\[BOT\]\^7/i.test(cleanName(u.name)) && !/\[BOT\]/i.test(u.name));
  const byClean = new Map<string, EtUser>();

  for (const u of human) {
    const cleaned = cleanName(u.name);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (!byClean.has(key)) byClean.set(key, u);
  }

  // Exact.
  const exact = byClean.get(searchClean);
  if (exact) return exact;

  // Partial (query inside a stored name).
  for (const [cleaned, user] of byClean) {
    if (cleaned.includes(searchClean)) return user;
  }

  // Fuzzy, like difflib.get_close_matches(cutoff=0.6).
  let best: EtUser | null = null;
  let bestScore = 0.6;
  for (const [cleaned, user] of byClean) {
    const score = similarity(searchClean, cleaned);
    if (score >= bestScore) {
      bestScore = score;
      best = user;
    }
  }
  return best;
}

/** Rank users by total XP (top 10 by default), bots excluded. */
export function rankByXp(users: EtUser[], limit = 10): Array<{ name: string; xp: number }> {
  const scored: Array<{ name: string; xp: number }> = [];
  for (const u of users) {
    if (/\[BOT\]/i.test(u.name)) continue;
    const name = cleanName(u.name);
    if (!name) continue;
    const { total } = decodeXp(u.xp);
    scored.push({ name, xp: total });
  }
  scored.sort((a, b) => b.xp - a.xp || a.name.localeCompare(b.name));
  return scored.slice(0, limit);
}

// ── SQLite reader (zero dependency) ──────────────────────────────────────

export interface EtStatsSource {
  installPath: string;
  dbPath: string;
  users: EtUser[];
}

/**
 * Read `user.sqlite` from a server install directory.
 *
 * Returns null when the file is absent or unreadable — an ET server without
 * the stat mod enabled simply has no stats, which is not an error. Uses
 * the small built-in reader in sqlite-reader.ts — no native module, no wasm
 * runtime, and nothing for the bundler to choke on.
 */
export async function readEtStats(installPath: string): Promise<EtStatsSource | null> {
  const dbPath = join(/* turbopackIgnore: true */ installPath, "user.sqlite");
  try {
    const info = await stat(dbPath);
    if (!info.isFile() || info.size > MAX_STATS_FILE_BYTES) return null;
    const bytes = await readFile(dbPath);
    return { installPath, dbPath, users: await queryEtUsers(bytes) };
  } catch {
    return null;
  }
}

/** Query the users table from raw sqlite bytes. Returns [] when the table is
 *  absent (an ET install without the stat mod) rather than throwing. */
export async function queryEtUsers(bytes: Buffer): Promise<EtUser[]> {
  const { readSqliteTable } = await import("./sqlite-reader");
  const rows = readSqliteTable(bytes, "users") ?? [];
  return rows
    .filter((r) => typeof r.name === "string" && r.name !== "" && typeof r.xp === "string")
    .map((r) => ({
      name: String(r.name),
      level: typeof r.level === "number" ? r.level : Number(r.level) || 0,
      xp: String(r.xp),
      timestamp: typeof r.timestamp === "number" ? r.timestamp : Number(r.timestamp) || 0,
      guid: typeof r.guid === "string" && r.guid ? r.guid.toUpperCase() : "",
    }));
}
