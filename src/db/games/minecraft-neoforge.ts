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

// NeoForge (the mod loader forked from Forge) installs through its official
// installers on maven.neoforged.net — the loader jar is built per Minecraft
// version. Version profile: 26.x follows Minecraft's year-based numbering
// (Minecraft 26.2 -> NeoForge 26.2.0.82) and needs Java 25; the older 21.x
// line (Minecraft 1.21.x) runs on Java 21.
export const minecraftNeoForge: GameTemplate = {
  slug: "minecraft-neoforge",
  name: "Minecraft: NeoForge",
  engine: "Java (NeoForge)",
  defaultPort: 25565,
  steamAppId: null,
  iconEmoji: "🧩",
  supportsIpv6: true,
  category: "Minecraft",
  description: "Forge's modern successor — runs modded Minecraft servers on the NeoForge loader",
  estimatedSize: "~700 MB",
  variables: [
    ...COMMON_VARS,

    ...group("NeoForge", [
      V("NeoForge Version", "NEOFORGE_VERSION", "Exact loader version to install (e.g. 26.2.0.82); empty = latest stable from the official Maven", "", { required: false }),
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

## Resolve the NeoForge version: pinned when set, otherwise the latest
## stable release from the official Maven metadata (release channel only —
## -beta / -alpha / -rc builds are skipped).
NEOFORGE_VERSION="{{NEOFORGE_VERSION}}"
if [ -z "$NEOFORGE_VERSION" ]; then
  echo "Resolving latest stable NeoForge release..."
  METADATA=$(curl -fsSL --retry 8 --retry-delay 3 "https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml")
  NEOFORGE_VERSION=$(echo "$METADATA" | grep -oP '(?<=<version>)[^<]+' | grep -vE -- '-beta|-alpha|-rc' | sort -V | tail -1)
fi
if [ -z "$NEOFORGE_VERSION" ]; then
  echo "ERROR: could not determine a NeoForge version" >&2
  exit 1
fi
echo "NeoForge version: $NEOFORGE_VERSION"

## The 26.x loaders target Minecraft's year-based releases (Java 25); the
## 21.x line (Minecraft 1.21.x) runs on Java 21.
case "$NEOFORGE_VERSION" in
  26.*) MIN_JAVA=25 ;;
  *)    MIN_JAVA=21 ;;
esac

${ENSURE_JAVA_FN}

## Install/verify the required runtime (server-local Temurin when the host's
## Java is too old and apt cannot provide one).
ensure_java "$MIN_JAVA"

## Prefer a server-local runtime once ensure_java installed one (the loader
## runs during install).
if [ -x "$INSTALL_DIR/.java/bin/java" ]; then
  export PATH="$INSTALL_DIR/.java/bin:$PATH"
fi
JAVA_BIN=$(command -v java || true)
if [ -z "$JAVA_BIN" ]; then
  echo "ERROR: no Java runtime available" >&2
  exit 1
fi

## Download the official installer and run it headless. It fetches the
## matching Minecraft server + NeoForge libraries into ./libraries.
BASE="https://maven.neoforged.net/releases/net/neoforged/neoforge"
INSTALLER="neoforge-$NEOFORGE_VERSION-installer.jar"
echo "Downloading NeoForge installer: $BASE/$NEOFORGE_VERSION/$INSTALLER"
curl -fSL --retry 8 --retry-delay 3 -o "$INSTALLER" "$BASE/$NEOFORGE_VERSION/$INSTALLER"
echo "Running the NeoForge installer ($NEOFORGE_VERSION)..."
"$JAVA_BIN" -jar "$INSTALLER" --installServer
rm -f "$INSTALLER"

## run.sh is the loader launcher created by the installer; it reads
## user_jvm_args.txt and passes extra arguments (nogui) straight through.
if [ ! -f run.sh ] || [ ! -f "libraries/net/neoforged/neoforge/$NEOFORGE_VERSION/unix_args.txt" ]; then
  echo "ERROR: the NeoForge installer did not produce run.sh / unix_args.txt" >&2
  exit 1
fi
chmod +x run.sh

## The panel owns the JVM heap: overwrite the installer's template with our
## settings (each JVM flag on its own line, as Forge's args file expects).
{
  echo "-Xms{{MIN_RAM}}G"
  echo "-Xmx{{MAX_RAM}}G"
  echo "{{JVM_FLAGS}}" | tr ' ' '\\n' | grep -v '^$' || true
} > user_jvm_args.txt

## Accept the Minecraft EULA (the server refuses to start without it).
echo "eula=true" > eula.txt

echo "Minecraft NeoForge server installed successfully"
`,

  startCommand: `cd {{INSTALL_PATH}} && if [ -x ./.java/bin/java ]; then export PATH="$PWD/.java/bin:$PATH"; fi && exec bash run.sh nogui`,
  stopCommand: "stop",
  configFiles: { "server.properties": "server.properties" },
  defaultConfig: SERVER_PROPERTIES_CONFIG,
};
