import { V, group, STEAM_VARS, RCON_VARS, type GameTemplate } from "./types";
import { steamInstallScript } from "./steamcmd";

// Garry's Mod dedicated server (srcds). Reads garrysmod/cfg/server.cfg.
export const gmod: GameTemplate = {
  slug: "gmod",
  name: "Garry's Mod",
  engine: "Source",
  defaultPort: 27015,
  steamAppId: "4020",
  iconEmoji: "🔧",
  supportsIpv6: true,
  category: "Sandbox",
  description: "Physics sandbox with unlimited game modes",
  estimatedSize: "~8 GB",
  variables: [
    ...STEAM_VARS,
    ...RCON_VARS,

    ...group("Match Setup", [
      V("Game Mode", "GAMEMODE", "Gamemode folder to load (sandbox, darkrp, terrortown, prop_hunt, ...)", "sandbox", { required: false }),
      V("Map", "MAP", "Starting map", "gm_construct", { required: false }),
      V("GSLT Token", "GSLT_TOKEN", "Game Server Login Token — required for public listing", "", { required: false, type: "password" }),
      V("Workshop Collection ID", "WORKSHOP_COLLECTION", "Steam Workshop collection clients download on join", "", { required: false }),
      V("Timelimit", "MP_TIMELIMIT", "Minutes per map before rotation, 0 = unlimited", "0", {
        required: false, type: "number", min_value: 0, max_value: 1440,
      }),
      V("Fall Damage", "MP_FALLDAMAGE", "Enable realistic fall damage", "0", { required: false, type: "boolean" }),
      V("Flashlight", "MP_FLASHLIGHT", "Allow players to use the flashlight", "1", { required: false, type: "boolean" }),
      V("Friendly Fire", "MP_FRIENDLYFIRE", "Teammates can damage each other", "0", { required: false, type: "boolean" }),
    ]),

    ...group("Sandbox Limits", [
      V("Max Props", "SBOX_MAXPROPS", "Props each player may spawn, -1 = unlimited", "150", {
        required: false, type: "number", min_value: -1, max_value: 8192,
      }),
      V("Max Ragdolls", "SBOX_MAXRAGDOLLS", "Ragdolls each player may spawn", "5", {
        required: false, type: "number", min_value: -1, max_value: 1024,
      }),
      V("Max NPCs", "SBOX_MAXNPCS", "NPCs each player may spawn", "10", {
        required: false, type: "number", min_value: -1, max_value: 1024,
      }),
      V("Max Vehicles", "SBOX_MAXVEHICLES", "Vehicles each player may spawn", "6", {
        required: false, type: "number", min_value: -1, max_value: 256,
      }),
      V("Max Effects", "SBOX_MAXEFFECTS", "Effects each player may spawn", "50", {
        required: false, type: "number", min_value: -1, max_value: 1024,
      }),
      V("Max Balloons", "SBOX_MAXBALLOONS", "Balloons each player may spawn", "10", {
        required: false, type: "number", min_value: -1, max_value: 512,
      }),
      V("Max Dynamite", "SBOX_MAXDYNAMITE", "Dynamite each player may spawn", "10", {
        required: false, type: "number", min_value: -1, max_value: 512,
      }),
      V("Max Lamps", "SBOX_MAXLAMPS", "Lamps each player may spawn", "20", {
        required: false, type: "number", min_value: -1, max_value: 512,
      }),
      V("Max Lights", "SBOX_MAXLIGHTS", "Lights each player may spawn", "20", {
        required: false, type: "number", min_value: -1, max_value: 512,
      }),
      V("Max Thrusters", "SBOX_MAXTHRUSTERS", "Thrusters each player may spawn", "30", {
        required: false, type: "number", min_value: -1, max_value: 512,
      }),
      V("Max Wheels", "SBOX_MAXWHEELS", "Wheels each player may spawn", "20", {
        required: false, type: "number", min_value: -1, max_value: 512,
      }),
      V("Max Turrets", "SBOX_MAXTURRETS", "Turrets each player may spawn", "8", {
        required: false, type: "number", min_value: -1, max_value: 512,
      }),
      V("Allow Noclip", "SBOX_NOCLIP", "Allow players to noclip", "1", { required: false, type: "boolean" }),
      V("God Mode", "SBOX_GODMODE", "Players are invulnerable", "0", { required: false, type: "boolean" }),
      V("Player Damage", "SBOX_PLPDAMAGE", "Allow player-vs-player damage", "0", { required: false, type: "boolean" }),
      V("Weapons Enabled", "SBOX_WEAPONS", "Give players the default weapon loadout on spawn", "1", { required: false, type: "boolean" }),
      V("Persist Map", "SBOX_PERSIST", "Save file used to persist props between restarts, empty = off", "", { required: false }),
    ]),

    ...group("Server Rules", [
      V("Server Password", "SV_PASSWORD", "Password required to join, empty = public", "", { required: false, type: "password" }),
      V("Cheats", "SV_CHEATS", "Allow cheat commands", "0", { required: false, type: "boolean" }),
      V("LAN Mode", "SV_LAN", "Run in LAN mode (no Steam authentication)", "0", { required: false, type: "boolean" }),
      V("Alltalk", "SV_ALLTALK", "Both teams hear each other's voice chat", "1", { required: false, type: "boolean" }),
      V("Voice Enable", "SV_VOICEENABLE", "Enable in-game voice chat", "1", { required: false, type: "boolean" }),
      V("Allow CS Lua", "SV_ALLOWCSLUA", "Allow clients to run their own Lua — leave off, it enables cheats", "0", { required: false, type: "boolean" }),
      V("Allow Downloads", "SV_ALLOWDOWNLOAD", "Allow clients to download content from the server", "1", { required: false, type: "boolean" }),
      V("Allow Upload", "SV_ALLOWUPLOAD", "Allow clients to upload sprays", "1", { required: false, type: "boolean" }),
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
      V("Net Max File Size", "NET_MAXFILESIZE", "Largest file (MB) clients may transfer", "64", {
        required: false, type: "number", min_value: 0, max_value: 1024,
      }),
    ]),
  ],

  installScript: steamInstallScript({
    appId: "4020",
    name: "Garry's Mod",
    post: `## srcds reads cfg files from garrysmod/cfg — the panel writes server.cfg there
mkdir -p "$INSTALL_DIR/garrysmod/cfg"`,
  }),

  startCommand: `cd {{INSTALL_PATH}} && ./srcds_run -game garrysmod -console -port {{PORT}} +maxplayers {{MAX_PLAYERS}} +map {{MAP}} +gamemode {{GAMEMODE}} +host_workshop_collection {{WORKSHOP_COLLECTION}} +sv_setsteamaccount {{GSLT_TOKEN}}`,
  stopCommand: "quit",
  configFiles: { "garrysmod/cfg/server.cfg": "server.cfg" },
  defaultConfig: {
    __gsm_format: "source",
    hostname: "{{SERVER_NAME}}",
    rcon_password: "{{RCON_PASSWORD}}",
    sv_password: "{{SV_PASSWORD}}",
    sv_defaultgamemode: "{{GAMEMODE}}",
    sv_cheats: "{{SV_CHEATS}}",
    sv_lan: "{{SV_LAN}}",
    sv_alltalk: "{{SV_ALLTALK}}",
    sv_voiceenable: "{{SV_VOICEENABLE}}",
    sv_allowcslua: "{{SV_ALLOWCSLUA}}",
    sv_allowdownload: "{{SV_ALLOWDOWNLOAD}}",
    sv_allowupload: "{{SV_ALLOWUPLOAD}}",
    sv_downloadurl: "{{SV_DOWNLOADURL}}",
    sv_pausable: "{{SV_PAUSABLE}}",
    sv_timeout: "{{SV_TIMEOUT}}",
    sv_region: "{{SV_REGION}}",
    log: "{{LOG}}",
    mp_timelimit: "{{MP_TIMELIMIT}}",
    mp_falldamage: "{{MP_FALLDAMAGE}}",
    mp_flashlight: "{{MP_FLASHLIGHT}}",
    mp_friendlyfire: "{{MP_FRIENDLYFIRE}}",
    sbox_maxprops: "{{SBOX_MAXPROPS}}",
    sbox_maxragdolls: "{{SBOX_MAXRAGDOLLS}}",
    sbox_maxnpcs: "{{SBOX_MAXNPCS}}",
    sbox_maxvehicles: "{{SBOX_MAXVEHICLES}}",
    sbox_maxeffects: "{{SBOX_MAXEFFECTS}}",
    sbox_maxballoons: "{{SBOX_MAXBALLOONS}}",
    sbox_maxdynamite: "{{SBOX_MAXDYNAMITE}}",
    sbox_maxlamps: "{{SBOX_MAXLAMPS}}",
    sbox_maxlights: "{{SBOX_MAXLIGHTS}}",
    sbox_maxthrusters: "{{SBOX_MAXTHRUSTERS}}",
    sbox_maxwheels: "{{SBOX_MAXWHEELS}}",
    sbox_maxturrets: "{{SBOX_MAXTURRETS}}",
    sbox_noclip: "{{SBOX_NOCLIP}}",
    sbox_godmode: "{{SBOX_GODMODE}}",
    sbox_plpdamage: "{{SBOX_PLPDAMAGE}}",
    sbox_weapons: "{{SBOX_WEAPONS}}",
    sbox_persist: "{{SBOX_PERSIST}}",
    sv_maxupdaterate: "{{SV_MAXUPDATERATE}}",
    sv_minupdaterate: "{{SV_MINUPDATERATE}}",
    sv_maxcmdrate: "{{SV_MAXCMDRATE}}",
    sv_mincmdrate: "{{SV_MINCMDRATE}}",
    sv_maxrate: "{{SV_MAXRATE}}",
    sv_minrate: "{{SV_MINRATE}}",
    net_maxfilesize: "{{NET_MAXFILESIZE}}",
  },
};
