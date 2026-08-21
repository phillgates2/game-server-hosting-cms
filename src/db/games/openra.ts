import { V, group, COMMON_VARS, type GameTemplate } from "./types";

// OpenRA's dedicated server takes every option as a Name=Value launch argument
// (Server.Name, Server.ListenPort, ...) rather than a config file.
export const openra: GameTemplate = {
  slug: "openra",
  name: "OpenRA",
  engine: "OpenRA",
  defaultPort: 1234,
  steamAppId: null,
  iconEmoji: "\u{1F6E1}\uFE0F",
  supportsIpv6: false,
  category: "Classic",
  description: "Open-source Command & Conquer engine",
  estimatedSize: "~500 MB",
  variables: [
    ...COMMON_VARS,

    ...group("Mod & Map", [
      V("Game Mod", "GAME_MOD", "Which classic RTS the server hosts", "ra", {
        required: false, type: "select",
        enum_values: { ra: "Red Alert", cnc: "Tiberian Dawn", d2k: "Dune 2000" },
      }),
      V("Map", "MAP", "Map UID or name loaded on start, empty = default", "", { required: false }),
      V("Advertise Online", "ADVERTISE_ONLINE", "List the server in the in-game browser", "true", { required: false, type: "boolean" }),
      V("Password", "PASSWORD", "Password required to join, empty = public", "", { required: false, type: "password" }),
    ]),

    ...group("Match Rules", [
      V("Enable Single Player", "ENABLE_SINGLE_PLAYER", "Allow the match to start with one human player", "false", { required: false, type: "boolean" }),
      V("Dedicated Loop", "DEDICATED_LOOP", "Restart the server automatically after each match", "true", { required: false, type: "boolean" }),
      V("Recording", "RECORD_REPLAYS", "Save a replay of every match", "false", { required: false, type: "boolean" }),
      V("Enable GeoIP", "ENABLE_GEOIP", "Show player countries using the GeoIP database", "true", { required: false, type: "boolean" }),
      V("Share Anonymised IPs", "SHARE_ANONYMIZED_IPS", "Share hashed IPs with the master server for moderation", "true", { required: false, type: "boolean" }),
      V("Require Authentication", "REQUIRE_AUTHENTICATION", "Only allow players with an OpenRA forum account", "false", { required: false, type: "boolean" }),
      V("Profile IDs Whitelist", "PROFILE_ID_WHITELIST", "Comma-separated forum profile IDs allowed to join", "", { required: false }),
      V("Profile IDs Blacklist", "PROFILE_ID_BLACKLIST", "Comma-separated forum profile IDs banned from joining", "", { required: false }),
    ]),

    ...group("Timing & Network", [
      V("Timestep", "TIMESTEP", "Milliseconds per simulation tick", "40", {
        required: false, type: "number", min_value: 10, max_value: 200,
      }),
      V("Order Latency", "ORDER_LATENCY", "Network order buffer in ticks", "3", {
        required: false, type: "number", min_value: 1, max_value: 20,
      }),
      V("Floating Point Check", "FLOATING_POINT_CHECK", "Verify simulation determinism between clients", "false", { required: false, type: "boolean" }),
      V("Timeout", "TIMEOUT", "Milliseconds before a silent client is dropped", "10000", {
        required: false, type: "number", min_value: 1000, max_value: 120000,
      }),
      V("Ban Duration", "BAN_DURATION", "Minutes a kicked player is banned for, 0 = kick only", "0", {
        required: false, type: "number", min_value: 0, max_value: 100000,
      }),
    ]),
  ],

  installScript: `#!/bin/bash
set -e
INSTALL_DIR="{{INSTALL_PATH}}"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

GAME_MOD="{{GAME_MOD}}"
RELEASE=$(curl -sSL https://api.github.com/repos/OpenRA/OpenRA/releases/latest | grep tag_name | cut -d '"' -f4)
echo "Latest OpenRA release: $RELEASE"

# Pick the correct upstream asset name for the selected mod.
case "$GAME_MOD" in
  ra)  ASSET_NAME="OpenRA-Red-Alert-x86_64.AppImage" ;;
  cnc) ASSET_NAME="OpenRA-Tiberian-Dawn-x86_64.AppImage" ;;
  d2k) ASSET_NAME="OpenRA-Dune-2000-x86_64.AppImage" ;;
  *)
    echo "Unknown GAME_MOD: $GAME_MOD"
    exit 1
    ;;
esac

APPIMAGE_URL="https://github.com/OpenRA/OpenRA/releases/download/$RELEASE/$ASSET_NAME"
echo "Downloading OpenRA asset: $APPIMAGE_URL"
curl -fL -o OpenRA.AppImage "$APPIMAGE_URL"
chmod +x OpenRA.AppImage

# Keep the AppImage itself — it can run the dedicated server directly with --server.
# Also extract a fallback runtime tree for environments without FUSE.
echo "Extracting AppImage fallback..."
./OpenRA.AppImage --appimage-extract >/dev/null 2>&1 || true
if [ -d "squashfs-root" ]; then
  mv squashfs-root openra-extracted
fi

# Validate that we have something runnable.
if [ ! -f OpenRA.AppImage ] && [ ! -f openra-extracted/AppRun ]; then
  echo "OpenRA server runtime not found after download/extract"
  exit 1
fi

echo "OpenRA installed successfully"`,

  startCommand: `cd {{INSTALL_PATH}} && if [ -x ./OpenRA.AppImage ]; then RUNNER=./OpenRA.AppImage; elif [ -x ./openra-extracted/AppRun ]; then RUNNER=./openra-extracted/AppRun; else echo "OpenRA runtime missing" >&2; exit 1; fi && exec "$RUNNER" --server Game.Mod={{GAME_MOD}} Server.Name="{{SERVER_NAME}}" Server.ListenPort={{PORT}} Server.AdvertiseOnline={{ADVERTISE_ONLINE}} Server.Password="{{PASSWORD}}" Server.Map="{{MAP}}" Server.EnableSingleplayer={{ENABLE_SINGLE_PLAYER}} Server.RecordReplays={{RECORD_REPLAYS}} Server.EnableGeoIP={{ENABLE_GEOIP}} Server.ShareAnonymizedIPs={{SHARE_ANONYMIZED_IPS}} Server.RequireAuthentication={{REQUIRE_AUTHENTICATION}} Server.ProfileIDWhitelist="{{PROFILE_ID_WHITELIST}}" Server.ProfileIDBlacklist="{{PROFILE_ID_BLACKLIST}}" Server.Timestep={{TIMESTEP}} Server.OrderLatency={{ORDER_LATENCY}} Server.FloatingPointCheck={{FLOATING_POINT_CHECK}} Server.TimeOut={{TIMEOUT}} Server.BanDuration={{BAN_DURATION}} Server.DedicatedLoop={{DEDICATED_LOOP}}`,
  stopCommand: null,
  // OpenRA is configured entirely through launch arguments — there is no server
  // config file to generate.
  configFiles: {},
  defaultConfig: {},
};
