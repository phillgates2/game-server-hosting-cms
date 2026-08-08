import { readdir, stat, readFile, writeFile, mkdir, rm, rename } from "node:fs/promises";
import { join, resolve, relative, extname, basename, dirname } from "node:path";

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

export function safePath(basePath: string, requestedPath: string): string | null {
  const base = resolveBasePath(basePath);
  const resolved = resolve(/* turbopackIgnore: true */ base, requestedPath || ".");
  if (!resolved.startsWith(base)) return null;
  return resolved;
}

function relativePath(basePath: string, absolutePath: string): string {
  return relative(resolveBasePath(basePath), absolutePath) || ".";
}

export function isRootPath(basePath: string, fullPath: string): boolean {
  return resolveBasePath(basePath) === resolve(/* turbopackIgnore: true */ fullPath);
}

export async function getPathStat(basePath: string, requestedPath: string) {
  const fullPath = safePath(basePath, requestedPath);
  if (!fullPath) throw new Error("Path outside server directory");
  const s = await stat(fullPath);
  return { fullPath, stat: s, relPath: relativePath(basePath, fullPath) };
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
    return {
      type: "file" as const,
      path: relPath,
      name: basename(fullPath),
      size: s.size,
      tooLarge: true,
      content: null,
    };
  }

  const content = await readFile(fullPath, "utf8");
  return {
    type: "file" as const,
    path: relPath,
    name: basename(fullPath),
    size: s.size,
    modified: s.mtime.toISOString(),
    content,
  };
}

export async function listDirectory(basePath: string, requestedPath: string) {
  const { fullPath } = await getPathStat(basePath, requestedPath);
  const entries = await readdir(fullPath, { withFileTypes: true });

  const items: ServerFileItem[] = [];
  for (const entry of entries) {
    try {
      const entryPath = join(/* turbopackIgnore: true */ fullPath, entry.name);
      const entryStat = await stat(entryPath);
      items.push({
        name: entry.name,
        path: relativePath(basePath, entryPath),
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
    path: relativePath(basePath, fullPath),
    items,
    basePath,
  };
}

export async function writeTextFile(basePath: string, requestedPath: string, content: string) {
  const fullPath = safePath(basePath, requestedPath);
  if (!fullPath) throw new Error("Path outside server directory");
  await writeFile(fullPath, content, "utf8");
}

export async function createDirectory(basePath: string, requestedPath: string) {
  const fullPath = safePath(basePath, requestedPath);
  if (!fullPath) throw new Error("Path outside server directory");
  await mkdir(fullPath, { recursive: true });
}

export async function deletePath(basePath: string, requestedPath: string) {
  const fullPath = safePath(basePath, requestedPath);
  if (!fullPath) throw new Error("Path outside server directory");
  if (isRootPath(basePath, fullPath)) throw new Error("Cannot delete root");
  await rm(fullPath, { recursive: true, force: true });
}

export async function renamePath(basePath: string, fromPath: string, toPath: string) {
  const fullPath = safePath(basePath, fromPath);
  const fullNewPath = safePath(basePath, toPath);
  if (!fullPath || !fullNewPath) throw new Error("Path outside server directory");
  if (isRootPath(basePath, fullPath)) throw new Error("Cannot move root");
  await mkdir(dirname(fullNewPath), { recursive: true });
  await rename(fullPath, fullNewPath);
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

  const fullTargetDir = safePath(basePath, targetDir || ".");
  if (!fullTargetDir) {
    return { ok: false, moved, failed: [{ path: targetDir, error: "Target path outside server directory" }] };
  }

  await mkdir(fullTargetDir, { recursive: true });

  for (const p of paths) {
    try {
      const sourcePath = safePath(basePath, p);
      if (!sourcePath) throw new Error("Path outside server directory");
      if (isRootPath(basePath, sourcePath)) throw new Error("Cannot move root");
      const destinationPath = join(/* turbopackIgnore: true */ fullTargetDir, basename(sourcePath));
      if (resolve(/* turbopackIgnore: true */ destinationPath) === resolve(/* turbopackIgnore: true */ sourcePath)) {
        throw new Error("Source and destination are identical");
      }
      await rename(sourcePath, destinationPath);
      moved += 1;
    } catch (e: unknown) {
      failed.push({ path: p, error: e instanceof Error ? e.message : "Failed" });
    }
  }

  return { ok: failed.length === 0, moved, failed };
}

export async function saveUploadedFile(basePath: string, targetDir: string, fileName: string, bytes: Buffer) {
  const targetPath = safePath(basePath, join(/* turbopackIgnore: true */ targetDir || ".", fileName));
  if (!targetPath) throw new Error("Path outside server directory");

  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, bytes);

  return {
    name: fileName,
    size: bytes.length,
    path: relativePath(basePath, targetPath),
  };
}
