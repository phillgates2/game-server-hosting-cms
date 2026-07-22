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

export interface TemplateVariable {
  name: string;
  key: string;
  description: string;
  defaultValue: string;
  required: boolean;
  type: "string" | "number" | "boolean" | "password";
}

// Common variables used across many games
const COMMON_VARS: TemplateVariable[] = [
  { name: "Server Name", key: "SERVER_NAME", description: "Display name for your server", defaultValue: "My Server", required: true, type: "string" },
  { name: "Port", key: "PORT", description: "Main server port", defaultValue: "", required: true, type: "number" },
  { name: "Max Players", key: "MAX_PLAYERS", description: "Maximum concurrent players", defaultValue: "32", required: false, type: "number" },
  { name: "Install Path", key: "INSTALL_PATH", description: "Server installation directory", defaultValue: "/opt/gameservers", required: true, type: "string" },
];

const STEAM_VARS: TemplateVariable[] = [
  ...COMMON_VARS,
  { name: "Steam Query Port", key: "QUERY_PORT", description: "Steam query port (usually main port + 1)", defaultValue: "", required: false, type: "number" },
];

const RCON_VARS: TemplateVariable[] = [
  { name: "RCON Password", key: "RCON_PASSWORD", description: "Remote console password", defaultValue: "", required: false, type: "password" },
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
      { name: "Max RAM (GB)", key: "MAX_RAM", description: "Maximum memory allocation", defaultValue: "4", required: true, type: "number" },
      { name: "Game Mode", key: "GAMEMODE", description: "survival, creative, adventure, spectator", defaultValue: "survival", required: false, type: "string" },
      { name: "Difficulty", key: "DIFFICULTY", description: "peaceful, easy, normal, hard", defaultValue: "normal", required: false, type: "string" },
      { name: "Online Mode", key: "ONLINE_MODE", description: "Require valid Minecraft accounts", defaultValue: "true", required: false, type: "boolean" },
    ],
    installScript: `#!/bin/bash
set -e
INSTALL_DIR="{{INSTALL_PATH}}"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# Install Java 21 if not present
if ! command -v java &> /dev/null; then
  apt-get update && apt-get install -y openjdk-21-jre-headless
fi

echo "Downloading Minecraft server..."
MANIFEST=$(curl -s https://launchermeta.mojang.com/mc/game/version_manifest.json)
LATEST=$(echo "$MANIFEST" | grep -o '"release":"[^"]*"' | head -1 | cut -d'"' -f4)
VERSION_URL=$(echo "$MANIFEST" | grep -o "\"$LATEST\":{[^}]*}" | grep -o '"url":"[^"]*"' | cut -d'"' -f4)
SERVER_URL=$(curl -s "$VERSION_URL" | grep -o '"server":{[^}]*}' | grep -o '"url":"[^"]*"' | cut -d'"' -f4)
curl -L -o server.jar "$SERVER_URL"

echo "eula=true" > eula.txt
echo "Minecraft Java server installed successfully"`,
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
      { name: "Max RAM (GB)", key: "MAX_RAM", description: "Maximum memory allocation", defaultValue: "4", required: true, type: "number" },
      { name: "View Distance", key: "VIEW_DISTANCE", description: "Chunk render distance", defaultValue: "10", required: false, type: "number" },
    ],
    installScript: `#!/bin/bash
set -e
INSTALL_DIR="{{INSTALL_PATH}}"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

if ! command -v java &> /dev/null; then
  apt-get update && apt-get install -y openjdk-21-jre-headless
fi

echo "Downloading Paper server..."
PAPER_API="https://api.papermc.io/v2/projects/paper"
LATEST_VERSION=$(curl -s "$PAPER_API" | grep -o '"versions":\\[[^]]*\\]' | grep -o '[0-9.]*' | tail -1)
LATEST_BUILD=$(curl -s "$PAPER_API/versions/$LATEST_VERSION" | grep -o '"builds":\\[[^]]*\\]' | grep -o '[0-9]*' | tail -1)
curl -L -o server.jar "$PAPER_API/versions/$LATEST_VERSION/builds/$LATEST_BUILD/downloads/paper-$LATEST_VERSION-$LATEST_BUILD.jar"

echo "eula=true" > eula.txt
echo "Paper server installed successfully"`,
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
      { name: "Game Mode", key: "GAMEMODE", description: "survival, creative, adventure", defaultValue: "survival", required: false, type: "string" },
    ],
    installScript: `#!/bin/bash
set -e
INSTALL_DIR="{{INSTALL_PATH}}"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

echo "Downloading Minecraft Bedrock server..."
DOWNLOAD_URL=$(curl -s https://www.minecraft.net/en-us/download/server/bedrock | grep -o 'https://minecraft.azureedge.net/bin-linux/[^"]*' | head -1)
curl -L -o bedrock-server.zip "$DOWNLOAD_URL"
unzip -o bedrock-server.zip
rm -f bedrock-server.zip
chmod +x bedrock_server

echo "Minecraft Bedrock server installed successfully"`,
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
      { name: "GSLT Token", key: "GSLT_TOKEN", description: "Game Server Login Token from Steam", defaultValue: "", required: true, type: "string" },
      { name: "Game Type", key: "GAME_TYPE", description: "0=Casual, 1=Competitive", defaultValue: "0", required: false, type: "number" },
      { name: "Game Mode", key: "GAME_MODE", description: "0=Casual, 1=Competitive, 2=Wingman", defaultValue: "1", required: false, type: "number" },
      { name: "Map", key: "MAP", description: "Starting map", defaultValue: "de_dust2", required: false, type: "string" },
    ],
    installScript: `#!/bin/bash
set -e
INSTALL_DIR="{{INSTALL_PATH}}"
mkdir -p "$INSTALL_DIR"

if ! command -v steamcmd &> /dev/null; then
  dpkg --add-architecture i386 2>/dev/null; apt-get update -qq
  apt-get install -y -qq lib32gcc-s1 lib32stdc++6 2>/dev/null || true
  mkdir -p /opt/steamcmd && cd /opt/steamcmd
  curl -sqL "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz" | tar xzf -
  chmod +x steamcmd.sh linux32/steamcmd
  cat > /usr/local/bin/steamcmd << 'WRAPPER'
#!/bin/bash
cd /opt/steamcmd && exec ./steamcmd.sh "$@"
WRAPPER
  chmod +x /usr/local/bin/steamcmd
fi

echo "Downloading Counter-Strike 2 Dedicated Server..."
steamcmd +force_install_dir "$INSTALL_DIR" +login anonymous +app_update 730 validate +quit

echo "CS2 server installed successfully"`,
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
      { name: "Map", key: "MAP", description: "Starting map", defaultValue: "cp_badlands", required: false, type: "string" },
    ],
    installScript: `#!/bin/bash
set -e
INSTALL_DIR="{{INSTALL_PATH}}"
mkdir -p "$INSTALL_DIR"

if ! command -v steamcmd &> /dev/null; then
  dpkg --add-architecture i386 2>/dev/null; apt-get update -qq
  apt-get install -y -qq lib32gcc-s1 lib32stdc++6 2>/dev/null || true
  mkdir -p /opt/steamcmd && cd /opt/steamcmd
  curl -sqL "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz" | tar xzf -
  chmod +x steamcmd.sh linux32/steamcmd
  cat > /usr/local/bin/steamcmd << 'WRAPPER'
#!/bin/bash
cd /opt/steamcmd && exec ./steamcmd.sh "$@"
WRAPPER
  chmod +x /usr/local/bin/steamcmd
fi

echo "Downloading Team Fortress 2 Dedicated Server..."
steamcmd +force_install_dir "$INSTALL_DIR" +login anonymous +app_update 232250 validate +quit

echo "TF2 server installed successfully"`,
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
      { name: "Game Mode", key: "GAMEMODE", description: "sandbox, terrortown, prophunt, etc.", defaultValue: "sandbox", required: false, type: "string" },
      { name: "Map", key: "MAP", description: "Starting map", defaultValue: "gm_flatgrass", required: false, type: "string" },
      { name: "Workshop Collection", key: "WORKSHOP_COLLECTION", description: "Steam Workshop collection ID", defaultValue: "", required: false, type: "string" },
    ],
    installScript: `#!/bin/bash
set -e
INSTALL_DIR="{{INSTALL_PATH}}"
mkdir -p "$INSTALL_DIR"

if ! command -v steamcmd &> /dev/null; then
  dpkg --add-architecture i386 2>/dev/null; apt-get update -qq
  apt-get install -y -qq lib32gcc-s1 lib32stdc++6 2>/dev/null || true
  mkdir -p /opt/steamcmd && cd /opt/steamcmd
  curl -sqL "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz" | tar xzf -
  chmod +x steamcmd.sh linux32/steamcmd
  cat > /usr/local/bin/steamcmd << 'WRAPPER'
#!/bin/bash
cd /opt/steamcmd && exec ./steamcmd.sh "$@"
WRAPPER
  chmod +x /usr/local/bin/steamcmd
fi

echo "Downloading Garry's Mod Dedicated Server..."
steamcmd +force_install_dir "$INSTALL_DIR" +login anonymous +app_update 4020 validate +quit

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
      { name: "Map", key: "MAP", description: "Starting campaign", defaultValue: "c1m1_hotel", required: false, type: "string" },
    ],
    installScript: `#!/bin/bash
