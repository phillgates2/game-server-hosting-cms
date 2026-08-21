import { V, group, csv, COMMON_VARS, RCON_VARS, type GameTemplate } from "./types";

// Factorio's headless server reads server-settings.json; RCON and ports are
// launch arguments. Reference: wube/factorio-data server-settings.example.json
export const factorio: GameTemplate = {
  slug: "factorio",
  name: "Factorio",
  engine: "Custom",
  defaultPort: 34197,
  steamAppId: null,
  iconEmoji: "\u{2699}\uFE0F",
  supportsIpv6: false,
  category: "Sandbox",
  description: "Factory automation and logistics",
  estimatedSize: "~500 MB",
  variables: [
    ...COMMON_VARS,
    ...RCON_VARS,

    ...group("World", [
      V("World Name", "WORLD_NAME", "Save file name (without .zip)", "world"),
      V("Autosave Interval", "AUTOSAVE_INTERVAL", "Minutes between autosaves", "10", {
        required: false, type: "number", min_value: 1, max_value: 1440,
      }),
      V("Autosave Slots", "AUTOSAVE_SLOTS", "Rotating autosave slots", "5", {
        required: false, type: "number", min_value: 1, max_value: 100,
      }),
      V("Autosave Only On Server", "AUTOSAVE_ONLY_ON_SERVER", "Do not ask clients to autosave too", "true", { required: false, type: "boolean" }),
      V("Non-Blocking Saving", "NON_BLOCKING_SAVING", "Fork to save without pausing — experimental", "false", { required: false, type: "boolean" }),
      V("Auto Pause", "AUTO_PAUSE", "Pause the game when no players are connected", "true", { required: false, type: "boolean" }),
      V("Auto Pause When Players Connect", "AUTO_PAUSE_WHEN_PLAYERS_CONNECT", "Pause while a player is joining", "false", { required: false, type: "boolean" }),
      V("Only Admins Can Pause", "ONLY_ADMINS_CAN_PAUSE", "Restrict manual pausing to admins", "true", { required: false, type: "boolean" }),
    ]),

    ...group("Listing & Visibility", [
      V("Description", "DESCRIPTION", "Description shown in the server browser", "", { required: false }),
      V("Tags", "TAGS", "Comma-separated browser filter tags", "", { required: false }),
      V("Public Visibility", "VISIBILITY_PUBLIC", "Publish on the official matching server (needs a username and token)", "false", { required: false, type: "boolean" }),
      V("LAN Visibility", "VISIBILITY_LAN", "Broadcast the server on the local network", "true", { required: false, type: "boolean" }),
      V("Factorio Username", "FACTORIO_USERNAME", "factorio.com username — required for public listing", "", { required: false }),
      V("Factorio Token", "FACTORIO_TOKEN", "Auth token from factorio.com/profile", "", { required: false, type: "password" }),
      V("Game Password", "GAME_PASSWORD", "Password required to join, empty = public", "", { required: false, type: "password" }),
      V("Require User Verification", "REQUIRE_USER_VERIFICATION", "Only allow verified factorio.com accounts", "true", { required: false, type: "boolean" }),
    ]),

    ...group("Players", [
      V("AFK Autokick Interval", "AFK_AUTOKICK_INTERVAL", "Minutes before an idle player is kicked, 0 = never", "0", {
        required: false, type: "number", min_value: 0, max_value: 1440,
      }),
      V("Allow Commands", "ALLOW_COMMANDS", "Who may run console commands", "admins-only", {
        required: false, type: "select",
        enum_values: { "true": "Everyone", "false": "No one", "admins-only": "Admins only" },
      }),
      V("Ignore Player Limit For Returning", "IGNORE_PLAYER_LIMIT_FOR_RETURNING_PLAYERS", "Returning players may join a full server", "false", { required: false, type: "boolean" }),
    ]),

    ...group("Network", [
      V("Max Upload Rate", "MAX_UPLOAD_IN_KILOBYTES_PER_SECOND", "Upload cap in KB/s, 0 = unlimited", "0", {
        required: false, type: "number", min_value: 0, max_value: 1000000,
      }),
      V("Max Upload Slots", "MAX_UPLOAD_SLOTS", "Concurrent map upload slots, 0 = unlimited", "5", {
        required: false, type: "number", min_value: 0, max_value: 100,
      }),
      V("Minimum Latency", "MINIMUM_LATENCY_IN_TICKS", "Artificial latency floor in ticks, 0 = none", "0", {
        required: false, type: "number", min_value: 0, max_value: 200,
      }),
      V("Max Heartbeats Per Second", "MAX_HEARTBEATS_PER_SECOND", "Network tick rate (6-240)", "60", {
        required: false, type: "number", min_value: 6, max_value: 240,
      }),
      V("Minimum Segment Size", "MINIMUM_SEGMENT_SIZE", "Smallest network segment size", "25", {
        required: false, type: "number", min_value: 1, max_value: 10000,
      }),
      V("Minimum Segment Size Peers", "MINIMUM_SEGMENT_SIZE_PEER_COUNT", "Peer count at which the minimum segment size applies", "20", {
        required: false, type: "number", min_value: 1, max_value: 1000,
      }),
      V("Maximum Segment Size", "MAXIMUM_SEGMENT_SIZE", "Largest network segment size", "100", {
        required: false, type: "number", min_value: 1, max_value: 10000,
      }),
      V("Maximum Segment Size Peers", "MAXIMUM_SEGMENT_SIZE_PEER_COUNT", "Peer count at which the maximum segment size applies", "10", {
        required: false, type: "number", min_value: 1, max_value: 1000,
      }),
      V("RCON Port", "RCON_PORT", "Port the RCON listener binds to", "27015", {
        required: false, type: "number", min_value: 1, max_value: 65535,
      }),
    ]),
  ],

  installScript: `#!/bin/bash
set -e
INSTALL_DIR="{{INSTALL_PATH}}"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

## Download Factorio Headless Server
echo "Downloading Factorio Headless Server..."
curl -fSL --retry 3 -A "Mozilla/5.0 (compatible; GSM-Panel)" -o factorio.tar.xz "https://factorio.com/get-download/stable/headless/linux64"
if ! tar tf factorio.tar.xz > /dev/null 2>&1; then
  echo "ERROR: downloaded Factorio archive is corrupt" >&2
  rm -f factorio.tar.xz
  exit 1
fi
tar xf factorio.tar.xz --strip-components=1
rm -f factorio.tar.xz

if [ ! -x ./bin/x64/factorio ]; then
  echo "ERROR: factorio binary missing after extraction" >&2
  exit 1
fi

## Create initial save
mkdir -p saves
if [ ! -f "saves/{{WORLD_NAME}}.zip" ]; then
  echo "Creating initial world save..."
  ./bin/x64/factorio --create "saves/{{WORLD_NAME}}.zip"
fi

echo "Factorio server installed successfully"
`,

  startCommand: `cd {{INSTALL_PATH}} && ./bin/x64/factorio --start-server saves/{{WORLD_NAME}}.zip --server-settings server-settings.json --port {{PORT}} --rcon-port {{RCON_PORT}} --rcon-password "{{RCON_PASSWORD}}"`,
  stopCommand: null,
  configFiles: { "server-settings.json": "server-settings.json" },
  defaultConfig: {
    __gsm_format: "json",
    name: "{{SERVER_NAME}}",
    description: "{{DESCRIPTION}}",
    tags: csv("{{TAGS}}"),
    max_players: "{{MAX_PLAYERS}}",
    visibility: {
      public: "{{VISIBILITY_PUBLIC}}",
      lan: "{{VISIBILITY_LAN}}",
    },
    username: "{{FACTORIO_USERNAME}}",
    password: "",
    token: "{{FACTORIO_TOKEN}}",
    game_password: "{{GAME_PASSWORD}}",
    require_user_verification: "{{REQUIRE_USER_VERIFICATION}}",
    max_upload_in_kilobytes_per_second: "{{MAX_UPLOAD_IN_KILOBYTES_PER_SECOND}}",
    max_upload_slots: "{{MAX_UPLOAD_SLOTS}}",
    minimum_latency_in_ticks: "{{MINIMUM_LATENCY_IN_TICKS}}",
    max_heartbeats_per_second: "{{MAX_HEARTBEATS_PER_SECOND}}",
    ignore_player_limit_for_returning_players: "{{IGNORE_PLAYER_LIMIT_FOR_RETURNING_PLAYERS}}",
    allow_commands: "{{ALLOW_COMMANDS}}",
    autosave_interval: "{{AUTOSAVE_INTERVAL}}",
    autosave_slots: "{{AUTOSAVE_SLOTS}}",
    afk_autokick_interval: "{{AFK_AUTOKICK_INTERVAL}}",
    auto_pause: "{{AUTO_PAUSE}}",
    auto_pause_when_players_connect: "{{AUTO_PAUSE_WHEN_PLAYERS_CONNECT}}",
    only_admins_can_pause_the_game: "{{ONLY_ADMINS_CAN_PAUSE}}",
    autosave_only_on_server: "{{AUTOSAVE_ONLY_ON_SERVER}}",
    non_blocking_saving: "{{NON_BLOCKING_SAVING}}",
    minimum_segment_size: "{{MINIMUM_SEGMENT_SIZE}}",
    minimum_segment_size_peer_count: "{{MINIMUM_SEGMENT_SIZE_PEER_COUNT}}",
    maximum_segment_size: "{{MAXIMUM_SEGMENT_SIZE}}",
    maximum_segment_size_peer_count: "{{MAXIMUM_SEGMENT_SIZE_PEER_COUNT}}",
  },
};
