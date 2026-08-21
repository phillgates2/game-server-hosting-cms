// Shared SteamCMD install-script builder.
//
// Fourteen of the built-in templates installed via SteamCMD carried a
// byte-for-byte identical 30-line script with only the app id and display name
// changed. They now share this builder, so a fix to the retry/SDK logic lands
// on every Steam game at once.

export interface SteamInstallOptions {
  /** Steam application id passed to +app_update. */
  appId: string;
  /** Human-readable game name used in the progress output. */
  name: string;
  /** Force the Windows depot (games with no native Linux server, e.g. V Rising). */
  platform?: "linux" | "windows";
  /** Steam branch for +app_update -beta. */
  beta?: string;
  /** Password for a locked beta branch. */
  betaPassword?: string;
  /** Extra directories (relative to the install dir) created before install. */
  makeDirs?: string[];
  /** Bash appended after the install + SDK steps, before the success message. */
  post?: string;
  /** Bash inserted before SteamCMD runs — dependency checks and the like. */
  pre?: string;
}

/**
 * Build a SteamCMD install script.
 *
 * The generated script:
 *  - fails fast when SteamCMD is missing
 *  - retries app_update up to 3 times (Steam drops connections regularly)
 *  - installs the steamclient.so SDK shims most Source/Unity servers need
 *
 * It intentionally does not write game config files — the panel materializes
 * those from the template's `defaultConfig` once the script exits.
 */
export function steamInstallScript(opts: SteamInstallOptions): string {
  const betaFlags = opts.beta
    ? ` -beta ${opts.beta}${opts.betaPassword ? ` -betapassword ${opts.betaPassword}` : ""}`
    : "";
  const platformFlag =
    opts.platform === "windows" ? " +@sSteamCmdForcePlatformType windows" : "";
  const extraDirs = (opts.makeDirs || []).map((d) => ` "$INSTALL_DIR/${d}"`).join("");

  return `#!/bin/bash
set -e
INSTALL_DIR="{{INSTALL_PATH}}"
STEAM_APPID="${opts.appId}"
${opts.pre ? `\n${opts.pre}\n` : ""}
## Use system SteamCMD install (shared across servers)
STEAMCMD_BIN="/opt/steamcmd/steamcmd.sh"
if [ ! -x "$STEAMCMD_BIN" ]; then
  echo "SteamCMD is not installed at $STEAMCMD_BIN" >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR/.steam/sdk32" "$INSTALL_DIR/.steam/sdk64"${extraDirs}
chown -R $(whoami) "$INSTALL_DIR" 2>/dev/null || true
export HOME="$INSTALL_DIR"

## Install game server
echo "Installing ${opts.name} (AppID: $STEAM_APPID)..."
STEAMCMD_ATTEMPT=1
until "$STEAMCMD_BIN" +force_install_dir "$INSTALL_DIR" +login anonymous${platformFlag} +app_update $STEAM_APPID${betaFlags} validate +quit; do
  STEAMCMD_ATTEMPT=$((STEAMCMD_ATTEMPT + 1))
  if [ "$STEAMCMD_ATTEMPT" -gt 3 ]; then
    echo "ERROR: SteamCMD failed to install AppID $STEAM_APPID after 3 attempts" >&2
    exit 1
  fi
  echo "SteamCMD attempt failed, retrying ($STEAMCMD_ATTEMPT/3)..."
  sleep 10
done

## Set up Steam SDK libraries
cp -v "/opt/steamcmd/linux32/steamclient.so" "$INSTALL_DIR/.steam/sdk32/steamclient.so" 2>/dev/null || true
cp -v "/opt/steamcmd/linux64/steamclient.so" "$INSTALL_DIR/.steam/sdk64/steamclient.so" 2>/dev/null || true
${opts.post ? `\n${opts.post}\n` : ""}
echo "${opts.name} server installed successfully"`;
}
