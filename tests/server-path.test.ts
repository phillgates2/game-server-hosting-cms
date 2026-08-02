import test from 'node:test';
import assert from 'node:assert/strict';

import { buildUniqueServerPath } from '../src/lib/server-path';

test('buildUniqueServerPath avoids a path that already exists on disk or in the database', async () => {
  const reserved = ['/srv/games/ark/main'];
  const result = await buildUniqueServerPath('/srv/games', 'ARK', 'Main', reserved, async (candidate) => {
    return candidate === '/srv/games/ark/main';
  });

  assert.equal(result, '/srv/games/ark/main-2');
});
