import { access } from 'fs/promises';
import { join } from 'path';

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'server';
}

export async function buildUniqueServerPath(
  basePath: string,
  gameSlug: string,
  serverName: string,
  reservedPaths: string[] = [],
  existsOnDisk: (candidate: string) => Promise<boolean> = async (candidate) => {
    try {
      await access(candidate);
      return true;
    } catch {
      return false;
    }
  }
) {
  const safeGame = slugify(gameSlug || 'game');
  const safeName = slugify(serverName);
  const used = new Set(reservedPaths);

  let candidate = join(basePath, safeGame, safeName);
  let i = 2;

  while (used.has(candidate) || (await existsOnDisk(candidate))) {
    candidate = join(basePath, safeGame, `${safeName}-${i}`);
    i += 1;
  }

  return candidate;
}
