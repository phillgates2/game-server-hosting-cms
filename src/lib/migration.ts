/**
 * Server migration between nodes.
 *
 * A server moves as one archive: exported from the source, imported on the
 * destination, then re-pointed in the database. The panel orchestrates and
 * is the relay — for remote↔remote moves the bytes pass through the panel
 * host, which keeps the agents simple (they never talk to each other).
 *
 * Local ↔ local and local ↔ remote use the panel's own disk + tar; any move
 * involving a remote node streams through the agent's backup-download and
 * import endpoints in slices/chunks so arbitrarily large servers work.
 */

import { mkdtempSync } from "node:fs";
import { rm, stat as fsStat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NodeEndpoint } from "@/lib/node-client";

/** Raw bytes per transfer chunk; base64 inflates ~33%, within the agent cap. */
export const MIGRATION_CHUNK_BYTES = 8 * 1024 * 1024;

/** Slugify a name for use in an install path (mirrors the wizard). */
export function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "server"
  );
}

/** Where the server will live on the destination node. */
export function computeDestInstallPath(
  gameServerPath: string | null,
  gameSlug: string | null,
  serverName: string
): string {
  const base = (gameServerPath || "/opt/gameservers").replace(/\/+$/, "");
  return `${base}/${slugify(gameSlug || "game")}/${slugify(serverName)}`;
}

/** A server can only move when it is not running. */
export function migrationBlockReason(status: string): string | null {
  if (status === "running") return "Stop the server before migrating it.";
  if (status === "installing") return "Wait for the current install to finish before migrating.";
  return null;
}

// ── Local tar helpers ───────────────────────────────────────────────────────

/**
 * Create a migration archive of a LOCAL install dir into a temp file.
 * Backups/steamcmd are excluded so a move does not ship its own archives.
 * Returns the archive path; the caller deletes it.
 */
export function createLocalMigrationArchive(installPath: string): string {
  const staging = mkdtempSyncSafe();
  const out = join(staging, "migration.tar.gz");
  const r = spawnSync(
    "tar",
    ["czf", out, "--exclude=gsm-backups", "--exclude=steamcmd", "--exclude=.steam", "-C", installPath, "."],
    { encoding: "utf8" }
  );
  if (r.status !== 0) {
    throw new Error(`Could not archive the server: ${(r.stderr || "tar failed").slice(-300)}`);
  }
  return out;
}

function mkdtempSyncSafe(): string {
  return mkdtempSync(join(tmpdir(), "gsm-migrate-"));
}

/** Extract a local archive into a (created) destination directory. */
export function extractLocalArchive(archivePath: string, destDir: string): void {
  const r = spawnSync("tar", ["xzf", archivePath, "-C", destDir], { encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`Could not extract on the destination: ${(r.stderr || "tar failed").slice(-300)}`);
  }
}

// ── Remote transfer (through the agent) ─────────────────────────────────────

/**
 * Download a remote backup archive to a local temp file, slice by slice.
 * Returns the local archive path; the caller deletes it.
 */
export async function downloadRemoteArchive(
  node: NodeEndpoint,
  installPath: string,
  backupName: string,
  rpc: <T = Record<string, unknown>>(node: NodeEndpoint, path: string, body: unknown, opts?: { timeoutMs?: number }) => Promise<T>
): Promise<string> {
  const staging = mkdtempSyncSafe();
  const out = join(staging, "migration.tar.gz");
  const { writeFile } = await import("node:fs/promises");
  await writeFile(out, Buffer.alloc(0));

  let offset = 0;
  // Loop slices until the agent says EOF.
  for (;;) {
    const slice = await rpc<{ data?: string; size?: number; eof?: boolean; error?: string }>(
      node,
      "/rpc/backup/download",
      { installPath, name: backupName, offset, length: MIGRATION_CHUNK_BYTES },
      { timeoutMs: 120_000 }
    );
    if (slice.error) throw new Error(`Agent download failed: ${slice.error}`);
    if (typeof slice.data === "string" && slice.data.length > 0) {
      const { appendFile } = await import("node:fs/promises");
      await appendFile(out, Buffer.from(slice.data, "base64"));
      offset += Buffer.from(slice.data, "base64").length;
    }
    if (slice.eof) break;
    // Safety: a zero-length non-EOF slice would spin forever.
    if (!slice.data || slice.data.length === 0) throw new Error("Agent download stalled");
  }
  return out;
}

/**
 * Upload a local archive to a remote node in base64 chunks and extract it.
 */
export async function uploadAndExtractRemote(
  node: NodeEndpoint,
  destInstallPath: string,
  localArchivePath: string,
  rpc: <T = Record<string, unknown>>(node: NodeEndpoint, path: string, body: unknown, opts?: { timeoutMs?: number }) => Promise<T>
): Promise<void> {
  const { size } = await fsStat(localArchivePath);
  let sent = 0;
  await new Promise<void>((resolveP, rejectP) => {
    const stream = createReadStream(localArchivePath, { highWaterMark: MIGRATION_CHUNK_BYTES });
    const pump = async () => {
      try {
        for await (const chunk of stream) {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          const isFinal = sent + buf.length >= size;
          const r = await rpc<{ ok?: boolean; error?: string }>(
            node,
            "/rpc/import",
            { installPath: destInstallPath, data: buf.toString("base64"), final: isFinal },
            { timeoutMs: 120_000 }
          );
          if (r.error) throw new Error(`Agent import failed: ${r.error}`);
          sent += buf.length;
        }
        // If the file was empty (size 0) the loop never sent a final chunk.
        if (size === 0) {
          const r = await rpc<{ ok?: boolean; error?: string }>(
            node,
            "/rpc/import",
            { installPath: destInstallPath, data: "", final: true },
            { timeoutMs: 120_000 }
          );
          if (r.error) throw new Error(`Agent import failed: ${r.error}`);
        }
        resolveP();
      } catch (e) {
        rejectP(e);
      }
    };
    void pump();
  });
}

/** Clean up a local staging archive/dir. Best-effort. */
export async function cleanupLocalArchive(archivePath: string): Promise<void> {
  try {
    const dir = archivePath.slice(0, archivePath.lastIndexOf("/"));
    await rm(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}