set -e
INSTALL_DIR="{{INSTALL_PATH}}"
mkdir -p "$INSTALL_DIR"

if ! command -v steamcmd &> /dev/null; then
  dpkg --add-architecture i386 2>/dev/null; apt-get update -qq
  apt-get install -y -qq lib32gcc-s1 lib32stdc++6 2>/dev/null || true
  mkdir -p /opt/steamcmd && cd /opt/steamcmd
  curl -sqL "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz" | tar xzf -
  chmod +x steamcmd.sh linux32/steamcmd
  cat > /usr/local/bin/steamcmd << 'WRAPPER'
#!/bin/bash
cd /opt/steamcmd && exec ./steamcmd.sh "$@"
WRAPPER
  chmod +x /usr/local/bin/steamcmd
fi

echo "Downloading Left 4 Dead 2 Dedicated Server..."
steamcmd +force_install_dir "$INSTALL_DIR" +login anonymous +app_update 222860 validate +quit

echo "L4D2 server installed successfully"`,
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
      { name: "World Size", key: "WORLD_SIZE", description: "Map size (1000-6000)", defaultValue: "3000", required: false, type: "number" },
      { name: "World Seed", key: "WORLD_SEED", description: "Map generation seed", defaultValue: "12345", required: false, type: "number" },
      { name: "RCON Port", key: "RCON_PORT", description: "RCON port", defaultValue: "28016", required: false, type: "number" },
    ],
    installScript: `#!/bin/bash
