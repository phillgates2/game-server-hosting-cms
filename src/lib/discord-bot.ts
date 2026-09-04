/**
 * WolfET-style Discord chat bot.
 *
 * The panel's Discord integration used to be fire-and-forget webhooks. This
 * module adds the gateway bot the community WolfET bot provides:
 *
 *   !etwho [name]     live status of one ET server (map, players, roster)
 *   !etallofoz        every ET server with real players
 *   !stats <name>     player XP from the game's user.sqlite (7 skills + total)
 *   !ettop10          XP leaderboard
 *   !etverify <GUID>  link your ET GUID (DM only, hides the GUID) + role
 *   !etsync           set your nickname to "name | 12,345 XP"
 *   !desync           unlink your GUID and remove the role
 *
 * Plus the 10-minute XP sync that keeps verified users' nicknames current.
 * The channel-name status update lives in the status-board loop (REST only).
 *
 * The bot token lives in the panel settings (never in code). Login failures —
 * including the privileged Message Content / Server Members intents not being
 * enabled in the Developer Portal — are logged with instructions and retried;
 * they can never take the panel down.
 */

import { db } from "@/db";
import { runtimeImport } from "@/lib/runtime-import";
import { getCachedView, setCachedView } from "@/lib/status-cache";
import type { BoardView } from "./status-board-embed";
import { gameServers, gameDefinitions, discordVerifications } from "@/db/schema";
import { eq } from "drizzle-orm";

const log = {
  info: (m: string, ...rest: unknown[]) => console.log("[discord-bot]", m, ...rest),
  warn: (m: string, ...rest: unknown[]) => console.warn("[discord-bot]", m, ...rest),
  error: (m: string, ...rest: unknown[]) => console.error("[discord-bot]", m, ...rest),
};

const PREFIX = "!";
/** External servers are probed in batches of this many (parallel UDP). */
const EXTRA_PROBE_BATCH = 8;
const COOLDOWNS: Record<string, number> = {
  etwho: 5,
  etallofoz: 5,
  stats: 5,
  ettop10: 30,
  etverify: 30,
  etsync: 30,
  desync: 30,
};
const XP_SYNC_INTERVAL_MS = 10 * 60_000;
const RETRY_DELAY_MS = 60_000;

// ── Structural view of the discord.js APIs this module touches ───────────────

interface RoleView {
  id: string;
  name: string;
  /** #rrggbb hex (discord.js exposes role.hexColor). */
  hexColor: string;
  position: number;
}
interface MemberView {
  id: string;
  username?: string;
  displayName: string;
  setNickname: (n: string) => Promise<unknown>;
  roles: {
    add: (id: string) => Promise<unknown>;
    remove: (id: string) => Promise<unknown>;
    /** Guild roles as a collection (Map-like: .get(id), .size). */
    cache?: Map<string, RoleView> | { get: (id: string) => RoleView | undefined };
    /** Ids of the roles this member holds. */
    ids?: string[];
  };
  /** Highest role this member holds (discord.js `member.topRole`). */
  topRole?: { position: number };
  /** This member's permission bitfield in the guild. */
  permissions?: { bitfield?: bigint };
}
interface GuildView {
  id: string;
  name: string;
  ownerId: string;
  me: { topRole: { position: number }; permissions?: { bitfield?: bigint } } | null;
  roles: {
    cache: Map<string, RoleView> | { get: (name: string) => RoleView | undefined };
    create: (o: { name: string; color: number; reason: string }) => Promise<RoleView>;
  };
  members: { fetch: (id: string) => Promise<MemberView> };
}
interface ClientView {
  user: { tag?: string; username?: string } | null;
  destroy: () => Promise<void>;
  login: (token: string) => Promise<unknown>;
  once: (event: string, cb: (...args: unknown[]) => void) => ClientView;
  on: (event: string, cb: (...args: unknown[]) => void) => ClientView;
  guilds: { fetch: (id: string) => Promise<GuildView> };
}

/** The bare discord.js surface the bot touches, typed structurally so the
 *  gateway module never needs a static import at build time. */
interface GatewayClient {
  user: { tag?: string } | null;
  destroy: () => Promise<void>;
  login: (token: string) => Promise<unknown>;
  once: (event: string, cb: (...args: unknown[]) => void) => unknown;
  on: (event: string, cb: (...args: unknown[]) => void) => unknown;
}

function asClient(value: unknown): ClientView {
  return value as ClientView;
}

// ── Cooldowns (per user, per command; single-node like the login throttle) ───

