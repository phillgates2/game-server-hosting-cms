/**
 * Panel addresses (`#panel/servers`).
 *
 * The dashboard and the public site share one URL, so the panel's hashes are
 * namespaced and must never be confused with the site's own (`#forums`,
 * `#ladder`, `#post/12`). Anything that is not a real panel address has to come
 * back as null — the caller then leaves the operator where they are instead of
 * opening a panel that does not exist or that their account cannot use.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  PANEL_HASH_PREFIX,
  panelAddressHash,
  panelHash,
  parsePanelAddress,
  parsePanelHash,
} from "../src/lib/panel-url";

const PANEL_KEYS = [
  "overview",
  "servers",
  "files",
  "transfer",
  "rcon",
  "nodes",
  "games",
  "audit",
  "monitor",
  "shop",
  "forum",
  "cms",
  "ladder",
  "users",
  "roles",
  "profile",
  "database",
  "activity",
  "scheduler",
  "apikeys",
  "licenses",
  "settings",
];

describe("panel hashes", () => {
  test("every panel survives a refresh", () => {
    for (const key of PANEL_KEYS) {
      const hash = panelHash(key);
      assert.equal(hash, `${PANEL_HASH_PREFIX}${key}`);
      assert.equal(parsePanelHash(hash), key);
    }
  });

  test("is case-insensitive and tolerates a trailing slash or query", () => {
    assert.equal(parsePanelHash("#panel/SERVERS"), "servers");
    assert.equal(parsePanelHash("#panel/servers/"), "servers");
    assert.equal(parsePanelHash("#panel/settings?tab=access"), "settings");
    assert.equal(parsePanelHash("  #panel/monitor  "), "monitor");
  });

  test("public-site hashes are not panel hashes", () => {
    for (const hash of ["#forums", "#ladder", "#post/12", "#thread/9", "#shop", "#home", "", "#"]) {
      assert.equal(parsePanelHash(hash), null, `${hash || "empty"} must not select a panel`);
    }
    assert.equal(parsePanelHash(null), null);
    assert.equal(parsePanelHash(undefined), null);
  });

  test("junk after the prefix is rejected rather than guessed at", () => {
    for (const hash of [
      "#panel",
      "#panel/",
      "#panel/../etc/passwd",
      "#panel/a b",
      "#panel/-leading-dash",
      "#panel/9lives",
      `#panel/${"x".repeat(40)}`,
      "#panel/ünïcode",
    ]) {
      assert.equal(parsePanelHash(hash), null, `${hash} is not a panel`);
    }
  });

  test("the two address spaces cannot collide", () => {
    // `#panel/shop` is the panel; `#shop` is the public storefront.
    assert.equal(parsePanelHash(panelHash("shop")), "shop");
    assert.equal(parsePanelHash("#shop"), null);
  });
});

describe("inner panel state", () => {
  test("the file manager can address a server and a folder", () => {
    const hash = panelAddressHash("files", ["12", "plugins/config"]);
    assert.equal(hash, "#panel/files/12/plugins%2Fconfig");

    const address = parsePanelAddress(hash);
    assert.equal(address?.tab, "files");
    assert.deepEqual(address?.parts, ["12", "plugins/config"]);
  });

  test("paths survive spaces, unicode and separators", () => {
    const path = "world/Ünïcode map & café";
    const address = parsePanelAddress(panelAddressHash("files", ["3", path]));
    assert.deepEqual(address?.parts, ["3", path]);
  });

  test("decoded parts are bounded, so a link cannot smuggle in junk", () => {
    const long = parsePanelAddress(`#panel/files/12/${"a".repeat(300)}`);
    assert.deepEqual(long?.parts, ["12"]);

    const control = parsePanelAddress("#panel/files/12/%00%07");
    assert.deepEqual(control?.parts, ["12"]);

    // A broken escape sequence is kept verbatim rather than throwing.
    assert.deepEqual(parsePanelAddress("#panel/files/12/100%")?.parts, ["12", "100%"]);
  });

  test("the tab alone still parses when there is no inner state", () => {
    assert.deepEqual(parsePanelAddress("#panel/files"), { tab: "files", parts: [] });
    assert.equal(parsePanelHash("#panel/files"), "files");
    assert.equal(panelAddressHash("files"), "#panel/files");
  });

  test("an inner path never leaks into the public site's namespace", () => {
    assert.equal(parsePanelAddress("#files/12"), null);
    assert.equal(parsePanelAddress("#post/12"), null);
  });
});
