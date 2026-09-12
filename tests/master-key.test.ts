/**
 * Tests for the unified master key (pure layer).
 *
 *   npm test
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  generateMasterKey,
  hashMasterKey,
  looksLikeMasterKey,
  masterKeyFromRequest,
  MASTER_KEY_PREFIX,
  MASTER_KEY_HEADER,
} from "../src/lib/master-key";

describe("generateMasterKey / format", () => {
  test("keys carry the prefix and are unique", async () => {
    const a = await generateMasterKey();
    const b = await generateMasterKey();
    assert.ok(a.startsWith(`${MASTER_KEY_PREFIX}-`));
    assert.equal(a.length, MASTER_KEY_PREFIX.length + 1 + 48);
    assert.notEqual(a, b);
  });

  test("hashing is stable and looks-like guards junk", async () => {
    const key = await generateMasterKey();
    assert.equal(await hashMasterKey(key), await hashMasterKey(`  ${key}  `));
    assert.equal(looksLikeMasterKey(key), true);
    assert.equal(looksLikeMasterKey("short"), false);
    assert.equal(looksLikeMasterKey(null), false);
    assert.equal(looksLikeMasterKey(1234567890123456), false);
  });
});

describe("masterKeyFromRequest", () => {
  test("reads and trims the header, null otherwise", () => {
    const req = (v: string | null) => ({ headers: { get: (n: string) => (n === MASTER_KEY_HEADER ? v : null) } });
    assert.equal(masterKeyFromRequest(req("  GSM-test  ")), "GSM-test");
    assert.equal(masterKeyFromRequest(req("")), null);
    assert.equal(masterKeyFromRequest(req(null)), null);
  });
});

describe("verifyMasterKey (env path)", () => {
  test("env master key verifies; wrong keys fail closed", async () => {
    const { verifyMasterKey } = await import("../src/lib/master-key");
    process.env.GSM_PANEL_MASTER_KEY = "env-master-key-that-is-long-enough";
    try {
      assert.equal(await verifyMasterKey("env-master-key-that-is-long-enough"), true);
      assert.equal(await verifyMasterKey("env-master-key-that-is-long-eno-gh"), false);
      assert.equal(await verifyMasterKey(""), false);
      assert.equal(await verifyMasterKey(null), false);
    } finally {
      delete process.env.GSM_PANEL_MASTER_KEY;
    }
  });

  test("short env keys are not treated as master keys", async () => {
    const { verifyMasterKey } = await import("../src/lib/master-key");
    process.env.GSM_PANEL_MASTER_KEY = "tiny";
    try {
      assert.equal(await verifyMasterKey("tiny"), false);
    } finally {
      delete process.env.GSM_PANEL_MASTER_KEY;
    }
  });
});

describe("planMasterBootstrap", () => {
  test("fresh master: everything gets created", async () => {
    const { planMasterBootstrap } = await import("../src/lib/master-key");
    const plan = planMasterBootstrap({ envMasterKey: false, storedMasterKey: false, signingKeyPresent: false, productCount: 0 });
    assert.deepEqual(plan, { generateMasterKey: true, createSigningKey: true, seedStarterProduct: true });
  });

  test("env key present: no new key, rest still seeded", async () => {
    const { planMasterBootstrap } = await import("../src/lib/master-key");
    const plan = planMasterBootstrap({ envMasterKey: true, storedMasterKey: false, signingKeyPresent: false, productCount: 0 });
    assert.equal(plan.generateMasterKey, false);
    assert.equal(plan.createSigningKey, true);
    assert.equal(plan.seedStarterProduct, true);
  });

  test("re-run: nothing duplicated", async () => {
    const { planMasterBootstrap } = await import("../src/lib/master-key");
    const plan = planMasterBootstrap({ envMasterKey: false, storedMasterKey: true, signingKeyPresent: true, productCount: 3 });
    assert.deepEqual(plan, { generateMasterKey: false, createSigningKey: false, seedStarterProduct: false });
  });
});