/** Discord's Manage Nicknames permission bit (BOT permissions: 1 << 13). */
/**
 * The original bot checked `guild.me.guild_permissions.manage_nicknames`
 * before renaming anyone. When the bitfield is unavailable (e.g. a partial
 * fetch), fall through and let Discord decide.
 *
 * The bit is compared numerically (Decimal(0x2000)) to stay compatible with
 * the ES2017 target — discord.js v14 carries permission bitfields as BigInt
 * at runtime either way.
 */
function botCanManageNicks(guild: GuildView): boolean {
  const bf = guild.me?.permissions?.bitfield;
  return bf === undefined ? true : (bf & BigInt(0x2000)) !== BigInt(0);
}

const lastUsed = new Map<string, number>();

function cooldownRemaining(key: string, seconds: number): number {
  const now = Date.now();
  const at = lastUsed.get(key) ?? 0;
  const until = at + seconds * 1000;
  if (now < until) return Math.ceil((until - now) / 1000);
  lastUsed.set(key, now);
  return 0;
}

// ── ET data helpers ───────────────────────────────────────────────────────────

export interface EtServerRow {
  id: number;
  name: string;
  ipv4: string | null;
  ipv6: string | null;
  port: number;
  queryPort: number | null;
  status: string;
  installPath: string;
  variables: unknown;
  config: unknown;
  gameName: string | null;
  gameSlug: string | null;
}

/** Every installed Wolfenstein: Enemy Territory server. */
export async function etServers(): Promise<EtServerRow[]> {
  const rows = await db
    .select({
      id: gameServers.id,
      name: gameServers.name,
      ipv4: gameServers.ipv4,
      ipv6: gameServers.ipv6,
      port: gameServers.port,
      queryPort: gameServers.queryPort,
      status: gameServers.status,
      installPath: gameServers.installPath,
      variables: gameServers.variables,
      config: gameServers.config,
      gameName: gameDefinitions.name,
      gameSlug: gameDefinitions.slug,
    })
    .from(gameServers)
    .leftJoin(gameDefinitions, eq(gameServers.gameId, gameDefinitions.id))
    .where(eq(gameDefinitions.slug, "wolfenstein-et"))
    .limit(20);
  return rows;
}

/**
 * Read the game's stats database. `GSM_ET_USER_SQLITE` points at a specific
 * file (the original bot's layout); otherwise each ET server's install
 * directory is searched — the stat mods write `user.sqlite` there.
 */
export async function loadEtStatsData() {
  const { readEtStats, queryEtUsers } = await import("./et-stats");
  const env = process.env.GSM_ET_USER_SQLITE?.trim();
  if (env) {
    const { readFile, stat } = await import("node:fs/promises");
    try {
      const info = await stat(env);
      if (info.isFile()) {
        return { installPath: env, dbPath: env, users: await queryEtUsers(await readFile(env)) };
      }
    } catch {
      // fall through to the per-server search
    }
  }
  for (const server of await etServers()) {
    const source = await readEtStats(server.installPath);
    if (source) return source;
  }
  return null;
}

// ── Embed payloads (pure builders live in discord-commands.ts) ────────────────

/** Fill `view.roleColors` from the gateway; never throws, never blocks. */
async function attachRosterColors(view: BoardView): Promise<void> {
  try {
    if (view.online && view.names && view.names.length > 0) {
      view.roleColors = await rosterRoleColors(view.names);
    }
  } catch {
    // annotation is best-effort
  }
}

async function whoReply(server: EtServerRow, cached?: BoardView): Promise<unknown> {
  const { boardViewFor } = await import("./status-board");
  const { whoEmbeds } = await import("./discord-commands");
  const view = cached ?? (await boardViewFor(server as never));
  if (!cached) {
    setCachedView(server.id, view);
    await attachRosterColors(view);
  }
  return { embeds: whoEmbeds(view).embeds };
}

