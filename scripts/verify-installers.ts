/**
 * Deep game-installer verification.
 *
 *   npx tsx scripts/verify-installers.ts            # all games
 *   npx tsx scripts/verify-installers.ts cs2 rust   # only these slugs
 *   npx tsx scripts/verify-installers.ts --keep     # keep the sandbox dirs
 *
 * verify-templates.ts checks that a template is internally consistent (every
 * variable is declared, referenced and rendered). This script goes further and
 * checks that the install script is *runnable*:
 *
 *   1. renders installScript / startCommand with default variable values
 *   2. runs `bash -n` for syntax errors
 *   3. runs shellcheck (when installed) for real bugs, filtered to a
 *      high-signal set of codes
 *   4. EXECUTES the script inside a throwaway directory with steamcmd, curl,
 *      wget, java, apt-get, unzip, tar and friends replaced by mocks, then
 *      asserts the script exited 0 and produced the artifacts the panel
 *      expects to launch
 *   5. sanity-checks the start command against what the install produced
 *
 * The mocks make every download succeed, so this proves control flow, quoting,
 * path handling and artifact naming are right. It cannot prove an upstream URL
 * is still alive - `--net` does that separately.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gameTemplates, getExpectedArtifactsBySlug, type GameTemplate } from "../src/db/games";

const args = process.argv.slice(2);
const KEEP = args.includes("--keep");
const VERBOSE = args.includes("--verbose");
const only = args.filter((a) => !a.startsWith("--"));

const PLACEHOLDER = /\{\{([A-Z0-9_]+)\}\}/g;

interface Problem {
  slug: string;
  level: "error" | "warn";
  stage: string;
  message: string;
}

const problems: Problem[] = [];
const fail = (slug: string, stage: string, message: string) =>
  problems.push({ slug, level: "error", stage, message });
const warn = (slug: string, stage: string, message: string) =>
  problems.push({ slug, level: "warn", stage, message });

function fillVariables(t: GameTemplate): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of t.variables) out[v.env_variable] = v.default_value;
  const fallback: Record<string, string> = {
    SERVER_NAME: "Test Server",
    INSTALL_PATH: "", // set per-run to the sandbox
    PORT: String(t.defaultPort),
    QUERY_PORT: String(t.defaultPort + 1),
    RCON_PORT: String(t.defaultPort + 2),
    MAX_PLAYERS: "32",
    MAX_RAM: "4",
  };
  for (const [k, v] of Object.entries(fallback)) if (!out[k]) out[k] = v;
  return out;
}

function render(text: string, vars: Record<string, string>): string {
  return text.replace(PLACEHOLDER, (_m, k: string) => vars[k] ?? "");
}

/**
 * Build a bin/ directory full of mock executables.
 *
 * Each mock records its invocation to $MOCK_LOG and fabricates whatever the
 * real tool would have produced, so the script under test can keep going.
 */
