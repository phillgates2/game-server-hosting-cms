import { V, group, csv, STEAM_VARS, type GameTemplate } from "./types";
import { steamInstallScript } from "./steamcmd";

// Arma 3 uses a C-style config syntax: `key = value;` with quoted strings and
// `array[] = {...};`. The "arma" serializer renders exactly that.
export const arma3: GameTemplate = {
  slug: "arma3",
  name: "Arma 3",
  engine: "Real Virtuality 4",
  defaultPort: 2302,
  steamAppId: "233780",
  iconEmoji: "🪂",
  supportsIpv6: false,
  category: "FPS",
  description: "Military simulation sandbox",
  estimatedSize: "~30 GB",
  variables: [
    ...STEAM_VARS,

    ...group("Server Identity", [
      V("Server Password", "SERVER_PASSWORD", "Password required to join, empty = public", "", { required: false, type: "password" }),
      V("Admin Password", "ADMIN_PASSWORD", "Password for #login admin access", "", { required: false, type: "password" }),
      V("Server Command Password", "SERVER_COMMAND_PASSWORD", "Password for the server command console", "", { required: false, type: "password" }),
      V("MOTD Line 1", "MOTD1", "First message-of-the-day line", "Welcome!", { required: false }),
      V("MOTD Line 2", "MOTD2", "Second message-of-the-day line", "Hosted with GameServer Manager", { required: false }),
      V("MOTD Interval", "MOTD_INTERVAL", "Seconds between MOTD lines", "5", {
        required: false, type: "number", min_value: 1, max_value: 300,
      }),
      V("Log File", "LOG_FILE", "Server console log filename", "server_console.log", { required: false }),
      V("Timestamp Format", "TIMESTAMP_FORMAT", "Timestamp style used in the log", "short", {
        required: false, type: "select", enum_values: { none: "None", short: "Short", full: "Full" },
      }),
      V("Headless Clients", "HEADLESS_CLIENTS", "Comma-separated IPs allowed to connect as headless clients", "", { required: false }),
      V("Local Client", "LOCAL_CLIENT", "Comma-separated IPs treated as local (unrestricted bandwidth)", "", { required: false }),
    ]),

    ...group("Mission & Voting", [
      V("Persistent", "PERSISTENT", "Keep the mission running when the last player leaves", "1", {
        required: false, type: "select", enum_values: { "1": "Enabled", "0": "Disabled" },
      }),
      V("Vote Mission Players", "VOTE_MISSION_PLAYERS", "Players needed before mission voting starts", "1", {
        required: false, type: "number", min_value: 1, max_value: 128,
      }),
      V("Vote Threshold", "VOTE_THRESHOLD", "Fraction of players needed to pass a vote, 9999 disables voting", "0.33", { required: false, type: "float", min_value: 0.01, max_value: 9999 }),
      V("Allowed Vote Commands", "ALLOWED_VOTE_CMDS", "Comma-separated commands players may vote on", "admin,kick,missions,mission,restart,reassign", { required: false }),
      V("Mission Whitelist", "MISSION_WHITELIST", "Comma-separated missions allowed to run, empty = any", "", { required: false }),
      V("Auto Select Mission", "AUTO_SELECT_MISSION", "Automatically pick a mission from the rotation", "true", { required: false, type: "boolean" }),
      V("Random Mission Order", "RANDOM_MISSION_ORDER", "Shuffle the mission rotation", "false", { required: false, type: "boolean" }),
    ]),

    ...group("Security", [
      V("Verify Signatures", "VERIFY_SIGNATURES", "Enforce signed addons — 2 is the modern check", "2", {
        required: false, type: "select",
        enum_values: { "0": "0 — Off", "1": "1 — Legacy", "2": "2 — Enforced (recommended)" },
      }),
      V("Allowed File Patching", "ALLOWED_FILE_PATCHING", "Who may connect with -filePatching", "0", {
        required: false, type: "select",
        enum_values: { "0": "0 — No one", "1": "1 — Headless clients only", "2": "2 — Everyone" },
      }),
      V("Kick Duplicate", "KICK_DUPLICATE", "Kick players sharing a player id", "1", {
        required: false, type: "select", enum_values: { "1": "Enabled", "0": "Disabled" },
      }),
      V("BattlEye", "BATTLEYE", "Enable the BattlEye anti-cheat", "1", {
        required: false, type: "select", enum_values: { "1": "Enabled", "0": "Disabled" },
      }),
      V("On Unsigned Data", "ON_UNSIGNED_DATA", "Action when unsigned data is detected", "kick (_this select 0)", { required: false }),
      V("On Hacked Data", "ON_HACKED_DATA", "Action when modified signed data is detected", "kick (_this select 0)", { required: false }),
      V("On Different Data", "ON_DIFFERENT_DATA", "Action when data differs from the server, empty = allow", "", { required: false }),
      V("Max Ping", "MAX_PING", "Kick players whose ping exceeds this, 0 = no limit", "0", {
        required: false, type: "number", min_value: 0, max_value: 2000,
      }),
      V("Max Desync", "MAX_DESYNC", "Kick players above this desync value, 0 = no limit", "0", {
        required: false, type: "number", min_value: 0, max_value: 10000,
      }),
      V("Max Packet Loss", "MAX_PACKETLOSS", "Kick players above this packet loss percentage, 0 = no limit", "0", {
        required: false, type: "number", min_value: 0, max_value: 100,
      }),
      V("Kick Clients On Slow Network", "KICK_CLIENTS_ON_SLOW_NETWORK", "Kick clients that cannot keep up with the server", "0", {
        required: false, type: "select", enum_values: { "0": "Disabled", "1": "Enabled" },
      }),
    ]),

    ...group("Voice & Gameplay", [
      V("Disable VoN", "DISABLE_VON", "Disable in-game voice over network", "0", {
        required: false, type: "select", enum_values: { "0": "VoN enabled", "1": "VoN disabled" },
      }),
      V("VoN Codec Quality", "VON_CODEC_QUALITY", "Voice quality, higher uses more bandwidth (1-30)", "30", {
        required: false, type: "number", min_value: 1, max_value: 30,
      }),
      V("VoN Codec", "VON_CODEC", "Voice codec — 1 selects the modern Opus codec", "1", {
        required: false, type: "select", enum_values: { "0": "0 — Speex", "1": "1 — Opus" },
      }),
      V("Force Rotor Lib Simulation", "FORCE_ROTOR_LIB_SIMULATION", "Advanced flight model policy", "0", {
        required: false, type: "select",
        enum_values: { "0": "0 — Player choice", "1": "1 — Force advanced", "2": "2 — Force basic" },
      }),
      V("Enable Team Switch", "ENABLE_TEAM_SWITCH", "Allow players to switch teams", "true", { required: false, type: "boolean" }),
      V("AI Kills", "ALLOW_AI_KILLS", "Count AI kills in the score table", "true", { required: false, type: "boolean" }),
      V("Difficulty", "DIFFICULTY", "Server difficulty preset applied to missions", "Custom", {
        required: false, type: "select",
        enum_values: { Recruit: "Recruit", Regular: "Regular", Veteran: "Veteran", Custom: "Custom" },
      }),
    ]),

    ...group("Performance", [
      V("Max Messages Sent", "MAX_MSG_SEND", "Messages sent per simulation frame", "128", {
        required: false, type: "number", min_value: 16, max_value: 1024,
      }),
      V("Max Size Guaranteed", "MAX_SIZE_GUARANTEED", "Bytes per guaranteed message aggregate", "512", {
        required: false, type: "number", min_value: 128, max_value: 4096,
      }),
      V("Max Size Non-Guaranteed", "MAX_SIZE_NONGUARANTEED", "Bytes per non-guaranteed message aggregate", "256", {
        required: false, type: "number", min_value: 64, max_value: 2048,
      }),
      V("Min Bandwidth", "MIN_BANDWIDTH", "Guaranteed bandwidth in bits/sec", "131072", {
        required: false, type: "number", min_value: 8192, max_value: 1000000000,
      }),
      V("Max Bandwidth", "MAX_BANDWIDTH", "Bandwidth cap in bits/sec", "2097152", {
        required: false, type: "number", min_value: 8192, max_value: 1000000000,
      }),
      V("Min Error To Send", "MIN_ERROR_TO_SEND", "Smallest error that triggers an update", "0.001", { required: false, type: "float", min_value: 0, max_value: 1 }),
      V("Min Error To Send Near", "MIN_ERROR_TO_SEND_NEAR", "Smallest error for nearby objects", "0.01", { required: false, type: "float", min_value: 0, max_value: 1 }),
      V("Max Custom File Size", "MAX_CUSTOM_FILE_SIZE", "Bytes of custom player content allowed, 0 = unlimited", "160000", {
        required: false, type: "number", min_value: 0, max_value: 10000000,
      }),
      V("Server Time Out", "SERVER_TIME_OUT", "Seconds before a stalled client is dropped", "90", {
        required: false, type: "number", min_value: 10, max_value: 600,
      }),
      V("Steam Protocol Max Data Size", "STEAM_PROTOCOL_MAX_DATA_SIZE", "Maximum Steam query response size", "1024", {
        required: false, type: "number", min_value: 512, max_value: 8192,
      }),
    ]),
  ],

  installScript: steamInstallScript({
    appId: "233780",
    name: "Arma 3",
    post: `## Arma writes player profiles here; the panel writes server.cfg alongside
mkdir -p "$INSTALL_DIR/profiles"`,
  }),

  startCommand: `cd {{INSTALL_PATH}} && ./arma3server_x64 -port={{PORT}} -config=server.cfg -cfg=basic.cfg -profiles=profiles -name=server -world=empty -autoInit`,
  stopCommand: null,
  configFiles: {
    "server.cfg": "server.cfg",
    "basic.cfg": "basic.cfg",
  },
  defaultConfig: {
    __files: {
      "server.cfg": {
        __gsm_format: "arma",
        hostname: "{{SERVER_NAME}}",
        password: "{{SERVER_PASSWORD}}",
        passwordAdmin: "{{ADMIN_PASSWORD}}",
        serverCommandPassword: "{{SERVER_COMMAND_PASSWORD}}",
        maxPlayers: "{{MAX_PLAYERS}}",
        "motd[]": ["{{MOTD1}}", "{{MOTD2}}"],
        motdInterval: "{{MOTD_INTERVAL}}",
        logFile: "{{LOG_FILE}}",
        timeStampFormat: "{{TIMESTAMP_FORMAT}}",
        "headlessClients[]": csv("{{HEADLESS_CLIENTS}}"),
        "localClient[]": csv("{{LOCAL_CLIENT}}"),
        persistent: "{{PERSISTENT}}",
        voteMissionPlayers: "{{VOTE_MISSION_PLAYERS}}",
        voteThreshold: "{{VOTE_THRESHOLD}}",
        "allowedVoteCmds[]": csv("{{ALLOWED_VOTE_CMDS}}"),
        "missionWhitelist[]": csv("{{MISSION_WHITELIST}}"),
        autoSelectMission: "{{AUTO_SELECT_MISSION}}",
        randomMissionOrder: "{{RANDOM_MISSION_ORDER}}",
        verifySignatures: "{{VERIFY_SIGNATURES}}",
        allowedFilePatching: "{{ALLOWED_FILE_PATCHING}}",
        kickduplicate: "{{KICK_DUPLICATE}}",
        BattlEye: "{{BATTLEYE}}",
        onUnsignedData: "{{ON_UNSIGNED_DATA}}",
        onHackedData: "{{ON_HACKED_DATA}}",
        onDifferentData: "{{ON_DIFFERENT_DATA}}",
        maxPing: "{{MAX_PING}}",
        maxDesync: "{{MAX_DESYNC}}",
        maxPacketLoss: "{{MAX_PACKETLOSS}}",
        kickClientsOnSlowNetwork: "{{KICK_CLIENTS_ON_SLOW_NETWORK}}",
        disableVoN: "{{DISABLE_VON}}",
        vonCodecQuality: "{{VON_CODEC_QUALITY}}",
        vonCodec: "{{VON_CODEC}}",
        forceRotorLibSimulation: "{{FORCE_ROTOR_LIB_SIMULATION}}",
        enableTeamSwitch: "{{ENABLE_TEAM_SWITCH}}",
        allowedLoadFileExtensions: ["hpp", "sqs", "sqf", "fsm", "cpp", "paa", "txt", "xml", "inc", "ext", "sqm", "ods", "fxy", "lip", "csv", "kb", "bik", "bikb", "html", "htm", "biedi"],
        maxCustomFileSize: "{{MAX_CUSTOM_FILE_SIZE}}",
        forcedDifficulty: "{{DIFFICULTY}}",
        AIKills: "{{ALLOW_AI_KILLS}}",
        steamProtocolMaxDataSize: "{{STEAM_PROTOCOL_MAX_DATA_SIZE}}",
      },
      "basic.cfg": {
        __gsm_format: "arma",
        MaxMsgSend: "{{MAX_MSG_SEND}}",
        MaxSizeGuaranteed: "{{MAX_SIZE_GUARANTEED}}",
        MaxSizeNonguaranteed: "{{MAX_SIZE_NONGUARANTEED}}",
        MinBandwidth: "{{MIN_BANDWIDTH}}",
        MaxBandwidth: "{{MAX_BANDWIDTH}}",
        MinErrorToSend: "{{MIN_ERROR_TO_SEND}}",
        MinErrorToSendNear: "{{MIN_ERROR_TO_SEND_NEAR}}",
        MaxCustomFileSize: "{{MAX_CUSTOM_FILE_SIZE}}",
        serverTimeOut: "{{SERVER_TIME_OUT}}",
      },
    },
  },
};