set -e
INSTALL_DIR="{{INSTALL_PATH}}"
mkdir -p "$INSTALL_DIR"

if ! command -v steamcmd &> /dev/null; then
  dpkg --add-architecture i386 2>/dev/null; apt-get update -qq
  apt-get install -y -qq lib32gcc-s1 lib32stdc++6 2>/dev/null || true
  mkdir -p /opt/steamcmd && cd /opt/steamcmd
  curl -sqL "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz" | tar xzf -
  chmod +x steamcmd.sh linux32/steamcmd
  cat > /usr/local/bin/steamcmd << 'WRAPPER'
#!/bin/bash
cd /opt/steamcmd && exec ./steamcmd.sh "$@"
WRAPPER
  chmod +x /usr/local/bin/steamcmd
fi

echo "Downloading Rust Dedicated Server..."
steamcmd +force_install_dir "$INSTALL_DIR" +login anonymous +app_update 258550 validate +quit

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
      { name: "Map", key: "MAP", description: "TheIsland, Ragnarok, Valguero, etc.", defaultValue: "TheIsland", required: false, type: "string" },
      { name: "Admin Password", key: "ADMIN_PASSWORD", description: "Server admin password", defaultValue: "", required: true, type: "password" },
      { name: "Server Password", key: "SERVER_PASSWORD", description: "Join password (optional)", defaultValue: "", required: false, type: "password" },
    ],
    installScript: `#!/bin/bash
set -e
INSTALL_DIR="{{INSTALL_PATH}}"
mkdir -p "$INSTALL_DIR"

if ! command -v steamcmd &> /dev/null; then
  dpkg --add-architecture i386 2>/dev/null; apt-get update -qq
  apt-get install -y -qq lib32gcc-s1 lib32stdc++6 2>/dev/null || true
  mkdir -p /opt/steamcmd && cd /opt/steamcmd
  curl -sqL "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz" | tar xzf -
  chmod +x steamcmd.sh linux32/steamcmd
  cat > /usr/local/bin/steamcmd << 'WRAPPER'
#!/bin/bash
cd /opt/steamcmd && exec ./steamcmd.sh "$@"
WRAPPER
  chmod +x /usr/local/bin/steamcmd
fi

echo "Downloading ARK Dedicated Server (this may take a while ~50GB)..."
steamcmd +force_install_dir "$INSTALL_DIR" +login anonymous +app_update 376030 validate +quit

echo "ARK server installed successfully"`,
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
      { name: "World Name", key: "WORLD_NAME", description: "Name of your world save", defaultValue: "Dedicated", required: true, type: "string" },
      { name: "Password", key: "PASSWORD", description: "Server password (min 5 chars)", defaultValue: "", required: true, type: "password" },
      { name: "Public", key: "PUBLIC", description: "List on server browser (1=yes, 0=no)", defaultValue: "1", required: false, type: "number" },
    ],
    installScript: `#!/bin/bash
set -e
INSTALL_DIR="{{INSTALL_PATH}}"
mkdir -p "$INSTALL_DIR"

if ! command -v steamcmd &> /dev/null; then
  dpkg --add-architecture i386 2>/dev/null; apt-get update -qq
  apt-get install -y -qq lib32gcc-s1 lib32stdc++6 2>/dev/null || true
  mkdir -p /opt/steamcmd && cd /opt/steamcmd
  curl -sqL "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz" | tar xzf -
  chmod +x steamcmd.sh linux32/steamcmd
  cat > /usr/local/bin/steamcmd << 'WRAPPER'
#!/bin/bash
cd /opt/steamcmd && exec ./steamcmd.sh "$@"
WRAPPER
  chmod +x /usr/local/bin/steamcmd
fi

echo "Downloading Valheim Dedicated Server..."
steamcmd +force_install_dir "$INSTALL_DIR" +login anonymous +app_update 896660 validate +quit

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
      { name: "Game Difficulty", key: "DIFFICULTY", description: "0-5 (Scavenger to Insane)", defaultValue: "2", required: false, type: "number" },
      { name: "World Name", key: "WORLD_NAME", description: "World save name", defaultValue: "Navezgane", required: false, type: "string" },
    ],
    installScript: `#!/bin/bash
