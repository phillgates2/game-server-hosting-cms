import { access, chmod, constants, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import {
  beginProgress,
  collapseCarriageReturns,
  feedProgress,
  finishProgress,
  withProgressHelpers,
} from "./install-progress";

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
  /** SteamCMD directory (node configuration); defaults to /opt/steamcmd. */
  steamcmdDir?: string;
  timeoutMs?: number;
  /** When set, the run is tracked for the live status meter of this server. */
  progressServerId?: number;
}): Promise<{ stdout: string; stderr: string }> {
  const serverId = options.progressServerId;
  const token =
    serverId === undefined ? null : beginProgress({ serverId, kind: "update", title: options.gameName });
  try {
    const result = await runUpdateScript({
      installPath: options.installPath,
      script: buildSteamUpdateScript(options),
      timeoutMs: options.timeoutMs,
      onOutput: token === null ? undefined : (chunk) => feedProgress(serverId!, token, chunk),
    });
    if (token !== null) finishProgress(serverId!, token, { ok: true });
    return result;
  } catch (e: unknown) {
    if (token !== null) {
      finishProgress(serverId!, token, { ok: false, error: e instanceof Error ? e.message : String(e) });
    }
    throw e;
  }
}

export function buildSteamUpdateScript(options: {
  installPath: string;
  gameName: string;
  steamAppId: string;
  steamcmdDir?: string;
}): string {
  const steamcmdDir = (options.steamcmdDir ?? "").trim() || "/opt/steamcmd";

  return `#!/usr/bin/env bash
set -e
STEAMCMD_BIN="${steamcmdDir}/steamcmd.sh"
if [ ! -x "$STEAMCMD_BIN" ]; then
  echo "SteamCMD is not installed at $STEAMCMD_BIN (set the node's SteamCMD path or put SteamCMD at /opt/steamcmd)" >&2
  exit 1
fi
export HOME="${options.installPath}"
echo "Updating ${options.gameName} (AppID: ${options.steamAppId})..."
"$STEAMCMD_BIN" +force_install_dir "${options.installPath}" +login anonymous +app_update ${options.steamAppId} validate +quit
echo "Update complete"
`;

}

/** Shape a failed update into the API response.
 * Both streams must survive: game installers (ET:Legacy's release resolver,
 * curl, the mod-archive check) report their real errors on stderr, and the
 * bare "Exit 1" that reaches the user otherwise is undiagnosable.
 */
export function formatUpdateFailure(err: {
  message?: string; stdout?: string; stderr?: string;
}): { error: string; output: string; errorOutput: string } {
  const message = err.message || "Update failed";
  const error = /^exit \d+$/i.test(message)
    ? `Update failed (${message.toLowerCase()})`
    : message;
  return {
    error,
    output: (err.stdout ?? "").slice(-4000),
    errorOutput: (err.stderr ?? "").slice(-4000),
  };
}

/** Run an update without regenerating the panel's configs or start scripts. */
export async function runUpdateScript(options: {
  installPath: string;
  script: string;
  timeoutMs?: number;
  /** Receives stdout/stderr as it is produced (live status meter). */
  onOutput?: (chunk: string) => void;
}): Promise<{ stdout: string; stderr: string }> {
  const bashPath = await findBash();
  const timeoutMs = options.timeoutMs ?? 1000 * 60 * 30;
  const tempDir = await mkdtemp(join(/* turbopackIgnore: true */ tmpdir(), "gsm-update-"));
  const scriptPath = join(/* turbopackIgnore: true */ tempDir, "update.sh");
  await writeFile(scriptPath, withProgressHelpers(options.script), "utf8");
  await chmod(scriptPath, 0o755);

  try {
    return await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let done = false;

      const child: ChildProcess = spawn(/*turbopackIgnore: true*/ bashPath, [scriptPath], {
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

      const emit = (text: string) => {
        try {
          options.onOutput?.(text);
        } catch {
          /* the meter must never break an update */
        }
      };
      child.stdout?.on("data", (d: Buffer) => {
        const text = d.toString();
        stdout += text;
        emit(text);
      });
      child.stderr?.on("data", (d: Buffer) => {
        const text = d.toString();
        stderr += text;
        emit(text);
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
          // Progress-bar redraws are for the live meter, not the final log.
          stdout = collapseCarriageReturns(stdout);
          stderr = collapseCarriageReturns(stderr);
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
