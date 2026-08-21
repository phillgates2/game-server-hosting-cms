import { V, group, STEAM_VARS, type GameTemplate } from "./types";

// AssettoServer reads cfg/server_cfg.ini, an ini file with [SERVER],
// [PRACTICE], [QUALIFY], [RACE], [DYNAMIC_TRACK] and [WEATHER_n] sections.
export const assettoCorsa: GameTemplate = {
  slug: "assetto-corsa",
  name: "Assetto Corsa",
  engine: "Custom",
  defaultPort: 9600,
  // Installed via AssettoServer (GitHub), not SteamCMD — the AC app requires
  // an account that owns the game, so anonymous app_update always fails.
  steamAppId: null,
  iconEmoji: "\u{1F3CE}\uFE0F",
  supportsIpv6: false,
  category: "Racing",
  description: "Realistic racing simulator",
  estimatedSize: "~15 GB",
  variables: [
    ...STEAM_VARS,

    ...group("Track & Cars", [
      V("Track", "TRACK", "Track folder name from content/tracks", "imola"),
      V("Track Layout", "CONFIG_TRACK", "Track layout/config name, empty = default layout", "", { required: false }),
      V("Cars", "CARS", "Semicolon-separated car folder names", "bmw_m3_e30", { required: false }),
      V("Sun Angle", "SUN_ANGLE", "Sun position, -80 (morning) to 80 (evening)", "48", {
        required: false, type: "number", min_value: -80, max_value: 80,
      }),
      V("Legal Tyres", "LEGAL_TYRES", "Semicolon-separated allowed tyre compound codes", "", { required: false }),
    ]),

    ...group("Server", [
      V("Password", "SERVER_PASSWORD", "Password required to join, empty = public", "", { required: false, type: "password" }),
      V("Admin Password", "ADMIN_PASSWORD", "Admin password — must be at least 8 characters", "", { type: "password" }),
      V("HTTP Port", "HTTP_PORT", "Port for the built-in HTTP server-info endpoint", "8081", {
        required: false, type: "number", min_value: 1, max_value: 65535,
      }),
      V("Register To Lobby", "REGISTER_TO_LOBBY", "List the server in the official AC lobby", "1", {
        required: false, type: "select", enum_values: { "1": "Listed", "0": "Unlisted" },
      }),
      V("Pickup Mode", "PICKUP_MODE_ENABLED", "Players may join and pick a car at any time", "1", {
        required: false, type: "select", enum_values: { "1": "Enabled", "0": "Booking mode" },
      }),
      V("Loop Mode", "LOOP_MODE", "Restart the session list when it finishes", "1", {
        required: false, type: "select", enum_values: { "1": "Loop", "0": "Stop after last session" },
      }),
      V("Locked Entry List", "LOCKED_ENTRY_LIST", "Only drivers in entry_list.ini may join", "0", {
        required: false, type: "select", enum_values: { "0": "Open", "1": "Locked" },
      }),
      V("Client Send Interval", "CLIENT_SEND_INTERVAL_HZ", "Client update rate in Hz — lower for poor connections", "18", {
        required: false, type: "number", min_value: 5, max_value: 60,
      }),
      V("Send Buffer Size", "SEND_BUFFER_SIZE", "Socket send buffer, 0 = OS default", "0", {
        required: false, type: "number", min_value: 0, max_value: 10000000,
      }),
      V("Receive Buffer Size", "RECV_BUFFER_SIZE", "Socket receive buffer, 0 = OS default", "0", {
        required: false, type: "number", min_value: 0, max_value: 10000000,
      }),
      V("Sleep Time", "SLEEP_TIME", "Main loop sleep in milliseconds — 1 is standard", "1", {
        required: false, type: "number", min_value: 0, max_value: 1000,
      }),
      V("UDP Plugin Local Port", "UDP_PLUGIN_LOCAL_PORT", "Local port for a UDP plugin, 0 = disabled", "0", {
        required: false, type: "number", min_value: 0, max_value: 65535,
      }),
      V("UDP Plugin Address", "UDP_PLUGIN_ADDRESS", "Address a UDP plugin listens on", "", { required: false }),
      V("Auth Plugin Address", "AUTH_PLUGIN_ADDRESS", "URL of an external authentication plugin", "", { required: false }),
    ]),

    ...group("Race Rules", [
      V("Race Over Time", "RACE_OVER_TIME", "Seconds remaining drivers have after the winner finishes", "180", {
        required: false, type: "number", min_value: 0, max_value: 3600,
      }),
      V("Race Pit Window Start", "RACE_PIT_WINDOW_START", "Lap or percentage the mandatory pit window opens, 0 = off", "0", {
        required: false, type: "number", min_value: 0, max_value: 100,
      }),
      V("Race Pit Window End", "RACE_PIT_WINDOW_END", "Lap or percentage the pit window closes", "0", {
        required: false, type: "number", min_value: 0, max_value: 100,
      }),
      V("Race Extra Lap", "RACE_EXTRA_LAP", "Add one lap after the timer expires", "0", {
        required: false, type: "select", enum_values: { "0": "No", "1": "Yes" },
      }),
      V("Race Gas Penalty Disabled", "RACE_GAS_PENALTY_DISABLED", "Disable the automatic cut-track penalty", "0", {
        required: false, type: "select", enum_values: { "0": "Penalties on", "1": "Penalties off" },
      }),
      V("Result Screen Time", "RESULT_SCREEN_TIME", "Seconds the results screen is shown", "60", {
        required: false, type: "number", min_value: 0, max_value: 600,
      }),
      V("Reversed Grid Positions", "REVERSED_GRID_RACE_POSITIONS", "Reverse this many grid slots in race 2, 0 = off, -1 = all", "0", {
        required: false, type: "number", min_value: -1, max_value: 64,
      }),
      V("Qualify Max Wait", "QUALIFY_MAX_WAIT_PERC", "Percentage of the leader's lap time slower cars may take", "120", {
        required: false, type: "number", min_value: 100, max_value: 1000,
      }),
      V("Max Ballast", "MAX_BALLAST_KG", "Maximum ballast admins may assign, in kg", "0", {
        required: false, type: "number", min_value: 0, max_value: 500,
      }),
    ]),

    ...group("Assists & Realism", [
      V("ABS Allowed", "ABS_ALLOWED", "Anti-lock braking policy", "1", {
        required: false, type: "select",
        enum_values: { "0": "0 — Denied", "1": "1 — Factory cars only", "2": "2 — Allowed for all" },
      }),
      V("Traction Control Allowed", "TC_ALLOWED", "Traction control policy", "1", {
        required: false, type: "select",
        enum_values: { "0": "0 — Denied", "1": "1 — Factory cars only", "2": "2 — Allowed for all" },
      }),
      V("Stability Allowed", "STABILITY_ALLOWED", "Allow the stability control assist", "0", {
        required: false, type: "select", enum_values: { "0": "Denied", "1": "Allowed" },
      }),
      V("Autoclutch Allowed", "AUTOCLUTCH_ALLOWED", "Allow the automatic clutch", "0", {
        required: false, type: "select", enum_values: { "0": "Denied", "1": "Allowed" },
      }),
      V("Tyre Blankets Allowed", "TYRE_BLANKETS_ALLOWED", "Cars leave the pits on warm tyres", "0", {
        required: false, type: "select", enum_values: { "0": "Denied", "1": "Allowed" },
      }),
      V("Force Virtual Mirror", "FORCE_VIRTUAL_MIRROR", "Force the virtual rear-view mirror on", "1", {
        required: false, type: "select", enum_values: { "1": "Forced", "0": "Optional" },
      }),
      V("Allowed Tyres Out", "ALLOWED_TYRES_OUT", "Wheels allowed off track before a penalty, -1 = no limit", "2", {
        required: false, type: "number", min_value: -1, max_value: 4,
      }),
      V("Fuel Rate", "FUEL_RATE", "Fuel consumption percentage", "100", {
        required: false, type: "number", min_value: 0, max_value: 500,
      }),
      V("Damage Multiplier", "DAMAGE_MULTIPLIER", "Collision damage percentage", "100", {
        required: false, type: "number", min_value: 0, max_value: 100,
      }),
      V("Tyre Wear Rate", "TYRE_WEAR_RATE", "Tyre wear percentage", "100", {
        required: false, type: "number", min_value: 0, max_value: 500,
      }),
      V("Start Rule", "START_RULE", "Start procedure", "0", {
        required: false, type: "select",
        enum_values: { "0": "0 — Car locked until start", "1": "1 — Teleport to pit", "2": "2 — Drive-through" },
      }),
      V("Time Of Day Multiplier", "TIME_OF_DAY_MULT", "How fast in-game time passes", "1", {
        required: false, type: "number", min_value: 0, max_value: 100,
      }),
    ]),

    ...group("Voting & Moderation", [
      V("Kick Quorum", "KICK_QUORUM", "Percentage of players needed to kick someone", "85", {
        required: false, type: "number", min_value: 1, max_value: 100,
      }),
      V("Voting Quorum", "VOTING_QUORUM", "Percentage needed for session votes", "80", {
        required: false, type: "number", min_value: 1, max_value: 100,
      }),
      V("Vote Duration", "VOTE_DURATION", "Seconds a vote stays open", "20", {
        required: false, type: "number", min_value: 5, max_value: 300,
      }),
      V("Blacklist Mode", "BLACKLIST_MODE", "What happens to kicked drivers", "1", {
        required: false, type: "select",
        enum_values: { "0": "0 — Normal kick", "1": "1 — Kick for this session", "2": "2 — Permanent ban" },
      }),
      V("Max Contacts Per KM", "MAX_CONTACTS_PER_KM", "Collisions per km before a kick, -1 = disabled", "-1", {
        required: false, type: "number", min_value: -1, max_value: 100,
      }),
    ]),

    ...group("Sessions", [
      V("Practice Enabled", "PRACTICE_IS_OPEN", "Run a practice session", "1", {
        required: false, type: "select", enum_values: { "1": "Open", "0": "Closed", "2": "Closed at start" },
      }),
      V("Practice Time", "PRACTICE_TIME", "Practice length in minutes", "10", {
        required: false, type: "number", min_value: 0, max_value: 1440,
      }),
      V("Qualify Enabled", "QUALIFY_IS_OPEN", "Run a qualifying session", "1", {
        required: false, type: "select", enum_values: { "1": "Open", "0": "Closed", "2": "Closed at start" },
      }),
      V("Qualify Time", "QUALIFY_TIME", "Qualifying length in minutes", "10", {
        required: false, type: "number", min_value: 0, max_value: 1440,
      }),
      V("Race Enabled", "RACE_IS_OPEN", "Run a race session", "1", {
        required: false, type: "select", enum_values: { "1": "Open", "0": "Closed", "2": "Closed at start" },
      }),
      V("Race Laps", "RACE_LAPS", "Race distance in laps", "5", {
        required: false, type: "number", min_value: 0, max_value: 1000,
      }),
      V("Race Wait Time", "RACE_WAIT_TIME", "Seconds on the grid before the lights go out", "60", {
        required: false, type: "number", min_value: 0, max_value: 600,
      }),
      V("Race Time", "RACE_TIME", "Timed-race length in minutes, 0 = use laps", "0", {
        required: false, type: "number", min_value: 0, max_value: 1440,
      }),
    ]),

    ...group("Track & Weather", [
      V("Dynamic Track Start", "DYNAMIC_TRACK_SESSION_START", "Track grip at session start, percentage", "89", {
        required: false, type: "number", min_value: 0, max_value: 150,
      }),
      V("Dynamic Track Randomness", "DYNAMIC_TRACK_RANDOMNESS", "Random grip variation, percentage", "3", {
        required: false, type: "number", min_value: 0, max_value: 100,
      }),
      V("Dynamic Track Transfer", "DYNAMIC_TRACK_SESSION_TRANSFER", "Percentage of grip carried into the next session", "80", {
        required: false, type: "number", min_value: 0, max_value: 100,
      }),
      V("Dynamic Track Lap Gain", "DYNAMIC_TRACK_LAP_GAIN", "Laps needed to gain one percent of grip", "50", {
        required: false, type: "number", min_value: 1, max_value: 1000,
      }),
      V("Weather Graphics", "WEATHER_GRAPHICS", "Weather preset used for the first slot", "3_clear", { required: false }),
      V("Ambient Temperature", "WEATHER_BASE_TEMP_AMBIENT", "Base air temperature in Celsius", "18", {
        required: false, type: "number", min_value: -20, max_value: 60,
      }),
      V("Road Temperature Offset", "WEATHER_BASE_TEMP_ROAD", "Road temperature offset from ambient", "6", {
        required: false, type: "number", min_value: -20, max_value: 40,
      }),
      V("Ambient Variation", "WEATHER_VARIATION_AMBIENT", "Random ambient temperature swing", "1", {
        required: false, type: "number", min_value: 0, max_value: 20,
      }),
      V("Road Variation", "WEATHER_VARIATION_ROAD", "Random road temperature swing", "1", {
        required: false, type: "number", min_value: 0, max_value: 20,
      }),
    ]),
  ],

  installScript: `#!/bin/bash
set -e
INSTALL_DIR="{{INSTALL_PATH}}"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

## AssettoServer is distributed from compujuckel/AssettoServer releases
case "$(uname -m)" in
  x86_64|amd64)  MATCH="linux-x64" ;;
  aarch64|arm64) MATCH="linux-arm64" ;;
  *) echo "ERROR: unsupported architecture for AssettoServer: $(uname -m)" >&2; exit 1 ;;
esac

LATEST_JSON=$(curl -fsSL --retry 3 "https://api.github.com/repos/compujuckel/AssettoServer/releases/latest")
DOWNLOAD_URL=$(echo "$LATEST_JSON" | grep -oP '"browser_download_url"\s*:\s*"\K[^"]+' | grep -- "-$MATCH\\.tar\\.gz" | head -1)

if [ -z "$DOWNLOAD_URL" ]; then
  echo "ERROR: could not find an AssettoServer release asset for: $MATCH" >&2
  exit 1
fi

echo "Downloading AssettoServer from: $DOWNLOAD_URL"
curl -fSL --retry 3 -o assetto-server-linux.tar.gz "$DOWNLOAD_URL"
tar xf assetto-server-linux.tar.gz
rm -f assetto-server-linux.tar.gz
chmod +x AssettoServer

## AssettoServer refuses to start when the admin password is shorter than 8 chars
ADMIN_PW="{{ADMIN_PASSWORD}}"
if [ \${#ADMIN_PW} -lt 8 ]; then
  echo "WARNING: the admin password is empty or shorter than 8 characters."
  echo "         AssettoServer will refuse to start — set a longer ADMIN_PASSWORD"
  echo "         in the server settings and reinstall or edit cfg/server_cfg.ini."
fi

mkdir -p cfg/
[ -f "cfg/entry_list.ini" ] || touch cfg/entry_list.ini

## NOTE: AssettoServer needs Assetto Corsa game content (content/ folder with
## car & track files) to actually load sessions. Upload it via the Files panel
## after install, otherwise the server starts but every track fails to load.
if [ ! -d content ]; then
  echo "WARNING: no Assetto Corsa content/ folder found."
  echo "         Upload the game's content via the Files panel before starting."
fi

echo "Assetto Corsa server installed successfully"`,

  startCommand: `cd {{INSTALL_PATH}} && ./AssettoServer`,
  stopCommand: null,
  configFiles: { "cfg/server_cfg.ini": "server_cfg.ini" },
  defaultConfig: {
    __gsm_format: "ini",
    SERVER: {
      NAME: "{{SERVER_NAME}}",
      CARS: "{{CARS}}",
      CONFIG_TRACK: "{{CONFIG_TRACK}}",
      TRACK: "{{TRACK}}",
      SUN_ANGLE: "{{SUN_ANGLE}}",
      PASSWORD: "{{SERVER_PASSWORD}}",
      ADMIN_PASSWORD: "{{ADMIN_PASSWORD}}",
      UDP_PORT: "{{PORT}}",
      TCP_PORT: "{{PORT}}",
      HTTP_PORT: "{{HTTP_PORT}}",
      MAX_CLIENTS: "{{MAX_PLAYERS}}",
      REGISTER_TO_LOBBY: "{{REGISTER_TO_LOBBY}}",
      PICKUP_MODE_ENABLED: "{{PICKUP_MODE_ENABLED}}",
      LOOP_MODE: "{{LOOP_MODE}}",
      LOCKED_ENTRY_LIST: "{{LOCKED_ENTRY_LIST}}",
      SLEEP_TIME: "{{SLEEP_TIME}}",
      CLIENT_SEND_INTERVAL_HZ: "{{CLIENT_SEND_INTERVAL_HZ}}",
      SEND_BUFFER_SIZE: "{{SEND_BUFFER_SIZE}}",
      RECV_BUFFER_SIZE: "{{RECV_BUFFER_SIZE}}",
      RACE_OVER_TIME: "{{RACE_OVER_TIME}}",
      RACE_PIT_WINDOW_START: "{{RACE_PIT_WINDOW_START}}",
      RACE_PIT_WINDOW_END: "{{RACE_PIT_WINDOW_END}}",
      RACE_EXTRA_LAP: "{{RACE_EXTRA_LAP}}",
      RACE_GAS_PENALTY_DISABLED: "{{RACE_GAS_PENALTY_DISABLED}}",
      RESULT_SCREEN_TIME: "{{RESULT_SCREEN_TIME}}",
      REVERSED_GRID_RACE_POSITIONS: "{{REVERSED_GRID_RACE_POSITIONS}}",
      QUALIFY_MAX_WAIT_PERC: "{{QUALIFY_MAX_WAIT_PERC}}",
      MAX_BALLAST_KG: "{{MAX_BALLAST_KG}}",
      KICK_QUORUM: "{{KICK_QUORUM}}",
      VOTING_QUORUM: "{{VOTING_QUORUM}}",
      VOTE_DURATION: "{{VOTE_DURATION}}",
      BLACKLIST_MODE: "{{BLACKLIST_MODE}}",
      MAX_CONTACTS_PER_KM: "{{MAX_CONTACTS_PER_KM}}",
      FUEL_RATE: "{{FUEL_RATE}}",
      DAMAGE_MULTIPLIER: "{{DAMAGE_MULTIPLIER}}",
      TYRE_WEAR_RATE: "{{TYRE_WEAR_RATE}}",
      ALLOWED_TYRES_OUT: "{{ALLOWED_TYRES_OUT}}",
      ABS_ALLOWED: "{{ABS_ALLOWED}}",
      TC_ALLOWED: "{{TC_ALLOWED}}",
      STABILITY_ALLOWED: "{{STABILITY_ALLOWED}}",
      AUTOCLUTCH_ALLOWED: "{{AUTOCLUTCH_ALLOWED}}",
      TYRE_BLANKETS_ALLOWED: "{{TYRE_BLANKETS_ALLOWED}}",
      FORCE_VIRTUAL_MIRROR: "{{FORCE_VIRTUAL_MIRROR}}",
      START_RULE: "{{START_RULE}}",
      TIME_OF_DAY_MULT: "{{TIME_OF_DAY_MULT}}",
      LEGAL_TYRES: "{{LEGAL_TYRES}}",
      UDP_PLUGIN_LOCAL_PORT: "{{UDP_PLUGIN_LOCAL_PORT}}",
      UDP_PLUGIN_ADDRESS: "{{UDP_PLUGIN_ADDRESS}}",
      AUTH_PLUGIN_ADDRESS: "{{AUTH_PLUGIN_ADDRESS}}",
    },
    PRACTICE: {
      NAME: "Practice",
      TIME: "{{PRACTICE_TIME}}",
      IS_OPEN: "{{PRACTICE_IS_OPEN}}",
    },
    QUALIFY: {
      NAME: "Qualify",
      TIME: "{{QUALIFY_TIME}}",
      IS_OPEN: "{{QUALIFY_IS_OPEN}}",
    },
    RACE: {
      NAME: "Race",
      LAPS: "{{RACE_LAPS}}",
      TIME: "{{RACE_TIME}}",
      WAIT_TIME: "{{RACE_WAIT_TIME}}",
      IS_OPEN: "{{RACE_IS_OPEN}}",
    },
    DYNAMIC_TRACK: {
      SESSION_START: "{{DYNAMIC_TRACK_SESSION_START}}",
      RANDOMNESS: "{{DYNAMIC_TRACK_RANDOMNESS}}",
      SESSION_TRANSFER: "{{DYNAMIC_TRACK_SESSION_TRANSFER}}",
      LAP_GAIN: "{{DYNAMIC_TRACK_LAP_GAIN}}",
    },
    WEATHER_0: {
      GRAPHICS: "{{WEATHER_GRAPHICS}}",
      BASE_TEMPERATURE_AMBIENT: "{{WEATHER_BASE_TEMP_AMBIENT}}",
      BASE_TEMPERATURE_ROAD: "{{WEATHER_BASE_TEMP_ROAD}}",
      VARIATION_AMBIENT: "{{WEATHER_VARIATION_AMBIENT}}",
      VARIATION_ROAD: "{{WEATHER_VARIATION_ROAD}}",
    },
  },
};
