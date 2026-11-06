import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * The updater installs the helper that makes the panel's Updates tab work. The
 * operator learns it happened from one line of output, so these tests run that
 * line: first-time install vs routine refresh, the quiet retry before the pull,
 * and the two ways it can fail (no template, sudoers rejected by visudo).
 *
 * The real functions are extracted from public/update.sh and run against a
 * temporary "system": `chown` and `visudo` are stubbed because the test is not
 * root, everything else (sed, chmod, mv) is the real thing.
 */

async function loadHelperFunctions(): Promise<string> {
  const updater = await readFile(new URL("../public/update.sh", import.meta.url), "utf8");
  // From the sed helper, because the installer renders the template with it.
  const start = updater.indexOf("sed_replacement() {");
  const end = updater.indexOf("report_self_update_helper early");
  assert.ok(start > 0 && end > start, "the helper installer must exist in update.sh");
  return updater.slice(start, end);
}

interface RunOptions {
  /** "early" before the pull, "final" after it. */
  phase: "early" | "final";
  /** Pre-create the wrapper + sudoers, as an existing install would have them. */
  alreadyInstalled?: boolean;
  /** Leave the template (public/gsm-self-update.sh) out of the checkout. */
  withoutTemplate?: boolean;
  /** Exit code the stubbed visudo returns. */
  visudoResult?: number;
  /** Simulate a render that does not produce the install's own path. */
  breakRender?: boolean;
}

async function runHelper(options: RunOptions) {
  const dir = await mkdtemp(join(tmpdir(), "gsm-helper-install-"));
  const installDir = join(dir, "install");
  const template = join(installDir, "public", "gsm-self-update.sh");
  const wrapper = join(dir, "gsm-self-update");
  const sudoers = join(dir, "gsm-panel-update");

  await mkdir(join(installDir, "public"), { recursive: true });
  if (!options.withoutTemplate) {
    await copyFile(new URL("../public/gsm-self-update.sh", import.meta.url), template);
  }
  if (options.alreadyInstalled) {
    await writeFile(wrapper, "# previous wrapper\n");
    await writeFile(sudoers, "# previous rule\n");
  }

  const functions = await loadHelperFunctions();
  const script = [
    "set -euo pipefail",
    `INSTALL_DIR=${JSON.stringify(installDir)}`,
    "GSM_USER=gsm",
    `SELF_UPDATE_WRAPPER=${JSON.stringify(wrapper)}`,
    `SELF_UPDATE_SUDOERS=${JSON.stringify(sudoers)}`,
    `SELF_UPDATE_TEMPLATE=${JSON.stringify(template)}`,
    `VISUDO_RESULT=${options.visudoResult ?? 0}`,
    'log() { echo "[GSM] $*"; }',
    'ok() { echo "[OK] $*"; }',
    'warn() { echo "[!] $*"; }',
    "chown() { :; }",
    'visudo() { return "$VISUDO_RESULT"; }',
    functions,
    // Redefining after the extraction simulates a substitution that produced
    // nothing (a missing helper, an unexpected template).
    options.breakRender ? 'sed_replacement() { printf \'\'; }' : "",
    `report_self_update_helper ${options.phase}`,
  ].join("\n");

  let stdout = "";
  let stderr = "";
  let code = 0;
  try {
    const result = await execFileAsync("/bin/bash", ["-c", script], { timeout: 10_000 });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    code = e.code ?? 1;
    stdout = e.stdout ?? "";
    stderr = e.stderr ?? "";
  }

  const exists = async (path: string) => {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  };
  const result = {
    code,
    stdout,
    stderr,
    wrapperInstalled: await exists(wrapper),
    sudoersInstalled: await exists(sudoers),
    wrapperContents: (await exists(wrapper)) ? await readFile(wrapper, "utf8") : "",
  };

  await rm(dir, { recursive: true, force: true });
  return result;
}

test("a first-time install announces the Updates tab and where to find it", async () => {
  const result = await runHelper({ phase: "final" });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Panel update helper installed/);
  assert.match(result.stdout, /Administration → Updates once this update has finished/);
  assert.doesNotMatch(result.stdout, /refreshed/, "a first install is not a refresh");
  assert.ok(result.wrapperInstalled, "the wrapper must actually be written");
  assert.ok(result.sudoersInstalled, "the sudo rule must actually be written");
  // The rendered helper points at this install, not a guessed path.
  assert.match(result.wrapperContents, /UPDATER='.*\/install\/public\/update\.sh'/);
  assert.doesNotMatch(result.wrapperContents, /@INSTALL_DIR@/);
});

test("a routine update says refreshed instead of announcing the tab again", async () => {
  const result = await runHelper({ phase: "final", alreadyInstalled: true });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Panel update helper refreshed/);
  assert.doesNotMatch(result.stdout, /installed — this panel can update itself/);
});

test("before the pull, a missing template is quiet because the retry is still to come", async () => {
  const result = await runHelper({ phase: "early", withoutTemplate: true });
  assert.equal(result.code, 0);
  assert.doesNotMatch(result.stdout, /will stay disabled/);
  assert.doesNotMatch(result.stdout, /installed/);
  assert.equal(result.wrapperInstalled, false);
});

test("after the pull, a missing template is reported with a way forward", async () => {
  const result = await runHelper({ phase: "final", withoutTemplate: true });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /not installed/);
  assert.match(result.stdout, /missing from this checkout/);
  assert.match(result.stdout, /then re-run: sudo bash .*install\/public\/update\.sh/);
});

test("a rejected sudoers file is reported and leaves nothing behind", async () => {
  const result = await runHelper({ phase: "final", visudoResult: 1 });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /Could not install the panel update helper/);
  assert.match(result.stdout, /Updates tab will stay disabled/);
  assert.match(result.stdout, /then re-run: sudo bash/);
  assert.equal(result.sudoersInstalled, false, "an invalid sudoers file must never be installed");
});

test("a render that misses this install is refused, never installed", async () => {
  const result = await runHelper({ phase: "final", breakRender: true });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /does not point at/);
  assert.match(result.stdout, /Updates tab will stay disabled/);
  assert.equal(result.wrapperInstalled, false, "the broken helper must be removed");
  assert.equal(result.sudoersInstalled, false, "and no sudo rule may be written for it");
});

test("the updater never announces the helper without installing it", async () => {
  const updater = await readFile(new URL("../public/update.sh", import.meta.url), "utf8");
  const body = updater.slice(
    updater.indexOf("report_self_update_helper() {"),
    updater.indexOf("report_self_update_helper early")
  );
  const announce = body.indexOf("Panel update helper installed");
  const successGuard = body.indexOf('if [[ $status -eq 0 ]]');
  assert.ok(announce > successGuard, "the announcement lives inside the success branch");
  assert.match(updater, /report_self_update_helper early/);
  assert.match(updater, /report_self_update_helper final/);
});