set -e
INSTALL_DIR="{{INSTALL_PATH}}"
mkdir -p "$INSTALL_DIR"

if ! command -v steamcmd &> /dev/null; then
  dpkg --add-architecture i386 2>/dev/null; apt-get update -qq
  apt-get install -y -qq lib32gcc-s1 lib32stdc++6 2>/dev/null || true
  mkdir -p /opt/steamcmd && cd /opt/steamcmd
  curl -sqL "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz" | tar xzf -
  chmod +x steamcmd.sh linux32/steamcmd
  cat > /usr/local/bin/steamcmd << 'WRAPPER'
#!/bin/bash
cd /opt/steamcmd && exec ./steamcmd.sh "$@"
WRAPPER
  chmod +x /usr/local/bin/steamcmd
fi

echo "Downloading 7 Days to Die Dedicated Server..."
steamcmd +force_install_dir "$INSTALL_DIR" +login anonymous +app_update 294420 validate +quit

echo "7DTD server installed successfully"`,
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
      { name: "Admin Password", key: "ADMIN_PASSWORD", description: "Admin password", defaultValue: "", required: true, type: "password" },
      { name: "Server Password", key: "SERVER_PASSWORD", description: "Join password (optional)", defaultValue: "", required: false, type: "password" },
    ],
    installScript: `#!/bin/bash
