import { realpathSync, statSync } from "node:fs";
import { readdir, stat, readFile, writeFile, mkdir, rm, rename, open, realpath } from "node:fs/promises";
import { join, resolve, relative, extname, basename, dirname, sep } from "node:path";
import { looksLikeText } from "./text-detect";
import { isSqliteBytes } from "./sqlite-browser";

export interface ServerFileItem {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modified: string;
  ext: string | null;
}

export interface ServerFileBatchResult {
  ok: boolean;
  moved?: number;
  deleted?: number;
  failed: Array<{ path: string; error: string }>;
}

function resolveBasePath(basePath: string): string {
  return resolve(/* turbopackIgnore: true */ basePath);
}

/**
 * Lexical containment check — kept as a pure function because the unit tests
 * and the FTP server's virtual-path resolver depend on it.
 *
 * This is a STRING test, not a filesystem one: it catches `..` traversal but a
 * symlink inside the server directory that points outside passes it. Every
 * operation that actually touches the disk uses `resolveSafePath`, which adds
 * the real-path check on top.
 */
export function safePath(basePath: string, requestedPath: string): string | null {
  const base = resolveBasePath(basePath);
  const resolved = resolve(/* turbopackIgnore: true */ base, requestedPath || ".");
  // A plain startsWith() is a string test, not a path-boundary test: with a base
  // of /srv/mc it also accepts /srv/mc-evil. Compare against base + separator so
  // only the directory itself and its real descendants pass.
  if (resolved !== base && !resolved.startsWith(base + sep)) return null;
  return resolved;
}

