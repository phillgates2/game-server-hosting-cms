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
}

// Unified variable format compatible with both Pterodactyl eggs and AMP templates
export interface TemplateVariable {
  // Core (required)
  name: string;                    // Pterodactyl: name, AMP: DisplayName
  description: string;             // Pterodactyl: description, AMP: Description
  env_variable: string;            // Pterodactyl: env_variable, AMP: FieldName
  default_value: string;           // Pterodactyl: default_value, AMP: DefaultValue
  // Access control
  user_viewable: boolean;          // Pterodactyl: user_viewable, AMP: !Hidden
  user_editable: boolean;          // Pterodactyl: user_editable
  // Validation
  rules: string;                   // Pterodactyl: rules (Laravel-style: "required|integer|between:1,65535")
  field_type: "text" | "number" | "password" | "select" | "checkbox" | "hidden";
  // AMP-specific extensions
  category?: string;               // AMP: Category (e.g., "Server Settings")
  subcategory?: string;            // AMP: Subcategory
  keywords?: string;               // AMP: Keywords (comma-separated for search)
  enum_values?: Record<string, string>; // AMP: EnumValues (value → label for select dropdowns)
  min_value?: number;              // AMP: MinValue
  max_value?: number;              // AMP: MaxValue
  // Config file binding (AMP-style)
  param_field_name?: string;       // AMP: ParamFieldName (key in config file)
}

// Helper to define variables — supports both Pterodactyl and AMP styles
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

## Install Java runtime if not present
if ! command -v java &> /dev/null; then
  apt-get update -qq && apt-get install -y -qq openjdk-21-jre-headless
fi

## Download latest Minecraft server JAR
MANIFEST_URL="https://launchermeta.mojang.com/mc/game/version_manifest.json"
LATEST=$(curl -sSL "$MANIFEST_URL" | grep -oP '"release"\s*:\s*"\K[^"]+' | head -1)
echo "Latest Minecraft version: $LATEST"

VERSION_JSON_URL=$(curl -sSL "$MANIFEST_URL" | grep -oP "\"$LATEST\"\s*:\s*\{[^}]*\"url\"\s*:\s*\"\K[^\"]+")
SERVER_URL=$(curl -sSL "$VERSION_JSON_URL" | grep -oP '"server"\s*:\s*\{[^}]*"url"\s*:\s*"\K[^"]+')

echo "Downloading Minecraft $LATEST server..."
curl -sSL -o server.jar "$SERVER_URL"

## Accept EULA
echo "eula=true" > eula.txt

echo "Minecraft Java server installed successfully"
`,
    startCommand: `cd {{INSTALL_PATH}} && java -Xms1G -Xmx{{MAX_RAM}}G -jar server.jar nogui --port {{PORT}}`,
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

## Install Java if not present
if ! command -v java &> /dev/null; then
  apt-get update -qq && apt-get install -y -qq openjdk-21-jre-headless
fi

## Download Paper server
PROJECT=paper
PAPER_API="https://api.papermc.io/v2/projects/\${PROJECT}"
LATEST_VERSION=$(curl -sSL "$PAPER_API" | grep -oP '"versions"\s*:\s*\[[^\]]*\]' | grep -oP '[0-9][0-9.]*' | tail -1)
LATEST_BUILD=$(curl -sSL "$PAPER_API/versions/$LATEST_VERSION" | grep -oP '"builds"\s*:\s*\[[^\]]*\]' | grep -oP '[0-9]+' | tail -1)
JAR_NAME="\${PROJECT}-\${LATEST_VERSION}-\${LATEST_BUILD}.jar"

echo "Downloading Paper $LATEST_VERSION build $LATEST_BUILD..."
curl -sSL -o server.jar "$PAPER_API/versions/$LATEST_VERSION/builds/$LATEST_BUILD/downloads/$JAR_NAME"

## Accept EULA
echo "eula=true" > eula.txt

## Download default server.properties if missing
if [ ! -f server.properties ]; then
  echo "server-port={{PORT}}" > server.properties
  echo "max-players={{MAX_PLAYERS}}" >> server.properties
fi

echo "Paper server installed successfully"
`,
    startCommand: `cd {{INSTALL_PATH}} && java -Xms1G -Xmx{{MAX_RAM}}G -XX:+UseG1GC -jar server.jar nogui --port {{PORT}}`,
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

## Download Bedrock server
echo "Downloading Minecraft Bedrock Dedicated Server..."
DOWNLOAD_URL=$(curl -sSL "https://www.minecraft.net/en-us/download/server/bedrock" | grep -oP 'https://minecraft\.azureedge\.net/bin-linux/[^"]+' | head -1)

if [ -z "$DOWNLOAD_URL" ]; then
  echo "Could not find download URL, using latest known version..."
  DOWNLOAD_URL="https://minecraft.azureedge.net/bin-linux/bedrock-server-1.21.62.01.zip"
fi

curl -sSL -o bedrock-server.zip "$DOWNLOAD_URL"
unzip -o bedrock-server.zip
rm -f bedrock-server.zip
chmod +x bedrock_server

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
INSTALL_DIR="{INSTALL_PATH}"
STEAM_APPID="730"

