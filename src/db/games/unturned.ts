import { V, group, STEAM_VARS, STEAMCMD_VAR, type GameTemplate } from "./types";
import { steamInstallScript } from "./steamcmd";

// Unturned dedicated server. The server name on the command line
// (+InternetServer/<dir>) decides its Servers/<dir>/Server/ folder, which is
// why the config files are written by the install script (variable-in-path
// config files are not supported by the panel renderer) — an acknowledged
// exception to the usual "panel writes the config" rule.
export const unturned: GameTemplate = {
  slug: "unturned",
  name: "Unturned",
  engine: "Unity",
  defaultPort: 27015,
  steamAppId: "1110390",
  iconEmoji: "🧟",
  supportsIpv6: true,
  category: "Survival",
  description: "Nelson's blocky zombie survival — dedicated server",
  estimatedSize: "~6 GB",
  variables: [
    ...STEAM_VARS,
    STEAMCMD_VAR,

    ...group("Server Instance", [
      V("Server Directory", "SERVER_DIR", "Folder name under Servers/ (also the +InternetServer/ instance name)", "MyServer", { required: false }),
      V("Map", "MAP", "Map to load (PEI, Washington, Russia, …)", "PEI", { required: false }),
      V("Mode", "MODE", "Game mode", "Normal", {
        required: false, type: "select",
        enum_values: { Normal: "Normal", Easy: "Easy", Hard: "Hard", Gold: "Gold" },
      }),
      V("Perspective", "PERSPECTIVE", "Camera perspective for players", "Both", {
        required: false, type: "select",
        enum_values: { First: "First", Third: "Third", Both: "Both" },
      }),
      V("Cheats", "CHEATS", "Enable admin cheat commands", "0", { required: false, type: "boolean" }),
      V("Password", "PASSWORD", "Password required to join, empty = public", "", { required: false, type: "password" }),
      V("GSLT Token", "GSLT_TOKEN", "Game Server Login Token for the internet server list", "", { required: false, type: "password" }),
    ]),
  ],

  installScript: steamInstallScript({
    appId: "1110390",
    name: "Unturned",
    platform: "linux",
    post: `## Unturned creates Servers/<name>/Server/ the first time it runs; we
## pre-create it and write the config the panel owns. Commands.dat is the
## basic settings file, Config.json carries the Steam auth token. (The
## panel's config renderer cannot put variables in file paths, so these are
## written here instead — the exception noted in the template header.)
SERVER_DIR="{{SERVER_DIR}}"
mkdir -p "$INSTALL_DIR/Servers/$SERVER_DIR/Server"
cat > "$INSTALL_DIR/Servers/$SERVER_DIR/Server/Commands.dat" <<EOF
Name {{SERVER_NAME}}
Map {{MAP}}
MaxPlayers {{MAX_PLAYERS}}
Mode {{MODE}}
Perspective {{PERSPECTIVE}}
Cheats {{CHEATS}}
Password {{PASSWORD}}
EOF
cat > "$INSTALL_DIR/Servers/$SERVER_DIR/Server/Config.json" <<EOF
{
  "Gameplay": {
    "GSLT": "{{GSLT_TOKEN}}"
  }
}
EOF
echo "Unturned server config written"`,
  }),

  startCommand: `cd {{INSTALL_PATH}} && ./Unturned_Headless.x86_64 -batchmode -nographics -bind 0.0.0.0 -port {{PORT}} "+InternetServer/{{SERVER_DIR}}"`,
  stopCommand: "shutdown",
  configFiles: {},
  defaultConfig: {},
};