set -e
INSTALL_DIR="{{INSTALL_PATH}}"
mkdir -p "$INSTALL_DIR"

if ! command -v steamcmd &> /dev/null; then
  dpkg --add-architecture i386 2>/dev/null; apt-get update -qq
  apt-get install -y -qq lib32gcc-s1 lib32stdc++6 2>/dev/null || true
  mkdir -p /opt/steamcmd && cd /opt/steamcmd
  curl -sqL "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz" | tar xzf -
  chmod +x steamcmd.sh linux32/steamcmd
  cat > /usr/local/bin/steamcmd << 'WRAPPER'
#!/bin/bash
cd /opt/steamcmd && exec ./steamcmd.sh "$@"
WRAPPER
  chmod +x /usr/local/bin/steamcmd
fi

echo "Downloading Palworld Dedicated Server..."
steamcmd +force_install_dir "$INSTALL_DIR" +login anonymous +app_update 2394010 validate +quit

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
      { name: "Beacon Port", key: "BEACON_PORT", description: "Beacon port", defaultValue: "15000", required: false, type: "number" },
    ],
    installScript: `#!/bin/bash
set -e
INSTALL_DIR="{{INSTALL_PATH}}"
mkdir -p "$INSTALL_DIR"

if ! command -v steamcmd &> /dev/null; then
  dpkg --add-architecture i386 2>/dev/null; apt-get update -qq
  apt-get install -y -qq lib32gcc-s1 lib32stdc++6 2>/dev/null || true
  mkdir -p /opt/steamcmd && cd /opt/steamcmd
  curl -sqL "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz" | tar xzf -
  chmod +x steamcmd.sh linux32/steamcmd
  cat > /usr/local/bin/steamcmd << 'WRAPPER'
#!/bin/bash
cd /opt/steamcmd && exec ./steamcmd.sh "$@"
WRAPPER
  chmod +x /usr/local/bin/steamcmd
fi

echo "Downloading Satisfactory Dedicated Server..."
steamcmd +force_install_dir "$INSTALL_DIR" +login anonymous +app_update 1690800 validate +quit

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
      { name: "World Name", key: "WORLD_NAME", description: "World file name", defaultValue: "world", required: true, type: "string" },
      { name: "World Size", key: "WORLD_SIZE", description: "1=Small, 2=Medium, 3=Large", defaultValue: "3", required: false, type: "number" },
      { name: "Difficulty", key: "DIFFICULTY", description: "0=Normal, 1=Expert, 2=Master, 3=Journey", defaultValue: "0", required: false, type: "number" },
    ],
    installScript: `#!/bin/bash
set -e
INSTALL_DIR="{{INSTALL_PATH}}"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

