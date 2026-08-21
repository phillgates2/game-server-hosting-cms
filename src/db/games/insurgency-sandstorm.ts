import { V, group, STEAM_VARS, RCON_VARS, type GameTemplate } from "./types";
import { steamInstallScript } from "./steamcmd";

// Insurgency: Sandstorm. Gameplay options live in Game.ini, engine/RCON options
// in Engine.ini, and admin/mod lists in plain text files.
export const insurgencySandstorm: GameTemplate = {
  slug: "insurgency-sandstorm",
  name: "Insurgency: Sandstorm",
  engine: "Unreal Engine 4",
  defaultPort: 27102,
  steamAppId: "581330",
  iconEmoji: "🎖️",
  supportsIpv6: false,
  category: "FPS",
  description: "Tactical realistic FPS",
  estimatedSize: "~25 GB",
  variables: [
    ...STEAM_VARS,
    ...RCON_VARS,

    ...group("Match Setup", [
      V("Map", "MAP", "Starting map", "Farmhouse", {
        required: false, type: "select",
        enum_values: {
          Farmhouse: "Farmhouse", Precinct: "Precinct", Refinery: "Refinery", Crossing: "Crossing",
          Summit: "Summit", Hideout: "Hideout", Ministry: "Ministry", Hillside: "Hillside",
          Outskirts: "Outskirts", PowerPlant: "Power Plant", Tell: "Tell", Bab: "Bab", Citadel: "Citadel",
        },
      }),
      V("Scenario", "SCENARIO", "Scenario name — must match the map and mode", "Scenario_Farmhouse_Checkpoint_Security", { required: false }),
      V("Game Mode", "GAME_MODE", "Mode the scenario runs", "Checkpoint", {
        required: false, type: "select",
        enum_values: {
          Checkpoint: "Checkpoint (co-op)", Outpost: "Outpost (co-op survival)", Survival: "Survival",
          Push: "Push (PvP)", Firefight: "Firefight (PvP)", Skirmish: "Skirmish (PvP)",
          Domination: "Domination (PvP)", Frontline: "Frontline (PvP)", Team_Deathmatch: "Team Deathmatch",
        },
      }),
      V("Game Stats Token", "GSLT_TOKEN", "Game Stats Token from the Sandstorm community portal", "", { required: false, type: "password" }),
      V("Mutators", "MUTATORS", "Comma-separated mutator list, e.g. Competitive,AllYouCanEat", "", { required: false }),
      V("Ruleset", "RULESET", "Official ruleset name, empty = none", "", { required: false }),
      V("Friendly Fire Damage", "FRIENDLY_FIRE_DAMAGE", "Fraction of damage applied to teammates", "0.1", { required: false, type: "float", min_value: 0, max_value: 1 }),
      V("Round Time", "ROUND_TIME", "Round length in seconds", "0", {
        required: false, type: "number", min_value: 0, max_value: 7200,
      }),
      V("Round Limit", "ROUND_LIMIT", "Rounds before the map changes, 0 = scenario default", "0", {
        required: false, type: "number", min_value: 0, max_value: 100,
      }),
    ]),

    ...group("Bots (Co-op)", [
      V("Minimum Enemies", "MINIMUM_ENEMIES", "Fewest AI enemies alive at once", "6", {
        required: false, type: "number", min_value: 0, max_value: 64,
      }),
      V("Maximum Enemies", "MAXIMUM_ENEMIES", "Most AI enemies alive at once", "12", {
        required: false, type: "number", min_value: 0, max_value: 64,
      }),
      V("AI Difficulty", "AI_DIFFICULTY", "Bot skill from 0.0 (easiest) to 1.0 (hardest)", "0.5", { required: false, type: "float", min_value: 0, max_value: 1 }),
      V("Bot Count Multiplier", "BOT_COUNT_MULTIPLIER", "Scales enemy count with player count", "1.0", { required: false, type: "float", min_value: 0.1, max_value: 10 }),
      V("Friendly Bot Quota", "FRIENDLY_BOT_QUOTA", "Friendly AI teammates, -1 = auto", "-1", {
        required: false, type: "number", min_value: -1, max_value: 32,
      }),
      V("AI Wave Limit", "AI_WAVE_LIMIT", "Reinforcement waves before defeat, 0 = scenario default", "0", {
        required: false, type: "number", min_value: 0, max_value: 100,
      }),
      V("Respawn Delay", "RESPAWN_DELAY", "Seconds before an AI reinforcement wave", "20", {
        required: false, type: "number", min_value: 0, max_value: 600,
      }),
    ]),

    ...group("Server Rules", [
      V("Server Password", "SERVER_PASSWORD", "Password required to join, empty = public", "", { required: false, type: "password" }),
      V("Max Players", "MAX_PLAYERS_OVERRIDE", "Player slots — overrides the scenario default", "8", {
        required: false, type: "number", min_value: 1, max_value: 64,
      }),
      V("Reserved Slots", "RESERVED_SLOTS", "Slots reserved for admins", "0", {
        required: false, type: "number", min_value: 0, max_value: 32,
      }),
      V("Allow Vote Kick", "ALLOW_VOTE_KICK", "Players may vote to kick", "true", { required: false, type: "boolean" }),
      V("Allow Vote Map", "ALLOW_VOTE_MAP", "Players may vote for the next map", "false", { required: false, type: "boolean" }),
      V("Vote Kick Threshold", "VOTE_KICK_THRESHOLD", "Fraction of players needed to pass a kick vote", "0.6", { required: false, type: "float", min_value: 0.1, max_value: 1 }),
      V("Idle Kick Time", "IDLE_KICK_TIME", "Seconds before an idle player is kicked, 0 = never", "300", {
        required: false, type: "number", min_value: 0, max_value: 7200,
      }),
      V("Kill Feed", "KILL_FEED", "Show the kill feed", "false", { required: false, type: "boolean" }),
      V("Team Kill Limit", "TEAM_KILL_LIMIT", "Team kills before a player is kicked, 0 = off", "5", {
        required: false, type: "number", min_value: 0, max_value: 100,
      }),
      V("Voice Chat Enabled", "VOICE_CHAT_ENABLED", "Enable in-game voice chat", "true", { required: false, type: "boolean" }),
      V("Allow Third Person", "ALLOW_THIRD_PERSON", "Allow the third-person camera", "false", { required: false, type: "boolean" }),
      V("Motto", "MOTTO", "Short server motto shown on join", "", { required: false }),
      V("MOTD", "MOTD", "Message of the day shown in the join screen", "", { required: false }),
    ]),

    ...group("Modding", [
      V("Mod List", "MOD_LIST", "Comma-separated Mod.io mod IDs to load", "", { required: false }),
      V("Mod.io API Key", "MODIO_API_KEY", "API key used to download mods", "", { required: false, type: "password" }),
      V("Mod.io OAuth Token", "MODIO_OAUTH_TOKEN", "OAuth token used to download mods", "", { required: false, type: "password" }),
      V("Mod Download Timeout", "MOD_DOWNLOAD_TIMEOUT", "Seconds allowed for mod downloads", "300", {
        required: false, type: "number", min_value: 30, max_value: 3600,
      }),
    ]),

    ...group("RCON", [
      V("RCON Enabled", "RCON_ENABLED", "Enable the RCON listener", "false", { required: false, type: "boolean" }),
      V("RCON Port", "RCON_PORT", "Port RCON binds to", "27015", {
        required: false, type: "number", min_value: 1, max_value: 65535,
      }),
      V("RCON List Players Interval", "RCON_LIST_PLAYERS_INTERVAL", "Seconds between automatic player list broadcasts, 0 = off", "0", {
        required: false, type: "number", min_value: 0, max_value: 3600,
      }),
    ]),
  ],

  installScript: steamInstallScript({
    appId: "581330",
    name: "Insurgency: Sandstorm",
    post: `## Sandstorm reads its ini files from the Saved config directory
mkdir -p "$INSTALL_DIR/Insurgency/Saved/Config/LinuxServer"`,
  }),

  startCommand: `cd {{INSTALL_PATH}} && ./Insurgency/Binaries/Linux/InsurgencyServer-Linux-Shipping "{{MAP}}?Scenario={{SCENARIO}}?Game={{GAME_MODE}}?MaxPlayers={{MAX_PLAYERS_OVERRIDE}}?Password={{SERVER_PASSWORD}}?Mutators={{MUTATORS}}?Ruleset={{RULESET}}" -Port={{PORT}} -QueryPort={{QUERY_PORT}} -GameStatsToken={{GSLT_TOKEN}} -Mods -ModList={{MOD_LIST}} -log`,
  stopCommand: null,
  configFiles: {
    "Insurgency/Saved/Config/LinuxServer/Game.ini": "Game.ini",
    "Insurgency/Saved/Config/LinuxServer/Engine.ini": "Engine.ini",
  },
  defaultConfig: {
    __files: {
      "Insurgency/Saved/Config/LinuxServer/Game.ini": {
        __gsm_format: "ini",
        "/Script/Insurgency.INSGameMode": {
          bKillFeed: "{{KILL_FEED}}",
          bAllowThirdPerson: "{{ALLOW_THIRD_PERSON}}",
          bVoiceChatEnabled: "{{VOICE_CHAT_ENABLED}}",
          FriendlyFireDamageMultiplier: "{{FRIENDLY_FIRE_DAMAGE}}",
          TeamKillLimit: "{{TEAM_KILL_LIMIT}}",
          RoundTime: "{{ROUND_TIME}}",
          RoundLimit: "{{ROUND_LIMIT}}",
          IdleKickTime: "{{IDLE_KICK_TIME}}",
        },
        "/Script/Insurgency.INSCoopMode": {
          MinimumEnemies: "{{MINIMUM_ENEMIES}}",
          MaximumEnemies: "{{MAXIMUM_ENEMIES}}",
          AIDifficulty: "{{AI_DIFFICULTY}}",
          BotCountMultiplier: "{{BOT_COUNT_MULTIPLIER}}",
          FriendlyBotQuota: "{{FRIENDLY_BOT_QUOTA}}",
          AIWaveLimit: "{{AI_WAVE_LIMIT}}",
          RespawnDelay: "{{RESPAWN_DELAY}}",
        },
        "/Script/Insurgency.INSGameState": {
          Motto: "{{MOTTO}}",
          MOTD: "{{MOTD}}",
        },
        "/Script/Insurgency.INSMultiplayerMode": {
          bAllowVoteKick: "{{ALLOW_VOTE_KICK}}",
          bAllowVoteMap: "{{ALLOW_VOTE_MAP}}",
          VoteKickThreshold: "{{VOTE_KICK_THRESHOLD}}",
        },
        "/Script/Engine.GameSession": {
          MaxPlayers: "{{MAX_PLAYERS_OVERRIDE}}",
          NumReservedSlots: "{{RESERVED_SLOTS}}",
        },
      },
      "Insurgency/Saved/Config/LinuxServer/Engine.ini": {
        __gsm_format: "ini",
        "/Script/Engine.GameSession": {
          MaxPlayers: "{{MAX_PLAYERS_OVERRIDE}}",
        },
        Rcon: {
          bEnabled: "{{RCON_ENABLED}}",
          Password: "{{RCON_PASSWORD}}",
          ListenPort: "{{RCON_PORT}}",
          bListPlayers: "{{RCON_LIST_PLAYERS_INTERVAL}}",
        },
        "/Script/ModIO.ModIOSettings": {
          ApiKey: "{{MODIO_API_KEY}}",
          OAuthToken: "{{MODIO_OAUTH_TOKEN}}",
          ModDownloadTimeout: "{{MOD_DOWNLOAD_TIMEOUT}}",
        },
        "/Script/OnlineSubsystemUtils.IpNetDriver": {
          NetServerMaxTickRate: "60",
          MaxClientRate: "100000",
          MaxInternetClientRate: "100000",
        },
      },
    },
  },
};
