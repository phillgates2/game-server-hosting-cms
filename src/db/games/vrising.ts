import { V, group, STEAM_VARS, RCON_VARS, type GameTemplate } from "./types";
import { steamInstallScript } from "./steamcmd";

// V Rising splits configuration into two JSON files under save-data/Settings:
//   ServerHostSettings.json — hosting, ports, slots, RCON
//   ServerGameSettings.json — gameplay rules and multipliers
export const vrising: GameTemplate = {
  slug: "vrising",
  name: "V Rising",
  engine: "Unity",
  defaultPort: 9876,
  steamAppId: "1829350",
  iconEmoji: "\u{1F9DB}",
  supportsIpv6: false,
  category: "RPG",
  description: "Vampire survival action RPG",
  estimatedSize: "~5 GB",
  variables: [
    ...STEAM_VARS,
    ...RCON_VARS,

    ...group("Hosting", [
      V("Save Name", "SAVE_NAME", "World save folder name", "world1"),
      V("Server Description", "SERVER_DESCRIPTION", "Description shown in the server browser", "", { required: false }),
      V("Password", "SERVER_PASSWORD", "Password required to join, empty = public", "", { required: false, type: "password" }),
      V("List On Master Server", "LIST_ON_MASTER_SERVER", "Advertise in the in-game browser", "true", { required: false, type: "boolean" }),
      V("Max Connected Admins", "MAX_CONNECTED_ADMINS", "Admin slots on top of the player cap", "4", {
        required: false, type: "number", min_value: 0, max_value: 32,
      }),
      V("Server FPS", "SERVER_FPS", "Server tick rate", "30", {
        required: false, type: "number", min_value: 10, max_value: 120,
      }),
      V("Auto Save Count", "AUTO_SAVE_COUNT", "Rotating autosaves to keep", "50", {
        required: false, type: "number", min_value: 1, max_value: 500,
      }),
      V("Auto Save Interval", "AUTO_SAVE_INTERVAL", "Seconds between autosaves", "600", {
        required: false, type: "number", min_value: 60, max_value: 86400,
      }),
      V("Game Preset", "GAME_PRESET", "Built-in ruleset preset, empty = use the settings below", "", { required: false }),
      V("Game Difficulty Preset", "GAME_DIFFICULTY_PRESET", "Difficulty preset applied on world creation", "", { required: false }),
      V("Rcon Enabled", "RCON_ENABLED", "Enable the RCON listener", "false", { required: false, type: "boolean" }),
      V("Rcon Port", "RCON_PORT", "Port RCON binds to", "25575", {
        required: false, type: "number", min_value: 1, max_value: 65535,
      }),
      V("API Enabled", "API_ENABLED", "Expose the HTTP metrics/admin API", "false", { required: false, type: "boolean" }),
    ]),

    ...group("Game Mode & PvP", [
      V("Game Mode Type", "GAME_MODE_TYPE", "Master PvP/PvE switch", "PvE", {
        required: false, type: "select", enum_values: { PvP: "PvP", PvE: "PvE" },
      }),
      V("Castle Damage Mode", "CASTLE_DAMAGE_MODE", "When castles may be damaged", "TimeRestricted", {
        required: false, type: "select",
        enum_values: { Always: "Always", Never: "Never", TimeRestricted: "Time restricted" },
      }),
      V("Player Damage Mode", "PLAYER_DAMAGE_MODE", "When players may damage each other", "TimeRestricted", {
        required: false, type: "select", enum_values: { Always: "Always", TimeRestricted: "Time restricted" },
      }),
      V("Castle Heart Damage Mode", "CASTLE_HEART_DAMAGE_MODE", "How castle hearts may be taken", "CanBeDestroyedOnlyWhenDecaying", {
        required: false, type: "select",
        enum_values: {
          CanBeDestroyedOnlyWhenDecaying: "Only when decaying",
          CanBeDestroyedByPlayers: "Can be destroyed by players",
          CanBeSeizedOrDestroyedByPlayers: "Can be seized or destroyed",
        },
      }),
      V("PvP Protection Mode", "PVP_PROTECTION_MODE", "Grace period for new characters", "Medium", {
        required: false, type: "select",
        enum_values: { Disabled: "Disabled", Short: "Short", Medium: "Medium", Long: "Long" },
      }),
      V("Siege Weapon Health", "SIEGE_WEAPON_HEALTH", "Durability of the siege golem", "Normal", {
        required: false, type: "select",
        enum_values: {
          VeryLow: "Very Low", Low: "Low", Normal: "Normal", High: "High",
          VeryHigh: "Very High", MegaHigh: "Mega High", UltraHigh: "Ultra High",
        },
      }),
      V("Death Container Permission", "DEATH_CONTAINER_PERMISSION", "Who may loot your death container", "ClanMembers", {
        required: false, type: "select",
        enum_values: { Anyone: "Anyone", ClanMembers: "Clan members", OnlySelf: "Only self" },
      }),
      V("Relic Spawn Type", "RELIC_SPAWN_TYPE", "Whether Soul Shards are unique", "Unique", {
        required: false, type: "select", enum_values: { Unique: "Unique", Plentiful: "Plentiful" },
      }),
      V("Can Loot Enemy Containers", "CAN_LOOT_ENEMY_CONTAINERS", "Players may loot other clans' chests", "false", { required: false, type: "boolean" }),
      V("Blood Bound Equipment", "BLOOD_BOUND_EQUIPMENT", "Equipped gear stays with you on death", "true", { required: false, type: "boolean" }),
      V("Teleport Bound Items", "TELEPORT_BOUND_ITEMS", "Carry restricted materials through waygates", "true", { required: false, type: "boolean" }),
      V("Announce Siege Weapon Spawn", "ANNOUNCE_SIEGE_WEAPON_SPAWN", "Broadcast when a siege golem is deployed", "true", { required: false, type: "boolean" }),
      V("Show Siege Weapon Map Icon", "SHOW_SIEGE_WEAPON_MAP_ICON", "Show deployed siege golems on the map", "false", { required: false, type: "boolean" }),
    ]),

    ...group("Clan & Castle", [
      V("Clan Size", "CLAN_SIZE", "Maximum members per clan", "4", {
        required: false, type: "number", min_value: 1, max_value: 50,
      }),
      V("Castle Limit", "CASTLE_LIMIT", "Castles a clan may own at once", "2", {
        required: false, type: "number", min_value: 1, max_value: 10,
      }),
      V("Castle Minimum Distance", "CASTLE_MINIMUM_DISTANCE_IN_FLOORS", "Minimum floor tiles between rival castles", "2", {
        required: false, type: "number", min_value: 0, max_value: 100,
      }),
      V("Castle Decay Rate", "CASTLE_DECAY_RATE_MODIFIER", "How fast unfuelled castles decay", "1.0", { required: false, type: "float", min_value: 0, max_value: 10 }),
      V("Castle Blood Essence Drain", "CASTLE_BLOOD_ESSENCE_DRAIN_MODIFIER", "How fast castle hearts consume Blood Essence", "1.0", { required: false, type: "float", min_value: 0, max_value: 10 }),
      V("Castle Siege Timer", "CASTLE_SIEGE_TIMER", "Seconds a castle stays vulnerable during a siege", "420.0", { required: false, type: "float", min_value: 60, max_value: 7200 }),
      V("Castle Under Attack Timer", "CASTLE_UNDER_ATTACK_TIMER", "Seconds the under-attack state persists", "60.0", { required: false, type: "float", min_value: 10, max_value: 3600 }),
      V("Tomb Limit", "TOMB_LIMIT", "Servant coffins allowed per castle", "12", {
        required: false, type: "number", min_value: 0, max_value: 100,
      }),
      V("Vermin Nest Limit", "VERMIN_NEST_LIMIT", "Vermin nests allowed per castle", "4", {
        required: false, type: "number", min_value: 0, max_value: 100,
      }),
      V("Safety Box Limit", "SAFETY_BOX_LIMIT", "Safety boxes allowed per castle", "1", {
        required: false, type: "number", min_value: 0, max_value: 50,
      }),
    ]),

    ...group("Rates & Modifiers", [
      V("Inventory Stacks Modifier", "INVENTORY_STACKS_MODIFIER", "Inventory stack size multiplier", "1.0", { required: false, type: "float", min_value: 0.1, max_value: 100 }),
      V("Drop Table Modifier (General)", "DROP_TABLE_MODIFIER_GENERAL", "Loot dropped by enemies", "1.0", { required: false, type: "float", min_value: 0.1, max_value: 100 }),
      V("Drop Table Modifier (Missions)", "DROP_TABLE_MODIFIER_MISSIONS", "Loot from servant missions", "1.0", { required: false, type: "float", min_value: 0.1, max_value: 100 }),
      V("Material Yield Modifier", "MATERIAL_YIELD_MODIFIER_GLOBAL", "Resources gained from nodes", "1.0", { required: false, type: "float", min_value: 0.1, max_value: 100 }),
      V("Blood Essence Yield", "BLOOD_ESSENCE_YIELD_MODIFIER", "Blood Essence gained from enemies", "1.0", { required: false, type: "float", min_value: 0.1, max_value: 100 }),
      V("Blood Drain Modifier", "BLOOD_DRAIN_MODIFIER", "How fast player blood drains", "1.0", { required: false, type: "float", min_value: 0.1, max_value: 100 }),
      V("Durability Drain Modifier", "DURABILITY_DRAIN_MODIFIER", "How fast equipment wears out", "1.0", { required: false, type: "float", min_value: 0, max_value: 100 }),
      V("Garlic Area Strength", "GARLIC_AREA_STRENGTH_MODIFIER", "Strength of garlic debuff areas", "1.0", { required: false, type: "float", min_value: 0, max_value: 10 }),
      V("Holy Area Strength", "HOLY_AREA_STRENGTH_MODIFIER", "Strength of holy debuff areas", "1.0", { required: false, type: "float", min_value: 0, max_value: 10 }),
      V("Silver Strength", "SILVER_STRENGTH_MODIFIER", "Strength of the silver debuff", "1.0", { required: false, type: "float", min_value: 0, max_value: 10 }),
      V("Sun Damage Modifier", "SUN_DAMAGE_MODIFIER", "Damage taken from sunlight", "1.0", { required: false, type: "float", min_value: 0, max_value: 10 }),
      V("Repair Cost Modifier", "REPAIR_COST_MODIFIER", "Resource cost of repairs", "1.0", { required: false, type: "float", min_value: 0, max_value: 10 }),
      V("Servant Convert Rate", "SERVANT_CONVERT_RATE", "Time taken to convert a servant", "1.0", { required: false, type: "float", min_value: 0.1, max_value: 100 }),
      V("PvP Vampire Respawn", "PVP_VAMPIRE_RESPAWN_MODIFIER", "Respawn delay after dying in PvP", "1.0", { required: false, type: "float", min_value: 0.1, max_value: 100 }),
      V("Death Durability Loss", "DEATH_DURABILITY_FACTOR_LOSS", "Fraction of durability lost on death", "0.25", { required: false, type: "float", min_value: 0, max_value: 1 }),
    ]),

    ...group("World & Time", [
      V("Day Duration", "DAY_DURATION_IN_SECONDS", "Length of an in-game day in seconds", "1080.0", { required: false, type: "float", min_value: 60, max_value: 86400 }),
      V("Day Start Hour", "DAY_START_HOUR", "In-game hour daytime begins", "9", {
        required: false, type: "number", min_value: 0, max_value: 23,
      }),
      V("Day End Hour", "DAY_END_HOUR", "In-game hour daytime ends", "17", {
        required: false, type: "number", min_value: 0, max_value: 23,
      }),
      V("Blood Moon Frequency Min", "BLOOD_MOON_FREQUENCY_MIN", "Minimum days between blood moons", "10", {
        required: false, type: "number", min_value: 0, max_value: 100,
      }),
      V("Blood Moon Frequency Max", "BLOOD_MOON_FREQUENCY_MAX", "Maximum days between blood moons", "18", {
        required: false, type: "number", min_value: 0, max_value: 100,
      }),
      V("Blood Moon Buff", "BLOOD_MOON_BUFF", "Strength of the blood moon buff", "0.2", { required: false, type: "float", min_value: 0, max_value: 5 }),
      V("Allow Global Chat", "ALLOW_GLOBAL_CHAT", "Enable server-wide chat", "true", { required: false, type: "boolean" }),
      V("All Waypoints Unlocked", "ALL_WAYPOINTS_UNLOCKED", "Reveal all waygates from the start", "false", { required: false, type: "boolean" }),
      V("Free Castle Claim", "FREE_CASTLE_CLAIM", "Claiming an abandoned castle is free", "false", { required: false, type: "boolean" }),
      V("Inactivity Kill Enabled", "INACTIVITY_KILL_ENABLED", "Kill characters left inactive in the world", "false", { required: false, type: "boolean" }),
      V("Inactivity Kill Time Min", "INACTIVITY_KILL_TIME_MIN", "Seconds of inactivity before the kill timer starts", "3600", {
        required: false, type: "number", min_value: 60, max_value: 604800,
      }),
      V("Disconnected Dead Enabled", "DISABLE_DISCONNECTED_DEAD_ENABLED", "Remove dead characters after disconnect", "false", { required: false, type: "boolean" }),
      V("Disconnected Dead Timer", "DISABLE_DISCONNECTED_DEAD_TIMER", "Seconds before a disconnected dead player is removed", "60", {
        required: false, type: "number", min_value: 10, max_value: 86400,
      }),
    ]),

    ...group("Vampire Stats", [
      V("Max Health Modifier", "MAX_HEALTH_MODIFIER", "Player max health multiplier", "1.0", { required: false, type: "float", min_value: 0.1, max_value: 100 }),
      V("Physical Power Modifier", "PHYSICAL_POWER_MODIFIER", "Player physical damage multiplier", "1.0", { required: false, type: "float", min_value: 0.1, max_value: 100 }),
      V("Spell Power Modifier", "SPELL_POWER_MODIFIER", "Player spell damage multiplier", "1.0", { required: false, type: "float", min_value: 0.1, max_value: 100 }),
      V("Resource Power Modifier", "RESOURCE_POWER_MODIFIER", "Player gathering power multiplier", "1.0", { required: false, type: "float", min_value: 0.1, max_value: 100 }),
      V("Siege Power Modifier", "SIEGE_POWER_MODIFIER", "Player siege damage multiplier", "1.0", { required: false, type: "float", min_value: 0.1, max_value: 100 }),
      V("Damage Received Modifier", "DAMAGE_RECEIVED_MODIFIER", "Damage the player takes", "1.0", { required: false, type: "float", min_value: 0.1, max_value: 100 }),
      V("Revive Cancel Delay", "REVIVE_CANCEL_DELAY", "Seconds before a revive can be cancelled", "5.0", { required: false, type: "float", min_value: 0, max_value: 60 }),
      V("Unit Max Health Modifier", "UNIT_MAX_HEALTH_MODIFIER", "Enemy max health multiplier", "1.0", { required: false, type: "float", min_value: 0.1, max_value: 100 }),
      V("Unit Physical Power", "UNIT_PHYSICAL_POWER_MODIFIER", "Enemy physical damage multiplier", "1.0", { required: false, type: "float", min_value: 0.1, max_value: 100 }),
      V("Unit Spell Power", "UNIT_SPELL_POWER_MODIFIER", "Enemy spell damage multiplier", "1.0", { required: false, type: "float", min_value: 0.1, max_value: 100 }),
    ]),
  ],

  installScript: steamInstallScript({
    appId: "1829350",
    name: "V Rising",
    platform: "windows",
    pre: `## V Rising ships a Windows-only dedicated server (AppID 1829350) — it needs Wine.
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
command -v dos2unix &> /dev/null || echo "Note: dos2unix not available; config copy fallback will be used."`,
    post: `## The panel writes ServerHostSettings.json and ServerGameSettings.json into
## save-data/Settings after this script finishes — just ensure the dirs exist.
mkdir -p "$HOME/save-data/Settings" "$HOME/logs"

if [ ! -f "$HOME/VRisingServer.exe" ]; then
  echo "ERROR: VRisingServer.exe not found after install" >&2
  find "$HOME" -maxdepth 3 -type f | sort | tail -50
  exit 1
fi`,
  }),

  startCommand: `cd {{INSTALL_PATH}} && if command -v xvfb-run >/dev/null 2>&1; then exec xvfb-run -a wine ./VRisingServer.exe -persistentDataPath ./save-data -serverName "{{SERVER_NAME}}" -saveName "{{SAVE_NAME}}" -logFile ./logs/VRisingServer.log; else exec wine ./VRisingServer.exe -persistentDataPath ./save-data -serverName "{{SERVER_NAME}}" -saveName "{{SAVE_NAME}}" -logFile ./logs/VRisingServer.log; fi`,
  stopCommand: null,
  configFiles: {
    "save-data/Settings/ServerHostSettings.json": "ServerHostSettings.json",
    "save-data/Settings/ServerGameSettings.json": "ServerGameSettings.json",
  },
  defaultConfig: {
    __files: {
      "save-data/Settings/ServerHostSettings.json": {
        __gsm_format: "json",
        Name: "{{SERVER_NAME}}",
        Description: "{{SERVER_DESCRIPTION}}",
        Port: "{{PORT}}",
        QueryPort: "{{QUERY_PORT}}",
        MaxConnectedUsers: "{{MAX_PLAYERS}}",
        MaxConnectedAdmins: "{{MAX_CONNECTED_ADMINS}}",
        ServerFps: "{{SERVER_FPS}}",
        SaveName: "{{SAVE_NAME}}",
        Password: "{{SERVER_PASSWORD}}",
        Secure: true,
        ListOnMasterServer: "{{LIST_ON_MASTER_SERVER}}",
        AutoSaveCount: "{{AUTO_SAVE_COUNT}}",
        AutoSaveInterval: "{{AUTO_SAVE_INTERVAL}}",
        GameSettingsPreset: "{{GAME_PRESET}}",
        GameDifficultyPreset: "{{GAME_DIFFICULTY_PRESET}}",
        AdminOnlyDebugEvents: true,
        DisableDebugEvents: false,
        API: { Enabled: "{{API_ENABLED}}" },
        Rcon: {
          Enabled: "{{RCON_ENABLED}}",
          Port: "{{RCON_PORT}}",
          Password: "{{RCON_PASSWORD}}",
        },
      },
      "save-data/Settings/ServerGameSettings.json": {
        __gsm_format: "json",
        GameModeType: "{{GAME_MODE_TYPE}}",
        CastleDamageMode: "{{CASTLE_DAMAGE_MODE}}",
        SiegeWeaponHealth: "{{SIEGE_WEAPON_HEALTH}}",
        PlayerDamageMode: "{{PLAYER_DAMAGE_MODE}}",
        CastleHeartDamageMode: "{{CASTLE_HEART_DAMAGE_MODE}}",
        PvPProtectionMode: "{{PVP_PROTECTION_MODE}}",
        DeathContainerPermission: "{{DEATH_CONTAINER_PERMISSION}}",
        RelicSpawnType: "{{RELIC_SPAWN_TYPE}}",
        CanLootEnemyContainers: "{{CAN_LOOT_ENEMY_CONTAINERS}}",
        BloodBoundEquipment: "{{BLOOD_BOUND_EQUIPMENT}}",
        TeleportBoundItems: "{{TELEPORT_BOUND_ITEMS}}",
        AllowGlobalChat: "{{ALLOW_GLOBAL_CHAT}}",
        AllWaypointsUnlocked: "{{ALL_WAYPOINTS_UNLOCKED}}",
        FreeCastleClaim: "{{FREE_CASTLE_CLAIM}}",
        InactivityKillEnabled: "{{INACTIVITY_KILL_ENABLED}}",
        InactivityKillTimeMin: "{{INACTIVITY_KILL_TIME_MIN}}",
        DisableDisconnectedDeadEnabled: "{{DISABLE_DISCONNECTED_DEAD_ENABLED}}",
        DisableDisconnectedDeadTimer: "{{DISABLE_DISCONNECTED_DEAD_TIMER}}",
        AnnounceSiegeWeaponSpawn: "{{ANNOUNCE_SIEGE_WEAPON_SPAWN}}",
        ShowSiegeWeaponMapIcon: "{{SHOW_SIEGE_WEAPON_MAP_ICON}}",
        ClanSize: "{{CLAN_SIZE}}",
        CastleMinimumDistanceInFloors: "{{CASTLE_MINIMUM_DISTANCE_IN_FLOORS}}",
        CastleDecayRateModifier: "{{CASTLE_DECAY_RATE_MODIFIER}}",
        CastleBloodEssenceDrainModifier: "{{CASTLE_BLOOD_ESSENCE_DRAIN_MODIFIER}}",
        CastleSiegeTimer: "{{CASTLE_SIEGE_TIMER}}",
        CastleUnderAttackTimer: "{{CASTLE_UNDER_ATTACK_TIMER}}",
        InventoryStacksModifier: "{{INVENTORY_STACKS_MODIFIER}}",
        DropTableModifier_General: "{{DROP_TABLE_MODIFIER_GENERAL}}",
        DropTableModifier_Missions: "{{DROP_TABLE_MODIFIER_MISSIONS}}",
        MaterialYieldModifier_Global: "{{MATERIAL_YIELD_MODIFIER_GLOBAL}}",
        BloodEssenceYieldModifier: "{{BLOOD_ESSENCE_YIELD_MODIFIER}}",
        BloodDrainModifier: "{{BLOOD_DRAIN_MODIFIER}}",
        DurabilityDrainModifier: "{{DURABILITY_DRAIN_MODIFIER}}",
        GarlicAreaStrengthModifier: "{{GARLIC_AREA_STRENGTH_MODIFIER}}",
        HolyAreaStrengthModifier: "{{HOLY_AREA_STRENGTH_MODIFIER}}",
        SilverStrengthModifier: "{{SILVER_STRENGTH_MODIFIER}}",
        SunDamageModifier: "{{SUN_DAMAGE_MODIFIER}}",
        RepairCostModifier: "{{REPAIR_COST_MODIFIER}}",
        ServantConvertRate: "{{SERVANT_CONVERT_RATE}}",
        PvPVampireRespawnModifier: "{{PVP_VAMPIRE_RESPAWN_MODIFIER}}",
        Death_DurabilityFactorLoss: "{{DEATH_DURABILITY_FACTOR_LOSS}}",
        VampireStatModifiers: {
          MaxHealthModifier: "{{MAX_HEALTH_MODIFIER}}",
          PhysicalPowerModifier: "{{PHYSICAL_POWER_MODIFIER}}",
          SpellPowerModifier: "{{SPELL_POWER_MODIFIER}}",
          ResourcePowerModifier: "{{RESOURCE_POWER_MODIFIER}}",
          SiegePowerModifier: "{{SIEGE_POWER_MODIFIER}}",
          DamageReceivedModifier: "{{DAMAGE_RECEIVED_MODIFIER}}",
          ReviveCancelDelay: "{{REVIVE_CANCEL_DELAY}}",
        },
        UnitStatModifiers_Global: {
          MaxHealthModifier: "{{UNIT_MAX_HEALTH_MODIFIER}}",
          PhysicalPowerModifier: "{{UNIT_PHYSICAL_POWER_MODIFIER}}",
          SpellPowerModifier: "{{UNIT_SPELL_POWER_MODIFIER}}",
        },
        CastleStatModifiers_Global: {
          TickPeriod: 5.0,
          DamageResistance: 0.0,
          SafetyBoxLimit: "{{SAFETY_BOX_LIMIT}}",
          TombLimit: "{{TOMB_LIMIT}}",
          VerminNestLimit: "{{VERMIN_NEST_LIMIT}}",
          CastleLimit: "{{CASTLE_LIMIT}}",
        },
        VSCastleTimeZone: "Local",
        DayDurationInSeconds: "{{DAY_DURATION_IN_SECONDS}}",
        DayStartHour: "{{DAY_START_HOUR}}",
        DayStartMinute: 0,
        DayEndHour: "{{DAY_END_HOUR}}",
        DayEndMinute: 0,
        BloodMoonFrequency_Min: "{{BLOOD_MOON_FREQUENCY_MIN}}",
        BloodMoonFrequency_Max: "{{BLOOD_MOON_FREQUENCY_MAX}}",
        BloodMoonBuff: "{{BLOOD_MOON_BUFF}}",
      },
    },
  },
};
