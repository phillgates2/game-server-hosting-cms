import { V, group, COMMON_VARS, type GameTemplate } from "./types";

// Vintage Story 1.22.x dedicated server: the tar.gz from the official CDN is
// a .NET 10 apphost (VintagestoryServer). The runtime is NOT bundled, so the
// template installs a server-local .NET 10 runtime (same pattern as the
// TShock fix). Version is pinned: the CDN publishes no version-listing API
// (the download page is account/JS gated), so VS_VERSION is the knob and is
// bumped in releases.
export const vintageStory: GameTemplate = {
  slug: "vintage-story",
  name: "Vintage Story",
  engine: ".NET (Vintagestory)",
  defaultPort: 42420,
  steamAppId: null,
  iconEmoji: "🏞️",
  supportsIpv6: true,
  category: "Survival",
  description: "Survival in a brutal, beautiful block world — dedicated server",
  estimatedSize: "~700 MB",
  variables: [
    ...COMMON_VARS,

    ...group("Server", [
      V("Server Version", "VS_VERSION", "Vintage Story server version (e.g. 1.22.7)", "1.22.7", { required: false }),
      V("Save Name", "SAVE_NAME", "World/save name", "DefaultWorld", { required: false }),
      V("World Seed", "WORLD_SEED", "Seed for a new world, empty = random", "", { required: false }),
      V("Password", "PASSWORD", "Password required to join, empty = public", "", { required: false, type: "password" }),
    ]),
  ],

  installScript: `#!/bin/bash
set -e
INSTALL_DIR="{{INSTALL_PATH}}"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

VS_VERSION="{{VS_VERSION}}"
BASE="https://cdn.vintagestory.at/gamefiles/stable"
echo "Downloading Vintage Story $VS_VERSION server..."
curl -fSL --retry 5 --retry-delay 2 -o vs.tar.gz "$BASE/vs_server_linux-x64_$VS_VERSION.tar.gz"
if ! tar tzf vs.tar.gz > /dev/null 2>&1; then
  echo "ERROR: downloaded Vintage Story archive is corrupt" >&2
  rm -f vs.tar.gz
  exit 1
fi
tar xzf vs.tar.gz
rm -f vs.tar.gz

if [ ! -f VintagestoryServer ] || [ ! -f VintagestoryServer.dll ]; then
  echo "ERROR: VintagestoryServer missing after extraction" >&2
  exit 1
fi

## 1.22.x is a framework-dependent .NET 10 apphost (verified against the real
## asset: it demands 'Microsoft.NETCore.App, version 10.0.0'). Install a
## server-local runtime when the host has none.
ensure_dotnet() {
  if command -v dotnet >/dev/null 2>&1 && dotnet --list-runtimes 2>/dev/null | grep -q "Microsoft.NETCore.App 10"; then
    echo "System .NET 10 runtime detected - OK"
    return 0
  fi
  echo "Installing server-local .NET 10 runtime..."
  mkdir -p "$INSTALL_DIR/.dotnet"
  curl -fsSL --retry 5 --retry-delay 2 -o dotnet-install.sh https://dot.net/v1/dotnet-install.sh || {
    echo "WARNING: could not fetch dotnet-install.sh - Vintage Story needs the .NET 10 runtime to start" >&2
    return 1
  }
  bash dotnet-install.sh --channel 10.0 --runtime aspnetcore --install-dir "$INSTALL_DIR/.dotnet" || {
    echo "WARNING: server-local .NET install failed - Vintage Story will need a system .NET 10 runtime" >&2
    rm -f dotnet-install.sh
    return 1
  }
  rm -f dotnet-install.sh
  echo ".NET runtime installed into $INSTALL_DIR/.dotnet"
}
ensure_dotnet || true

## Data path (worlds, player data, serverconfig.json) stays in the install dir.
mkdir -p data

echo "Vintage Story $VS_VERSION server installed successfully"
`,

  startCommand: `cd {{INSTALL_PATH}} && if [ -x "{{INSTALL_PATH}}/.dotnet/dotnet" ]; then export DOTNET_ROOT="{{INSTALL_PATH}}/.dotnet"; export PATH="{{INSTALL_PATH}}/.dotnet:$PATH"; fi && exec ./VintagestoryServer --dataPath "{{INSTALL_PATH}}/data"`,
  stopCommand: "shutdown",
  configFiles: { "data/serverconfig.json": "serverconfig.json" },
  defaultConfig: {
    __gsm_format: "json",
    ServerName: "{{SERVER_NAME}}",
    Port: "{{PORT}}",
    MaxPlayers: "{{MAX_PLAYERS}}",
    Password: "{{PASSWORD}}",
    SaveName: "{{SAVE_NAME}}",
    WorldSeed: "{{WORLD_SEED}}",
    OpenPorts: true,
    AllowJoin: true,
    AllowCreative: false,
    AllowLandClaiming: true,
    AllowPvP: false,
    Whitelist: [],
  },
};