## Download and install SteamCMD
cd /tmp
curl -sSL -o steamcmd.tar.gz https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz
mkdir -p "$INSTALL_DIR/steamcmd"
tar -xzf steamcmd.tar.gz -C "$INSTALL_DIR/steamcmd"
rm steamcmd.tar.gz

cd "$INSTALL_DIR/steamcmd"

# SteamCMD workaround
chown -R $(whoami) "$INSTALL_DIR"
export HOME="$INSTALL_DIR"

## Install game server
echo "Installing Counter-Strike 2 (AppID: $STEAM_APPID)..."
./steamcmd.sh +force_install_dir "$INSTALL_DIR" +login anonymous +app_update $STEAM_APPID validate +quit

## Set up Steam SDK libraries
mkdir -p "$INSTALL_DIR/.steam/sdk32" "$INSTALL_DIR/.steam/sdk64"
cp -v "$INSTALL_DIR/steamcmd/linux32/steamclient.so" "$INSTALL_DIR/.steam/sdk32/steamclient.so" 2>/dev/null || true
cp -v "$INSTALL_DIR/steamcmd/linux64/steamclient.so" "$INSTALL_DIR/.steam/sdk64/steamclient.so" 2>/dev/null || true

echo "Counter-Strike 2 server installed successfully"`,
    startCommand: `cd {{INSTALL_PATH}} && ./cs2 -dedicated -port {{PORT}} +game_type {{GAME_TYPE}} +game_mode {{GAME_MODE}} +map {{MAP}} +sv_setsteamaccount {{GSLT_TOKEN}}`,
    stopCommand: "quit",
    configFiles: { "game/csgo/cfg/server.cfg": "server.cfg" },
    defaultConfig: {
      hostname: "{{SERVER_NAME}}",
      rcon_password: "{{RCON_PASSWORD}}",
      sv_cheats: "0",
    },
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
INSTALL_DIR="{INSTALL_PATH}"
STEAM_APPID="232250"

## Download and install SteamCMD
cd /tmp
curl -sSL -o steamcmd.tar.gz https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz
mkdir -p "$INSTALL_DIR/steamcmd"
tar -xzf steamcmd.tar.gz -C "$INSTALL_DIR/steamcmd"
rm steamcmd.tar.gz

cd "$INSTALL_DIR/steamcmd"

# SteamCMD workaround
chown -R $(whoami) "$INSTALL_DIR"
export HOME="$INSTALL_DIR"

## Install game server
echo "Installing Team Fortress 2 (AppID: $STEAM_APPID)..."
./steamcmd.sh +force_install_dir "$INSTALL_DIR" +login anonymous +app_update $STEAM_APPID validate +quit

## Set up Steam SDK libraries
mkdir -p "$INSTALL_DIR/.steam/sdk32" "$INSTALL_DIR/.steam/sdk64"
cp -v "$INSTALL_DIR/steamcmd/linux32/steamclient.so" "$INSTALL_DIR/.steam/sdk32/steamclient.so" 2>/dev/null || true
cp -v "$INSTALL_DIR/steamcmd/linux64/steamclient.so" "$INSTALL_DIR/.steam/sdk64/steamclient.so" 2>/dev/null || true

echo "Team Fortress 2 server installed successfully"`,
    startCommand: `cd {{INSTALL_PATH}} && ./srcds_run -game tf -console -port {{PORT}} +maxplayers {{MAX_PLAYERS}} +map {{MAP}}`,
    stopCommand: "quit",
    configFiles: { "tf/cfg/server.cfg": "server.cfg" },
    defaultConfig: {
      hostname: "{{SERVER_NAME}}",
      rcon_password: "{{RCON_PASSWORD}}",
      sv_pure: "1",
    },
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
INSTALL_DIR="{INSTALL_PATH}"
STEAM_APPID="4020"

## Download and install SteamCMD
cd /tmp
curl -sSL -o steamcmd.tar.gz https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz
mkdir -p "$INSTALL_DIR/steamcmd"
tar -xzf steamcmd.tar.gz -C "$INSTALL_DIR/steamcmd"
rm steamcmd.tar.gz

cd "$INSTALL_DIR/steamcmd"

# SteamCMD workaround
chown -R $(whoami) "$INSTALL_DIR"
export HOME="$INSTALL_DIR"

## Install game server
echo "Installing Garry's Mod (AppID: $STEAM_APPID)..."
./steamcmd.sh +force_install_dir "$INSTALL_DIR" +login anonymous +app_update $STEAM_APPID validate +quit

## Set up Steam SDK libraries
mkdir -p "$INSTALL_DIR/.steam/sdk32" "$INSTALL_DIR/.steam/sdk64"
cp -v "$INSTALL_DIR/steamcmd/linux32/steamclient.so" "$INSTALL_DIR/.steam/sdk32/steamclient.so" 2>/dev/null || true
cp -v "$INSTALL_DIR/steamcmd/linux64/steamclient.so" "$INSTALL_DIR/.steam/sdk64/steamclient.so" 2>/dev/null || true

