import { V, group, STEAM_VARS, RCON_VARS, type GameTemplate } from "./types";
import { steamInstallScript } from "./steamcmd";

// CS2 dedicated server. Config lives in game/csgo/cfg/server.cfg and is executed
// by the engine at startup, so every entry is a plain `cvar "value"` line.
export const cs2: GameTemplate = {
  slug: "cs2",
  name: "Counter-Strike 2",
  engine: "Source 2",
  defaultPort: 27015,
  steamAppId: "730",
  iconEmoji: "🔫",
  supportsIpv6: true,
  category: "FPS",
  description: "Valve's premier competitive shooter",
  estimatedSize: "~35 GB",
  variables: [
    ...STEAM_VARS,
    ...RCON_VARS,

    ...group("Match Setup", [
      V("GSLT Token", "GSLT_TOKEN", "Game Server Login Token from steamcommunity.com/dev/managegameservers — required for public listing", "", {
        required: false, type: "password",
      }),
      V("Game Type", "GAME_TYPE", "Broad game category (paired with Game Mode)", "0", {
        required: false, type: "select",
        enum_values: { "0": "0 — Classic", "1": "1 — Gun Game", "2": "2 — Training", "3": "3 — Custom", "4": "4 — Guardian / Co-op", "6": "6 — Skirmish" },
      }),
      V("Game Mode", "GAME_MODE", "Specific mode within the game type", "1", {
        required: false, type: "select",
        enum_values: { "0": "0 — Casual (with type 0)", "1": "1 — Competitive (with type 0)", "2": "2 — Wingman (with type 0)" },
      }),
      V("Map", "MAP", "Starting map", "de_dust2", { required: false }),
      V("Map Group", "MAP_GROUP", "Map cycle group loaded from gamemodes_server.txt", "mg_active", { required: false }),
      V("Max Rounds", "MP_MAXROUNDS", "Rounds played before the match ends (mp_maxrounds)", "24", {
        required: false, type: "number", min_value: 0, max_value: 200,
      }),
      V("Round Time", "MP_ROUNDTIME", "Round length in minutes (mp_roundtime)", "1.92", { required: false, type: "float", min_value: 0.1, max_value: 60 }),
      V("Round Time (Defuse)", "MP_ROUNDTIME_DEFUSE", "Round length on bomb maps in minutes", "1.92", { required: false, type: "float", min_value: 0.1, max_value: 60 }),
      V("Freeze Time", "MP_FREEZETIME", "Buy/freeze period in seconds (mp_freezetime)", "15", {
        required: false, type: "number", min_value: 0, max_value: 120,
      }),
      V("Buy Time", "MP_BUYTIME", "Seconds players may buy after the round starts", "20", {
        required: false, type: "number", min_value: 0, max_value: 300,
      }),
      V("Warmup Time", "MP_WARMUPTIME", "Warmup length in seconds", "60", {
        required: false, type: "number", min_value: 0, max_value: 3600,
      }),
      V("Halftime", "MP_HALFTIME", "Swap teams at halftime", "1", { required: false, type: "boolean" }),
      V("Overtime Max Rounds", "MP_OVERTIME_MAXROUNDS", "Rounds per overtime half, 0 = no overtime", "6", {
        required: false, type: "number", min_value: 0, max_value: 100,
      }),
      V("Overtime Start Money", "MP_OVERTIME_STARTMONEY", "Money each player starts overtime with", "10000", {
        required: false, type: "number", min_value: 0, max_value: 65535,
      }),
    ]),

    ...group("Economy & Rules", [
      V("Starting Money", "MP_STARTMONEY", "Money each player starts a half with", "800", {
        required: false, type: "number", min_value: 0, max_value: 65535,
      }),
      V("Max Money", "MP_MAXMONEY", "Money cap per player", "16000", {
        required: false, type: "number", min_value: 0, max_value: 65535,
      }),
      V("Friendly Fire", "MP_FRIENDLYFIRE", "Teammates can damage each other", "1", { required: false, type: "boolean" }),
      V("Friendly Fire Damage Ratio", "FF_DAMAGE_REDUCTION_BULLETS", "Fraction of bullet damage applied to teammates", "0.33", { required: false, type: "float", min_value: 0, max_value: 1 }),
      V("Autoteambalance", "MP_AUTOTEAMBALANCE", "Automatically even out team sizes", "1", { required: false, type: "boolean" }),
      V("Limit Teams", "MP_LIMITTEAMS", "Maximum team size difference, 0 = no limit", "2", {
        required: false, type: "number", min_value: 0, max_value: 30,
      }),
      V("Solid Teammates", "MP_SOLID_TEAMMATES", "Teammates block movement", "1", { required: false, type: "boolean" }),
      V("Free Armor", "MP_FREE_ARMOR", "Give armour for free (0 = off, 1 = kevlar, 2 = kevlar+helmet)", "0", {
        required: false, type: "select",
        enum_values: { "0": "0 — Off", "1": "1 — Kevlar", "2": "2 — Kevlar + Helmet" },
      }),
      V("Death Drop GunS", "MP_DEATH_DROP_GUN", "Drop weapon on death (0 = none, 1 = best, 2 = current)", "1", {
        required: false, type: "select",
        enum_values: { "0": "0 — None", "1": "1 — Best weapon", "2": "2 — Current weapon" },
      }),
      V("Death Drop Grenade", "MP_DEATH_DROP_GRENADE", "Drop a grenade on death", "2", {
        required: false, type: "select",
        enum_values: { "0": "0 — None", "1": "1 — Best", "2": "2 — Current" },
      }),
      V("Respawn Immunity", "MP_RESPAWN_IMMUNITYTIME", "Spawn protection in seconds, -1 = disabled", "-1", { required: false, type: "float", min_value: -1, max_value: 60 }),
      V("Teammates Are Enemies", "MP_TEAMMATES_ARE_ENEMIES", "Deathmatch-style free-for-all", "0", { required: false, type: "boolean" }),
    ]),

    ...group("Server Rules", [
      V("Server Password", "SV_PASSWORD", "Password required to join, empty = public", "", { required: false, type: "password" }),
      V("Cheats", "SV_CHEATS", "Allow cheat commands — never enable on public servers", "0", { required: false, type: "boolean" }),
      V("LAN Mode", "SV_LAN", "Run in LAN mode (no Steam authentication)", "0", { required: false, type: "boolean" }),
      V("Pausable", "SV_PAUSABLE", "Allow clients to pause the server", "0", { required: false, type: "boolean" }),
      V("Allow Votes", "SV_ALLOW_VOTES", "Enable the in-game vote system", "1", { required: false, type: "boolean" }),
      V("Voice Enable", "SV_VOICEENABLE", "Enable in-game voice chat", "1", { required: false, type: "boolean" }),
      V("Alltalk", "SV_ALLTALK", "Both teams hear each other's voice chat", "0", { required: false, type: "boolean" }),
      V("Deadtalk", "SV_DEADTALK", "Dead players can talk to living ones", "0", { required: false, type: "boolean" }),
      V("Full Alltalk", "SV_FULL_ALLTALK", "Alltalk across teams and life state", "0", { required: false, type: "boolean" }),
      V("Hibernate When Empty", "SV_HIBERNATE_WHEN_EMPTY", "Reduce CPU use when no players are connected", "1", { required: false, type: "boolean" }),
      V("Timeout", "SV_TIMEOUT", "Seconds before an unresponsive client is dropped", "65", {
        required: false, type: "number", min_value: 5, max_value: 600,
      }),
      V("Log Enable", "LOG", "Write server logs to disk", "on", {
        required: false, type: "select", enum_values: { on: "On", off: "Off" },
      }),
    ]),

    ...group("Network & Rates", [
      V("Max Update Rate", "SV_MAXUPDATERATE", "Maximum client update rate (ticks/sec)", "128", {
        required: false, type: "number", min_value: 10, max_value: 128,
      }),
      V("Min Update Rate", "SV_MINUPDATERATE", "Minimum client update rate", "64", {
        required: false, type: "number", min_value: 10, max_value: 128,
      }),
      V("Max Cmd Rate", "SV_MAXCMDRATE", "Maximum client command rate", "128", {
        required: false, type: "number", min_value: 10, max_value: 128,
      }),
      V("Min Cmd Rate", "SV_MINCMDRATE", "Minimum client command rate", "64", {
        required: false, type: "number", min_value: 10, max_value: 128,
      }),
      V("Max Rate", "SV_MAXRATE", "Per-client bandwidth cap in bytes/sec, 0 = unlimited", "786432", {
        required: false, type: "number", min_value: 0, max_value: 10000000,
      }),
      V("Min Rate", "SV_MINRATE", "Per-client bandwidth floor in bytes/sec", "196608", {
        required: false, type: "number", min_value: 0, max_value: 10000000,
      }),
      V("Client Min Interp Ratio", "SV_CLIENT_MIN_INTERP_RATIO", "Minimum interpolation ratio clients may use", "1", { required: false, type: "float", min_value: -1, max_value: 5 }),
      V("Client Max Interp Ratio", "SV_CLIENT_MAX_INTERP_RATIO", "Maximum interpolation ratio clients may use", "2", { required: false, type: "float", min_value: -1, max_value: 5 }),
      V("Region", "SV_REGION", "Master-server region (255 = world)", "255", {
        required: false, type: "select",
        enum_values: {
          "0": "0 — US East", "1": "1 — US West", "2": "2 — South America", "3": "3 — Europe",
          "4": "4 — Asia", "5": "5 — Australia", "6": "6 — Middle East", "7": "7 — Africa", "255": "255 — World",
        },
      }),
    ]),

    ...group("Bots", [
      V("Bot Quota", "BOT_QUOTA", "Number of bots to maintain, 0 = none", "0", {
        required: false, type: "number", min_value: 0, max_value: 64,
      }),
      V("Bot Quota Mode", "BOT_QUOTA_MODE", "How the quota is interpreted", "normal", {
        required: false, type: "select",
        enum_values: { normal: "Normal — total bots", fill: "Fill — top up to quota", match: "Match — bots per human" },
      }),
      V("Bot Difficulty", "BOT_DIFFICULTY", "0 = easy through 3 = expert", "1", {
        required: false, type: "select",
        enum_values: { "0": "0 — Easy", "1": "1 — Normal", "2": "2 — Hard", "3": "3 — Expert" },
      }),
      V("Bot Chatter", "BOT_CHATTER", "Bot radio chatter volume", "normal", {
        required: false, type: "select",
        enum_values: { off: "Off", radio: "Radio only", minimal: "Minimal", normal: "Normal" },
      }),
      V("Bot Auto Vacate", "BOT_AUTOVACATE", "Kick a bot when a human wants to join", "1", { required: false, type: "boolean" }),
    ]),

    ...group("SourceTV", [
      V("Enable SourceTV", "TV_ENABLE", "Enable the SourceTV relay", "0", { required: false, type: "boolean" }),
      V("SourceTV Port", "TV_PORT", "Port SourceTV binds to", "27020", {
        required: false, type: "number", min_value: 1, max_value: 65535,
      }),
      V("SourceTV Name", "TV_NAME", "Name shown for the SourceTV bot", "GSM-TV", { required: false }),
      V("SourceTV Password", "TV_PASSWORD", "Password required to watch", "", { required: false, type: "password" }),
      V("SourceTV Delay", "TV_DELAY", "Broadcast delay in seconds", "30", {
        required: false, type: "number", min_value: 0, max_value: 300,
      }),
      V("SourceTV Max Clients", "TV_MAXCLIENTS", "Maximum spectators", "10", {
        required: false, type: "number", min_value: 0, max_value: 255,
      }),
      V("SourceTV Auto Record", "TV_AUTORECORD", "Automatically record every match to a demo", "0", { required: false, type: "boolean" }),
    ]),
  ],

  installScript: steamInstallScript({
    appId: "730",
    name: "Counter-Strike 2",
    post: `## CS2 loads cfg files from game/csgo/cfg — the panel writes server.cfg there
mkdir -p "$INSTALL_DIR/game/csgo/cfg"`,
  }),

  startCommand: `cd {{INSTALL_PATH}} && ./game/bin/linuxsteamrt64/cs2 -dedicated -ip 0.0.0.0 -port {{PORT}} -tv_port {{TV_PORT}} +game_type {{GAME_TYPE}} +game_mode {{GAME_MODE}} +mapgroup {{MAP_GROUP}} +map {{MAP}} +sv_setsteamaccount {{GSLT_TOKEN}} +exec server.cfg`,
  stopCommand: "quit",
  configFiles: { "game/csgo/cfg/server.cfg": "server.cfg" },
  defaultConfig: {
    __gsm_format: "source",
    hostname: "{{SERVER_NAME}}",
    rcon_password: "{{RCON_PASSWORD}}",
    sv_password: "{{SV_PASSWORD}}",
    sv_cheats: "{{SV_CHEATS}}",
    sv_lan: "{{SV_LAN}}",
    sv_pausable: "{{SV_PAUSABLE}}",
    sv_allow_votes: "{{SV_ALLOW_VOTES}}",
    sv_voiceenable: "{{SV_VOICEENABLE}}",
    sv_alltalk: "{{SV_ALLTALK}}",
    sv_deadtalk: "{{SV_DEADTALK}}",
    sv_full_alltalk: "{{SV_FULL_ALLTALK}}",
    sv_hibernate_when_empty: "{{SV_HIBERNATE_WHEN_EMPTY}}",
    sv_timeout: "{{SV_TIMEOUT}}",
    sv_region: "{{SV_REGION}}",
    log: "{{LOG}}",
    mp_maxrounds: "{{MP_MAXROUNDS}}",
    mp_roundtime: "{{MP_ROUNDTIME}}",
    mp_roundtime_defuse: "{{MP_ROUNDTIME_DEFUSE}}",
    mp_freezetime: "{{MP_FREEZETIME}}",
    mp_buytime: "{{MP_BUYTIME}}",
    mp_warmuptime: "{{MP_WARMUPTIME}}",
    mp_halftime: "{{MP_HALFTIME}}",
    mp_overtime_maxrounds: "{{MP_OVERTIME_MAXROUNDS}}",
    mp_overtime_startmoney: "{{MP_OVERTIME_STARTMONEY}}",
    mp_startmoney: "{{MP_STARTMONEY}}",
    mp_maxmoney: "{{MP_MAXMONEY}}",
    mp_friendlyfire: "{{MP_FRIENDLYFIRE}}",
    ff_damage_reduction_bullets: "{{FF_DAMAGE_REDUCTION_BULLETS}}",
    mp_autoteambalance: "{{MP_AUTOTEAMBALANCE}}",
    mp_limitteams: "{{MP_LIMITTEAMS}}",
    mp_solid_teammates: "{{MP_SOLID_TEAMMATES}}",
    mp_free_armor: "{{MP_FREE_ARMOR}}",
    mp_death_drop_gun: "{{MP_DEATH_DROP_GUN}}",
    mp_death_drop_grenade: "{{MP_DEATH_DROP_GRENADE}}",
    mp_respawn_immunitytime: "{{MP_RESPAWN_IMMUNITYTIME}}",
    mp_teammates_are_enemies: "{{MP_TEAMMATES_ARE_ENEMIES}}",
    sv_maxupdaterate: "{{SV_MAXUPDATERATE}}",
    sv_minupdaterate: "{{SV_MINUPDATERATE}}",
    sv_maxcmdrate: "{{SV_MAXCMDRATE}}",
    sv_mincmdrate: "{{SV_MINCMDRATE}}",
    sv_maxrate: "{{SV_MAXRATE}}",
    sv_minrate: "{{SV_MINRATE}}",
    sv_client_min_interp_ratio: "{{SV_CLIENT_MIN_INTERP_RATIO}}",
    sv_client_max_interp_ratio: "{{SV_CLIENT_MAX_INTERP_RATIO}}",
    bot_quota: "{{BOT_QUOTA}}",
    bot_quota_mode: "{{BOT_QUOTA_MODE}}",
    bot_difficulty: "{{BOT_DIFFICULTY}}",
    bot_chatter: "{{BOT_CHATTER}}",
    bot_autovacate: "{{BOT_AUTOVACATE}}",
    tv_enable: "{{TV_ENABLE}}",
    tv_port: "{{TV_PORT}}",
    tv_name: "{{TV_NAME}}",
    tv_password: "{{TV_PASSWORD}}",
    tv_delay: "{{TV_DELAY}}",
    tv_maxclients: "{{TV_MAXCLIENTS}}",
    tv_autorecord: "{{TV_AUTORECORD}}",
  },
};
