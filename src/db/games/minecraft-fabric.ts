import { V, group, COMMON_VARS, type GameTemplate } from "./types";
import {
  JAVA_RUNTIME_VARS,
  WORLD_VARS,
  GAMEPLAY_VARS,
  PERFORMANCE_VARS,
  SECURITY_VARS,
  NETWORK_VARS,
  RCON_VARS,
  SERVER_PROPERTIES_CONFIG,
  ENSURE_JAVA_FN,
} from "./minecraft-shared";

// Fabric (the lightweight mod loader) installs through the official
// fabric-installer, resolved from meta.fabricmc.net. The installer produces
// fabric-server-launch.jar, which is how the server starts. Like NeoForge,
// the 26.x line (Minecraft year-based) needs Java 25, older lines Java 21.
export const minecraftFabric: GameTemplate = {
  slug: "minecraft-fabric",
  name: "Minecraft: Fabric",
  engine: "Java (Fabric)",
  defaultPort: 25565,
  steamAppId: null,
  iconEmoji: "🧶",
  supportsIpv6: true,
  category: "Minecraft",
  description: "Lightweight mod loader — run modded Minecraft servers on the Fabric loader",
  estimatedSize: "~700 MB",
  variables: [
    ...COMMON_VARS,

    ...group("Fabric", [
      V("Fabric Loader", "FABRIC_LOADER", "Exact loader version (e.g. 0.19.5); empty = latest stable from meta.fabricmc.net", "", { required: false }),
      V("Minecraft Version", "MC_VERSION", "Exact Minecraft version (e.g. 26.2); empty = latest stable release", "", { required: false }),
    ]),

    ...JAVA_RUNTIME_VARS,
    ...WORLD_VARS,
    ...GAMEPLAY_VARS,
    ...PERFORMANCE_VARS,
    ...SECURITY_VARS,
    ...NETWORK_VARS,
    ...RCON_VARS,
  ],

  installScript: `#!/bin/bash
set -e
INSTALL_DIR="{{INSTALL_PATH}}"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

## Resolve the latest STABLE loader, Minecraft version and installer from the
## official Fabric meta API (entries are newest-first; the stable flag is part
## of each entry).
echo "Resolving latest stable Fabric versions..."
META_LOADER=$(curl -fsSL --retry 8 --retry-delay 3 "https://meta.fabricmc.net/v2/versions/loader")
META_GAME=$(curl -fsSL --retry 8 --retry-delay 3 "https://meta.fabricmc.net/v2/versions/game")
META_INSTALLER=$(curl -fsSL --retry 8 --retry-delay 3 "https://meta.fabricmc.net/v2/versions/installer")

FLAT_LOADER=$(printf '%s' "$META_LOADER" | tr -d '\\n ')
FLAT_GAME=$(printf '%s' "$META_GAME" | tr -d '\\n ')
FLAT_INSTALLER=$(printf '%s' "$META_INSTALLER" | tr -d '\\n ')

FABRIC_LOADER="{{FABRIC_LOADER}}"
if [ -z "$FABRIC_LOADER" ]; then
  FABRIC_LOADER=$(printf '%s' "$FLAT_LOADER" | grep -oP '"version":"\\K[^"]+(?="[^}]*?"stable":true)' | head -1)
fi
MC_VERSION="{{MC_VERSION}}"
if [ -z "$MC_VERSION" ]; then
  MC_VERSION=$(printf '%s' "$FLAT_GAME" | grep -oP '"version":"\\K[^"]+(?="[^}]*?"stable":true)' | head -1)
fi
INSTALLER_URL=$(printf '%s' "$FLAT_INSTALLER" | grep -oP '"url":"\\K[^"]+(?="[^}]*?"stable":true)' | head -1)

if [ -z "$FABRIC_LOADER" ] || [ -z "$MC_VERSION" ] || [ -z "$INSTALLER_URL" ]; then
  echo "ERROR: could not resolve Fabric versions (loader: \${FABRIC_LOADER:-none}, game: \${MC_VERSION:-none})" >&2
  exit 1
fi
echo "Fabric loader: $FABRIC_LOADER — Minecraft: $MC_VERSION"

## The 26.x loaders target Minecraft's year-based releases (Java 25); older
## lines (1.21.x and before) run on Java 21.
case "$MC_VERSION" in
  26.*) MIN_JAVA=25 ;;
  *)    MIN_JAVA=21 ;;
esac

${ENSURE_JAVA_FN}

## Install/verify the required runtime (server-local Temurin when the host's
## Java is too old and apt cannot provide one).
ensure_java "$MIN_JAVA"

## Prefer a server-local runtime once ensure_java installed one (the installer
## runs during install).
if [ -x "$INSTALL_DIR/.java/bin/java" ]; then
  export PATH="$INSTALL_DIR/.java/bin:$PATH"
fi
JAVA_BIN=$(command -v java || true)
if [ -z "$JAVA_BIN" ]; then
  echo "ERROR: no Java runtime available" >&2
  exit 1
fi

## Download the official installer and run it headless in server mode; it
## writes fabric-server-launch.jar + server.jar and the libraries.
INSTALLER_NAME=$(basename "$INSTALLER_URL")
echo "Downloading Fabric installer: $INSTALLER_URL"
curl -fSL --retry 8 --retry-delay 3 -o "$INSTALLER_NAME" "$INSTALLER_URL"
echo "Running the Fabric installer (loader $FABRIC_LOADER, Minecraft $MC_VERSION)..."
"$JAVA_BIN" -jar "$INSTALLER_NAME" server -dir . -mcversion "$MC_VERSION" -loader "$FABRIC_LOADER" -downloadMinecraft
rm -f "$INSTALLER_NAME"

if [ ! -f fabric-server-launch.jar ] || [ ! -f server.jar ]; then
  echo "ERROR: the Fabric installer did not produce fabric-server-launch.jar / server.jar" >&2
  exit 1
fi

## Accept the Minecraft EULA (the server refuses to start without it).
echo "eula=true" > eula.txt

echo "Minecraft Fabric server installed successfully"
`,

  startCommand: `cd {{INSTALL_PATH}} && if [ -x ./.java/bin/java ]; then export PATH="$PWD/.java/bin:$PATH"; fi && exec java -Xms{{MIN_RAM}}G -Xmx{{MAX_RAM}}G {{JVM_FLAGS}} -jar fabric-server-launch.jar nogui --port {{PORT}}`,
  stopCommand: "stop",
  configFiles: { "server.properties": "server.properties" },
  defaultConfig: SERVER_PROPERTIES_CONFIG,
};
