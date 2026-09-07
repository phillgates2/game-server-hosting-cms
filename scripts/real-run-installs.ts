/**
 * Real-install runner (audit tool, not part of the test suite).
 *
 * Renders each game's installScript with template defaults and executes it
 * for real (no mocks) in /tmp, then asserts the panel's expected artifacts
 * exist. Catches the class of bug the mock harness hides — upstream
 * repackaging like TShock 6.x's zip-wrapped tar.
 *
 *   npx tsx scripts/real-run-installs.ts terraria minecraft-java ...
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { gameTemplates, getExpectedArtifactsBySlug } from "../src/db/games";

const only = process.argv.slice(2);
const templates = gameTemplates.filter((t) => only.length === 0 || only.includes(t.slug));

function fillVariables(t: (typeof gameTemplates)[number], installPath: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of t.variables) out[v.env_variable] = v.default_value;
  const fallback: Record<string, string> = {
    SERVER_NAME: "Audit Server",
    INSTALL_PATH: installPath,
    PORT: String(t.defaultPort),
    QUERY_PORT: String(t.defaultPort + 1),
    RCON_PORT: String(t.defaultPort + 2),
    MAX_PLAYERS: "32",
    MAX_RAM: "4",
  };
  for (const [k, v] of Object.entries(fallback)) if (!out[k]) out[k] = v;
  out.STEAMCMD_PATH = "/opt/steamcmd";
  // The panel always overrides INSTALL_PATH with the server's computed path;
  // a template default must never win (mirrors the install route).
  out.INSTALL_PATH = installPath;
  out.PORT = String(fallback.PORT);
  return out;
}

function render(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_m, k: string) => vars[k] ?? "");
}

function listFiles(dir: string, base = dir, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue; // broken symlink inside an extracted archive
    }
    if (st.isDirectory()) listFiles(p, base, acc);
    else acc.push(p.slice(base.length + 1));
  }
  return acc;
}

for (const t of templates) {
  // Explicit slugs always run; without arguments, only non-SteamCMD games.
  if (only.length > 0 && !only.includes(t.slug)) continue;
  if (only.length === 0 && t.installScript.includes("steamcmd.sh")) continue;
  const root = mkdtempSync(join(tmpdir(), `gsm-real-${t.slug}-`));
  const installDir = join(root, "server");
  mkdirSync(installDir, { recursive: true });
  const vars = fillVariables(t, installDir);
  const script = render(t.installScript, vars);
  const scriptPath = join(root, "install.sh");
  writeFileSync(scriptPath, script, { mode: 0o755 });

  console.log(`\n════ ${t.slug} — ${t.name} ════`);
  const start = Date.now();
  const run = spawnSync("bash", [scriptPath], {
    cwd: installDir,
    env: {
      ...process.env,
      HOME: installDir,
      PATH: process.env.PATH || "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      DEBIAN_FRONTEND: "noninteractive",
    },
    encoding: "utf8",
    timeout: 15 * 60_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const secs = ((Date.now() - start) / 1000).toFixed(0);

  if (run.error) {
    console.log(`  ❌ spawn error: ${run.error.message}`);
  } else if (run.status !== 0) {
    const tail = (run.stderr || "").split("\n").filter(Boolean).slice(-4).join(" | ");
    console.log(`  ❌ exit ${run.status} after ${secs}s${tail ? ` — ${tail}` : ""}`);
    console.log(`  stdout tail: ${(run.stdout || "").split("\n").filter(Boolean).slice(-3).join(" | ")}`);
  } else {
    const expected = getExpectedArtifactsBySlug(t.slug) ?? [];
    const produced = listFiles(installDir);
    const missing = expected.filter((spec) => {
      const rel = spec.split("|")[0].trim().replace(/\*/g, "X");
      return !produced.some((f) => f === rel || f.includes(rel.split("/").pop() as string));
    });
    if (missing.length) {
      console.log(`  ⚠ installed OK in ${secs}s but expected artifacts missing: ${missing.join(", ")}`);
      console.log(`  produced (sample): ${produced.slice(0, 12).join(", ")}`);
    } else {
      console.log(`  ✅ installed OK in ${secs}s — artifacts: ${expected.join(", ") || "(none declared)"}`);
    }
  }
  rmSync(root, { recursive: true, force: true });
}
