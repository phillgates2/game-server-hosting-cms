import { V, group, COMMON_VARS, type GameTemplate } from "./types";
import { steamInstallScript } from "./steamcmd";

// Don't Starve Together uses a cluster.ini for shared settings plus a
// server.ini per shard (Master/Caves).
export const dontStarveTogether: GameTemplate = {
  slug: "dont-starve-together",
  name: "Don't Starve Together",
  engine: "Custom",
  defaultPort: 10999,
  steamAppId: "343050",
  iconEmoji: "\u{1F525}",
  supportsIpv6: false,
  category: "Survival",
  description: "Multiplayer wilderness survival",
  estimatedSize: "~3 GB",
  variables: [
    ...COMMON_VARS,

    ...group("Cluster", [
      V("Cluster Name", "CLUSTER_NAME", "Folder name for this cluster's saves", "Cluster_1"),
      V("Cluster Token", "CLUSTER_TOKEN", "Klei server token \u2014 the server will not start without it", "", { type: "password" }),
      V("Cluster Description", "CLUSTER_DESCRIPTION", "Description shown in the server browser", "", { required: false }),
      V("Cluster Password", "CLUSTER_PASSWORD", "Password required to join, empty = public", "", { required: false, type: "password" }),
      V("Cluster Intention", "CLUSTER_INTENTION", "Play style advertised in the browser", "cooperative", {
        required: false, type: "select",
        enum_values: { cooperative: "Cooperative", competitive: "Competitive", social: "Social", madness: "Madness" },
      }),
      V("Cluster Language", "CLUSTER_LANGUAGE", "Language tag shown in the browser", "en", { required: false }),
      V("LAN Only Cluster", "LAN_ONLY_CLUSTER", "Accept connections from the local network only", "false", { required: false, type: "boolean" }),
      V("Offline Cluster", "OFFLINE_CLUSTER", "Run fully offline \u2014 no Klei listing", "false", { required: false, type: "boolean" }),
      V("Whitelist Slots", "WHITELIST_SLOTS", "Slots reserved for whitelisted players", "0", {
        required: false, type: "number", min_value: 0, max_value: 64,
      }),
    ]),

    ...group("Gameplay", [
      V("Game Mode", "GAME_MODE", "How death and respawning work", "survival", {
        required: false, type: "select",
        enum_values: {
          survival: "Survival \u2014 ghost on death, revivable",
          endless: "Endless \u2014 respawn at the portal",
          wilderness: "Wilderness \u2014 permadeath, random spawn",
        },
      }),
      V("PvP", "PVP", "Allow player-vs-player damage", "false", { required: false, type: "boolean" }),
      V("Pause When Empty", "PAUSE_WHEN_EMPTY", "Freeze the simulation when nobody is online", "true", { required: false, type: "boolean" }),
      V("Vote Enabled", "VOTE_ENABLED", "Let players vote to kick, rollback or regenerate", "true", { required: false, type: "boolean" }),
      V("Vote Kick Enabled", "VOTE_KICK_ENABLED", "Enable the vote-to-kick option specifically", "true", { required: false, type: "boolean" }),
      V("Autosaver Enabled", "AUTOSAVER_ENABLED", "Save the world after every in-game day", "true", { required: false, type: "boolean" }),
    ]),

    ...group("Shards", [
      V("Shard Enabled", "SHARD_ENABLED", "Enable multi-shard support \u2014 required for Caves", "true", { required: false, type: "boolean" }),
      V("Bind IP", "BIND_IP", "Address the master shard listens on for slaves", "127.0.0.1", { required: false }),
      V("Master IP", "MASTER_IP", "Address slave shards connect to", "127.0.0.1", { required: false }),
      V("Master Port", "MASTER_PORT", "UDP port used for inter-shard traffic", "10888", {
        required: false, type: "number", min_value: 1, max_value: 65535,
      }),
      V("Cluster Key", "CLUSTER_KEY", "Shared secret between shards", "gsmcluster", { required: false, type: "password" }),
      V("Caves Port", "CAVES_PORT", "Game port for the Caves shard", "11000", {
        required: false, type: "number", min_value: 1, max_value: 65535,
      }),
      V("Master Steam Port", "MASTER_STEAM_AUTH_PORT", "Steam authentication port for the Master shard", "8766", {
        required: false, type: "number", min_value: 1, max_value: 65535,
      }),
      V("Master Steam Master Port", "MASTER_STEAM_MASTER_PORT", "Steam master-server port for the Master shard", "27016", {
        required: false, type: "number", min_value: 1, max_value: 65535,
      }),
      V("Caves Steam Port", "CAVES_STEAM_AUTH_PORT", "Steam authentication port for the Caves shard", "8768", {
        required: false, type: "number", min_value: 1, max_value: 65535,
      }),
      V("Caves Steam Master Port", "CAVES_STEAM_MASTER_PORT", "Steam master-server port for the Caves shard", "27018", {
        required: false, type: "number", min_value: 1, max_value: 65535,
      }),
    ]),

    ...group("Network & Performance", [
      V("Tick Rate", "TICK_RATE", "Server updates per second (15-60)", "15", {
        required: false, type: "number", min_value: 15, max_value: 60,
      }),
      V("Connection Timeout", "CONNECTION_TIMEOUT", "Milliseconds before a silent client is dropped", "8000", {
        required: false, type: "number", min_value: 1000, max_value: 60000,
      }),
      V("Max Snapshots", "MAX_SNAPSHOTS", "Rollback snapshots retained", "6", {
        required: false, type: "number", min_value: 1, max_value: 20,
      }),
      V("Console Enabled", "CONSOLE_ENABLED", "Allow Lua commands in the server console", "true", { required: false, type: "boolean" }),
    ]),

    ...group("Steam Group", [
      V("Steam Group Only", "STEAM_GROUP_ONLY", "Only allow members of the Steam group", "false", { required: false, type: "boolean" }),
      V("Steam Group ID", "STEAM_GROUP_ID", "Numeric Steam group id, 0 = none", "0", {
        required: false, type: "number", min_value: 0, max_value: 999999999999,
      }),
      V("Steam Group Admins", "STEAM_GROUP_ADMINS", "Grant admin to the Steam group's officers", "false", { required: false, type: "boolean" }),
    ]),
  ],

  installScript: steamInstallScript({
    appId: "343050",
    name: "Don't Starve Together",
    post: `## Create the cluster directory everywhere the server looks for it.
## The dedicated server refuses to start without cluster_token.txt.
CLUSTER_DIR="$INSTALL_DIR/DoNotStarveTogether/{{CLUSTER_NAME}}"
mkdir -p "$CLUSTER_DIR/Master" "$CLUSTER_DIR/Caves"
if [ -n "{{CLUSTER_TOKEN}}" ]; then
  printf '%s' "{{CLUSTER_TOKEN}}" > "$CLUSTER_DIR/cluster_token.txt"
  echo "Cluster token written to $CLUSTER_DIR/cluster_token.txt"
else
  echo "WARNING: No cluster token set — the server will not start until"
  echo "         $CLUSTER_DIR/cluster_token.txt contains a valid Klei token."
fi

## Keep the server script reachable even if HOME differs at runtime
if [ ! -e "$HOME/.klei/DoNotStarveTogether" ]; then
  mkdir -p "$HOME/.klei"
  ln -sfn "$INSTALL_DIR/DoNotStarveTogether" "$HOME/.klei/DoNotStarveTogether" 2>/dev/null || true
fi`,
  }),

  startCommand: `cd {{INSTALL_PATH}} && ./bin64/dontstarve_dedicated_server_nullrenderer_x64 -console -persistent_storage_root "{{INSTALL_PATH}}" -conf_dir DoNotStarveTogether -cluster {{CLUSTER_NAME}} -shard Master`,
  stopCommand: "c_shutdown()",
  configFiles: {
    "DoNotStarveTogether/{{CLUSTER_NAME}}/cluster.ini": "cluster.ini",
    "DoNotStarveTogether/{{CLUSTER_NAME}}/Master/server.ini": "server.ini",
    "DoNotStarveTogether/{{CLUSTER_NAME}}/Caves/server.ini": "server.ini",
  },
  defaultConfig: {
    __files: {
      "DoNotStarveTogether/{{CLUSTER_NAME}}/cluster.ini": {
        __gsm_format: "ini",
        GAMEPLAY: {
          game_mode: "{{GAME_MODE}}",
          max_players: "{{MAX_PLAYERS}}",
          pvp: "{{PVP}}",
          pause_when_empty: "{{PAUSE_WHEN_EMPTY}}",
          vote_enabled: "{{VOTE_ENABLED}}",
          enable_vote_kick: "{{VOTE_KICK_ENABLED}}",
          autosaver_enabled: "{{AUTOSAVER_ENABLED}}",
        },
        NETWORK: {
          cluster_name: "{{SERVER_NAME}}",
          cluster_description: "{{CLUSTER_DESCRIPTION}}",
          cluster_password: "{{CLUSTER_PASSWORD}}",
          cluster_intention: "{{CLUSTER_INTENTION}}",
          cluster_language: "{{CLUSTER_LANGUAGE}}",
          lan_only_cluster: "{{LAN_ONLY_CLUSTER}}",
          offline_cluster: "{{OFFLINE_CLUSTER}}",
          whitelist_slots: "{{WHITELIST_SLOTS}}",
          tick_rate: "{{TICK_RATE}}",
          connection_timeout: "{{CONNECTION_TIMEOUT}}",
        },
        MISC: {
          console_enabled: "{{CONSOLE_ENABLED}}",
          max_snapshots: "{{MAX_SNAPSHOTS}}",
        },
        SHARD: {
          shard_enabled: "{{SHARD_ENABLED}}",
          bind_ip: "{{BIND_IP}}",
          master_ip: "{{MASTER_IP}}",
          master_port: "{{MASTER_PORT}}",
          cluster_key: "{{CLUSTER_KEY}}",
        },
        STEAM: {
          steam_group_only: "{{STEAM_GROUP_ONLY}}",
          steam_group_id: "{{STEAM_GROUP_ID}}",
          steam_group_admins: "{{STEAM_GROUP_ADMINS}}",
        },
      },
      "DoNotStarveTogether/{{CLUSTER_NAME}}/Master/server.ini": {
        __gsm_format: "ini",
        NETWORK: { server_port: "{{PORT}}" },
        SHARD: { is_master: "true", name: "Master" },
        STEAM: {
          authentication_port: "{{MASTER_STEAM_AUTH_PORT}}",
          master_server_port: "{{MASTER_STEAM_MASTER_PORT}}",
        },
        ACCOUNT: { encode_user_path: "true" },
      },
      "DoNotStarveTogether/{{CLUSTER_NAME}}/Caves/server.ini": {
        __gsm_format: "ini",
        NETWORK: { server_port: "{{CAVES_PORT}}" },
        SHARD: { is_master: "false", name: "Caves" },
        STEAM: {
          authentication_port: "{{CAVES_STEAM_AUTH_PORT}}",
          master_server_port: "{{CAVES_STEAM_MASTER_PORT}}",
        },
        ACCOUNT: { encode_user_path: "true" },
      },
    },
  },
};
