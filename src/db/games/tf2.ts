import { V, group, STEAM_VARS, RCON_VARS, type GameTemplate } from "./types";
import { steamInstallScript } from "./steamcmd";

// Team Fortress 2 dedicated server (srcds). server.cfg is executed on map load.
export const tf2: GameTemplate = {
  slug: "tf2",
  name: "Team Fortress 2",
  engine: "Source",
  defaultPort: 27015,
  steamAppId: "232250",
  iconEmoji: "🎩",
  supportsIpv6: true,
  category: "FPS",
  description: "Valve's iconic class-based shooter",
  estimatedSize: "~15 GB",
  variables: [
    ...STEAM_VARS,
    ...RCON_VARS,

    ...group("Match Setup", [
      V("Map", "MAP", "Starting map", "cp_badlands", { required: false }),
      V("GSLT Token", "GSLT_TOKEN", "Game Server Login Token — required for public listing", "", { required: false, type: "password" }),
      V("Timelimit", "MP_TIMELIMIT", "Minutes per map before rotation, 0 = unlimited", "30", {
        required: false, type: "number", min_value: 0, max_value: 1440,
      }),
      V("Winlimit", "MP_WINLIMIT", "Round wins needed to end the map, 0 = disabled", "0", {
        required: false, type: "number", min_value: 0, max_value: 100,
      }),
      V("Maxrounds", "MP_MAXROUNDS", "Rounds played before rotation, 0 = disabled", "0", {
        required: false, type: "number", min_value: 0, max_value: 100,
      }),
      V("Round Time", "MP_ROUNDTIME", "Round length in seconds, 0 = map default", "0", {
        required: false, type: "number", min_value: 0, max_value: 3600,
      }),
      V("Enable Stalemate", "MP_STALEMATE_ENABLE", "Enable sudden-death stalemate rounds", "0", { required: false, type: "boolean" }),
      V("Stalemate Timelimit", "MP_STALEMATE_TIMELIMIT", "Seconds a stalemate lasts", "240", {
        required: false, type: "number", min_value: 60, max_value: 3600,
      }),
      V("Bonus Round Time", "MP_BONUSROUNDTIME", "Seconds of humiliation time between rounds", "15", {
        required: false, type: "number", min_value: 5, max_value: 300,
      }),
      V("Respawn Wave Time", "MP_RESPAWNWAVETIME", "Base seconds between respawn waves", "10.0", { required: false, type: "float", min_value: 0, max_value: 60 }),
      V("Disable Respawn Times", "MP_DISABLE_RESPAWN_TIMES", "Respawn players instantly", "0", { required: false, type: "boolean" }),
    ]),

    ...group("Gameplay", [
      V("Friendly Fire", "MP_FRIENDLYFIRE", "Teammates can damage each other", "0", { required: false, type: "boolean" }),
      V("Autoteambalance", "MP_AUTOTEAMBALANCE", "Automatically even out team sizes", "1", { required: false, type: "boolean" }),
      V("Team Imbalance Delay", "MP_TEAMS_UNBALANCE_LIMIT", "Player difference tolerated before balancing, 0 = off", "1", {
        required: false, type: "number", min_value: 0, max_value: 30,
      }),
      V("Force Camera", "MP_FORCECAMERA", "Restrict spectators to their own team", "0", { required: false, type: "boolean" }),
      V("Allow Spectators", "MP_ALLOWSPECTATORS", "Allow players to join spectator", "1", { required: false, type: "boolean" }),
      V("Idle Max Time", "MP_IDLEMAXTIME", "Minutes before an idle player is moved to spectator", "3", {
        required: false, type: "number", min_value: 0, max_value: 120,
      }),
      V("Kick Idle Players", "MP_IDLEDEALMETHOD", "1 = move to spectator, 2 = kick", "1", {
        required: false, type: "select", enum_values: { "0": "0 — Do nothing", "1": "1 — Move to spectator", "2": "2 — Kick" },
      }),
      V("Tournament Mode", "MP_TOURNAMENT", "Enable competitive tournament mode", "0", { required: false, type: "boolean" }),
      V("Random Crits", "TF_WEAPON_CRITICALS", "Enable random critical hits", "1", { required: false, type: "boolean" }),
      V("Damage Spread", "TF_DAMAGE_DISABLESPREAD", "Disable random damage spread", "0", { required: false, type: "boolean" }),
      V("Use Match HUD", "TF_USE_MATCH_HUD", "Show the competitive match HUD", "0", { required: false, type: "boolean" }),
      V("Class Limits", "TF_TOURNAMENT_CLASSLIMIT_DEFAULT", "Per-class limit in tournament mode, -1 = unlimited", "-1", {
        required: false, type: "number", min_value: -1, max_value: 32,
      }),
    ]),

    ...group("Server Rules", [
      V("Server Password", "SV_PASSWORD", "Password required to join, empty = public", "", { required: false, type: "password" }),
      V("Cheats", "SV_CHEATS", "Allow cheat commands", "0", { required: false, type: "boolean" }),
      V("LAN Mode", "SV_LAN", "Run in LAN mode (no Steam authentication)", "0", { required: false, type: "boolean" }),
      V("Pure Server", "SV_PURE", "Enforce client file consistency (-1 off, 0 relaxed, 1 strict, 2 full)", "1", {
        required: false, type: "select",
        enum_values: { "-1": "-1 — Off", "0": "0 — Relaxed", "1": "1 — Strict (whitelist)", "2": "2 — Full" },
      }),
      V("Pausable", "SV_PAUSABLE", "Allow clients to pause the server", "0", { required: false, type: "boolean" }),
      V("Alltalk", "SV_ALLTALK", "Both teams hear each other's voice chat", "0", { required: false, type: "boolean" }),
      V("Voice Enable", "SV_VOICEENABLE", "Enable in-game voice chat", "1", { required: false, type: "boolean" }),
      V("Allow Downloads", "SV_ALLOWDOWNLOAD", "Allow clients to download custom content from the server", "1", { required: false, type: "boolean" }),
      V("Allow Upload", "SV_ALLOWUPLOAD", "Allow clients to upload custom content (sprays)", "1", { required: false, type: "boolean" }),
      V("Fast Download URL", "SV_DOWNLOADURL", "HTTP fast-download base URL for maps and assets", "", { required: false }),
      V("Pure Kick Clients", "SV_PURE_KICK_CLIENTS", "Kick clients failing the pure check instead of warning", "1", { required: false, type: "boolean" }),
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
      V("Max Update Rate", "SV_MAXUPDATERATE", "Maximum client update rate (ticks/sec)", "66", {
        required: false, type: "number", min_value: 10, max_value: 128,
      }),
      V("Min Update Rate", "SV_MINUPDATERATE", "Minimum client update rate", "20", {
        required: false, type: "number", min_value: 10, max_value: 128,
      }),
      V("Max Cmd Rate", "SV_MAXCMDRATE", "Maximum client command rate", "66", {
        required: false, type: "number", min_value: 10, max_value: 128,
      }),
      V("Min Cmd Rate", "SV_MINCMDRATE", "Minimum client command rate", "20", {
        required: false, type: "number", min_value: 10, max_value: 128,
      }),
      V("Max Rate", "SV_MAXRATE", "Per-client bandwidth cap in bytes/sec, 0 = unlimited", "0", {
        required: false, type: "number", min_value: 0, max_value: 10000000,
      }),
      V("Min Rate", "SV_MINRATE", "Per-client bandwidth floor in bytes/sec", "80000", {
        required: false, type: "number", min_value: 0, max_value: 10000000,
      }),
      V("Client Min Interp Ratio", "SV_CLIENT_MIN_INTERP_RATIO", "Minimum interpolation ratio clients may use", "1", { required: false, type: "float", min_value: -1, max_value: 5 }),
      V("Client Max Interp Ratio", "SV_CLIENT_MAX_INTERP_RATIO", "Maximum interpolation ratio clients may use", "2", { required: false, type: "float", min_value: -1, max_value: 5 }),
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
    appId: "232250",
    name: "Team Fortress 2",
    post: `## srcds reads cfg files from tf/cfg — the panel writes server.cfg there
mkdir -p "$INSTALL_DIR/tf/cfg"`,
  }),

  startCommand: `cd {{INSTALL_PATH}} && ./srcds_run -game tf -console -port {{PORT}} +maxplayers {{MAX_PLAYERS}} +map {{MAP}} +sv_setsteamaccount {{GSLT_TOKEN}}`,
  stopCommand: "quit",
  configFiles: { "tf/cfg/server.cfg": "server.cfg" },
  defaultConfig: {
    __gsm_format: "source",
    hostname: "{{SERVER_NAME}}",
    rcon_password: "{{RCON_PASSWORD}}",
    sv_password: "{{SV_PASSWORD}}",
    sv_cheats: "{{SV_CHEATS}}",
    sv_lan: "{{SV_LAN}}",
    sv_pure: "{{SV_PURE}}",
    sv_pure_kick_clients: "{{SV_PURE_KICK_CLIENTS}}",
    sv_pausable: "{{SV_PAUSABLE}}",
    sv_alltalk: "{{SV_ALLTALK}}",
    sv_voiceenable: "{{SV_VOICEENABLE}}",
    sv_allowdownload: "{{SV_ALLOWDOWNLOAD}}",
    sv_allowupload: "{{SV_ALLOWUPLOAD}}",
    sv_downloadurl: "{{SV_DOWNLOADURL}}",
    sv_timeout: "{{SV_TIMEOUT}}",
    sv_region: "{{SV_REGION}}",
    log: "{{LOG}}",
    mp_timelimit: "{{MP_TIMELIMIT}}",
    mp_winlimit: "{{MP_WINLIMIT}}",
    mp_maxrounds: "{{MP_MAXROUNDS}}",
    mp_roundtime: "{{MP_ROUNDTIME}}",
    mp_stalemate_enable: "{{MP_STALEMATE_ENABLE}}",
    mp_stalemate_timelimit: "{{MP_STALEMATE_TIMELIMIT}}",
    mp_bonusroundtime: "{{MP_BONUSROUNDTIME}}",
    mp_respawnwavetime: "{{MP_RESPAWNWAVETIME}}",
    mp_disable_respawn_times: "{{MP_DISABLE_RESPAWN_TIMES}}",
    mp_friendlyfire: "{{MP_FRIENDLYFIRE}}",
    mp_autoteambalance: "{{MP_AUTOTEAMBALANCE}}",
    mp_teams_unbalance_limit: "{{MP_TEAMS_UNBALANCE_LIMIT}}",
    mp_forcecamera: "{{MP_FORCECAMERA}}",
    mp_allowspectators: "{{MP_ALLOWSPECTATORS}}",
    mp_idlemaxtime: "{{MP_IDLEMAXTIME}}",
    mp_idledealmethod: "{{MP_IDLEDEALMETHOD}}",
    mp_tournament: "{{MP_TOURNAMENT}}",
    tf_weapon_criticals: "{{TF_WEAPON_CRITICALS}}",
    tf_damage_disablespread: "{{TF_DAMAGE_DISABLESPREAD}}",
    tf_use_match_hud: "{{TF_USE_MATCH_HUD}}",
    tf_tournament_classlimit_default: "{{TF_TOURNAMENT_CLASSLIMIT_DEFAULT}}",
    sv_maxupdaterate: "{{SV_MAXUPDATERATE}}",
    sv_minupdaterate: "{{SV_MINUPDATERATE}}",
    sv_maxcmdrate: "{{SV_MAXCMDRATE}}",
    sv_mincmdrate: "{{SV_MINCMDRATE}}",
    sv_maxrate: "{{SV_MAXRATE}}",
    sv_minrate: "{{SV_MINRATE}}",
    sv_client_min_interp_ratio: "{{SV_CLIENT_MIN_INTERP_RATIO}}",
    sv_client_max_interp_ratio: "{{SV_CLIENT_MAX_INTERP_RATIO}}",
    tv_enable: "{{TV_ENABLE}}",
    tv_port: "{{TV_PORT}}",
    tv_name: "{{TV_NAME}}",
    tv_password: "{{TV_PASSWORD}}",
    tv_delay: "{{TV_DELAY}}",
    tv_maxclients: "{{TV_MAXCLIENTS}}",
    tv_autorecord: "{{TV_AUTORECORD}}",
  },
};