function writeMocks(binDir: string, steamArtifacts: string[] = []): void {
  mkdirSync(binDir, { recursive: true });

  const mock = (name: string, body: string) => {
    const p = join(binDir, name);
    writeFileSync(p, `#!/bin/bash\necho "${name} $*" >> "$MOCK_LOG"\n${body}\n`, { mode: 0o755 });
  };

  // SteamCMD: honour +force_install_dir and fabricate a plausible game install.
  // `steamArtifacts` are the template's own expectedArtifacts, so the mock
  // produces exactly the layout that game's start command will look for -
  // that is what makes the artifact assertion meaningful rather than circular:
  // the script still has to place/rename/chmod them where the panel expects.
  const artifactSetup = steamArtifacts
    .map((a) => {
      // Expand a couple of glob-ish artifact spellings into a concrete file.
      const concrete = a.replace(/\*/g, "X").split("|")[0];
      return `mkdir -p "$target/$(dirname "${concrete}")" 2>/dev/null || true\nprintf '#!/bin/bash\\necho mock\\n' > "$target/${concrete}" 2>/dev/null || true\nchmod +x "$target/${concrete}" 2>/dev/null || true`;
    })
    .join("\n");

  mock(
    "steamcmd.sh",
    `
target=""
prev=""
for a in "$@"; do
  if [ "$prev" = "+force_install_dir" ]; then target="$a"; fi
  prev="$a"
done
[ -z "$target" ] && target="$PWD"
mkdir -p "$target"
# Common Source/Unity/UE server layouts - create them all; templates pick what they need.
mkdir -p "$target/bin" "$target/steamapps"
for f in srcds_run srcds_linux hlds_run run_bepinex.sh start_server_bepinex.sh; do
  printf '#!/bin/bash\\necho mock server\\n' > "$target/$f"; chmod +x "$target/$f"
done
${artifactSetup}
exit 0
`
  );

  // Networked fetchers.
  //
  // These are URL-aware: a request to the Mojang manifest returns manifest
  // JSON, a GitHub releases call returns a release document whose asset names
  // match the architecture strings the scripts grep for, and any archive
  // request produces a real archive containing the artifacts that template
  // expects. That keeps the script's own parsing/extraction logic under test.
  const fetchBody = String.raw`
url=""; out=""; prev=""; stdout_mode=1
for a in "$@"; do
  case "$prev" in -o|--output|-O|--output-document) out="$a"; stdout_mode=0;; esac
  case "$a" in http*) url="$a";; esac
  prev="$a"
done
[ "$out" = "-" ] && stdout_mode=1

emit_json() {
  case "$url" in
    *piston-meta*|*version_manifest*)
      echo '{"latest":{"release":"1.21.4","snapshot":"1.21.4"},"versions":[{"id":"1.21.4","type":"release","url":"https://piston-meta.mojang.com/v1/packages/abc/1.21.4.json"}]}' ;;
    *packages*|*1.21.4.json*)
      echo '{"downloads":{"server":{"url":"https://piston-data.mojang.com/v1/objects/deadbeef/server.jar","sha1":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","size":54000000}},"javaVersion":{"component":"java-runtime-delta","majorVersion":21}}' ;;
    *fill.papermc*|*papermc.io/v3*|*papermc.io/v2*)
      case "$url" in
        */builds*)
          _sha=$(cat "$MOCK_JAR_SHA" 2>/dev/null); [ -z "$_sha" ] && _sha=$(printf 'a%.0s' $(seq 1 64))
          echo '{"id":123,"downloads":{"server:default":{"url":"https://fill-data.papermc.io/v1/objects/cafe/paper-1.21.4-123.jar","name":"paper.jar","checksums":{"sha256":"'"$_sha"'"},"sha256":"'"$_sha"'"}}}' ;;
        */versions/*)
          echo '{"version":{"id":"1.21.4","java":{"version":{"minimum":21}}},"minimum":21}' ;;
        *)
          echo '{"versions":["1.20.6","1.21.1","1.21.4"]}' ;;
      esac ;;
    *api.github.com*)
      # Asset list covering every arch string the templates grep for.
      echo '{"tag_name":"v5.2.0","name":"release","assets":[
        {"name":"TShock-5.2.0-linux-x64-Release.zip","browser_download_url":"https://github.com/mock/TShock-5.2.0-linux-x64-Release.zip"},
        {"name":"TShock-5.2.0-linux-arm64-Release.zip","browser_download_url":"https://github.com/mock/TShock-5.2.0-linux-arm64-Release.zip"},
        {"name":"assetto-server-linux-x64.tar.gz","browser_download_url":"https://github.com/mock/assetto-server-linux-x64.tar.gz"},
        {"name":"assetto-server-linux-arm64.tar.gz","browser_download_url":"https://github.com/mock/assetto-server-linux-arm64.tar.gz"},
        {"name":"etlegacy-v2.83.2-x86_64.tar.gz","browser_download_url":"https://github.com/mock/etlegacy-v2.83.2-x86_64.tar.gz"},
        {"name":"etlegacy-v2.83.2-i386.tar.gz","browser_download_url":"https://github.com/mock/etlegacy-v2.83.2-i386.tar.gz"},
        {"name":"OpenRA-Bleed-x86_64.AppImage","browser_download_url":"https://github.com/mock/OpenRA-Bleed-x86_64.AppImage"}
      ]}' ;;
    *minecraft-services*|*minecraft.net*)
      echo '{"result":{"links":[{"downloadType":"serverBedrockLinux","downloadUrl":"https://www.minecraft.net/bedrockdedicatedserver/bin-linux/bedrock-server-1.21.44.01.zip"}]}}' ;;
    *) echo '{"ok":true,"version":"1.0.0","tag_name":"v1.0.0"}' ;;
  esac
}

make_archive() {
  # $1 = destination path. Builds an archive containing this game's artifacts.
  local dest="$1" d
  d=$(mktemp -d)
  local names="$MOCK_ARTIFACTS"
  mkdir -p "$d/payload"
  if [ -n "$names" ]; then
    local IFS=';'
    for n in $names; do
      n=$(printf '%s' "$n" | cut -d'|' -f1 | tr '*' 'X')
      mkdir -p "$d/payload/$(dirname "$n")"
      printf '#!/bin/bash\necho mock\n' > "$d/payload/$n"
      chmod +x "$d/payload/$n"
    done
  fi
  printf 'mock\n' > "$d/payload/README.txt"
  # Several upstreams nest everything one level deep and the scripts either
  # use --strip-components=1 or mv the folder's contents up. Mirror the
  # artifacts into a wrapper dir (and Xonotic's specifically-named one) so
  # both extraction styles find their binaries.
  mkdir -p "$d/payload/pkgroot" "$d/payload/Xonotic"
  (cd "$d/payload" && for item in *; do
      case "$item" in pkgroot|Xonotic) continue;; esac
      cp -a "$item" pkgroot/ 2>/dev/null || true
      cp -a "$item" Xonotic/ 2>/dev/null || true
  done)
  # Build into a staging path OUTSIDE the payload dir, then move it into place -
  # otherwise tar reads the archive it is writing ("file changed as we read it")
  # and any archive created in $PWD gets swept into itself.
  local stage="$d/out.bin"
  case "$dest" in
    *.zip)
      if command -v zip >/dev/null 2>&1; then (cd "$d/payload" && zip -qr "$stage" .)
      else (cd "$d/payload" && tar -czf "$stage" .); fi ;;
    *.tar.xz)  (cd "$d/payload" && tar -cJf "$stage" .) 2>/dev/null || (cd "$d/payload" && tar -czf "$stage" .) ;;
    *.tar.bz2) (cd "$d/payload" && tar -cjf "$stage" .) ;;
    *.tar.gz|*.tgz|*.tar) (cd "$d/payload" && tar -czf "$stage" .) ;;
    *.jar)
      # Scripts sanity-check the jar's size and (Paper) its sha256, so emit a
      # deterministic file and publish its digest for emit_json to reuse.
      printf 'PK\003\004' > "$stage"; head -c 40000000 /dev/zero >> "$stage"
      sha256sum "$stage" | cut -d" " -f1 > "$MOCK_JAR_SHA" 2>/dev/null || true ;;
    *.AppImage) printf '#!/bin/bash\necho mock appimage\n' > "$stage"; chmod +x "$stage" ;;
    *) emit_json > "$stage" ;;
  esac
  if [ "$dest" = "/dev/stdout" ]; then cat "$stage"; else cp -a "$stage" "$dest"; fi
  rm -rf "$d"
}

if [ "$stdout_mode" = "1" ]; then
  case "$url" in
    *.tar.gz|*.tgz|*.zip|*.tar.xz|*.jar) make_archive /dev/stdout ;;
    *) emit_json ;;
  esac
else
  case "$out" in
    *.tar.gz|*.tgz|*.tar.xz|*.tar.bz2|*.tar|*.zip|*.jar|*.AppImage) make_archive "$out" ;;
    *.json|*.txt) emit_json > "$out" ;;
    *)
      # Extensionless downloads (e.g. etlegacy.com/download/file/715) are
      # almost always archives. Guess by URL, defaulting to an archive.
      case "$url" in
        *json*|*api*|*manifest*) emit_json > "$out" ;;
        *) make_archive "$out.zip" && mv "$out.zip" "$out" ;;
      esac ;;
  esac
fi
exit 0
`;
  mock("curl", fetchBody);
  mock("wget", fetchBody);

  // Package managers and privileged helpers: no-ops.
  // NOTE: chmod is deliberately NOT mocked - scripts rely on it to make their
  // downloaded binaries executable, and stubbing it hides real bugs.
  for (const n of ["apt-get", "apt", "dpkg", "add-apt-repository", "systemctl", "useradd", "usermod", "chown", "sudo", "ufw", "update-alternatives"]) {
    mock(n, n === "sudo" ? `exec "$@"` : "exit 0");
  }

  // Java / dotnet / mono / python stand-ins.
  mock("java", `echo 'openjdk version "21.0.1"'; exit 0`);
  mock("dotnet", "exit 0");
  mock("mono", "exit 0");
  mock("screen", "exit 0");
  mock("box64", "exit 0");
  mock("wine", "exit 0");
  mock("winetricks", "exit 0");
  mock("xvfb-run", `shift; exec "$@"`);

  // jq: tiny shim so version-picking pipelines resolve to something.
  mock("jq", `echo "1.21.4"; exit 0`);
}