async function allServersReply(): Promise<unknown> {
  const { probePlayers } = await import("./players");
  const { allServersEmbeds } = await import("./discord-commands");
  const { getDiscordSettings } = await import("./discord-settings");
  const { loadExternalEtServers } = await import("./et-extra-servers");
  const servers = await etServers();
  const views = [];
  for (const s of servers) {
    const cached = getCachedView(s.id);
    if (cached) {
      views.push(cached);
      continue;
    }
    const probe = await probePlayers({
      gameSlug: "wolfenstein-et",
      host: s.ipv4 ?? "127.0.0.1",
      port: s.port,
      queryPort: s.queryPort,
      attempts: 1,
    });
    const view = {
      serverName: s.name,
      gameName: "Wolfenstein: Enemy Territory",
      address: s.ipv4 ? `\`${s.ipv4}:${s.port}\`` : `Port \`${s.port}\``,
      online: s.status === "running",
      map: probe.map,
      players: probe.players,
      maxPlayers: probe.maxPlayers,
      names: probe.names,
      pings: probe.pings,
      hostname: probe.hostname,
      probeFailed: !probe.ok && s.status === "running",
    };
    setCachedView(s.id, view);
    await attachRosterColors(view);
    views.push(view);
  }

  // Outside-the-panel ET servers: the configured list plus optional
  // master-server discovery, probed alongside the panel and shown in the
  // same embed with a 🌐 label. Cached under negative keys so panel ids
  // (always positive) can never collide; best-effort — bad config or a dead
  // master can never break the command, they only shrink the list.
  const settings = await getDiscordSettings();
  const extras = await loadExternalEtServers({
    configText: settings.extraServers,
    mastersText: settings.masterUrls,
    panelServers: servers.map((s) => ({ host: s.ipv4 ?? "127.0.0.1", port: s.port })),
  });
  if (extras.errors.length > 0) {
    log.info("etallofoz extras", extras.errors.join("; "));
  }
  // External servers are probed in small parallel batches: a master can
  // return the full cap and a sequential scan would take far too long. The
  // 3-minute status cache still shortcuts anything probed recently.
  const pending: Array<{ index: number; ex: (typeof extras.servers)[number] }> = [];
  for (let i = 0; i < extras.servers.length; i++) {
    const cacheKey = -(i + 1);
    const cached = getCachedView(cacheKey);
    if (cached) {
      views.push(cached);
    } else {
      pending.push({ index: i, ex: extras.servers[i] });
    }
  }
  for (let b = 0; b < pending.length; b += EXTRA_PROBE_BATCH) {
    const batch = pending.slice(b, b + EXTRA_PROBE_BATCH);
    const probed = await Promise.all(
      batch.map(async ({ index, ex }) => {
        const probe = await probePlayers({
          gameSlug: "wolfenstein-et",
          host: ex.host,
          port: ex.port,
          queryPort: ex.queryPort,
          attempts: 1,
        });
        const view = {
          serverName: `${ex.host}:${ex.port}`,
          gameName: "Wolfenstein: Enemy Territory",
          address: `\`${ex.host}:${ex.port}\``,
          online: probe.ok,
          map: probe.map,
          players: probe.players,
          maxPlayers: probe.maxPlayers,
          names: probe.names,
          pings: probe.pings,
          hostname: probe.hostname,
          probeFailed: !probe.ok,
          external: true,
        };
        setCachedView(-(index + 1), view);
        await attachRosterColors(view);
        return view;
      })
    );
    views.push(...probed);
  }
  return { embeds: allServersEmbeds(views, "ET Servers").embeds };
}

async function statsReply(query: string): Promise<unknown> {
  const { findClosestPlayer, cleanName } = await import("./et-stats");
  const { statsEmbeds } = await import("./discord-commands");
  const source = await loadEtStatsData();
  if (!source) {
    return { content: "❌ No statistics database found. Enable ET legacy stats on the server (its user.sqlite is read from the install directory, or set GSM_ET_USER_SQLITE)." };
  }
  const user = findClosestPlayer(source.users, query);
  if (!user) return { content: `❌ No player found matching '${cleanName(query)}'` };
  return { embeds: statsEmbeds(user).embeds };
}

async function top10Reply(): Promise<unknown> {
  const { rankByXp } = await import("./et-stats");
  const { top10Embeds } = await import("./discord-commands");
  const source = await loadEtStatsData();
  if (!source) {
    return { content: "❌ No statistics database found. Enable ET legacy stats on the server (its user.sqlite is read from the install directory, or set GSM_ET_USER_SQLITE)." };
  }
  return { embeds: top10Embeds(rankByXp(source.users)).embeds };
}

// ── GUID verification (stored in the panel database, not a sidecar sqlite) ───

