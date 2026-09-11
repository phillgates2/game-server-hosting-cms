import { V, group, COMMON_VARS, type GameTemplate } from "./types";
import { JAVA_RUNTIME_VARS, ENSURE_JAVA_FN } from "./minecraft-shared";

// Mindustry runs from the official server-release.jar (GitHub releases).
// The console has no port setting on the command line, so the wrapper pipes
// "config port <p>" + "host" into it — then keeps relaying console input.
export const mindustry: GameTemplate = {
  slug: "mindustry",
  name: "Mindustry",
  engine: "Java",
  defaultPort: 6567,
  steamAppId: null,
  iconEmoji: "⚙️",
  supportsIpv6: true,
  category: "Sandbox",
  description: "Factory-building tower defence RTS — dedicated server",
  estimatedSize: "~300 MB",
  variables: [
    ...COMMON_VARS,
    ...JAVA_RUNTIME_VARS,

    ...group("Server", [
      V("Map", "MAP", "Map to host (Ancient Caldera, Maze, …); empty = randomized", "", { required: false }),
      V("Game Mode", "MODE", "Mode to host", "survival", {
        required: false, type: "select",
        enum_values: { survival: "Survival", attack: "Attack", pvp: "PvP", sandbox: "Sandbox" },
      }),
    ]),
  ],

  installScript: `#!/bin/bash
set -e
INSTALL_DIR="{{INSTALL_PATH}}"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

## Resolve the latest release and download the dedicated server jar.
RELEASE=$(curl -fsSL --retry 5 --retry-delay 2 https://api.github.com/repos/Anuken/Mindustry/releases/latest | grep -oP '"tag_name"\\s*:\\s*"\\K[^"]+' | head -1)
if [ -z "$RELEASE" ]; then
  echo "ERROR: could not resolve the latest Mindustry release" >&2
  exit 1
fi
echo "Mindustry release: $RELEASE"
curl -fSL --retry 5 --retry-delay 2 -o server-release.jar "https://github.com/Anuken/Mindustry/releases/download/$RELEASE/server-release.jar"

JAR_SIZE=$(stat -c %s server-release.jar 2>/dev/null || echo 0)
if [ "$JAR_SIZE" -lt 1048576 ] || ! head -c 2 server-release.jar | grep -q "PK"; then
  echo "ERROR: server-release.jar looks invalid (size: $JAR_SIZE bytes)" >&2
  rm -f server-release.jar
  exit 1
fi

${ENSURE_JAVA_FN}

## Mindustry's Java 21+ runtime (the loader runs on 21; 25 works too but the
## loader's own requirements are met by 21).
ensure_java 21

## The server jar's console has no CLI port flag: the wrapper pipes
## "config port <p>" and "host" into it, then keeps relaying panel console
## input so commands still work.
cat > mindustry-start.sh <<'EOF'
#!/bin/bash
cd "$(dirname "$0")"
PORT="{{PORT}}"
MAP="{{MAP}}"
MODE="{{MODE}}"
EXTRA=""
[ -n "$MAP" ] && EXTRA="$EXTRA \\"$MAP\\" $MODE"
{ printf 'config port %s\nhost%s\n' "$PORT" "\${EXTRA:+ $EXTRA}"; cat; } \
  | java -Xms{{MIN_RAM}}G -Xmx{{MAX_RAM}}G {{JVM_FLAGS}} -jar server-release.jar
EOF
chmod +x mindustry-start.sh

echo "Mindustry server installed successfully"
`,

  startCommand: `cd {{INSTALL_PATH}} && bash mindustry-start.sh`,
  stopCommand: "exit",
  configFiles: {},
  defaultConfig: {},
};
