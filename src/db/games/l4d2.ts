import { V, group, STEAM_VARS, RCON_VARS, type GameTemplate } from "./types";
import { steamInstallScript } from "./steamcmd";

// Left 4 Dead 2 dedicated server (srcds). Reads left4dead2/cfg/server.cfg.
export const l4d2: GameTemplate = {
  slug: "l4d2",
  name: "Left 4 Dead 2",
  engine: "Source",
  defaultPort: 27015,
  steamAppId: "222860",
  iconEmoji: "🧟",
  supportsIpv6: true,
  category: "FPS",
  description: "Co-op zombie survival shooter",
  estimatedSize: "~12 GB",
  variables: [
    ...STEAM_VARS,
    ...RCON_VARS,

    ...group("Match Setup", [
      V("Map", "MAP", "Starting map", "c1m1_hotel", { required: false }),
      V("Game Mode", "MP_GAMEMODE", "Campaign mode loaded on start", "coop", {
        required: false, type: "select",
        enum_values: {
          coop: "Co-op", versus: "Versus", survival: "Survival", scavenge: "Scavenge",
          realism: "Realism", realismversus: "Realism Versus", mutation: "Mutation",
        },
      }),
      V("Difficulty", "Z_DIFFICULTY", "Campaign difficulty", "Normal", {
        required: false, type: "select",
        enum_values: { Easy: "Easy", Normal: "Normal", Hard: "Advanced", Impossible: "Expert" },
      }),
      V("Max Survivors", "SURVIVOR_LIMIT", "Number of survivor slots", "4", {
        required: false, type: "number", min_value: 1, max_value: 32,
      }),
      V("Max Infected", "Z_MAX_PLAYER_ZOMBIES", "Special infected slots in versus", "4", {
        required: false, type: "number", min_value: 0, max_value: 32,
      }),
      V("Allow Survivor Bots", "SB_ALL_BOT_GAME", "Fill empty survivor slots with bots", "1", { required: false, type: "boolean" }),
      V("Bot Difficulty", "SB_STOP", "Stop survivor bots from moving (debug)", "0", { required: false, type: "boolean" }),
    ]),

    ...group("Director & Gameplay", [
      V("Friendly Fire Factor (Easy)", "SURVIVOR_FRIENDLYFIRE_FACTOR_EASY", "Fraction of friendly-fire damage applied on Easy", "0", { required: false, type: "float", min_value: 0, max_value: 5 }),
      V("Friendly Fire Factor (Normal)", "SURVIVOR_FRIENDLYFIRE_FACTOR_NORMAL", "Fraction of friendly-fire damage on Normal", "1", { required: false, type: "float", min_value: 0, max_value: 5 }),
      V("Friendly Fire Factor (Hard)", "SURVIVOR_FRIENDLYFIRE_FACTOR_HARD", "Fraction of friendly-fire damage on Advanced", "1", { required: false, type: "float", min_value: 0, max_value: 5 }),
      V("Friendly Fire Factor (Expert)", "SURVIVOR_FRIENDLYFIRE_FACTOR_EXPERT", "Fraction of friendly-fire damage on Expert", "1", { required: false, type: "float", min_value: 0, max_value: 5 }),
      V("Common Infected Limit", "Z_COMMON_LIMIT", "Maximum common infected alive at once", "30", {
        required: false, type: "number", min_value: 0, max_value: 200,
      }),
      V("Force Versus Start", "MP_GAMEMODE_FORCE_VERSUS_START", "Skip the versus lobby countdown", "0", { required: false, type: "boolean" }),
      V("Disable Adrenaline", "DIRECTOR_NO_SPECIALS", "Stop the director spawning special infected", "0", { required: false, type: "boolean" }),
      V("No Bosses", "DIRECTOR_NO_BOSSES", "Stop the director spawning Tanks and Witches", "0", { required: false, type: "boolean" }),
      V("No Mobs", "DIRECTOR_NO_MOBS", "Stop the director spawning horde mobs", "0", { required: false, type: "boolean" }),
      V("Tank Health", "Z_TANK_HEALTH", "Hit points a Tank spawns with", "4000", {
        required: false, type: "number", min_value: 1, max_value: 100000,
      }),
      V("Witch Health", "Z_WITCH_HEALTH", "Hit points a Witch spawns with", "1000", {
        required: false, type: "number", min_value: 1, max_value: 100000,
      }),
      V("Respawn Time", "SURVIVOR_RESPAWN_TIME", "Seconds before an incapacitated survivor respawns in a closet", "30", {
        required: false, type: "number", min_value: 0, max_value: 600,
      }),
      V("Allow All Bot Game", "ALLOW_ALL_BOT_SURVIVOR_TEAM", "Let the campaign run with no humans", "1", { required: false, type: "boolean" }),
    ]),

    ...group("Server Rules", [
      V("Server Password", "SV_PASSWORD", "Password required to join, empty = public", "", { required: false, type: "password" }),
      V("Steam Group ID", "SV_STEAMGROUP", "Steam group whose members see the server in-game", "", { required: false }),
      V("Steam Group Exclusive", "SV_STEAMGROUP_EXCLUSIVE", "Only allow members of the Steam group", "0", { required: false, type: "boolean" }),
      V("Search Key", "SV_SEARCH_KEY", "Custom lobby matchmaking key for private matches", "", { required: false }),
      V("Allow Lobby Connect Only", "SV_ALLOW_LOBBY_CONNECT_ONLY", "Require players to arrive through a Steam lobby — set 0 for direct connect", "0", { required: false, type: "boolean" }),
      V("Cheats", "SV_CHEATS", "Allow cheat commands", "0", { required: false, type: "boolean" }),
      V("LAN Mode", "SV_LAN", "Run in LAN mode (no Steam authentication)", "0", { required: false, type: "boolean" }),
      V("Alltalk", "SV_ALLTALK", "Both teams hear each other's voice chat", "0", { required: false, type: "boolean" }),
      V("Voice Enable", "SV_VOICEENABLE", "Enable in-game voice chat", "1", { required: false, type: "boolean" }),
      V("Consistency Check", "SV_CONSISTENCY", "Enforce client file consistency", "1", { required: false, type: "boolean" }),
      V("Pure Server", "SV_PURE", "Enforce pure client content (-1 off, 0 relaxed, 1 strict)", "1", {
        required: false, type: "select",
        enum_values: { "-1": "-1 — Off", "0": "0 — Relaxed", "1": "1 — Strict", "2": "2 — Full" },
      }),
      V("Allow Downloads", "SV_ALLOWDOWNLOAD", "Allow clients to download content from the server", "1", { required: false, type: "boolean" }),
      V("Fast Download URL", "SV_DOWNLOADURL", "HTTP fast-download base URL", "", { required: false }),
      V("Pausable", "SV_PAUSABLE", "Allow clients to pause the server", "0", { required: false, type: "boolean" }),
      V("Timeout", "SV_TIMEOUT", "Seconds before an unresponsive client is dropped", "65", {
        required: false, type: "number", min_value: 5, max_value: 600,
      }),
      V("Region", "SV_REGION", "Master-server region (255 = world)", "255", {
        required: false, type: "select",
        enum_values: {
          "0": "0 — US East", "1": "1 — US West", "2": "2 — South America", "3": "3 — Europe",
          "4": "4 — Asia", "5": "5 — Australia", "6": "6 — Middle East", "7": "7 — Africa", "255": "255 — World",
        },
      }),
      V("Log Enable", "LOG", "Write server logs to disk", "on", {
        required: false, type: "select", enum_values: { on: "On", off: "Off" },
      }),
    ]),

    ...group("Network & Rates", [
      V("Max Update Rate", "SV_MAXUPDATERATE", "Maximum client update rate (ticks/sec)", "30", {
        required: false, type: "number", min_value: 10, max_value: 128,
      }),
      V("Min Update Rate", "SV_MINUPDATERATE", "Minimum client update rate", "20", {
        required: false, type: "number", min_value: 10, max_value: 128,
      }),
      V("Max Cmd Rate", "SV_MAXCMDRATE", "Maximum client command rate", "30", {
        required: false, type: "number", min_value: 10, max_value: 128,
      }),
      V("Min Cmd Rate", "SV_MINCMDRATE", "Minimum client command rate", "20", {
        required: false, type: "number", min_value: 10, max_value: 128,
      }),
      V("Max Rate", "SV_MAXRATE", "Per-client bandwidth cap in bytes/sec, 0 = unlimited", "30000", {
        required: false, type: "number", min_value: 0, max_value: 10000000,
      }),
      V("Min Rate", "SV_MINRATE", "Per-client bandwidth floor in bytes/sec", "5000", {
        required: false, type: "number", min_value: 0, max_value: 10000000,
      }),
    ]),
  ],

  installScript: steamInstallScript({
    appId: "222860",
    name: "Left 4 Dead 2",
    post: `## srcds reads cfg files from left4dead2/cfg — the panel writes server.cfg there
mkdir -p "$INSTALL_DIR/left4dead2/cfg"`,
  }),

  startCommand: `cd {{INSTALL_PATH}} && ./srcds_run -game left4dead2 -console -port {{PORT}} +maxplayers {{MAX_PLAYERS}} +map {{MAP}} +mp_gamemode {{MP_GAMEMODE}}`,
  stopCommand: "quit",
  configFiles: { "left4dead2/cfg/server.cfg": "server.cfg" },
  defaultConfig: {
    __gsm_format: "source",
    hostname: "{{SERVER_NAME}}",
    rcon_password: "{{RCON_PASSWORD}}",
    sv_password: "{{SV_PASSWORD}}",
    sv_steamgroup: "{{SV_STEAMGROUP}}",
    sv_steamgroup_exclusive: "{{SV_STEAMGROUP_EXCLUSIVE}}",
    sv_search_key: "{{SV_SEARCH_KEY}}",
    sv_allow_lobby_connect_only: "{{SV_ALLOW_LOBBY_CONNECT_ONLY}}",
    sv_cheats: "{{SV_CHEATS}}",
    sv_lan: "{{SV_LAN}}",
    sv_alltalk: "{{SV_ALLTALK}}",
    sv_voiceenable: "{{SV_VOICEENABLE}}",
    sv_consistency: "{{SV_CONSISTENCY}}",
    sv_pure: "{{SV_PURE}}",
    sv_allowdownload: "{{SV_ALLOWDOWNLOAD}}",
    sv_downloadurl: "{{SV_DOWNLOADURL}}",
    sv_pausable: "{{SV_PAUSABLE}}",
    sv_timeout: "{{SV_TIMEOUT}}",
    sv_region: "{{SV_REGION}}",
    log: "{{LOG}}",
    mp_gamemode: "{{MP_GAMEMODE}}",
    z_difficulty: "{{Z_DIFFICULTY}}",
    survivor_limit: "{{SURVIVOR_LIMIT}}",
    z_max_player_zombies: "{{Z_MAX_PLAYER_ZOMBIES}}",
    sb_all_bot_game: "{{SB_ALL_BOT_GAME}}",
    sb_stop: "{{SB_STOP}}",
    allow_all_bot_survivor_team: "{{ALLOW_ALL_BOT_SURVIVOR_TEAM}}",
    survivor_friendlyfire_factor_easy: "{{SURVIVOR_FRIENDLYFIRE_FACTOR_EASY}}",
    survivor_friendlyfire_factor_normal: "{{SURVIVOR_FRIENDLYFIRE_FACTOR_NORMAL}}",
    survivor_friendlyfire_factor_hard: "{{SURVIVOR_FRIENDLYFIRE_FACTOR_HARD}}",
    survivor_friendlyfire_factor_expert: "{{SURVIVOR_FRIENDLYFIRE_FACTOR_EXPERT}}",
    survivor_respawn_time: "{{SURVIVOR_RESPAWN_TIME}}",
    z_common_limit: "{{Z_COMMON_LIMIT}}",
    z_tank_health: "{{Z_TANK_HEALTH}}",
    z_witch_health: "{{Z_WITCH_HEALTH}}",
    mp_gamemode_force_versus_start: "{{MP_GAMEMODE_FORCE_VERSUS_START}}",
    director_no_specials: "{{DIRECTOR_NO_SPECIALS}}",
    director_no_bosses: "{{DIRECTOR_NO_BOSSES}}",
    director_no_mobs: "{{DIRECTOR_NO_MOBS}}",
    sv_maxupdaterate: "{{SV_MAXUPDATERATE}}",
    sv_minupdaterate: "{{SV_MINUPDATERATE}}",
    sv_maxcmdrate: "{{SV_MAXCMDRATE}}",
    sv_mincmdrate: "{{SV_MINCMDRATE}}",
    sv_maxrate: "{{SV_MAXRATE}}",
    sv_minrate: "{{SV_MINRATE}}",
  },
};