async function verifyLink(discordId: string, guid: string, discordName: string) {
  const claimed = await db
    .select({ discordName: discordVerifications.discordName })
    .from(discordVerifications)
    .where(eq(discordVerifications.guid, guid))
    .limit(1);
  if (claimed.length > 0) {
    return { ok: false, error: `This GUID is already claimed by Discord user: ${claimed[0].discordName}` };
  }

  const source = await loadEtStatsData();
  if (!source) {
    return { ok: false, error: "No statistics database was found, so the GUID cannot be confirmed. Enable ET legacy stats (user.sqlite) on the server first." };
  }
  const exists = source.users.some((u) => u.guid.toUpperCase() === guid);
  if (!exists) {
    return { ok: false, error: "This GUID was not found in our ET server records. Please make sure you've played on an OZ server." };
  }

  await db
    .insert(discordVerifications)
    .values({ discordId, guid, verifiedAt: new Date(), discordName })
    .onConflictDoUpdate({
      target: discordVerifications.discordId,
      set: { guid, discordName, verifiedAt: new Date() },
    });

  return { ok: true };
}

async function removeLink(discordId: string): Promise<{ guid: string; discordName: string } | null> {
  const [row] = await db
    .select({ guid: discordVerifications.guid, discordName: discordVerifications.discordName })
    .from(discordVerifications)
    .where(eq(discordVerifications.discordId, discordId))
    .limit(1);
  if (!row) return null;
  await db.delete(discordVerifications).where(eq(discordVerifications.discordId, discordId));
  return { guid: row.guid, discordName: row.discordName ?? "" };
}

async function verifiedGuid(discordId: string): Promise<string | null> {
  const [row] = await db
    .select({ guid: discordVerifications.guid })
    .from(discordVerifications)
    .where(eq(discordVerifications.discordId, discordId))
    .limit(1);
  return row?.guid ?? null;
}

// ── Role / nickname helpers ───────────────────────────────────────────────────

async function ensureVerifiedRole(guild: GuildView): Promise<string> {
  const existing = guild.roles.cache.get("ET Verified");
  if (existing) return existing.id;
  const created = await guild.roles.create({ name: "ET Verified", color: 0x3b82f6, reason: "Role for verified ET players" });
  return created.id;
}

function xpNickname(displayName: string, totalXp: number): string {
  return `${displayName.split("|")[0].trim()} | ${totalXp.toLocaleString("en-US")} XP`;
}

// ── Gateway loop ──────────────────────────────────────────────────────────────

let client: ClientView | null = null;
let xpTimer: NodeJS.Timeout | null = null;
let retryTimer: NodeJS.Timeout | null = null;
let starting = false;

/** discord.js builders, cached after first load (module-level, not bundled). */
interface ButtonBuilderLike {
  setCustomId: (v: string) => ButtonBuilderLike;
  setLabel: (v: string) => ButtonBuilderLike;
  setStyle: (v: number) => ButtonBuilderLike;
}

interface GatewayModule {
  ButtonBuilder: new () => ButtonBuilderLike;
  ActionRowBuilder: new () => { addComponents: (c: unknown) => unknown };
  ButtonStyle: { Primary: number; Secondary: number };
}

let gatewayModule: GatewayModule | null = null;

async function getGatewayModule(): Promise<GatewayModule> {
  if (gatewayModule) return gatewayModule;
  gatewayModule = (await runtimeImport("discord.js")) as GatewayModule;
  return gatewayModule;
}

/** Start the gateway client (idempotent). Returns a stop handle. */
export function startDiscordBot(): () => void {
  if (client || retryTimer || starting) return () => stopDiscordBot();
  starting = true;
  void boot();
  return () => stopDiscordBot();
}

export async function stopDiscordBot(): Promise<void> {
  starting = false;
  if (xpTimer) { clearInterval(xpTimer); xpTimer = null; }
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  const c = client;
  client = null;
  if (c) await c.destroy().catch(() => undefined);
  log.info("stopped");
}