echo "Garry's Mod server installed successfully"`,
    startCommand: `cd {{INSTALL_PATH}} && ./srcds_run -game garrysmod -console -port {{PORT}} +maxplayers {{MAX_PLAYERS}} +map {{MAP}} +gamemode {{GAMEMODE}}`,
    stopCommand: "quit",
    configFiles: { "garrysmod/cfg/server.cfg": "server.cfg" },
    defaultConfig: {
      hostname: "{{SERVER_NAME}}",
      rcon_password: "{{RCON_PASSWORD}}",
      sv_defaultgamemode: "{{GAMEMODE}}",
    },
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
INSTALL_DIR="{INSTALL_PATH}"
STEAM_APPID="222860"

## Download and install SteamCMD
cd /tmp
curl -sSL -o steamcmd.tar.gz https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz
mkdir -p "$INSTALL_DIR/steamcmd"
tar -xzf steamcmd.tar.gz -C "$INSTALL_DIR/steamcmd"
rm steamcmd.tar.gz

cd "$INSTALL_DIR/steamcmd"

# SteamCMD workaround
chown -R $(whoami) "$INSTALL_DIR"
export HOME="$INSTALL_DIR"

## Install game server
echo "Installing Left 4 Dead 2 (AppID: $STEAM_APPID)..."
./steamcmd.sh +force_install_dir "$INSTALL_DIR" +login anonymous +app_update $STEAM_APPID validate +quit

## Set up Steam SDK libraries
mkdir -p "$INSTALL_DIR/.steam/sdk32" "$INSTALL_DIR/.steam/sdk64"
cp -v "$INSTALL_DIR/steamcmd/linux32/steamclient.so" "$INSTALL_DIR/.steam/sdk32/steamclient.so" 2>/dev/null || true
cp -v "$INSTALL_DIR/steamcmd/linux64/steamclient.so" "$INSTALL_DIR/.steam/sdk64/steamclient.so" 2>/dev/null || true

echo "Left 4 Dead 2 server installed successfully"`,
    startCommand: `cd {{INSTALL_PATH}} && ./srcds_run -game left4dead2 -console -port {{PORT}} +map {{MAP}}`,
    stopCommand: "quit",
    configFiles: { "left4dead2/cfg/server.cfg": "server.cfg" },
    defaultConfig: {
      hostname: "{{SERVER_NAME}}",
      rcon_password: "{{RCON_PASSWORD}}",
    },
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
INSTALL_DIR="{INSTALL_PATH}"
STEAM_APPID="258550"

## Download and install SteamCMD
cd /tmp
curl -sSL -o steamcmd.tar.gz https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz
mkdir -p "$INSTALL_DIR/steamcmd"
tar -xzf steamcmd.tar.gz -C "$INSTALL_DIR/steamcmd"
rm steamcmd.tar.gz

cd "$INSTALL_DIR/steamcmd"

# SteamCMD workaround
chown -R $(whoami) "$INSTALL_DIR"
export HOME="$INSTALL_DIR"

## Install game server
echo "Installing Rust (AppID: $STEAM_APPID)..."
./steamcmd.sh +force_install_dir "$INSTALL_DIR" +login anonymous +app_update $STEAM_APPID validate +quit

## Set up Steam SDK libraries
mkdir -p "$INSTALL_DIR/.steam/sdk32" "$INSTALL_DIR/.steam/sdk64"
cp -v "$INSTALL_DIR/steamcmd/linux32/steamclient.so" "$INSTALL_DIR/.steam/sdk32/steamclient.so" 2>/dev/null || true
cp -v "$INSTALL_DIR/steamcmd/linux64/steamclient.so" "$INSTALL_DIR/.steam/sdk64/steamclient.so" 2>/dev/null || true

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
INSTALL_DIR="{INSTALL_PATH}"
STEAM_APPID="376030"

## Download and install SteamCMD
cd /tmp
curl -sSL -o steamcmd.tar.gz https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz
mkdir -p "$INSTALL_DIR/steamcmd"
tar -xzf steamcmd.tar.gz -C "$INSTALL_DIR/steamcmd"
rm steamcmd.tar.gz

cd "$INSTALL_DIR/steamcmd"

# SteamCMD workaround
chown -R $(whoami) "$INSTALL_DIR"
export HOME="$INSTALL_DIR"

## Install game server
echo "Installing ARK: Survival Evolved (AppID: $STEAM_APPID)..."
./steamcmd.sh +force_install_dir "$INSTALL_DIR" +login anonymous +app_update $STEAM_APPID validate +quit

## Set up Steam SDK libraries
mkdir -p "$INSTALL_DIR/.steam/sdk32" "$INSTALL_DIR/.steam/sdk64"
cp -v "$INSTALL_DIR/steamcmd/linux32/steamclient.so" "$INSTALL_DIR/.steam/sdk32/steamclient.so" 2>/dev/null || true
cp -v "$INSTALL_DIR/steamcmd/linux64/steamclient.so" "$INSTALL_DIR/.steam/sdk64/steamclient.so" 2>/dev/null || true

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
INSTALL_DIR="{INSTALL_PATH}"
STEAM_APPID="896660"

## Download and install SteamCMD
cd /tmp
curl -sSL -o steamcmd.tar.gz https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz
mkdir -p "$INSTALL_DIR/steamcmd"
tar -xzf steamcmd.tar.gz -C "$INSTALL_DIR/steamcmd"
rm steamcmd.tar.gz

cd "$INSTALL_DIR/steamcmd"