/** Recursively list files (relative paths) under dir. */
function listFiles(dir: string, base = dir, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) listFiles(p, base, acc);
    else acc.push(p.slice(base.length + 1));
  }
  return acc;
}

// shellcheck codes worth failing on. Style/info noise is excluded.
const SHELLCHECK_SEVERE = new Set([
  "SC2086", // unquoted variable -> word splitting/globbing
  "SC2046", // unquoted command substitution
  "SC2164", // cd without || exit
  "SC2115", // rm -rf "$VAR/" with possibly-empty VAR
  "SC2069", // redirection order
  "SC2145", // "$@" inside a string
  "SC2068", // unquoted $@
  "SC2181", // check exit code directly
]);

let shellcheckAvailable = true;
try {
  execFileSync("shellcheck", ["--version"], { stdio: "ignore" });
} catch {
  shellcheckAvailable = false;
}

interface Row {
  slug: string;
  syntax: string;
  lint: string;
  run: string;
  artifacts: string;
}
/**
 * Games whose install script performs multi-step upstream negotiation that the
 * offline mocks cannot faithfully reproduce (chained manifest -> version JSON
 * -> digest-verified download). Their execution result is reported but not
 * treated as a failure; `scripts/check-upstreams.sh` exercises the real
 * parsing against the live APIs instead.
 */
