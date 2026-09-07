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
  /**
   * 32-bit server (e.g. the Source srcds_run family). On x86_64 hosts the
   * i386 multiarch libs must be installed or the server dies at start with
   * a missing-lib error; when set, the script warns loudly instead.
   */
  i386?: boolean;
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
## {{STEAMCMD_PATH}} is substituted by the install route from the node's
## steamcmd_path; without it (custom flows, tests) the classic default holds.
STEAMCMD_PATH="{{STEAMCMD_PATH}}"
[ -z "$STEAMCMD_PATH" ] && STEAMCMD_PATH="/opt/steamcmd"
STEAMCMD_BIN="$STEAMCMD_PATH/steamcmd.sh"
if [ ! -x "$STEAMCMD_BIN" ]; then
  echo "SteamCMD is not installed at $STEAMCMD_BIN (set the node's SteamCMD path or put SteamCMD at /opt/steamcmd)" >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR/.steam/sdk32" "$INSTALL_DIR/.steam/sdk64"${extraDirs}
## Only meaningful when the script runs as root (the panel may install as the
## service user, in which case the files are already owned correctly).
if [ "$(id -u)" = "0" ]; then
  chown -R "$(id -un)":"$(id -gn)" "$INSTALL_DIR" 2>/dev/null || true
fi
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
cp -v "$STEAMCMD_PATH/linux32/steamclient.so" "$INSTALL_DIR/.steam/sdk32/steamclient.so" 2>/dev/null || true
cp -v "$STEAMCMD_PATH/linux64/steamclient.so" "$INSTALL_DIR/.steam/sdk64/steamclient.so" 2>/dev/null || true
${opts.i386 ? `## 32-bit servers (srcds_run) need the i386 multiarch libs on x86_64 hosts
if [ "$(uname -m)" = "x86_64" ] && [ "$(getconf LONG_BIT)" = "64" ]; then
  if command -v dpkg >/dev/null 2>&1 && ! dpkg --print-foreign-architectures 2>/dev/null | grep -qx i386; then
    echo "WARNING: this server is 32-bit but the i386 architecture is not enabled." >&2
    echo "         On Debian/Ubuntu run:  sudo dpkg --add-architecture i386 && sudo apt-get update && sudo apt-get install -y lib32gcc-s1 lib32stdc++6" >&2
    echo "         The server may fail to start until these 32-bit libraries exist." >&2
  elif command -v dnf >/dev/null 2>&1 && ! dnf list installed glibc.i686 >/dev/null 2>&1; then
    echo "WARNING: this server is 32-bit - install the i686 userspace (dnf install glibc.i686 libstdc++.i686) or the server will not start." >&2
  fi
fi` : ""}
${opts.post ? `\n${opts.post}\n` : ""}
echo "${opts.name} server installed successfully"`;
}
