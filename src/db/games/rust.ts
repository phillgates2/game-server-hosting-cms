import { V, group, STEAM_VARS, RCON_VARS, type GameTemplate } from "./types";
import { steamInstallScript } from "./steamcmd";

// Rust dedicated server. Convars are written to server/<identity>/cfg/server.cfg
// as bare `convar "value"` lines, which the engine executes at boot.
export const rust: GameTemplate = {
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

    ...group("World", [
      V("World Seed", "WORLD_SEED", "Procedural map seed — changing it wipes the map", "12345", {
        required: false, type: "number", min_value: 0, max_value: 2147483647,
      }),
      V("World Size", "WORLD_SIZE", "Map size in metres (1000-6000, 3000-4500 recommended)", "3000", {
        required: false, type: "number", min_value: 1000, max_value: 6000,
      }),
      V("Level", "SERVER_LEVEL", "Map generator or premade map name", "Procedural Map", {
        required: false, type: "select",
        enum_values: {
          "Procedural Map": "Procedural Map", "Barren": "Barren", "HapisIsland": "Hapis Island",
          "CraggyIsland": "Craggy Island", "SavasIsland_koth": "Savas Island KOTH",
        },
      }),
      V("Level URL", "SERVER_LEVELURL", "URL of a custom map file, overrides the seed when set", "", { required: false }),
      V("Save Interval", "SERVER_SAVEINTERVAL", "Seconds between world saves", "600", {
        required: false, type: "number", min_value: 60, max_value: 7200,
      }),
      V("Server Identity", "SERVER_IDENTITY", "Folder name for this server's save data", "gsm", { required: false }),
    ]),

    ...group("Server Listing", [
      V("Description", "SERVER_DESCRIPTION", "Text shown on the server info panel", "Powered by GameServer Manager", { required: false }),
      V("Server URL", "SERVER_URL", "Website link shown in the server browser", "", { required: false }),
      V("Header Image", "SERVER_HEADERIMAGE", "URL of a 512x256 banner shown in the browser", "", { required: false }),
      V("Server Tags", "SERVER_TAGS", "Comma-separated browser tags, e.g. weekly,vanilla,NA", "", { required: false }),
      V("Encryption", "SERVER_ENCRYPTION", "Network encryption level", "1", {
        required: false, type: "select", enum_values: { "0": "0 — Off", "1": "1 — On", "2": "2 — Strict" },
      }),
      V("Server Secure", "SERVER_SECURE", "Enable VAC anti-cheat", "true", { required: false, type: "boolean" }),
      V("Server Password", "SERVER_PASSWORD", "Password required to join, empty = public", "", { required: false, type: "password" }),
    ]),

    ...group("Gameplay Rates", [
      V("Gather Rate — Dispenser", "GATHER_DISPENSER", "Multiplier for resources gathered from trees and ore", "1", { required: false, type: "float", min_value: 0.1, max_value: 100 }),
      V("Gather Rate — Pickup", "GATHER_PICKUP", "Multiplier for hand-picked items (hemp, stone, wood)", "1", { required: false, type: "float", min_value: 0.1, max_value: 100 }),
      V("Gather Rate — Quarry", "GATHER_QUARRY", "Multiplier for quarry and pump-jack output", "1", { required: false, type: "float", min_value: 0.1, max_value: 100 }),
      V("Craft Speed Multiplier", "CRAFT_INSTANT", "Craft everything instantly", "false", { required: false, type: "boolean" }),
      V("Smelt Speed", "SMELT_SPEED", "Furnace and campfire smelting speed multiplier", "1", { required: false, type: "float", min_value: 0.1, max_value: 100 }),
      V("Decay Scale", "DECAY_SCALE", "Building decay rate, 0 = no decay", "1", { required: false, type: "float", min_value: 0, max_value: 10 }),
      V("Upkeep Enabled", "DECAY_UPKEEP", "Require tool cupboard upkeep resources", "true", { required: false, type: "boolean" }),
      V("Stack Size Multiplier", "STACK_MULTIPLIER", "Global item stack size multiplier (requires a plugin on vanilla)", "1", { required: false, type: "float", min_value: 1, max_value: 1000 }),
    ]),

    ...group("Player & PvP", [
      V("PvE Mode", "SERVER_PVE", "Disable player-vs-player damage", "false", { required: false, type: "boolean" }),
      V("Radiation", "SERVER_RADIATION", "Enable radiation zones", "true", { required: false, type: "boolean" }),
      V("Respawn Reset Range", "SERVER_RESPAWNRESETRANGE", "Metres from a sleeping bag before respawn options reset", "0", {
        required: false, type: "number", min_value: 0, max_value: 10000,
      }),
      V("Player Health On Respawn", "SPAWN_MAX_HEALTH", "Health players wake up with", "100", {
        required: false, type: "number", min_value: 1, max_value: 500,
      }),
      V("Team UI Enabled", "RELATIONSHIP_MANAGER_ENABLED", "Enable the team/relationship system", "true", { required: false, type: "boolean" }),
      V("Max Team Size", "RELATIONSHIP_MAXTEAMSIZE", "Players allowed in one team, 0 = teams disabled", "8", {
        required: false, type: "number", min_value: 0, max_value: 64,
      }),
      V("Sleepers Enabled", "SERVER_SLEEPERS", "Players remain in the world as sleepers when offline", "true", { required: false, type: "boolean" }),
      V("Global Chat", "CHAT_GLOBALCHAT", "Enable server-wide chat", "true", { required: false, type: "boolean" }),
      V("Server Voice", "VOICE_ENABLED", "Enable in-game voice chat", "true", { required: false, type: "boolean" }),
    ]),

    ...group("Events & AI", [
      V("Airdrop Min Players", "AIRDROP_MIN_PLAYERS", "Players online before airdrops start spawning", "15", {
        required: false, type: "number", min_value: 0, max_value: 500,
      }),
      V("Helicopter Enabled", "HELI_ENABLED", "Enable patrol helicopter events", "true", { required: false, type: "boolean" }),
      V("Helicopter Population", "HELI_POPULATION", "Patrol helicopters alive at once", "1", { required: false, type: "float", min_value: 0, max_value: 10 }),
      V("Bradley Enabled", "BRADLEY_ENABLED", "Enable the Bradley APC at Launch Site", "true", { required: false, type: "boolean" }),
      V("Cargo Ship Population", "CARGOSHIP_POPULATION", "Cargo ships alive at once", "1", { required: false, type: "float", min_value: 0, max_value: 10 }),
      V("Chinook Population", "CHINOOK_POPULATION", "CH-47 Chinooks alive at once", "1", { required: false, type: "float", min_value: 0, max_value: 10 }),
      V("Cargo Plane Population", "CARGOPLANE_POPULATION", "Cargo planes (airdrops) alive at once", "1", { required: false, type: "float", min_value: 0, max_value: 10 }),
      V("Animal Population", "ANIMAL_POPULATION", "Wildlife density per square km", "10", { required: false, type: "float", min_value: 0, max_value: 200 }),
      V("Scientist Population", "SCIENTIST_POPULATION", "Roaming scientist NPC density", "1", { required: false, type: "float", min_value: 0, max_value: 50 }),
      V("Halloween Enabled", "HALLOWEEN_ENABLED", "Enable Halloween seasonal event content", "false", { required: false, type: "boolean" }),
      V("Xmas Enabled", "XMAS_ENABLED", "Enable Christmas seasonal event content", "false", { required: false, type: "boolean" }),
    ]),

    ...group("Performance & Limits", [
      V("Server Tickrate", "SERVER_TICKRATE", "Simulation ticks per second (10-30, higher costs CPU)", "10", {
        required: false, type: "number", min_value: 1, max_value: 60,
      }),
      V("Entity Rate", "SERVER_ENTITYRATE", "Entity updates sent per tick", "10", {
        required: false, type: "number", min_value: 1, max_value: 60,
      }),
      V("Update Batch", "SERVER_UPDATEBATCH", "Entities processed per network batch", "128", {
        required: false, type: "number", min_value: 16, max_value: 4096,
      }),
      V("Max Ping", "SERVER_MAXPING", "Kick players above this ping, 0 = no limit", "0", {
        required: false, type: "number", min_value: 0, max_value: 1000,
      }),
      V("Queued Player Limit", "SERVER_QUEUEDPLAYERSLIMIT", "Maximum players allowed in the join queue", "50", {
        required: false, type: "number", min_value: 0, max_value: 500,
      }),
      V("FPS Limit", "FPS_LIMIT", "Server frame rate cap, 0 = unlimited", "256", {
        required: false, type: "number", min_value: 0, max_value: 1000,
      }),
      V("Nexus Enabled", "NEXUS_ENABLED", "Join a Rust Nexus island cluster", "false", { required: false, type: "boolean" }),
    ]),

    ...group("RCON", [
      V("RCON Port", "RCON_PORT", "Port the RCON web listener binds to", "28016", {
        required: false, type: "number", min_value: 1, max_value: 65535,
      }),
      V("RCON Web", "RCON_WEB", "Use the WebSocket RCON protocol (required by most tools)", "true", { required: false, type: "boolean" }),
    ]),
  ],

  installScript: steamInstallScript({
    appId: "258550",
    name: "Rust",
    post: `## Rust reads convars from server/<identity>/cfg/server.cfg
mkdir -p "$INSTALL_DIR/server/{{SERVER_IDENTITY}}/cfg"`,
  }),

  startCommand: `cd {{INSTALL_PATH}} && ./RustDedicated -batchmode -nographics +server.port {{PORT}} +server.queryport {{QUERY_PORT}} +server.identity "{{SERVER_IDENTITY}}" +server.hostname "{{SERVER_NAME}}" +server.level "{{SERVER_LEVEL}}" +server.seed {{WORLD_SEED}} +server.worldsize {{WORLD_SIZE}} +server.maxplayers {{MAX_PLAYERS}} +server.tickrate {{SERVER_TICKRATE}} +rcon.port {{RCON_PORT}} +rcon.password "{{RCON_PASSWORD}}" +rcon.web {{RCON_WEB}}`,
  stopCommand: "quit",
  configFiles: { "server/{{SERVER_IDENTITY}}/cfg/server.cfg": "server.cfg" },
  defaultConfig: {
    __gsm_format: "source",
    "server.hostname": "{{SERVER_NAME}}",
    "server.description": "{{SERVER_DESCRIPTION}}",
    "server.url": "{{SERVER_URL}}",
    "server.headerimage": "{{SERVER_HEADERIMAGE}}",
    "server.tags": "{{SERVER_TAGS}}",
    "server.maxplayers": "{{MAX_PLAYERS}}",
    "server.worldsize": "{{WORLD_SIZE}}",
    "server.seed": "{{WORLD_SEED}}",
    "server.level": "{{SERVER_LEVEL}}",
    "server.levelurl": "{{SERVER_LEVELURL}}",
    "server.saveinterval": "{{SERVER_SAVEINTERVAL}}",
    "server.secure": "{{SERVER_SECURE}}",
    "server.encryption": "{{SERVER_ENCRYPTION}}",
    "server.password": "{{SERVER_PASSWORD}}",
    "server.pve": "{{SERVER_PVE}}",
    "server.radiation": "{{SERVER_RADIATION}}",
    "server.respawnresetrange": "{{SERVER_RESPAWNRESETRANGE}}",
    "server.sleepers": "{{SERVER_SLEEPERS}}",
    "server.tickrate": "{{SERVER_TICKRATE}}",
    "server.entityrate": "{{SERVER_ENTITYRATE}}",
    "server.updatebatch": "{{SERVER_UPDATEBATCH}}",
    "server.maxping": "{{SERVER_MAXPING}}",
    "server.queuedplayerslimit": "{{SERVER_QUEUEDPLAYERSLIMIT}}",
    "spawn.max_health": "{{SPAWN_MAX_HEALTH}}",
    "gather.dispenser_scale": "{{GATHER_DISPENSER}}",
    "gather.pickup_scale": "{{GATHER_PICKUP}}",
    "gather.quarry_scale": "{{GATHER_QUARRY}}",
    "craft.instant": "{{CRAFT_INSTANT}}",
    "smelt.speed": "{{SMELT_SPEED}}",
    "decay.scale": "{{DECAY_SCALE}}",
    "decay.upkeep": "{{DECAY_UPKEEP}}",
    "stack.multiplier": "{{STACK_MULTIPLIER}}",
    "relationshipmanager.contacts": "{{RELATIONSHIP_MANAGER_ENABLED}}",
    "relationshipmanager.maxteamsize": "{{RELATIONSHIP_MAXTEAMSIZE}}",
    "chat.globalchat": "{{CHAT_GLOBALCHAT}}",
    "voice.enabled": "{{VOICE_ENABLED}}",
    "airdrop.min_players": "{{AIRDROP_MIN_PLAYERS}}",
    "heli.enabled": "{{HELI_ENABLED}}",
    "heli.population": "{{HELI_POPULATION}}",
    "bradley.enabled": "{{BRADLEY_ENABLED}}",
    "cargoship.event_enabled": "{{CARGOSHIP_POPULATION}}",
    "ch47.population": "{{CHINOOK_POPULATION}}",
    "cargoplane.population": "{{CARGOPLANE_POPULATION}}",
    "animal.population": "{{ANIMAL_POPULATION}}",
    "scientist.population": "{{SCIENTIST_POPULATION}}",
    "halloween.enabled": "{{HALLOWEEN_ENABLED}}",
    "xmas.enabled": "{{XMAS_ENABLED}}",
    "fps.limit": "{{FPS_LIMIT}}",
    "nexus.enabled": "{{NEXUS_ENABLED}}",
    "rcon.port": "{{RCON_PORT}}",
    "rcon.password": "{{RCON_PASSWORD}}",
    "rcon.web": "{{RCON_WEB}}",
  },
};
