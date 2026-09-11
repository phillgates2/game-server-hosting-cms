import { V, group, COMMON_VARS, STEAMCMD_VAR, type GameTemplate } from "./types";
import { steamInstallScript } from "./steamcmd";

// Core Keeper dedicated server (AppID 1963720 — the store hides depot-only
// apps, so the wrong id (1005950, another game entirely) is a common trap).
// _launch.sh is the official entry point; -datapath keeps ServerConfig.json
// and the saves inside the install directory.
export const coreKeeper: GameTemplate = {
  slug: "core-keeper",
  name: "Core Keeper",
  engine: "Unity",
  defaultPort: 27015,
  steamAppId: "1963720",
  iconEmoji: "⛏️",
  supportsIpv6: true,
  category: "Survival",
  description: "Mine, build and farm your way out of the underground — dedicated server",
  estimatedSize: "~6 GB",
  variables: [
    ...COMMON_VARS,
    STEAMCMD_VAR,

    ...group("World", [
      V("Game ID", "GAME_ID", "Join code players use (23+ alphanumeric, no Y/y/x/0/O); empty = auto-generated", "", { required: false }),
      V("World Slot", "WORLD", "World save slot index (0-29)", "0", {
        required: false, type: "number", min_value: 0, max_value: 29,
      }),
      V("World Seed", "WORLD_SEED", "Seed for a new world, 0 = random", "0", {
        required: false, type: "number", min_value: 0, max_value: 2147483647,
      }),
      V("World Mode", "WORLD_MODE", "Game mode", "0", {
        required: false, type: "select",
        enum_values: { "0": "0 — Normal", "1": "1 — Hard", "2": "2 — Creative", "4": "4 — Casual" },
      }),
      V("Season", "SEASON", "Force a seasonal event override", "-1", {
        required: false, type: "select",
        enum_values: {
          "-1": "-1 — Current season",
          "0": "0 — None",
          "1": "1 — Easter",
          "2": "2 — Halloween",
          "3": "3 — Christmas",
          "4": "4 — Valentine's",
          "5": "5 — Anniversary",
          "6": "6 — Cherry Blossom",
          "7": "7 — Lunar New Year",
        },
      }),
      V("Password", "PASSWORD", "Password required to join (direct connect), empty = none", "", { required: false, type: "password" }),
    ]),
  ],

  installScript: steamInstallScript({
    appId: "1963720",
    name: "Core Keeper",
    platform: "linux",
    post: `## -datapath keeps ServerConfig.json + saves inside the install folder
mkdir -p "$INSTALL_DIR/DedicatedServer"`,
  }),

  startCommand: `cd {{INSTALL_PATH}} && bash _launch.sh -batchmode -logfile "{{INSTALL_PATH}}/CoreKeeperServerLog.txt" -datapath "{{INSTALL_PATH}}/DedicatedServer" -port {{PORT}} -world {{WORLD}} -worldname "{{SERVER_NAME}}" -worldseed {{WORLD_SEED}} -worldmode {{WORLD_MODE}} -gameid "{{GAME_ID}}" -season {{SEASON}} -maxplayers {{MAX_PLAYERS}} -password "{{PASSWORD}}"`,
  stopCommand: "exit",
  configFiles: { "DedicatedServer/ServerConfig.json": "ServerConfig.json" },
  defaultConfig: {
    __gsm_format: "json",
    gameId: "{{GAME_ID}}",
    world: "{{WORLD}}",
    worldName: "{{SERVER_NAME}}",
    worldSeed: "{{WORLD_SEED}}",
    maxNumberPlayers: "{{MAX_PLAYERS}}",
    maxNumberPacketsSentPerFrame: "1",
    networkSendRate: "30",
    worldMode: "{{WORLD_MODE}}",
    seasonOverride: "{{SEASON}}",
    password: "{{PASSWORD}}",
  },
};
