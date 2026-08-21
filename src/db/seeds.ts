// Game Template Library
// These are NOT automatically installed - admins choose which games to enable
// Each template contains all variables and scripts needed for installation

export interface GameTemplate {
  slug: string;
  name: string;
  engine: string | null;
  defaultPort: number;
  steamAppId: string | null;
  iconEmoji: string;
  supportsIpv6: boolean;
  installScript: string;
  startCommand: string;
  stopCommand: string | null;
  configFiles: Record<string, string>;
  defaultConfig: Record<string, string>;
  category: string;
  description: string;
  estimatedSize: string;
  variables: TemplateVariable[];
  expectedArtifacts?: string[]; // explicit runtime files to verify after install
}

// Unified variable format used by the built-in server templates
export interface TemplateVariable {
  // Core (required)
  name: string;
  description: string;
  env_variable: string;
  default_value: string;
  // Access control
  user_viewable: boolean;
  user_editable: boolean;
  // Validation
  rules: string;
  field_type: "text" | "number" | "password" | "select" | "checkbox" | "hidden";
  // Optional metadata used by the UI
  category?: string;
  subcategory?: string;
  keywords?: string;
  enum_values?: Record<string, string>;
  min_value?: number;
  max_value?: number;
  param_field_name?: string;
}

// Helper to define variables for the built-in template library
function V(
  name: string,
  env_variable: string,
  description: string,
  default_value: string,
  opts?: {
    required?: boolean;
    type?: "string" | "number" | "boolean" | "password" | "select";
    viewable?: boolean;
    editable?: boolean;
    category?: string;
    keywords?: string;
    enum_values?: Record<string, string>;
    min_value?: number;
    max_value?: number;
    param_field_name?: string;
  }
): TemplateVariable {
  const t = opts?.type || "string";
  const req = opts?.required !== false;
  const minMax = opts?.min_value !== undefined && opts?.max_value !== undefined
    ? `|between:${opts.min_value},${opts.max_value}` : "";
  return {
    name,
    description,
    env_variable,
    default_value,
    user_viewable: opts?.viewable !== false,
    user_editable: opts?.editable !== false,
    rules: req
      ? t === "number" ? `required|integer${minMax || "|between:1,65535"}` : t === "boolean" ? "required|boolean" : `required|string|max:256`
      : t === "number" ? `nullable|integer${minMax}` : t === "boolean" ? "nullable|boolean" : t === "password" ? "nullable|string" : "nullable|string|max:256",
    field_type: t === "select" ? "select" : t === "number" ? "number" : t === "boolean" ? "checkbox" : t === "password" ? "password" : "text",
    category: opts?.category,
    keywords: opts?.keywords,
    enum_values: opts?.enum_values,
    min_value: opts?.min_value,
    max_value: opts?.max_value,
    param_field_name: opts?.param_field_name,
  };
}

// Common variables used across many games
const COMMON_VARS: TemplateVariable[] = [
  V("Server Name", "SERVER_NAME", "Display name for your server", "My Server"),
  V("Port", "PORT", "Main server port", "", { type: "number" }),
  V("Max Players", "MAX_PLAYERS", "Maximum concurrent players", "32", { required: false, type: "number" }),
  V("Install Path", "INSTALL_PATH", "Server installation directory", "/opt/gameservers"),
];

const STEAM_VARS: TemplateVariable[] = [
  ...COMMON_VARS,
  V("Steam Query Port", "QUERY_PORT", "Steam query port (usually main port + 1)", "", { required: false, type: "number" }),
];

const RCON_VARS: TemplateVariable[] = [
  V("RCON Password", "RCON_PASSWORD", "Remote console password", "", { required: false, type: "password" }),
];

