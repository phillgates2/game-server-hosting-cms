/**
 * Pure helpers for live Discord status boards.
 *
 * Kept separate from the loop/transport (which needs the database) so the
 * embed layout can be tested without a database behind it.
 */

import { isValidWebhookUrl } from "@/lib/discord";
import { colorNameFor } from "./color-names";

/** How often boards refresh, and the clamp for the operator setting. */
export const STATUS_DEFAULT_INTERVAL_MINUTES = 3;
export const STATUS_MIN_INTERVAL_MINUTES = 1;
export const STATUS_MAX_INTERVAL_MINUTES = 60;

/** How many player names a board lists before summarising the rest. */
export const MAX_LISTED_PLAYERS = 14;

/** Discord embed field values are capped at 1024 characters. */
export const MAX_EMBED_FIELD_LENGTH = 1024;

/** A game server row plus the board state columns, as the loop sees it. */
export interface ServerForBoard {
  id: number;
  name: string;
  ipv4: string | null;
  ipv6: string | null;
  port: number;
  queryPort: number | null;
  variables: unknown;
  config: unknown;
  status: string;
  gameName: string | null;
  gameSlug: string | null;
  discordWebhook: string | null;
  discordStatusEnabled: boolean | null;
  discordStatusMessageId: string | null;
}

export function clampInterval(raw: unknown, fallback: number = STATUS_DEFAULT_INTERVAL_MINUTES): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(STATUS_MAX_INTERVAL_MINUTES, Math.max(STATUS_MIN_INTERVAL_MINUTES, Math.round(n)));
}

/** Webhooks edit the messages they created at /webhooks/{id}/{token}/messages/{id}. */
export function messageEndpoint(webhookUrl: string, messageId: string): string | null {
  if (!isValidWebhookUrl(webhookUrl) || !/^\d{5,25}$/.test(messageId)) return null;
  return `${webhookUrl.replace(/\/+$/, "")}/messages/${messageId}`;
}

/**
 * Strip Quake-family colour codes (^1, ^4, ^x...) from player names — ET and
 * Quake 3 names arrive with codes intact and look like "^5Player^7" in chat.
 */
export function stripColorCodes(name: string): string {
  return name.replace(/\^[0-9a-zA-Z]/g, "");
}

export interface BoardView {
  serverName: string;
  gameName: string;
  address: string;
  /** Dot colour. The panel's own status is the source of truth, not the probe. */
  online: boolean;
  map?: string;
  players?: number;
  maxPlayers?: number;
  names?: string[];
  /** Pings in ms, parallel to `names` where the protocol reports them. */
  pings?: number[];
  /** Server hostname (sv_hostname) when reported. */
  hostname?: string;
  /**
   * Discord role colors (hex) keyed by a cleaned player name for members who
   * verified — rendered as `• Name [12ms] 🎨 Vivid Azurite`.
   */
  roleColors?: Record<string, string>;
  /** Probe failure while the panel thinks the server is up. */
  probeFailed?: boolean;
  /** External servers checked by `!etallofoz` but not installed in the panel. */
  external?: boolean;
}

export interface BoardEmbed {
  title: string;
  description?: string;
  color: number;
  fields: Array<{ name: string; value: string; inline?: boolean }>;
  timestamp: string;
}

export interface BoardMessagePayload {
  username: string;
  embeds: [BoardEmbed];
}

const ONLINE_COLOR = 0x22c55e; // green
const OFFLINE_COLOR = 0xef4444; // red

/** Normalized lookup key for a player/member name: cleaned + lowercased. */
export function rosterKey(name: string): string {
  const clean = stripColorCodes(name).trim().replace(/\^[0-9a-zA-Z]/g, "");
  return clean.toLowerCase().replace(/\s+/g, " ").trim();
}

/** One roster line with the optional 🎨 role-color annotation. */
export function rosterLine(
  rawName: string,
  ping?: number,
  roleColorHex?: string | null
): string {
  const clean = stripColorCodes(rawName).trim() || "Anonymous";
  const base = `• ${clean}${ping !== undefined ? ` [${ping}ms]` : ""}`;
  if (!roleColorHex) return base;
  const name = colorNameFor(roleColorHex);
  return name ? `${base} 🎨 ${name}` : base;
}

/**
 * Build the embed for a board message.
 *
 * Pure — tests drive this directly. Layout: status dot first, then gameplay
 * facts, then the roster in its own field.
 */
export function buildStatusBoardEmbed(view: BoardView, now: Date = new Date()): BoardEmbed {
  const status = view.online ? "🟢 Online" : "🔴 Offline";
  const map = view.map?.trim() ? view.map.trim() : "—";

  const playersValue = view.players !== undefined
    ? `${view.players}${view.maxPlayers ? `/${view.maxPlayers}` : ""}`
    : view.probeFailed && view.online
      ? "— (query port unreachable)"
      : "—";

  const fields: BoardEmbed["fields"] = [
    { name: "Status", value: status },
    { name: "🗺️ Map", value: map.slice(0, MAX_EMBED_FIELD_LENGTH), inline: true },
    { name: "👥 Players", value: playersValue, inline: true },
    { name: "🌐 Address", value: view.address.slice(0, MAX_EMBED_FIELD_LENGTH), inline: true },
  ];

  // A roster only makes sense against a live query; a stopped server
  // must not show names from a previous session.
  if (view.online && view.names && view.names.length > 0) {
    const listed = view.names
      .slice(0, MAX_LISTED_PLAYERS)
      .map((n, i) =>
        rosterLine(n, view.pings?.[i], view.roleColors?.[rosterKey(n)] ?? null)
      )
      .join("\n");
    const rest = view.names.length - MAX_LISTED_PLAYERS;
    const value = rest > 0 ? `${listed}\n… and ${rest} more` : listed;
    fields.push({ name: "👤 Players online", value: value.slice(0, MAX_EMBED_FIELD_LENGTH) });
  }

  return {
    title: `🖥️ ${view.serverName}`,
    description: `**${view.gameName}**`,
    color: view.online ? ONLINE_COLOR : OFFLINE_COLOR,
    fields,
    timestamp: now.toISOString(),
  };
}

export function buildStatusBoardPayload(view: BoardView, now: Date = new Date()): BoardMessagePayload {
  return {
    username: "GameServer Manager",
    embeds: [buildStatusBoardEmbed(view, now)],
  };
}
