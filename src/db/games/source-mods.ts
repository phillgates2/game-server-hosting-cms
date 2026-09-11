// Metamod:Source and SourceMod support for Source-engine servers.
//
// The four classic Source games here (TF2, CS:S, GMod, L4D2) share one
// modding flow: Metamod:Source is the plugin loader, and SourceMod (the
// admin/mod framework) requires it. The installer pulls the LATEST stable
// Linux build straight from AlliedModders' drop mirrors — the same
// "latest filename then download" pattern the Pterodactyl Source eggs use —
// so servers get current builds without the panel pinning a version.
//
// Layouts (real archives):
//   mmsource-*-linux.tar.gz  → addons/metamod/…          (extract into <game>/)
//   sourcemod-*-linux.tar.gz → addons/sourcemod, cfg/…   (extract into <game>/)
// The engine finds Metamod through <game>/addons/metamod.vdf, whose "file"
// value points at the loader binary relative to <game>/bin.

import { V, group, type TemplateVariable } from "./types";

/** The game subdirectory each Source title reads its addons from. */
export const SOURCE_GAME_DIRS: Record<string, string> = {
  tf2: "tf",
  "counter-strike-source": "cstrike",
  gmod: "garrysmod",
  l4d2: "left4dead2",
};

/** The "Modding" option group: one choice, no ambiguity about dependencies. */
export function sourceModVariables(): TemplateVariable[] {
  return group("Modding", [
    V("Mod Platform", "MOD_PLATFORM", "Install a mod platform during setup. SourceMod includes Metamod:Source, which it requires.", "none", {
      required: false,
      type: "select",
      enum_values: {
        none: "None — vanilla server",
        metamod: "Metamod:Source (plugin loader only)",
        sourcemod: "SourceMod + Metamod:Source (admin framework)",
      },
    }),
  ]);
}

/**
 * Install-script block appended to the Steam `post` step. `gameDir` is the
 * literal game subdirectory (baked in, not a placeholder) so the generated
 * script is self-contained.
 */
export function sourceModInstallBlock(gameDir: string): string {
  return `## ── Mod platform (Metamod:Source / SourceMod) ──────────────────────────
MOD_PLATFORM="{{MOD_PLATFORM}}"
if [ "$MOD_PLATFORM" = "metamod" ] || [ "$MOD_PLATFORM" = "sourcemod" ]; then
  MMS_BRANCH="1.12"
  echo "Installing Metamod:Source (latest $MMS_BRANCH stable)..."
  MMS_FILE="$(curl -fsSL "https://mms.alliedmods.net/mmsdrop/$MMS_BRANCH/mmsource-latest-linux" | tr -d '[:space:]')"
  [ -n "$MMS_FILE" ] || { echo "Could not resolve the latest Metamod build" >&2; exit 1; }
  curl -fsSL "https://mms.alliedmods.net/mmsdrop/$MMS_BRANCH/$MMS_FILE" -o "$INSTALL_DIR/mmsource.tar.gz"
  ## The archive's top level IS addons/metamod/, so extract into the game dir.
  tar -xzf "$INSTALL_DIR/mmsource.tar.gz" -C "$INSTALL_DIR/${gameDir}"
  rm -f "$INSTALL_DIR/mmsource.tar.gz"
  ## The engine loads Metamod via this vdf; "file" is relative to ${gameDir}/bin.
  cat > "$INSTALL_DIR/${gameDir}/addons/metamod.vdf" <<'VDF'
"Plugin"
{
	"file"	"../${gameDir}/addons/metamod/bin/server"
}
VDF
  echo "Metamod:Source installed."
fi
if [ "$MOD_PLATFORM" = "sourcemod" ]; then
  SM_BRANCH="1.12"
  echo "Installing SourceMod (latest $SM_BRANCH stable)..."
  SM_FILE="$(curl -fsSL "https://sm.alliedmods.net/smdrop/$SM_BRANCH/sourcemod-latest-linux" | tr -d '[:space:]')"
  [ -n "$SM_FILE" ] || { echo "Could not resolve the latest SourceMod build" >&2; exit 1; }
  curl -fsSL "https://sm.alliedmods.net/smdrop/$SM_BRANCH/$SM_FILE" -o "$INSTALL_DIR/sourcemod.tar.gz"
  ## The archive's top level holds addons/, cfg/ etc. — unpack into the game dir.
  tar -xzf "$INSTALL_DIR/sourcemod.tar.gz" -C "$INSTALL_DIR/${gameDir}"
  rm -f "$INSTALL_DIR/sourcemod.tar.gz"
  echo "SourceMod installed."
fi`;
}
