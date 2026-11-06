import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * The wrapper is the whole security boundary between the panel's update button
 * and root, so it is tested by running it — against a stand-in updater that
 * prints the arguments it was given.
 */

async function renderWrapper(): Promise<{ dir: string; wrapper: string }> {
  const template = await readFile(
    new URL("../public/gsm-self-update.sh", import.meta.url),
    "utf8"
  );
  const dir = await mkdtemp(join(tmpdir(), "gsm-self-update-"));
  await mkdir(join(dir, "public"), { recursive: true });
  await writeFile(
    join(dir, "public", "update.sh"),
    '#!/usr/bin/env bash\necho "UPDATER-ARGS:$*"\n',
    { mode: 0o755 }
  );

  const wrapperPath = join(dir, "gsm-self-update");
  await writeFile(wrapperPath, template.split("@INSTALL_DIR@").join(dir), { mode: 0o755 });
  return { dir, wrapper: wrapperPath };
}

async function run(wrapper: string, args: string[]) {
  try {
    const { stdout, stderr } = await execFileAsync("/bin/bash", [wrapper, ...args], {
      timeout: 10_000,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

test("the helper runs the install's own updater with --force", async () => {
  const { dir, wrapper } = await renderWrapper();
  try {
    const result = await run(wrapper, []);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /UPDATER-ARGS:--force$/m);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the helper forwards --no-backup and nothing else", async () => {
  const { dir, wrapper } = await renderWrapper();
  try {
    const result = await run(wrapper, ["--no-backup"]);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /UPDATER-ARGS:--force --no-backup$/m);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the helper refuses to be steered at another install directory", async () => {
  const { dir, wrapper } = await renderWrapper();
  try {
    const alone = await run(wrapper, ["--install-dir"]);
    assert.equal(alone.code, 2);
    assert.match(alone.stderr, /refusing unknown argument: --install-dir/);
    assert.doesNotMatch(alone.stdout, /UPDATER-ARGS/);

    const withValue = await run(wrapper, ["--install-dir", "/etc"]);
    assert.equal(withValue.code, 2);
    assert.doesNotMatch(withValue.stdout, /UPDATER-ARGS/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the helper refuses real updater flags the panel must not choose", async () => {
  const { dir, wrapper } = await renderWrapper();
  try {
    for (const flag of ["--branch", "--rollback", "--force", "--help"]) {
      const result = await run(wrapper, [flag]);
      assert.equal(result.code, 2, `${flag} must be refused`);
      assert.doesNotMatch(result.stdout, /UPDATER-ARGS/);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the helper refuses extra arguments after --no-backup", async () => {
  const { dir, wrapper } = await renderWrapper();
  try {
    const result = await run(wrapper, ["--no-backup", "--install-dir", "/etc"]);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /too many arguments/);
    assert.doesNotMatch(result.stdout, /UPDATER-ARGS/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the helper reports a missing updater instead of running something else", async () => {
  const { dir, wrapper } = await renderWrapper();
  try {
    await rm(join(dir, "public", "update.sh"));
    const result = await run(wrapper, []);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /not found/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