# SteamCMD workaround
chown -R $(whoami) "$INSTALL_DIR"
export HOME="$INSTALL_DIR"

## Install game server
echo "Installing Valheim (AppID: $STEAM_APPID)..."
./steamcmd.sh +force_install_dir "$INSTALL_DIR" +login anonymous +app_update $STEAM_APPID validate +quit

## Set up Steam SDK libraries
mkdir -p "$INSTALL_DIR/.steam/sdk32" "$INSTALL_DIR/.steam/sdk64"
cp -v "$INSTALL_DIR/steamcmd/linux32/steamclient.so" "$INSTALL_DIR/.steam/sdk32/steamclient.so" 2>/dev/null || true
cp -v "$INSTALL_DIR/steamcmd/linux64/steamclient.so" "$INSTALL_DIR/.steam/sdk64/steamclient.so" 2>/dev/null || true

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
INSTALL_DIR="{INSTALL_PATH}"
STEAM_APPID="294420"

## Download and install SteamCMD
cd /tmp
curl -sSL -o steamcmd.tar.gz https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz
mkdir -p "$INSTALL_DIR/steamcmd"
tar -xzf steamcmd.tar.gz -C "$INSTALL_DIR/steamcmd"
rm steamcmd.tar.gz

cd "$INSTALL_DIR/steamcmd"

# SteamCMD workaround
chown -R $(whoami) "$INSTALL_DIR"
export HOME="$INSTALL_DIR"

## Install game server
echo "Installing 7 Days to Die (AppID: $STEAM_APPID)..."
./steamcmd.sh +force_install_dir "$INSTALL_DIR" +login anonymous +app_update $STEAM_APPID validate +quit

## Set up Steam SDK libraries
mkdir -p "$INSTALL_DIR/.steam/sdk32" "$INSTALL_DIR/.steam/sdk64"
cp -v "$INSTALL_DIR/steamcmd/linux32/steamclient.so" "$INSTALL_DIR/.steam/sdk32/steamclient.so" 2>/dev/null || true
cp -v "$INSTALL_DIR/steamcmd/linux64/steamclient.so" "$INSTALL_DIR/.steam/sdk64/steamclient.so" 2>/dev/null || true

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
INSTALL_DIR="{INSTALL_PATH}"
STEAM_APPID="2394010"

## Download and install SteamCMD
cd /tmp
curl -sSL -o steamcmd.tar.gz https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz
mkdir -p "$INSTALL_DIR/steamcmd"
tar -xzf steamcmd.tar.gz -C "$INSTALL_DIR/steamcmd"
rm steamcmd.tar.gz

cd "$INSTALL_DIR/steamcmd"

# SteamCMD workaround
chown -R $(whoami) "$INSTALL_DIR"
export HOME="$INSTALL_DIR"

## Install game server
echo "Installing Palworld (AppID: $STEAM_APPID)..."
./steamcmd.sh +force_install_dir "$INSTALL_DIR" +login anonymous +app_update $STEAM_APPID validate +quit

## Set up Steam SDK libraries
mkdir -p "$INSTALL_DIR/.steam/sdk32" "$INSTALL_DIR/.steam/sdk64"
cp -v "$INSTALL_DIR/steamcmd/linux32/steamclient.so" "$INSTALL_DIR/.steam/sdk32/steamclient.so" 2>/dev/null || true
cp -v "$INSTALL_DIR/steamcmd/linux64/steamclient.so" "$INSTALL_DIR/.steam/sdk64/steamclient.so" 2>/dev/null || true

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
INSTALL_DIR="{INSTALL_PATH}"
STEAM_APPID="1690800"

## Download and install SteamCMD
cd /tmp
curl -sSL -o steamcmd.tar.gz https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz
mkdir -p "$INSTALL_DIR/steamcmd"
tar -xzf steamcmd.tar.gz -C "$INSTALL_DIR/steamcmd"
rm steamcmd.tar.gz

cd "$INSTALL_DIR/steamcmd"

# SteamCMD workaround
chown -R $(whoami) "$INSTALL_DIR"
export HOME="$INSTALL_DIR"

## Install game server
echo "Installing Satisfactory (AppID: $STEAM_APPID)..."
./steamcmd.sh +force_install_dir "$INSTALL_DIR" +login anonymous +app_update $STEAM_APPID validate +quit

## Set up Steam SDK libraries
mkdir -p "$INSTALL_DIR/.steam/sdk32" "$INSTALL_DIR/.steam/sdk64"
cp -v "$INSTALL_DIR/steamcmd/linux32/steamclient.so" "$INSTALL_DIR/.steam/sdk32/steamclient.so" 2>/dev/null || true
cp -v "$INSTALL_DIR/steamcmd/linux64/steamclient.so" "$INSTALL_DIR/.steam/sdk64/steamclient.so" 2>/dev/null || true