echo "Downloading TShock for Terraria..."
RELEASE=$(curl -s https://api.github.com/repos/Pryaxis/TShock/releases/latest | grep tag_name | cut -d '"' -f4)
DOWNLOAD_URL=$(curl -s https://api.github.com/repos/Pryaxis/TShock/releases/latest | grep browser_download_url | grep linux | head -1 | cut -d '"' -f4)
curl -L -o tshock.zip "$DOWNLOAD_URL"
unzip -o tshock.zip
rm -f tshock.zip
chmod +x TShock.Server

echo "Terraria/TShock server installed successfully"`,
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
      { name: "Password", key: "PASSWORD", description: "Server password", defaultValue: "", required: false, type: "password" },
    ],
    installScript: `#!/bin/bash
set -e
INSTALL_DIR="{{INSTALL_PATH}}"
mkdir -p "$INSTALL_DIR"

if ! command -v steamcmd &> /dev/null; then
  dpkg --add-architecture i386 2>/dev/null; apt-get update -qq
  apt-get install -y -qq lib32gcc-s1 lib32stdc++6 2>/dev/null || true
  mkdir -p /opt/steamcmd && cd /opt/steamcmd
  curl -sqL "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz" | tar xzf -
  chmod +x steamcmd.sh linux32/steamcmd
  cat > /usr/local/bin/steamcmd << 'WRAPPER'
#!/bin/bash
cd /opt/steamcmd && exec ./steamcmd.sh "$@"
WRAPPER
  chmod +x /usr/local/bin/steamcmd
fi

echo "Downloading Enshrouded Dedicated Server..."
steamcmd +force_install_dir "$INSTALL_DIR" +login anonymous +app_update 2278520 validate +quit

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
      { name: "Map", key: "MAP", description: "Starting map", defaultValue: "Oilfield", required: false, type: "string" },
      { name: "Scenario", key: "SCENARIO", description: "Game scenario", defaultValue: "Scenario_Refinery_Checkpoint_Security", required: false, type: "string" },
    ],
    installScript: `#!/bin/bash
set -e
INSTALL_DIR="{{INSTALL_PATH}}"
mkdir -p "$INSTALL_DIR"

if ! command -v steamcmd &> /dev/null; then
  dpkg --add-architecture i386 2>/dev/null; apt-get update -qq
  apt-get install -y -qq lib32gcc-s1 lib32stdc++6 2>/dev/null || true
  mkdir -p /opt/steamcmd && cd /opt/steamcmd
  curl -sqL "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz" | tar xzf -
  chmod +x steamcmd.sh linux32/steamcmd
  cat > /usr/local/bin/steamcmd << 'WRAPPER'
#!/bin/bash
cd /opt/steamcmd && exec ./steamcmd.sh "$@"
WRAPPER
  chmod +x /usr/local/bin/steamcmd
fi

echo "Downloading Insurgency: Sandstorm Dedicated Server..."
steamcmd +force_install_dir "$INSTALL_DIR" +login anonymous +app_update 581330 validate +quit

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
mkdir -p "$INSTALL_DIR"

if ! command -v steamcmd &> /dev/null; then
  dpkg --add-architecture i386 2>/dev/null; apt-get update -qq
  apt-get install -y -qq lib32gcc-s1 lib32stdc++6 2>/dev/null || true
  mkdir -p /opt/steamcmd && cd /opt/steamcmd
  curl -sqL "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz" | tar xzf -
  chmod +x steamcmd.sh linux32/steamcmd
  cat > /usr/local/bin/steamcmd << 'WRAPPER'
#!/bin/bash
cd /opt/steamcmd && exec ./steamcmd.sh "$@"
WRAPPER
  chmod +x /usr/local/bin/steamcmd
fi

echo "Downloading Squad Dedicated Server..."
steamcmd +force_install_dir "$INSTALL_DIR" +login anonymous +app_update 403240 validate +quit

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
      { name: "Server Password", key: "SERVER_PASSWORD", description: "Join password", defaultValue: "", required: false, type: "password" },
      { name: "Admin Password", key: "ADMIN_PASSWORD", description: "Admin password", defaultValue: "", required: true, type: "password" },
    ],
    installScript: `#!/bin/bash
set -e
INSTALL_DIR="{{INSTALL_PATH}}"
mkdir -p "$INSTALL_DIR"

if ! command -v steamcmd &> /dev/null; then
  dpkg --add-architecture i386 2>/dev/null; apt-get update -qq
  apt-get install -y -qq lib32gcc-s1 lib32stdc++6 2>/dev/null || true
  mkdir -p /opt/steamcmd && cd /opt/steamcmd
  curl -sqL "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz" | tar xzf -
  chmod +x steamcmd.sh linux32/steamcmd
  cat > /usr/local/bin/steamcmd << 'WRAPPER'
#!/bin/bash
cd /opt/steamcmd && exec ./steamcmd.sh "$@"
WRAPPER
  chmod +x /usr/local/bin/steamcmd
fi

echo "Downloading Arma 3 Dedicated Server..."
steamcmd +force_install_dir "$INSTALL_DIR" +login anonymous +app_update 233780 validate +quit

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
      { name: "Game Type", key: "GAMETYPE", description: "2=Objective, 3=Stopwatch, 4=Campaign", defaultValue: "2", required: false, type: "number" },
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
      { name: "Game Mod", key: "GAME_MOD", description: "ra (Red Alert), cnc (C&C), d2k (Dune 2000)", defaultValue: "ra", required: false, type: "string" },
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
      { name: "Game Type", key: "GAMETYPE", description: "0=FFA, 1=Duel, 3=TDM, 4=CA, 5=CTF", defaultValue: "0", required: false, type: "number" },
    ],
    installScript: `#!/bin/bash
set -e
INSTALL_DIR="{{INSTALL_PATH}}"
mkdir -p "$INSTALL_DIR"

if ! command -v steamcmd &> /dev/null; then
  dpkg --add-architecture i386 2>/dev/null; apt-get update -qq
  apt-get install -y -qq lib32gcc-s1 lib32stdc++6 2>/dev/null || true
  mkdir -p /opt/steamcmd && cd /opt/steamcmd
  curl -sqL "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz" | tar xzf -
  chmod +x steamcmd.sh linux32/steamcmd
  cat > /usr/local/bin/steamcmd << 'WRAPPER'
#!/bin/bash
cd /opt/steamcmd && exec ./steamcmd.sh "$@"
WRAPPER
  chmod +x /usr/local/bin/steamcmd
fi

echo "Downloading Quake Live Dedicated Server..."
steamcmd +force_install_dir "$INSTALL_DIR" +login anonymous +app_update 349090 validate +quit

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

echo "Downloading Xonotic..."
curl -L -o xonotic.zip "https://dl.xonotic.org/xonotic-0.8.6.zip"
unzip -o xonotic.zip
mv Xonotic/* . || true
rmdir Xonotic || true
rm -f xonotic.zip

echo "Xonotic server installed successfully"`,
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
      { name: "Save Name", key: "SAVE_NAME", description: "Save file name", defaultValue: "world1", required: true, type: "string" },
      { name: "Password", key: "PASSWORD", description: "Server password", defaultValue: "", required: false, type: "password" },
    ],
    installScript: `#!/bin/bash
set -e
INSTALL_DIR="{{INSTALL_PATH}}"
mkdir -p "$INSTALL_DIR"

if ! command -v steamcmd &> /dev/null; then
  dpkg --add-architecture i386 2>/dev/null; apt-get update -qq
  apt-get install -y -qq lib32gcc-s1 lib32stdc++6 2>/dev/null || true
  mkdir -p /opt/steamcmd && cd /opt/steamcmd
  curl -sqL "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz" | tar xzf -
  chmod +x steamcmd.sh linux32/steamcmd
  cat > /usr/local/bin/steamcmd << 'WRAPPER'
#!/bin/bash
cd /opt/steamcmd && exec ./steamcmd.sh "$@"
WRAPPER
  chmod +x /usr/local/bin/steamcmd
fi

echo "Downloading V Rising Dedicated Server..."
steamcmd +force_install_dir "$INSTALL_DIR" +login anonymous +app_update 1829350 validate +quit

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
      { name: "Admin Password", key: "ADMIN_PASSWORD", description: "Admin password", defaultValue: "", required: true, type: "password" },
      { name: "Server Password", key: "SERVER_PASSWORD", description: "Join password", defaultValue: "", required: false, type: "password" },
    ],
    installScript: `#!/bin/bash
