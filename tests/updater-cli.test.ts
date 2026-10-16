import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

const updater = join(process.cwd(), "public/update.sh");
const installer = join(process.cwd(), "public/install.sh");

function runUpdater(...args: string[]) {
  return spawnSync("bash", [updater, ...args], { encoding: "utf8" });
}

test("panel updater CLI validates options before touching the installation", async (t) => {
  await t.test("help is available without an installed panel", () => {
    const result = runUpdater("--help");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /GameServer Manager — Updater/);
    assert.match(result.stdout, /--install-dir DIR/);
  });

  await t.test("missing option values fail with a useful message", () => {
    const branch = runUpdater("--branch");
    assert.notEqual(branch.status, 0);
    assert.match(branch.stderr, /--branch requires a branch name/);

    const installDir = runUpdater("--install-dir");
    assert.notEqual(installDir.status, 0);
    assert.match(installDir.stderr, /--install-dir requires a path/);
  });

  await t.test("invalid Git branch names are rejected", () => {
    const result = runUpdater("--branch", "bad..branch");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Invalid branch name/);
  });

  await t.test("updater and installer wrapper remain valid Bash", () => {
    for (const path of [updater, installer]) {
      const result = spawnSync("bash", ["-n", path], { encoding: "utf8" });
      assert.equal(result.status, 0, `${path}: ${result.stderr}`);
    }
  });

  await t.test("updater uses the fetched ref and never sources install metadata", () => {
    const source = readFileSync(updater, "utf8");
    assert.match(source, /ORIGINAL_ARGS=\("\$@"\)/);
    assert.match(source, /"\$\{ORIGINAL_ARGS\[@\]\}"/);
    assert.match(source, /UPDATE_SCRIPT_URL="https:\/\/raw\.githubusercontent\.com\/phillgates2\/game-server-hosting-cms\/\$BRANCH\/public\/update\.sh"/);
    assert.match(source, /FETCH_REFSPEC="\+refs\/heads\/\$BRANCH:\$REMOTE_REF"/);
    assert.match(source, /git show "\$REMOTE_REF:public\/update\.sh"/);
    assert.match(source, /GSM_UPDATER_REFRESHED/);
    assert.match(source, /git checkout --force -B "\$BRANCH" "\$REMOTE_REF"/);
    assert.doesNotMatch(source, /source\s+"\$INSTALL_DIR\/.install-info"/);
    assert.match(source, /Database migration failed!/);
    assert.match(source, /The update was installed but the panel did not become healthy/);
  });

  await t.test("gsm wrapper embeds the install directory and quotes update arguments", () => {
    const source = readFileSync(installer, "utf8");
    assert.match(source, /printf 'GSM_INSTALL_DIR=%q\\n' "\$INSTALL_DIR"/);
    assert.match(source, /bash "\$GSM_INSTALL_DIR\/public\/update\.sh" "\$\{@:2\}"/);
  });
});