echo "Satisfactory server installed successfully"`,
    startCommand: `cd {{INSTALL_PATH}} && ./FactoryServer.sh -Port={{PORT}} -ServerQueryPort={{QUERY_PORT}} -BeaconPort={{BEACON_PORT}} -log -unattended`,
    stopCommand: null,
    configFiles: { "FactoryGame/Saved/Config/LinuxServer/ServerSettings.ini": "ServerSettings.ini" },
    defaultConfig: {},
  },
  {
    slug: "terraria",
    name: "Terraria (TShock)",
    engine: "Custom (Re-Logic)",
    defaultPort: 7777,
    steamAppId: "105600",
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

## Download latest TShock release from GitHub
echo "Fetching latest TShock release..."
LATEST_URL=$(curl -sSL "https://api.github.com/repos/Pryaxis/TShock/releases/latest" | grep -oP '"browser_download_url"\s*:\s*"\K[^"]*linux[^"]*' | head -1)

if [ -z "$LATEST_URL" ]; then
  echo "Could not find TShock Linux download, trying zip..."
  LATEST_URL=$(curl -sSL "https://api.github.com/repos/Pryaxis/TShock/releases/latest" | grep -oP '"browser_download_url"\s*:\s*"\K[^"]*\.zip[^"]*' | head -1)
fi

echo "Downloading TShock from: $LATEST_URL"
curl -sSL -o tshock.zip "$LATEST_URL"
unzip -o tshock.zip
rm -f tshock.zip
chmod +x TShock.Server 2>/dev/null || true

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
INSTALL_DIR="{INSTALL_PATH}"
STEAM_APPID="2278520"

## Download and install SteamCMD
cd /tmp
curl -sSL -o steamcmd.tar.gz https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz
mkdir -p "$INSTALL_DIR/steamcmd"
tar -xzf steamcmd.tar.gz -C "$INSTALL_DIR/steamcmd"
rm steamcmd.tar.gz

cd "$INSTALL_DIR/steamcmd"

# SteamCMD workaround
chown -R $(whoami) "$INSTALL_DIR"
export HOME="$INSTALL_DIR"

## Install game server
echo "Installing Enshrouded (AppID: $STEAM_APPID)..."
./steamcmd.sh +force_install_dir "$INSTALL_DIR" +login anonymous +app_update $STEAM_APPID validate +quit

## Set up Steam SDK libraries
mkdir -p "$INSTALL_DIR/.steam/sdk32" "$INSTALL_DIR/.steam/sdk64"
cp -v "$INSTALL_DIR/steamcmd/linux32/steamclient.so" "$INSTALL_DIR/.steam/sdk32/steamclient.so" 2>/dev/null || true
cp -v "$INSTALL_DIR/steamcmd/linux64/steamclient.so" "$INSTALL_DIR/.steam/sdk64/steamclient.so" 2>/dev/null || true

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
INSTALL_DIR="{INSTALL_PATH}"
STEAM_APPID="581330"

## Download and install SteamCMD
cd /tmp
curl -sSL -o steamcmd.tar.gz https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz
mkdir -p "$INSTALL_DIR/steamcmd"
tar -xzf steamcmd.tar.gz -C "$INSTALL_DIR/steamcmd"
rm steamcmd.tar.gz

cd "$INSTALL_DIR/steamcmd"

# SteamCMD workaround
chown -R $(whoami) "$INSTALL_DIR"
export HOME="$INSTALL_DIR"

## Install game server
echo "Installing Insurgency: Sandstorm (AppID: $STEAM_APPID)..."
./steamcmd.sh +force_install_dir "$INSTALL_DIR" +login anonymous +app_update $STEAM_APPID validate +quit

## Set up Steam SDK libraries
mkdir -p "$INSTALL_DIR/.steam/sdk32" "$INSTALL_DIR/.steam/sdk64"
cp -v "$INSTALL_DIR/steamcmd/linux32/steamclient.so" "$INSTALL_DIR/.steam/sdk32/steamclient.so" 2>/dev/null || true
cp -v "$INSTALL_DIR/steamcmd/linux64/steamclient.so" "$INSTALL_DIR/.steam/sdk64/steamclient.so" 2>/dev/null || true

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
INSTALL_DIR="{INSTALL_PATH}"
STEAM_APPID="403240"

## Download and install SteamCMD
cd /tmp
curl -sSL -o steamcmd.tar.gz https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz
mkdir -p "$INSTALL_DIR/steamcmd"
tar -xzf steamcmd.tar.gz -C "$INSTALL_DIR/steamcmd"
rm steamcmd.tar.gz

cd "$INSTALL_DIR/steamcmd"

# SteamCMD workaround
chown -R $(whoami) "$INSTALL_DIR"
export HOME="$INSTALL_DIR"

## Install game server
echo "Installing Squad (AppID: $STEAM_APPID)..."
./steamcmd.sh +force_install_dir "$INSTALL_DIR" +login anonymous +app_update $STEAM_APPID validate +quit

## Set up Steam SDK libraries
mkdir -p "$INSTALL_DIR/.steam/sdk32" "$INSTALL_DIR/.steam/sdk64"
cp -v "$INSTALL_DIR/steamcmd/linux32/steamclient.so" "$INSTALL_DIR/.steam/sdk32/steamclient.so" 2>/dev/null || true
cp -v "$INSTALL_DIR/steamcmd/linux64/steamclient.so" "$INSTALL_DIR/.steam/sdk64/steamclient.so" 2>/dev/null || true

echo "Squad server installed successfully"`,
    startCommand: `cd {{INSTALL_PATH}} && ./SquadGameServer.sh Port={{PORT}} QueryPort={{QUERY_PORT}} FIXEDMAXPLAYERS={{MAX_PLAYERS}}`,
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
INSTALL_DIR="{INSTALL_PATH}"
STEAM_APPID="233780"

