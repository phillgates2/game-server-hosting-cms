/**
 * Tests for the install-time access key check (pure layer).
 *
 * The contract: a master-key-configured panel cannot be installed without
 * the exact key; panels without a master key keep the open first install.
 *
 *   npm test
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { checkInstallAccessKey, INSTALL_KEY_MIN_LENGTH } from "../src/lib/access-keys";

const MASTER = "correct-horse-battery-staple"; // >= 16 chars

describe("checkInstallAccessKey", () => {
  test("no master key configured: first install stays open", () => {
    assert.deepEqual(
      checkInstallAccessKey({ masterKeyConfigured: false, masterKey: null, presented: undefined }),
      { ok: true }
    );
    assert.deepEqual(
      checkInstallAccessKey({ masterKeyConfigured: false, masterKey: null, presented: "anything" }),
      { ok: true }
    );
  });

  test("master key configured: exact key opens the install", () => {
    const r = checkInstallAccessKey({ masterKeyConfigured: true, masterKey: MASTER, presented: MASTER });
    assert.equal(r.ok, true);
  });

  test("master key configured: surrounding whitespace is trimmed", () => {
    assert.equal(checkInstallAccessKey({ masterKeyConfigured: true, masterKey: MASTER, presented: `  ${MASTER}  ` }).ok, true);
  });

  test("master key configured: missing/short/wrong keys refused with reasons", () => {
    assert.equal(checkInstallAccessKey({ masterKeyConfigured: true, masterKey: MASTER, presented: undefined }).ok, false);
    assert.equal(checkInstallAccessKey({ masterKeyConfigured: true, masterKey: MASTER, presented: "" }).ok, false);
    assert.equal(checkInstallAccessKey({ masterKeyConfigured: true, masterKey: MASTER, presented: "short" }).ok, false);
    assert.equal(checkInstallAccessKey({ masterKeyConfigured: true, masterKey: MASTER, presented: "wrong-key-entirely-1234" }).ok, false);
    assert.equal(checkInstallAccessKey({ masterKeyConfigured: true, masterKey: MASTER, presented: 12345678901234567 }).ok, false);
  });

  test("case matters — keys are exact secrets, not case-insensitive codes", () => {
    assert.equal(checkInstallAccessKey({ masterKeyConfigured: true, masterKey: MASTER, presented: MASTER.toUpperCase() }).ok, false);
  });

  test("configured flag with null master key still refuses (fail closed)", () => {
    assert.equal(checkInstallAccessKey({ masterKeyConfigured: true, masterKey: null, presented: MASTER }).ok, false);
  });

  test("minimum length constant is sane", () => {
    assert.ok(INSTALL_KEY_MIN_LENGTH >= 12);
  });
});
