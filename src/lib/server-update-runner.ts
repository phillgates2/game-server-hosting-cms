import { access, chmod, constants, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

async function findBash(): Promise<string> {
  for (const p of ["/usr/bin/bash", "/bin/bash", "/usr/local/bin/bash"]) {
    try {
      await access(p, constants.X_OK);
      return p;
    } catch {
      // next candidate
    }
  }
  return "bash";
}

export async function runSteamUpdate(options: {
  installPath: string;
  gameName: string;
  steamAppId: string;
  timeoutMs?: number;
}): Promise<{ stdout: string; stderr: string }> {
  const bashPath = await findBash();
  const timeoutMs = options.timeoutMs ?? 1000 * 60 * 30;

  const script = `#!/usr/bin/env bash
set -e
STEAMCMD_BIN="/opt/steamcmd/steamcmd.sh"
if [ ! -x "$STEAMCMD_BIN" ]; then
  echo "SteamCMD is not installed at $STEAMCMD_BIN" >&2
  exit 1
fi
export HOME="${options.installPath}"
echo "Updating ${options.gameName} (AppID: ${options.steamAppId})..."
"$STEAMCMD_BIN" +force_install_dir "${options.installPath}" +login anonymous +app_update ${options.steamAppId} validate +quit
echo "Update complete"
`;

  const tempDir = await mkdtemp(join(/* turbopackIgnore: true */ tmpdir(), "gsm-update-"));
  const scriptPath = join(/* turbopackIgnore: true */ tempDir, "update.sh");
  await writeFile(scriptPath, script, "utf8");
  await chmod(scriptPath, 0o755);

  try {
    return await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let done = false;

      const child: ChildProcess = spawn(bashPath, [scriptPath], {
        cwd: tempDir,
        env: {
          NODE_ENV: process.env.NODE_ENV || "production",
          PATH: process.env.PATH || "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
          HOME: options.installPath,
          LANG: process.env.LANG || "C.UTF-8",
          LC_ALL: process.env.LC_ALL || process.env.LANG || "C.UTF-8",
        } as NodeJS.ProcessEnv,
      });

      const timer = setTimeout(() => {
        if (!done) {
          done = true;
          child.kill("SIGKILL");
          reject(new Error("Update timed out"));
        }
      }, timeoutMs);

      child.stdout?.on("data", (d: Buffer) => {
        stdout += d.toString();
      });
      child.stderr?.on("data", (d: Buffer) => {
        stderr += d.toString();
      });
      child.on("error", (e: Error) => {
        if (!done) {
          done = true;
          clearTimeout(timer);
          reject(e);
        }
      });
      child.on("close", (code: number | null) => {
        if (!done) {
          done = true;
          clearTimeout(timer);
          if (code === 0) {
            resolve({ stdout, stderr });
          } else {
            const err = new Error(`Exit ${code}`);
            (err as unknown as Record<string, unknown>).stdout = stdout;
            (err as unknown as Record<string, unknown>).stderr = stderr;
            reject(err);
          }
        }
      });
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
