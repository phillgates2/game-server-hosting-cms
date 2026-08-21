import { V, group, csv, COMMON_VARS, type GameTemplate } from "./types";
import { steamInstallScript } from "./steamcmd";

// Enshrouded reads a single JSON document, enshrouded_server.json.
// gameSettings is only honoured when gameSettingsPreset is "Custom".
export const enshrouded: GameTemplate = {
  slug: "enshrouded",
  name: "Enshrouded",
  engine: "Custom",
  defaultPort: 15636,
  steamAppId: "2278520",
  iconEmoji: "🌫️",
  supportsIpv6: false,
  category: "Survival",
  description: "Survival action RPG in a cursed voxel world",
  estimatedSize: "~5 GB",
  variables: [
    ...COMMON_VARS,

    ...group("Server", [
      V("Query Port", "QUERY_PORT", "Steam query port (game port + 1)", "15637", {
        required: false, type: "number", min_value: 1, max_value: 65535,
      }),
      V("Password", "PASSWORD", "Default join password, empty = public", "", { required: false, type: "password" }),
      V("Save Directory", "SAVE_DIRECTORY", "Where world saves are written", "./savegame", { required: false }),
      V("Log Directory", "LOG_DIRECTORY", "Where server logs are written", "./logs", { required: false }),
      V("Server Tags", "TAGS", "Comma-separated browser tags, e.g. Roleplay,EN", "", { required: false }),
      V("Enable Voice Chat", "ENABLE_VOICE_CHAT", "Enable in-game voice chat", "false", { required: false, type: "boolean" }),
      V("Enable Text Chat", "ENABLE_TEXT_CHAT", "Enable in-game text chat", "false", { required: false, type: "boolean" }),
      V("Voice Chat Mode", "VOICE_CHAT_MODE", "Proximity or server-wide voice", "Proximity", {
        required: false, type: "select", enum_values: { Proximity: "Proximity", Global: "Global" },
      }),
    ]),

    ...group("Difficulty Preset", [
      V("Game Settings Preset", "GAME_SETTINGS_PRESET", "Preset applied — pick Custom to use the values below", "Default", {
        required: false, type: "select",
        enum_values: {
          Default: "Default", Relaxed: "Relaxed", Hard: "Hard",
          Survival: "Survival", Custom: "Custom (use the settings below)",
        },
      }),
    ]),

    ...group("Player Settings", [
      V("Player Health Factor", "PLAYER_HEALTH_FACTOR", "Scales player max health (0.25-4)", "1", { required: false, type: "float", min_value: 0.25, max_value: 4 }),
      V("Player Mana Factor", "PLAYER_MANA_FACTOR", "Scales player max mana (0.25-4)", "1", { required: false, type: "float", min_value: 0.25, max_value: 4 }),
      V("Player Stamina Factor", "PLAYER_STAMINA_FACTOR", "Scales player max stamina (0.25-4)", "1", { required: false, type: "float", min_value: 0.25, max_value: 4 }),
      V("Player Body Heat Factor", "PLAYER_BODY_HEAT_FACTOR", "Cold resistance (0.5-2)", "1", { required: false, type: "float", min_value: 0.5, max_value: 2 }),
      V("Player Diving Time Factor", "PLAYER_DIVING_TIME_FACTOR", "Oxygen available underwater (0.5-2)", "1", { required: false, type: "float", min_value: 0.5, max_value: 2 }),
      V("Enable Durability", "ENABLE_DURABILITY", "Weapons and tools lose durability", "true", { required: false, type: "boolean" }),
      V("Enable Starving Debuff", "ENABLE_STARVING_DEBUFF", "Players lose health while starving", "false", { required: false, type: "boolean" }),
      V("Food Buff Duration Factor", "FOOD_BUFF_DURATION_FACTOR", "Food buff length (0.5-2)", "1", { required: false, type: "float", min_value: 0.5, max_value: 2 }),
      V("From Hunger To Starving", "FROM_HUNGER_TO_STARVING", "Nanoseconds of hunger before starvation (min 300000000000)", "600000000000", {
        required: false, type: "number", min_value: 300000000000, max_value: 1200000000000,
      }),
      V("Shroud Time Factor", "SHROUD_TIME_FACTOR", "Time survivable inside the Shroud (0.5-2)", "1", { required: false, type: "float", min_value: 0.5, max_value: 2 }),
      V("Tombstone Mode", "TOMBSTONE_MODE", "What is lost on death", "AddBackpackMaterials", {
        required: false, type: "select",
        enum_values: {
          AddBackpackMaterials: "Add backpack materials", Everything: "Everything", NoTombstone: "No tombstone",
        },
      }),
      V("Enable Glider Turbulences", "ENABLE_GLIDER_TURBULENCES", "Glider is affected by air turbulence", "true", { required: false, type: "boolean" }),
    ]),

    ...group("World Settings", [
      V("Weather Frequency", "WEATHER_FREQUENCY", "How often weather events occur", "Normal", {
        required: false, type: "select",
        enum_values: { Disabled: "Disabled", Rare: "Rare", Normal: "Normal", Often: "Often" },
      }),
      V("Fishing Difficulty", "FISHING_DIFFICULTY", "Strength of fish in the fishing minigame", "Normal", {
        required: false, type: "select",
        enum_values: { VeryEasy: "Very Easy", Easy: "Easy", Normal: "Normal", Hard: "Hard", VeryHard: "Very Hard" },
      }),
      V("Mining Damage Factor", "MINING_DAMAGE_FACTOR", "Mining and terraforming speed (0.5-2)", "1", { required: false, type: "float", min_value: 0.5, max_value: 2 }),
      V("Plant Growth Speed Factor", "PLANT_GROWTH_SPEED_FACTOR", "Crop growth speed (0.25-2)", "1", { required: false, type: "float", min_value: 0.25, max_value: 2 }),
      V("Resource Drop Stack Factor", "RESOURCE_DROP_STACK_AMOUNT_FACTOR", "Materials per loot stack (0.25-2)", "1", { required: false, type: "float", min_value: 0.25, max_value: 2 }),
      V("Factory Production Speed", "FACTORY_PRODUCTION_SPEED_FACTOR", "Workstation crafting speed (0.25-2)", "1", { required: false, type: "float", min_value: 0.25, max_value: 2 }),
      V("Perk Upgrade Recycling", "PERK_UPGRADE_RECYCLING_FACTOR", "Runes refunded when salvaging (0-1)", "0.5", { required: false, type: "float", min_value: 0, max_value: 1 }),
      V("Perk Cost Factor", "PERK_COST_FACTOR", "Rune cost for weapon upgrades (0.25-2)", "1", { required: false, type: "float", min_value: 0.25, max_value: 2 }),
      V("Day Time Duration", "DAY_TIME_DURATION", "Daytime length in nanoseconds", "1800000000000", {
        required: false, type: "number", min_value: 120000000000, max_value: 3600000000000,
      }),
      V("Night Time Duration", "NIGHT_TIME_DURATION", "Nighttime length in nanoseconds", "720000000000", {
        required: false, type: "number", min_value: 120000000000, max_value: 3600000000000,
      }),
      V("Curse Modifier", "CURSE_MODIFIER", "Chance of receiving the Shroud curse", "Normal", {
        required: false, type: "select",
        enum_values: { Easy: "Easy (curse off)", Normal: "Normal", Hard: "Hard (double chance)" },
      }),
    ]),

    ...group("Experience", [
      V("Experience Combat Factor", "EXPERIENCE_COMBAT_FACTOR", "XP from combat (0.25-2)", "1", { required: false, type: "float", min_value: 0.25, max_value: 2 }),
      V("Experience Mining Factor", "EXPERIENCE_MINING_FACTOR", "XP from mining (0-2)", "1", { required: false, type: "float", min_value: 0, max_value: 2 }),
      V("Experience Exploration Factor", "EXPERIENCE_EXPLORATION_QUESTS_FACTOR", "XP from exploration and quests (0.25-2)", "1", { required: false, type: "float", min_value: 0.25, max_value: 2 }),
    ]),

    ...group("Enemies", [
      V("Random Spawner Amount", "RANDOM_SPAWNER_AMOUNT", "Ambient enemy density", "Normal", {
        required: false, type: "select",
        enum_values: { Few: "Few", Normal: "Normal", Many: "Many", Extreme: "Extreme" },
      }),
      V("Aggro Pool Amount", "AGGRO_POOL_AMOUNT", "How many enemies may attack at once", "Normal", {
        required: false, type: "select",
        enum_values: { Few: "Few", Normal: "Normal", Many: "Many", Extreme: "Extreme" },
      }),
      V("Enemy Damage Factor", "ENEMY_DAMAGE_FACTOR", "Non-boss enemy damage (0.25-5)", "1", { required: false, type: "float", min_value: 0.25, max_value: 5 }),
      V("Enemy Health Factor", "ENEMY_HEALTH_FACTOR", "Non-boss enemy health (0.25-4)", "1", { required: false, type: "float", min_value: 0.25, max_value: 4 }),
      V("Enemy Stamina Factor", "ENEMY_STAMINA_FACTOR", "Non-boss stagger resistance (0.5-2)", "1", { required: false, type: "float", min_value: 0.5, max_value: 2 }),
      V("Enemy Perception Range", "ENEMY_PERCEPTION_RANGE_FACTOR", "How far enemies notice players (0.5-2)", "1", { required: false, type: "float", min_value: 0.5, max_value: 2 }),
      V("Boss Damage Factor", "BOSS_DAMAGE_FACTOR", "Boss attack damage (0.2-5)", "1", { required: false, type: "float", min_value: 0.2, max_value: 5 }),
      V("Boss Health Factor", "BOSS_HEALTH_FACTOR", "Boss health (0.2-5)", "1", { required: false, type: "float", min_value: 0.2, max_value: 5 }),
      V("Threat Bonus", "THREAT_BONUS", "Frequency of enemy attacks (0.25-4)", "1", { required: false, type: "float", min_value: 0.25, max_value: 4 }),
      V("Pacify All Enemies", "PACIFY_ALL_ENEMIES", "Enemies only attack when provoked", "false", { required: false, type: "boolean" }),
      V("Taming Startle Repercussion", "TAMING_STARTLE_REPERCUSSION", "Progress lost when startling wildlife", "LoseSomeProgress", {
        required: false, type: "select",
        enum_values: { KeepProgress: "Keep progress", LoseSomeProgress: "Lose some progress", LoseAllProgress: "Lose all progress" },
      }),
    ]),

    ...group("User Groups", [
      V("Admin Password", "ADMIN_PASSWORD", "Password for the Admin permission group", "", { required: false, type: "password" }),
      V("Friend Password", "FRIEND_PASSWORD", "Password for the Friend permission group", "", { required: false, type: "password" }),
      V("Guest Password", "GUEST_PASSWORD", "Password for the Guest permission group", "", { required: false, type: "password" }),
      V("Admin Reserved Slots", "ADMIN_RESERVED_SLOTS", "Slots reserved for admins", "0", {
        required: false, type: "number", min_value: 0, max_value: 16,
      }),
    ]),
  ],

  installScript: steamInstallScript({ appId: "2278520", name: "Enshrouded" }),

  startCommand: `cd {{INSTALL_PATH}} && ./enshrouded_server -batchmode -nographics`,
  stopCommand: null,
  configFiles: { "enshrouded_server.json": "enshrouded_server.json" },
  defaultConfig: {
    __gsm_format: "json",
    name: "{{SERVER_NAME}}",
    password: "{{PASSWORD}}",
    saveDirectory: "{{SAVE_DIRECTORY}}",
    logDirectory: "{{LOG_DIRECTORY}}",
    ip: "0.0.0.0",
    gamePort: "{{PORT}}",
    queryPort: "{{QUERY_PORT}}",
    slotCount: "{{MAX_PLAYERS}}",
    voiceChatMode: "{{VOICE_CHAT_MODE}}",
    enableVoiceChat: "{{ENABLE_VOICE_CHAT}}",
    enableTextChat: "{{ENABLE_TEXT_CHAT}}",
    tags: csv("{{TAGS}}"),
    gameSettingsPreset: "{{GAME_SETTINGS_PRESET}}",
    gameSettings: {
      playerHealthFactor: "{{PLAYER_HEALTH_FACTOR}}",
      playerManaFactor: "{{PLAYER_MANA_FACTOR}}",
      playerStaminaFactor: "{{PLAYER_STAMINA_FACTOR}}",
      playerBodyHeatFactor: "{{PLAYER_BODY_HEAT_FACTOR}}",
      playerDivingTimeFactor: "{{PLAYER_DIVING_TIME_FACTOR}}",
      enableDurability: "{{ENABLE_DURABILITY}}",
      enableStarvingDebuff: "{{ENABLE_STARVING_DEBUFF}}",
      foodBuffDurationFactor: "{{FOOD_BUFF_DURATION_FACTOR}}",
      fromHungerToStarving: "{{FROM_HUNGER_TO_STARVING}}",
      shroudTimeFactor: "{{SHROUD_TIME_FACTOR}}",
      tombstoneMode: "{{TOMBSTONE_MODE}}",
      enableGliderTurbulences: "{{ENABLE_GLIDER_TURBULENCES}}",
      weatherFrequency: "{{WEATHER_FREQUENCY}}",
      fishingDifficulty: "{{FISHING_DIFFICULTY}}",
      miningDamageFactor: "{{MINING_DAMAGE_FACTOR}}",
      plantGrowthSpeedFactor: "{{PLANT_GROWTH_SPEED_FACTOR}}",
      resourceDropStackAmountFactor: "{{RESOURCE_DROP_STACK_AMOUNT_FACTOR}}",
      factoryProductionSpeedFactor: "{{FACTORY_PRODUCTION_SPEED_FACTOR}}",
      perkUpgradeRecyclingFactor: "{{PERK_UPGRADE_RECYCLING_FACTOR}}",
      perkCostFactor: "{{PERK_COST_FACTOR}}",
      experienceCombatFactor: "{{EXPERIENCE_COMBAT_FACTOR}}",
      experienceMiningFactor: "{{EXPERIENCE_MINING_FACTOR}}",
      experienceExplorationQuestsFactor: "{{EXPERIENCE_EXPLORATION_QUESTS_FACTOR}}",
      randomSpawnerAmount: "{{RANDOM_SPAWNER_AMOUNT}}",
      aggroPoolAmount: "{{AGGRO_POOL_AMOUNT}}",
      enemyDamageFactor: "{{ENEMY_DAMAGE_FACTOR}}",
      enemyHealthFactor: "{{ENEMY_HEALTH_FACTOR}}",
      enemyStaminaFactor: "{{ENEMY_STAMINA_FACTOR}}",
      enemyPerceptionRangeFactor: "{{ENEMY_PERCEPTION_RANGE_FACTOR}}",
      bossDamageFactor: "{{BOSS_DAMAGE_FACTOR}}",
      bossHealthFactor: "{{BOSS_HEALTH_FACTOR}}",
      threatBonus: "{{THREAT_BONUS}}",
      pacifyAllEnemies: "{{PACIFY_ALL_ENEMIES}}",
      tamingStartleRepercussion: "{{TAMING_STARTLE_REPERCUSSION}}",
      dayTimeDuration: "{{DAY_TIME_DURATION}}",
      nightTimeDuration: "{{NIGHT_TIME_DURATION}}",
      curseModifier: "{{CURSE_MODIFIER}}",
    },
    userGroups: [
      {
        name: "Admin",
        password: "{{ADMIN_PASSWORD}}",
        canKickBan: true,
        canAccessInventories: true,
        canEditWorld: true,
        canEditBase: true,
        canExtendBase: true,
        reservedSlots: "{{ADMIN_RESERVED_SLOTS}}",
      },
      {
        name: "Friend",
        password: "{{FRIEND_PASSWORD}}",
        canKickBan: false,
        canAccessInventories: true,
        canEditWorld: true,
        canEditBase: true,
        canExtendBase: false,
        reservedSlots: 0,
      },
      {
        name: "Guest",
        password: "{{GUEST_PASSWORD}}",
        canKickBan: false,
        canAccessInventories: false,
        canEditWorld: true,
        canEditBase: false,
        canExtendBase: false,
        reservedSlots: 0,
      },
    ],
  },
};
