import { V, group, STEAM_VARS, RCON_VARS, type GameTemplate } from "./types";
import { steamInstallScript } from "./steamcmd";

// Quake Live is id Tech 3: baseq3/server.cfg holds `seta cvar "value"` lines.
export const quakeLive: GameTemplate = {
  slug: "quake-live",
  name: "Quake Live",
  engine: "id Tech 3",
  defaultPort: 27960,
  steamAppId: "349090",
  iconEmoji: "💀",
  supportsIpv6: false,
  category: "Classic",
  description: "Fast-paced arena shooter",
  estimatedSize: "~1 GB",
  variables: [
    ...STEAM_VARS,
    ...RCON_VARS,

    ...group("Match Setup", [
      V("Game Type", "GAMETYPE", "g_gametype — which mode the server runs", "4", {
        required: false, type: "select",
        enum_values: {
          "0": "0 — Free For All", "1": "1 — Duel", "2": "2 — Race", "3": "3 — Team Deathmatch",
          "4": "4 — Clan Arena", "5": "5 — Capture the Flag", "6": "6 — One Flag CTF",
          "8": "8 — Harvester", "9": "9 — Freeze Tag", "10": "10 — Domination",
          "11": "11 — Attack & Defend", "12": "12 — Red Rover",
        },
      }),
      V("Start Map", "START_MAP", "Map loaded on start", "campgrounds", { required: false }),
      V("Map Rotation File", "MAP_ROTATION_FILE", "Rotation script executed at map end", "map_rotation.txt", { required: false }),
      V("Frag Limit", "FRAGLIMIT", "Frags before the match ends, 0 = unlimited", "0", {
        required: false, type: "number", min_value: 0, max_value: 1000,
      }),
      V("Time Limit", "TIMELIMIT", "Match length in minutes, 0 = unlimited", "15", {
        required: false, type: "number", min_value: 0, max_value: 240,
      }),
      V("Capture Limit", "CAPTURELIMIT", "Flag captures before the match ends", "8", {
        required: false, type: "number", min_value: 0, max_value: 100,
      }),
      V("Round Limit", "ROUNDLIMIT", "Rounds before the match ends (round-based modes)", "10", {
        required: false, type: "number", min_value: 0, max_value: 100,
      }),
      V("Round Time Limit", "ROUNDTIMELIMIT", "Seconds per round", "180", {
        required: false, type: "number", min_value: 30, max_value: 1800,
      }),
      V("Warmup Delay", "G_WARMUP", "Warmup length in seconds", "10", {
        required: false, type: "number", min_value: 0, max_value: 600,
      }),
      V("Do Warmup", "G_DOWARMUP", "Run a warmup period before the match", "1", { required: false, type: "boolean" }),
      V("Instagib", "G_INSTAGIB", "One-shot railgun-only mode", "0", { required: false, type: "boolean" }),
    ]),

    ...group("Gameplay Rules", [
      V("Friendly Fire", "G_FRIENDLYFIRE", "Teammates can damage each other", "0", { required: false, type: "boolean" }),
      V("Team Auto Join", "G_TEAMAUTOJOIN", "Automatically place joining players on a team", "0", { required: false, type: "boolean" }),
      V("Force Balance", "G_TEAMFORCEBALANCE", "Prevent players stacking one team", "1", { required: false, type: "boolean" }),
      V("Allow Vote", "G_ALLOWVOTE", "Enable the in-game vote system", "1", { required: false, type: "boolean" }),
      V("Vote Flags", "G_VOTEFLAGS", "Bitmask of disallowed vote types, 0 = all allowed", "0", {
        required: false, type: "number", min_value: 0, max_value: 2147483647,
      }),
      V("Quad Damage Factor", "G_QUADFACTOR", "Damage multiplier while carrying Quad", "3", {
        required: false, type: "number", min_value: 1, max_value: 100,
      }),
      V("Weapon Respawn", "G_WEAPONRESPAWN", "Seconds before weapons respawn", "5", {
        required: false, type: "number", min_value: 0, max_value: 120,
      }),
      V("Item Respawn Multiplier", "G_ITEMTIMER", "Scales all item respawn timers", "1", {
        required: false, type: "number", min_value: 0, max_value: 10,
      }),
      V("Inactivity Timeout", "G_INACTIVITY", "Seconds before an idle player is moved to spectator, 0 = off", "0", {
        required: false, type: "number", min_value: 0, max_value: 3600,
      }),
      V("Speed", "G_SPEED", "Player movement speed", "320", {
        required: false, type: "number", min_value: 100, max_value: 2000,
      }),
      V("Gravity", "G_GRAVITY", "World gravity", "800", {
        required: false, type: "number", min_value: 0, max_value: 5000,
      }),
      V("Knockback", "G_KNOCKBACK", "Explosion knockback strength", "1000", {
        required: false, type: "number", min_value: 0, max_value: 10000,
      }),
      V("Force Respawn", "G_FORCERESPAWN", "Seconds before dead players are forced to respawn, 0 = manual", "0", {
        required: false, type: "number", min_value: 0, max_value: 120,
      }),
    ]),

    ...group("Bots", [
      V("Bot Min Players", "BOT_MINPLAYERS", "Top the server up to this many players with bots, 0 = off", "0", {
        required: false, type: "number", min_value: 0, max_value: 32,
      }),
      V("Bot Skill", "G_SPSKILL", "Bot difficulty from 1 (easy) to 5 (nightmare)", "3", {
        required: false, type: "select",
        enum_values: { "1": "1 — I can win", "2": "2 — Bring it on", "3": "3 — Hurt me plenty", "4": "4 — Hardcore", "5": "5 — Nightmare" },
      }),
      V("Bots Enabled", "BOT_ENABLE", "Allow bots on the server", "1", { required: false, type: "boolean" }),
    ]),

    ...group("Access & Network", [
      V("Server Password", "G_PASSWORD", "Password required to join, empty = public", "", { required: false, type: "password" }),
      V("Private Clients", "SV_PRIVATECLIENTS", "Slots reserved for the private password", "0", {
        required: false, type: "number", min_value: 0, max_value: 64,
      }),
      V("Private Password", "SV_PRIVATEPASSWORD", "Password granting a reserved slot", "", { required: false, type: "password" }),
      V("Public Server", "SV_PUBLIC", "Advertise on the master server (1 = listed)", "1", {
        required: false, type: "select", enum_values: { "1": "1 — Public", "0": "0 — Unlisted", "-1": "-1 — LAN only" },
      }),
      V("Max Rate", "SV_MAXRATE", "Per-client bandwidth cap in bytes/sec, 0 = unlimited", "25000", {
        required: false, type: "number", min_value: 0, max_value: 1000000,
      }),
      V("Min Ping", "SV_MINPING", "Reject clients below this ping, 0 = no minimum", "0", {
        required: false, type: "number", min_value: 0, max_value: 999,
      }),
      V("Max Ping", "SV_MAXPING", "Reject clients above this ping, 0 = no maximum", "0", {
        required: false, type: "number", min_value: 0, max_value: 999,
      }),
      V("Flood Protect", "SV_FLOODPROTECT", "Rate-limit client commands", "1", { required: false, type: "boolean" }),
      V("Pure Server", "SV_PURE", "Enforce matching pk3 files on clients", "1", { required: false, type: "boolean" }),
      V("Allow Downloads", "SV_ALLOWDOWNLOAD", "Let clients download missing content", "1", { required: false, type: "boolean" }),
      V("Idle Server Timeout", "SV_IDLESERVERTIMEOUT", "Seconds an empty server stays up, -1 = forever", "-1", {
        required: false, type: "number", min_value: -1, max_value: 86400,
      }),
      V("Server Location", "SV_LOCATION", "Region tag shown in the browser", "", { required: false }),
      V("Server Tags", "SV_TAGS", "Comma-separated browser tags", "", { required: false }),
      V("Zealous Server Restart", "ZMQ_RCON_ENABLE", "Enable the ZeroMQ RCON interface used by minqlx", "0", { required: false, type: "boolean" }),
      V("ZMQ RCON Port", "ZMQ_RCON_PORT", "Port for the ZeroMQ RCON socket", "28960", {
        required: false, type: "number", min_value: 1, max_value: 65535,
      }),
      V("ZMQ RCON Password", "ZMQ_RCON_PASSWORD", "Password for the ZeroMQ RCON socket", "", { required: false, type: "password" }),
    ]),
  ],

  installScript: steamInstallScript({
    appId: "349090",
    name: "Quake Live",
    post: `## id Tech 3 reads cfgs from baseq3 — the panel writes server.cfg there
mkdir -p "$INSTALL_DIR/baseq3"`,
  }),

  startCommand: `cd {{INSTALL_PATH}} && ./run_server_x64.sh +set net_port {{PORT}} +set fs_homepath "{{INSTALL_PATH}}" +set dedicated 2 +exec server.cfg`,
  stopCommand: "quit",
  configFiles: { "baseq3/server.cfg": "server.cfg" },
  defaultConfig: {
    __gsm_format: "q3seta",
    sv_hostname: "{{SERVER_NAME}}",
    sv_maxclients: "{{MAX_PLAYERS}}",
    rconpassword: "{{RCON_PASSWORD}}",
    g_password: "{{G_PASSWORD}}",
    sv_privateClients: "{{SV_PRIVATECLIENTS}}",
    sv_privatePassword: "{{SV_PRIVATEPASSWORD}}",
    sv_public: "{{SV_PUBLIC}}",
    sv_maxRate: "{{SV_MAXRATE}}",
    sv_minPing: "{{SV_MINPING}}",
    sv_maxPing: "{{SV_MAXPING}}",
    sv_floodProtect: "{{SV_FLOODPROTECT}}",
    sv_pure: "{{SV_PURE}}",
    sv_allowDownload: "{{SV_ALLOWDOWNLOAD}}",
    sv_idleServerTimeout: "{{SV_IDLESERVERTIMEOUT}}",
    sv_location: "{{SV_LOCATION}}",
    sv_tags: "{{SV_TAGS}}",
    g_gametype: "{{GAMETYPE}}",
    fraglimit: "{{FRAGLIMIT}}",
    timelimit: "{{TIMELIMIT}}",
    capturelimit: "{{CAPTURELIMIT}}",
    roundlimit: "{{ROUNDLIMIT}}",
    roundtimelimit: "{{ROUNDTIMELIMIT}}",
    g_warmup: "{{G_WARMUP}}",
    g_doWarmup: "{{G_DOWARMUP}}",
    g_instagib: "{{G_INSTAGIB}}",
    g_friendlyFire: "{{G_FRIENDLYFIRE}}",
    g_teamAutoJoin: "{{G_TEAMAUTOJOIN}}",
    g_teamForceBalance: "{{G_TEAMFORCEBALANCE}}",
    g_allowVote: "{{G_ALLOWVOTE}}",
    g_voteFlags: "{{G_VOTEFLAGS}}",
    g_quadfactor: "{{G_QUADFACTOR}}",
    g_weaponrespawn: "{{G_WEAPONRESPAWN}}",
    g_itemtimer: "{{G_ITEMTIMER}}",
    g_inactivity: "{{G_INACTIVITY}}",
    g_speed: "{{G_SPEED}}",
    g_gravity: "{{G_GRAVITY}}",
    g_knockback: "{{G_KNOCKBACK}}",
    g_forcerespawn: "{{G_FORCERESPAWN}}",
    bot_enable: "{{BOT_ENABLE}}",
    bot_minplayers: "{{BOT_MINPLAYERS}}",
    g_spSkill: "{{G_SPSKILL}}",
    zmq_rcon_enable: "{{ZMQ_RCON_ENABLE}}",
    zmq_rcon_port: "{{ZMQ_RCON_PORT}}",
    zmq_rcon_password: "{{ZMQ_RCON_PASSWORD}}",
    sv_mapRotationFile: "{{MAP_ROTATION_FILE}}",
    map: "{{START_MAP}}",
  },
};
