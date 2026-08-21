import { V, group, STEAM_VARS, RCON_VARS, type GameTemplate } from "./types";
import { steamInstallScript } from "./steamcmd";

// Squad reads a set of plain-text config files from SquadGame/ServerConfig/.
// Server.cfg uses bare Key=Value lines (not ini sections), and Rcon.cfg is
// a separate file.
export const squad: GameTemplate = {
  slug: "squad",
  name: "Squad",
  engine: "Unreal Engine 4",
  defaultPort: 7787,
  steamAppId: "403240",
  iconEmoji: "🪖",
  supportsIpv6: false,
  category: "FPS",
  description: "Large-scale tactical military FPS",
  estimatedSize: "~40 GB",
  variables: [
    ...STEAM_VARS,

    ...group("Server Identity", [
      V("Should Advertise", "SHOULD_ADVERTISE", "List the server in the in-game browser", "true", { required: false, type: "boolean" }),
      V("LAN Match", "IS_LAN_MATCH", "Run the server in LAN mode", "false", { required: false, type: "boolean" }),
      V("Server Password", "SERVER_PASSWORD", "Password required to join, empty = public", "", { required: false, type: "password" }),
      V("Should Log", "SHOULD_LOG", "Write gameplay events to the server log", "1", {
        required: false, type: "select", enum_values: { "1": "Enabled", "0": "Disabled" },
      }),
      V("Server Message Interval", "SERVER_MESSAGE_INTERVAL", "Seconds between broadcasts from ServerMessages.cfg", "300", {
        required: false, type: "number", min_value: 0, max_value: 7200,
      }),
    ]),

    ...group("Slots & Queue", [
      V("Reserved Slots", "NUM_RESERVED_SLOTS", "Slots reserved for admins, members and donors", "0", {
        required: false, type: "number", min_value: 0, max_value: 50,
      }),
      V("Public Queue Limit", "PUBLIC_QUEUE_LIMIT", "Queue size for regular players, -1 = unlimited, 0 = off", "25", {
        required: false, type: "number", min_value: -1, max_value: 500,
      }),
      V("Reserved Slot Queue Limit", "RESERVED_SLOT_QUEUE_LIMIT", "Queue size for reserved-slot players", "-1", {
        required: false, type: "number", min_value: -1, max_value: 500,
      }),
    ]),

    ...group("Map Rotation", [
      V("Map Rotation Mode", "MAP_ROTATION_MODE", "Which rotation file the server reads and in what order", "LayerList", {
        required: false, type: "select",
        enum_values: {
          LevelList: "LevelList — maps only, in order",
          LayerList: "LayerList — full map+mode+faction combos",
          LevelList_Randomized: "LevelList (randomized)",
          LayerList_Randomized: "LayerList (randomized)",
        },
      }),
      V("Randomize At Start", "RANDOMIZE_AT_START", "Shuffle the rotation list on server start", "true", { required: false, type: "boolean" }),
      V("Use Vote Factions", "USE_VOTE_FACTIONS", "Players vote on factions for generic layers", "false", { required: false, type: "boolean" }),
      V("Use Vote Level", "USE_VOTE_LEVEL", "Players vote on the next map", "false", { required: false, type: "boolean" }),
      V("Use Vote Layer", "USE_VOTE_LAYER", "Players vote on the next layer", "false", { required: false, type: "boolean" }),
      V("Force Non-Seamless Travel", "FORCE_NON_SEAMLESS_TRAVEL_INTERVAL", "Seconds between forced full map reloads, 0 = off", "0", {
        required: false, type: "number", min_value: 0, max_value: 604800,
      }),
    ]),

    ...group("Teams & Balance", [
      V("Allow Team Changes", "ALLOW_TEAM_CHANGES", "Players may switch teams at all", "true", { required: false, type: "boolean" }),
      V("Prevent Unbalanced Team Change", "PREVENT_TEAM_CHANGE_IF_UNBALANCED", "Block switches that would unbalance the teams", "true", { required: false, type: "boolean" }),
      V("Team Change Player Difference", "NUM_PLAYERS_DIFF_FOR_TEAM_CHANGES", "Player count difference allowed between teams", "3", {
        required: false, type: "number", min_value: 0, max_value: 50,
      }),
      V("Rejoin Squad Delay After Kick", "REJOIN_SQUAD_DELAY_AFTER_KICK", "Seconds before rejoining a squad you were kicked from", "180", {
        required: false, type: "number", min_value: 0, max_value: 3600,
      }),
    ]),

    ...group("Team Killing & Admin", [
      V("TK Auto Kick Enabled", "TK_AUTO_KICK_ENABLED", "Automatically kick repeat team killers", "true", { required: false, type: "boolean" }),
      V("Auto TK Ban Number", "AUTO_TK_BAN_NUMBER_TKS", "Team kills before an automatic ban", "7", {
        required: false, type: "number", min_value: 1, max_value: 100,
      }),
      V("Auto TK Ban Time", "AUTO_TK_BAN_TIME", "Ban length in seconds after hitting the TK limit", "300", {
        required: false, type: "number", min_value: 0, max_value: 604800,
      }),
      V("Vehicle Kit Requirement Disabled", "VEHICLE_KIT_REQUIREMENT_DISABLED", "Let anyone crew vehicles regardless of kit", "false", { required: false, type: "boolean" }),
      V("Vehicle Claiming Disabled", "VEHICLE_CLAIMING_DISABLED", "Disable the squad vehicle claiming system", "false", { required: false, type: "boolean" }),
      V("Allow Community Admin Access", "ALLOW_COMMUNITY_ADMIN_ACCESS", "Grant Offworld community admins access", "true", { required: false, type: "boolean" }),
      V("Allow Dev Profiling", "ALLOW_DEV_PROFILING", "Let Offworld developers profile the server", "true", { required: false, type: "boolean" }),
      V("Record Demos", "RECORD_DEMOS", "Record server-side demos — disk hungry", "false", { required: false, type: "boolean" }),
      V("Allow Public Client Recording", "ALLOW_PUBLIC_CLIENTS_TO_RECORD", "Let any client record their own demos", "false", { required: false, type: "boolean" }),
    ]),

    ...group("Seeding", [
      V("Seed Players Threshold", "SEED_PLAYERS_THRESHOLD", "Players needed to start the pre-live countdown", "50", {
        required: false, type: "number", min_value: 1, max_value: 100,
      }),
      V("Seed Minimum Players To Live", "SEED_MINIMUM_PLAYERS_TO_LIVE", "Player floor that keeps the countdown running", "45", {
        required: false, type: "number", min_value: 1, max_value: 100,
      }),
      V("Seed Match Length", "SEED_MATCH_LENGTH_SECONDS", "Seeding match length in seconds", "21600", {
        required: false, type: "number", min_value: 300, max_value: 86400,
      }),
      V("Seed All Kits Available", "SEED_ALL_KITS_AVAILABLE", "All kits are unlocked while seeding", "1", {
        required: false, type: "select", enum_values: { "1": "Enabled", "0": "Disabled" },
      }),
      V("Seed Initial Tickets", "SEED_INITIAL_TICKETS", "Starting tickets for both teams while seeding", "100", {
        required: false, type: "number", min_value: 1, max_value: 10000,
      }),
      V("Seed Seconds Before Live", "SEED_SECONDS_BEFORE_LIVE", "Pre-live countdown length in seconds", "60", {
        required: false, type: "number", min_value: 0, max_value: 3600,
      }),
    ]),

    ...group("RCON", [
      ...RCON_VARS,
      V("RCON Port", "RCON_PORT", "Port the RCON listener binds to", "21114", {
        required: false, type: "number", min_value: 1, max_value: 65535,
      }),
      V("RCON Allowed IPs", "RCON_ALLOWED_IPS", "Comma-separated IPs allowed to connect, empty = any", "", { required: false }),
      V("RCON Backup Threads", "NUM_RCON_BACKUP_THREADS", "Worker threads reserved for RCON", "2", {
        required: false, type: "number", min_value: 1, max_value: 16,
      }),
    ]),

    ...group("Network", [
      V("Beacon Port", "BEACON_PORT", "UE beacon port used during connection setup", "15000", {
        required: false, type: "number", min_value: 1, max_value: 65535,
      }),
      V("Max Internet Client Rate", "MAX_INTERNET_CLIENT_RATE", "Per-client bandwidth cap in bytes/sec", "50000", {
        required: false, type: "number", min_value: 10000, max_value: 1000000,
      }),
      V("Max Tick Rate", "MAX_TICK_RATE", "Server tick rate cap", "50", {
        required: false, type: "number", min_value: 10, max_value: 120,
      }),
    ]),
  ],

  installScript: steamInstallScript({
    appId: "403240",
    name: "Squad",
    post: `## Squad reads its configs from SquadGame/ServerConfig
mkdir -p "$INSTALL_DIR/SquadGame/ServerConfig"
## Rotation and admin files must exist or the server logs errors on boot
for f in Admins.cfg Bans.cfg LayerRotation.cfg LevelRotation.cfg MOTD.cfg ServerMessages.cfg ExcludedLayers.cfg; do
  [ -f "$INSTALL_DIR/SquadGame/ServerConfig/$f" ] || : > "$INSTALL_DIR/SquadGame/ServerConfig/$f"
done`,
  }),

  startCommand: `cd {{INSTALL_PATH}} && SQ_BIN=$(ls SquadGame/Binaries/Linux/SquadGameServer 2>/dev/null || ls SquadGame/Binaries/Linux/SquadGameServer-Linux-* 2>/dev/null | head -1) && if [ -z "$SQ_BIN" ]; then echo "Squad server binary not found in SquadGame/Binaries/Linux" >&2; exit 1; fi && exec "$SQ_BIN" SquadGame Port={{PORT}} QueryPort={{QUERY_PORT}} beaconport={{BEACON_PORT}} RCONPORT={{RCON_PORT}} FIXEDMAXPLAYERS={{MAX_PLAYERS}} FIXEDMAXTICKRATE={{MAX_TICK_RATE}} -log`,
  stopCommand: null,
  configFiles: {
    "SquadGame/ServerConfig/Server.cfg": "Server.cfg",
    "SquadGame/ServerConfig/Rcon.cfg": "Rcon.cfg",
    "SquadGame/ServerConfig/CustomOptions.cfg": "CustomOptions.cfg",
    "SquadGame/Saved/Config/LinuxServer/Engine.ini": "Engine.ini",
  },
  defaultConfig: {
    __files: {
      "SquadGame/ServerConfig/Server.cfg": {
        __gsm_format: "properties",
        ServerName: "{{SERVER_NAME}}",
        MaxPlayers: "{{MAX_PLAYERS}}",
        ServerPassword: "{{SERVER_PASSWORD}}",
        ShouldAdvertise: "{{SHOULD_ADVERTISE}}",
        IsLANMatch: "{{IS_LAN_MATCH}}",
        ShouldLog: "{{SHOULD_LOG}}",
        ServerMessageInterval: "{{SERVER_MESSAGE_INTERVAL}}",
        NumReservedSlots: "{{NUM_RESERVED_SLOTS}}",
        PublicQueueLimit: "{{PUBLIC_QUEUE_LIMIT}}",
        ReservedSlotQueueLimit: "{{RESERVED_SLOT_QUEUE_LIMIT}}",
        MapRotationMode: "{{MAP_ROTATION_MODE}}",
        RandomizeAtStart: "{{RANDOMIZE_AT_START}}",
        UseVoteFactions: "{{USE_VOTE_FACTIONS}}",
        UseVoteLevel: "{{USE_VOTE_LEVEL}}",
        UseVoteLayer: "{{USE_VOTE_LAYER}}",
        ForceNonSeamlessTravelIntervalSeconds: "{{FORCE_NON_SEAMLESS_TRAVEL_INTERVAL}}",
        AllowTeamChanges: "{{ALLOW_TEAM_CHANGES}}",
        PreventTeamChangeIfUnbalanced: "{{PREVENT_TEAM_CHANGE_IF_UNBALANCED}}",
        NumPlayersDiffForTeamChanges: "{{NUM_PLAYERS_DIFF_FOR_TEAM_CHANGES}}",
        RejoinSquadDelayAfterKick: "{{REJOIN_SQUAD_DELAY_AFTER_KICK}}",
        TKAutoKickEnabled: "{{TK_AUTO_KICK_ENABLED}}",
        AutoTKBanNumberTKs: "{{AUTO_TK_BAN_NUMBER_TKS}}",
        AutoTKBanTime: "{{AUTO_TK_BAN_TIME}}",
        VehicleKitRequirementDisabled: "{{VEHICLE_KIT_REQUIREMENT_DISABLED}}",
        VehicleClaimingDisabled: "{{VEHICLE_CLAIMING_DISABLED}}",
        AllowCommunityAdminAccess: "{{ALLOW_COMMUNITY_ADMIN_ACCESS}}",
        AllowDevProfiling: "{{ALLOW_DEV_PROFILING}}",
        RecordDemos: "{{RECORD_DEMOS}}",
        AllowPublicClientsToRecord: "{{ALLOW_PUBLIC_CLIENTS_TO_RECORD}}",
        NumRconBackupThreads: "{{NUM_RCON_BACKUP_THREADS}}",
      },
      "SquadGame/ServerConfig/Rcon.cfg": {
        __gsm_format: "properties",
        Password: "{{RCON_PASSWORD}}",
        Port: "{{RCON_PORT}}",
        AllowedIPs: "{{RCON_ALLOWED_IPS}}",
        MaxConnections: "5",
      },
      "SquadGame/Saved/Config/LinuxServer/Engine.ini": {
        __gsm_format: "ini",
        "/Script/OnlineSubsystemUtils.IpNetDriver": {
          NetServerMaxTickRate: "{{MAX_TICK_RATE}}",
          MaxClientRate: "{{MAX_INTERNET_CLIENT_RATE}}",
          MaxInternetClientRate: "{{MAX_INTERNET_CLIENT_RATE}}",
        },
      },
      "SquadGame/ServerConfig/CustomOptions.cfg": {
        __gsm_format: "properties",
        SeedPlayersThreshold: "{{SEED_PLAYERS_THRESHOLD}}",
        SeedMinimumPlayersToLive: "{{SEED_MINIMUM_PLAYERS_TO_LIVE}}",
        SeedMatchLengthSeconds: "{{SEED_MATCH_LENGTH_SECONDS}}",
        SeedAllKitsAvailable: "{{SEED_ALL_KITS_AVAILABLE}}",
        SeedInitialTickets: "{{SEED_INITIAL_TICKETS}}",
        SeedSecondsBeforeLive: "{{SEED_SECONDS_BEFORE_LIVE}}",
      },
    },
  },
};
