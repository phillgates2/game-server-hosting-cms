import { V, group, COMMON_VARS, type GameTemplate } from "./types";

// server.properties reference: https://minecraft.wiki/w/Server.properties
export const minecraftJava: GameTemplate = {
  slug: "minecraft-java",
  name: "Minecraft: Java Edition",
  engine: "Java",
  defaultPort: 25565,
  steamAppId: null,
  iconEmoji: "🧱",
  supportsIpv6: true,
  category: "Minecraft",
  description: "Official Minecraft Java server with vanilla gameplay",
  estimatedSize: "~500 MB",
  variables: [
    ...COMMON_VARS,

    ...group("Java Runtime", [
      V("Max RAM (GB)", "MAX_RAM", "Maximum heap size passed to -Xmx", "4", {
        type: "number", min_value: 1, max_value: 512,
      }),
      V("Initial RAM (GB)", "MIN_RAM", "Initial heap size passed to -Xms", "1", {
        required: false, type: "number", min_value: 1, max_value: 512,
      }),
      V("Extra JVM Flags", "JVM_FLAGS", "Additional flags inserted before -jar (e.g. Aikar's flags)", "-XX:+UseG1GC", { required: false }),
    ]),

    ...group("World", [
      V("Level Name", "LEVEL_NAME", "Folder name of the world save (level-name)", "world", { required: false }),
      V("Level Seed", "LEVEL_SEED", "Seed for world generation, empty = random (level-seed)", "", { required: false }),
      V("Level Type", "LEVEL_TYPE", "World generator preset (level-type)", "minecraft:normal", {
        required: false, type: "select",
        enum_values: {
          "minecraft:normal": "Normal",
          "minecraft:flat": "Superflat",
          "minecraft:large_biomes": "Large Biomes",
          "minecraft:amplified": "Amplified",
          "minecraft:single_biome_surface": "Single Biome",
        },
      }),
      V("Generator Settings", "GENERATOR_SETTINGS", "JSON settings for the chosen generator (generator-settings)", "{}", { required: false }),
      V("Generate Structures", "GENERATE_STRUCTURES", "Generate villages, temples and other structures", "true", { required: false, type: "boolean" }),
      V("Max World Size", "MAX_WORLD_SIZE", "World border radius in blocks (max-world-size)", "29999984", {
        required: false, type: "number", min_value: 1, max_value: 29999984,
      }),
      V("Spawn Protection", "SPAWN_PROTECTION", "Radius in blocks non-ops cannot build in, 0 = disabled", "16", {
        required: false, type: "number", min_value: 0, max_value: 1000,
      }),
      V("Allow Nether", "ALLOW_NETHER", "Allow players to travel to the Nether", "true", { required: false, type: "boolean" }),
      V("Spawn Monsters", "SPAWN_MONSTERS", "Spawn hostile mobs", "true", { required: false, type: "boolean" }),
      V("Spawn Animals", "SPAWN_ANIMALS", "Spawn passive animals", "true", { required: false, type: "boolean" }),
      V("Spawn NPCs", "SPAWN_NPCS", "Spawn villagers", "true", { required: false, type: "boolean" }),
    ]),

    ...group("Gameplay", [
      V("Game Mode", "GAMEMODE", "Default game mode for joining players", "survival", {
        required: false, type: "select",
        enum_values: { survival: "Survival", creative: "Creative", adventure: "Adventure", spectator: "Spectator" },
      }),
      V("Force Game Mode", "FORCE_GAMEMODE", "Reset players to the default game mode on join", "false", { required: false, type: "boolean" }),
      V("Difficulty", "DIFFICULTY", "World difficulty", "normal", {
        required: false, type: "select",
        enum_values: { peaceful: "Peaceful", easy: "Easy", normal: "Normal", hard: "Hard" },
      }),
      V("Hardcore", "HARDCORE", "Players are set to spectator on death and difficulty is locked to hard", "false", { required: false, type: "boolean" }),
      V("PvP", "PVP", "Allow players to damage each other", "true", { required: false, type: "boolean" }),
      V("Allow Flight", "ALLOW_FLIGHT", "Permit flight mods in survival (does not affect creative)", "false", { required: false, type: "boolean" }),
      V("Enable Command Block", "ENABLE_COMMAND_BLOCK", "Allow command blocks to run", "false", { required: false, type: "boolean" }),
      V("Player Idle Timeout", "PLAYER_IDLE_TIMEOUT", "Minutes before an idle player is kicked, 0 = never", "0", {
        required: false, type: "number", min_value: 0, max_value: 1440,
      }),
      V("Op Permission Level", "OP_PERMISSION_LEVEL", "Permission level granted by /op (1-4)", "4", {
        required: false, type: "number", min_value: 1, max_value: 4,
      }),
      V("Function Permission Level", "FUNCTION_PERMISSION_LEVEL", "Permission level for functions and command blocks (1-4)", "2", {
        required: false, type: "number", min_value: 1, max_value: 4,
      }),
    ]),

    ...group("Performance", [
      V("View Distance", "VIEW_DISTANCE", "Chunk radius sent to clients (view-distance)", "10", {
        required: false, type: "number", min_value: 2, max_value: 32,
      }),
      V("Simulation Distance", "SIMULATION_DISTANCE", "Chunk radius that ticks entities and blocks", "10", {
        required: false, type: "number", min_value: 2, max_value: 32,
      }),
      V("Max Tick Time", "MAX_TICK_TIME", "Milliseconds a tick may take before the watchdog kills the server, -1 = disabled", "60000", {
        required: false, type: "number", min_value: -1, max_value: 600000,
      }),
      V("Entity Broadcast Range", "ENTITY_BROADCAST_RANGE_PERCENTAGE", "Percentage of the default entity view range", "100", {
        required: false, type: "number", min_value: 10, max_value: 1000,
      }),
      V("Network Compression Threshold", "NETWORK_COMPRESSION_THRESHOLD", "Compress packets above this size in bytes, -1 = off", "256", {
        required: false, type: "number", min_value: -1, max_value: 65535,
      }),
      V("Sync Chunk Writes", "SYNC_CHUNK_WRITES", "Write chunks synchronously — safer but slower", "true", { required: false, type: "boolean" }),
      V("Max Chained Neighbor Updates", "MAX_CHAINED_NEIGHBOR_UPDATES", "Consecutive neighbour updates before skipping", "1000000", {
        required: false, type: "number", min_value: -1, max_value: 100000000,
      }),
    ]),

    ...group("Security & Access", [
      V("Online Mode", "ONLINE_MODE", "Verify players against Mojang's session servers", "true", { required: false, type: "boolean" }),
      V("Enforce Secure Profile", "ENFORCE_SECURE_PROFILE", "Require a Mojang-signed chat profile", "true", { required: false, type: "boolean" }),
      V("White List", "WHITE_LIST", "Only allow whitelisted players", "false", { required: false, type: "boolean" }),
      V("Enforce Whitelist", "ENFORCE_WHITELIST", "Kick non-whitelisted players when the whitelist reloads", "false", { required: false, type: "boolean" }),
      V("Prevent Proxy Connections", "PREVENT_PROXY_CONNECTIONS", "Block players connecting through a VPN or proxy", "false", { required: false, type: "boolean" }),
      V("Hide Online Players", "HIDE_ONLINE_PLAYERS", "Omit the player list from the server status ping", "false", { required: false, type: "boolean" }),
      V("Broadcast Console To Ops", "BROADCAST_CONSOLE_TO_OPS", "Send console command output to online operators", "true", { required: false, type: "boolean" }),
      V("Broadcast RCON To Ops", "BROADCAST_RCON_TO_OPS", "Send RCON command output to online operators", "true", { required: false, type: "boolean" }),
    ]),

    ...group("Network", [
      V("Server IP", "SERVER_IP", "Bind address, empty = all interfaces (server-ip)", "", { required: false }),
      V("MOTD", "MOTD", "Message shown in the multiplayer server list", "A Minecraft Server", { required: false }),
      V("Enable Status", "ENABLE_STATUS", "Respond to server list pings", "true", { required: false, type: "boolean" }),
      V("Rate Limit", "RATE_LIMIT", "Packets per second before a client is kicked, 0 = unlimited", "0", {
        required: false, type: "number", min_value: 0, max_value: 10000,
      }),
      V("Enable Query", "ENABLE_QUERY", "Enable the GameSpy4 query protocol", "false", { required: false, type: "boolean" }),
      V("Query Port", "QUERY_PORT", "Port for the query listener", "25565", {
        required: false, type: "number", min_value: 1, max_value: 65535,
      }),
      V("Resource Pack", "RESOURCE_PACK", "URL of a server resource pack", "", { required: false }),
      V("Resource Pack SHA1", "RESOURCE_PACK_SHA1", "SHA-1 hash of the resource pack file", "", { required: false }),
      V("Require Resource Pack", "REQUIRE_RESOURCE_PACK", "Disconnect players who decline the resource pack", "false", { required: false, type: "boolean" }),
    ]),

    ...group("RCON", [
      V("Enable RCON", "ENABLE_RCON", "Enable the remote console listener", "false", { required: false, type: "boolean" }),
      V("RCON Port", "RCON_PORT", "Port the RCON listener binds to", "25575", {
        required: false, type: "number", min_value: 1, max_value: 65535,
      }),
      V("RCON Password", "RCON_PASSWORD", "Password required for RCON, must be set when RCON is enabled", "", { required: false, type: "password" }),
    ]),
  ],

  installScript: `#!/bin/bash
set -e
INSTALL_DIR="{{INSTALL_PATH}}"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

## Ensure a Java runtime of at least version $1 exists.
## Falls back to a server-local Temurin JRE when apt can't provide it.
ensure_java() {
  local min="$1"
  local have=""
  if command -v java &> /dev/null; then
    have=$(java -version 2>&1 | grep -oP '"\\K[0-9]+' | head -1)
  fi
  if [ -n "$have" ] && [ "$have" -ge "$min" ]; then
    echo "Java $have detected (>= $min required) — OK"
    return 0
  fi
  echo "Java $min+ required (found: \${have:-none}). Installing..."
  if [ "$(id -u)" = "0" ]; then APT=""; else APT="sudo -n"; fi
  $APT apt-get update -qq 2>/dev/null || true
  $APT apt-get install -y -qq "openjdk-\${min}-jre-headless" 2>/dev/null || \\
  $APT apt-get install -y -qq openjdk-21-jre-headless 2>/dev/null || true
  have=""
  if command -v java &> /dev/null; then
    have=$(java -version 2>&1 | grep -oP '"\\K[0-9]+' | head -1)
  fi
  if [ -n "$have" ] && [ "$have" -ge "$min" ]; then
    echo "Java $have installed — OK"
    return 0
  fi
  echo "No suitable Java from apt — downloading Temurin $min JRE (server-local)..."
  local arch="x64"
  [ "$(uname -m)" = "aarch64" ] && arch="aarch64"
  mkdir -p "$INSTALL_DIR/.java"
  curl -fSL --retry 3 -o temurin.tar.gz "https://api.adoptium.net/v3/binary/latest/\${min}/ga/linux/\${arch}/jre/hotspot/normal/eclipse" || {
    echo "ERROR: could not obtain a Java $min runtime" >&2
    exit 1
  }
  tar xf temurin.tar.gz -C "$INSTALL_DIR/.java" --strip-components=1
  rm -f temurin.tar.gz
  ln -sfn "$INSTALL_DIR/.java/bin/java" "$INSTALL_DIR/java"
  echo "Temurin $min installed into $INSTALL_DIR/.java"
}

## Download latest Minecraft server JAR (piston-meta is the current Mojang API)
MANIFEST_URL="https://piston-meta.mojang.com/mc/game/version_manifest_v2.json"
MANIFEST=$(curl -fsSL --retry 3 "$MANIFEST_URL")
LATEST=$(echo "$MANIFEST" | grep -oP '"release"\\s*:\\s*"\\K[^"]+' | head -1)
echo "Latest Minecraft version: $LATEST"
if [ -z "$LATEST" ]; then
  echo "ERROR: could not determine latest Minecraft release" >&2
  exit 1
fi

VERSION_JSON_URL=$(echo "$MANIFEST" | grep -oP '"id":\\s*"'"$LATEST"'".{0,500}?"url":\\s*"\\Khttps?://[^"]+' | head -1)
VERSION_JSON=$(curl -fsSL "$VERSION_JSON_URL")
SERVER_URL=$(echo "$VERSION_JSON" | grep -oP '"server"\\s*:\\s*\\{[^}]*"url"\\s*:\\s*"\\K[^"]+' | head -1)
REQUIRED_JAVA=$(echo "$VERSION_JSON" | grep -oP '"major_version"\\s*:\\s*\\K[0-9]+' | head -1)
REQUIRED_JAVA=\${REQUIRED_JAVA:-21}

ensure_java "$REQUIRED_JAVA"

if [ -z "$SERVER_URL" ]; then
  echo "ERROR: could not resolve server.jar URL for $LATEST" >&2
  exit 1
fi

echo "Downloading Minecraft $LATEST server..."
curl -fSL --retry 3 -o server.jar "$SERVER_URL"

## Sanity-check the jar (must be a zip archive, > 1 MB)
JAR_SIZE=$(stat -c %s server.jar 2>/dev/null || echo 0)
if [ "$JAR_SIZE" -lt 1048576 ] || ! head -c 2 server.jar | grep -q "PK"; then
  echo "ERROR: server.jar looks invalid (size: $JAR_SIZE bytes)" >&2
  rm -f server.jar
  exit 1
fi

## Accept EULA
echo "eula=true" > eula.txt

echo "Minecraft Java server installed successfully"
`,

  startCommand: `cd {{INSTALL_PATH}} && if [ -x ./.java/bin/java ]; then JAVABIN=./.java/bin/java; else JAVABIN=java; fi && exec "$JAVABIN" -Xms{{MIN_RAM}}G -Xmx{{MAX_RAM}}G {{JVM_FLAGS}} -jar server.jar nogui --port {{PORT}}`,
  stopCommand: "stop",
  configFiles: { "server.properties": "server.properties" },
  defaultConfig: {
    __gsm_format: "properties",
    "server-port": "{{PORT}}",
    "server-ip": "{{SERVER_IP}}",
    "motd": "{{MOTD}}",
    "max-players": "{{MAX_PLAYERS}}",
    "gamemode": "{{GAMEMODE}}",
    "force-gamemode": "{{FORCE_GAMEMODE}}",
    "difficulty": "{{DIFFICULTY}}",
    "hardcore": "{{HARDCORE}}",
    "pvp": "{{PVP}}",
    "allow-flight": "{{ALLOW_FLIGHT}}",
    "enable-command-block": "{{ENABLE_COMMAND_BLOCK}}",
    "player-idle-timeout": "{{PLAYER_IDLE_TIMEOUT}}",
    "op-permission-level": "{{OP_PERMISSION_LEVEL}}",
    "function-permission-level": "{{FUNCTION_PERMISSION_LEVEL}}",
    "level-name": "{{LEVEL_NAME}}",
    "level-seed": "{{LEVEL_SEED}}",
    "level-type": "{{LEVEL_TYPE}}",
    "generator-settings": "{{GENERATOR_SETTINGS}}",
    "generate-structures": "{{GENERATE_STRUCTURES}}",
    "max-world-size": "{{MAX_WORLD_SIZE}}",
    "spawn-protection": "{{SPAWN_PROTECTION}}",
    "allow-nether": "{{ALLOW_NETHER}}",
    "spawn-monsters": "{{SPAWN_MONSTERS}}",
    "spawn-animals": "{{SPAWN_ANIMALS}}",
    "spawn-npcs": "{{SPAWN_NPCS}}",
    "view-distance": "{{VIEW_DISTANCE}}",
    "simulation-distance": "{{SIMULATION_DISTANCE}}",
    "max-tick-time": "{{MAX_TICK_TIME}}",
    "entity-broadcast-range-percentage": "{{ENTITY_BROADCAST_RANGE_PERCENTAGE}}",
    "network-compression-threshold": "{{NETWORK_COMPRESSION_THRESHOLD}}",
    "sync-chunk-writes": "{{SYNC_CHUNK_WRITES}}",
    "max-chained-neighbor-updates": "{{MAX_CHAINED_NEIGHBOR_UPDATES}}",
    "online-mode": "{{ONLINE_MODE}}",
    "enforce-secure-profile": "{{ENFORCE_SECURE_PROFILE}}",
    "white-list": "{{WHITE_LIST}}",
    "enforce-whitelist": "{{ENFORCE_WHITELIST}}",
    "prevent-proxy-connections": "{{PREVENT_PROXY_CONNECTIONS}}",
    "hide-online-players": "{{HIDE_ONLINE_PLAYERS}}",
    "broadcast-console-to-ops": "{{BROADCAST_CONSOLE_TO_OPS}}",
    "broadcast-rcon-to-ops": "{{BROADCAST_RCON_TO_OPS}}",
    "enable-status": "{{ENABLE_STATUS}}",
    "rate-limit": "{{RATE_LIMIT}}",
    "enable-query": "{{ENABLE_QUERY}}",
    "query.port": "{{QUERY_PORT}}",
    "resource-pack": "{{RESOURCE_PACK}}",
    "resource-pack-sha1": "{{RESOURCE_PACK_SHA1}}",
    "require-resource-pack": "{{REQUIRE_RESOURCE_PACK}}",
    "enable-rcon": "{{ENABLE_RCON}}",
    "rcon.port": "{{RCON_PORT}}",
    "rcon.password": "{{RCON_PASSWORD}}",
    "enable-jmx-monitoring": "false",
    "use-native-transport": "true",
  },
};