## Download and install SteamCMD
cd /tmp
curl -sSL -o steamcmd.tar.gz https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz
mkdir -p "$INSTALL_DIR/steamcmd"
tar -xzf steamcmd.tar.gz -C "$INSTALL_DIR/steamcmd"
rm steamcmd.tar.gz

cd "$INSTALL_DIR/steamcmd"

# SteamCMD workaround
chown -R $(whoami) "$INSTALL_DIR"
export HOME="$INSTALL_DIR"

## Install game server
echo "Installing Arma 3 (AppID: $STEAM_APPID)..."
./steamcmd.sh +force_install_dir "$INSTALL_DIR" +login anonymous +app_update $STEAM_APPID validate +quit

## Set up Steam SDK libraries
mkdir -p "$INSTALL_DIR/.steam/sdk32" "$INSTALL_DIR/.steam/sdk64"
cp -v "$INSTALL_DIR/steamcmd/linux32/steamclient.so" "$INSTALL_DIR/.steam/sdk32/steamclient.so" 2>/dev/null || true
cp -v "$INSTALL_DIR/steamcmd/linux64/steamclient.so" "$INSTALL_DIR/.steam/sdk64/steamclient.so" 2>/dev/null || true

echo "Arma 3 server installed successfully"`,
    startCommand: `cd {{INSTALL_PATH}} && ./arma3server_x64 -port={{PORT}} -config=server.cfg -profiles=profiles`,
    stopCommand: null,
    configFiles: { "server.cfg": "server.cfg" },
    defaultConfig: {
      hostname: "{{SERVER_NAME}}",
      maxPlayers: "{{MAX_PLAYERS}}",
      password: "{{SERVER_PASSWORD}}",
      passwordAdmin: "{{ADMIN_PASSWORD}}",
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // CLASSIC / RETRO
  // ═══════════════════════════════════════════════════════════════
  {
    slug: "wolfenstein-et",
    name: "Wolfenstein: Enemy Territory / ET:Legacy",
    engine: "id Tech 3",
    defaultPort: 27960,
    steamAppId: null,
    iconEmoji: "🐺",
    supportsIpv6: true,
    category: "Classic",
    description: "Free WWII multiplayer FPS classic",
    estimatedSize: "~500 MB",
    variables: [
      ...COMMON_VARS,
      V("Game Type", "GAMETYPE", "2=Objective, 3=Stopwatch, 4=Campaign", "2", { required: false, type: "number" }),
    ],
    installScript: `#!/bin/bash
set -e
INSTALL_DIR="{{INSTALL_PATH}}"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# Detect architecture
ARCH=$(uname -m)
echo "Detected architecture: $ARCH"

# Download ET:Legacy archive (not the .sh installer — archives work on all systems)
if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
  echo "Downloading ET:Legacy AArch64 archive..."
  curl -L -o etlegacy.tar.gz "https://www.etlegacy.com/download/file/711"
elif [ "$ARCH" = "x86_64" ]; then
  echo "Downloading ET:Legacy x86_64 archive..."
  curl -L -o etlegacy.tar.gz "https://www.etlegacy.com/download/file/707"
else
  echo "Downloading ET:Legacy i386 archive..."
  curl -L -o etlegacy.tar.gz "https://www.etlegacy.com/download/file/705"
fi

echo "Extracting..."
tar xzf etlegacy.tar.gz --strip-components=1 2>/dev/null || tar xzf etlegacy.tar.gz 2>/dev/null || {
  echo "tar.gz extraction failed, trying as zip..."
  unzip -o etlegacy.tar.gz 2>/dev/null || true
  # Move files from subdirectory if extracted into one
  for d in etlegacy-*/; do
    if [ -d "$d" ]; then
      cp -r "$d"* . 2>/dev/null || true
      rm -rf "$d"
    fi
  done
}
rm -f etlegacy.tar.gz

# Download base game assets (pak0.pk3)
mkdir -p etmain
if [ ! -f etmain/pak0.pk3 ]; then
  echo "Downloading Wolfenstein ET base assets from ET:Legacy mirror..."
  curl -L -o etmain/pak0.pk3 "https://mirror.etlegacy.com/etmain/pak0.pk3"
fi
if [ ! -f etmain/pak1.pk3 ]; then
  curl -L -o etmain/pak1.pk3 "https://mirror.etlegacy.com/etmain/pak1.pk3"
fi
if [ ! -f etmain/pak2.pk3 ]; then
  curl -L -o etmain/pak2.pk3 "https://mirror.etlegacy.com/etmain/pak2.pk3"
fi

# Make server binary executable
chmod +x etlded* 2>/dev/null || true
ls -la etlded* 2>/dev/null || echo "Warning: etlded binary not found — check the extracted files"

