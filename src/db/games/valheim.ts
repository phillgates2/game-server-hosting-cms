import { V, group, COMMON_VARS, type GameTemplate } from "./types";
import { steamInstallScript } from "./steamcmd";

// Valheim dedicated server. Most options are command-line flags; the world
// modifiers introduced in 0.217 are passed via -modifier and -setkey.
export const valheim: GameTemplate = {
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

    ...group("World", [
      V("World Name", "WORLD_NAME", "Name of the world save file", "Dedicated"),
      V("Save Interval", "SAVE_INTERVAL", "Seconds between automatic world saves", "1800", {
        required: false, type: "number", min_value: 60, max_value: 86400,
      }),
      V("Backups", "BACKUPS", "Number of rotating backups to keep", "4", {
        required: false, type: "number", min_value: 0, max_value: 50,
      }),
      V("Backup Short", "BACKUP_SHORT", "Seconds between short-interval backups", "7200", {
        required: false, type: "number", min_value: 300, max_value: 86400,
      }),
      V("Backup Long", "BACKUP_LONG", "Seconds between long-interval backups", "43200", {
        required: false, type: "number", min_value: 600, max_value: 604800,
      }),
      V("Save Directory", "SAVE_DIR", "Override the world/character save location, empty = default", "", { required: false }),
    ]),

    ...group("Access", [
      V("Password", "PASSWORD", "Join password — minimum 5 characters, must not appear in the server name", "", { type: "password" }),
      V("Public", "PUBLIC", "List the server in the community browser", "1", {
        required: false, type: "select", enum_values: { "1": "1 — Listed publicly", "0": "0 — Unlisted (join by IP)" },
      }),
      V("Crossplay", "CROSSPLAY", "Enable PlayFab crossplay with Xbox and Game Pass players", "false", { required: false, type: "boolean" }),
      V("Instance ID", "INSTANCE_ID", "Unique id used by crossplay matchmaking, empty = auto", "", { required: false }),
    ]),

    ...group("World Modifiers", [
      V("Preset", "PRESET", "Difficulty preset applied before individual modifiers", "", {
        required: false, type: "select",
        enum_values: {
          "": "None — use individual modifiers",
          normal: "Normal", casual: "Casual", easy: "Easy",
          hard: "Hard", hardcore: "Hardcore", immersive: "Immersive", hammer: "Hammer (creative)",
        },
      }),
      V("Combat Difficulty", "MODIFIER_COMBAT", "Enemy damage and health scaling", "normal", {
        required: false, type: "select",
        enum_values: { veryeasy: "Very Easy", easy: "Easy", normal: "Normal", hard: "Hard", veryhard: "Very Hard" },
      }),
      V("Death Penalty", "MODIFIER_DEATHPENALTY", "What you lose on death", "normal", {
        required: false, type: "select",
        enum_values: { casual: "Casual", veryeasy: "Very Easy", easy: "Easy", normal: "Normal", hard: "Hard", hardcore: "Hardcore" },
      }),
      V("Resource Rate", "MODIFIER_RESOURCES", "Resource drop multiplier", "normal", {
        required: false, type: "select",
        enum_values: { muchless: "Much Less", less: "Less", normal: "Normal", more: "More", muchmore: "Much More", most: "Most" },
      }),
      V("Raid Frequency", "MODIFIER_RAIDS", "How often base raids occur", "normal", {
        required: false, type: "select",
        enum_values: { none: "None", muchless: "Much Less", less: "Less", normal: "Normal", more: "More", muchmore: "Much More" },
      }),
      V("Portals", "MODIFIER_PORTALS", "Portal restrictions", "normal", {
        required: false, type: "select",
        enum_values: { casual: "Casual (all items)", normal: "Normal", hard: "Hard", veryhard: "Very Hard (no portals)" },
      }),
      V("No Build Cost", "SETKEY_NOBUILDCOST", "Build without consuming resources", "false", { required: false, type: "boolean" }),
      V("Player Events", "SETKEY_PLAYEREVENTS", "Raids trigger from player progress", "false", { required: false, type: "boolean" }),
      V("Passive Mobs", "SETKEY_PASSIVEMOBS", "Creatures never attack", "false", { required: false, type: "boolean" }),
      V("No Map", "SETKEY_NOMAP", "Play without the in-game map", "false", { required: false, type: "boolean" }),
      V("All Pieces Unlocked", "SETKEY_ALLPIECES", "Unlock every building piece from the start", "false", { required: false, type: "boolean" }),
      V("Death Keep Equipment", "SETKEY_DEATHKEEPEQUIP", "Keep equipped gear on death", "false", { required: false, type: "boolean" }),
    ]),

    ...group("Network", [
      V("Server IP Bind", "SERVER_BIND_IP", "Address the server binds to, empty = all interfaces", "", { required: false }),
      V("Log File", "LOG_FILE", "Path of the server log file, empty = stdout only", "", { required: false }),
    ]),
  ],

  installScript: steamInstallScript({ appId: "896660", name: "Valheim" }),

  // Valheim has no config file — every option is a launch argument. The install
  // script writes a start-args file so the launch line stays readable and the
  // optional flags (preset, setkeys, crossplay, bind IP) can be omitted when
  // they are blank.
  startCommand: `cd {{INSTALL_PATH}} && export LD_LIBRARY_PATH="./linux64:$LD_LIBRARY_PATH" && export SteamAppId=892970 && ARGS=""; [ -n "{{PRESET}}" ] && ARGS="$ARGS -preset {{PRESET}}"; [ "{{CROSSPLAY}}" = "true" ] && ARGS="$ARGS -crossplay"; [ -n "{{INSTANCE_ID}}" ] && ARGS="$ARGS -instanceid {{INSTANCE_ID}}"; [ -n "{{SAVE_DIR}}" ] && ARGS="$ARGS -savedir \"{{SAVE_DIR}}\""; [ -n "{{SERVER_BIND_IP}}" ] && ARGS="$ARGS -serverbindip {{SERVER_BIND_IP}}"; [ -n "{{LOG_FILE}}" ] && ARGS="$ARGS -logFile \"{{LOG_FILE}}\""; for kv in nobuildcost:{{SETKEY_NOBUILDCOST}} playerevents:{{SETKEY_PLAYEREVENTS}} passivemobs:{{SETKEY_PASSIVEMOBS}} nomap:{{SETKEY_NOMAP}} allpieces:{{SETKEY_ALLPIECES}} deathkeepequip:{{SETKEY_DEATHKEEPEQUIP}}; do k="\${kv%%:*}"; v="\${kv##*:}"; [ "$v" = "true" ] && ARGS="$ARGS -setkey $k"; done; exec ./valheim_server.x86_64 -nographics -batchmode -name "{{SERVER_NAME}}" -port {{PORT}} -world "{{WORLD_NAME}}" -password "{{PASSWORD}}" -public {{PUBLIC}} -saveinterval {{SAVE_INTERVAL}} -backups {{BACKUPS}} -backupshort {{BACKUP_SHORT}} -backuplong {{BACKUP_LONG}} -modifier combat {{MODIFIER_COMBAT}} -modifier deathpenalty {{MODIFIER_DEATHPENALTY}} -modifier resources {{MODIFIER_RESOURCES}} -modifier raids {{MODIFIER_RAIDS}} -modifier portals {{MODIFIER_PORTALS}} $ARGS`,
  stopCommand: null,
  configFiles: {},
  defaultConfig: {},
};