async function boot(): Promise<void> {
  try {
    const { getDiscordSettings } = await import("./discord-settings");
    const cfg = await getDiscordSettings();
    if (!cfg.botToken || !cfg.guildId) {
      log.info("no bot token / guild configured — idling (configure Settings → Discord to enable commands)");
      starting = false;
      return;
    }

    // discord.js is big and only needed by the gateway; defer the import so
    // the panel boots fast and the next build stays lean.
    const discordMod = (await runtimeImport("discord.js")) as {
      Client: new (opts: { intents: number[] }) => GatewayClient;
      GatewayIntentBits: Record<string, number>;
    };
    const { Client, GatewayIntentBits } = discordMod;
    const discordClient = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
      ],
    });
    client = asClient(discordClient);
    void Client;

    discordClient.once("ready", () => {
      log.info(`logged in as ${discordClient.user?.tag ?? "unknown"}`);
      if (!xpTimer) {
        xpTimer = setInterval(() => void syncVerifiedUsersXp(), XP_SYNC_INTERVAL_MS);
        xpTimer.unref?.();
        void syncVerifiedUsersXp();
      }
    });

    discordClient.on("messageCreate", (message) => {
      void handleMessage(message as never).catch((e: unknown) =>
        log.warn("message handler threw", e instanceof Error ? e.message : String(e))
      );
    });

    discordClient.on("error", (e: unknown) => log.warn("gateway error:", e instanceof Error ? e.message : String(e)));
    discordClient.on("shardError", (e: unknown) => log.warn("shard error:", e instanceof Error ? e.message : String(e)));
    discordClient.on("interactionCreate", (interaction) => {
      void handleInteraction(interaction as never).catch((e: unknown) =>
        log.warn("interaction handler threw", e instanceof Error ? e.message : String(e))
      );
    });

    await discordClient.login(cfg.botToken);
    starting = false;
  } catch (e: unknown) {
    starting = false;
    const dead = client;
    client = null;
    if (dead) await dead.destroy().catch(() => undefined);
    const msg = e instanceof Error ? e.message : String(e);
    if (/Privileged|intent/i.test(msg)) {
      log.error(
        `login refused: ${msg.slice(0, 300)} — enable "Server Members Intent" and ` +
          `"Message Content Intent" in the Discord Developer Portal → Bot → Privileged Gateway Intents.`
      );
    } else {
      log.error(`login failed: ${msg.slice(0, 300)}`);
    }
    // Self-heal: retry once a minute; a settings save or a fixed intent shows
    // up without a panel restart. Guarded so only one retry arms.
    if (!retryTimer) {
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void boot();
      }, RETRY_DELAY_MS);
      retryTimer.unref?.();
    }
  }
}

/** The message discord.js hands us, typed structurally. */
interface MessageView {
  author: { bot: boolean; id: string; username: string; send: (m: unknown) => Promise<unknown> };
  content: string;
  guild: { id: string } | null;
  channel: { send: (m: unknown) => Promise<{ edit: (o: unknown) => Promise<unknown> }> };
  reply: (m: unknown) => Promise<{ delete?: () => Promise<unknown> }>;
  delete?: () => Promise<unknown>;
  member: MemberView | null;
}