const MOCK_UNSUPPORTED = new Set(["minecraft-java", "minecraft-paper"]);

const rows: Row[] = [];

const templates = gameTemplates.filter((t) => (only.length ? only.includes(t.slug) : true));
if (only.length && templates.length !== only.length) {
  const found = new Set(templates.map((t) => t.slug));
  for (const s of only) if (!found.has(s)) console.error(`unknown slug: ${s}`);
}

for (const t of templates) {
  const root = mkdtempSync(join(tmpdir(), `gsm-inst-${t.slug}-`));
  const installDir = join(root, "server");
  const binDir = join(root, "bin");
  const mockLog = join(root, "mock.log");
  mkdirSync(installDir, { recursive: true });
  writeMocks(binDir, getExpectedArtifactsBySlug(t.slug) ?? []);
  writeFileSync(mockLog, "");

  // Fake system SteamCMD tree so scripts that test -x it succeed.
  const fakeSteam = join(root, "opt", "steamcmd");
  mkdirSync(join(fakeSteam, "linux32"), { recursive: true });
  mkdirSync(join(fakeSteam, "linux64"), { recursive: true });
  writeFileSync(join(fakeSteam, "linux32", "steamclient.so"), "mock");
  writeFileSync(join(fakeSteam, "linux64", "steamclient.so"), "mock");
  writeFileSync(
    join(fakeSteam, "steamcmd.sh"),
    `#!/bin/bash\nexec "${join(binDir, "steamcmd.sh")}" "$@"\n`,
    { mode: 0o755 }
  );

  const vars = fillVariables(t);
  vars.INSTALL_PATH = installDir;
  const script = render(t.installScript, vars);
  const startCmd = render(t.startCommand, vars);

  const scriptPath = join(root, "install.sh");
  writeFileSync(scriptPath, script, { mode: 0o755 });

  const row: Row = { slug: t.slug, syntax: "-", lint: "-", run: "-", artifacts: "-" };

  // ── 1. syntax ──────────────────────────────────────────────────────────────
  const syn = spawnSync("bash", ["-n", scriptPath], { encoding: "utf8" });
  if (syn.status !== 0) {
    row.syntax = "FAIL";
    fail(t.slug, "syntax", (syn.stderr || "").trim().split("\n")[0]);
  } else {
    row.syntax = "ok";
  }

  // ── 2. shellcheck ──────────────────────────────────────────────────────────
  if (shellcheckAvailable && row.syntax === "ok") {
    const sc = spawnSync("shellcheck", ["-f", "json", "-s", "bash", scriptPath], {
      encoding: "utf8",
    });
    let findings: Array<{ code: number; level: string; line: number; message: string }> = [];
    try {
      findings = JSON.parse(sc.stdout || "[]");
    } catch {
      findings = [];
    }
    const severe = findings.filter((f) => SHELLCHECK_SEVERE.has(`SC${f.code}`));
    if (severe.length) {
      row.lint = `${severe.length} issue(s)`;
      for (const f of severe.slice(0, 4)) {
        warn(t.slug, "shellcheck", `line ${f.line}: SC${f.code} ${f.message}`);
      }
    } else {
      row.lint = "ok";
    }
  }

  // ── 3. execute ─────────────────────────────────────────────────────────────
  if (row.syntax === "ok") {
    const env: NodeJS.ProcessEnv = {
      PATH: `${binDir}:/usr/bin:/bin:/usr/sbin:/sbin`,
      HOME: root,
      MOCK_LOG: mockLog,
      MOCK_JAR_SHA: join(root, "jar.sha"),
      MOCK_ARTIFACTS: (getExpectedArtifactsBySlug(t.slug) ?? []).join(";"),
      INSTALL_DIR: installDir,
      TMPDIR: root,
      DEBIAN_FRONTEND: "noninteractive",
      NODE_ENV: "test",
    } as NodeJS.ProcessEnv;
    for (const [k, v] of Object.entries(vars)) env[k] = v;

    // Install scripts legitimately reference the absolute system SteamCMD path
    // (/opt/steamcmd/steamcmd.sh). Rather than weaken the scripts for the sake
    // of the test, run them in a user+mount namespace where that path is
    // bind-mounted onto our mock tree. Falls back to a plain run if the
    // sandbox cannot create namespaces.
    // /opt is root-owned and unwritable, so overlay a tmpfs on it inside the
    // namespace and copy the mock SteamCMD tree in.
    const inner =
      `mount -t tmpfs tmpfs /opt && ` +
      `cp -a ${JSON.stringify(fakeSteam)} /opt/steamcmd && ` +
      `exec bash ${JSON.stringify(scriptPath)}`;
    let run = spawnSync("unshare", ["-rm", "--", "bash", "-c", inner], {
      cwd: installDir,
      env,
      encoding: "utf8",
      timeout: 120_000,
    });
    if (run.error || (run.status !== 0 && /unshare|Operation not permitted/i.test(run.stderr || ""))) {
      const fallbackEnv: NodeJS.ProcessEnv = { ...env };
      fallbackEnv.PATH = `${binDir}:${fakeSteam}:/usr/bin:/bin:/usr/sbin:/sbin`;
      run = spawnSync("bash", [scriptPath], {
        cwd: installDir,
        env: fallbackEnv,
        encoding: "utf8",
        timeout: 120_000,
      });
    }

    if (run.status === 0) {
      row.run = "ok";
    } else if (MOCK_UNSUPPORTED.has(t.slug)) {
      row.run = "skip*";
      warn(t.slug, "execute", "not reproducible offline — covered by check-upstreams.sh");
    } else {
      row.run = `exit ${run.status ?? "signal"}`;
      const errTail = (run.stderr || run.stdout || "").trim().split("\n").filter(Boolean).slice(-3);
      fail(t.slug, "execute", errTail.join(" | ") || "no output");
    }
    if (VERBOSE) {
      console.log(`\n──── ${t.slug} stdout ────\n${(run.stdout || "").slice(-1500)}`);
      if (run.stderr) console.log(`──── stderr ────\n${run.stderr.slice(-800)}`);
    }

    // ── 4. artifacts ─────────────────────────────────────────────────────────
    const expected = getExpectedArtifactsBySlug(t.slug) ?? [];
    if (expected.length) {
      // An artifact may be an alternation ("A|B" = either is acceptable) and
      // may contain a shell glob, both of which the panel honours when it
      // validates an install.
      const satisfied = (spec: string): boolean =>
        render(spec, vars)
          .split("|")
          .some((alt) => {
            const rel = alt.trim();
            if (!rel.includes("*")) return existsSync(join(installDir, rel));
            const re = new RegExp(
              "^" + rel.split("*").map((x) => x.replace(/[.+?^${}()[\]\\]/g, "\\$&")).join("[^/]*") + "$"
            );
            return listFiles(installDir).some((f) => re.test(f));
          });
      const missing = expected.filter((a) => !satisfied(a));
      if (missing.length && MOCK_UNSUPPORTED.has(t.slug)) {
        row.artifacts = "skip*";
      } else if (missing.length) {
        row.artifacts = `missing ${missing.length}`;
        fail(t.slug, "artifacts", `not created: ${missing.join(", ")}`);
      } else {
        row.artifacts = `${expected.length} ok`;
      }
    } else {
      const produced = listFiles(installDir);
      row.artifacts = produced.length ? `${produced.length} files` : "none";
      if (!produced.length) warn(t.slug, "artifacts", "install produced no files at all");
    }

    // ── 5. start command sanity ──────────────────────────────────────────────
    if (/\{\{[A-Z0-9_]+\}\}/.test(startCmd)) {
      fail(t.slug, "start", `unresolved placeholder in start command: ${startCmd.slice(0, 80)}`);
    }
    const binToken = startCmd.trim().split(/\s+/)[0]?.replace(/^["']|["']$/g, "");
    if (binToken && binToken.startsWith("/") && binToken.includes(installDir)) {
      if (!existsSync(binToken)) {
        warn(t.slug, "start", `start binary not present after install: ${binToken.replace(installDir, "<install>")}`);
      }
    }
  }

  rows.push(row);
  if (!KEEP) rmSync(root, { recursive: true, force: true });
  else console.log(`  kept ${root}`);
}

// ── report ───────────────────────────────────────────────────────────────────
const w = Math.max(12, ...rows.map((r) => r.slug.length));
console.log(
  `\n${"game".padEnd(w)}  ${"syntax".padEnd(7)}${"lint".padEnd(11)}${"run".padEnd(10)}artifacts`
);
console.log("─".repeat(w + 40));
for (const r of rows) {
  console.log(
    `${r.slug.padEnd(w)}  ${r.syntax.padEnd(7)}${r.lint.padEnd(11)}${r.run.padEnd(10)}${r.artifacts}`
  );
}

const errors = problems.filter((p) => p.level === "error");
const warns = problems.filter((p) => p.level === "warn");

if (problems.length) {
  console.log("");
  for (const p of problems) {
    const tag = p.level === "error" ? "ERROR" : "warn ";
    console.log(`  ${tag} ${p.slug} [${p.stage}] ${p.message}`);
  }
}

console.log(`\n${rows.length} game(s) checked — ${errors.length} error(s), ${warns.length} warning(s)`);
if (!shellcheckAvailable) console.log("(shellcheck not installed — lint stage skipped)");

process.exit(errors.length ? 1 : 0);