echo "ET:Legacy installed successfully"`,
    startCommand: `cd {{INSTALL_PATH}} && ./etlded +set dedicated 2 +set net_port {{PORT}} +set fs_game etmain +set sv_hostname "{{SERVER_NAME}}" +set sv_maxclients {{MAX_PLAYERS}} +set g_gametype {{GAMETYPE}} +exec server.cfg`,
    stopCommand: null,
    configFiles: { "etmain/server.cfg": "server.cfg" },
    defaultConfig: {},
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

echo "Fetching latest OpenRA release info..."
RELEASE=$(curl -s https://api.github.com/repos/OpenRA/OpenRA/releases/latest | grep tag_name | cut -d '"' -f4)
echo "Latest release: $RELEASE"

echo "Downloading OpenRA $RELEASE AppImage..."
curl -L -o OpenRA.AppImage "https://github.com/OpenRA/OpenRA/releases/download/$RELEASE/OpenRA-$RELEASE-x86_64.AppImage" || {
  echo "AppImage download failed, trying .tar.gz..."
  curl -L -o openra.tar.gz "https://github.com/OpenRA/OpenRA/releases/download/$RELEASE/OpenRA-$RELEASE-linux-x64.tar.gz"
  tar xzf openra.tar.gz
  rm -f openra.tar.gz
  echo "OpenRA installed successfully"
  exit 0
}

chmod +x OpenRA.AppImage

echo "Extracting AppImage..."
./OpenRA.AppImage --appimage-extract 2>/dev/null || {
  echo "AppImage extract failed (may need FUSE). Trying alternative method..."
  # Manual extract without FUSE
  offset=$(grep -aobm1 'hsqs' OpenRA.AppImage | head -1 | cut -d: -f1)
  if [ -n "$offset" ]; then
    apt-get install -y -qq squashfs-tools 2>/dev/null || true
    dd if=OpenRA.AppImage bs=1 skip=$offset of=openra.squashfs 2>/dev/null
    unsquashfs -d openra-extracted openra.squashfs 2>/dev/null
    rm -f openra.squashfs
  fi
}

if [ -d "squashfs-root" ]; then
  mv squashfs-root openra-extracted
fi
rm -f OpenRA.AppImage

echo "OpenRA installed successfully"`,
    startCommand: `cd {{INSTALL_PATH}}/openra-extracted && mono OpenRA.Server.exe Game.Mod={{GAME_MOD}} Server.Name="{{SERVER_NAME}}" Server.ListenPort={{PORT}}`,
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
INSTALL_DIR="{INSTALL_PATH}"
STEAM_APPID="349090"

## Download and install SteamCMD
cd /tmp
curl -sSL -o steamcmd.tar.gz https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz
mkdir -p "$INSTALL_DIR/steamcmd"
tar -xzf steamcmd.tar.gz -C "$INSTALL_DIR/steamcmd"
rm steamcmd.tar.gz

cd "$INSTALL_DIR/steamcmd"

# SteamCMD workaround
chown -R $(whoami) "$INSTALL_DIR"
export HOME="$INSTALL_DIR"

## Install game server
echo "Installing Quake Live (AppID: $STEAM_APPID)..."
./steamcmd.sh +force_install_dir "$INSTALL_DIR" +login anonymous +app_update $STEAM_APPID validate +quit

