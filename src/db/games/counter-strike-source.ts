import { V, group, STEAM_VARS, RCON_VARS, STEAMCMD_VAR, type GameTemplate } from "./types";
import { steamInstallScript } from "./steamcmd";
import { sourceModVariables, sourceModInstallBlock } from "./source-mods";

// Counter-Strike: Source dedicated server (srcds). server.cfg is executed on
// map load; cstrike/cfg/ is where the panel writes it.
export const counterStrikeSource: GameTemplate = {
  slug: "counter-strike-source",
  name: "Counter-Strike: Source",
  engine: "Source",
  defaultPort: 27015,
  steamAppId: "740",
  iconEmoji: "🎯",
  supportsIpv6: true,
  category: "FPS",
  description: "The classic tactical shooter on the Source engine",
  estimatedSize: "~8 GB",
  variables: [
    ...STEAM_VARS,
    STEAMCMD_VAR,
    ...sourceModVariables(),
    ...RCON_VARS,

    ...group("Match Setup", [
      V("Map", "MAP", "Starting map", "de_dust2", { required: false }),
      V("GSLT Token", "GSLT_TOKEN", "Game Server Login Token — required for public listing", "", { required: false, type: "password" }),
      V("Timelimit", "MP_TIMELIMIT", "Minutes per map before rotation, 0 = no limit", "30", {
        required: false, type: "number", min_value: 0, max_value: 1440,
      }),
      V("Freeze Time", "MP_FREEZETIME", "Seconds players are frozen at round start", "6", {
        required: false, type: "number", min_value: 0, max_value: 60,
      }),
      V("Autoteambalance", "MP_AUTOTEAMBALANCE", "Automatically even out team sizes", "1", { required: false, type: "boolean" }),
      V("Friendly Fire", "MP_FRIENDLYFIRE", "Teammates can damage each other", "0", { required: false, type: "boolean" }),
    ]),

    ...group("Server Rules", [
      V("Server Password", "SV_PASSWORD", "Password required to join, empty = public", "", { required: false, type: "password" }),
      V("Cheats", "SV_CHEATS", "Allow cheat commands", "0", { required: false, type: "boolean" }),
      V("LAN Mode", "SV_LAN", "Run in LAN mode (no Steam authentication)", "0", { required: false, type: "boolean" }),
      V("Pure Server", "SV_PURE", "Enforce client file consistency (-1 off, 0 relaxed, 1 strict)", "1", {
        required: false, type: "select",
        enum_values: { "-1": "-1 — Off", "0": "0 — Relaxed", "1": "1 — Strict" },
      }),
      V("Pausable", "SV_PAUSABLE", "Allow clients to pause the server", "0", { required: false, type: "boolean" }),
      V("Alltalk", "SV_ALLTALK", "Both teams hear each other's voice chat", "0", { required: false, type: "boolean" }),
      V("Voice Enable", "SV_VOICEENABLE", "Enable in-game voice chat", "1", { required: false, type: "boolean" }),
    ]),

    ...group("Network & Rates", [
      V("Max Rate", "SV_MAXRATE", "Per-client bandwidth cap in bytes/sec, 0 = unlimited", "0", {
        required: false, type: "number", min_value: 0, max_value: 10000000,
      }),
      V("Min Rate", "SV_MINRATE", "Per-client bandwidth floor in bytes/sec", "80000", {
        required: false, type: "number", min_value: 0, max_value: 10000000,
      }),
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
    ]),
  ],

  installScript: steamInstallScript({
    appId: "740",
    name: "Counter-Strike: Source",
    i386: true,
    post: `## srcds reads cfg files from cstrike/cfg — the panel writes server.cfg there
mkdir -p "$INSTALL_DIR/cstrike/cfg"\n` +
      sourceModInstallBlock("cstrike"),
  }),

  startCommand: `cd {{INSTALL_PATH}} && ./srcds_run -game cstrike -console -port {{PORT}} +maxplayers {{MAX_PLAYERS}} +map {{MAP}} +sv_setsteamaccount {{GSLT_TOKEN}}`,
  stopCommand: "quit",
  configFiles: { "cstrike/cfg/server.cfg": "server.cfg" },
  defaultConfig: {
    __gsm_format: "source",
    hostname: "{{SERVER_NAME}}",
    rcon_password: "{{RCON_PASSWORD}}",
    sv_password: "{{SV_PASSWORD}}",
    sv_cheats: "{{SV_CHEATS}}",
    sv_lan: "{{SV_LAN}}",
    sv_pure: "{{SV_PURE}}",
    sv_pausable: "{{SV_PAUSABLE}}",
    sv_alltalk: "{{SV_ALLTALK}}",
    sv_voiceenable: "{{SV_VOICEENABLE}}",
    sv_maxrate: "{{SV_MAXRATE}}",
    sv_minrate: "{{SV_MINRATE}}",
    sv_maxupdaterate: "{{SV_MAXUPDATERATE}}",
    sv_minupdaterate: "{{SV_MINUPDATERATE}}",
    sv_maxcmdrate: "{{SV_MAXCMDRATE}}",
    sv_mincmdrate: "{{SV_MINCMDRATE}}",
    mp_timelimit: "{{MP_TIMELIMIT}}",
    mp_freezetime: "{{MP_FREEZETIME}}",
    mp_autoteambalance: "{{MP_AUTOTEAMBALANCE}}",
    mp_friendlyfire: "{{MP_FRIENDLYFIRE}}",
  },
};
