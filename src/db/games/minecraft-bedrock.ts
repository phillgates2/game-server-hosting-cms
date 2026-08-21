import { V, group, COMMON_VARS, type GameTemplate } from "./types";

// Bedrock Dedicated Server reads a flat server.properties.
// Reference: the server.properties shipped in bedrock-server-*.zip
export const minecraftBedrock: GameTemplate = {
  slug: "minecraft-bedrock",
  name: "Minecraft: Bedrock Edition",
  engine: "Bedrock",
  defaultPort: 19132,
  steamAppId: null,
  iconEmoji: "\u{1FAA8}",
  supportsIpv6: true,
  category: "Minecraft",
  description: "Official Bedrock server for cross-platform play",
  estimatedSize: "~300 MB",
  variables: [
    ...COMMON_VARS,

    ...group("World", [
      V("Level Name", "LEVEL_NAME", "Folder name of the world save", "Bedrock level", { required: false }),
      V("Level Seed", "LEVEL_SEED", "Seed for world generation, empty = random", "", { required: false }),
      V("Level Type", "LEVEL_TYPE", "World generator preset", "DEFAULT", {
        required: false, type: "select",
        enum_values: { DEFAULT: "Default", FLAT: "Flat", LEGACY: "Legacy", DEFAULT_1_1: "Default 1.1" },
      }),
      V("Default Player Permission", "DEFAULT_PLAYER_PERMISSION_LEVEL", "Permission level granted to new players", "member", {
        required: false, type: "select",
        enum_values: { visitor: "Visitor", member: "Member", operator: "Operator" },
      }),
    ]),

    ...group("Gameplay", [
      V("Game Mode", "GAMEMODE", "Default game mode for joining players", "survival", {
        required: false, type: "select",
        enum_values: { survival: "Survival", creative: "Creative", adventure: "Adventure" },
      }),
      V("Force Game Mode", "FORCE_GAMEMODE", "Reset players to the default game mode on join", "false", { required: false, type: "boolean" }),
      V("Difficulty", "DIFFICULTY", "World difficulty", "easy", {
        required: false, type: "select",
        enum_values: { peaceful: "Peaceful", easy: "Easy", normal: "Normal", hard: "Hard" },
      }),
      V("Allow Cheats", "ALLOW_CHEATS", "Enable commands such as /gamemode and /give", "false", { required: false, type: "boolean" }),
      V("PvP", "PVP", "Allow players to damage each other (player-movement based)", "true", { required: false, type: "boolean" }),
    ]),

    ...group("Performance", [
      V("View Distance", "VIEW_DISTANCE", "Maximum chunk radius sent to clients", "32", {
        required: false, type: "number", min_value: 5, max_value: 96,
      }),
      V("Tick Distance", "TICK_DISTANCE", "Chunk radius that is simulated (4-12)", "4", {
        required: false, type: "number", min_value: 4, max_value: 12,
      }),
      V("Player Idle Timeout", "PLAYER_IDLE_TIMEOUT", "Minutes before an idle player is kicked, 0 = never", "30", {
        required: false, type: "number", min_value: 0, max_value: 1440,
      }),
      V("Max Threads", "MAX_THREADS", "Maximum worker threads, 0 = use as many as possible", "8", {
        required: false, type: "number", min_value: 0, max_value: 256,
      }),
      V("Compression Threshold", "COMPRESSION_THRESHOLD", "Minimum packet size in bytes before compression", "1", {
        required: false, type: "number", min_value: 0, max_value: 65535,
      }),
    ]),

    ...group("Security & Access", [
      V("Online Mode", "ONLINE_MODE", "Require Xbox Live authentication", "true", { required: false, type: "boolean" }),
      V("Allow List", "ALLOW_LIST", "Only allow players listed in allowlist.json", "false", { required: false, type: "boolean" }),
      V("Server Authoritative Movement", "SERVER_AUTHORITATIVE_MOVEMENT", "Server validates client movement (anti-cheat)", "server-auth", {
        required: false, type: "select",
        enum_values: {
          "client-auth": "Client authoritative",
          "server-auth": "Server authoritative",
          "server-auth-with-rewind": "Server authoritative with rewind",
        },
      }),
      V("Player Movement Distance Threshold", "PLAYER_MOVEMENT_DISTANCE_THRESHOLD", "Blocks of desync tolerated before correction", "0.3", { required: false, type: "float", min_value: 0, max_value: 10 }),
      V("Emit Server Telemetry", "EMIT_SERVER_TELEMETRY", "Send usage telemetry to Mojang", "false", { required: false, type: "boolean" }),
    ]),

    ...group("Network", [
      V("Server Port (IPv6)", "SERVER_PORT_V6", "UDP port for IPv6 clients", "19133", {
        required: false, type: "number", min_value: 1, max_value: 65535,
      }),
      V("Texture Pack Required", "TEXTUREPACK_REQUIRED", "Force clients to download the server resource pack", "false", { required: false, type: "boolean" }),
      V("Content Log File Enabled", "CONTENT_LOG_FILE_ENABLED", "Write content errors to a log file", "false", { required: false, type: "boolean" }),
      V("Correct Player Movement", "CORRECT_PLAYER_MOVEMENT", "Rubber-band players who fail movement validation", "false", { required: false, type: "boolean" }),
    ]),
  ],

  installScript: `#!/bin/bash
set -e
INSTALL_DIR="{{INSTALL_PATH}}"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

if ! command -v unzip &> /dev/null; then
  apt-get update -qq && apt-get install -y -qq unzip 2>/dev/null || true
fi

## Resolve the Bedrock download URL.
## 1) Mojang's official links API (stable, no HTML scraping)
echo "Resolving latest Bedrock Dedicated Server download URL..."
DOWNLOAD_URL=$(curl -sSL --max-time 30 "https://net-secondary.web.minecraft-services.net/api/v1.0/download/links" \
  | grep -oP '\\"downloadType\\":\\"serverBedrockLinux\\",\\"downloadUrl\\":\\"\\K[^\\"]+' | head -1)

## 2) Fallback: scrape the download page (new minecraft.net host)
if [ -z "$DOWNLOAD_URL" ]; then
  echo "API lookup failed, scraping download page..."
  DOWNLOAD_URL=$(curl -sSL --max-time 30 -A "Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0" \
    "https://www.minecraft.net/en-us/download/server/bedrock" \
    | grep -oP 'https://www\.minecraft\.net/bedrockdedicatedserver/bin-linux/bedrock-server-[^"\\s<>]+?\.zip' | head -1)
fi

## 3) Fallback: pinned known-good versions on the current host
if [ -z "$DOWNLOAD_URL" ]; then
  echo "Scrape failed, trying pinned known versions..."
  for VER in 1.26.44.3 1.21.124.2 1.21.111.1 1.21.101.1; do
    CANDIDATE="https://www.minecraft.net/bedrockdedicatedserver/bin-linux/bedrock-server-$VER.zip"
    if curl -fsIL --max-time 20 -A "Mozilla/5.0" "$CANDIDATE" > /dev/null 2>&1; then
      DOWNLOAD_URL="$CANDIDATE"
      break
    fi
  done
fi

if [ -z "$DOWNLOAD_URL" ]; then
  echo "ERROR: Could not resolve any Bedrock server download URL" >&2
  exit 1
fi

echo "Downloading: $DOWNLOAD_URL"
curl -fSL --retry 3 -A "Mozilla/5.0" -o bedrock-server.zip "$DOWNLOAD_URL"

## Sanity-check the download is actually a zip archive
if ! unzip -t bedrock-server.zip > /dev/null 2>&1; then
  echo "ERROR: Downloaded file is not a valid zip (got HTML error page?)" >&2
  head -c 200 bedrock-server.zip >&2 || true
  rm -f bedrock-server.zip
  exit 1
fi

unzip -o bedrock-server.zip
rm -f bedrock-server.zip
chmod +x bedrock_server

if [ ! -x ./bedrock_server ]; then
  echo "ERROR: bedrock_server binary missing after extraction" >&2
  exit 1
fi

echo "Minecraft Bedrock server installed successfully"
`,

  startCommand: `cd {{INSTALL_PATH}} && LD_LIBRARY_PATH=. ./bedrock_server`,
  stopCommand: "stop",
  configFiles: { "server.properties": "server.properties" },
  defaultConfig: {
    __gsm_format: "properties",
    "server-name": "{{SERVER_NAME}}",
    "server-port": "{{PORT}}",
    "server-portv6": "{{SERVER_PORT_V6}}",
    "max-players": "{{MAX_PLAYERS}}",
    "gamemode": "{{GAMEMODE}}",
    "force-gamemode": "{{FORCE_GAMEMODE}}",
    "difficulty": "{{DIFFICULTY}}",
    "allow-cheats": "{{ALLOW_CHEATS}}",
    "pvp": "{{PVP}}",
    "level-name": "{{LEVEL_NAME}}",
    "level-seed": "{{LEVEL_SEED}}",
    "level-type": "{{LEVEL_TYPE}}",
    "default-player-permission-level": "{{DEFAULT_PLAYER_PERMISSION_LEVEL}}",
    "view-distance": "{{VIEW_DISTANCE}}",
    "tick-distance": "{{TICK_DISTANCE}}",
    "player-idle-timeout": "{{PLAYER_IDLE_TIMEOUT}}",
    "max-threads": "{{MAX_THREADS}}",
    "compression-threshold": "{{COMPRESSION_THRESHOLD}}",
    "online-mode": "{{ONLINE_MODE}}",
    "allow-list": "{{ALLOW_LIST}}",
    "server-authoritative-movement": "{{SERVER_AUTHORITATIVE_MOVEMENT}}",
    "player-movement-distance-threshold": "{{PLAYER_MOVEMENT_DISTANCE_THRESHOLD}}",
    "correct-player-movement": "{{CORRECT_PLAYER_MOVEMENT}}",
    "emit-server-telemetry": "{{EMIT_SERVER_TELEMETRY}}",
    "texturepack-required": "{{TEXTUREPACK_REQUIRED}}",
    "content-log-file-enabled": "{{CONTENT_LOG_FILE_ENABLED}}",
  },
};