set -e
INSTALL_DIR="{{INSTALL_PATH}}"
mkdir -p "$INSTALL_DIR"

if ! command -v steamcmd &> /dev/null; then
  dpkg --add-architecture i386 2>/dev/null; apt-get update -qq
  apt-get install -y -qq lib32gcc-s1 lib32stdc++6 2>/dev/null || true
  mkdir -p /opt/steamcmd && cd /opt/steamcmd
  curl -sqL "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz" | tar xzf -
  chmod +x steamcmd.sh linux32/steamcmd
  cat > /usr/local/bin/steamcmd << 'WRAPPER'
#!/bin/bash
cd /opt/steamcmd && exec ./steamcmd.sh "$@"
WRAPPER
  chmod +x /usr/local/bin/steamcmd
fi

echo "Downloading Project Zomboid Dedicated Server..."
steamcmd +force_install_dir "$INSTALL_DIR" +login anonymous +app_update 380870 validate +quit

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
      { name: "World Name", key: "WORLD_NAME", description: "World save name", defaultValue: "world", required: true, type: "string" },
      { name: "Public", key: "PUBLIC", description: "List publicly (true/false)", defaultValue: "false", required: false, type: "boolean" },
    ],
    installScript: `#!/bin/bash
set -e
INSTALL_DIR="{{INSTALL_PATH}}"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

echo "Downloading Factorio Headless Server..."
curl -L -o factorio.tar.xz "https://factorio.com/get-download/stable/headless/linux64"
tar xf factorio.tar.xz --strip-components=1
rm -f factorio.tar.xz

mkdir -p saves
./bin/x64/factorio --create saves/{{WORLD_NAME}}.zip

echo "Factorio server installed successfully"`,
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
      { name: "Cluster Name", key: "CLUSTER_NAME", description: "Cluster folder name", defaultValue: "MyCluster", required: true, type: "string" },
      { name: "Cluster Token", key: "CLUSTER_TOKEN", description: "Server token from Klei", defaultValue: "", required: true, type: "string" },
    ],
    installScript: `#!/bin/bash
set -e
INSTALL_DIR="{{INSTALL_PATH}}"
mkdir -p "$INSTALL_DIR"

if ! command -v steamcmd &> /dev/null; then
  dpkg --add-architecture i386 2>/dev/null; apt-get update -qq
  apt-get install -y -qq lib32gcc-s1 lib32stdc++6 2>/dev/null || true
  mkdir -p /opt/steamcmd && cd /opt/steamcmd
  curl -sqL "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz" | tar xzf -
  chmod +x steamcmd.sh linux32/steamcmd
  cat > /usr/local/bin/steamcmd << 'WRAPPER'
#!/bin/bash
cd /opt/steamcmd && exec ./steamcmd.sh "$@"
WRAPPER
  chmod +x /usr/local/bin/steamcmd
fi

echo "Downloading Don't Starve Together Dedicated Server..."
steamcmd +force_install_dir "$INSTALL_DIR" +login anonymous +app_update 343050 validate +quit

echo "DST server installed successfully"`,
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
      { name: "Track", key: "TRACK", description: "Track name", defaultValue: "imola", required: true, type: "string" },
      { name: "Admin Password", key: "ADMIN_PASSWORD", description: "Admin password", defaultValue: "", required: true, type: "password" },
    ],
    installScript: `#!/bin/bash
set -e
INSTALL_DIR="{{INSTALL_PATH}}"
mkdir -p "$INSTALL_DIR"

if ! command -v steamcmd &> /dev/null; then
  dpkg --add-architecture i386 2>/dev/null; apt-get update -qq
  apt-get install -y -qq lib32gcc-s1 lib32stdc++6 2>/dev/null || true
  mkdir -p /opt/steamcmd && cd /opt/steamcmd
  curl -sqL "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz" | tar xzf -
  chmod +x steamcmd.sh linux32/steamcmd
  cat > /usr/local/bin/steamcmd << 'WRAPPER'
#!/bin/bash
cd /opt/steamcmd && exec ./steamcmd.sh "$@"
WRAPPER
  chmod +x /usr/local/bin/steamcmd
fi

echo "Downloading Assetto Corsa Dedicated Server..."
steamcmd +force_install_dir "$INSTALL_DIR" +login anonymous +app_update 302550 validate +quit

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
