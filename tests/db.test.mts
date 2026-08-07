import test from "node:test";
import assert from "node:assert/strict";

test("db module can be imported without DATABASE_URL", async () => {
  const original = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;

  try {
    const mod = await import(`../src/db/index.ts?test=${Date.now()}`);
    assert.ok(mod.db);
  } finally {
    if (original) process.env.DATABASE_URL = original;
  }
});