## Set up Steam SDK libraries
mkdir -p "$INSTALL_DIR/.steam/sdk32" "$INSTALL_DIR/.steam/sdk64"
cp -v "$INSTALL_DIR/steamcmd/linux32/steamclient.so" "$INSTALL_DIR/.steam/sdk32/steamclient.so" 2>/dev/null || true
cp -v "$INSTALL_DIR/steamcmd/linux64/steamclient.so" "$INSTALL_DIR/.steam/sdk64/steamclient.so" 2>/dev/null || true

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
curl -sSL -o xonotic.zip "https://dl.xonotic.org/xonotic-0.8.6.zip"
unzip -o xonotic.zip
mv Xonotic/* . 2>/dev/null || true
rmdir Xonotic 2>/dev/null || true
rm -f xonotic.zip

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
INSTALL_DIR="{INSTALL_PATH}"
STEAM_APPID="1829350"

## Download and install SteamCMD
cd /tmp
curl -sSL -o steamcmd.tar.gz https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz
mkdir -p "$INSTALL_DIR/steamcmd"
tar -xzf steamcmd.tar.gz -C "$INSTALL_DIR/steamcmd"
rm steamcmd.tar.gz

cd "$INSTALL_DIR/steamcmd"

# SteamCMD workaround
chown -R $(whoami) "$INSTALL_DIR"
export HOME="$INSTALL_DIR"

## Install game server
echo "Installing V Rising (AppID: $STEAM_APPID)..."
./steamcmd.sh +force_install_dir "$INSTALL_DIR" +login anonymous +app_update $STEAM_APPID validate +quit

## Set up Steam SDK libraries
mkdir -p "$INSTALL_DIR/.steam/sdk32" "$INSTALL_DIR/.steam/sdk64"
cp -v "$INSTALL_DIR/steamcmd/linux32/steamclient.so" "$INSTALL_DIR/.steam/sdk32/steamclient.so" 2>/dev/null || true
cp -v "$INSTALL_DIR/steamcmd/linux64/steamclient.so" "$INSTALL_DIR/.steam/sdk64/steamclient.so" 2>/dev/null || true

echo "V Rising server installed successfully"`,
    startCommand: `cd {{INSTALL_PATH}} && ./VRisingServer.sh -persistentDataPath ./save-data -serverName "{{SERVER_NAME}}" -saveName "{{SAVE_NAME}}" -gamePort {{PORT}} -queryPort {{QUERY_PORT}}`,
    stopCommand: null,
    configFiles: { "VRisingServer_Data/StreamingAssets/Settings/ServerHostSettings.json": "ServerHostSettings.json" },
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
INSTALL_DIR="{INSTALL_PATH}"
STEAM_APPID="380870"

## Download and install SteamCMD
cd /tmp
curl -sSL -o steamcmd.tar.gz https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz
mkdir -p "$INSTALL_DIR/steamcmd"
tar -xzf steamcmd.tar.gz -C "$INSTALL_DIR/steamcmd"
rm steamcmd.tar.gz

cd "$INSTALL_DIR/steamcmd"

# SteamCMD workaround
chown -R $(whoami) "$INSTALL_DIR"
export HOME="$INSTALL_DIR"

## Install game server
echo "Installing Project Zomboid (AppID: $STEAM_APPID)..."
./steamcmd.sh +force_install_dir "$INSTALL_DIR" +login anonymous +app_update $STEAM_APPID validate +quit

## Set up Steam SDK libraries
mkdir -p "$INSTALL_DIR/.steam/sdk32" "$INSTALL_DIR/.steam/sdk64"
cp -v "$INSTALL_DIR/steamcmd/linux32/steamclient.so" "$INSTALL_DIR/.steam/sdk32/steamclient.so" 2>/dev/null || true
cp -v "$INSTALL_DIR/steamcmd/linux64/steamclient.so" "$INSTALL_DIR/.steam/sdk64/steamclient.so" 2>/dev/null || true

echo "Project Zomboid server installed successfully"`,
    startCommand: `cd {{INSTALL_PATH}} && ./start-server.sh -servername {{SERVER_NAME}}`,
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
curl -sSL -o factorio.tar.xz "https://factorio.com/get-download/stable/headless/linux64"
tar xf factorio.tar.xz --strip-components=1
rm -f factorio.tar.xz

## Create initial save
mkdir -p saves
if [ ! -f saves/world.zip ]; then
  echo "Creating initial world save..."
  ./bin/x64/factorio --create saves/world.zip
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
INSTALL_DIR="{INSTALL_PATH}"
STEAM_APPID="343050"

## Download and install SteamCMD
cd /tmp
curl -sSL -o steamcmd.tar.gz https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz
mkdir -p "$INSTALL_DIR/steamcmd"
tar -xzf steamcmd.tar.gz -C "$INSTALL_DIR/steamcmd"
rm steamcmd.tar.gz

cd "$INSTALL_DIR/steamcmd"

# SteamCMD workaround
chown -R $(whoami) "$INSTALL_DIR"
export HOME="$INSTALL_DIR"

## Install game server
echo "Installing Don't Starve Together (AppID: $STEAM_APPID)..."
./steamcmd.sh +force_install_dir "$INSTALL_DIR" +login anonymous +app_update $STEAM_APPID validate +quit

## Set up Steam SDK libraries
mkdir -p "$INSTALL_DIR/.steam/sdk32" "$INSTALL_DIR/.steam/sdk64"
cp -v "$INSTALL_DIR/steamcmd/linux32/steamclient.so" "$INSTALL_DIR/.steam/sdk32/steamclient.so" 2>/dev/null || true
cp -v "$INSTALL_DIR/steamcmd/linux64/steamclient.so" "$INSTALL_DIR/.steam/sdk64/steamclient.so" 2>/dev/null || true

echo "Don't Starve Together server installed successfully"`,
    startCommand: `cd {{INSTALL_PATH}}/bin64 && ./dontstarve_dedicated_server_nullrenderer_x64 -console -cluster {{CLUSTER_NAME}} -shard Master`,
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
    steamAppId: "302550",
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
INSTALL_DIR="{INSTALL_PATH}"
STEAM_APPID="302550"

## Download and install SteamCMD
cd /tmp
curl -sSL -o steamcmd.tar.gz https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz
mkdir -p "$INSTALL_DIR/steamcmd"
tar -xzf steamcmd.tar.gz -C "$INSTALL_DIR/steamcmd"
rm steamcmd.tar.gz

cd "$INSTALL_DIR/steamcmd"

# SteamCMD workaround
chown -R $(whoami) "$INSTALL_DIR"
export HOME="$INSTALL_DIR"

## Install game server
echo "Installing Assetto Corsa (AppID: $STEAM_APPID)..."
./steamcmd.sh +force_install_dir "$INSTALL_DIR" +login anonymous +app_update $STEAM_APPID validate +quit

## Set up Steam SDK libraries
mkdir -p "$INSTALL_DIR/.steam/sdk32" "$INSTALL_DIR/.steam/sdk64"
cp -v "$INSTALL_DIR/steamcmd/linux32/steamclient.so" "$INSTALL_DIR/.steam/sdk32/steamclient.so" 2>/dev/null || true
cp -v "$INSTALL_DIR/steamcmd/linux64/steamclient.so" "$INSTALL_DIR/.steam/sdk64/steamclient.so" 2>/dev/null || true

echo "Assetto Corsa server installed successfully"`,
    startCommand: `cd {{INSTALL_PATH}} && ./acServer`,
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
  return gameTemplates.find((t) => t.slug === slug);
}