async function handleMessage(message: MessageView): Promise<void> {
  if (message.author.bot) return;
  const body = message.content.trim();
  if (!body.startsWith(PREFIX)) return;

  const parts = body.slice(PREFIX.length).trim().split(/\s+/);
  const cmd = (parts[0] || "").toLowerCase();
  const arg = parts.slice(1).join(" ").trim();
  const cooldown = COOLDOWNS[cmd] ?? 0;

  if (cooldown > 0) {
    const wait = cooldownRemaining(`${message.author.id}:${cmd}`, cooldown);
    if (wait > 0) {
      const cd = await message.reply({ content: `⏳ Command on cooldown. Please wait ${wait} seconds.` });
      // Like the original bot: wait out the cooldown, then tidy both messages.
      // Deleting the user's message needs Manage Messages; it is best-effort.
      setTimeout(() => {
        void cd.delete?.().catch(() => undefined);
        void message.delete?.().catch(() => undefined);
      }, wait * 1000);
      return;
    }
  }

  switch (cmd) {
    case "etwho": {
      const servers = await etServers();
      if (servers.length === 0) {
        await message.reply({ content: "❌ No Wolfenstein: Enemy Territory servers installed." });
        return;
      }
      const target = arg
        ? servers.find((s) => s.name.toLowerCase().includes(arg.toLowerCase()) ||
            `${s.ipv4}:${s.port}`.includes(arg))
        : servers[0];
      if (!target) {
        await message.reply({ content: `❌ No ET server matching '${arg}'. Try: ${servers.map((s) => s.name).join(", ")}` });
        return;
      }
      const cached = getCachedView(target.id);
      if (!cached) {
        await message.channel.send({ content: "⌛ Fetching fresh server status..." });
      }
      await message.reply(await whoReply(target, cached ?? undefined));
      return;
    }
    case "etallofoz":
    case "etall": {
      const progress = await message.channel.send({
        content: "⌛ Checking all OZ servers for players... (this may take a few seconds)",
      });
      const payload = (await allServersReply()) as { embeds: unknown[] };
      await progress.edit({ content: null, embeds: payload.embeds });
      return;
    }
    case "stats": {
      if (arg.length < 2) {
        await message.reply({ content: "❌ Player name must be at least 2 characters long" });
        return;
      }
      const { sanitizeInput } = await import("./et-stats");
      const clean = sanitizeInput(arg);
      if (clean !== arg) {
        await message.reply({ content: "❌ Invalid characters in player name" });
        return;
      }
      await message.reply(await statsReply(clean));
      return;
    }
    case "ettop10":
    case "top10": {
      const progress = await message.channel.send({ content: "⌛ Calculating top 10 players..." });
      const payload = (await top10Reply()) as { embeds: unknown[] };
      await progress.edit({ content: null, embeds: payload.embeds });
      return;
    }
    case "etverify": {
      // Hide the GUID from the channel, exactly like the original bot.
      await message.delete?.().catch(() => undefined);
      if (message.guild) {
        try {
          await message.author.send({
            content: "Please use this command in a DM: `!etverify your_guid_here`\n\n" +
              "To find your GUID: join an OZ server, press `~` to open the console, " +
              "type `/n_guid`, and copy the 32-character string.",
          });
          await message.reply({ content: `✅ ${message.author.username} — instructions sent in a DM!` });
        } catch {
          await message.reply({ content: "❌ I couldn't DM you — enable DMs from server members and try again." });
        }
        return;
      }
      const { isValidGuid } = await import("./et-stats");
      if (!arg) {
        const guide =
          "To find your GUID:\n" +
          "1. Join any OZ server\n" +
          "2. Press ~ to open console\n" +
          "3. Type `/n_guid` and press Enter\n" +
          "4. Copy the 32-character string shown (example format: AB7F5B25B19CFE79EFFCE6FF788DCECD)";
        await message.reply({ content: `❌ Please provide your GUID. ${guide}` });
        return;
      }
      if (!isValidGuid(arg)) {
        await message.reply({ content: "❌ Invalid GUID format. GUID should be a 32-character string of letters and numbers, e.g. AB7F5B25B19CFE79EFFCE6FF788DCECD" });
        return;
      }
      const result = await verifyLink(message.author.id, arg.toUpperCase(), message.author.username);
      if (!result.ok) {
        await message.reply({ content: `❌ ${result.error}` });
        return;
      }
      // Best-effort role grant (needs the guild cached by the gateway).
      try {
        const cfg = await loadBotConfig();
        if (client && cfg) {
          const guild = await client.guilds.fetch(cfg.guildId);
          const roleId = await ensureVerifiedRole(guild);
          const member = await guild.members.fetch(message.author.id);
          await member.roles.add(roleId).catch(() => undefined);
        }
      } catch (e: unknown) {
        log.warn("role grant failed", e instanceof Error ? e.message : String(e));
      }
      await message.reply({ content: "✅ Successfully verified! Your account is now linked. Use `!etsync` to update your nickname with XP." });
      return;
    }
    case "etsync": {
      const guid = await verifiedGuid(message.author.id);
      if (!guid) {
        await message.reply({ content: "❌ You need to verify your account first using `!etverify`" });
        return;
      }
      const source = await loadEtStatsData();
      if (!source) {
        await message.reply({ content: "❌ No statistics database found to read XP from." });
        return;
      }
      const user = source.users.find((u) => u.guid === guid) ?? null;
      if (!user) {
        await message.reply({ content: "❌ Could not find XP data for your account." });
        return;
      }
      const { decodeXp } = await import("./et-stats");
      const { total } = decodeXp(user.xp);

      // Guild resolution, exactly like the original: the invocation guild
      // wins; from a DM the configured guild is used (the original scanned
      // its mutual guilds as a last resort — same effective outcome).
      const cfg = await loadBotConfig();
      if (!client || !cfg) {
        await message.reply({ content: "❌ The bot is not connected right now." });
        return;
      }
      let guild: GuildView;
      let member: MemberView;
      try {
        const guildId = !message.guild || message.guild.id === cfg.guildId ? cfg.guildId : message.guild.id;
        guild = await client.guilds.fetch(guildId);
        member = message.guild && message.member
          ? (message.member as MemberView)
          : await guild.members.fetch(message.author.id);
      } catch (e: unknown) {
        log.warn("etsync guild lookup failed", e instanceof Error ? e.message : String(e));
        await message.reply({ content: "❌ Could not find a suitable server to update your nickname in." });
        return;
      }

      // Server owners cannot be renamed by a bot; DM them the original's
      // "Set This Nickname" button.
      if (member.id === guild.ownerId) {
        try {
          const dmod = await getGatewayModule();
          const button = new dmod.ButtonBuilder()
            .setCustomId(`etnick:${guild.id}:${Buffer.from(xpNickname(member.displayName, total), "utf8").toString("base64url")}`)
            .setLabel("Set This Nickname")
            .setStyle(dmod.ButtonStyle.Primary);
          const row = new dmod.ActionRowBuilder().addComponents(button);
          await message.author.send({
            content: "As the server owner, you'll need to update your nickname manually.\nClick the button to get instructions and the new nickname to copy:",
            components: [row],
          });
          await message.reply({ content: "✅ I've sent you a DM with instructions to update your nickname!" });
        } catch {
          await message.reply({ content: "❌ I couldn't send you a DM. Please enable DMs from server members." });
        }
        return;
      }

      // The original's explicit checks, with the original's messages.
      if (!botCanManageNicks(guild)) {
        await message.reply({ content: "❌ I don't have permission to change nicknames. Please give me the 'Manage Nicknames' permission." });
        return;
      }
      if ((guild.me?.topRole?.position ?? 0) <= (member.topRole?.position ?? 0)) {
        await message.reply({ content: "❌ I cannot modify your nickname because your role is higher than or equal to mine." });
        return;
      }

      try {
        await member.setNickname(xpNickname(member.displayName, total));
      } catch (e: unknown) {
        log.warn("etsync setNickname failed", e instanceof Error ? e.message : String(e));
        await message.reply({ content: "❌ An error occurred while updating your nickname." });
        return;
      }
      await message.reply({ content: `✅ Nickname updated with current XP in server: ${guild.name}!` });
      return;
    }
    case "desync": {
      const removed = await removeLink(message.author.id);
      if (!removed) {
        await message.reply({ content: "❌ You don't have any active ET verification to remove." });
        return;
      }
      try {
        const cfg = await loadBotConfig();
        if (client && cfg) {
          const guild = await client.guilds.fetch(cfg.guildId);
          const role = guild.roles.cache.get("ET Verified");
          if (role) {
            const member = await guild.members.fetch(message.author.id);
            await member.roles.remove(role.id).catch(() => undefined);
          }
        }
      } catch {
        // role removal is best-effort
      }
      const { desyncEmbeds } = await import("./discord-commands");
      await message.reply({ embeds: desyncEmbeds(removed.guid, removed.discordName).embeds });
      return;
    }
    default:
      return;
  }
}

