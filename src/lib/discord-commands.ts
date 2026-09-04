/**
 * Pure embed builders for the chat bot's commands.
 *
 * Kept separate from the gateway client so every command's output can be
 * asserted in tests without a Discord connection. Emits plain embed objects,
 * which discord.js accepts directly.
 */

import { stripColorCodes, type BoardView } from "./status-board-embed";
import { cleanName, decodeXp, SKILL_NAMES, type EtUser } from "./et-stats";

export interface CommandEmbed {
  title: string;
  description?: string;
  color: number;
  fields: Array<{ name: string; value: string; inline?: boolean }>;
  timestamp: string;
  footer?: { text: string };
  thumbnail?: { url: string };
}

export interface CommandResult {
  text?: string;
  embeds: CommandEmbed[];
}

function embed(
  title: string,
  options: Partial<Omit<CommandEmbed, "title">>
): CommandEmbed {
  return {
    title,
    color: 0x00ff00,
    timestamp: new Date().toISOString(),
    ...options,
    fields: options.fields ?? [],
  };
}

/** Roster lines with pings, exactly like the original bot: `• Name [12ms]`. */
function roster(view: BoardView, limit: number): string {
  const names = (view.names ?? []).slice(0, limit);
  return names
    .map((n, i) => {
      const clean = stripColorCodes(n).trim() || "Anonymous";
      const ping = view.pings?.[i];
      return `• ${clean}${ping !== undefined ? ` [${ping}ms]` : ""}`;
    })
    .join("\n");
}

function timeStampFooter(now: Date): string {
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `Last updated: ${hh}:${mm}:${ss}`;
}

/** `!etwho` — the classic single-server view, matching the original embed. */
export function whoEmbeds(view: BoardView, now: Date = new Date()): CommandResult {
  const online = view.online;
  const map = view.map?.trim() ? view.map.trim() : "unknown-map";
  const count = view.players ?? 0;

  const fields: CommandEmbed["fields"] = [
    { name: "Status", value: online ? "🟢 Online" : "🔴 Offline" },
    { name: "Map", value: map.slice(0, 1024), inline: true },
    { name: "Players Online", value: String(count), inline: true },
  ];

  if (online && (view.names?.length ?? 0) > 0) {
    fields.push({
      name: "Current Players",
      value: (roster(view, 14) || "No players currently online").slice(0, 1024),
      inline: false,
    });
  } else {
    fields.push({ name: "Current Players", value: "No players currently online", inline: false });
  }

  const game = view.hostname?.trim() ? view.hostname : view.gameName;

  return {
    embeds: [embed(`🎮 ${game} — Server Status`, {
      color: count > 0 ? 0x00ff00 : 0xff9900,
      description: `**${view.serverName}**`,
      fields,
      footer: { text: timeStampFooter(now) },
    })],
  };
}

/** `!etallofoz` — every ET server with real players, one field each. */
export function allServersEmbeds(views: BoardView[], label: string, now: Date = new Date()): CommandResult {
  const online = views.filter((v) => v.online);
  const withPlayers = online.filter((v) => (v.players ?? 0) > 0);
  const total = withPlayers.reduce((n, v) => n + (v.players ?? 0), 0);

  const fields: CommandEmbed["fields"] = [];
  if (withPlayers.length === 0) {
    fields.push({
      name: "No Players Online",
      value: "There are currently no real players on any server",
      inline: false,
    });
  } else {
    for (const v of withPlayers) {
      const players = roster(v, 14);
      const base = v.hostname?.trim() || v.serverName;
      const display = v.external ? `🌐 ${base}` : base;
      fields.push({
        name: `${display} — ${v.players} players`,
        value: (
          `**${display}**\n` +
          `IP: ${v.address}\n` +
          `Map: ${v.map || "unknown-map"}\n` +
          "```\n" + players + "\n```"
        ).slice(0, 1024),
        inline: false,
      });
    }
  }

  fields.push({ name: "👍 Servers online", value: `${online.length}/${views.length}`, inline: true });
  fields.push({ name: "👥 Total real players", value: String(total), inline: true });

  return {
    embeds: [embed(`🌏 ${label} — Real Players Online`, {
      description: `Total Real Players: **${total}**`,
      color: total > 0 ? 0x00ff00 : 0xff9900,
      fields,
      footer: withPlayers.length === 0
        ? { text: `Active Servers: ${online.length}/${views.length}` }
        : undefined,
      timestamp: now.toISOString(),
    })],
  };
}

/** `!stats <name>` — level, last-active, per-skill XP and total. */
export function statsEmbeds(user: EtUser): CommandResult {
  const clean = cleanName(user.name);
  const { skills, total } = decodeXp(user.xp);

  const skillsText = SKILL_NAMES
    .map((name, i) => `${name}: ${skills[i].toLocaleString("en-US")}`)
    .join("\n");

  return {
    embeds: [embed(`📊 Player Stats: ${clean}`, {
      fields: [
        {
          name: "General Info",
          value: `Level: ${user.level}\nLast Active: ${user.timestamp > 0 ? `<t:${Math.floor(user.timestamp)}:R>` : "unknown"}`,
          inline: false,
        },
        { name: "Skills", value: "```\n" + skillsText + "```", inline: false },
        { name: "Total XP", value: total.toLocaleString("en-US"), inline: false },
      ],
    })],
  };
}

/** `!ettop10` — the XP leaderboard with medals. */
export function top10Embeds(scored: Array<{ name: string; xp: number }>): CommandResult {
  if (scored.length === 0) {
    return {
      embeds: [embed("🏆 Top 10 ET Players", {
        description: "No players found",
        color: 0xffd700,
        fields: [{ name: "Leaderboard", value: "No players found", inline: false }],
      })],
    };
  }
  const medals = ["🥇", "🥈", "🥉"];
  const maxLen = Math.max(...scored.map((s) => s.name.length));
  const lines = scored.map((s, i) => {
    const medal = medals[i] ?? "▫️";
    const name = s.name.padEnd(maxLen);
    return `${medal} \`${String(i + 1).padStart(2, " ")}. ${name} ${s.xp.toLocaleString("en-US").padStart(8)} XP\``;
  });

  return {
    embeds: [embed("🏆 Top 10 ET Players", {
      description: "Ranked by total XP",
      color: 0xffd700,
      fields: [{ name: "Leaderboard", value: lines.join("\n"), inline: false }],
    })],
  };
}

/** `!desync` confirmation. */
export function desyncEmbeds(guid: string, discordName: string): CommandResult {
  return {
    embeds: [embed("🔄 Account Desynced", {
      description: "Your ET account has been disconnected from Discord.",
      color: 0xff9900,
      fields: [
        { name: "Disconnected Details", value: `Discord: ${discordName}\nET GUID: ${guid}`, inline: false },
        { name: "Note", value: "You can always reverify later using `!etverify`", inline: false },
      ],
    })],
  };
}

/** Instructions shown to the server owner (or anyone else) who clicks the
 *  "Set This Nickname" button — mirrors the original UpdateNicknameButton. */
export function ownerNicknameEmbeds(newNickname: string): CommandResult {
  return {
    embeds: [embed("Update Your Nickname", {
      description: "Since you're the server owner, please copy and paste this nickname:",
      color: 0x00ff00,
      fields: [
        { name: "New Nickname", value: "```" + newNickname + "```", inline: false },
        {
          name: "Instructions",
          value: "1. Right-click your name in the server\n2. Select 'Edit Server Profile'\n3. Paste the nickname above\n4. Click Save",
          inline: false,
        },
      ],
    })],
  };
}
