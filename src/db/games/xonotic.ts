import { V, group, COMMON_VARS, RCON_VARS, type GameTemplate } from "./types";

// Xonotic runs on DarkPlaces (a Quake engine derivative) and reads
// data/server.cfg using `seta cvar "value"` lines.
export const xonotic: GameTemplate = {
  slug: "xonotic",
  name: "Xonotic",
  engine: "DarkPlaces",
  defaultPort: 26000,
  steamAppId: null,
  iconEmoji: "\u{1F3AF}",
  supportsIpv6: true,
  category: "Classic",
  description: "Free open-source arena shooter",
  estimatedSize: "~1 GB",
  variables: [
    ...COMMON_VARS,
    ...RCON_VARS,

    ...group("Match Setup", [
      V("Game Type", "GAMETYPE", "Default game mode", "dm", {
        required: false, type: "select",
        enum_values: {
          dm: "Deathmatch", tdm: "Team Deathmatch", ctf: "Capture the Flag",
          ca: "Clan Arena", lms: "Last Man Standing", ft: "Freeze Tag",
          ka: "Keepaway", dom: "Domination", kh: "Key Hunt", as: "Assault",
          rc: "Race", cts: "Race CTS", inv: "Invasion", ons: "Onslaught",
        },
      }),
      V("Start Map", "START_MAP", "Map loaded on start", "solarium", { required: false }),
      V("Map List", "MAP_LIST", "Space-separated map rotation, empty = engine default", "", { required: false }),
      V("Frag Limit", "FRAGLIMIT", "Frags before the match ends, 0 = unlimited", "30", {
        required: false, type: "number", min_value: 0, max_value: 1000,
      }),
      V("Time Limit", "TIMELIMIT", "Match length in minutes, 0 = unlimited", "20", {
        required: false, type: "number", min_value: 0, max_value: 240,
      }),
      V("Capture Limit", "CAPTURELIMIT", "Flag captures before the match ends", "8", {
        required: false, type: "number", min_value: 0, max_value: 100,
      }),
      V("Warmup Limit", "WARMUP_LIMIT", "Warmup length in seconds, -1 = until ready", "-1", {
        required: false, type: "number", min_value: -1, max_value: 3600,
      }),
      V("Warmup Stage", "WARMUP_STAGE", "Enable the warmup stage before matches", "1", { required: false, type: "boolean" }),
      V("Instagib Mutator", "MUTATOR_INSTAGIB", "One-shot Vaporizer-only mode", "0", { required: false, type: "boolean" }),
      V("Overkill Mutator", "MUTATOR_OVERKILL", "Enable the Overkill weapon set", "0", { required: false, type: "boolean" }),
    ]),

    ...group("Gameplay Rules", [
      V("Friendly Fire", "FRIENDLYFIRE", "Fraction of damage applied to teammates", "0", { required: false, type: "float", min_value: 0, max_value: 5 }),
      V("Team Balance", "G_BALANCE_TEAMS", "Automatically balance team sizes", "1", { required: false, type: "boolean" }),
      V("Force Team Balance", "G_BALANCE_TEAMS_PREVENT_IMBALANCE", "Block joins that would unbalance the teams", "1", { required: false, type: "boolean" }),
      V("Allow Vote", "SV_VOTE_CALL", "Let players call votes", "1", { required: false, type: "boolean" }),
      V("Vote Master", "SV_VOTE_MASTER", "Allow players to become vote master", "1", { required: false, type: "boolean" }),
      V("Vote Master Password", "SV_VOTE_MASTER_PASSWORD", "Password granting vote-master rights", "", { required: false, type: "password" }),
      V("Spectator Chat", "SV_SPECTATE", "Allow spectating", "1", { required: false, type: "boolean" }),
      V("Player Speed", "SV_MAXSPEED", "Base player movement speed", "360", {
        required: false, type: "number", min_value: 100, max_value: 2000,
      }),
      V("Gravity", "SV_GRAVITY", "World gravity", "800", {
        required: false, type: "number", min_value: 0, max_value: 5000,
      }),
      V("Weapon Stay", "G_WEAPON_STAY", "0 = weapons respawn, 1 = weapons persist", "0", {
        required: false, type: "select",
        enum_values: { "0": "0 — Normal respawn", "1": "1 — Weapons stay", "2": "2 — Stay, no ammo" },
      }),
      V("Powerups", "G_POWERUPS", "Enable Strength and Shield powerups, -1 = mode default", "-1", {
        required: false, type: "number", min_value: -1, max_value: 1,
      }),
      V("Force Respawn", "G_FORCED_RESPAWN", "Respawn dead players automatically", "0", { required: false, type: "boolean" }),
    ]),

    ...group("Bots", [
      V("Bots", "BOT_NUMBER", "Bots always present on the server", "0", {
        required: false, type: "number", min_value: 0, max_value: 64,
      }),
      V("Minimum Players", "MINPLAYERS", "Fill up to this many players with bots, 0 = off", "0", {
        required: false, type: "number", min_value: 0, max_value: 64,
      }),
      V("Bot Skill", "SKILL", "Bot difficulty from 0 (botlike) to 10 (godlike)", "5", {
        required: false, type: "number", min_value: 0, max_value: 17,
      }),
      V("Bot Prefix", "BOT_PREFIX", "Text prefixed to bot names", "[BOT]", { required: false }),
      V("Bots Join Teams", "BOT_JOIN_EMPTY", "Let bots keep an empty server populated", "0", { required: false, type: "boolean" }),
    ]),

    ...group("Access & Network", [
      V("Server Password", "SERVER_PASSWORD", "Password required to join, empty = public", "", { required: false, type: "password" }),
      V("Public Server", "SV_PUBLIC", "Advertise on the master servers", "1", {
        required: false, type: "select", enum_values: { "1": "1 — Public", "0": "0 — Unlisted", "-1": "-1 — LAN only" },
      }),
      V("Server MOTD", "SV_MOTD", "Message shown to players on connect", "", { required: false }),
      V("Max Rate", "SV_MAXRATE", "Per-client bandwidth cap in bytes/sec", "1000000", {
        required: false, type: "number", min_value: 10000, max_value: 10000000,
      }),
      V("Max Ping", "SV_MAXPING", "Reject clients above this ping, 0 = no limit", "0", {
        required: false, type: "number", min_value: 0, max_value: 999,
      }),
      V("Timeout", "NET_MESSAGETIMEOUT", "Milliseconds before a silent client is dropped", "300", {
        required: false, type: "number", min_value: 100, max_value: 60000,
      }),
      V("Curl Max Speed", "CURL_MAXSPEED", "KB/s cap for HTTP map downloads, 0 = unlimited", "0", {
        required: false, type: "number", min_value: 0, max_value: 100000,
      }),
      V("Download URL", "SV_CURL_DEFAULTURL", "Base URL clients download missing maps from", "", { required: false }),
      V("Allow Downloads", "SV_ALLOWDOWNLOADS", "Let clients download content from the server", "1", { required: false, type: "boolean" }),
      V("RCON Restricted", "RCON_RESTRICTED_COMMANDS", "Space-separated commands allowed for restricted rcon", "", { required: false }),
      V("Log File", "LOG_FILE", "Server log filename", "server.log", { required: false }),
    ]),
  ],

  installScript: `#!/bin/bash
set -e
INSTALL_DIR="{{INSTALL_PATH}}"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

## Download Xonotic
echo "Downloading Xonotic..."
curl -fSL --retry 3 -o xonotic.zip "https://dl.xonotic.org/xonotic-0.8.6.zip"
if ! unzip -t xonotic.zip > /dev/null 2>&1; then
  echo "ERROR: downloaded Xonotic archive is corrupt" >&2
  rm -f xonotic.zip
  exit 1
fi
unzip -o xonotic.zip
mv Xonotic/* . 2>/dev/null || true
rmdir Xonotic 2>/dev/null || true
rm -f xonotic.zip
chmod +x xonotic-linux64-dedicated xonotic-dedicated 2>/dev/null || true

if [ ! -x ./xonotic-linux64-dedicated ] && [ ! -x ./xonotic-dedicated ]; then
  echo "ERROR: xonotic dedicated server binary missing after extraction" >&2
  exit 1
fi

## Xonotic reads autoexec/server cfgs from data/ — the panel writes server.cfg there
mkdir -p "$INSTALL_DIR/data"

echo "Xonotic server installed successfully"
`,

  startCommand: `cd {{INSTALL_PATH}} && ./xonotic-linux64-dedicated -dedicated {{MAX_PLAYERS}} -sessionid gsm +serverconfig server.cfg +port {{PORT}} +gametype {{GAMETYPE}} +map {{START_MAP}}`,
  stopCommand: "quit",
  configFiles: { "data/server.cfg": "server.cfg" },
  defaultConfig: {
    __gsm_format: "q3seta",
    hostname: "{{SERVER_NAME}}",
    sv_maxclients: "{{MAX_PLAYERS}}",
    rcon_password: "{{RCON_PASSWORD}}",
    rcon_restricted_commands: "{{RCON_RESTRICTED_COMMANDS}}",
    password: "{{SERVER_PASSWORD}}",
    sv_public: "{{SV_PUBLIC}}",
    sv_motd: "{{SV_MOTD}}",
    sv_maxrate: "{{SV_MAXRATE}}",
    sv_maxping: "{{SV_MAXPING}}",
    net_messagetimeout: "{{NET_MESSAGETIMEOUT}}",
    curl_maxspeed: "{{CURL_MAXSPEED}}",
    sv_curl_defaulturl: "{{SV_CURL_DEFAULTURL}}",
    sv_allowdownloads: "{{SV_ALLOWDOWNLOADS}}",
    log_file: "{{LOG_FILE}}",
    g_start_delay: "0",
    fraglimit: "{{FRAGLIMIT}}",
    timelimit_override: "{{TIMELIMIT}}",
    capturelimit_override: "{{CAPTURELIMIT}}",
    warmup_limit: "{{WARMUP_LIMIT}}",
    g_warmup: "{{WARMUP_STAGE}}",
    g_instagib: "{{MUTATOR_INSTAGIB}}",
    g_overkill: "{{MUTATOR_OVERKILL}}",
    g_friendlyfire: "{{FRIENDLYFIRE}}",
    g_balance_teams: "{{G_BALANCE_TEAMS}}",
    g_balance_teams_prevent_imbalance: "{{G_BALANCE_TEAMS_PREVENT_IMBALANCE}}",
    sv_vote_call: "{{SV_VOTE_CALL}}",
    sv_vote_master: "{{SV_VOTE_MASTER}}",
    sv_vote_master_password: "{{SV_VOTE_MASTER_PASSWORD}}",
    sv_spectate: "{{SV_SPECTATE}}",
    sv_maxspeed: "{{SV_MAXSPEED}}",
    sv_gravity: "{{SV_GRAVITY}}",
    g_weapon_stay: "{{G_WEAPON_STAY}}",
    g_powerups: "{{G_POWERUPS}}",
    g_forced_respawn: "{{G_FORCED_RESPAWN}}",
    bot_number: "{{BOT_NUMBER}}",
    minplayers: "{{MINPLAYERS}}",
    skill: "{{SKILL}}",
    bot_prefix: "{{BOT_PREFIX}}",
    bot_join_empty: "{{BOT_JOIN_EMPTY}}",
    g_maplist: "{{MAP_LIST}}",
  },
};