/** A resolved, contained path plus the real base it was checked against. */
export interface ResolvedServerPath {
  /** The real location of the server root — the containment boundary. */
  realBase: string;
  /** The resolved absolute path, with any symlinked segment followed. */
  fullPath: string;
  /** `fullPath` relative to `realBase` ("." for the root). */
  relPath: string;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve a requested path under the server directory, refusing anything that
 * escapes it — including through a symlink.
 *
 * `safePath` above is lexical. A symlink planted inside the server directory
 * that points outside passes it, and then every write, delete or rename below
 * would follow it out of the sandbox — the panel can plant such links on its
 * own behalf (a game template shipping a symlink), and the file manager is the
 * one surface where a `servers.files` grant reaches arbitrary disk.
 *
 * This resolves the real path of the longest existing ancestor first, so the
 * containment check is made against what the filesystem will actually touch.
 * The base itself is resolved too, so a server directory that is itself a
 * symlink (Docker volumes, moved installs) does not fail every operation.
 */
export async function resolveSafePath(
  basePath: string,
  requestedPath: string
): Promise<ResolvedServerPath | null> {
  const base = resolveBasePath(basePath);
  const resolved = resolve(/* turbopackIgnore: true */ base, requestedPath || ".");
  if (resolved !== base && !resolved.startsWith(base + sep)) return null;

  let realBase: string;
  try {
    realBase = await realpath(base);
  } catch {
    // The root does not exist yet — the panel creates it on demand. Fall back
    // to the lexical base; the containment check below still applies.
    realBase = base;
  }

  // Walk up to the longest existing ancestor, resolve THAT, and re-append the
  // non-existent tail so creating new files still works.
  let probe = resolved;
  const tail: string[] = [];
  for (let i = 0; i < 64; i++) {
    if (await pathExists(probe)) break;
    const parent = dirname(probe);
    if (parent === probe) break; // reached the filesystem root
    tail.unshift(basename(probe));
    probe = parent;
  }

  let real: string;
  try {
    real = await realpath(probe);
  } catch {
    return null;
  }
  // A symlinked segment that lands outside the base — or inside a *different*
  // server's directory under the same parent — makes the path unsafe.
  if (real !== realBase && !real.startsWith(realBase + sep)) return null;

  const fullPath = tail.length > 0 ? join(/* turbopackIgnore: true */ real, ...tail) : real;
  return { realBase, fullPath, relPath: relative(realBase, fullPath) || "." };
}

/**
 * Synchronous variant of `resolveSafePath`, for callers that cannot await —
 * notably the FTP virtual-path resolver, which runs on every FTP command.
 *
 * Same rule and the same check; only the fs calls are sync. Without this the
 * FTP LIST/RETR/DELE paths would follow a symlink planted inside a server
 * directory out of the sandbox, exactly the hole `resolveSafePath` closed for
 * the web file manager.
 */
export function resolveSafePathSync(
  basePath: string,
  requestedPath: string
): ResolvedServerPath | null {
  const base = resolveBasePath(basePath);
  const resolved = resolve(/* turbopackIgnore: true */ base, requestedPath || ".");
  if (resolved !== base && !resolved.startsWith(base + sep)) return null;

  let realBase: string;
  try {
    realBase = realpathSync(base);
  } catch {
    realBase = base;
  }

  // Walk up to the longest existing ancestor, resolve THAT, re-append the
  // non-existent tail.
  let probe = resolved;
  const tail: string[] = [];
  for (let i = 0; i < 64; i++) {
    try {
      statSync(probe);
      break;
    } catch {
      const parent = dirname(probe);
      if (parent === probe) break; // reached the filesystem root
      tail.unshift(basename(probe));
      probe = parent;
    }
  }

  let real: string;
  try {
    real = realpathSync(probe);
  } catch {
    return null;
  }
  if (real !== realBase && !real.startsWith(realBase + sep)) return null;

  const fullPath = tail.length > 0 ? join(/* turbopackIgnore: true */ real, ...tail) : real;
  return { realBase, fullPath, relPath: relative(realBase, fullPath) || "." };
}

function relativePath(basePath: string, absolutePath: string): string {
  return relative(resolveBasePath(basePath), absolutePath) || ".";
}

/** Path of an absolute path relative to a server root ("" for the root). */
export function relativePathOf(basePath: string, absolutePath: string): string {
  return relativePath(basePath, absolutePath);
}

/** Is the resolved path the server root itself? */
export function isRootPath(resolved: ResolvedServerPath): boolean {
  return resolved.fullPath === resolved.realBase;
}

export async function getPathStat(basePath: string, requestedPath: string) {
  const resolved = await resolveSafePath(basePath, requestedPath);
  if (!resolved) throw new Error("Path outside server directory");
  const s = await stat(resolved.fullPath);
  return { fullPath: resolved.fullPath, stat: s, relPath: resolved.relPath };
}

export async function readBinary(basePath: string, requestedPath: string) {
  const { fullPath } = await getPathStat(basePath, requestedPath);
  const content = await readFile(fullPath);
  return { content, fileName: basename(fullPath) };
}

export async function readText(basePath: string, requestedPath: string, maxBytes = 2 * 1024 * 1024) {
  const { fullPath, stat: s, relPath } = await getPathStat(basePath, requestedPath);

  if (!s.isFile()) {
    throw new Error("Path is not a file");
  }

  if (s.size > maxBytes) {
    // A multi-megabyte SQLite database is "too large" for the text editor
    // but opens fine in the database browser, which pages through it without
    // loading it into memory. Peek at the header so the UI can offer that.
    let sqlite = false;
    try {
      const fh = await open(fullPath, "r");
      try {
        const head = Buffer.alloc(16);
        await fh.read(head, 0, 16, 0);
        sqlite = isSqliteBytes(head);
      } finally {
        await fh.close();
      }
    } catch {
      sqlite = false;
    }
    return {
      type: "file" as const,
      path: relPath,
      name: basename(fullPath),
      size: s.size,
      tooLarge: true,
      sqlite,
      content: null,
    };
  }

  // Sniff the real bytes before decoding. Reading a binary file as utf8
  // turns every undecodable byte into U+FFFD, and saving writes those
  // replacements back over the original -- silent, unrecoverable corruption.
  const raw = await readFile(fullPath);
  const check = looksLikeText(
    new Uint8Array(raw.buffer, raw.byteOffset, Math.min(raw.length, 8192)),
    basename(fullPath)
  );
  if (!check.isText) {
    return {
      type: "file" as const,
      path: relPath,
      name: basename(fullPath),
      size: s.size,
      modified: s.mtime.toISOString(),
      binary: true as const,
      reason: check.reason,
      // Lets the file manager offer "Open as database" for SQLite files
      // regardless of extension (some games use extensionless sidecars).
      sqlite: isSqliteBytes(raw.subarray(0, 16)),
      content: null,
    };
  }

  return {
    type: "file" as const,
    path: relPath,
    name: basename(fullPath),
    size: s.size,
    modified: s.mtime.toISOString(),
    content: raw.toString("utf8"),
  };
}

export async function listDirectory(basePath: string, requestedPath: string) {
  const resolved = await resolveSafePath(basePath, requestedPath);
  if (!resolved) throw new Error("Path outside server directory");
  const entries = await readdir(resolved.fullPath, { withFileTypes: true });

  const items: ServerFileItem[] = [];
  for (const entry of entries) {
    try {
      const entryPath = join(/* turbopackIgnore: true */ resolved.fullPath, entry.name);
      const entryStat = await stat(entryPath);
      items.push({
        name: entry.name,
        path: relative(resolved.realBase, entryPath) || ".",
        isDir: entry.isDirectory(),
        size: entryStat.size,
        modified: entryStat.mtime.toISOString(),
        ext: entry.isFile() ? extname(entry.name).slice(1) : null,
      });
    } catch {
      items.push({
        name: entry.name,
        path: entry.name,
        isDir: entry.isDirectory(),
        size: 0,
        modified: "",
        ext: null,
      });
    }
  }

  items.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return {
    type: "directory" as const,
    path: resolved.relPath,
    items,
    basePath,
  };
}

export async function writeTextFile(basePath: string, requestedPath: string, content: string) {
  const resolved = await resolveSafePath(basePath, requestedPath);
  if (!resolved) throw new Error("Path outside server directory");

  // Refuse to overwrite a file the editor should never have opened. Without
  // this, a client that skips the read (or an out-of-date tab) can replace a
  // binary with its mojibake transcription.
  try {
    const existing = await readFile(resolved.fullPath);
    if (existing.length > 0) {
      const check = looksLikeText(
        new Uint8Array(existing.buffer, existing.byteOffset, Math.min(existing.length, 8192)),
        basename(resolved.fullPath)
      );
      if (!check.isText) {
        throw new Error("Refusing to overwrite a binary file with text");
      }
    }
  } catch (e) {
    // A missing file is fine -- this is how new files are created.
    if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") throw e;
  }

  await writeFile(resolved.fullPath, content, "utf8");
}

export async function createDirectory(basePath: string, requestedPath: string) {
  const resolved = await resolveSafePath(basePath, requestedPath);
  if (!resolved) throw new Error("Path outside server directory");
  await mkdir(resolved.fullPath, { recursive: true });
}

export async function deletePath(basePath: string, requestedPath: string) {
  const resolved = await resolveSafePath(basePath, requestedPath);
  if (!resolved) throw new Error("Path outside server directory");
  if (isRootPath(resolved)) throw new Error("Cannot delete root");
  await rm(resolved.fullPath, { recursive: true, force: true });
}

export async function renamePath(basePath: string, fromPath: string, toPath: string) {
  const from = await resolveSafePath(basePath, fromPath);
  const to = await resolveSafePath(basePath, toPath);
  if (!from || !to) throw new Error("Path outside server directory");
  if (isRootPath(from)) throw new Error("Cannot move root");
  await mkdir(dirname(to.fullPath), { recursive: true });
  await rename(from.fullPath, to.fullPath);
}

export async function deleteMany(basePath: string, paths: string[]): Promise<ServerFileBatchResult> {
  const failed: Array<{ path: string; error: string }> = [];
  let deleted = 0;

  for (const p of paths) {
    try {
      await deletePath(basePath, p);
      deleted += 1;
    } catch (e: unknown) {
      failed.push({ path: p, error: e instanceof Error ? e.message : "Failed" });
    }
  }

  return { ok: failed.length === 0, deleted, failed };
}

export async function moveMany(basePath: string, paths: string[], targetDir: string): Promise<ServerFileBatchResult> {
  const failed: Array<{ path: string; error: string }> = [];
  let moved = 0;

  const target = await resolveSafePath(basePath, targetDir || ".");
  if (!target) {
    return { ok: false, moved, failed: [{ path: targetDir, error: "Target path outside server directory" }] };
  }

  await mkdir(target.fullPath, { recursive: true });

  for (const p of paths) {
    try {
      const source = await resolveSafePath(basePath, p);
      if (!source) throw new Error("Path outside server directory");
      if (isRootPath(source)) throw new Error("Cannot move root");
      const destinationPath = join(/* turbopackIgnore: true */ target.fullPath, basename(source.fullPath));
      if (resolve(/* turbopackIgnore: true */ destinationPath) === resolve(/* turbopackIgnore: true */ source.fullPath)) {
        throw new Error("Source and destination are identical");
      }
      await rename(source.fullPath, destinationPath);
      moved += 1;
    } catch (e: unknown) {
      failed.push({ path: p, error: e instanceof Error ? e.message : "Failed" });
    }
  }

  return { ok: failed.length === 0, moved, failed };
}

export async function saveUploadedFile(basePath: string, targetDir: string, fileName: string, bytes: Buffer) {
  const resolved = await resolveSafePath(basePath, join(/* turbopackIgnore: true */ targetDir || ".", fileName));
  if (!resolved) throw new Error("Path outside server directory");

  await mkdir(dirname(resolved.fullPath), { recursive: true });
  await writeFile(resolved.fullPath, bytes);

  return {
    name: fileName,
    size: bytes.length,
    path: resolved.relPath,
  };
}