export const gameTemplates: GameTemplate[] = [
  // ═══════════════════════════════════════════════════════════════
  // MINECRAFT VARIANTS
  // ═══════════════════════════════════════════════════════════════
  {
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
      V("Max RAM (GB)", "MAX_RAM", "Maximum memory allocation", "4", { type: "number" }),
      V("Game Mode", "GAMEMODE", "survival, creative, adventure, spectator", "survival", { required: false }),
      V("Difficulty", "DIFFICULTY", "peaceful, easy, normal, hard", "normal", { required: false }),
      V("Online Mode", "ONLINE_MODE", "Require valid Minecraft accounts", "true", { required: false, type: "boolean" }),
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
  $APT apt-get install -y -qq "openjdk-\${min}-jre-headless" 2>/dev/null || \
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
LATEST=$(echo "$MANIFEST" | grep -oP '"release"\s*:\s*"\K[^"]+' | head -1)
echo "Latest Minecraft version: $LATEST"
if [ -z "$LATEST" ]; then
  echo "ERROR: could not determine latest Minecraft release" >&2
  exit 1
fi

VERSION_JSON_URL=$(echo "$MANIFEST" | grep -oP '"id":\s*"'"$LATEST"'".{0,500}?"url":\s*"\Khttps?://[^"]+' | head -1)
VERSION_JSON=$(curl -fsSL "$VERSION_JSON_URL")
SERVER_URL=$(echo "$VERSION_JSON" | grep -oP '"server"\s*:\s*\{[^}]*"url"\s*:\s*"\K[^"]+' | head -1)
REQUIRED_JAVA=$(echo "$VERSION_JSON" | grep -oP '"major_version"\s*:\s*\K[0-9]+' | head -1)
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
    startCommand: `cd {{INSTALL_PATH}} && if [ -x ./.java/bin/java ]; then JAVABIN=./.java/bin/java; else JAVABIN=java; fi && exec "$JAVABIN" -Xms1G -Xmx{{MAX_RAM}}G -jar server.jar nogui --port {{PORT}}`,
    stopCommand: "stop",
    configFiles: { "server.properties": "server.properties" },
    defaultConfig: {
      "max-players": "{{MAX_PLAYERS}}",
      "motd": "{{SERVER_NAME}}",
      "online-mode": "{{ONLINE_MODE}}",
      "difficulty": "{{DIFFICULTY}}",
      "gamemode": "{{GAMEMODE}}",
    },
  },
  {
    slug: "minecraft-paper",
    name: "Minecraft: Paper",
    engine: "Java (Paper)",
    defaultPort: 25565,
    steamAppId: null,
    iconEmoji: "📄",
    supportsIpv6: true,
    category: "Minecraft",
    description: "High-performance Paper server with plugin support",
    estimatedSize: "~600 MB",
    variables: [
      ...COMMON_VARS,
      V("Max RAM (GB)", "MAX_RAM", "Maximum memory allocation", "4", { type: "number" }),
      V("View Distance", "VIEW_DISTANCE", "Chunk render distance", "10", { required: false, type: "number" }),
    ],
    installScript: `#!/bin/bash
set -e
INSTALL_DIR="{{INSTALL_PATH}}"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

## Ensure a Java runtime of at least version $1 exists (Temurin fallback).
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
  $APT apt-get install -y -qq "openjdk-\${min}-jre-headless" 2>/dev/null || \
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

## Download Paper server — PaperMC "fill" v3 API (the old v2 API was retired)
FILL_API="https://fill.papermc.io/v3/projects/paper"
LATEST_VERSION=$(curl -fsSL --retry 3 "$FILL_API" | grep -oP '"[0-9]+\.[0-9]+(\.[0-9]+)?"' | tr -d '"' | sort -V | tail -1)
if [ -z "$LATEST_VERSION" ]; then
  echo "ERROR: could not determine latest Paper version" >&2
  exit 1
fi

BUILD_JSON=$(curl -fsSL --retry 3 "$FILL_API/versions/$LATEST_VERSION/builds/latest")
LATEST_BUILD=$(echo "$BUILD_JSON" | grep -oP '"id"\s*:\s*\K[0-9]+' | head -1)
DOWNLOAD_URL=$(echo "$BUILD_JSON" | grep -oP '"server:default"\s*:\s*\{.*?"url"\s*:\s*"\Khttps?://[^"]+' | head -1)
EXPECTED_SHA=$(echo "$BUILD_JSON" | grep -oP '"sha256"\s*:\s*"\K[0-9a-f]{64}' | head -1)

## The version metadata declares the minimum Java Paper can run on
REQUIRED_JAVA=$(curl -fsSL "$FILL_API/versions/$LATEST_VERSION" | grep -oP '"minimum"\s*:\s*\K[0-9]+' | head -1)
REQUIRED_JAVA=\${REQUIRED_JAVA:-21}
ensure_java "$REQUIRED_JAVA"

if [ -z "$DOWNLOAD_URL" ]; then
  echo "ERROR: could not resolve Paper download URL" >&2
  exit 1
fi

echo "Downloading Paper $LATEST_VERSION build $LATEST_BUILD..."
curl -fSL --retry 3 -o server.jar "$DOWNLOAD_URL"

## Verify checksum when provided (guards against truncated downloads)
if [ -n "$EXPECTED_SHA" ]; then
  echo "Verifying sha256 ($EXPECTED_SHA)..."
  echo "$EXPECTED_SHA  server.jar" | sha256sum -c - || { echo "ERROR: checksum mismatch" >&2; rm -f server.jar; exit 1; }
fi

## Sanity-check the jar
JAR_SIZE=$(stat -c %s server.jar 2>/dev/null || echo 0)
if [ "$JAR_SIZE" -lt 1048576 ] || ! head -c 2 server.jar | grep -q "PK"; then
  echo "ERROR: server.jar looks invalid (size: $JAR_SIZE bytes)" >&2
  rm -f server.jar
  exit 1
fi

## Accept EULA
echo "eula=true" > eula.txt

## Download default server.properties if missing
if [ ! -f server.properties ]; then
  echo "server-port={{PORT}}" > server.properties
  echo "max-players={{MAX_PLAYERS}}" >> server.properties
fi

echo "Paper server installed successfully"
`,
    startCommand: `cd {{INSTALL_PATH}} && if [ -x ./.java/bin/java ]; then JAVABIN=./.java/bin/java; else JAVABIN=java; fi && exec "$JAVABIN" -Xms1G -Xmx{{MAX_RAM}}G -XX:+UseG1GC -jar server.jar nogui --port {{PORT}}`,
    stopCommand: "stop",
    configFiles: { "server.properties": "server.properties", "paper.yml": "paper.yml" },
    defaultConfig: {
      "max-players": "{{MAX_PLAYERS}}",
      "motd": "{{SERVER_NAME}}",
      "view-distance": "{{VIEW_DISTANCE}}",
    },
  },
  {
    slug: "minecraft-bedrock",
    name: "Minecraft: Bedrock Edition",
    engine: "Bedrock",
    defaultPort: 19132,
    steamAppId: null,
    iconEmoji: "🪨",
    supportsIpv6: true,
    category: "Minecraft",
    description: "Official Bedrock server for cross-platform play",
    estimatedSize: "~300 MB",
    variables: [
      ...COMMON_VARS,
      V("Game Mode", "GAMEMODE", "survival, creative, adventure", "survival", { required: false }),
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
      "server-name": "{{SERVER_NAME}}",
      "max-players": "{{MAX_PLAYERS}}",
      "gamemode": "{{GAMEMODE}}",
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // VALVE / SOURCE ENGINE GAMES
  // ═══════════════════════════════════════════════════════════════
  {
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
      V("GSLT Token", "GSLT_TOKEN", "Game Server Login Token from Steam", ""),
      V("Game Type", "GAME_TYPE", "0=Casual, 1=Competitive", "0", { required: false, type: "number" }),
      V("Game Mode", "GAME_MODE", "0=Casual, 1=Competitive, 2=Wingman", "1", { required: false, type: "number" }),
      V("Map", "MAP", "Starting map", "de_dust2", { required: false }),
    ],
    installScript: `#!/bin/bash
set -e
INSTALL_DIR="{{INSTALL_PATH}}"
STEAM_APPID="730"

## Use system SteamCMD install (shared across servers)
STEAMCMD_BIN="/opt/steamcmd/steamcmd.sh"
if [ ! -x "$STEAMCMD_BIN" ]; then
  echo "SteamCMD is not installed at $STEAMCMD_BIN" >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR/.steam/sdk32" "$INSTALL_DIR/.steam/sdk64"
chown -R $(whoami) "$INSTALL_DIR"
export HOME="$INSTALL_DIR"

## Install game server
echo "Installing Counter-Strike 2 (AppID: $STEAM_APPID)..."
STEAMCMD_ATTEMPT=1
until "$STEAMCMD_BIN" +force_install_dir "$INSTALL_DIR" +login anonymous +app_update $STEAM_APPID validate +quit; do
  STEAMCMD_ATTEMPT=$((STEAMCMD_ATTEMPT + 1))
  if [ "$STEAMCMD_ATTEMPT" -gt 3 ]; then
    echo "ERROR: SteamCMD failed to install AppID $STEAM_APPID after 3 attempts" >&2
    exit 1
  fi
  echo "SteamCMD attempt failed, retrying ($STEAMCMD_ATTEMPT/3)..."
  sleep 10
done

## Set up Steam SDK libraries
cp -v "/opt/steamcmd/linux32/steamclient.so" "$INSTALL_DIR/.steam/sdk32/steamclient.so" 2>/dev/null || true
cp -v "/opt/steamcmd/linux64/steamclient.so" "$INSTALL_DIR/.steam/sdk64/steamclient.so" 2>/dev/null || true

## Source engine cfgs use: cvar "value" — write a valid server.cfg
mkdir -p "$INSTALL_DIR/game/csgo/cfg"
if [ ! -f "$INSTALL_DIR/game/csgo/cfg/server.cfg" ]; then
  cat > "$INSTALL_DIR/game/csgo/cfg/server.cfg" << 'CS2CFG'
hostname "{{SERVER_NAME}}"
rcon_password "{{RCON_PASSWORD}}"
sv_cheats 0
sv_lan 0
CS2CFG
fi

echo "Counter-Strike 2 server installed successfully"`,
    startCommand: `cd {{INSTALL_PATH}} && ./game/bin/linuxsteamrt64/cs2 -dedicated -ip 0.0.0.0 -port {{PORT}} -tv_port {{QUERY_PORT}} +game_type {{GAME_TYPE}} +game_mode {{GAME_MODE}} +map {{MAP}} +hostname "{{SERVER_NAME}}" +sv_setsteamaccount {{GSLT_TOKEN}} +rcon_password "{{RCON_PASSWORD}}"`,
    stopCommand: "quit",
    configFiles: { "game/csgo/cfg/server.cfg": "server.cfg" },
    defaultConfig: {},
  },
  {
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
      V("Map", "MAP", "Starting map", "cp_badlands", { required: false }),
    ],
    installScript: `#!/bin/bash
set -e
INSTALL_DIR="{{INSTALL_PATH}}"
STEAM_APPID="232250"

## Use system SteamCMD install (shared across servers)
STEAMCMD_BIN="/opt/steamcmd/steamcmd.sh"
if [ ! -x "$STEAMCMD_BIN" ]; then
  echo "SteamCMD is not installed at $STEAMCMD_BIN" >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR/.steam/sdk32" "$INSTALL_DIR/.steam/sdk64"
chown -R $(whoami) "$INSTALL_DIR"
export HOME="$INSTALL_DIR"

## Install game server
echo "Installing Team Fortress 2 (AppID: $STEAM_APPID)..."
STEAMCMD_ATTEMPT=1
until "$STEAMCMD_BIN" +force_install_dir "$INSTALL_DIR" +login anonymous +app_update $STEAM_APPID validate +quit; do
  STEAMCMD_ATTEMPT=$((STEAMCMD_ATTEMPT + 1))
  if [ "$STEAMCMD_ATTEMPT" -gt 3 ]; then
    echo "ERROR: SteamCMD failed to install AppID $STEAM_APPID after 3 attempts" >&2
    exit 1
  fi
  echo "SteamCMD attempt failed, retrying ($STEAMCMD_ATTEMPT/3)..."
  sleep 10
done

## Set up Steam SDK libraries
cp -v "/opt/steamcmd/linux32/steamclient.so" "$INSTALL_DIR/.steam/sdk32/steamclient.so" 2>/dev/null || true
cp -v "/opt/steamcmd/linux64/steamclient.so" "$INSTALL_DIR/.steam/sdk64/steamclient.so" 2>/dev/null || true

## Source engine cfgs use: cvar "value" — write a valid server.cfg
mkdir -p "$INSTALL_DIR/tf/cfg"
if [ ! -f "$INSTALL_DIR/tf/cfg/server.cfg" ]; then
  cat > "$INSTALL_DIR/tf/cfg/server.cfg" << 'TF2CFG'
hostname "{{SERVER_NAME}}"
rcon_password "{{RCON_PASSWORD}}"
sv_pure 1
TF2CFG
fi

echo "Team Fortress 2 server installed successfully"`,
    startCommand: `cd {{INSTALL_PATH}} && ./srcds_run -game tf -console -port {{PORT}} +maxplayers {{MAX_PLAYERS}} +map {{MAP}}`,
    stopCommand: "quit",
    configFiles: { "tf/cfg/server.cfg": "server.cfg" },
    defaultConfig: {},
  },
  {
    slug: "gmod",
    name: "Garry's Mod",
    engine: "Source",
    defaultPort: 27015,
    steamAppId: "4020",
    iconEmoji: "🔧",
    supportsIpv6: true,
    category: "Sandbox",
    description: "Physics sandbox with endless possibilities",
    estimatedSize: "~8 GB",
    variables: [
      ...STEAM_VARS,
      ...RCON_VARS,
      V("Game Mode", "GAMEMODE", "sandbox, terrortown, prophunt, etc.", "sandbox", { required: false }),
      V("Map", "MAP", "Starting map", "gm_flatgrass", { required: false }),
      V("Workshop Collection", "WORKSHOP_COLLECTION", "Steam Workshop collection ID", "", { required: false }),
    ],
    installScript: `#!/bin/bash
set -e
INSTALL_DIR="{{INSTALL_PATH}}"
STEAM_APPID="4020"

## Use system SteamCMD install (shared across servers)
STEAMCMD_BIN="/opt/steamcmd/steamcmd.sh"
if [ ! -x "$STEAMCMD_BIN" ]; then
  echo "SteamCMD is not installed at $STEAMCMD_BIN" >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR/.steam/sdk32" "$INSTALL_DIR/.steam/sdk64"
chown -R $(whoami) "$INSTALL_DIR"
export HOME="$INSTALL_DIR"

## Install game server
echo "Installing Garry's Mod (AppID: $STEAM_APPID)..."
STEAMCMD_ATTEMPT=1
until "$STEAMCMD_BIN" +force_install_dir "$INSTALL_DIR" +login anonymous +app_update $STEAM_APPID validate +quit; do
  STEAMCMD_ATTEMPT=$((STEAMCMD_ATTEMPT + 1))
  if [ "$STEAMCMD_ATTEMPT" -gt 3 ]; then
    echo "ERROR: SteamCMD failed to install AppID $STEAM_APPID after 3 attempts" >&2
    exit 1
  fi
  echo "SteamCMD attempt failed, retrying ($STEAMCMD_ATTEMPT/3)..."
  sleep 10
done

## Set up Steam SDK libraries
cp -v "/opt/steamcmd/linux32/steamclient.so" "$INSTALL_DIR/.steam/sdk32/steamclient.so" 2>/dev/null || true
cp -v "/opt/steamcmd/linux64/steamclient.so" "$INSTALL_DIR/.steam/sdk64/steamclient.so" 2>/dev/null || true

## Source engine cfgs use: cvar "value" — write a valid server.cfg
mkdir -p "$INSTALL_DIR/garrysmod/cfg"
if [ ! -f "$INSTALL_DIR/garrysmod/cfg/server.cfg" ]; then
  cat > "$INSTALL_DIR/garrysmod/cfg/server.cfg" << 'GMODCFG'
hostname "{{SERVER_NAME}}"
rcon_password "{{RCON_PASSWORD}}"
sv_defaultgamemode "{{GAMEMODE}}"
GMODCFG
fi

echo "Garry's Mod server installed successfully"`,
    startCommand: `cd {{INSTALL_PATH}} && ./srcds_run -game garrysmod -console -port {{PORT}} +maxplayers {{MAX_PLAYERS}} +map {{MAP}} +gamemode {{GAMEMODE}}`,
    stopCommand: "quit",
    configFiles: { "garrysmod/cfg/server.cfg": "server.cfg" },
    defaultConfig: {},
  },
  {
    slug: "l4d2",
    name: "Left 4 Dead 2",
    engine: "Source",
    defaultPort: 27015,
    steamAppId: "222860",
    iconEmoji: "🧟",
    supportsIpv6: true,
    category: "FPS",
    description: "Co-op zombie survival shooter",
    estimatedSize: "~13 GB",
    variables: [
      ...STEAM_VARS,
      ...RCON_VARS,
      V("Map", "MAP", "Starting campaign", "c1m1_hotel", { required: false }),
    ],
    installScript: `#!/bin/bash
set -e
INSTALL_DIR="{{INSTALL_PATH}}"
STEAM_APPID="222860"

## Use system SteamCMD install (shared across servers)
STEAMCMD_BIN="/opt/steamcmd/steamcmd.sh"
if [ ! -x "$STEAMCMD_BIN" ]; then
  echo "SteamCMD is not installed at $STEAMCMD_BIN" >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR/.steam/sdk32" "$INSTALL_DIR/.steam/sdk64"
chown -R $(whoami) "$INSTALL_DIR"
export HOME="$INSTALL_DIR"

## Install game server
echo "Installing Left 4 Dead 2 (AppID: $STEAM_APPID)..."
STEAMCMD_ATTEMPT=1
until "$STEAMCMD_BIN" +force_install_dir "$INSTALL_DIR" +login anonymous +app_update $STEAM_APPID validate +quit; do
  STEAMCMD_ATTEMPT=$((STEAMCMD_ATTEMPT + 1))
  if [ "$STEAMCMD_ATTEMPT" -gt 3 ]; then
    echo "ERROR: SteamCMD failed to install AppID $STEAM_APPID after 3 attempts" >&2
    exit 1
  fi
  echo "SteamCMD attempt failed, retrying ($STEAMCMD_ATTEMPT/3)..."
  sleep 10
done

## Set up Steam SDK libraries
cp -v "/opt/steamcmd/linux32/steamclient.so" "$INSTALL_DIR/.steam/sdk32/steamclient.so" 2>/dev/null || true
cp -v "/opt/steamcmd/linux64/steamclient.so" "$INSTALL_DIR/.steam/sdk64/steamclient.so" 2>/dev/null || true

## Source engine cfgs use: cvar "value" — write a valid server.cfg
mkdir -p "$INSTALL_DIR/left4dead2/cfg"
if [ ! -f "$INSTALL_DIR/left4dead2/cfg/server.cfg" ]; then
  cat > "$INSTALL_DIR/left4dead2/cfg/server.cfg" << 'L4D2CFG'
hostname "{{SERVER_NAME}}"
rcon_password "{{RCON_PASSWORD}}"
L4D2CFG
fi

echo "Left 4 Dead 2 server installed successfully"`,
    startCommand: `cd {{INSTALL_PATH}} && ./srcds_run -game left4dead2 -console -port {{PORT}} +map {{MAP}}`,
    stopCommand: "quit",
    configFiles: { "left4dead2/cfg/server.cfg": "server.cfg" },
    defaultConfig: {},
  },

  // ═══════════════════════════════════════════════════════════════
  // SURVIVAL GAMES
  // ═══════════════════════════════════════════════════════════════
  {
    slug: "rust",
    name: "Rust",
    engine: "Unity",
    defaultPort: 28015,
    steamAppId: "258550",
    iconEmoji: "🪓",
    supportsIpv6: false,
    category: "Survival",
    description: "Brutal survival with base building and PvP",
    estimatedSize: "~10 GB",
    variables: [
      ...STEAM_VARS,
      ...RCON_VARS,
      V("World Size", "WORLD_SIZE", "Map size (1000-6000)", "3000", { required: false, type: "number" }),
      V("World Seed", "WORLD_SEED", "Map generation seed", "12345", { required: false, type: "number" }),
      V("RCON Port", "RCON_PORT", "RCON port", "28016", { required: false, type: "number" }),
    ],
    installScript: `#!/bin/bash
set -e
INSTALL_DIR="{{INSTALL_PATH}}"
STEAM_APPID="258550"

## Use system SteamCMD install (shared across servers)
STEAMCMD_BIN="/opt/steamcmd/steamcmd.sh"
if [ ! -x "$STEAMCMD_BIN" ]; then
  echo "SteamCMD is not installed at $STEAMCMD_BIN" >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR/.steam/sdk32" "$INSTALL_DIR/.steam/sdk64"
chown -R $(whoami) "$INSTALL_DIR"
export HOME="$INSTALL_DIR"

## Install game server
echo "Installing Rust (AppID: $STEAM_APPID)..."
STEAMCMD_ATTEMPT=1
until "$STEAMCMD_BIN" +force_install_dir "$INSTALL_DIR" +login anonymous +app_update $STEAM_APPID validate +quit; do
  STEAMCMD_ATTEMPT=$((STEAMCMD_ATTEMPT + 1))
  if [ "$STEAMCMD_ATTEMPT" -gt 3 ]; then
    echo "ERROR: SteamCMD failed to install AppID $STEAM_APPID after 3 attempts" >&2
    exit 1
  fi
  echo "SteamCMD attempt failed, retrying ($STEAMCMD_ATTEMPT/3)..."
  sleep 10
done

## Set up Steam SDK libraries
cp -v "/opt/steamcmd/linux32/steamclient.so" "$INSTALL_DIR/.steam/sdk32/steamclient.so" 2>/dev/null || true
cp -v "/opt/steamcmd/linux64/steamclient.so" "$INSTALL_DIR/.steam/sdk64/steamclient.so" 2>/dev/null || true

echo "Rust server installed successfully"`,
    startCommand: `cd {{INSTALL_PATH}} && ./RustDedicated -batchmode +server.port {{PORT}} +server.level "Procedural Map" +server.seed {{WORLD_SEED}} +server.worldsize {{WORLD_SIZE}} +server.maxplayers {{MAX_PLAYERS}} +server.hostname "{{SERVER_NAME}}" +rcon.port {{RCON_PORT}} +rcon.password "{{RCON_PASSWORD}}" +rcon.web 1`,
    stopCommand: "quit",
    configFiles: { "server/serverauto.cfg": "serverauto.cfg" },
    defaultConfig: {},
  },
  {
    slug: "ark",
    name: "ARK: Survival Evolved",
    engine: "Unreal Engine 4",
    defaultPort: 7777,
    steamAppId: "376030",
    iconEmoji: "🦖",
    supportsIpv6: false,
    category: "Survival",
    description: "Dinosaur survival with taming and tribes",
    estimatedSize: "~50 GB",
    variables: [
      ...STEAM_VARS,
      V("Map", "MAP", "TheIsland, Ragnarok, Valguero, etc.", "TheIsland", { required: false }),
      V("Admin Password", "ADMIN_PASSWORD", "Server admin password", "", { type: "password" }),
      V("Server Password", "SERVER_PASSWORD", "Join password (optional)", "", { required: false, type: "password" }),
    ],
    installScript: `#!/bin/bash
set -e
INSTALL_DIR="{{INSTALL_PATH}}"
STEAM_APPID="376030"

## Use system SteamCMD install (shared across servers)
STEAMCMD_BIN="/opt/steamcmd/steamcmd.sh"
if [ ! -x "$STEAMCMD_BIN" ]; then
  echo "SteamCMD is not installed at $STEAMCMD_BIN" >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR/.steam/sdk32" "$INSTALL_DIR/.steam/sdk64"
chown -R $(whoami) "$INSTALL_DIR"
export HOME="$INSTALL_DIR"

## Install game server
echo "Installing ARK: Survival Evolved (AppID: $STEAM_APPID)..."
STEAMCMD_ATTEMPT=1
until "$STEAMCMD_BIN" +force_install_dir "$INSTALL_DIR" +login anonymous +app_update $STEAM_APPID validate +quit; do
  STEAMCMD_ATTEMPT=$((STEAMCMD_ATTEMPT + 1))
  if [ "$STEAMCMD_ATTEMPT" -gt 3 ]; then
    echo "ERROR: SteamCMD failed to install AppID $STEAM_APPID after 3 attempts" >&2
    exit 1
  fi
  echo "SteamCMD attempt failed, retrying ($STEAMCMD_ATTEMPT/3)..."
  sleep 10
done

## Set up Steam SDK libraries
cp -v "/opt/steamcmd/linux32/steamclient.so" "$INSTALL_DIR/.steam/sdk32/steamclient.so" 2>/dev/null || true
cp -v "/opt/steamcmd/linux64/steamclient.so" "$INSTALL_DIR/.steam/sdk64/steamclient.so" 2>/dev/null || true

echo "ARK: Survival Evolved server installed successfully"`,
    startCommand: `cd {{INSTALL_PATH}}/ShooterGame/Binaries/Linux && ./ShooterGameServer {{MAP}}?listen?SessionName={{SERVER_NAME}}?Port={{PORT}}?QueryPort={{QUERY_PORT}}?ServerPassword={{SERVER_PASSWORD}}?ServerAdminPassword={{ADMIN_PASSWORD}}?MaxPlayers={{MAX_PLAYERS}} -server -log`,
    stopCommand: null,
    configFiles: { "ShooterGame/Saved/Config/LinuxServer/GameUserSettings.ini": "GameUserSettings.ini" },
    defaultConfig: {},
  },
  {
    slug: "valheim",
    name: "Valheim",
    engine: "Unity",
    defaultPort: 2456,
    steamAppId: "896660",
    iconEmoji: "⚔️",
    supportsIpv6: false,
    category: "Survival",
    description: "Viking survival and exploration",
    estimatedSize: "~1 GB",
    variables: [
      ...COMMON_VARS,
      V("World Name", "WORLD_NAME", "Name of your world save", "Dedicated"),
      V("Password", "PASSWORD", "Server password (min 5 chars)", "", { type: "password" }),
      V("Public", "PUBLIC", "List on server browser (1=yes, 0=no)", "1", { required: false, type: "number" }),
    ],
    installScript: `#!/bin/bash
set -e
INSTALL_DIR="{{INSTALL_PATH}}"
STEAM_APPID="896660"

## Use system SteamCMD install (shared across servers)
STEAMCMD_BIN="/opt/steamcmd/steamcmd.sh"
if [ ! -x "$STEAMCMD_BIN" ]; then
  echo "SteamCMD is not installed at $STEAMCMD_BIN" >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR/.steam/sdk32" "$INSTALL_DIR/.steam/sdk64"
chown -R $(whoami) "$INSTALL_DIR"
export HOME="$INSTALL_DIR"

## Install game server
echo "Installing Valheim (AppID: $STEAM_APPID)..."
STEAMCMD_ATTEMPT=1
until "$STEAMCMD_BIN" +force_install_dir "$INSTALL_DIR" +login anonymous +app_update $STEAM_APPID validate +quit; do
  STEAMCMD_ATTEMPT=$((STEAMCMD_ATTEMPT + 1))
  if [ "$STEAMCMD_ATTEMPT" -gt 3 ]; then
    echo "ERROR: SteamCMD failed to install AppID $STEAM_APPID after 3 attempts" >&2
    exit 1
  fi
  echo "SteamCMD attempt failed, retrying ($STEAMCMD_ATTEMPT/3)..."
  sleep 10
done

## Set up Steam SDK libraries
cp -v "/opt/steamcmd/linux32/steamclient.so" "$INSTALL_DIR/.steam/sdk32/steamclient.so" 2>/dev/null || true
cp -v "/opt/steamcmd/linux64/steamclient.so" "$INSTALL_DIR/.steam/sdk64/steamclient.so" 2>/dev/null || true

echo "Valheim server installed successfully"`,
    startCommand: `cd {{INSTALL_PATH}} && ./valheim_server.x86_64 -name "{{SERVER_NAME}}" -port {{PORT}} -world "{{WORLD_NAME}}" -password "{{PASSWORD}}" -public {{PUBLIC}}`,
    stopCommand: null,
    configFiles: {},
    defaultConfig: {},
  },
  {
    slug: "7dtd",
    name: "7 Days to Die",
    engine: "Unity",
    defaultPort: 26900,
    steamAppId: "294420",
    iconEmoji: "🧟‍♂️",
    supportsIpv6: false,
    category: "Survival",
    description: "Zombie survival with base building",
    estimatedSize: "~12 GB",
    variables: [
      ...STEAM_VARS,
      V("Game Difficulty", "DIFFICULTY", "0-5 (Scavenger to Insane)", "2", { required: false, type: "number" }),
      V("World Name", "WORLD_NAME", "World save name", "Navezgane", { required: false }),
    ],
    installScript: `#!/bin/bash
set -e
INSTALL_DIR="{{INSTALL_PATH}}"
STEAM_APPID="294420"

## Use system SteamCMD install (shared across servers)
STEAMCMD_BIN="/opt/steamcmd/steamcmd.sh"
if [ ! -x "$STEAMCMD_BIN" ]; then
  echo "SteamCMD is not installed at $STEAMCMD_BIN" >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR/.steam/sdk32" "$INSTALL_DIR/.steam/sdk64"
chown -R $(whoami) "$INSTALL_DIR"
export HOME="$INSTALL_DIR"

## Install game server
echo "Installing 7 Days to Die (AppID: $STEAM_APPID)..."
STEAMCMD_ATTEMPT=1
until "$STEAMCMD_BIN" +force_install_dir "$INSTALL_DIR" +login anonymous +app_update $STEAM_APPID validate +quit; do
  STEAMCMD_ATTEMPT=$((STEAMCMD_ATTEMPT + 1))
  if [ "$STEAMCMD_ATTEMPT" -gt 3 ]; then
    echo "ERROR: SteamCMD failed to install AppID $STEAM_APPID after 3 attempts" >&2
    exit 1
  fi
  echo "SteamCMD attempt failed, retrying ($STEAMCMD_ATTEMPT/3)..."
  sleep 10
done

## Set up Steam SDK libraries
cp -v "/opt/steamcmd/linux32/steamclient.so" "$INSTALL_DIR/.steam/sdk32/steamclient.so" 2>/dev/null || true
cp -v "/opt/steamcmd/linux64/steamclient.so" "$INSTALL_DIR/.steam/sdk64/steamclient.so" 2>/dev/null || true

## The -logfile flag in the start command needs this directory to exist
mkdir -p "$INSTALL_DIR/logs"

echo "7 Days to Die server installed successfully"`,
    startCommand: `cd {{INSTALL_PATH}} && ./7DaysToDieServer.x86_64 -configfile=serverconfig.xml -logfile logs/output_log.txt -quit -batchmode -nographics -dedicated`,
    stopCommand: null,
    configFiles: { "serverconfig.xml": "serverconfig.xml" },
    defaultConfig: {
      ServerName: "{{SERVER_NAME}}",
      ServerMaxPlayerCount: "{{MAX_PLAYERS}}",
      GameDifficulty: "{{DIFFICULTY}}",
      GameWorld: "{{WORLD_NAME}}",
    },
  },
  {
    slug: "palworld",
    name: "Palworld",
    engine: "Unreal Engine 5",
    defaultPort: 8211,
    steamAppId: "2394010",
    iconEmoji: "🦎",
    supportsIpv6: false,
    category: "Survival",
    description: "Creature collecting survival game",
    estimatedSize: "~5 GB",
    variables: [
      ...STEAM_VARS,
      V("Admin Password", "ADMIN_PASSWORD", "Admin password", "", { type: "password" }),
      V("Server Password", "SERVER_PASSWORD", "Join password (optional)", "", { required: false, type: "password" }),
    ],
    installScript: `#!/bin/bash
set -e
INSTALL_DIR="{{INSTALL_PATH}}"
STEAM_APPID="2394010"

## Use system SteamCMD install (shared across servers)
STEAMCMD_BIN="/opt/steamcmd/steamcmd.sh"
if [ ! -x "$STEAMCMD_BIN" ]; then
  echo "SteamCMD is not installed at $STEAMCMD_BIN" >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR/.steam/sdk32" "$INSTALL_DIR/.steam/sdk64"
chown -R $(whoami) "$INSTALL_DIR"
export HOME="$INSTALL_DIR"

## Install game server
echo "Installing Palworld (AppID: $STEAM_APPID)..."
STEAMCMD_ATTEMPT=1
until "$STEAMCMD_BIN" +force_install_dir "$INSTALL_DIR" +login anonymous +app_update $STEAM_APPID validate +quit; do
  STEAMCMD_ATTEMPT=$((STEAMCMD_ATTEMPT + 1))
  if [ "$STEAMCMD_ATTEMPT" -gt 3 ]; then
    echo "ERROR: SteamCMD failed to install AppID $STEAM_APPID after 3 attempts" >&2
    exit 1
  fi
  echo "SteamCMD attempt failed, retrying ($STEAMCMD_ATTEMPT/3)..."
  sleep 10
done

## Set up Steam SDK libraries
cp -v "/opt/steamcmd/linux32/steamclient.so" "$INSTALL_DIR/.steam/sdk32/steamclient.so" 2>/dev/null || true
cp -v "/opt/steamcmd/linux64/steamclient.so" "$INSTALL_DIR/.steam/sdk64/steamclient.so" 2>/dev/null || true

echo "Palworld server installed successfully"`,
    startCommand: `cd {{INSTALL_PATH}} && ./PalServer.sh -port={{PORT}} -players={{MAX_PLAYERS}} -useperfthreads -NoAsyncLoadingThread -UseMultithreadForDS`,
    stopCommand: null,
    configFiles: { "Pal/Saved/Config/LinuxServer/PalWorldSettings.ini": "PalWorldSettings.ini" },
    defaultConfig: {
      ServerName: "{{SERVER_NAME}}",
      AdminPassword: "{{ADMIN_PASSWORD}}",
      ServerPassword: "{{SERVER_PASSWORD}}",
    },
  },
  {
    slug: "satisfactory",
    name: "Satisfactory",
    engine: "Unreal Engine",
    defaultPort: 7777,
    steamAppId: "1690800",
    iconEmoji: "🏭",
    supportsIpv6: false,
    category: "Sandbox",
    description: "Factory building and automation",
    estimatedSize: "~8 GB",
    variables: [
      ...STEAM_VARS,
      V("Beacon Port", "BEACON_PORT", "Beacon port", "15000", { required: false, type: "number" }),
    ],
    installScript: `#!/bin/bash
set -e
INSTALL_DIR="{{INSTALL_PATH}}"
STEAM_APPID="1690800"

## Use system SteamCMD install (shared across servers)
STEAMCMD_BIN="/opt/steamcmd/steamcmd.sh"
if [ ! -x "$STEAMCMD_BIN" ]; then
  echo "SteamCMD is not installed at $STEAMCMD_BIN" >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR/.steam/sdk32" "$INSTALL_DIR/.steam/sdk64"
chown -R $(whoami) "$INSTALL_DIR"
export HOME="$INSTALL_DIR"

## Install game server
echo "Installing Satisfactory (AppID: $STEAM_APPID)..."
STEAMCMD_ATTEMPT=1
until "$STEAMCMD_BIN" +force_install_dir "$INSTALL_DIR" +login anonymous +app_update $STEAM_APPID validate +quit; do
  STEAMCMD_ATTEMPT=$((STEAMCMD_ATTEMPT + 1))
  if [ "$STEAMCMD_ATTEMPT" -gt 3 ]; then
    echo "ERROR: SteamCMD failed to install AppID $STEAM_APPID after 3 attempts" >&2
    exit 1
  fi
  echo "SteamCMD attempt failed, retrying ($STEAMCMD_ATTEMPT/3)..."
  sleep 10
done

## Set up Steam SDK libraries
cp -v "/opt/steamcmd/linux32/steamclient.so" "$INSTALL_DIR/.steam/sdk32/steamclient.so" 2>/dev/null || true
cp -v "/opt/steamcmd/linux64/steamclient.so" "$INSTALL_DIR/.steam/sdk64/steamclient.so" 2>/dev/null || true

echo "Satisfactory server installed successfully"`,
    startCommand: `cd {{INSTALL_PATH}} && ./Engine/Binaries/Linux/*-Linux-Shipping FactoryGame ?listen -Port={{PORT}} -ServerQueryPort={{QUERY_PORT}} -BeaconPort={{BEACON_PORT}} -multihome=0.0.0.0 -log -unattended`,
    stopCommand: null,
    configFiles: { "FactoryGame/Saved/Config/LinuxServer/ServerSettings.ini": "ServerSettings.ini" },
    defaultConfig: {},
  },
  {
    slug: "terraria",
    name: "Terraria (TShock)",
    engine: "Custom (Re-Logic)",
    defaultPort: 7777,
    // Not a SteamCMD install: TShock is fetched from GitHub. Keep null so the
    // built-in updater never tries an anonymous app_update of the client app.
    steamAppId: null,
    iconEmoji: "⛏️",
    supportsIpv6: true,
    category: "Sandbox",
    description: "2D sandbox adventure with TShock mod support",
    estimatedSize: "~500 MB",
    variables: [
      ...COMMON_VARS,
      V("World Name", "WORLD_NAME", "World file name", "world"),
      V("World Size", "WORLD_SIZE", "1=Small, 2=Medium, 3=Large", "3", { required: false, type: "number" }),
      V("Difficulty", "DIFFICULTY", "0=Normal, 1=Expert, 2=Master, 3=Journey", "0", { required: false, type: "number" }),
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
LATEST_URL=$(echo "$RELEASE_JSON" | grep -oP '"browser_download_url"\s*:\s*"\K[^"]+' | grep -- "-$RID-" | head -1)

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

## Create worlds directory
mkdir -p worlds

echo "Terraria/TShock server installed successfully"
`,
    startCommand: `cd {{INSTALL_PATH}} && ./TShock.Server -port {{PORT}} -maxplayers {{MAX_PLAYERS}} -world {{INSTALL_PATH}}/worlds/{{WORLD_NAME}}.wld -autocreate {{WORLD_SIZE}}`,
    stopCommand: null,
    configFiles: { "tshock/config.json": "config.json" },
    defaultConfig: {},
  },
  {
    slug: "enshrouded",
    name: "Enshrouded",
    engine: "Holistic",
    defaultPort: 15636,
    steamAppId: "2278520",
    iconEmoji: "🏰",
    supportsIpv6: false,
    category: "Survival",
    description: "Action RPG survival in a voxel world",
    estimatedSize: "~8 GB",
    variables: [
      ...COMMON_VARS,
      V("Password", "PASSWORD", "Server password", "", { required: false, type: "password" }),
    ],
    installScript: `#!/bin/bash
set -e
INSTALL_DIR="{{INSTALL_PATH}}"
STEAM_APPID="2278520"

## Use system SteamCMD install (shared across servers)
STEAMCMD_BIN="/opt/steamcmd/steamcmd.sh"
if [ ! -x "$STEAMCMD_BIN" ]; then
  echo "SteamCMD is not installed at $STEAMCMD_BIN" >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR/.steam/sdk32" "$INSTALL_DIR/.steam/sdk64"
chown -R $(whoami) "$INSTALL_DIR"
export HOME="$INSTALL_DIR"

## Install game server
echo "Installing Enshrouded (AppID: $STEAM_APPID)..."
STEAMCMD_ATTEMPT=1
until "$STEAMCMD_BIN" +force_install_dir "$INSTALL_DIR" +login anonymous +app_update $STEAM_APPID validate +quit; do
  STEAMCMD_ATTEMPT=$((STEAMCMD_ATTEMPT + 1))
  if [ "$STEAMCMD_ATTEMPT" -gt 3 ]; then
    echo "ERROR: SteamCMD failed to install AppID $STEAM_APPID after 3 attempts" >&2
    exit 1
  fi
  echo "SteamCMD attempt failed, retrying ($STEAMCMD_ATTEMPT/3)..."
  sleep 10
done

## Set up Steam SDK libraries
cp -v "/opt/steamcmd/linux32/steamclient.so" "$INSTALL_DIR/.steam/sdk32/steamclient.so" 2>/dev/null || true
cp -v "/opt/steamcmd/linux64/steamclient.so" "$INSTALL_DIR/.steam/sdk64/steamclient.so" 2>/dev/null || true

echo "Enshrouded server installed successfully"`,
    startCommand: `cd {{INSTALL_PATH}} && ./enshrouded_server -batchmode -nographics`,
    stopCommand: null,
    configFiles: { "enshrouded_server.json": "enshrouded_server.json" },
    defaultConfig: {
      name: "{{SERVER_NAME}}",
      maxPlayers: "{{MAX_PLAYERS}}",
      password: "{{PASSWORD}}",
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // FPS / ACTION GAMES
  // ═══════════════════════════════════════════════════════════════
  {
    slug: "insurgency-sandstorm",
    name: "Insurgency: Sandstorm",
    engine: "Unreal Engine 4",
    defaultPort: 27102,
    steamAppId: "581330",
    iconEmoji: "🎖️",
    supportsIpv6: false,
    category: "FPS",
    description: "Tactical military FPS",
    estimatedSize: "~40 GB",
    variables: [
      ...STEAM_VARS,
      ...RCON_VARS,
      V("Map", "MAP", "Starting map", "Oilfield", { required: false }),
      V("Scenario", "SCENARIO", "Game scenario", "Scenario_Refinery_Checkpoint_Security", { required: false }),
    ],
    installScript: `#!/bin/bash
set -e
INSTALL_DIR="{{INSTALL_PATH}}"
STEAM_APPID="581330"

## Use system SteamCMD install (shared across servers)
STEAMCMD_BIN="/opt/steamcmd/steamcmd.sh"
if [ ! -x "$STEAMCMD_BIN" ]; then
  echo "SteamCMD is not installed at $STEAMCMD_BIN" >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR/.steam/sdk32" "$INSTALL_DIR/.steam/sdk64"
chown -R $(whoami) "$INSTALL_DIR"
export HOME="$INSTALL_DIR"

## Install game server
echo "Installing Insurgency: Sandstorm (AppID: $STEAM_APPID)..."
STEAMCMD_ATTEMPT=1
until "$STEAMCMD_BIN" +force_install_dir "$INSTALL_DIR" +login anonymous +app_update $STEAM_APPID validate +quit; do
  STEAMCMD_ATTEMPT=$((STEAMCMD_ATTEMPT + 1))
  if [ "$STEAMCMD_ATTEMPT" -gt 3 ]; then
    echo "ERROR: SteamCMD failed to install AppID $STEAM_APPID after 3 attempts" >&2
    exit 1
  fi
  echo "SteamCMD attempt failed, retrying ($STEAMCMD_ATTEMPT/3)..."
  sleep 10
done

## Set up Steam SDK libraries
cp -v "/opt/steamcmd/linux32/steamclient.so" "$INSTALL_DIR/.steam/sdk32/steamclient.so" 2>/dev/null || true
cp -v "/opt/steamcmd/linux64/steamclient.so" "$INSTALL_DIR/.steam/sdk64/steamclient.so" 2>/dev/null || true

echo "Insurgency: Sandstorm server installed successfully"`,
    startCommand: `cd {{INSTALL_PATH}} && ./Insurgency/Binaries/Linux/InsurgencyServer-Linux-Shipping {{MAP}}?Scenario={{SCENARIO}}?MaxPlayers={{MAX_PLAYERS}} -Port={{PORT}} -QueryPort={{QUERY_PORT}} -log`,
    stopCommand: null,
    configFiles: { "Insurgency/Saved/Config/LinuxServer/Game.ini": "Game.ini" },
    defaultConfig: {},
  },
  {
    slug: "squad",
    name: "Squad",
    engine: "Unreal Engine 4",
    defaultPort: 7787,
    steamAppId: "403240",
    iconEmoji: "🪖",
    supportsIpv6: false,
    category: "FPS",
    description: "Large-scale tactical combat",
    estimatedSize: "~55 GB",
    variables: [
      ...STEAM_VARS,
      ...RCON_VARS,
    ],
    installScript: `#!/bin/bash
set -e
INSTALL_DIR="{{INSTALL_PATH}}"
STEAM_APPID="403240"

## Use system SteamCMD install (shared across servers)
STEAMCMD_BIN="/opt/steamcmd/steamcmd.sh"
if [ ! -x "$STEAMCMD_BIN" ]; then
  echo "SteamCMD is not installed at $STEAMCMD_BIN" >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR/.steam/sdk32" "$INSTALL_DIR/.steam/sdk64"
chown -R $(whoami) "$INSTALL_DIR"
export HOME="$INSTALL_DIR"

## Install game server
echo "Installing Squad (AppID: $STEAM_APPID)..."
STEAMCMD_ATTEMPT=1
until "$STEAMCMD_BIN" +force_install_dir "$INSTALL_DIR" +login anonymous +app_update $STEAM_APPID validate +quit; do
  STEAMCMD_ATTEMPT=$((STEAMCMD_ATTEMPT + 1))
  if [ "$STEAMCMD_ATTEMPT" -gt 3 ]; then
    echo "ERROR: SteamCMD failed to install AppID $STEAM_APPID after 3 attempts" >&2
    exit 1
  fi
  echo "SteamCMD attempt failed, retrying ($STEAMCMD_ATTEMPT/3)..."
  sleep 10
done

## Set up Steam SDK libraries
cp -v "/opt/steamcmd/linux32/steamclient.so" "$INSTALL_DIR/.steam/sdk32/steamclient.so" 2>/dev/null || true
cp -v "/opt/steamcmd/linux64/steamclient.so" "$INSTALL_DIR/.steam/sdk64/steamclient.so" 2>/dev/null || true

echo "Squad server installed successfully"`,
    startCommand: `cd {{INSTALL_PATH}} && SQ_BIN=$(ls SquadGame/Binaries/Linux/SquadGameServer 2>/dev/null || ls SquadGame/Binaries/Linux/SquadGameServer-Linux-* 2>/dev/null | head -1) && if [ -z "$SQ_BIN" ]; then echo "Squad server binary not found in SquadGame/Binaries/Linux" >&2; exit 1; fi && exec "$SQ_BIN" SquadGame Port={{PORT}} QueryPort={{QUERY_PORT}} -beaconport={{RCON_PORT}} -log`,
    stopCommand: null,
    configFiles: { "SquadGame/ServerConfig/Server.cfg": "Server.cfg" },
    defaultConfig: {},
  },
  {
    slug: "arma3",
    name: "Arma 3",
    engine: "Real Virtuality 4",
    defaultPort: 2302,
    steamAppId: "233780",
    iconEmoji: "🎯",
    supportsIpv6: false,
    category: "FPS",
    description: "Military simulation sandbox",
    estimatedSize: "~35 GB",
    variables: [
      ...STEAM_VARS,
      V("Server Password", "SERVER_PASSWORD", "Join password", "", { required: false, type: "password" }),
      V("Admin Password", "ADMIN_PASSWORD", "Admin password", "", { type: "password" }),
    ],
    installScript: `#!/bin/bash
set -e
INSTALL_DIR="{{INSTALL_PATH}}"
STEAM_APPID="233780"

## Use system SteamCMD install (shared across servers)
STEAMCMD_BIN="/opt/steamcmd/steamcmd.sh"
if [ ! -x "$STEAMCMD_BIN" ]; then
  echo "SteamCMD is not installed at $STEAMCMD_BIN" >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR/.steam/sdk32" "$INSTALL_DIR/.steam/sdk64"
chown -R $(whoami) "$INSTALL_DIR"
export HOME="$INSTALL_DIR"

## Install game server
echo "Installing Arma 3 (AppID: $STEAM_APPID)..."
STEAMCMD_ATTEMPT=1
until "$STEAMCMD_BIN" +force_install_dir "$INSTALL_DIR" +login anonymous +app_update $STEAM_APPID validate +quit; do
  STEAMCMD_ATTEMPT=$((STEAMCMD_ATTEMPT + 1))
  if [ "$STEAMCMD_ATTEMPT" -gt 3 ]; then
    echo "ERROR: SteamCMD failed to install AppID $STEAM_APPID after 3 attempts" >&2
    exit 1
  fi
  echo "SteamCMD attempt failed, retrying ($STEAMCMD_ATTEMPT/3)..."
  sleep 10
done

## Set up Steam SDK libraries
cp -v "/opt/steamcmd/linux32/steamclient.so" "$INSTALL_DIR/.steam/sdk32/steamclient.so" 2>/dev/null || true
cp -v "/opt/steamcmd/linux64/steamclient.so" "$INSTALL_DIR/.steam/sdk64/steamclient.so" 2>/dev/null || true

## Arma configs use C-style class syntax ("key = value;") — write a valid
## server.cfg here; the generated fallback config would not parse otherwise.
mkdir -p "$INSTALL_DIR/profiles"
if [ ! -f "$INSTALL_DIR/server.cfg" ]; then
  cat > "$INSTALL_DIR/server.cfg" << 'ARMACFG'
//
// Arma 3 dedicated server configuration — generated by GameServer Manager
//
hostname = "{{SERVER_NAME}}";
password = "{{SERVER_PASSWORD}}";
passwordAdmin = "{{ADMIN_PASSWORD}}";
maxPlayers = {{MAX_PLAYERS}};

motd[] = {
    "Welcome to {{SERVER_NAME}}",
    "Hosted with GameServer Manager"
};
motdInterval = 5;

persistent = 1;
kickduplicate = 1;
verifySignatures = 2;
allowedFilePatching = 0;
disableVoN = 0;
vonCodecQuality = 30;

voteMissionPlayers = 1;
voteThreshold = 0.33;

timeStampFormat = "short";
logFile = "server_console.log";

onUnsignedData = "kick (_this select 0)";
onHackedData = "kick (_this select 0)";
onDifferentData = "";
ARMACFG
fi

echo "Arma 3 server installed successfully"`,
    startCommand: `cd {{INSTALL_PATH}} && ./arma3server_x64 -port={{PORT}} -config=server.cfg -profiles=profiles`,
    stopCommand: null,
    configFiles: { "server.cfg": "server.cfg" },
    defaultConfig: {},
  },

  // ═══════════════════════════════════════════════════════════════
  // CLASSIC / RETRO
  // ═══════════════════════════════════════════════════════════════
  {
    slug: "wolfenstein-et",
    name: "Wolfenstein: Enemy Territory / ET:Legacy",
    engine: "id Tech 3 (64-bit for legacy mod, 32-bit for third-party mods)",
    defaultPort: 27960,
    steamAppId: null,
    iconEmoji: "🐺",
    supportsIpv6: true,
    category: "Classic",
    description: "Free WWII multiplayer FPS classic — 64-bit ET:Legacy for the legacy mod, 32-bit for third-party mods (Jaymod, ETPub, N!tmod)",
    estimatedSize: "~650 MB",
    variables: [
      ...COMMON_VARS,

      // ── Server Identity ──
      V("Mod", "ET_MOD", "Server mod / fs_game folder to run", "legacy", {
        required: false, type: "select", category: "Server Identity",
        enum_values: {
          "legacy": "ET:Legacy (default, 64-bit)",
          "jaymod": "Jaymod 2.2.0 (32-bit)",
          "etpub": "ETPub 1.0 (32-bit)",
          "nitmod": "N!tmod 2.3.5 (32-bit)",
        },
      }),
      V("Game Type", "GAMETYPE", "g_gametype — which game mode the server runs", "2", {
        required: false, type: "select", category: "Server Identity",
        enum_values: {
          "1": "1 — Single-Map Objective",
          "2": "2 — Objective (map cycle)",
          "3": "3 — Stopwatch",
          "4": "4 — Campaign",
          "5": "5 — Last Man Standing (ET:Legacy)",
          "6": "6 — Map Voting (ET:Legacy)",
        },
      }),
      V("Start Map", "START_MAP", "Map loaded for single-map modes and rotation fallbacks", "oasis", {
        required: false, type: "select", category: "Server Identity",
        enum_values: {
          "oasis": "Oasis", "battery": "Battery", "goldrush": "Gold Rush",
          "radar": "Radar", "railgun": "Railgun", "fueldump": "Fuel Dump",
        },
      }),
      V("2.60 Map Rotation", "MAP_ROTATION", "Optional old-style rotation, e.g.: map oasis; map battery. Leave empty to use the cycle config matching the game type", "", { required: false, category: "Server Identity" }),
      V("MOTD Line 1", "MOTD0", "Join-screen message line 1 (max ~26 chars without color codes)", " ^NET: Legacy ^7MOTD ", { required: false, category: "Server Identity" }),
      V("MOTD Line 2", "MOTD1", "Join-screen message line 2", "", { required: false, category: "Server Identity" }),
      V("MOTD Line 3", "MOTD2", "Join-screen message line 3", "", { required: false, category: "Server Identity" }),
      V("MOTD Line 4", "MOTD3", "Join-screen message line 4", "", { required: false, category: "Server Identity" }),
      V("MOTD Line 5", "MOTD4", "Join-screen message line 5", "", { required: false, category: "Server Identity" }),
      V("MOTD Line 6", "MOTD5", "Join-screen message line 6", "", { required: false, category: "Server Identity" }),

      // ── Clients ──
      V("Private Client Slots", "SV_PRIVATECLIENTS", "Slots reserved for players connecting with the private password (0 = none)", "0", { required: false, type: "number", category: "Clients", min_value: 0, max_value: 64 }),
      V("Private Slots Password", "SV_PRIVATEPASSWORD", "Password clients set to use the reserved private slots", "", { required: false, type: "password", category: "Clients" }),

      // ── Passwords ──
      V("Server Password", "G_PASSWORD", "Server join password (empty = public server)", "", { required: false, type: "password", category: "Passwords" }),
      V("RCON Password", "RCON_PASSWORD", "Remote console (rcon) access password", "", { required: false, type: "password", category: "Passwords" }),
      V("Referee Password", "REFEREE_PASSWORD", "Password that grants referee status", "", { required: false, type: "password", category: "Passwords" }),
      V("Shoutcast Password", "SHOUTCAST_PASSWORD", "Shoutcast spectator status password", "", { required: false, type: "password", category: "Passwords" }),

      // ── Network ──
      V("Advertise Server", "SV_ADVERT", "sv_advert — 0 = off, 1 = send master heartbeats, 3 = also send stats to Trackbase", "3", {
        required: false, type: "select", category: "Network",
        enum_values: { "0": "0 — Off", "1": "1 — Master server only", "3": "3 — Master + Trackbase stats" },
      }),
      V("Client Timeout", "SV_TIMEOUT", "Seconds without a message before a connected client times out (sv_timeout)", "40", { required: false, type: "number", category: "Network", min_value: 10, max_value: 600 }),
      V("Download Timeout", "SV_DL_TIMEOUT", "Seconds without a message before a downloading/preparing client times out (sv_dl_timeout)", "240", { required: false, type: "number", category: "Network", min_value: 30, max_value: 3600 }),
      V("Minimum Ping", "SV_MINPING", "Minimum ping required on connect, 0 = no minimum (sv_minping)", "0", { required: false, type: "number", category: "Network", min_value: 0, max_value: 999 }),
      V("Maximum Ping", "SV_MAXPING", "Maximum ping allowed on connect, 0 = no maximum (sv_maxping)", "0", { required: false, type: "number", category: "Network", min_value: 0, max_value: 999 }),
      V("IPv4 Bind Override", "NET_IP", "Optional IPv4 address to bind (net_ip). Empty = automatic", "", { required: false, category: "Network" }),
      V("IPv6 Bind Override", "NET_IP6", "Optional IPv6 address to bind (net_ip6). Empty = automatic", "", { required: false, category: "Network" }),
      V("IPv6 Port", "NET_PORT6", "IPv6 listen port (net_port6)", "27960", { required: false, type: "number", category: "Network", min_value: 1024, max_value: 65535 }),

      // ── Master Servers ──
      V("Master Server 1", "SV_MASTER1", "sv_master1 — primary master server", "etmaster.idsoftware.com", { required: false, category: "Master Servers" }),
      V("Master Server 2", "SV_MASTER2", "sv_master2", "master0.etmaster.net", { required: false, category: "Master Servers" }),
      V("Master Server 3", "SV_MASTER3", "sv_master3", "master3.idsoftware.com", { required: false, category: "Master Servers" }),
      V("Master Server 4", "SV_MASTER4", "sv_master4", "wolfmaster.idsoftware.com", { required: false, category: "Master Servers" }),
      V("Master Server 5", "SV_MASTER5", "sv_master5", "master3.idsoftware.com:27900", { required: false, category: "Master Servers" }),
      V("Master Server 6", "SV_MASTER6", "sv_master6 — ET:Legacy master", "master.etlegacy.com", { required: false, category: "Master Servers" }),

      // ── Download ──
      V("Max Rate", "SV_MAXRATE", "Per-client bandwidth cap in bytes/sec (sv_maxRate). 10000 standard but poor for ET; 0 = unlimited", "25000", { required: false, type: "number", category: "Download", min_value: 0, max_value: 100000 }),
      V("Download Rate", "SV_DLRATE", "Download bandwidth reserve % — raise/lower with spare bandwidth (sv_dlRate)", "100", { required: false, type: "number", category: "Download", min_value: 0, max_value: 1000 }),
      V("Allow Downloads", "SV_ALLOWDOWNLOAD", "Global toggle for both legacy download and web download (sv_allowDownload)", "1", { required: false, type: "boolean", category: "Download" }),
      V("Enable Web Download", "SV_WWWDOWNLOAD", "Toggle to enable web (HTTP) download (sv_wwwDownload)", "0", { required: false, type: "boolean", category: "Download" }),
      V("Web Download Base URL", "SV_WWWBASEURL", "Base URL clients are redirected to for downloads (sv_wwwBaseURL)", "", { required: false, category: "Download" }),
      V("Download While Disconnected", "SV_WWWDLDISCONNECTED", "Clients perform their downloads while disconnected from the server (sv_wwwDlDisconnected)", "0", { required: false, type: "boolean", category: "Download" }),
      V("Web Download Fallback URL", "SV_WWWFALLBACKURL", "URL sent when an http/ftp download fails or is refused client side (sv_wwwFallbackURL)", "", { required: false, category: "Download" }),

      // ── Logging & Protection ──
      V("Console Logfile", "LOGFILE", "Console logging to etconsole.log: 0 = off, 1 = enabled, 2 = enabled and synchronized (logfile)", "2", { required: false, type: "number", category: "Logging & Protection", min_value: 0, max_value: 3 }),
      V("Pure Server", "SV_PURE", "Hash-check client pk3 files (sv_pure)", "1", { required: false, type: "boolean", category: "Logging & Protection" }),
      V("DDoS Protection", "SV_PROTECT", "1 = ioquake3 getstatus/getchallenge protection, 2 = OpenWolf getstatus/getinfo/getchallenge protection (sv_protect)", "1", {
        required: false, type: "select", category: "Logging & Protection",
        enum_values: { "0": "0 — Off", "1": "1 — ioquake3 DDoS protection", "2": "2 — OpenWolf DRDoS protection" },
      }),
      V("Protection Log File", "SV_PROTECT_LOG", "File for sv_protect and security-related messages (sv_protectLog)", "sv_protect.log", { required: false, category: "Logging & Protection" }),
      V("Flood Protection", "SV_FLOODPROTECT", "Prevent server flooding (sv_floodProtect)", "1", { required: false, type: "boolean", category: "Logging & Protection" }),
      V("Userinfo Flood Protection", "SV_USERINFOFLOODPROTECT", "Prevent userinfo flooding (sv_userInfofloodProtect)", "1", { required: false, type: "boolean", category: "Logging & Protection" }),
      V("Max Clients Per IP", "SV_IPMAXCLIENTS", "Connections allowed per IP, 0 = no maximum (sv_ipMaxClients)", "0", { required: false, type: "number", category: "Logging & Protection", min_value: 0, max_value: 64 }),
      V("PunkBuster", "SV_PUNKBUSTER", "Enable PunkBuster master queries (ET 2.60 clients only; keep off on ET:Legacy)", "0", { required: false, type: "boolean", category: "Logging & Protection" }),

      // ── Mod Logging & Protection ──
      V("Game Log File", "G_LOG", "Game logging file (weapon changes, kills, connects). Empty = disabled (g_log)", "", { required: false, category: "Mod Logging & Protection" }),
      V("Game Log Sync", "G_LOGSYNC", "0 = buffered, 1 = synchronized game logging (g_logSync)", "1", { required: false, type: "boolean", category: "Mod Logging & Protection" }),
      V("GUID Check", "G_GUIDCHECK", "Check GUID validity of connecting players (1 blocks 2.60b clients without PB) (g_guidCheck)", "1", { required: false, type: "boolean", category: "Mod Logging & Protection" }),
      V("Mod Protection", "G_PROTECT", "Mod-side security options (g_protect)", "1", { required: false, type: "boolean", category: "Mod Logging & Protection" }),

      // ── Optimizations ──
      V("Anti-Warp", "G_ANTIWARP", "Compensate for warping players (g_antiwarp)", "1", { required: false, type: "boolean", category: "Optimizations" }),
      V("Max Warp", "G_MAXWARP", "Maximum warp compensation before kicking (g_maxWarp)", "4", { required: false, type: "number", category: "Optimizations", min_value: 0, max_value: 10 }),

      // ── XP Skill Levels ──
      V("Soldier XP Thresholds", "SKILL_SOLDIER", "XP required for soldier levels L2 L3 L4 (skill_soldier)", "20 50 90 140", { required: false, category: "XP Skill Levels" }),
      V("Medic XP Thresholds", "SKILL_MEDIC", "XP required for medic levels L2 L3 L4 (skill_medic)", "20 50 90 140", { required: false, category: "XP Skill Levels" }),
      V("Field Ops XP Thresholds", "SKILL_FIELDOPS", "XP required for field ops levels L2 L3 L4 (skill_fieldops)", "20 50 90 140", { required: false, category: "XP Skill Levels" }),
      V("Engineer XP Thresholds", "SKILL_ENGINEER", "XP required for engineer levels L2 L3 L4 (skill_engineer)", "20 50 90 140", { required: false, category: "XP Skill Levels" }),
      V("Covert Ops XP Thresholds", "SKILL_COVERTOPS", "XP required for covert ops levels L2 L3 L4 (skill_covertops)", "20 50 90 140", { required: false, category: "XP Skill Levels" }),
      V("Battle Sense XP Thresholds", "SKILL_BATTLESENSE", "XP required for battle sense levels L2 L3 L4 (skill_battlesense)", "20 50 90 140", { required: false, category: "XP Skill Levels" }),
      V("Light Weapons XP Thresholds", "SKILL_LIGHTWEAPONS", "XP required for light weapons levels L2 L3 L4 (skill_lightweapons)", "20 50 90 140", { required: false, category: "XP Skill Levels" }),

      // ── Class Limits ──
      V("Max Soldiers / Team", "TEAM_MAXSOLDIERS", "team_maxSoldiers — -1 = unlimited", "-1", { required: false, type: "number", category: "Class Limits", min_value: -1, max_value: 32 }),
      V("Max Medics / Team", "TEAM_MAXMEDICS", "team_maxMedics — -1 = unlimited", "-1", { required: false, type: "number", category: "Class Limits", min_value: -1, max_value: 32 }),
      V("Max Engineers / Team", "TEAM_MAXENGINEERS", "team_maxEngineers — -1 = unlimited", "-1", { required: false, type: "number", category: "Class Limits", min_value: -1, max_value: 32 }),
      V("Max Field Ops / Team", "TEAM_MAXFIELDOPS", "team_maxFieldops — -1 = unlimited", "-1", { required: false, type: "number", category: "Class Limits", min_value: -1, max_value: 32 }),
      V("Max Covert Ops / Team", "TEAM_MAXCOVERTOPS", "team_maxCovertops — -1 = unlimited", "-1", { required: false, type: "number", category: "Class Limits", min_value: -1, max_value: 32 }),

      // ── Weapon Limits ──
      V("Max Mortars / Team", "TEAM_MAXMORTARS", "team_maxMortars — -1 = unlimited", "-1", { required: false, type: "number", category: "Weapon Limits", min_value: -1, max_value: 32 }),
      V("Max Flamethrowers / Team", "TEAM_MAXFLAMERS", "team_maxFlamers — -1 = unlimited", "-1", { required: false, type: "number", category: "Weapon Limits", min_value: -1, max_value: 32 }),
      V("Max Machine Guns / Team", "TEAM_MAXMACHINEGUNS", "team_maxMachineguns — -1 = unlimited", "-1", { required: false, type: "number", category: "Weapon Limits", min_value: -1, max_value: 32 }),
      V("Max Rockets / Team", "TEAM_MAXROCKETS", "team_maxRockets (panzerfaust) — -1 = unlimited", "-1", { required: false, type: "number", category: "Weapon Limits", min_value: -1, max_value: 32 }),
      V("Max Rifle Grenades / Team", "TEAM_MAXRIFLEGRENADES", "team_maxRiflegrenades — -1 = unlimited", "-1", { required: false, type: "number", category: "Weapon Limits", min_value: -1, max_value: 32 }),
      V("Max Airstrikes / Team", "TEAM_MAXAIRSTRIKES", "team_maxAirstrikes — simultaneous airstrikes allowed", "0", { required: false, type: "number", category: "Weapon Limits", min_value: -1, max_value: 32 }),
      V("Max Artillery / Team", "TEAM_MAXARTILLERY", "team_maxArtillery — simultaneous artillery strikes allowed", "0", { required: false, type: "number", category: "Weapon Limits", min_value: -1, max_value: 32 }),
      V("Max Landmines / Team", "TEAM_MAXLANDMINES", "team_maxLandmines", "10", { required: false, type: "number", category: "Weapon Limits", min_value: -1, max_value: 32 }),
      V("Allow Rifle Grenades", "TEAM_RIFLEGRENADES", "Weight if rifle grenades are enabled (team_riflegrenades)", "1", { required: false, type: "boolean", category: "Weapon Limits" }),

      // ── Gameplay ──
      V("Friendly Fire", "G_FRIENDLYFIRE", "Allow team damage (g_friendlyFire)", "1", { required: false, type: "boolean", category: "Gameplay" }),
      V("Anti-Lag", "G_ANTILAG", "Enable server-side lag compensation (g_antilag)", "1", { required: false, type: "boolean", category: "Gameplay" }),
      V("Max Lives", "G_MAXLIVES", "Respawns a player has per match, 0 = unlimited (g_maxlives)", "0", { required: false, type: "number", category: "Gameplay", min_value: 0, max_value: 250 }),
      V("Allied Max Lives", "G_ALLIEDMAXLIVES", "Lives available to the allied team, 0 = unlimited (g_alliedmaxlives)", "0", { required: false, type: "number", category: "Gameplay", min_value: 0, max_value: 250 }),
      V("Axis Max Lives", "G_AXISMAXLIVES", "Lives available to the axis team, 0 = unlimited (g_axismaxlives)", "0", { required: false, type: "number", category: "Gameplay", min_value: 0, max_value: 250 }),
      V("Force Team Balance", "G_TEAMFORCEBALANCE", "Stop players joining a team with more players (g_teamforcebalance)", "1", { required: false, type: "boolean", category: "Gameplay" }),
      V("No Team Switching", "G_NOTEAMSWITCHING", "Disallow switching teams mid-match (g_noTeamSwitching)", "0", { required: false, type: "boolean", category: "Gameplay" }),
      V("Max Players / Team", "TEAM_MAXPLAYERS", "Maximum players per team, 0 = unlimited (team_maxplayers)", "0", { required: false, type: "number", category: "Gameplay", min_value: 0, max_value: 64 }),
      V("No Team Controls", "TEAM_NOCONTROLS", "Disallow players having team controls (team_nocontrols)", "1", { required: false, type: "boolean", category: "Gameplay" }),
      V("Min Game Clients", "G_MINGAMECLIENTS", "Minimum players needed to start a match (g_minGameClients)", "8", { required: false, type: "number", category: "Gameplay", min_value: 0, max_value: 64 }),
      V("Heavy Weapon Restriction %", "G_HEAVYWEAPONRESTRICTION", "Percent of a team that may hold heavy weapons, 100 = unrestricted (g_heavyWeaponRestriction)", "100", { required: false, type: "number", category: "Gameplay", min_value: 0, max_value: 100 }),
      V("Drop Ammo", "G_DROPAMMO", "Ammo packs dropped on field ops death (g_dropAmmo)", "2", { required: false, type: "number", category: "Gameplay", min_value: 0, max_value: 10 }),
      V("Drop Health", "G_DROPHEALTH", "Health packs dropped on medic death (g_dropHealth)", "2", { required: false, type: "number", category: "Gameplay", min_value: 0, max_value: 10 }),
      V("Shove Distance", "G_SHOVE", "Shove push force (g_shove)", "60", { required: false, type: "number", category: "Gameplay", min_value: 0, max_value: 500 }),
      V("Fast Respawn", "G_FASTRES", "Instantly active player after medic revive (g_fastres)", "0", { required: false, type: "boolean", category: "Gameplay" }),
      V("Alt Stopwatch Mode", "G_ALTSTOPWATCHMODE", "ABAB stopwatch team format (g_altStopwatchMode)", "0", { required: false, type: "boolean", category: "Gameplay" }),
      V("Auto Fireteams", "G_AUTOFIRETEAMS", "Automatically put team players into fireteams (g_autofireteams)", "1", { required: false, type: "boolean", category: "Gameplay" }),
      V("Voice Chats Allowed", "G_VOICECHATSALLOWED", "VSays a player may use in 30 seconds (g_voiceChatsAllowed)", "5", { required: false, type: "number", category: "Gameplay", min_value: 0, max_value: 100 }),
      V("Do Warmup", "G_DOWARMUP", "Players have a warm up period (g_doWarmup)", "0", { required: false, type: "boolean", category: "Gameplay" }),
      V("Warmup Time (s)", "G_WARMUP", "Warm up time in seconds (g_warmup)", "10", { required: false, type: "number", category: "Gameplay", min_value: 0, max_value: 600 }),
      V("Intermission Time (s)", "G_INTERMISSIONTIME", "Intermission time in seconds (g_intermissionTime)", "30", { required: false, type: "number", category: "Gameplay", min_value: 0, max_value: 300 }),
      V("Intermission Ready %", "G_INTERMISSIONREADYPERCENT", "% of players ready to start the next map (g_intermissionReadyPercent)", "60", { required: false, type: "number", category: "Gameplay", min_value: 0, max_value: 100 }),
      V("Spectator Inactivity (s)", "G_SPECTATORINACTIVITY", "Seconds before inactive spectators are kicked, 0 = never (g_spectatorInactivity)", "0", { required: false, type: "number", category: "Gameplay", min_value: 0, max_value: 3600 }),
      V("Country Flags", "G_COUNTRYFLAGS", "Show player country flags (g_countryflags)", "1", { required: false, type: "boolean", category: "Gameplay" }),
      V("Skill Rating", "G_SKILLRATING", "Skill rating system (g_skillRating)", "2", { required: false, type: "number", category: "Gameplay", min_value: 0, max_value: 2 }),
      V("Misc Flags", "G_MISC", "Misc bit-flagged options (g_misc)", "0", { required: false, type: "number", category: "Gameplay", min_value: 0, max_value: 1023 }),
      V("Complaint Limit", "G_COMPLAINTLIMIT", "Complaints needed to kick a player (g_complaintlimit)", "6", { required: false, type: "number", category: "Gameplay", min_value: 0, max_value: 32 }),
      V("Disable Complaints", "G_DISABLECOMPLAINTS", "Disable complaints for airstrike/artillery/mortar/landmine team kills (g_disableComplaints)", "1", { required: false, type: "boolean", category: "Gameplay" }),
      V("IP Complaint Limit", "G_IPCOMPLAINTLIMIT", "Different player complaints needed to kick (g_ipcomplaintlimit)", "3", { required: false, type: "number", category: "Gameplay", min_value: 0, max_value: 32 }),
      V("Fixed Physics", "PMOVE_FIXED", "Frame rate independent physics (pmove_fixed)", "0", { required: false, type: "boolean", category: "Gameplay" }),
      V("Physics Step (ms)", "PMOVE_MSEC", "Emulated frame rate dependent physics, 8 = 125 FPS (pmove_msec)", "8", { required: false, type: "number", category: "Gameplay", min_value: 8, max_value: 33 }),
      V("Map Script Directory", "G_MAPSCRIPTDIRECTORY", "Directory for per-map scripts (g_mapScriptDirectory)", "mapscripts", { required: false, category: "Gameplay" }),
      V("Campaign File", "G_CAMPAIGNFILE", "Campaign definition file (g_campaignFile)", "", { required: false, category: "Gameplay" }),
      V("Custom Config", "G_CUSTOMCONFIG", "Custom config file to exec (g_customConfig)", "", { required: false, category: "Gameplay" }),

      // ── Match ──
      V("Allow Late Join", "MATCH_LATEJOIN", "Players may join a match already begun (match_latejoin)", "1", { required: false, type: "boolean", category: "Match" }),
      V("Match Min Players", "MATCH_MINPLAYERS", "Minimum players needed to start a match (match_minplayers)", "4", { required: false, type: "number", category: "Match", min_value: 0, max_value: 64 }),
      V("Mute Spectators", "MATCH_MUTESPECS", "Spectators are muted (match_mutespecs)", "0", { required: false, type: "boolean", category: "Match" }),
      V("Match Ready %", "MATCH_READYPERCENT", "% of players ready to start the match (match_readypercent)", "100", { required: false, type: "number", category: "Match", min_value: 1, max_value: 100 }),
      V("Timeout Count", "MATCH_TIMEOUTCOUNT", "Number of timeouts allowed (match_timeoutcount)", "0", { required: false, type: "number", category: "Match", min_value: 0, max_value: 10 }),
      V("Warmup Damage", "MATCH_WARMUPDAMAGE", "0 = off, 1 = enemy only, 2 = everybody (match_warmupDamage)", "1", {
        required: false, type: "select", category: "Match",
        enum_values: { "0": "0 — Off", "1": "1 — Enemy only", "2": "2 — Everybody" },
      }),

      // ── LMS ──
      V("LMS Force Team Balance", "G_LMS_TEAMFORCEBALANCE", "Force team balance in LMS (g_lms_teamForceBalance)", "1", { required: false, type: "boolean", category: "LMS" }),
      V("LMS Round Limit", "G_LMS_ROUNDLIMIT", "Rounds per match (g_lms_roundlimit)", "3", { required: false, type: "number", category: "LMS", min_value: 1, max_value: 99 }),
      V("LMS Match Limit", "G_LMS_MATCHLIMIT", "Matches (g_lms_matchlimit)", "2", { required: false, type: "number", category: "LMS", min_value: 1, max_value: 99 }),
      V("LMS Lock Teams", "G_LMS_LOCKTEAMS", "Lock teams during an LMS round (g_lms_lockTeams)", "0", { required: false, type: "boolean", category: "LMS" }),
      V("LMS Follow Team Only", "G_LMS_FOLLOWTEAMONLY", "Players can only spectate teammates in LMS (g_lms_followTeamOnly)", "1", { required: false, type: "boolean", category: "LMS" }),

      // ── Voting ──
      V("Enable Voting", "G_ALLOWVOTE", "Enable the voting system (g_allowVote)", "1", { required: false, type: "boolean", category: "Voting" }),
      V("Vote Pass %", "VOTE_PERCENT", "% of Yes votes required to pass (vote_percent)", "50", { required: false, type: "number", category: "Voting", min_value: 1, max_value: 100 }),
      V("Vote Limit", "VOTE_LIMIT", "Votes a player may call per map (vote_limit)", "5", { required: false, type: "number", category: "Voting", min_value: 0, max_value: 99 }),
      V("Vote: Config Change", "VOTE_ALLOW_CONFIG", "Allow config changing by vote (vote_allow_config)", "1", { required: false, type: "boolean", category: "Voting" }),
      V("Vote: Game Type", "VOTE_ALLOW_GAMETYPE", "Allow gametype changing by vote (vote_allow_gametype)", "1", { required: false, type: "boolean", category: "Voting" }),
      V("Vote: Kick", "VOTE_ALLOW_KICK", "Allow kick votes (vote_allow_kick)", "1", { required: false, type: "boolean", category: "Voting" }),
      V("Vote: Change Map", "VOTE_ALLOW_MAP", "Allow map changing by vote (vote_allow_map)", "1", { required: false, type: "boolean", category: "Voting" }),
      V("Vote: Map Restart", "VOTE_ALLOW_MAPRESTART", "Allow match restart by vote (vote_allow_maprestart)", "1", { required: false, type: "boolean", category: "Voting" }),
      V("Vote: Match Reset", "VOTE_ALLOW_MATCHRESET", "Allow match reset by vote (vote_allow_matchreset)", "1", { required: false, type: "boolean", category: "Voting" }),
      V("Vote: Mute Specs", "VOTE_ALLOW_MUTESPECS", "Allow spectators mute by vote (vote_allow_mutespecs)", "1", { required: false, type: "boolean", category: "Voting" }),
      V("Vote: Next Map", "VOTE_ALLOW_NEXTMAP", "Allow changing to next map by vote (vote_allow_nextmap)", "1", { required: false, type: "boolean", category: "Voting" }),
      V("Vote: Referee", "VOTE_ALLOW_REFEREE", "Allow getting referee status by vote (vote_allow_referee)", "0", { required: false, type: "boolean", category: "Voting" }),
      V("Vote: Shuffle Teams", "VOTE_ALLOW_SHUFFLETEAMS", "Allow team shuffling by vote (vote_allow_shuffleteams)", "1", { required: false, type: "boolean", category: "Voting" }),
      V("Vote: Shuffle (No Restart)", "VOTE_ALLOW_SHUFFLETEAMS_NORESTART", "Allow team shuffling without restart by vote (vote_allow_shuffleteams_norestart)", "1", { required: false, type: "boolean", category: "Voting" }),
      V("Vote: Swap Teams", "VOTE_ALLOW_SWAPTEAMS", "Allow team swapping by vote (vote_allow_swapteams)", "1", { required: false, type: "boolean", category: "Voting" }),
      V("Vote: Friendly Fire", "VOTE_ALLOW_FRIENDLYFIRE", "Allow friendly fire toggling by vote (vote_allow_friendlyfire)", "1", { required: false, type: "boolean", category: "Voting" }),
      V("Vote: Time Limit", "VOTE_ALLOW_TIMELIMIT", "Allow map time limit changes by vote (vote_allow_timelimit)", "0", { required: false, type: "boolean", category: "Voting" }),
      V("Vote: Warmup Damage", "VOTE_ALLOW_WARMUPDAMAGE", "Allow warmup damage toggling by vote (vote_allow_warmupdamage)", "1", { required: false, type: "boolean", category: "Voting" }),
      V("Vote: Anti-Lag", "VOTE_ALLOW_ANTILAG", "Allow toggling anti-lag by vote (vote_allow_antilag)", "1", { required: false, type: "boolean", category: "Voting" }),
      V("Vote: Balanced Teams", "VOTE_ALLOW_BALANCEDTEAMS", "Allow toggling balanced teams by vote (vote_allow_balancedteams)", "1", { required: false, type: "boolean", category: "Voting" }),
      V("Vote: Muting", "VOTE_ALLOW_MUTING", "Allow player muting by vote (vote_allow_muting)", "1", { required: false, type: "boolean", category: "Voting" }),
      V("Vote: Surrender", "VOTE_ALLOW_SURRENDER", "Allow surrender by vote (vote_allow_surrender)", "1", { required: false, type: "boolean", category: "Voting" }),
      V("Vote: Restart Campaign", "VOTE_ALLOW_RESTARTCAMPAIGN", "Allow restart campaign by vote (vote_allow_restartcampaign)", "1", { required: false, type: "boolean", category: "Voting" }),
      V("Vote: Next Campaign", "VOTE_ALLOW_NEXTCAMPAIGN", "Allow next campaign by vote (vote_allow_nextcampaign)", "1", { required: false, type: "boolean", category: "Voting" }),
      V("Vote: Poll", "VOTE_ALLOW_POLL", "Allow free polls by vote (vote_allow_poll)", "1", { required: false, type: "boolean", category: "Voting" }),
      V("Vote: Coin Toss", "VOTE_ALLOW_COINTOSS", "Allow coin toss by vote (vote_allow_cointoss)", "1", { required: false, type: "boolean", category: "Voting" }),

      // ── Map Voting ──
      V("Excluded Maps", "G_EXCLUDEDMAPS", "Space-separated map names excluded from map voting, e.g.: railgun (g_excludedMaps)", "", { required: false, category: "Map Voting" }),
      V("Max Maps Voted", "G_MAXMAPSVOTEDFOR", "Maximum maps a player may vote for (g_maxMapsVotedFor)", "6", { required: false, type: "number", category: "Map Voting", min_value: 1, max_value: 64 }),
      V("Map Vote Flags", "G_MAPVOTEFLAGS", "Bit flags for the map voting menu (g_mapVoteFlags)", "0", { required: false, type: "number", category: "Map Voting", min_value: 0, max_value: 31 }),
      V("Minimum Map Age", "G_MINMAPAGE", "Maps played before a map can be voted again (g_minMapAge)", "3", { required: false, type: "number", category: "Map Voting", min_value: 0, max_value: 99 }),

      // ── Lua ──
      V("Lua Modules", "LUA_MODULES", "Space-separated lua modules to load in order (lua_modules)", "luascripts/wolfadmin/main.lua", { required: false, category: "Lua" }),
      V("Lua Allowed Modules", "LUA_ALLOWEDMODULES", "If set, only modules with matching sha1 signatures may load (lua_allowedModules)", "", { required: false, category: "Lua" }),

      // ── Omni-Bot ──
      V("Enable Omni-Bot", "OMNIBOT_ENABLE", "Load Omni-bot for bot players, framework must exist in the mod folder (omnibot_enable)", "1", { required: false, type: "boolean", category: "Omni-Bot" }),
      V("Omni-Bot Path", "OMNIBOT_PATH", "Path to the Omni-bot library, relative or absolute (omnibot_path)", "./legacy/omni-bot", { required: false, category: "Omni-Bot" }),
      V("Omni-Bot Flags", "OMNIBOT_FLAGS", "Omni-bot behaviour flags (omnibot_flags)", "0", { required: false, type: "number", category: "Omni-Bot", min_value: 0, max_value: 2147483647 }),

      // ── Watchdog ──
      V("Watchdog Timer (s)", "COM_WATCHDOG", "Seconds without a live map before the watchdog action fires (com_watchdog)", "60", { required: false, type: "number", category: "Watchdog", min_value: 0, max_value: 3600 }),
      V("Watchdog Command", "COM_WATCHDOG_CMD", "Command executed by the watchdog (com_watchdog_cmd)", "exec server.cfg", { required: false, category: "Watchdog" }),
    ],
    installScript: `#!/bin/bash
# ── ET:Legacy Installer ──────────────────────────────────────
# Architecture selection:
#   - "legacy" mod  → 64-bit (x86_64) ET:Legacy binary
#   - Other mods (Jaymod, ETPub, N!tmod) → 32-bit (i386) binary
#     because those mods only ship 32-bit .so modules.
set -e
INSTALL_DIR="{{INSTALL_PATH}}"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

ET_MOD="{{ET_MOD}}"
if [ -z "$ET_MOD" ]; then ET_MOD="legacy"; fi

ARCH=$(uname -m)
echo "Host architecture: $ARCH"
echo "Selected mod: $ET_MOD"

# ── Determine which binary architecture to use ───────────────
if [ "$ET_MOD" = "legacy" ]; then
  USE_ARCH="x86_64"
  # File/715 = x86_64 archive from https://www.etlegacy.com/download
  ETL_URL="https://www.etlegacy.com/download/file/715"
  echo "→ Using x86_64 (64-bit) ET:Legacy for the legacy mod"
else
  USE_ARCH="i386"
  # File/716 = i386 archive from https://www.etlegacy.com/download
  ETL_URL="https://www.etlegacy.com/download/file/716"
  echo "→ Using i386 (32-bit) ET:Legacy for third-party mod compatibility"
fi

# ── Step 1: Download ET:Legacy archive ───────────────────────
echo "Downloading ET:Legacy $USE_ARCH archive..."
curl -fL -o etlegacy-archive "$ETL_URL" || {
  echo "ERROR: Failed to download ET:Legacy $USE_ARCH archive"
  echo "URL: $ETL_URL"
  exit 1
}

# Upstream serves Linux archives as ZIP files (not tar.gz)
echo "Extracting ET:Legacy $USE_ARCH archive..."
if unzip -o etlegacy-archive >/dev/null 2>&1; then
  echo "  Extracted as ZIP archive"
elif tar xzf etlegacy-archive --strip-components=1 >/dev/null 2>&1; then
  echo "  Extracted as tar.gz (stripped)"
elif tar xzf etlegacy-archive >/dev/null 2>&1; then
  echo "  Extracted as tar.gz"
else
  echo "ERROR: Failed to extract archive"
  ls -la
  exit 1
fi
rm -f etlegacy-archive

# Flatten common extracted directory layouts
for d in etlegacy-* ETLegacy-*; do
  if [ -d "$d" ]; then
    cp -r "$d"/* . 2>/dev/null || true
    rm -rf "$d"
  fi
done

# ── Step 2: Download base game assets ────────────────────────
echo "Downloading base game assets (pak files)..."
mkdir -p etmain
for pak in pak0.pk3 pak1.pk3 pak2.pk3; do
  if [ ! -f "etmain/$pak" ]; then
    echo "  Downloading $pak ..."
    curl -fL -o "etmain/$pak" "https://mirror.etlegacy.com/etmain/$pak" || {
      echo "  WARNING: Could not download $pak — some maps may be missing"
    }
  fi
done

# ── Step 3: Download Legacy mod pack (game modules) ──────────
# The legacy mod modules go into the legacy/ folder (not etmain/).
# File/727 = "All supported archive" — contains .so files for
# the legacy mod (qagame, cgame, ui modules).
echo "Downloading ET:Legacy mod pack (game modules)..."
mkdir -p legacy
if [ "$USE_ARCH" = "x86_64" ]; then
  SO_PATTERN="x86_64"
else
  SO_PATTERN="i386"
fi
if [ ! -f "legacy/qagame.mp.$SO_PATTERN.so" ]; then
  curl -fL -o legacy-mod.zip "https://www.etlegacy.com/download/file/727" || {
    echo "  WARNING: Mod pack download failed — server may not start with legacy mod"
  }
  if [ -f legacy-mod.zip ]; then
    unzip -o legacy-mod.zip -d . 2>/dev/null || true
    rm -f legacy-mod.zip
    # Find and copy .so files matching our architecture into legacy/
    for d in legacy etlegacy-mod etmain .; do
      if [ -d "$d" ]; then
        find "$d" \\( -name "qagame*.$SO_PATTERN.so" -o -name "cgame*.$SO_PATTERN.so" -o -name "ui*.$SO_PATTERN.so" \\) 2>/dev/null | \\
          while read -r f; do cp -v "$f" legacy/ 2>/dev/null || true; done
      fi
    done
    # Also copy any .pk3 files into legacy/
    find . -maxdepth 2 -name "legacy*.pk3" -o -name "etl_bin*.pk3" 2>/dev/null | \\
      while read -r f; do cp -v "$f" legacy/ 2>/dev/null || true; done
  fi
fi


# ── Step 4: Install selected mod ─────────────────────────────
echo ""
echo "═══ Installing mod: $ET_MOD ═══"

install_jaymod() {
  echo "Downloading Jaymod 2.2.0 (32-bit)..."
  mkdir -p jaymod
  local jm_urls=(
    "https://github.com/etlegacy/etlegacy-mods/releases/download/jaymod-2.2.0/jaymod-2.2.0-linux-i386.zip"
    "https://mirror.etlegacy.com/mods/jaymod-2.2.0.zip"
    "https://jaymod.clanfu.org/jaymod-2.2.0.tar.gz"
  )
  local downloaded=0
  for url in "\${jm_urls[@]}"; do
    echo "  Trying: \$url"
    if curl -fL --connect-timeout 10 -o jaymod-dl "\$url" 2>/dev/null; then
      echo "  Downloaded from: \$url"
      downloaded=1
      break
    fi
  done
  if [ "\$downloaded" = "0" ]; then
    echo "  WARNING: Could not download Jaymod — install manually into jaymod/"
    return
  fi
  # Extract — try unzip first, then tar
  if unzip -o jaymod-dl -d jaymod 2>/dev/null; then
    :
  elif tar xzf jaymod-dl -C jaymod 2>/dev/null; then
    :
  fi
  rm -f jaymod-dl
  # Copy .so (32-bit), .pk3, .cfg from subdirectories
  find jaymod -name "*.i386.so" -o -name "*.so" 2>/dev/null | while read -r f; do cp -v "\$f" jaymod/ 2>/dev/null || true; done
  find jaymod -name "*.pk3" 2>/dev/null | while read -r f; do cp -v "\$f" jaymod/ 2>/dev/null || true; done
  echo "  Jaymod (32-bit) installed to jaymod/"
}

install_etpub() {
  echo "Downloading ETPub 1.0 (32-bit)..."
  mkdir -p etpub
  local ep_urls=(
    "https://github.com/etlegacy/etlegacy-mods/releases/download/etpub-1.0/etpub-1.0-linux-i386.zip"
    "https://mirror.etlegacy.com/mods/etpub-1.0.zip"
  )
  local downloaded=0
  for url in "\${ep_urls[@]}"; do
    echo "  Trying: \$url"
    if curl -fL --connect-timeout 10 -o etpub-dl "\$url" 2>/dev/null; then
      echo "  Downloaded from: \$url"
      downloaded=1
      break
    fi
  done
  if [ "\$downloaded" = "0" ]; then
    echo "  WARNING: Could not download ETPub — install manually into etpub/"
    return
  fi
  unzip -o etpub-dl -d etpub 2>/dev/null || true
  rm -f etpub-dl
  find etpub -name "*.i386.so" -o -name "*.so" 2>/dev/null | while read -r f; do cp -v "\$f" etpub/ 2>/dev/null || true; done
  find etpub -name "*.pk3" 2>/dev/null | while read -r f; do cp -v "\$f" etpub/ 2>/dev/null || true; done
  echo "  ETPub (32-bit) installed to etpub/"
}

install_nitmod() {
  echo "Downloading N!tmod 2.3.5 (32-bit)..."
  mkdir -p nitmod
  local nt_urls=(
    "https://github.com/etlegacy/etlegacy-mods/releases/download/nitmod-2.3.5/nitmod-2.3.5-linux-i386.zip"
    "https://mirror.etlegacy.com/mods/nitmod_2.3.5.zip"
    "http://etmods.net/downloads/nitmod_2.3.5.zip"
  )
  local downloaded=0
  for url in "\${nt_urls[@]}"; do
    echo "  Trying: \$url"
    if curl -fL --connect-timeout 10 -o nitmod-dl "\$url" 2>/dev/null; then
      echo "  Downloaded from: \$url"
      downloaded=1
      break
    fi
  done
  if [ "\$downloaded" = "0" ]; then
    echo "  WARNING: Could not download N!tmod — install manually into nitmod/"
    return
  fi
  unzip -o nitmod-dl -d nitmod 2>/dev/null || true
  rm -f nitmod-dl
  find nitmod -name "*.i386.so" -o -name "*.so" 2>/dev/null | while read -r f; do cp -v "\$f" nitmod/ 2>/dev/null || true; done
  find nitmod -name "*.pk3" 2>/dev/null | while read -r f; do cp -v "\$f" nitmod/ 2>/dev/null || true; done
  echo "  N!tmod (32-bit) installed to nitmod/"
}

case "\$ET_MOD" in
  jaymod) install_jaymod ;;
  etpub)  install_etpub ;;
  nitmod) install_nitmod ;;
  legacy) echo "  Using legacy mod with 64-bit ET:Legacy" ;;
  *)      echo "  Unknown mod '\$ET_MOD' — defaulting to legacy" ; ET_MOD="legacy" ;;
esac

# ── Step 5: Create server.cfg ────────────────────────────────
# The legacy mod uses fs_game "legacy", third-party mods use their own dir
MOD_DIR="\${ET_MOD}"
mkdir -p "$MOD_DIR"

# Rotation directive follows the selected game type:
#   1 = single map  2/3 = objective cycle  4 = campaign  5 = LMS  6 = map voting
GAMETYPE_PICK="\${GAMETYPE:-2}"
case "$GAMETYPE_PICK" in
  1) ROTATION="map \${START_MAP:-oasis}" ;;
  4) ROTATION="exec campaigncycle.cfg" ;;
  5) ROTATION="exec lmscycle.cfg" ;;
  6) ROTATION="exec mapvotecycle.cfg" ;;
  *) ROTATION="exec objectivecycle.cfg" ;;
esac

if [ ! -f "$MOD_DIR/server.cfg" ]; then
  cat > "$MOD_DIR/server.cfg" << 'MODCFG'
///////////////////////////////////////////////////////////////////////////////
// Wolfenstein: Enemy Territory — Server Config
// Generated by GameServer Manager from the install wizard.
// Every cvar below was set during installation — edit freely.
///////////////////////////////////////////////////////////////////////////////

// HOSTNAME & MOTD
set sv_hostname "{{SERVER_NAME}}"
set server_motd0 "{{MOTD0}}"
set server_motd1 "{{MOTD1}}"
set server_motd2 "{{MOTD2}}"
set server_motd3 "{{MOTD3}}"
set server_motd4 "{{MOTD4}}"
set server_motd5 "{{MOTD5}}"

// CLIENTS
set sv_maxclients "{{MAX_PLAYERS}}"
set sv_privateclients "{{SV_PRIVATECLIENTS}}"
set sv_privatepassword "{{SV_PRIVATEPASSWORD}}"

// PASSWORDS
set g_password "{{G_PASSWORD}}"
set rconpassword "{{RCON_PASSWORD}}"
set refereePassword "{{REFEREE_PASSWORD}}"
set shoutcastPassword "{{SHOUTCAST_PASSWORD}}"

// NETWORK
set sv_advert "{{SV_ADVERT}}"
set sv_timeout "{{SV_TIMEOUT}}"
set sv_dl_timeout "{{SV_DL_TIMEOUT}}"
set sv_minping "{{SV_MINPING}}"
set sv_maxping "{{SV_MAXPING}}"
set net_port6 "{{NET_PORT6}}"

// MASTER SERVERS
set sv_master1 "{{SV_MASTER1}}"
set sv_master2 "{{SV_MASTER2}}"
set sv_master3 "{{SV_MASTER3}}"
set sv_master4 "{{SV_MASTER4}}"
set sv_master5 "{{SV_MASTER5}}"
set sv_master6 "{{SV_MASTER6}}"

// DOWNLOAD
set sv_maxRate "{{SV_MAXRATE}}"
set sv_dlRate "{{SV_DLRATE}}"
set sv_allowDownload "{{SV_ALLOWDOWNLOAD}}"
set sv_wwwDownload "{{SV_WWWDOWNLOAD}}"
set sv_wwwBaseURL "{{SV_WWWBASEURL}}"
set sv_wwwDlDisconnected "{{SV_WWWDLDISCONNECTED}}"
set sv_wwwFallbackURL "{{SV_WWWFALLBACKURL}}"

// LOGGING & PROTECTION
set logfile "{{LOGFILE}}"
set sv_pure "{{SV_PURE}}"
set sv_protect "{{SV_PROTECT}}"
set sv_protectLog "{{SV_PROTECT_LOG}}"
set sv_floodProtect "{{SV_FLOODPROTECT}}"
set sv_userInfofloodProtect "{{SV_USERINFOFLOODPROTECT}}"
set sv_ipMaxClients "{{SV_IPMAXCLIENTS}}"
set sv_punkbuster "{{SV_PUNKBUSTER}}"

// GAME TYPE
set g_gametype "{{GAMETYPE}}"

// MOD LOGGING & PROTECTION
set g_log "{{G_LOG}}"
set g_logSync "{{G_LOGSYNC}}"
set g_guidCheck "{{G_GUIDCHECK}}"
set g_protect "{{G_PROTECT}}"

// OPTIMIZATIONS
set g_antiwarp "{{G_ANTIWARP}}"
set g_maxWarp "{{G_MAXWARP}}"

// LEVEL UP CUSTOMIZATION (XP thresholds for L2 L3 L4)
set skill_soldier "{{SKILL_SOLDIER}}"
set skill_medic "{{SKILL_MEDIC}}"
set skill_fieldops "{{SKILL_FIELDOPS}}"
set skill_engineer "{{SKILL_ENGINEER}}"
set skill_covertops "{{SKILL_COVERTOPS}}"
set skill_battlesense "{{SKILL_BATTLESENSE}}"
set skill_lightweapons "{{SKILL_LIGHTWEAPONS}}"

// CLASS LIMITING (-1 = unlimited)
set team_maxSoldiers "{{TEAM_MAXSOLDIERS}}"
set team_maxMedics "{{TEAM_MAXMEDICS}}"
set team_maxEngineers "{{TEAM_MAXENGINEERS}}"
set team_maxFieldops "{{TEAM_MAXFIELDOPS}}"
set team_maxCovertops "{{TEAM_MAXCOVERTOPS}}"

// WEAPONS LIMITING (-1 = unlimited)
set team_maxMortars "{{TEAM_MAXMORTARS}}"
set team_maxFlamers "{{TEAM_MAXFLAMERS}}"
set team_maxMachineguns "{{TEAM_MAXMACHINEGUNS}}"
set team_maxRockets "{{TEAM_MAXROCKETS}}"
set team_maxRiflegrenades "{{TEAM_MAXRIFLEGRENADES}}"
set team_maxAirstrikes "{{TEAM_MAXAIRSTRIKES}}"
set team_maxArtillery "{{TEAM_MAXARTILLERY}}"
set team_maxLandmines "{{TEAM_MAXLANDMINES}}"
set team_riflegrenades "{{TEAM_RIFLEGRENADES}}"

// GAMEPLAY
set g_dropAmmo "{{G_DROPAMMO}}"
set g_dropHealth "{{G_DROPHEALTH}}"
set g_shove "{{G_SHOVE}}"
set g_misc "{{G_MISC}}"
set g_countryflags "{{G_COUNTRYFLAGS}}"
set g_skillRating "{{G_SKILLRATING}}"
set g_heavyWeaponRestriction "{{G_HEAVYWEAPONRESTRICTION}}"
set g_antilag "{{G_ANTILAG}}"
set g_altStopwatchMode "{{G_ALTSTOPWATCHMODE}}"
set g_autofireteams "{{G_AUTOFIRETEAMS}}"
set g_complaintlimit "{{G_COMPLAINTLIMIT}}"
set g_disableComplaints "{{G_DISABLECOMPLAINTS}}"
set g_ipcomplaintlimit "{{G_IPCOMPLAINTLIMIT}}"
set g_fastres "{{G_FASTRES}}"
set g_friendlyFire "{{G_FRIENDLYFIRE}}"
set g_minGameClients "{{G_MINGAMECLIENTS}}"
set g_maxlives "{{G_MAXLIVES}}"
set g_alliedmaxlives "{{G_ALLIEDMAXLIVES}}"
set g_axismaxlives "{{G_AXISMAXLIVES}}"
set g_teamforcebalance "{{G_TEAMFORCEBALANCE}}"
set g_noTeamSwitching "{{G_NOTEAMSWITCHING}}"
set g_voiceChatsAllowed "{{G_VOICECHATSALLOWED}}"
set g_doWarmup "{{G_DOWARMUP}}"
set g_warmup "{{G_WARMUP}}"
set g_intermissionTime "{{G_INTERMISSIONTIME}}"
set g_intermissionReadyPercent "{{G_INTERMISSIONREADYPERCENT}}"
set g_spectatorInactivity "{{G_SPECTATORINACTIVITY}}"
set match_latejoin "{{MATCH_LATEJOIN}}"
set match_minplayers "{{MATCH_MINPLAYERS}}"
set match_mutespecs "{{MATCH_MUTESPECS}}"
set match_readypercent "{{MATCH_READYPERCENT}}"
set match_timeoutcount "{{MATCH_TIMEOUTCOUNT}}"
set match_warmupDamage "{{MATCH_WARMUPDAMAGE}}"
set team_maxplayers "{{TEAM_MAXPLAYERS}}"
set team_nocontrols "{{TEAM_NOCONTROLS}}"
set pmove_fixed "{{PMOVE_FIXED}}"
set pmove_msec "{{PMOVE_MSEC}}"
set g_mapScriptDirectory "{{G_MAPSCRIPTDIRECTORY}}"
set g_campaignFile "{{G_CAMPAIGNFILE}}"
set g_customConfig "{{G_CUSTOMCONFIG}}"

// LMS ONLY SETTINGS
set g_lms_teamForceBalance "{{G_LMS_TEAMFORCEBALANCE}}"
set g_lms_roundlimit "{{G_LMS_ROUNDLIMIT}}"
set g_lms_matchlimit "{{G_LMS_MATCHLIMIT}}"
set g_lms_lockTeams "{{G_LMS_LOCKTEAMS}}"
set g_lms_followTeamOnly "{{G_LMS_FOLLOWTEAMONLY}}"

// VOTING
set g_allowVote "{{G_ALLOWVOTE}}"
set vote_limit "{{VOTE_LIMIT}}"
set vote_percent "{{VOTE_PERCENT}}"
set vote_allow_config "{{VOTE_ALLOW_CONFIG}}"
set vote_allow_gametype "{{VOTE_ALLOW_GAMETYPE}}"
set vote_allow_kick "{{VOTE_ALLOW_KICK}}"
set vote_allow_map "{{VOTE_ALLOW_MAP}}"
set vote_allow_maprestart "{{VOTE_ALLOW_MAPRESTART}}"
set vote_allow_matchreset "{{VOTE_ALLOW_MATCHRESET}}"
set vote_allow_mutespecs "{{VOTE_ALLOW_MUTESPECS}}"
set vote_allow_nextmap "{{VOTE_ALLOW_NEXTMAP}}"
set vote_allow_referee "{{VOTE_ALLOW_REFEREE}}"
set vote_allow_shuffleteams "{{VOTE_ALLOW_SHUFFLETEAMS}}"
set vote_allow_shuffleteams_norestart "{{VOTE_ALLOW_SHUFFLETEAMS_NORESTART}}"
set vote_allow_swapteams "{{VOTE_ALLOW_SWAPTEAMS}}"
set vote_allow_friendlyfire "{{VOTE_ALLOW_FRIENDLYFIRE}}"
set vote_allow_timelimit "{{VOTE_ALLOW_TIMELIMIT}}"
set vote_allow_warmupdamage "{{VOTE_ALLOW_WARMUPDAMAGE}}"
set vote_allow_antilag "{{VOTE_ALLOW_ANTILAG}}"
set vote_allow_balancedteams "{{VOTE_ALLOW_BALANCEDTEAMS}}"
set vote_allow_muting "{{VOTE_ALLOW_MUTING}}"
set vote_allow_surrender "{{VOTE_ALLOW_SURRENDER}}"
set vote_allow_restartcampaign "{{VOTE_ALLOW_RESTARTCAMPAIGN}}"
set vote_allow_nextcampaign "{{VOTE_ALLOW_NEXTCAMPAIGN}}"
set vote_allow_poll "{{VOTE_ALLOW_POLL}}"
set vote_allow_cointoss "{{VOTE_ALLOW_COINTOSS}}"

// MAP VOTING
set g_excludedMaps "{{G_EXCLUDEDMAPS}}"
set g_maxMapsVotedFor "{{G_MAXMAPSVOTEDFOR}}"
set g_mapVoteFlags "{{G_MAPVOTEFLAGS}}"
set g_minMapAge "{{G_MINMAPAGE}}"

// LUA
set lua_modules "{{LUA_MODULES}}"
set lua_allowedModules "{{LUA_ALLOWEDMODULES}}"

// OMNI-BOT
set omnibot_enable "{{OMNIBOT_ENABLE}}"
set omnibot_path "{{OMNIBOT_PATH}}"
set omnibot_flags "{{OMNIBOT_FLAGS}}"

// WATCHDOG — restart action if the server dies with no map running
set com_watchdog "{{COM_WATCHDOG}}"
set com_watchdog_cmd "{{COM_WATCHDOG_CMD}}"
MODCFG

  # Optional bind overrides — only written when set in the wizard
  if [ -n "\${NET_IP:-}" ]; then
    printf 'set net_ip "%s"\n' "\${NET_IP}" >> "$MOD_DIR/server.cfg"
  fi
  if [ -n "\${NET_IP6:-}" ]; then
    printf 'set net_ip6 "%s"\n' "\${NET_IP6}" >> "$MOD_DIR/server.cfg"
  fi

  # Map rotation — cycle config matching the game type (or legacy 2.60 rotation)
  {
    echo ""
    echo "// MAP ROTATION"
    if [ -n "\${MAP_ROTATION:-}" ]; then
      printf 'set sv_mapRotation "%s"\n' "\${MAP_ROTATION}"
      echo "map \${START_MAP:-oasis}"
    else
      echo "\$ROTATION"
    fi
  } >> "$MOD_DIR/server.cfg"
fi

# ── Step 6: Select the correct binary for the architecture ───
echo ""
if [ "$USE_ARCH" = "x86_64" ]; then
  echo "═══ Locating 64-bit dedicated server binary ═══"
  if [ -f ./etlded.x86_64 ]; then
    echo "  Found: etlded.x86_64 (64-bit)"
    chmod +x ./etlded.x86_64
    ln -sf ./etlded.x86_64 ./etlded
  elif [ -f ./etlded ]; then
    echo "  Found: etlded (generic)"
    chmod +x ./etlded
  else
    echo "  ERROR: 64-bit dedicated server binary not found after extraction"
    echo "  Files in install directory:"
    find . -maxdepth 3 -type f -executable | sort
    exit 1
  fi
  echo ""
  echo "✅ ET:Legacy 64-bit installed successfully (mod: $ET_MOD)"
  echo "   Binary: ./etlded (linked to 64-bit version)"
else
  echo "═══ Locating 32-bit dedicated server binary ═══"
  if [ -f ./etlded.i386 ]; then
    echo "  Found: etlded.i386 (32-bit)"
    chmod +x ./etlded.i386
    ln -sf ./etlded.i386 ./etlded
  elif [ -f ./etlded ]; then
    echo "  Found: etlded (generic)"
    chmod +x ./etlded
  else
    echo "  ERROR: 32-bit dedicated server binary not found after extraction"
    echo "  Files in install directory:"
    find . -maxdepth 3 -type f -executable | sort
    exit 1
  fi
  echo ""
  echo "✅ ET:Legacy 32-bit installed successfully (mod: $ET_MOD)"
  echo "   Binary: ./etlded (linked to 32-bit version)"
fi
echo "   Mod dir: $MOD_DIR"`,
    startCommand: `cd {{INSTALL_PATH}} && ./etlded +set dedicated 2 +set vm_game 0 +set net_port {{PORT}} +set fs_basepath "{{INSTALL_PATH}}" +set fs_homepath "{{INSTALL_PATH}}" +set fs_game {{ET_MOD}} +exec server.cfg`,
    stopCommand: null,
    configFiles: { "{{ET_MOD}}/server.cfg": "server.cfg" },
    // Complete server.cfg option set (mirrors the install wizard above).
    // "__gsm_format": "quake3" tells the panel to render these as `set cvar "value"` lines.
    defaultConfig: {
      "__gsm_format": "quake3",
      "sv_hostname": "{{SERVER_NAME}}",
      "server_motd0": "{{MOTD0}}",
      "server_motd1": "{{MOTD1}}",
      "server_motd2": "{{MOTD2}}",
      "server_motd3": "{{MOTD3}}",
      "server_motd4": "{{MOTD4}}",
      "server_motd5": "{{MOTD5}}",
      "sv_maxclients": "{{MAX_PLAYERS}}",
      "sv_privateclients": "{{SV_PRIVATECLIENTS}}",
      "sv_privatepassword": "{{SV_PRIVATEPASSWORD}}",
      "g_password": "{{G_PASSWORD}}",
      "rconpassword": "{{RCON_PASSWORD}}",
      "refereePassword": "{{REFEREE_PASSWORD}}",
      "shoutcastPassword": "{{SHOUTCAST_PASSWORD}}",
      "sv_advert": "{{SV_ADVERT}}",
      "sv_timeout": "{{SV_TIMEOUT}}",
      "sv_dl_timeout": "{{SV_DL_TIMEOUT}}",
      "sv_minping": "{{SV_MINPING}}",
      "sv_maxping": "{{SV_MAXPING}}",
      "net_port6": "{{NET_PORT6}}",
      "sv_master1": "{{SV_MASTER1}}",
      "sv_master2": "{{SV_MASTER2}}",
      "sv_master3": "{{SV_MASTER3}}",
      "sv_master4": "{{SV_MASTER4}}",
      "sv_master5": "{{SV_MASTER5}}",
      "sv_master6": "{{SV_MASTER6}}",
      "sv_maxRate": "{{SV_MAXRATE}}",
      "sv_dlRate": "{{SV_DLRATE}}",
      "sv_allowDownload": "{{SV_ALLOWDOWNLOAD}}",
      "sv_wwwDownload": "{{SV_WWWDOWNLOAD}}",
      "sv_wwwBaseURL": "{{SV_WWWBASEURL}}",
      "sv_wwwDlDisconnected": "{{SV_WWWDLDISCONNECTED}}",
      "sv_wwwFallbackURL": "{{SV_WWWFALLBACKURL}}",
      "logfile": "{{LOGFILE}}",
      "sv_pure": "{{SV_PURE}}",
      "sv_protect": "{{SV_PROTECT}}",
      "sv_protectLog": "{{SV_PROTECT_LOG}}",
      "sv_floodProtect": "{{SV_FLOODPROTECT}}",
      "sv_userInfofloodProtect": "{{SV_USERINFOFLOODPROTECT}}",
      "sv_ipMaxClients": "{{SV_IPMAXCLIENTS}}",
      "sv_punkbuster": "{{SV_PUNKBUSTER}}",
      "g_gametype": "{{GAMETYPE}}",
      "g_log": "{{G_LOG}}",
      "g_logSync": "{{G_LOGSYNC}}",
      "g_guidCheck": "{{G_GUIDCHECK}}",
      "g_protect": "{{G_PROTECT}}",
      "g_antiwarp": "{{G_ANTIWARP}}",
      "g_maxWarp": "{{G_MAXWARP}}",
      "skill_soldier": "{{SKILL_SOLDIER}}",
      "skill_medic": "{{SKILL_MEDIC}}",
      "skill_fieldops": "{{SKILL_FIELDOPS}}",
      "skill_engineer": "{{SKILL_ENGINEER}}",
      "skill_covertops": "{{SKILL_COVERTOPS}}",
      "skill_battlesense": "{{SKILL_BATTLESENSE}}",
      "skill_lightweapons": "{{SKILL_LIGHTWEAPONS}}",
      "team_maxSoldiers": "{{TEAM_MAXSOLDIERS}}",
      "team_maxMedics": "{{TEAM_MAXMEDICS}}",
      "team_maxEngineers": "{{TEAM_MAXENGINEERS}}",
      "team_maxFieldops": "{{TEAM_MAXFIELDOPS}}",
      "team_maxCovertops": "{{TEAM_MAXCOVERTOPS}}",
      "team_maxMortars": "{{TEAM_MAXMORTARS}}",
      "team_maxFlamers": "{{TEAM_MAXFLAMERS}}",
      "team_maxMachineguns": "{{TEAM_MAXMACHINEGUNS}}",
      "team_maxRockets": "{{TEAM_MAXROCKETS}}",
      "team_maxRiflegrenades": "{{TEAM_MAXRIFLEGRENADES}}",
      "team_maxAirstrikes": "{{TEAM_MAXAIRSTRIKES}}",
      "team_maxArtillery": "{{TEAM_MAXARTILLERY}}",
      "team_maxLandmines": "{{TEAM_MAXLANDMINES}}",
      "team_riflegrenades": "{{TEAM_RIFLEGRENADES}}",
      "g_dropAmmo": "{{G_DROPAMMO}}",
      "g_dropHealth": "{{G_DROPHEALTH}}",
      "g_shove": "{{G_SHOVE}}",
      "g_misc": "{{G_MISC}}",
      "g_countryflags": "{{G_COUNTRYFLAGS}}",
      "g_skillRating": "{{G_SKILLRATING}}",
      "g_heavyWeaponRestriction": "{{G_HEAVYWEAPONRESTRICTION}}",
      "g_antilag": "{{G_ANTILAG}}",
      "g_altStopwatchMode": "{{G_ALTSTOPWATCHMODE}}",
      "g_autofireteams": "{{G_AUTOFIRETEAMS}}",
      "g_complaintlimit": "{{G_COMPLAINTLIMIT}}",
      "g_disableComplaints": "{{G_DISABLECOMPLAINTS}}",
      "g_ipcomplaintlimit": "{{G_IPCOMPLAINTLIMIT}}",
      "g_fastres": "{{G_FASTRES}}",
      "g_friendlyFire": "{{G_FRIENDLYFIRE}}",
      "g_minGameClients": "{{G_MINGAMECLIENTS}}",
      "g_maxlives": "{{G_MAXLIVES}}",
      "g_alliedmaxlives": "{{G_ALLIEDMAXLIVES}}",
      "g_axismaxlives": "{{G_AXISMAXLIVES}}",
      "g_teamforcebalance": "{{G_TEAMFORCEBALANCE}}",
      "g_noTeamSwitching": "{{G_NOTEAMSWITCHING}}",
      "g_voiceChatsAllowed": "{{G_VOICECHATSALLOWED}}",
      "g_doWarmup": "{{G_DOWARMUP}}",
      "g_warmup": "{{G_WARMUP}}",
      "g_intermissionTime": "{{G_INTERMISSIONTIME}}",
      "g_intermissionReadyPercent": "{{G_INTERMISSIONREADYPERCENT}}",
      "g_spectatorInactivity": "{{G_SPECTATORINACTIVITY}}",
      "match_latejoin": "{{MATCH_LATEJOIN}}",
      "match_minplayers": "{{MATCH_MINPLAYERS}}",
      "match_mutespecs": "{{MATCH_MUTESPECS}}",
      "match_readypercent": "{{MATCH_READYPERCENT}}",
      "match_timeoutcount": "{{MATCH_TIMEOUTCOUNT}}",
      "match_warmupDamage": "{{MATCH_WARMUPDAMAGE}}",
      "team_maxplayers": "{{TEAM_MAXPLAYERS}}",
      "team_nocontrols": "{{TEAM_NOCONTROLS}}",
      "pmove_fixed": "{{PMOVE_FIXED}}",
      "pmove_msec": "{{PMOVE_MSEC}}",
      "g_mapScriptDirectory": "{{G_MAPSCRIPTDIRECTORY}}",
      "g_campaignFile": "{{G_CAMPAIGNFILE}}",
      "g_customConfig": "{{G_CUSTOMCONFIG}}",
      "g_lms_teamForceBalance": "{{G_LMS_TEAMFORCEBALANCE}}",
      "g_lms_roundlimit": "{{G_LMS_ROUNDLIMIT}}",
      "g_lms_matchlimit": "{{G_LMS_MATCHLIMIT}}",
      "g_lms_lockTeams": "{{G_LMS_LOCKTEAMS}}",
      "g_lms_followTeamOnly": "{{G_LMS_FOLLOWTEAMONLY}}",
      "g_allowVote": "{{G_ALLOWVOTE}}",
      "vote_limit": "{{VOTE_LIMIT}}",
      "vote_percent": "{{VOTE_PERCENT}}",
      "vote_allow_config": "{{VOTE_ALLOW_CONFIG}}",
      "vote_allow_gametype": "{{VOTE_ALLOW_GAMETYPE}}",
      "vote_allow_kick": "{{VOTE_ALLOW_KICK}}",
      "vote_allow_map": "{{VOTE_ALLOW_MAP}}",
      "vote_allow_maprestart": "{{VOTE_ALLOW_MAPRESTART}}",
      "vote_allow_matchreset": "{{VOTE_ALLOW_MATCHRESET}}",
      "vote_allow_mutespecs": "{{VOTE_ALLOW_MUTESPECS}}",
      "vote_allow_nextmap": "{{VOTE_ALLOW_NEXTMAP}}",
      "vote_allow_referee": "{{VOTE_ALLOW_REFEREE}}",
      "vote_allow_shuffleteams": "{{VOTE_ALLOW_SHUFFLETEAMS}}",
      "vote_allow_shuffleteams_norestart": "{{VOTE_ALLOW_SHUFFLETEAMS_NORESTART}}",
      "vote_allow_swapteams": "{{VOTE_ALLOW_SWAPTEAMS}}",
      "vote_allow_friendlyfire": "{{VOTE_ALLOW_FRIENDLYFIRE}}",
      "vote_allow_timelimit": "{{VOTE_ALLOW_TIMELIMIT}}",
      "vote_allow_warmupdamage": "{{VOTE_ALLOW_WARMUPDAMAGE}}",
      "vote_allow_antilag": "{{VOTE_ALLOW_ANTILAG}}",
      "vote_allow_balancedteams": "{{VOTE_ALLOW_BALANCEDTEAMS}}",
      "vote_allow_muting": "{{VOTE_ALLOW_MUTING}}",
      "vote_allow_surrender": "{{VOTE_ALLOW_SURRENDER}}",
      "vote_allow_restartcampaign": "{{VOTE_ALLOW_RESTARTCAMPAIGN}}",
      "vote_allow_nextcampaign": "{{VOTE_ALLOW_NEXTCAMPAIGN}}",
      "vote_allow_poll": "{{VOTE_ALLOW_POLL}}",
      "vote_allow_cointoss": "{{VOTE_ALLOW_COINTOSS}}",
      "g_excludedMaps": "{{G_EXCLUDEDMAPS}}",
      "g_maxMapsVotedFor": "{{G_MAXMAPSVOTEDFOR}}",
      "g_mapVoteFlags": "{{G_MAPVOTEFLAGS}}",
      "g_minMapAge": "{{G_MINMAPAGE}}",
      "lua_modules": "{{LUA_MODULES}}",
      "lua_allowedModules": "{{LUA_ALLOWEDMODULES}}",
      "omnibot_enable": "{{OMNIBOT_ENABLE}}",
      "omnibot_path": "{{OMNIBOT_PATH}}",
      "omnibot_flags": "{{OMNIBOT_FLAGS}}",
      "com_watchdog": "{{COM_WATCHDOG}}",
      "com_watchdog_cmd": "{{COM_WATCHDOG_CMD}}",
    },
  },
  {
    slug: "openra",
    name: "OpenRA",
    engine: "OpenRA Engine",
    defaultPort: 1234,
    steamAppId: null,
    iconEmoji: "⚔️",
    supportsIpv6: true,
    category: "Classic",
    description: "Open source C&C / Red Alert engine",
    estimatedSize: "~200 MB",
    variables: [
      ...COMMON_VARS,
      V("Game Mod", "GAME_MOD", "ra (Red Alert), cnc (C&C), d2k (Dune 2000)", "ra", { required: false }),
    ],
    installScript: `#!/bin/bash
set -e
INSTALL_DIR="{{INSTALL_PATH}}"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

GAME_MOD="{{GAME_MOD}}"
RELEASE=$(curl -sSL https://api.github.com/repos/OpenRA/OpenRA/releases/latest | grep tag_name | cut -d '"' -f4)
echo "Latest OpenRA release: $RELEASE"

# Pick the correct upstream asset name for the selected mod.
case "$GAME_MOD" in
  ra)  ASSET_NAME="OpenRA-Red-Alert-x86_64.AppImage" ;;
  cnc) ASSET_NAME="OpenRA-Tiberian-Dawn-x86_64.AppImage" ;;
  d2k) ASSET_NAME="OpenRA-Dune-2000-x86_64.AppImage" ;;
  *)
    echo "Unknown GAME_MOD: $GAME_MOD"
    exit 1
    ;;
esac

APPIMAGE_URL="https://github.com/OpenRA/OpenRA/releases/download/$RELEASE/$ASSET_NAME"
echo "Downloading OpenRA asset: $APPIMAGE_URL"
curl -fL -o OpenRA.AppImage "$APPIMAGE_URL"
chmod +x OpenRA.AppImage

# Keep the AppImage itself — it can run the dedicated server directly with --server.
# Also extract a fallback runtime tree for environments without FUSE.
echo "Extracting AppImage fallback..."
./OpenRA.AppImage --appimage-extract >/dev/null 2>&1 || true
if [ -d "squashfs-root" ]; then
  mv squashfs-root openra-extracted
fi

# Validate that we have something runnable.
if [ ! -f OpenRA.AppImage ] && [ ! -f openra-extracted/AppRun ]; then
  echo "OpenRA server runtime not found after download/extract"
  exit 1
fi

echo "OpenRA installed successfully"`,
    startCommand: `cd {{INSTALL_PATH}} && if [ -x ./OpenRA.AppImage ]; then ./OpenRA.AppImage --server Server.Name="{{SERVER_NAME}}" Server.ListenPort={{PORT}} Game.Mod={{GAME_MOD}}; elif [ -x ./openra-extracted/AppRun ]; then ./openra-extracted/AppRun --server Server.Name="{{SERVER_NAME}}" Server.ListenPort={{PORT}} Game.Mod={{GAME_MOD}}; else echo "OpenRA runtime missing"; exit 1; fi`,
    stopCommand: null,
    configFiles: {},
    defaultConfig: {},
  },
  {
    slug: "quake-live",
    name: "Quake Live",
    engine: "id Tech 3",
    defaultPort: 27960,
    steamAppId: "349090",
    iconEmoji: "⚡",
    supportsIpv6: true,
    category: "Classic",
    description: "Fast-paced arena shooter",
    estimatedSize: "~3 GB",
    variables: [
      ...STEAM_VARS,
      ...RCON_VARS,
      V("Game Type", "GAMETYPE", "0=FFA, 1=Duel, 3=TDM, 4=CA, 5=CTF", "0", { required: false, type: "number" }),
    ],
    installScript: `#!/bin/bash
set -e
INSTALL_DIR="{{INSTALL_PATH}}"
STEAM_APPID="349090"

## Use system SteamCMD install (shared across servers)
STEAMCMD_BIN="/opt/steamcmd/steamcmd.sh"
if [ ! -x "$STEAMCMD_BIN" ]; then
  echo "SteamCMD is not installed at $STEAMCMD_BIN" >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR/.steam/sdk32" "$INSTALL_DIR/.steam/sdk64"
chown -R $(whoami) "$INSTALL_DIR"
export HOME="$INSTALL_DIR"

## Install game server
echo "Installing Quake Live (AppID: $STEAM_APPID)..."
STEAMCMD_ATTEMPT=1
until "$STEAMCMD_BIN" +force_install_dir "$INSTALL_DIR" +login anonymous +app_update $STEAM_APPID validate +quit; do
  STEAMCMD_ATTEMPT=$((STEAMCMD_ATTEMPT + 1))
  if [ "$STEAMCMD_ATTEMPT" -gt 3 ]; then
    echo "ERROR: SteamCMD failed to install AppID $STEAM_APPID after 3 attempts" >&2
    exit 1
  fi
  echo "SteamCMD attempt failed, retrying ($STEAMCMD_ATTEMPT/3)..."
  sleep 10
done

## Set up Steam SDK libraries
cp -v "/opt/steamcmd/linux32/steamclient.so" "$INSTALL_DIR/.steam/sdk32/steamclient.so" 2>/dev/null || true
cp -v "/opt/steamcmd/linux64/steamclient.so" "$INSTALL_DIR/.steam/sdk64/steamclient.so" 2>/dev/null || true

## id Tech 3 cfgs use: set/seta cvar "value" — write a valid server.cfg
mkdir -p "$INSTALL_DIR/baseq3"
if [ ! -f "$INSTALL_DIR/baseq3/server.cfg" ]; then
  cat > "$INSTALL_DIR/baseq3/server.cfg" << 'QLCFG'
seta sv_hostname "{{SERVER_NAME}}"
seta g_gametype {{GAMETYPE}}
seta sv_maxclients {{MAX_PLAYERS}}
QLCFG
fi

echo "Quake Live server installed successfully"`,
    startCommand: `cd {{INSTALL_PATH}} && ./run_server_x64.sh +set net_port {{PORT}} +set sv_hostname "{{SERVER_NAME}}" +set g_gametype {{GAMETYPE}}`,
    stopCommand: "quit",
    configFiles: { "baseq3/server.cfg": "server.cfg" },
    defaultConfig: {},
  },
  {
    slug: "xonotic",
    name: "Xonotic",
    engine: "DarkPlaces",
    defaultPort: 26000,
    steamAppId: null,
    iconEmoji: "🔵",
    supportsIpv6: true,
    category: "Classic",
    description: "Free open source arena shooter",
    estimatedSize: "~1 GB",
    variables: [
      ...COMMON_VARS,
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

echo "Xonotic server installed successfully"
`,
    startCommand: `cd {{INSTALL_PATH}} && ./xonotic-linux64-dedicated -dedicated +sv_public 1 +port {{PORT}} +hostname "{{SERVER_NAME}}" +maxplayers {{MAX_PLAYERS}}`,
    stopCommand: "quit",
    configFiles: { "data/server.cfg": "server.cfg" },
    defaultConfig: {},
  },

  // ═══════════════════════════════════════════════════════════════
  // RPG / SANDBOX
  // ═══════════════════════════════════════════════════════════════
  {
    slug: "vrising",
    name: "V Rising",
    engine: "Unity",
    defaultPort: 9876,
    steamAppId: "1829350",
    iconEmoji: "🧛",
    supportsIpv6: false,
    category: "RPG",
    description: "Vampire survival action RPG",
    estimatedSize: "~3 GB",
    variables: [
      ...STEAM_VARS,
      V("Save Name", "SAVE_NAME", "Save file name", "world1"),
      V("Password", "PASSWORD", "Server password", "", { required: false, type: "password" }),
    ],
    installScript: `#!/bin/bash
set -e
INSTALL_DIR="{{INSTALL_PATH}}"
STEAM_APPID="1829350"

## V Rising ships a Windows-only dedicated server (AppID 1829350) — it needs Wine.
## Install wine + a virtual framebuffer (required headless) when possible.
if ! command -v wine &> /dev/null; then
  echo "Installing wine + xvfb (required for the V Rising dedicated server)..."
  if [ "$(id -u)" = "0" ]; then APT_PREFIX=""; else APT_PREFIX="sudo -n"; fi
  $APT_PREFIX dpkg --add-architecture i386 2>/dev/null || true
  $APT_PREFIX apt-get update -qq 2>/dev/null || true
  $APT_PREFIX apt-get install -y -qq wine wine64 xvfb dos2unix 2>/dev/null \
    || $APT_PREFIX apt-get install -y -qq wine xvfb dos2unix 2>/dev/null || true
fi

if ! command -v wine &> /dev/null; then
  echo "ERROR: wine is not installed and could not be installed automatically." >&2
  echo "Install it manually, e.g.: sudo apt-get install -y wine wine64 xvfb" >&2
  exit 1
fi
command -v dos2unix &> /dev/null || echo "Note: dos2unix not available; config copy fallback will be used."

## Use system SteamCMD install (shared across servers)
STEAMCMD_BIN="/opt/steamcmd/steamcmd.sh"
if [ ! -x "$STEAMCMD_BIN" ]; then
  echo "SteamCMD is not installed at $STEAMCMD_BIN" >&2
  exit 1
fi

export HOME="$INSTALL_DIR"
mkdir -p "$HOME/steamapps" "$HOME/.steam/sdk32" "$HOME/.steam/sdk64"
chown -R $(whoami) "$INSTALL_DIR" 2>/dev/null || true

echo "Installing V Rising Windows dedicated server (AppID: $STEAM_APPID)..."
STEAMCMD_ATTEMPT=1
until "$STEAMCMD_BIN" +force_install_dir "$HOME" +login anonymous +@sSteamCmdForcePlatformType windows +app_update $STEAM_APPID validate +quit; do
  STEAMCMD_ATTEMPT=$((STEAMCMD_ATTEMPT + 1))
  if [ "$STEAMCMD_ATTEMPT" -gt 3 ]; then
    echo "ERROR: SteamCMD failed to install AppID $STEAM_APPID after 3 attempts" >&2
    exit 1
  fi
  echo "SteamCMD attempt failed, retrying ($STEAMCMD_ATTEMPT/3)..."
  sleep 10
done

cp -v "/opt/steamcmd/linux32/steamclient.so" "$HOME/.steam/sdk32/steamclient.so" 2>/dev/null || true
cp -v "/opt/steamcmd/linux64/steamclient.so" "$HOME/.steam/sdk64/steamclient.so" 2>/dev/null || true

mkdir -p "$HOME/save-data/Settings" "$HOME/logs"
if [ -f "$HOME/VRisingServer_Data/StreamingAssets/Settings/ServerHostSettings.json" ]; then
  if command -v dos2unix &> /dev/null; then
    dos2unix -n "$HOME/VRisingServer_Data/StreamingAssets/Settings/ServerHostSettings.json" "$HOME/save-data/Settings/ServerHostSettings.json" 2>/dev/null \
      || cp "$HOME/VRisingServer_Data/StreamingAssets/Settings/ServerHostSettings.json" "$HOME/save-data/Settings/ServerHostSettings.json"
  else
    cp "$HOME/VRisingServer_Data/StreamingAssets/Settings/ServerHostSettings.json" "$HOME/save-data/Settings/ServerHostSettings.json"
  fi
fi

if [ ! -f "$HOME/VRisingServer.exe" ]; then
  echo "ERROR: VRisingServer.exe not found after install" >&2
  find "$HOME" -maxdepth 3 -type f | sort | tail -50
  exit 1
fi

echo "V Rising server installed successfully (runs under wine)"`,
    startCommand: `cd {{INSTALL_PATH}} && if command -v xvfb-run >/dev/null 2>&1; then exec xvfb-run -a wine ./VRisingServer.exe -persistentDataPath ./save-data -serverName "{{SERVER_NAME}}" -saveName "{{SAVE_NAME}}" -logFile ./logs/VRisingServer.log; else exec wine ./VRisingServer.exe -persistentDataPath ./save-data -serverName "{{SERVER_NAME}}" -saveName "{{SAVE_NAME}}" -logFile ./logs/VRisingServer.log; fi`,
    stopCommand: null,
    configFiles: { "save-data/Settings/ServerHostSettings.json": "ServerHostSettings.json" },
    defaultConfig: {},
  },
  {
    slug: "project-zomboid",
    name: "Project Zomboid",
    engine: "Custom Java",
    defaultPort: 16261,
    steamAppId: "380870",
    iconEmoji: "🧟‍♀️",
    supportsIpv6: false,
    category: "Survival",
    description: "Isometric zombie survival RPG",
    estimatedSize: "~2 GB",
    variables: [
      ...STEAM_VARS,
      V("Admin Password", "ADMIN_PASSWORD", "Admin password", "", { type: "password" }),
      V("Server Password", "SERVER_PASSWORD", "Join password", "", { required: false, type: "password" }),
    ],
    installScript: `#!/bin/bash
set -e
INSTALL_DIR="{{INSTALL_PATH}}"
STEAM_APPID="380870"

## Use system SteamCMD install (shared across servers)
STEAMCMD_BIN="/opt/steamcmd/steamcmd.sh"
if [ ! -x "$STEAMCMD_BIN" ]; then
  echo "SteamCMD is not installed at $STEAMCMD_BIN" >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR/.steam/sdk32" "$INSTALL_DIR/.steam/sdk64"
chown -R $(whoami) "$INSTALL_DIR"
export HOME="$INSTALL_DIR"

## Install game server
echo "Installing Project Zomboid (AppID: $STEAM_APPID)..."
STEAMCMD_ATTEMPT=1
until "$STEAMCMD_BIN" +force_install_dir "$INSTALL_DIR" +login anonymous +app_update $STEAM_APPID validate +quit; do
  STEAMCMD_ATTEMPT=$((STEAMCMD_ATTEMPT + 1))
  if [ "$STEAMCMD_ATTEMPT" -gt 3 ]; then
    echo "ERROR: SteamCMD failed to install AppID $STEAM_APPID after 3 attempts" >&2
    exit 1
  fi
  echo "SteamCMD attempt failed, retrying ($STEAMCMD_ATTEMPT/3)..."
  sleep 10
done

## Set up Steam SDK libraries
cp -v "/opt/steamcmd/linux32/steamclient.so" "$INSTALL_DIR/.steam/sdk32/steamclient.so" 2>/dev/null || true
cp -v "/opt/steamcmd/linux64/steamclient.so" "$INSTALL_DIR/.steam/sdk64/steamclient.so" 2>/dev/null || true

echo "Project Zomboid server installed successfully"`,
    startCommand: `cd {{INSTALL_PATH}} && ./start-server.sh -servername "{{SERVER_NAME}}" -adminpassword "{{ADMIN_PASSWORD}}" -ip 0.0.0.0 -port {{PORT}} -steamport1 {{QUERY_PORT}} -steamport2 $(( {{QUERY_PORT}} + 1 ))`,
    stopCommand: "quit",
    configFiles: { "Server/servertest.ini": "servertest.ini" },
    defaultConfig: {},
  },
  {
    slug: "factorio",
    name: "Factorio",
    engine: "Custom",
    defaultPort: 34197,
    steamAppId: null,
    iconEmoji: "⚙️",
    supportsIpv6: true,
    category: "Sandbox",
    description: "Factory building and automation",
    estimatedSize: "~1.5 GB",
    variables: [
      ...COMMON_VARS,
      V("World Name", "WORLD_NAME", "World save name", "world"),
      V("Public", "PUBLIC", "List publicly (true/false)", "false", { required: false, type: "boolean" }),
    ],
    installScript: `#!/bin/bash
set -e
INSTALL_DIR="{{INSTALL_PATH}}"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

## Download Factorio Headless Server
echo "Downloading Factorio Headless Server..."
curl -fSL --retry 3 -A "Mozilla/5.0 (compatible; GSM-Panel)" -o factorio.tar.xz "https://factorio.com/get-download/stable/headless/linux64"
if ! tar tf factorio.tar.xz > /dev/null 2>&1; then
  echo "ERROR: downloaded Factorio archive is corrupt" >&2
  rm -f factorio.tar.xz
  exit 1
fi
tar xf factorio.tar.xz --strip-components=1
rm -f factorio.tar.xz

if [ ! -x ./bin/x64/factorio ]; then
  echo "ERROR: factorio binary missing after extraction" >&2
  exit 1
fi

## Create initial save
mkdir -p saves
if [ ! -f "saves/{{WORLD_NAME}}.zip" ]; then
  echo "Creating initial world save..."
  ./bin/x64/factorio --create "saves/{{WORLD_NAME}}.zip"
fi

echo "Factorio server installed successfully"
`,
    startCommand: `cd {{INSTALL_PATH}} && ./bin/x64/factorio --start-server saves/{{WORLD_NAME}}.zip --server-settings server-settings.json --port {{PORT}}`,
    stopCommand: null,
    configFiles: { "server-settings.json": "server-settings.json" },
    defaultConfig: {
      name: "{{SERVER_NAME}}",
      max_players: "{{MAX_PLAYERS}}",
    },
  },
  {
    slug: "dont-starve-together",
    name: "Don't Starve Together",
    engine: "Custom",
    defaultPort: 10999,
    steamAppId: "343050",
    iconEmoji: "🔥",
    supportsIpv6: false,
    category: "Survival",
    description: "Multiplayer survival adventure",
    estimatedSize: "~1 GB",
    variables: [
      ...COMMON_VARS,
      V("Cluster Name", "CLUSTER_NAME", "Cluster folder name", "MyCluster"),
      V("Cluster Token", "CLUSTER_TOKEN", "Server token from Klei", ""),
    ],
    installScript: `#!/bin/bash
set -e
INSTALL_DIR="{{INSTALL_PATH}}"
STEAM_APPID="343050"

## Use system SteamCMD install (shared across servers)
STEAMCMD_BIN="/opt/steamcmd/steamcmd.sh"
if [ ! -x "$STEAMCMD_BIN" ]; then
  echo "SteamCMD is not installed at $STEAMCMD_BIN" >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR/.steam/sdk32" "$INSTALL_DIR/.steam/sdk64"
chown -R $(whoami) "$INSTALL_DIR"
export HOME="$INSTALL_DIR"

## Install game server
echo "Installing Don't Starve Together (AppID: $STEAM_APPID)..."
STEAMCMD_ATTEMPT=1
until "$STEAMCMD_BIN" +force_install_dir "$INSTALL_DIR" +login anonymous +app_update $STEAM_APPID validate +quit; do
  STEAMCMD_ATTEMPT=$((STEAMCMD_ATTEMPT + 1))
  if [ "$STEAMCMD_ATTEMPT" -gt 3 ]; then
    echo "ERROR: SteamCMD failed to install AppID $STEAM_APPID after 3 attempts" >&2
    exit 1
  fi
  echo "SteamCMD attempt failed, retrying ($STEAMCMD_ATTEMPT/3)..."
  sleep 10
done

## Set up Steam SDK libraries
cp -v "/opt/steamcmd/linux32/steamclient.so" "$INSTALL_DIR/.steam/sdk32/steamclient.so" 2>/dev/null || true
cp -v "/opt/steamcmd/linux64/steamclient.so" "$INSTALL_DIR/.steam/sdk64/steamclient.so" 2>/dev/null || true

## Create the cluster directory everywhere the server looks for it.
## The dedicated server refuses to start without cluster_token.txt.
CLUSTER_DIR="$INSTALL_DIR/DoNotStarveTogether/{{CLUSTER_NAME}}"
mkdir -p "$CLUSTER_DIR/Master" "$CLUSTER_DIR/Caves"
if [ -n "{{CLUSTER_TOKEN}}" ]; then
  printf '%s' "{{CLUSTER_TOKEN}}" > "$CLUSTER_DIR/cluster_token.txt"
  echo "Cluster token written to $CLUSTER_DIR/cluster_token.txt"
else
  echo "WARNING: No cluster token set — the server will not start until"
  echo "         $CLUSTER_DIR/cluster_token.txt contains a valid Klei token."
fi

## Keep the server script reachable even if HOME differs at runtime
if [ ! -e "$HOME/.klei/DoNotStarveTogether" ]; then
  mkdir -p "$HOME/.klei"
  ln -sfn "$INSTALL_DIR/DoNotStarveTogether" "$HOME/.klei/DoNotStarveTogether" 2>/dev/null || true
fi

echo "Don't Starve Together server installed successfully"`,
    startCommand: `cd {{INSTALL_PATH}} && ./bin64/dontstarve_dedicated_server_nullrenderer_x64 -console -persistent_storage_root "{{INSTALL_PATH}}" -conf_dir DoNotStarveTogether -cluster {{CLUSTER_NAME}} -shard Master`,
    stopCommand: null,
    configFiles: { "DoNotStarveTogether/{{CLUSTER_NAME}}/cluster.ini": "cluster.ini" },
    defaultConfig: {
      cluster_name: "{{SERVER_NAME}}",
      max_players: "{{MAX_PLAYERS}}",
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // RACING
  // ═══════════════════════════════════════════════════════════════
  {
    slug: "assetto-corsa",
    name: "Assetto Corsa",
    engine: "Custom",
    defaultPort: 9600,
    // Installed via AssettoServer (GitHub), not SteamCMD — the AC app requires
    // an account that owns the game, so anonymous app_update always fails.
    steamAppId: null,
    iconEmoji: "🏎️",
    supportsIpv6: false,
    category: "Racing",
    description: "Realistic racing simulator",
    estimatedSize: "~15 GB",
    variables: [
      ...STEAM_VARS,
      V("Track", "TRACK", "Track name", "imola"),
      V("Admin Password", "ADMIN_PASSWORD", "Admin password", "", { type: "password" }),
    ],
    installScript: `#!/bin/bash
set -e
INSTALL_DIR="{{INSTALL_PATH}}"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

## AssettoServer is distributed from compujuckel/AssettoServer releases
case "$(uname -m)" in
  x86_64|amd64)  MATCH="linux-x64" ;;
  aarch64|arm64) MATCH="linux-arm64" ;;
  *) echo "ERROR: unsupported architecture for AssettoServer: $(uname -m)" >&2; exit 1 ;;
esac

LATEST_JSON=$(curl -fsSL --retry 3 "https://api.github.com/repos/compujuckel/AssettoServer/releases/latest")
DOWNLOAD_URL=$(echo "$LATEST_JSON" | grep -oP '"browser_download_url"\s*:\s*"\K[^"]+' | grep -- "-$MATCH\\.tar\\.gz" | head -1)

if [ -z "$DOWNLOAD_URL" ]; then
  echo "ERROR: could not find an AssettoServer release asset for: $MATCH" >&2
  exit 1
fi

echo "Downloading AssettoServer from: $DOWNLOAD_URL"
curl -fSL --retry 3 -o assetto-server-linux.tar.gz "$DOWNLOAD_URL"
tar xf assetto-server-linux.tar.gz
rm -f assetto-server-linux.tar.gz
chmod +x AssettoServer

## AssettoServer refuses to start when the admin password is shorter than 8 chars
ADMIN_PW="{{ADMIN_PASSWORD}}"
if [ \${#ADMIN_PW} -lt 8 ]; then
  ADMIN_PW=$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \\n' | cut -c1-12)
  echo "NOTE: Admin password was empty/too short — generated: $ADMIN_PW"
fi

mkdir -p cfg/
if [ ! -f "cfg/server_cfg.ini" ]; then
  cat > cfg/server_cfg.ini << EOF
[SERVER]
NAME={{SERVER_NAME}}
PASSWORD=
ADMIN_PASSWORD=$ADMIN_PW
UDP_PORT={{PORT}}
TCP_PORT={{PORT}}
MAX_CLIENTS={{MAX_PLAYERS}}
TRACK={{TRACK}}
EOF
fi
[ -f "cfg/entry_list.ini" ] || touch cfg/entry_list.ini

## NOTE: AssettoServer needs Assetto Corsa game content (content/ folder with
## car & track files) to actually load sessions. Upload it via the Files panel
## after install, otherwise the server starts but every track fails to load.
if [ ! -d content ]; then
  echo "WARNING: no Assetto Corsa content/ folder found."
  echo "         Upload the game's content via the Files panel before starting."
fi

echo "Assetto Corsa server installed successfully"`,
    startCommand: `cd {{INSTALL_PATH}} && ./AssettoServer`,
    stopCommand: null,
    configFiles: { "cfg/server_cfg.ini": "server_cfg.ini" },
    defaultConfig: {
      NAME: "{{SERVER_NAME}}",
      MAX_CLIENTS: "{{MAX_PLAYERS}}",
      TRACK: "{{TRACK}}",
      ADMIN_PASSWORD: "{{ADMIN_PASSWORD}}",
    },
  },
];

export const EXPECTED_ARTIFACTS_BY_SLUG: Record<string, string[]> = {
  "minecraft-java": ["server.jar"],
  "minecraft-paper": ["server.jar"],
  "minecraft-bedrock": ["bedrock_server"],
  "cs2": ["game/bin/linuxsteamrt64/cs2"],
  "tf2": ["srcds_run"],
  "gmod": ["srcds_run"],
  "l4d2": ["srcds_run"],
  "rust": ["RustDedicated"],
  "ark": ["ShooterGame/Binaries/Linux/ShooterGameServer"],
  "valheim": ["valheim_server.x86_64"],
  "7dtd": ["7DaysToDieServer.x86_64"],
  "palworld": ["PalServer.sh"],
  "satisfactory": ["Engine/Binaries/Linux/*-Linux-Shipping"],
  "terraria": ["TShock.Server"],
  "enshrouded": ["enshrouded_server"],
  "insurgency-sandstorm": ["Insurgency/Binaries/Linux/InsurgencyServer-Linux-Shipping"],
  "squad": ["SquadGame/Binaries/Linux/SquadGameServer*"],
  "arma3": ["arma3server_x64"],
  "wolfenstein-et": ["etlded", "etmain/pak0.pk3"],
  "openra": ["OpenRA.AppImage|openra-extracted/AppRun"],
  "quake-live": ["run_server_x64.sh"],
  "xonotic": ["xonotic-linux64-dedicated"],
  "vrising": ["VRisingServer.exe"],
  "project-zomboid": ["start-server.sh"],
  "factorio": ["bin/x64/factorio"],
  "dont-starve-together": ["bin64/dontstarve_dedicated_server_nullrenderer_x64"],
  "assetto-corsa": ["AssettoServer"],
};

export function getExpectedArtifactsBySlug(slug: string): string[] {
  return EXPECTED_ARTIFACTS_BY_SLUG[slug] || [];
}

// Helper to get templates by category
export function getTemplatesByCategory(): Record<string, GameTemplate[]> {
  const byCategory: Record<string, GameTemplate[]> = {};
  for (const template of gameTemplates) {
    if (!byCategory[template.category]) {
      byCategory[template.category] = [];
    }
    byCategory[template.category].push(template);
  }
  return byCategory;
}

// Helper to get a single template by slug
export function getTemplateBySlug(slug: string): GameTemplate | undefined {
  const t = gameTemplates.find((template) => template.slug === slug);
  return t ? { ...t, expectedArtifacts: getExpectedArtifactsBySlug(slug) } : undefined;
}
