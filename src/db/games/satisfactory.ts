import { V, group, STEAM_VARS, type GameTemplate } from "./types";
import { steamInstallScript } from "./steamcmd";

// Satisfactory splits server options between ServerSettings.ini (subsystem
// flags) and GameUserSettings.ini (the mIntValues/mFloatValues arrays the
// in-game Server Manager writes).
export const satisfactory: GameTemplate = {
  slug: "satisfactory",
  name: "Satisfactory",
  engine: "Unreal Engine 5",
  defaultPort: 7777,
  steamAppId: "1690800",
  iconEmoji: "🏭",
  supportsIpv6: true,
  category: "Sandbox",
  description: "Factory building and automation",
  estimatedSize: "~15 GB",
  variables: [
    ...STEAM_VARS,

    ...group("Session", [
      V("Beacon Port", "BEACON_PORT", "UE beacon port used during initial connection", "15000", {
        required: false, type: "number", min_value: 1, max_value: 65535,
      }),
      V("Reliable Port", "RELIABLE_PORT", "Reliable messaging port (1.1+ uses a single port by default)", "8888", {
        required: false, type: "number", min_value: 1, max_value: 65535,
      }),
      V("Auto Load Session", "AUTO_LOAD_SESSION_NAME", "Save game loaded on boot, empty = most recent", "", { required: false }),
      V("Server Restart Time", "SERVER_RESTART_TIME_SLOT", "Daily restart time as HH:MM:SS, empty = never", "", { required: false }),
      V("Admin Password", "ADMIN_PASSWORD", "Password for server administration", "", { required: false, type: "password" }),
      V("Client Password", "CLIENT_PASSWORD", "Password required to join, empty = public", "", { required: false, type: "password" }),
    ]),

    ...group("Gameplay", [
      // Written to both ServerSettings.ini and the packed mIntValues array, so
      // these are numeric selects: Unreal's bool parser accepts 1/0 in ini files.
      V("Auto Pause", "AUTO_PAUSE", "Pause the simulation when no players are connected", "1", {
        required: false, type: "select", enum_values: { "1": "Enabled", "0": "Disabled (24/7 factory)" },
      }),
      V("Auto Save On Disconnect", "AUTO_SAVE_ON_DISCONNECT", "Force a save when the last player leaves", "1", {
        required: false, type: "select", enum_values: { "1": "Enabled", "0": "Disabled" },
      }),
      V("Autosave Interval", "AUTOSAVE_INTERVAL", "Seconds between autosaves", "300", {
        required: false, type: "number", min_value: 30, max_value: 7200,
      }),
      V("Autosave Number", "AUTOSAVE_NUMBER", "Rotating autosave slots to keep", "5", {
        required: false, type: "number", min_value: 1, max_value: 50,
      }),
      V("Disable Seasonal Events", "DISABLE_SEASONAL_EVENTS", "Turn off FICSMAS and other seasonal content", "0", {
        required: false, type: "select", enum_values: { "0": "Seasonal events enabled", "1": "Seasonal events disabled" },
      }),
      V("Send Gameplay Data", "SEND_GAMEPLAY_DATA", "Send anonymous gameplay telemetry to Coffee Stain", "false", { required: false, type: "boolean" }),
    ]),

    ...group("Performance", [
      V("Network Quality", "NETWORK_QUALITY", "State sync frequency — Ultra is recommended on a dedicated box", "3", {
        required: false, type: "select",
        enum_values: { "0": "0 — Low", "1": "1 — Medium", "2": "2 — High", "3": "3 — Ultra" },
      }),
      V("Max Tick Rate", "MAX_TICK_RATE", "Server simulation tick rate cap", "30", {
        required: false, type: "number", min_value: 5, max_value: 120,
      }),
      V("Use Packet Routing", "USE_PACKET_ROUTING", "Route traffic through Coffee Stain relays for NAT traversal", "false", { required: false, type: "boolean" }),
      V("Streaming Levels", "MAX_STREAMING_LEVELS", "Concurrent level streaming operations", "8", {
        required: false, type: "number", min_value: 1, max_value: 64,
      }),
    ]),
  ],

  installScript: steamInstallScript({
    appId: "1690800",
    name: "Satisfactory",
    post: `## Satisfactory reads its config from the Saved config directory
mkdir -p "$INSTALL_DIR/FactoryGame/Saved/Config/LinuxServer"`,
  }),

  startCommand: `cd {{INSTALL_PATH}} && ./Engine/Binaries/Linux/*-Linux-Shipping FactoryGame ?listen -Port={{PORT}} -ServerQueryPort={{QUERY_PORT}} -BeaconPort={{BEACON_PORT}} -ReliablePort={{RELIABLE_PORT}} -multihome=0.0.0.0 -log -unattended`,
  stopCommand: null,
  configFiles: {
    "FactoryGame/Saved/Config/LinuxServer/ServerSettings.ini": "ServerSettings.ini",
    "FactoryGame/Saved/Config/LinuxServer/GameUserSettings.ini": "GameUserSettings.ini",
    "FactoryGame/Saved/Config/LinuxServer/Engine.ini": "Engine.ini",
  },
  defaultConfig: {
    __files: {
      "FactoryGame/Saved/Config/LinuxServer/ServerSettings.ini": {
        __gsm_format: "ini",
        "/Script/FactoryGame.FGServerSubsystem": {
          mAutoPause: "{{AUTO_PAUSE}}",
          mAutoSaveOnDisconnect: "{{AUTO_SAVE_ON_DISCONNECT}}",
          mAutoLoadSessionName: "{{AUTO_LOAD_SESSION_NAME}}",
          mServerRestartTimeSlot: "{{SERVER_RESTART_TIME_SLOT}}",
          mUsePacketRouting: "{{USE_PACKET_ROUTING}}",
          mSendGameplayData: "{{SEND_GAMEPLAY_DATA}}",
          mDisableSeasonalEvents: "{{DISABLE_SEASONAL_EVENTS}}",
          mAutosaveInterval: "{{AUTOSAVE_INTERVAL}}",
          mAutosaveNumber: "{{AUTOSAVE_NUMBER}}",
          mNetworkQuality: "{{NETWORK_QUALITY}}",
          mAdminPassword: "{{ADMIN_PASSWORD}}",
          mClientPassword: "{{CLIENT_PASSWORD}}",
        },
      },
      "FactoryGame/Saved/Config/LinuxServer/GameUserSettings.ini": {
        __gsm_format: "ini",
        "/Script/FactoryGame.FGGameUserSettings": {
          // The engine stores these as a packed array — writing it here is what
          // actually makes auto-pause and network quality stick across restarts.
          mIntValues:
            '(("FG.DSAutoPause", {{AUTO_PAUSE}}),("FG.DSAutoSaveOnDisconnect", {{AUTO_SAVE_ON_DISCONNECT}}),("FG.NetworkQuality", {{NETWORK_QUALITY}}),("FG.DisableSeasonalEvents", {{DISABLE_SEASONAL_EVENTS}}))',
        },
      },
      "FactoryGame/Saved/Config/LinuxServer/Engine.ini": {
        __gsm_format: "ini",
        "/Script/OnlineSubsystemUtils.IpNetDriver": {
          MaxClientRate: "104857600",
          MaxInternetClientRate: "104857600",
          NetServerMaxTickRate: "{{MAX_TICK_RATE}}",
        },
        "/Script/Engine.Player": {
          ConfiguredInternetSpeed: "104857600",
          ConfiguredLanSpeed: "104857600",
        },
        "/Script/Engine.LevelStreaming": {
          MaxConcurrentStreamingLevels: "{{MAX_STREAMING_LEVELS}}",
        },
      },
    },
  },
};