async function loadBotConfig(): Promise<{ botToken: string; guildId: string } | null> {
  const { getDiscordSettings } = await import("./discord-settings");
  const cfg = await getDiscordSettings();
  return cfg.botToken && cfg.guildId ? { botToken: cfg.botToken, guildId: cfg.guildId } : null;
}

// ── Roster role colors (board annotation) ────────────────────────────────────

/** Cleaned name -> hex, cached so board refreshes do not refetch members. */
const roleColorCache = new Map<string, { hex: string | null; at: number }>();
const ROLE_COLOR_TTL_MS = 10 * 60_000;

/**
 * Resolve the role color (highest non-@everyone role) for each verified
 * guild member whose display name matches an in-game player name.
 *
 * Best-effort and bounded: without a gateway connection nothing is
 * annotated; members are fetched at most once per 10-minute window; a
 * failure returns an empty map instead of breaking the board.
 */
export async function rosterRoleColors(names: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!client || !names || names.length === 0) return out;
  try {
    const { matchRoleColors, rosterKey } = await import("./discord-roster");
    const cfg = await loadBotConfig();
    if (!cfg) return out;

    // Only members whose stored name is plausibly on the roster get fetched:
    // the gateway is rate-limited, and a 200-player board must not fetch 200
    // members. Exact-or-partial key match first.
    const wanted = new Set(names.map(rosterKey).filter(Boolean));
    const verifications = await db.select().from(discordVerifications).limit(200);
    const candidates = verifications.filter((v) => {
      const key = rosterKey(v.discordName ?? "");
      if (!key) return false;
      for (const w of wanted) {
        if (key === w || key.includes(w) || w.includes(key)) return true;
      }
      return false;
    });
    if (candidates.length === 0) return out;

    const members: Array<{ discordName: string; colorHex: string | null }> = [];
    const now = Date.now();
    for (const v of candidates) {
      const cached = roleColorCache.get(v.discordId);
      let hex: string | null = cached && now - cached.at < ROLE_COLOR_TTL_MS
        ? cached.hex
        : null;
      if (!cached || now - cached.at >= ROLE_COLOR_TTL_MS) {
        try {
          const guild = await client.guilds.fetch(cfg.guildId);
          const member = await guild.members.fetch(v.discordId);
          hex = memberTopRoleHex(member);
        } catch {
          hex = null;
        }
        roleColorCache.set(v.discordId, { hex, at: now });
      }
      if (hex) {
        members.push({ discordName: v.discordName ?? "", colorHex: hex });
      }
    }

    return matchRoleColors(names, members);
  } catch (e: unknown) {
    log.warn("roster role colors failed", e instanceof Error ? e.message : String(e));
    return out;
  }
}

