import { V, group, COMMON_VARS, type GameTemplate } from "./types";

// Terraria via TShock. TShock's own settings live in tshock/config.json under a
// "Settings" object; vanilla world options are passed as launch arguments.
export const terraria: GameTemplate = {
  slug: "terraria",
  name: "Terraria (TShock)",
  engine: "TShock",
  defaultPort: 7777,
  steamAppId: null,
  iconEmoji: "\u{1F333}",
  supportsIpv6: false,
  category: "Sandbox",
  description: "2D sandbox adventure with TShock server management",
  estimatedSize: "~200 MB",
  variables: [
    ...COMMON_VARS,

    ...group("World", [
      V("World Name", "WORLD_NAME", "Name of the world file (without .wld)", "world"),
      V("World Size", "WORLD_SIZE", "Size used when auto-creating a new world", "2", {
        required: false, type: "select",
        enum_values: { "1": "1 \u2014 Small", "2": "2 \u2014 Medium", "3": "3 \u2014 Large" },
      }),
      V("World Difficulty", "WORLD_DIFFICULTY", "Difficulty used when auto-creating a world", "0", {
        required: false, type: "select",
        enum_values: { "0": "0 \u2014 Classic", "1": "1 \u2014 Expert", "2": "2 \u2014 Master", "3": "3 \u2014 Journey" },
      }),
      V("World Seed", "WORLD_SEED", "Seed used when auto-creating a world, empty = random", "", { required: false }),
      V("Auto Save", "AUTO_SAVE", "Periodically save the world", "true", { required: false, type: "boolean" }),
      V("Backup Interval", "BACKUP_INTERVAL", "Minutes between world backups, 0 = disabled", "10", {
        required: false, type: "number", min_value: 0, max_value: 1440,
      }),
      V("Backup Keep For", "BACKUP_KEEP_FOR", "Minutes to retain backups", "240", {
        required: false, type: "number", min_value: 0, max_value: 100000,
      }),
      V("Save World On Crash", "SAVE_WORLD_ON_CRASH", "Attempt a world save when the server crashes", "true", { required: false, type: "boolean" }),
      V("Save World On Last Exit", "SAVE_WORLD_ON_LAST_EXIT", "Save when the last player disconnects", "false", { required: false, type: "boolean" }),
    ]),

    ...group("Access", [
      V("Server Password", "SERVER_PASSWORD", "Password required to join, empty = public", "", { required: false, type: "password" }),
      V("Enable Whitelist", "ENABLE_WHITELIST", "Only allow whitelisted players", "false", { required: false, type: "boolean" }),
      V("Require Login", "REQUIRE_LOGIN", "Players must log into a TShock account", "false", { required: false, type: "boolean" }),
      V("Disable UUID Login", "DISABLE_UUID_LOGIN", "Disable automatic UUID-based login", "false", { required: false, type: "boolean" }),
      V("Kick Empty UUID", "KICK_EMPTY_UUID", "Kick clients that report no UUID", "false", { required: false, type: "boolean" }),
      V("Max Slots", "MAX_SLOTS", "Player slots TShock advertises", "8", {
        required: false, type: "number", min_value: 1, max_value: 255,
      }),
      V("Reserved Slots", "RESERVED_SLOTS", "Slots reserved for players with the reservedslot permission", "20", {
        required: false, type: "number", min_value: 0, max_value: 255,
      }),
      V("Server Fullname", "SERVER_FULLNAME", "Long server name shown in the list", "", { required: false }),
    ]),

    ...group("Gameplay", [
      V("PvP Mode", "PVP_MODE", "How PvP is handled", "normal", {
        required: false, type: "select",
        enum_values: { normal: "Normal \u2014 players choose", always: "Always on", disabled: "Disabled" },
      }),
      V("Hardcore Only", "HARDCORE_ONLY", "Only allow hardcore characters", "false", { required: false, type: "boolean" }),
      V("Mediumcore Only", "MEDIUMCORE_ONLY", "Only allow mediumcore or harder characters", "false", { required: false, type: "boolean" }),
      V("Softcore Only", "SOFTCORE_ONLY", "Only allow softcore characters", "false", { required: false, type: "boolean" }),
      V("Disable Building", "DISABLE_BUILD", "Block all tile placement and removal", "false", { required: false, type: "boolean" }),
      V("Disable Hardmode", "DISABLE_HARDMODE", "Prevent the world entering hardmode", "false", { required: false, type: "boolean" }),
      V("Disable Dungeon Guardian", "DISABLE_DUNGEON_GUARDIAN", "Teleport players out instead of spawning the Dungeon Guardian", "false", { required: false, type: "boolean" }),
      V("Disable Clown Bombs", "DISABLE_CLOWN_BOMBS", "Stop clowns destroying terrain", "false", { required: false, type: "boolean" }),
      V("Disable Snow Balls", "DISABLE_SNOW_BALLS", "Disable snowball launchers", "false", { required: false, type: "boolean" }),
      V("Disable Tombstones", "DISABLE_TOMBSTONES", "Do not drop tombstones on death", "true", { required: false, type: "boolean" }),
      V("Force Time", "FORCE_TIME", "Lock the world clock", "normal", {
        required: false, type: "select", enum_values: { normal: "Normal", day: "Always day", night: "Always night" },
      }),
      V("Infinite Invasion", "INFINITE_INVASION", "Invasions never end", "false", { required: false, type: "boolean" }),
      V("Respawn Seconds", "RESPAWN_SECONDS", "Respawn delay in seconds", "5", {
        required: false, type: "number", min_value: 1, max_value: 600,
      }),
      V("Respawn Boss Seconds", "RESPAWN_BOSS_SECONDS", "Respawn delay during boss fights", "10", {
        required: false, type: "number", min_value: 1, max_value: 600,
      }),
      V("Invasion Multiplier", "INVASION_MULTIPLIER", "Scales invasion size with player count", "1", {
        required: false, type: "number", min_value: 1, max_value: 100,
      }),
      V("Default Maximum Spawns", "DEFAULT_MAXIMUM_SPAWNS", "Maximum NPCs alive at once", "5", {
        required: false, type: "number", min_value: 1, max_value: 200,
      }),
      V("Default Spawn Rate", "DEFAULT_SPAWN_RATE", "NPC spawn rate \u2014 lower spawns faster", "600", {
        required: false, type: "number", min_value: 1, max_value: 10000,
      }),
    ]),

    ...group("Anti-Cheat & Limits", [
      V("Enable Spam Protection", "SPAM_PROTECTION", "Kick players who trip the anti-spam checks", "false", { required: false, type: "boolean" }),
      V("Disable Spew Logs", "DISABLE_SPEW_LOGS", "Stop logging repeated anti-cheat messages", "true", { required: false, type: "boolean" }),
      V("Tile Kill Threshold", "TILE_KILL_THRESHOLD", "Tiles a player may destroy per second before being flagged", "60", {
        required: false, type: "number", min_value: 0, max_value: 10000,
      }),
      V("Tile Place Threshold", "TILE_PLACE_THRESHOLD", "Tiles a player may place per second before being flagged", "32", {
        required: false, type: "number", min_value: 0, max_value: 10000,
      }),
      V("Tile Liquid Threshold", "TILE_LIQUID_THRESHOLD", "Liquid updates per second before being flagged", "50", {
        required: false, type: "number", min_value: 0, max_value: 10000,
      }),
      V("Projectile Threshold", "PROJECTILE_THRESHOLD", "Projectiles per second before being flagged", "50", {
        required: false, type: "number", min_value: 0, max_value: 10000,
      }),
      V("Heal Other Threshold", "HEAL_OTHER_THRESHOLD", "Heal-other packets per second before being flagged", "50", {
        required: false, type: "number", min_value: 0, max_value: 10000,
      }),
      V("Kick On Damage Threshold", "KICK_ON_DAMAGE_THRESHOLD", "Kick instead of ignoring damage exploits", "false", { required: false, type: "boolean" }),
      V("Kick On Tile Threshold", "KICK_ON_TILE_THRESHOLD", "Kick instead of reverting tile exploits", "false", { required: false, type: "boolean" }),
      V("Ignore Projectile Update", "IGNORE_PROJECTILE_UPDATE", "Skip projectile update validation", "false", { required: false, type: "boolean" }),
      V("Range Checks", "RANGE_CHECKS", "Validate that actions happen near the player", "true", { required: false, type: "boolean" }),
    ]),

    ...group("REST API", [
      V("Enable REST API", "REST_API_ENABLED", "Enable TShock's HTTP REST API", "false", { required: false, type: "boolean" }),
      V("REST API Port", "REST_API_PORT", "Port the REST API binds to", "7878", {
        required: false, type: "number", min_value: 1, max_value: 65535,
      }),
      V("Log REST Calls", "LOG_REST", "Write every REST call to the log", "false", { required: false, type: "boolean" }),
      V("REST Max Requests", "REST_MAX_REQUESTS", "Requests allowed per token per interval", "5", {
        required: false, type: "number", min_value: 1, max_value: 1000,
      }),
      V("REST Limit Only Failed Login", "REST_LIMIT_ONLY_FAILED_LOGIN", "Only rate-limit failed logins", "false", { required: false, type: "boolean" }),
    ]),

    ...group("Announcements", [
      V("Broadcast Message", "BROADCAST", "Message shown when players join", "Welcome!", { required: false }),
      V("Broadcast Colour (Red)", "BROADCAST_R", "Red channel of the broadcast colour", "127", {
        required: false, type: "number", min_value: 0, max_value: 255,
      }),
      V("Broadcast Colour (Green)", "BROADCAST_G", "Green channel of the broadcast colour", "255", {
        required: false, type: "number", min_value: 0, max_value: 255,
      }),
      V("Broadcast Colour (Blue)", "BROADCAST_B", "Blue channel of the broadcast colour", "212", {
        required: false, type: "number", min_value: 0, max_value: 255,
      }),
      V("Announce Save", "ANNOUNCE_SAVE", "Tell players when the world is saved", "true", { required: false, type: "boolean" }),
      V("Show Backup Autosave Messages", "SHOW_BACKUP_AUTOSAVE_MESSAGES", "Announce automatic backups", "true", { required: false, type: "boolean" }),
      V("Chat Format", "CHAT_FORMAT", "Chat line format string", "{1}: {2}", { required: false }),
      V("Chat Above Heads Format", "CHAT_ABOVE_HEADS_FORMAT", "Format for chat shown above player heads", "{2}", { required: false }),
      V("Enable Geo IP", "ENABLE_GEO_IP", "Look up player countries with GeoIP", "false", { required: false, type: "boolean" }),
    ]),
  ],

  installScript: `#!/bin/bash
set -e
INSTALL_DIR="{{INSTALL_PATH}}"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

## Pick the asset matching the host architecture
ARCH=$(uname -m)
case "$ARCH" in
  x86_64|amd64)  RID="linux-x64" ;;
  aarch64|arm64) RID="linux-arm64" ;;
  armv7l)        RID="linux-arm" ;;
  *) echo "ERROR: unsupported architecture for TShock: $ARCH" >&2; exit 1 ;;
esac

## Download latest TShock release from GitHub for this architecture
echo "Fetching latest TShock release ($RID)..."
RELEASE_JSON=$(curl -fsSL --retry 3 "https://api.github.com/repos/Pryaxis/TShock/releases/latest")
LATEST_URL=$(echo "$RELEASE_JSON" | grep -oP '"browser_download_url"\\s*:\\s*"\\K[^"]+' | grep -- "-$RID-" | head -1)

if [ -z "$LATEST_URL" ]; then
  echo "ERROR: could not find a TShock asset for $RID in the latest release" >&2
  exit 1
fi

echo "Downloading TShock from: $LATEST_URL"
curl -fSL --retry 3 -o tshock.zip "$LATEST_URL"

if ! unzip -t tshock.zip > /dev/null 2>&1; then
  echo "ERROR: downloaded TShock archive is corrupt" >&2
  rm -f tshock.zip
  exit 1
fi

mkdir -p tshock-extract
unzip -o tshock.zip -d tshock-extract
rm -f tshock.zip

## TShock ships the binary either at the archive root or one folder down — normalize
TSHOCK_BIN=$(find tshock-extract -type f -name "TShock.Server" | head -1)
if [ -z "$TSHOCK_BIN" ]; then
  echo "ERROR: TShock.Server not found inside the downloaded archive" >&2
  rm -rf tshock-extract
  exit 1
fi
cp -a "$(dirname "$TSHOCK_BIN")/." .
rm -rf tshock-extract
chmod +x TShock.Server

## Create worlds + config directories (the panel writes tshock/config.json)
mkdir -p worlds tshock

echo "Terraria/TShock server installed successfully"
`,

  startCommand: `cd {{INSTALL_PATH}} && ./TShock.Server -ip 0.0.0.0 -port {{PORT}} -maxplayers {{MAX_PLAYERS}} -world "{{INSTALL_PATH}}/worlds/{{WORLD_NAME}}.wld" -autocreate {{WORLD_SIZE}} -difficulty {{WORLD_DIFFICULTY}} -worldname "{{WORLD_NAME}}" -seed "{{WORLD_SEED}}"`,
  stopCommand: "exit",
  configFiles: { "tshock/config.json": "config.json" },
  defaultConfig: {
    __gsm_format: "json",
    Settings: {
      ServerPort: "{{PORT}}",
      MaxSlots: "{{MAX_SLOTS}}",
      ReservedSlots: "{{RESERVED_SLOTS}}",
      ServerName: "{{SERVER_NAME}}",
      ServerFullName: "{{SERVER_FULLNAME}}",
      ServerPassword: "{{SERVER_PASSWORD}}",
      EnableWhitelist: "{{ENABLE_WHITELIST}}",
      RequireLogin: "{{REQUIRE_LOGIN}}",
      DisableUUIDLogin: "{{DISABLE_UUID_LOGIN}}",
      KickEmptyUUID: "{{KICK_EMPTY_UUID}}",
      AutoSave: "{{AUTO_SAVE}}",
      BackupInterval: "{{BACKUP_INTERVAL}}",
      BackupKeepFor: "{{BACKUP_KEEP_FOR}}",
      SaveWorldOnCrash: "{{SAVE_WORLD_ON_CRASH}}",
      SaveWorldOnLastPlayerExit: "{{SAVE_WORLD_ON_LAST_EXIT}}",
      AnnounceSave: "{{ANNOUNCE_SAVE}}",
      ShowBackupAutosaveMessages: "{{SHOW_BACKUP_AUTOSAVE_MESSAGES}}",
      PvPMode: "{{PVP_MODE}}",
      HardcoreOnly: "{{HARDCORE_ONLY}}",
      MediumcoreOnly: "{{MEDIUMCORE_ONLY}}",
      SoftcoreOnly: "{{SOFTCORE_ONLY}}",
      DisableBuild: "{{DISABLE_BUILD}}",
      DisableHardmode: "{{DISABLE_HARDMODE}}",
      DisableDungeonGuardian: "{{DISABLE_DUNGEON_GUARDIAN}}",
      DisableClownBombs: "{{DISABLE_CLOWN_BOMBS}}",
      DisableSnowBalls: "{{DISABLE_SNOW_BALLS}}",
      DisableTombstones: "{{DISABLE_TOMBSTONES}}",
      ForceTime: "{{FORCE_TIME}}",
      InfiniteInvasion: "{{INFINITE_INVASION}}",
      RespawnSeconds: "{{RESPAWN_SECONDS}}",
      RespawnBossSeconds: "{{RESPAWN_BOSS_SECONDS}}",
      InvasionMultiplier: "{{INVASION_MULTIPLIER}}",
      DefaultMaximumSpawns: "{{DEFAULT_MAXIMUM_SPAWNS}}",
      DefaultSpawnRate: "{{DEFAULT_SPAWN_RATE}}",
      SpamProtectionThreshold: "{{SPAM_PROTECTION}}",
      DisableSpewLogs: "{{DISABLE_SPEW_LOGS}}",
      TileKillThreshold: "{{TILE_KILL_THRESHOLD}}",
      TilePlaceThreshold: "{{TILE_PLACE_THRESHOLD}}",
      TileLiquidThreshold: "{{TILE_LIQUID_THRESHOLD}}",
      ProjectileThreshold: "{{PROJECTILE_THRESHOLD}}",
      HealOtherThreshold: "{{HEAL_OTHER_THRESHOLD}}",
      KickOnDamageThresholdBroken: "{{KICK_ON_DAMAGE_THRESHOLD}}",
      KickOnTileKillThresholdBroken: "{{KICK_ON_TILE_THRESHOLD}}",
      IgnoreProjUpdate: "{{IGNORE_PROJECTILE_UPDATE}}",
      RangeChecks: "{{RANGE_CHECKS}}",
      RestApiEnabled: "{{REST_API_ENABLED}}",
      RestApiPort: "{{REST_API_PORT}}",
      LogRest: "{{LOG_REST}}",
      RESTMaximumRequestsPerInterval: "{{REST_MAX_REQUESTS}}",
      RESTLimitOnlyFailedLoginRequests: "{{REST_LIMIT_ONLY_FAILED_LOGIN}}",
      BroadcastMessage: "{{BROADCAST}}",
      BroadcastRGB: ["{{BROADCAST_R}}", "{{BROADCAST_G}}", "{{BROADCAST_B}}"],
      ChatFormat: "{{CHAT_FORMAT}}",
      ChatAboveHeadsFormat: "{{CHAT_ABOVE_HEADS_FORMAT}}",
      EnableGeoIP: "{{ENABLE_GEO_IP}}",
    },
  },
};
