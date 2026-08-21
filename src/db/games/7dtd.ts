import { V, group, STEAM_VARS, type GameTemplate } from "./types";
import { steamInstallScript } from "./steamcmd";

// 7 Days to Die reads serverconfig.xml, a flat list of
// <property name="..." value="..."/> entries.
export const sevenDaysToDie: GameTemplate = {
  slug: "7dtd",
  name: "7 Days to Die",
  engine: "Unity",
  defaultPort: 26900,
  steamAppId: "294420",
  iconEmoji: "🧟‍♂️",
  supportsIpv6: false,
  category: "Survival",
  description: "Zombie survival crafting game",
  estimatedSize: "~15 GB",
  variables: [
    ...STEAM_VARS,

    ...group("Server Listing", [
      V("Server Description", "SERVER_DESCRIPTION", "Short description shown in the browser", "A 7 Days to Die server", { required: false }),
      V("Server Website URL", "SERVER_WEBSITE_URL", "Website link shown in the browser", "", { required: false }),
      V("Server Password", "SERVER_PASSWORD", "Password required to join, empty = public", "", { required: false, type: "password" }),
      V("Server Visibility", "SERVER_VISIBILITY", "Who can see the server in the browser", "2", {
        required: false, type: "select",
        enum_values: { "0": "0 — Not listed", "1": "1 — Friends only", "2": "2 — Public" },
      }),
      V("Reserved Slots", "SERVER_RESERVED_SLOTS", "Slots carved out of the max count for privileged players", "0", {
        required: false, type: "number", min_value: 0, max_value: 128,
      }),
      V("Reserved Slots Permission", "SERVER_RESERVED_SLOTS_PERMISSION", "Permission level required to use a reserved slot", "100", {
        required: false, type: "number", min_value: 0, max_value: 1000,
      }),
      V("Admin Slots", "SERVER_ADMIN_SLOTS", "Extra slots beyond the max count for admins", "0", {
        required: false, type: "number", min_value: 0, max_value: 128,
      }),
      V("Admin Slots Permission", "SERVER_ADMIN_SLOTS_PERMISSION", "Permission level required for an admin slot", "0", {
        required: false, type: "number", min_value: 0, max_value: 1000,
      }),
      V("Max World Transfer Speed", "SERVER_MAX_WORLD_TRANSFER_SPEED", "KiB/s cap when sending the world to joining clients", "512", {
        required: false, type: "number", min_value: 64, max_value: 1300,
      }),
      V("Allow Crossplay", "SERVER_ALLOW_CROSSPLAY", "Enable PC/console crossplay — needs EAC on and world size <= 8192", "false", { required: false, type: "boolean" }),
    ]),

    ...group("World", [
      V("Game World", "GAME_WORLD", "Navezgane, RWG, or a custom map name", "Navezgane", { required: false }),
      V("World Gen Seed", "WORLD_GEN_SEED", "Seed used when Game World is RWG", "asdf", { required: false }),
      V("World Gen Size", "WORLD_GEN_SIZE", "Random world size — must be 6144, 8192 or 10240", "6144", {
        required: false, type: "select",
        enum_values: { "6144": "6144 (small)", "8192": "8192 (medium)", "10240": "10240 (large)" },
      }),
      V("Game Name", "WORLD_NAME", "Save name — changing it starts a fresh world", "GSMWorld", { required: false }),
      V("Game Mode", "GAME_MODE", "Game mode identifier — GameModeSurvival is the only supported value", "GameModeSurvival", { required: false }),
      V("Save Data Limit", "SAVE_DATA_LIMIT", "Megabytes of region data to keep, -1 = unlimited", "-1", {
        required: false, type: "number", min_value: -1, max_value: 1000000,
      }),
    ]),

    ...group("Difficulty & XP", [
      V("Game Difficulty", "DIFFICULTY", "0 = Scavenger through 5 = Insane", "2", {
        required: false, type: "select",
        enum_values: {
          "0": "0 — Scavenger", "1": "1 — Adventurer", "2": "2 — Nomad",
          "3": "3 — Warrior", "4": "4 — Survivalist", "5": "5 — Insane",
        },
      }),
      V("XP Multiplier", "XP_MULTIPLIER", "Experience gain percentage (100 = normal)", "100", {
        required: false, type: "number", min_value: 1, max_value: 1000,
      }),
      V("Block Damage Player", "BLOCK_DAMAGE_PLAYER", "Player damage to blocks, percentage", "100", {
        required: false, type: "number", min_value: 0, max_value: 1000,
      }),
      V("Block Damage AI", "BLOCK_DAMAGE_AI", "Zombie damage to blocks, percentage", "100", {
        required: false, type: "number", min_value: 0, max_value: 1000,
      }),
      V("Block Damage AI Blood Moon", "BLOCK_DAMAGE_AI_BM", "Blood-moon zombie damage to blocks, percentage", "100", {
        required: false, type: "number", min_value: 0, max_value: 1000,
      }),
      V("Player Safe Zone Level", "PLAYER_SAFE_ZONE_LEVEL", "Player level at which the spawn safe zone stops working", "5", {
        required: false, type: "number", min_value: 0, max_value: 300,
      }),
      V("Player Safe Zone Hours", "PLAYER_SAFE_ZONE_HOURS", "In-game hours the spawn safe zone lasts", "5", {
        required: false, type: "number", min_value: 0, max_value: 240,
      }),
    ]),

    ...group("Day Cycle & Loot", [
      V("Day Night Length", "DAY_NIGHT_LENGTH", "Real minutes per in-game day", "60", {
        required: false, type: "number", min_value: 10, max_value: 1200,
      }),
      V("Day Light Length", "DAY_LIGHT_LENGTH", "In-game hours of daylight out of 24", "18", {
        required: false, type: "number", min_value: 0, max_value: 24,
      }),
      V("Day Count", "DAY_COUNT", "In-game day the world starts on", "1", {
        required: false, type: "number", min_value: 1, max_value: 10000,
      }),
      V("Loot Abundance", "LOOT_ABUNDANCE", "Loot spawn percentage (100 = normal)", "100", {
        required: false, type: "number", min_value: 1, max_value: 1000,
      }),
      V("Loot Respawn Days", "LOOT_RESPAWN_DAYS", "In-game days before looted containers refill", "7", {
        required: false, type: "number", min_value: 0, max_value: 100,
      }),
      V("Air Drop Frequency", "AIR_DROP_FREQUENCY", "In-game hours between airdrops, 0 = disabled", "72", {
        required: false, type: "number", min_value: 0, max_value: 1000,
      }),
      V("Air Drop Marker", "AIR_DROP_MARKER", "Show airdrops on the map", "true", { required: false, type: "boolean" }),
      V("Party Shared Kill Range", "PARTY_SHARED_KILL_RANGE", "Blocks within which party members share kill XP", "100", {
        required: false, type: "number", min_value: 0, max_value: 1000,
      }),
    ]),

    ...group("Death & PvP", [
      V("Drop On Death", "DROP_ON_DEATH", "What players drop when they die", "1", {
        required: false, type: "select",
        enum_values: {
          "0": "0 — Nothing", "1": "1 — Everything", "2": "2 — Toolbelt only",
          "3": "3 — Backpack only", "4": "4 — Delete all",
        },
      }),
      V("Drop On Quit", "DROP_ON_QUIT", "What players drop when they disconnect", "0", {
        required: false, type: "select",
        enum_values: {
          "0": "0 — Nothing", "1": "1 — Everything", "2": "2 — Toolbelt only", "3": "3 — Backpack only",
        },
      }),
      V("Player Killing Mode", "PLAYER_KILLING_MODE", "Who players may kill", "3", {
        required: false, type: "select",
        enum_values: {
          "0": "0 — No killing", "1": "1 — Kill allies only",
          "2": "2 — Kill strangers only", "3": "3 — Kill everyone",
        },
      }),
      V("Bedroll Dead Zone Size", "BEDROLL_DEAD_ZONE_SIZE", "Radius in blocks around a bedroll where zombies will not spawn", "15", {
        required: false, type: "number", min_value: 0, max_value: 100,
      }),
      V("Bedroll Expiry Time", "BEDROLL_EXPIRY_TIME", "Real days of inactivity before a bedroll expires", "45", {
        required: false, type: "number", min_value: 0, max_value: 365,
      }),
    ]),

    ...group("Zombies & Spawning", [
      V("Max Spawned Zombies", "MAX_SPAWNED_ZOMBIES", "Server-wide zombie cap — the biggest performance lever", "64", {
        required: false, type: "number", min_value: 0, max_value: 512,
      }),
      V("Max Spawned Animals", "MAX_SPAWNED_ANIMALS", "Server-wide animal cap", "50", {
        required: false, type: "number", min_value: 0, max_value: 512,
      }),
      V("Enemy Spawn Mode", "ENEMY_SPAWN_MODE", "Enable zombie spawning at all", "true", { required: false, type: "boolean" }),
      V("Enemy Difficulty", "ENEMY_DIFFICULTY", "0 = normal, 1 = feral", "0", {
        required: false, type: "select", enum_values: { "0": "0 — Normal", "1": "1 — Feral" },
      }),
      V("Zombie Move", "ZOMBIE_MOVE", "Daytime zombie speed", "0", {
        required: false, type: "select",
        enum_values: { "0": "0 — Walk", "1": "1 — Jog", "2": "2 — Run", "3": "3 — Sprint", "4": "4 — Nightmare" },
      }),
      V("Zombie Move Night", "ZOMBIE_MOVE_NIGHT", "Night-time zombie speed", "3", {
        required: false, type: "select",
        enum_values: { "0": "0 — Walk", "1": "1 — Jog", "2": "2 — Run", "3": "3 — Sprint", "4": "4 — Nightmare" },
      }),
      V("Zombie Feral Move", "ZOMBIE_FERAL_MOVE", "Feral zombie speed", "3", {
        required: false, type: "select",
        enum_values: { "0": "0 — Walk", "1": "1 — Jog", "2": "2 — Run", "3": "3 — Sprint", "4": "4 — Nightmare" },
      }),
      V("Zombie BM Move", "ZOMBIE_BM_MOVE", "Blood-moon zombie speed", "3", {
        required: false, type: "select",
        enum_values: { "0": "0 — Walk", "1": "1 — Jog", "2": "2 — Run", "3": "3 — Sprint", "4": "4 — Nightmare" },
      }),
      V("Blood Moon Frequency", "BLOOD_MOON_FREQUENCY", "In-game days between blood moons, 0 = disabled", "7", {
        required: false, type: "number", min_value: 0, max_value: 100,
      }),
      V("Blood Moon Range", "BLOOD_MOON_RANGE", "Random days added or subtracted from the blood moon day", "0", {
        required: false, type: "number", min_value: 0, max_value: 10,
      }),
      V("Blood Moon Warning", "BLOOD_MOON_WARNING", "In-game hour the blood moon warning appears, -1 = off", "8", {
        required: false, type: "number", min_value: -1, max_value: 24,
      }),
      V("Blood Moon Enemy Count", "BLOOD_MOON_ENEMY_COUNT", "Blood-moon zombies per player", "8", {
        required: false, type: "number", min_value: 0, max_value: 64,
      }),
      V("Enemy Sense Memory", "ENEMY_SENSE_MEMORY", "Seconds zombies remember a player after losing sight", "60", {
        required: false, type: "number", min_value: 0, max_value: 600,
      }),
    ]),

    ...group("Land Claims", [
      V("Land Claim Count", "LAND_CLAIM_COUNT", "Land claim blocks each player may place", "1", {
        required: false, type: "number", min_value: 1, max_value: 100,
      }),
      V("Land Claim Size", "LAND_CLAIM_SIZE", "Protected area width in blocks", "41", {
        required: false, type: "number", min_value: 1, max_value: 500,
      }),
      V("Land Claim Dead Zone", "LAND_CLAIM_DEAD_ZONE", "Minimum blocks between different players' claims", "30", {
        required: false, type: "number", min_value: 0, max_value: 500,
      }),
      V("Land Claim Expiry Time", "LAND_CLAIM_EXPIRY_TIME", "Real days offline before a claim expires", "7", {
        required: false, type: "number", min_value: 0, max_value: 365,
      }),
      V("Land Claim Decay Mode", "LAND_CLAIM_DECAY_MODE", "How protection fades while the owner is offline", "0", {
        required: false, type: "select",
        enum_values: { "0": "0 — Slow (linear)", "1": "1 — Fast (exponential)", "2": "2 — None until expiry" },
      }),
      V("Land Claim Online Durability", "LAND_CLAIM_ONLINE_DURABILITY_MODIFIER", "Block hardness multiplier while the owner is online, 0 = indestructible", "4", {
        required: false, type: "number", min_value: 0, max_value: 100,
      }),
      V("Land Claim Offline Durability", "LAND_CLAIM_OFFLINE_DURABILITY_MODIFIER", "Block hardness multiplier while the owner is offline", "4", {
        required: false, type: "number", min_value: 0, max_value: 100,
      }),
      V("Land Claim Offline Delay", "LAND_CLAIM_OFFLINE_DELAY", "Minutes after logout before offline protection applies", "0", {
        required: false, type: "number", min_value: 0, max_value: 1440,
      }),
    ]),

    ...group("Performance", [
      V("Max Allowed View Distance", "SERVER_MAX_ALLOWED_VIEW_DISTANCE", "Highest chunk view distance clients may request (6-12)", "12", {
        required: false, type: "number", min_value: 6, max_value: 12,
      }),
      V("Max Queued Mesh Layers", "MAX_QUEUED_MESH_LAYERS", "Mesh generation queue depth", "1000", {
        required: false, type: "number", min_value: 100, max_value: 10000,
      }),
      V("Max Uncovered Map Chunks", "MAX_UNCOVERED_MAP_CHUNKS_PER_PLAYER", "Map chunks a single player may reveal", "131072", {
        required: false, type: "number", min_value: 1000, max_value: 1000000,
      }),
      V("Dynamic Mesh Enabled", "DYNAMIC_MESH_ENABLED", "Enable realistic structural collapse — CPU and RAM heavy", "true", { required: false, type: "boolean" }),
      V("Dynamic Mesh Land Claim Only", "DYNAMIC_MESH_LAND_CLAIM_ONLY", "Restrict dynamic mesh to land-claimed areas", "true", { required: false, type: "boolean" }),
      V("Dynamic Mesh Max Items", "DYNAMIC_MESH_MAX_ITEM_CACHE", "Concurrent dynamic mesh items processed", "3", {
        required: false, type: "number", min_value: 1, max_value: 64,
      }),
      V("Persistent Player Profiles", "PERSISTENT_PLAYER_PROFILES", "Lock players to the profile they first joined with", "false", { required: false, type: "boolean" }),
    ]),

    ...group("Admin & Remote Access", [
      V("EAC Enabled", "EAC_ENABLED", "Easy Anti-Cheat — must be off for most overhaul mods", "true", { required: false, type: "boolean" }),
      V("Telnet Enabled", "TELNET_ENABLED", "Enable the Telnet console used by RCON tools", "true", { required: false, type: "boolean" }),
      V("Telnet Port", "TELNET_PORT", "Port the Telnet console binds to", "8081", {
        required: false, type: "number", min_value: 1, max_value: 65535,
      }),
      V("Telnet Password", "TELNET_PASSWORD", "Telnet password — required for non-localhost access", "", { required: false, type: "password" }),
      V("Telnet Fail Count", "TELNET_FAIL_COUNT", "Failed logins before the IP is blocked", "10", {
        required: false, type: "number", min_value: 1, max_value: 100,
      }),
      V("Web Dashboard Enabled", "WEB_DASHBOARD_ENABLED", "Enable the built-in web dashboard", "false", { required: false, type: "boolean" }),
      V("Web Dashboard Port", "WEB_DASHBOARD_PORT", "Port the web dashboard binds to", "8080", {
        required: false, type: "number", min_value: 1, max_value: 65535,
      }),
      V("Web Dashboard URL", "WEB_DASHBOARD_URL", "External URL when behind a reverse proxy", "", { required: false }),
      V("Enable Map Rendering", "ENABLE_MAP_RENDERING", "Render explored map tiles for the dashboard", "false", { required: false, type: "boolean" }),
      V("Hide Command Execution Log", "HIDE_COMMAND_EXECUTION_LOG", "0 shows all command output, higher values hide more", "0", {
        required: false, type: "select",
        enum_values: { "0": "0 — Show all", "1": "1 — Hide Telnet/web", "2": "2 — Hide remote", "3": "3 — Hide all" },
      }),
      V("Admin File Name", "ADMIN_FILE_NAME", "Filename of the admin permissions file", "serveradmin.xml", { required: false }),
      V("Terminal Window Enabled", "TERMINAL_WINDOW_ENABLED", "Open a local terminal window on the host", "false", { required: false, type: "boolean" }),
    ]),
  ],

  installScript: steamInstallScript({
    appId: "294420",
    name: "7 Days to Die",
    post: `## The -logfile flag in the start command needs this directory to exist
mkdir -p "$INSTALL_DIR/logs"`,
  }),

  startCommand: `cd {{INSTALL_PATH}} && ./7DaysToDieServer.x86_64 -configfile=serverconfig.xml -logfile logs/output_log.txt -quit -batchmode -nographics -dedicated`,
  stopCommand: "shutdown",
  configFiles: { "serverconfig.xml": "serverconfig.xml" },
  defaultConfig: {
    __gsm_format: "xml",
    ServerName: "{{SERVER_NAME}}",
    ServerDescription: "{{SERVER_DESCRIPTION}}",
    ServerWebsiteURL: "{{SERVER_WEBSITE_URL}}",
    ServerPassword: "{{SERVER_PASSWORD}}",
    ServerLoginConfirmationText: "",
    ServerPort: "{{PORT}}",
    ServerVisibility: "{{SERVER_VISIBILITY}}",
    ServerDisabledNetworkProtocols: "SteamNetworking",
    ServerMaxWorldTransferSpeedKiBs: "{{SERVER_MAX_WORLD_TRANSFER_SPEED}}",
    ServerMaxPlayerCount: "{{MAX_PLAYERS}}",
    ServerReservedSlots: "{{SERVER_RESERVED_SLOTS}}",
    ServerReservedSlotsPermission: "{{SERVER_RESERVED_SLOTS_PERMISSION}}",
    ServerAdminSlots: "{{SERVER_ADMIN_SLOTS}}",
    ServerAdminSlotsPermission: "{{SERVER_ADMIN_SLOTS_PERMISSION}}",
    ServerAllowCrossplay: "{{SERVER_ALLOW_CROSSPLAY}}",
    GameWorld: "{{GAME_WORLD}}",
    WorldGenSeed: "{{WORLD_GEN_SEED}}",
    WorldGenSize: "{{WORLD_GEN_SIZE}}",
    GameName: "{{WORLD_NAME}}",
    GameMode: "{{GAME_MODE}}",
    SaveDataLimit: "{{SAVE_DATA_LIMIT}}",
    GameDifficulty: "{{DIFFICULTY}}",
    XPMultiplier: "{{XP_MULTIPLIER}}",
    BlockDamagePlayer: "{{BLOCK_DAMAGE_PLAYER}}",
    BlockDamageAI: "{{BLOCK_DAMAGE_AI}}",
    BlockDamageAIBM: "{{BLOCK_DAMAGE_AI_BM}}",
    PlayerSafeZoneLevel: "{{PLAYER_SAFE_ZONE_LEVEL}}",
    PlayerSafeZoneHours: "{{PLAYER_SAFE_ZONE_HOURS}}",
    DayNightLength: "{{DAY_NIGHT_LENGTH}}",
    DayLightLength: "{{DAY_LIGHT_LENGTH}}",
    DayCount: "{{DAY_COUNT}}",
    LootAbundance: "{{LOOT_ABUNDANCE}}",
    LootRespawnDays: "{{LOOT_RESPAWN_DAYS}}",
    AirDropFrequency: "{{AIR_DROP_FREQUENCY}}",
    AirDropMarker: "{{AIR_DROP_MARKER}}",
    PartySharedKillRange: "{{PARTY_SHARED_KILL_RANGE}}",
    DropOnDeath: "{{DROP_ON_DEATH}}",
    DropOnQuit: "{{DROP_ON_QUIT}}",
    PlayerKillingMode: "{{PLAYER_KILLING_MODE}}",
    BedrollDeadZoneSize: "{{BEDROLL_DEAD_ZONE_SIZE}}",
    BedrollExpiryTime: "{{BEDROLL_EXPIRY_TIME}}",
    MaxSpawnedZombies: "{{MAX_SPAWNED_ZOMBIES}}",
    MaxSpawnedAnimals: "{{MAX_SPAWNED_ANIMALS}}",
    EnemySpawnMode: "{{ENEMY_SPAWN_MODE}}",
    EnemyDifficulty: "{{ENEMY_DIFFICULTY}}",
    ZombieMove: "{{ZOMBIE_MOVE}}",
    ZombieMoveNight: "{{ZOMBIE_MOVE_NIGHT}}",
    ZombieFeralMove: "{{ZOMBIE_FERAL_MOVE}}",
    ZombieBMMove: "{{ZOMBIE_BM_MOVE}}",
    BloodMoonFrequency: "{{BLOOD_MOON_FREQUENCY}}",
    BloodMoonRange: "{{BLOOD_MOON_RANGE}}",
    BloodMoonWarning: "{{BLOOD_MOON_WARNING}}",
    BloodMoonEnemyCount: "{{BLOOD_MOON_ENEMY_COUNT}}",
    EnemySenseMemory: "{{ENEMY_SENSE_MEMORY}}",
    LandClaimCount: "{{LAND_CLAIM_COUNT}}",
    LandClaimSize: "{{LAND_CLAIM_SIZE}}",
    LandClaimDeadZone: "{{LAND_CLAIM_DEAD_ZONE}}",
    LandClaimExpiryTime: "{{LAND_CLAIM_EXPIRY_TIME}}",
    LandClaimDecayMode: "{{LAND_CLAIM_DECAY_MODE}}",
    LandClaimOnlineDurabilityModifier: "{{LAND_CLAIM_ONLINE_DURABILITY_MODIFIER}}",
    LandClaimOfflineDurabilityModifier: "{{LAND_CLAIM_OFFLINE_DURABILITY_MODIFIER}}",
    LandClaimOfflineDelay: "{{LAND_CLAIM_OFFLINE_DELAY}}",
    ServerMaxAllowedViewDistance: "{{SERVER_MAX_ALLOWED_VIEW_DISTANCE}}",
    MaxQueuedMeshLayers: "{{MAX_QUEUED_MESH_LAYERS}}",
    MaxUncoveredMapChunksPerPlayer: "{{MAX_UNCOVERED_MAP_CHUNKS_PER_PLAYER}}",
    DynamicMeshEnabled: "{{DYNAMIC_MESH_ENABLED}}",
    DynamicMeshLandClaimOnly: "{{DYNAMIC_MESH_LAND_CLAIM_ONLY}}",
    DynamicMeshMaxItemCache: "{{DYNAMIC_MESH_MAX_ITEM_CACHE}}",
    PersistentPlayerProfiles: "{{PERSISTENT_PLAYER_PROFILES}}",
    EACEnabled: "{{EAC_ENABLED}}",
    TelnetEnabled: "{{TELNET_ENABLED}}",
    TelnetPort: "{{TELNET_PORT}}",
    TelnetPassword: "{{TELNET_PASSWORD}}",
    TelnetFailedLoginLimit: "{{TELNET_FAIL_COUNT}}",
    WebDashboardEnabled: "{{WEB_DASHBOARD_ENABLED}}",
    WebDashboardPort: "{{WEB_DASHBOARD_PORT}}",
    WebDashboardUrl: "{{WEB_DASHBOARD_URL}}",
    EnableMapRendering: "{{ENABLE_MAP_RENDERING}}",
    HideCommandExecutionLog: "{{HIDE_COMMAND_EXECUTION_LOG}}",
    AdminFileName: "{{ADMIN_FILE_NAME}}",
    TerminalWindowEnabled: "{{TERMINAL_WINDOW_ENABLED}}",
    UserDataFolder: "",
  },
};