/** Highest role's hex color, skipping @everyone (position 0). */
function memberTopRoleHex(member: MemberView): string | null {
  const cache = member.roles.cache;
  if (!cache) return null;
  let best: RoleView | null = null;
  for (const role of cache instanceof Map ? cache.values() : []) {
    if (role.name === "@everyone") continue;
    if (!best || role.position > best.position) best = role;
  }
  // discord.js gives roles a default color of the @everyone gray; treat that
  // as "no distinguishing color" rather than annotating everyone gray.
  if (!best || best.hexColor === "#000000" || best.hexColor === "#99aab5") return null;
  return best.hexColor;
}

/**
 * The 10-minute XP sync: refresh every verified user's nickname from the
 * stats database. Skipped for the server owner (a bot cannot nick the
 * owner); role-hierarchy failures are logged and skipped.
 */
/**
 * The "Set This Nickname" button from the original bot: only the server owner
 * can click it, and it replies (ephemerally) with the nickname to copy.
 */
async function handleInteraction(interaction: unknown): Promise<void> {
  const i = interaction as {
    isButton?: () => boolean;
    customId?: string;
    guildId?: string | null;
    user?: { id: string };
    reply?: (o: unknown) => Promise<unknown>;
  };
  if (!i?.isButton?.() || !i.customId?.startsWith("etnick:") || !i.guildId) return;
  const parts = i.customId.split(":");
  const guildId = parts[1];
  const b64 = parts[2];
  if (!guildId || b64 === undefined || !i.user?.id) return;
  let nickname = "";
  try {
    nickname = Buffer.from(b64, "base64url").toString("utf8");
  } catch {
    return;
  }
  if (!client) return;
  try {
    const guild = await client.guilds.fetch(guildId);
    if (i.user.id !== guild.ownerId) {
      await i.reply?.({ content: "❌ This button is only for the server owner.", ephemeral: true });
      return;
    }
    const { ownerNicknameEmbeds } = await import("./discord-commands");
    const result = ownerNicknameEmbeds(nickname);
    await i.reply?.({ ephemeral: true, embeds: result.embeds });
  } catch (e: unknown) {
    log.warn("nickname button failed", e instanceof Error ? e.message : String(e));
    await i.reply?.({ content: "❌ An error occurred.", ephemeral: true }).catch(() => undefined);
  }
}

export async function syncVerifiedUsersXp(): Promise<void> {
  try {
    const verifications = await db.select().from(discordVerifications).limit(500);
    if (verifications.length === 0) return;
    const source = await loadEtStatsData();
    if (!source) return;
    const cfg = await loadBotConfig();
    if (!client || !cfg) return;

    const guild = await client.guilds.fetch(cfg.guildId);
    // Original behaviour: without Manage Nicknames the whole run is pointless.
    if (!botCanManageNicks(guild)) {
      log.warn("XP sync skipped — bot lacks the Manage Nicknames permission");
      return;
    }
    const botTop = guild.me?.topRole?.position ?? 0;
    let updated = 0;
    let skipped = 0;

    const { decodeXp } = await import("./et-stats");
    for (const v of verifications) {
      try {
        const user = source.users.find((u) => u.guid === v.guid) ?? null;
        if (!user) { skipped++; continue; }
        const { total } = decodeXp(user.xp);
        const member = await guild.members.fetch(v.discordId);
        if (member.id === guild.ownerId) { skipped++; continue; }
        // Same hierarchy guard the original applied before renaming.
        if ((member.topRole?.position ?? 0) >= botTop) { skipped++; continue; }
        const next = xpNickname(member.displayName, total);
        if (member.displayName === next) continue;
        await member.setNickname(next);
        updated++;
      } catch {
        skipped++;
      }
    }
    if (updated > 0) log.info(`XP sync: ${updated} updated, ${skipped} skipped`);
  } catch (e: unknown) {
    log.warn("XP sync failed:", e instanceof Error ? e.message : String(e));
  }
}
