import { COMMON_VARS, type GameTemplate } from "./types";
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

// server.properties reference: https://minecraft.wiki/w/Server.properties
export const minecraftJava: GameTemplate = {
  slug: "minecraft-java",
  name: "Minecraft: Java Edition",
  engine: "Java",
  defaultPort: 25565,
  steamAppId: null,
  iconEmoji: "🧱",
  supportsIpv6: true,
  category: "Minecraft",
  description: "Official Minecraft Java server with vanilla gameplay",
  estimatedSize: "~500 MB",
  variables: [
    ...COMMON_VARS,
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

${ENSURE_JAVA_FN}

## Download latest Minecraft server JAR (piston-meta is the current Mojang API)
MANIFEST_URL="https://piston-meta.mojang.com/mc/game/version_manifest_v2.json"
MANIFEST=$(curl -fsSL --retry 3 "$MANIFEST_URL")
LATEST=$(echo "$MANIFEST" | grep -oP '"release"\\s*:\\s*"\\K[^"]+' | head -1)
echo "Latest Minecraft version: $LATEST"
if [ -z "$LATEST" ]; then
  echo "ERROR: could not determine latest Minecraft release" >&2
  exit 1
fi

VERSION_JSON_URL=$(echo "$MANIFEST" | grep -oP '"id":\\s*"'"$LATEST"'".{0,500}?"url":\\s*"\\Khttps?://[^"]+' | head -1)
VERSION_JSON=$(curl -fsSL "$VERSION_JSON_URL")
SERVER_URL=$(echo "$VERSION_JSON" | grep -oP '"server"\\s*:\\s*\\{[^}]*"url"\\s*:\\s*"\\K[^"]+' | head -1)
## Mojang spells this key "majorVersion" (camelCase) inside javaVersion.
## Accept the snake_case spelling too in case the API ever changes.
REQUIRED_JAVA=$(echo "$VERSION_JSON" | grep -oP '"majorVersion"\\s*:\\s*\\K[0-9]+' | head -1)
if [ -z "$REQUIRED_JAVA" ]; then
  REQUIRED_JAVA=$(echo "$VERSION_JSON" | grep -oP '"major_version"\\s*:\\s*\\K[0-9]+' | head -1)
fi
REQUIRED_JAVA=\${REQUIRED_JAVA:-21}

ensure_java "$REQUIRED_JAVA"

if [ -z "$SERVER_URL" ]; then
  echo "ERROR: could not resolve server.jar URL for $LATEST" >&2
  exit 1
fi

echo "Downloading Minecraft $LATEST server..."
curl -fSL --retry 3 -o server.jar "$SERVER_URL"

## Sanity-check the jar (must be a zip archive, > 1 MB)
JAR_SIZE=$(stat -c %s server.jar 2>/dev/null || echo 0)
if [ "$JAR_SIZE" -lt 1048576 ] || ! head -c 2 server.jar | grep -q "PK"; then
  echo "ERROR: server.jar looks invalid (size: $JAR_SIZE bytes)" >&2
  rm -f server.jar
  exit 1
fi

## Accept EULA
echo "eula=true" > eula.txt

echo "Minecraft Java server installed successfully"
`,

  startCommand: `cd {{INSTALL_PATH}} && if [ -x ./.java/bin/java ]; then JAVABIN=./.java/bin/java; else JAVABIN=java; fi && exec "$JAVABIN" -Xms{{MIN_RAM}}G -Xmx{{MAX_RAM}}G {{JVM_FLAGS}} -jar server.jar nogui --port {{PORT}}`,
  stopCommand: "stop",
  configFiles: { "server.properties": "server.properties" },
  defaultConfig: SERVER_PROPERTIES_CONFIG,
};
