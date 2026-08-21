import { V, group, STEAM_VARS, RCON_VARS, type GameTemplate } from "./types";
import { steamInstallScript } from "./steamcmd";

// Project Zomboid: server rules live in Server/<name>.ini as flat Key=Value
// lines. Sandbox world rules live in a separate Lua file the game generates.
export const projectZomboid: GameTemplate = {
  slug: "project-zomboid",
  name: "Project Zomboid",
  engine: "Custom",
  defaultPort: 16261,
  steamAppId: "380870",
  iconEmoji: "🧟‍♀️",
  supportsIpv6: false,
  category: "Survival",
  description: "Isometric zombie survival",
  estimatedSize: "~5 GB",
  variables: [
    ...STEAM_VARS,
    ...RCON_VARS,

    ...group("Server Identity", [
      V("Server Config Name", "SERVER_CONFIG_NAME", "Config/save name — also names the ini file", "servertest", { required: false }),
      V("Public Name", "PUBLIC_NAME", "Name shown in the in-game server browser", "My PZ Server", { required: false }),
      V("Public Description", "PUBLIC_DESCRIPTION", "Tagline shown under the server name", "", { required: false }),
      V("Public", "PUBLIC", "List the server in the public browser", "false", { required: false, type: "boolean" }),
      V("Server Password", "SERVER_PASSWORD", "Password required to join, empty = open", "", { required: false, type: "password" }),
      V("Admin Password", "ADMIN_PASSWORD", "Password for the built-in admin account", "", { required: false, type: "password" }),
      V("Welcome Message", "SERVER_WELCOME_MESSAGE", "Message shown to players on join", "Welcome to the server!", { required: false }),
      V("Open", "OPEN", "Anyone may join — set false to require a whitelist", "true", { required: false, type: "boolean" }),
      V("Auto Create User In Whitelist", "AUTO_CREATE_USER_IN_WHITELIST", "Add first-time joiners to the whitelist automatically", "false", { required: false, type: "boolean" }),
      V("Deny Login On Overloaded Server", "DENY_LOGIN_ON_OVERLOADED_SERVER", "Refuse joins while the server is struggling", "true", { required: false, type: "boolean" }),
    ]),

    ...group("Network", [
      V("UDP Port", "UDP_PORT", "Secondary UDP port (game port + 1)", "16262", {
        required: false, type: "number", min_value: 1, max_value: 65535,
      }),
      V("Steam Port 1", "STEAM_PORT_1", "First Steam networking port", "8766", {
        required: false, type: "number", min_value: 1, max_value: 65535,
      }),
      V("Steam Port 2", "STEAM_PORT_2", "Second Steam networking port", "8767", {
        required: false, type: "number", min_value: 1, max_value: 65535,
      }),
      V("Steam VAC", "STEAM_VAC", "Enable Valve Anti-Cheat", "true", { required: false, type: "boolean" }),
      V("Server Browser Announced IP", "SERVER_BROWSER_ANNOUNCED_IP", "Public IP advertised to the browser, empty = auto", "", { required: false }),
      V("UPnP", "UPNP", "Attempt automatic router port forwarding", "false", { required: false, type: "boolean" }),
      V("Ping Limit", "PING_LIMIT", "Kick players above this ping, 100 = disabled", "400", {
        required: false, type: "number", min_value: 100, max_value: 10000,
      }),
      V("Login Queue Enabled", "LOGIN_QUEUE_ENABLED", "Queue players when the server is full", "false", { required: false, type: "boolean" }),
      V("Login Queue Timeout", "LOGIN_QUEUE_CONNECT_TIMEOUT", "Seconds a queued player may take to connect", "60", {
        required: false, type: "number", min_value: 20, max_value: 1200,
      }),
    ]),

    ...group("PvP & Safety", [
      V("PvP", "PVP", "Master player-vs-player switch", "true", { required: false, type: "boolean" }),
      V("Safety System", "SAFETY_SYSTEM", "Players individually toggle themselves safe or unsafe", "true", { required: false, type: "boolean" }),
      V("Show Safety", "SHOW_SAFETY", "Draw the safety icon above player heads", "true", { required: false, type: "boolean" }),
      V("Safety Toggle Timer", "SAFETY_TOGGLE_TIMER", "Seconds to toggle safety state", "2", {
        required: false, type: "number", min_value: 0, max_value: 1000,
      }),
      V("Safety Cooldown Timer", "SAFETY_COOLDOWN_TIMER", "Seconds of cooldown after toggling safety", "3", {
        required: false, type: "number", min_value: 0, max_value: 1000,
      }),
      V("PvP Melee Damage Modifier", "PVP_MELEE_DAMAGE_MODIFIER", "Melee damage between players, percentage", "30", {
        required: false, type: "number", min_value: 0, max_value: 500,
      }),
      V("PvP Firearm Damage Modifier", "PVP_FIREARM_DAMAGE_MODIFIER", "Ranged damage between players, percentage", "50", {
        required: false, type: "number", min_value: 0, max_value: 500,
      }),
      V("PvP Melee While Hit Reaction", "PVP_MELEE_WHILE_HIT_REACTION", "Allow attacking during hit reactions", "false", { required: false, type: "boolean" }),
    ]),

    ...group("Gameplay", [
      V("Pause Empty", "PAUSE_EMPTY", "Pause the simulation when nobody is online", "true", { required: false, type: "boolean" }),
      V("Global Chat", "GLOBAL_CHAT", "Enable the server-wide chat channel", "true", { required: false, type: "boolean" }),
      V("Chat Streams", "CHAT_STREAMS", "Comma-separated chat channels players may use", "s,r,a,w,y,sh,f,all", { required: false }),
      V("Sleep Allowed", "SLEEP_ALLOWED", "Allow players to sleep", "false", { required: false, type: "boolean" }),
      V("Sleep Needed", "SLEEP_NEEDED", "Require sleep to avoid fatigue", "false", { required: false, type: "boolean" }),
      V("Allow Coop", "ALLOW_COOP", "Allow split-screen co-op players", "true", { required: false, type: "boolean" }),
      V("Display Username", "DISPLAY_USER_NAME", "Show player names above characters", "true", { required: false, type: "boolean" }),
      V("Show First And Last Name", "SHOW_FIRST_AND_LAST_NAME", "Show full character names", "false", { required: false, type: "boolean" }),
      V("Spawn Point", "SPAWN_POINT", "Forced spawn coordinates as x,y,z — 0,0,0 = use the map default", "0,0,0", { required: false }),
      V("Spawn Items", "SPAWN_ITEMS", "Comma-separated items every new character starts with", "", { required: false }),
      V("Map", "MAP", "Semicolon-separated map load order", "Muldraugh, KY", { required: false }),
      V("Server Player ID", "SERVER_PLAYER_ID", "Numeric id linking characters to this server, 0 = auto", "0", {
        required: false, type: "number", min_value: 0, max_value: 2147483647,
      }),
      V("Allow Destruction By Sledgehammer", "ALLOW_DESTRUCTION_BY_SLEDGEHAMMER", "Players may demolish walls with a sledgehammer", "true", { required: false, type: "boolean" }),
      V("Kick Fast Players", "KICK_FAST_PLAYERS", "Kick players moving impossibly fast — prone to false positives", "false", { required: false, type: "boolean" }),
      V("No Fire", "NO_FIRE", "Disable fire spread entirely", "false", { required: false, type: "boolean" }),
      V("Announce Death", "ANNOUNCE_DEATH", "Broadcast player deaths in chat", "false", { required: false, type: "boolean" }),
      V("Minutes Per Page", "MINUTES_PER_PAGE", "In-game minutes to read one page of a book", "1.0", { required: false, type: "float", min_value: 0, max_value: 60 }),
    ]),

    ...group("Safehouses", [
      V("Player Safehouse", "PLAYER_SAFEHOUSE", "Players may claim safehouses", "false", { required: false, type: "boolean" }),
      V("Admin Safehouse", "ADMIN_SAFEHOUSE", "Only admins may claim safehouses", "false", { required: false, type: "boolean" }),
      V("Safehouse Allow Trespass", "SAFEHOUSE_ALLOW_TRESPASS", "Non-members may enter a safehouse", "true", { required: false, type: "boolean" }),
      V("Safehouse Allow Fire", "SAFEHOUSE_ALLOW_FIRE", "Fire may damage safehouses", "true", { required: false, type: "boolean" }),
      V("Safehouse Allow Loot", "SAFEHOUSE_ALLOW_LOOT", "Non-members may loot a safehouse", "true", { required: false, type: "boolean" }),
      V("Safehouse Allow Respawn", "SAFEHOUSE_ALLOW_RESPAWN", "Members may respawn inside their safehouse", "false", { required: false, type: "boolean" }),
      V("Safehouse Days To Claim", "SAFEHOUSE_DAY_SURVIVED_TO_CLAIM", "Days survived before a player may claim", "0", {
        required: false, type: "number", min_value: 0, max_value: 1000,
      }),
      V("Safehouse Removal Time", "SAFEHOUSE_REMOVAL_TIME", "Hours of owner absence before the claim lapses", "144", {
        required: false, type: "number", min_value: 0, max_value: 10000,
      }),
      V("Safehouse Allow Non-Residential", "SAFEHOUSE_ALLOW_NON_RESIDENTIAL", "Allow claiming shops and warehouses", "false", { required: false, type: "boolean" }),
      V("Disable Safehouse When Player Connected", "DISABLE_SAFEHOUSE_WHEN_PLAYER_CONNECTED", "Suspend protection while the owner is online", "false", { required: false, type: "boolean" }),
    ]),

    ...group("Factions & Voice", [
      V("Factions", "FACTION", "Enable the faction system", "true", { required: false, type: "boolean" }),
      V("Faction Days Before Create", "FACTION_DAY_SURVIVED_TO_CREATE", "Days survived before a player may found a faction", "0", {
        required: false, type: "number", min_value: 0, max_value: 1000,
      }),
      V("Faction Players Required", "FACTION_PLAYERS_REQUIRED_FOR_TAG", "Members needed before a faction gets a tag", "1", {
        required: false, type: "number", min_value: 1, max_value: 100,
      }),
      V("Voice Enable", "VOICE_ENABLE", "Enable in-game voice chat", "true", { required: false, type: "boolean" }),
      V("Voice Min Distance", "VOICE_MIN_DISTANCE", "Tiles at which voice starts attenuating", "10.0", { required: false, type: "float", min_value: 0, max_value: 100 }),
      V("Voice Max Distance", "VOICE_MAX_DISTANCE", "Tiles beyond which voice is inaudible", "100.0", { required: false, type: "float", min_value: 0, max_value: 1000 }),
      V("Voice 3D", "VOICE_3D", "Use directional positional audio", "true", { required: false, type: "boolean" }),
    ]),

    ...group("Saving & Backups", [
      V("Save World Every Minutes", "SAVE_WORLD_EVERY_MINUTES", "Autosave interval, 0 = only on shutdown", "0", {
        required: false, type: "number", min_value: 0, max_value: 1440,
      }),
      V("Backups Count", "BACKUPS_COUNT", "Number of backups to retain", "5", {
        required: false, type: "number", min_value: 0, max_value: 300,
      }),
      V("Backups On Start", "BACKUPS_ON_START", "Take a backup when the server boots", "true", { required: false, type: "boolean" }),
      V("Backups On Version Change", "BACKUPS_ON_VERSION_CHANGE", "Take a backup when the game updates", "true", { required: false, type: "boolean" }),
      V("Backups Period", "BACKUPS_PERIOD", "Minutes between periodic backups, 0 = off", "0", {
        required: false, type: "number", min_value: 0, max_value: 1500,
      }),
      V("Server Shutdown Grace Timer", "SERVER_SHUTDOWN_GRACE_TIMER", "Seconds of warning before shutdown", "10", {
        required: false, type: "number", min_value: 0, max_value: 300,
      }),
    ]),

    ...group("Loot & Items", [
      V("Hours For Loot Respawn", "HOURS_FOR_LOOT_RESPAWN", "In-game hours before containers refill, 0 = never", "0", {
        required: false, type: "number", min_value: 0, max_value: 10000,
      }),
      V("Max Items For Loot Respawn", "MAX_ITEMS_FOR_LOOT_RESPAWN", "Container item cap for respawn to trigger", "4", {
        required: false, type: "number", min_value: 1, max_value: 100,
      }),
      V("Construction Prevents Loot Respawn", "CONSTRUCTION_PREVENTS_LOOT_RESPAWN", "Player-built areas stop loot respawning", "true", { required: false, type: "boolean" }),
      V("Item Numbers Limit Per Container", "ITEM_NUMBERS_LIMIT_PER_CONTAINER", "Items allowed per container, 0 = unlimited", "0", {
        required: false, type: "number", min_value: 0, max_value: 10000,
      }),
      V("Trash Delete All", "TRASH_DELETE_ALL", "Let admins bulk-delete items from the world", "false", { required: false, type: "boolean" }),
      V("Blood Splat Lifespan Days", "BLOOD_SPLAT_LIFESPAN_DAYS", "Days before blood decals disappear, 0 = never", "0", {
        required: false, type: "number", min_value: 0, max_value: 365,
      }),
      V("Remove Player Corpses After Days", "REMOVE_PLAYER_CORPSES_ON_CORPSE_REMOVAL", "Include player corpses in automatic removal", "false", { required: false, type: "boolean" }),
      V("Hours For Corpse Removal", "HOURS_FOR_CORPSE_REMOVAL", "In-game hours before corpses despawn, 0 = never", "0", {
        required: false, type: "number", min_value: -1, max_value: 10000,
      }),
    ]),

    ...group("Anti-Cheat", [
      V("Anti-Cheat Protection Type 2", "ANTI_CHEAT_PROTECTION_TYPE_2", "Detect illegal item spawning", "true", { required: false, type: "boolean" }),
      V("Anti-Cheat Protection Type 3", "ANTI_CHEAT_PROTECTION_TYPE_3", "Detect illegal player teleporting", "true", { required: false, type: "boolean" }),
      V("Anti-Cheat Protection Type 4", "ANTI_CHEAT_PROTECTION_TYPE_4", "Detect illegal player speed", "true", { required: false, type: "boolean" }),
      V("Do Lua Checksum", "DO_LUA_CHECKSUM", "Kick clients whose Lua files differ from the server", "true", { required: false, type: "boolean" }),
      V("Allow Non-ASCII Username", "ALLOW_NON_ASCII_USERNAME", "Permit non-ASCII characters in usernames", "false", { required: false, type: "boolean" }),
      V("Ban Kick Global Sound", "BAN_KICK_GLOBAL_SOUND", "Play a sound to everyone on a ban or kick", "true", { required: false, type: "boolean" }),
      V("Kick Fast Player Threshold", "SPEED_LIMIT", "Movement speed above which a player is flagged", "70.0", { required: false, type: "float", min_value: 10, max_value: 150 }),
    ]),

    ...group("Mods", [
      V("Mods", "MODS", "Semicolon-separated mod folder names", "", { required: false }),
      V("Workshop Items", "WORKSHOP_ITEMS", "Semicolon-separated Steam Workshop IDs", "", { required: false }),
    ]),

    ...group("RCON & Discord", [
      V("RCON Port", "RCON_PORT", "Port the RCON listener binds to", "27015", {
        required: false, type: "number", min_value: 1, max_value: 65535,
      }),
      V("Discord Enable", "DISCORD_ENABLE", "Bridge in-game chat to a Discord channel", "false", { required: false, type: "boolean" }),
      V("Discord Token", "DISCORD_TOKEN", "Discord bot token", "", { required: false, type: "password" }),
      V("Discord Channel", "DISCORD_CHANNEL", "Discord channel name to bridge", "", { required: false }),
      V("Discord Channel ID", "DISCORD_CHANNEL_ID", "Discord channel ID to bridge", "", { required: false }),
    ]),
  ],

  installScript: steamInstallScript({
    appId: "380870",
    name: "Project Zomboid",
    post: `## PZ reads its ini from the Zomboid data directory that HOME points at
mkdir -p "$INSTALL_DIR/Zomboid/Server" "$INSTALL_DIR/Server"`,
  }),

  startCommand: `cd {{INSTALL_PATH}} && ./start-server.sh -servername "{{SERVER_CONFIG_NAME}}" -adminpassword "{{ADMIN_PASSWORD}}" -ip 0.0.0.0 -port {{PORT}} -steamport1 {{STEAM_PORT_1}} -steamport2 {{STEAM_PORT_2}} -cachedir="{{INSTALL_PATH}}/Zomboid"`,
  stopCommand: "quit",
  configFiles: { "Zomboid/Server/{{SERVER_CONFIG_NAME}}.ini": "servertest.ini" },
  defaultConfig: {
    __gsm_format: "properties",
    PublicName: "{{PUBLIC_NAME}}",
    PublicDescription: "{{PUBLIC_DESCRIPTION}}",
    Public: "{{PUBLIC}}",
    Password: "{{SERVER_PASSWORD}}",
    MaxPlayers: "{{MAX_PLAYERS}}",
    DefaultPort: "{{PORT}}",
    UDPPort: "{{UDP_PORT}}",
    SteamPort1: "{{STEAM_PORT_1}}",
    SteamPort2: "{{STEAM_PORT_2}}",
    SteamVAC: "{{STEAM_VAC}}",
    ServerBrowserAnnouncedIP: "{{SERVER_BROWSER_ANNOUNCED_IP}}",
    UPnP: "{{UPNP}}",
    PingLimit: "{{PING_LIMIT}}",
    Open: "{{OPEN}}",
    AutoCreateUserInWhiteList: "{{AUTO_CREATE_USER_IN_WHITELIST}}",
    DenyLoginOnOverloadedServer: "{{DENY_LOGIN_ON_OVERLOADED_SERVER}}",
    LoginQueueEnabled: "{{LOGIN_QUEUE_ENABLED}}",
    LoginQueueConnectTimeout: "{{LOGIN_QUEUE_CONNECT_TIMEOUT}}",
    ServerWelcomeMessage: "{{SERVER_WELCOME_MESSAGE}}",
    ServerPlayerID: "{{SERVER_PLAYER_ID}}",
    PVP: "{{PVP}}",
    SafetySystem: "{{SAFETY_SYSTEM}}",
    ShowSafety: "{{SHOW_SAFETY}}",
    SafetyToggleTimer: "{{SAFETY_TOGGLE_TIMER}}",
    SafetyCooldownTimer: "{{SAFETY_COOLDOWN_TIMER}}",
    PVPMeleeDamageModifier: "{{PVP_MELEE_DAMAGE_MODIFIER}}",
    PVPFirearmDamageModifier: "{{PVP_FIREARM_DAMAGE_MODIFIER}}",
    PVPMeleeWhileHitReaction: "{{PVP_MELEE_WHILE_HIT_REACTION}}",
    PauseEmpty: "{{PAUSE_EMPTY}}",
    GlobalChat: "{{GLOBAL_CHAT}}",
    ChatStreams: "{{CHAT_STREAMS}}",
    SleepAllowed: "{{SLEEP_ALLOWED}}",
    SleepNeeded: "{{SLEEP_NEEDED}}",
    AllowCoop: "{{ALLOW_COOP}}",
    DisplayUserName: "{{DISPLAY_USER_NAME}}",
    ShowFirstAndLastName: "{{SHOW_FIRST_AND_LAST_NAME}}",
    SpawnPoint: "{{SPAWN_POINT}}",
    SpawnItems: "{{SPAWN_ITEMS}}",
    Map: "{{MAP}}",
    AllowDestructionBySledgehammer: "{{ALLOW_DESTRUCTION_BY_SLEDGEHAMMER}}",
    KickFastPlayers: "{{KICK_FAST_PLAYERS}}",
    NoFire: "{{NO_FIRE}}",
    AnnounceDeath: "{{ANNOUNCE_DEATH}}",
    MinutesPerPage: "{{MINUTES_PER_PAGE}}",
    PlayerSafehouse: "{{PLAYER_SAFEHOUSE}}",
    AdminSafehouse: "{{ADMIN_SAFEHOUSE}}",
    SafehouseAllowTrepass: "{{SAFEHOUSE_ALLOW_TRESPASS}}",
    SafehouseAllowFire: "{{SAFEHOUSE_ALLOW_FIRE}}",
    SafehouseAllowLoot: "{{SAFEHOUSE_ALLOW_LOOT}}",
    SafehouseAllowRespawn: "{{SAFEHOUSE_ALLOW_RESPAWN}}",
    SafehouseDaySurvivedToClaim: "{{SAFEHOUSE_DAY_SURVIVED_TO_CLAIM}}",
    SafeHouseRemovalTime: "{{SAFEHOUSE_REMOVAL_TIME}}",
    SafehouseAllowNonResidential: "{{SAFEHOUSE_ALLOW_NON_RESIDENTIAL}}",
    DisableSafehouseWhenPlayerConnected: "{{DISABLE_SAFEHOUSE_WHEN_PLAYER_CONNECTED}}",
    Faction: "{{FACTION}}",
    FactionDaySurvivedToCreate: "{{FACTION_DAY_SURVIVED_TO_CREATE}}",
    FactionPlayersRequiredForTag: "{{FACTION_PLAYERS_REQUIRED_FOR_TAG}}",
    VoiceEnable: "{{VOICE_ENABLE}}",
    VoiceMinDistance: "{{VOICE_MIN_DISTANCE}}",
    VoiceMaxDistance: "{{VOICE_MAX_DISTANCE}}",
    Voice3D: "{{VOICE_3D}}",
    SaveWorldEveryMinutes: "{{SAVE_WORLD_EVERY_MINUTES}}",
    BackupsCount: "{{BACKUPS_COUNT}}",
    BackupsOnStart: "{{BACKUPS_ON_START}}",
    BackupsOnVersionChange: "{{BACKUPS_ON_VERSION_CHANGE}}",
    BackupsPeriod: "{{BACKUPS_PERIOD}}",
    ServerShutdownGraceTimer: "{{SERVER_SHUTDOWN_GRACE_TIMER}}",
    HoursForLootRespawn: "{{HOURS_FOR_LOOT_RESPAWN}}",
    MaxItemsForLootRespawn: "{{MAX_ITEMS_FOR_LOOT_RESPAWN}}",
    ConstructionPreventsLootRespawn: "{{CONSTRUCTION_PREVENTS_LOOT_RESPAWN}}",
    ItemNumbersLimitPerContainer: "{{ITEM_NUMBERS_LIMIT_PER_CONTAINER}}",
    TrashDeleteAll: "{{TRASH_DELETE_ALL}}",
    BloodSplatLifespanDays: "{{BLOOD_SPLAT_LIFESPAN_DAYS}}",
    RemovePlayerCorpsesOnCorpseRemoval: "{{REMOVE_PLAYER_CORPSES_ON_CORPSE_REMOVAL}}",
    HoursForCorpseRemoval: "{{HOURS_FOR_CORPSE_REMOVAL}}",
    AntiCheatProtectionType2: "{{ANTI_CHEAT_PROTECTION_TYPE_2}}",
    AntiCheatProtectionType3: "{{ANTI_CHEAT_PROTECTION_TYPE_3}}",
    AntiCheatProtectionType4: "{{ANTI_CHEAT_PROTECTION_TYPE_4}}",
    DoLuaChecksum: "{{DO_LUA_CHECKSUM}}",
    AllowNonAsciiUsername: "{{ALLOW_NON_ASCII_USERNAME}}",
    BanKickGlobalSound: "{{BAN_KICK_GLOBAL_SOUND}}",
    SpeedLimit: "{{SPEED_LIMIT}}",
    Mods: "{{MODS}}",
    WorkshopItems: "{{WORKSHOP_ITEMS}}",
    RCONPort: "{{RCON_PORT}}",
    RCONPassword: "{{RCON_PASSWORD}}",
    DiscordEnable: "{{DISCORD_ENABLE}}",
    DiscordToken: "{{DISCORD_TOKEN}}",
    DiscordChannel: "{{DISCORD_CHANNEL}}",
    DiscordChannelID: "{{DISCORD_CHANNEL_ID}}",
  },
};
