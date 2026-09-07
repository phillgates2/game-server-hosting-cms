/**
 * Tests for the OpenRA template's FUSE-free startup.
 *
 * OpenRA ships as an AppImage, which needs FUSE to mount. Hosts without FUSE
 * (containers especially) fail with "No suitable fusermount binary found".
 * The install script extracts a runtime tree and the start command must
 * prefer it; the AppImage is only a fallback, and even then it runs with
 * APPIMAGE_EXTRACT_AND_RUN=1 so the runtime self-extracts instead of mounting.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { openra } from "../src/db/games/openra";

describe("openra template", () => {
  test("the start command prefers the extracted runtime over the AppImage", () => {
    const start = openra.startCommand ?? "";
    const pref = start.indexOf("openra-extracted/AppRun");
    const appImage = start.indexOf("./OpenRA.AppImage");
    assert.ok(pref >= 0, "extracted runtime is referenced");
    assert.ok(appImage >= 0, "AppImage remains as a fallback");
    assert.ok(pref < appImage, "extracted runtime must be tried FIRST (FUSE-free)");
  });

  test("the AppImage fallback runs FUSE-free via APPIMAGE_EXTRACT_AND_RUN", () => {
    const start = openra.startCommand ?? "";
    const branch = start.slice(start.indexOf("elif [ -x ./OpenRA.AppImage ]"), start.indexOf("exec \"$RUNNER\""));
    assert.match(branch, /APPIMAGE_EXTRACT_AND_RUN=1/, "export the env var before running the AppImage");
  });

  test("the install script extracts the AppImage and keeps both runtimes", () => {
    const script = openra.installScript;
    assert.match(script, /--appimage-extract/);
    assert.match(script, /mv squashfs-root openra-extracted/);
    assert.match(script, /openra-extracted\/AppRun/);
    // Install must still succeed (with a warning) if extraction fails, since
    // the AppImage + APPIMAGE_EXTRACT_AND_RUN path may still work.
    assert.match(script, /OpenRA server runtime not found after download\/extract/);
  });

  test("server launch arguments survive the runner selection", () => {
    const start = openra.startCommand ?? "";
    for (const arg of ["--server", "Game.Mod=", "Server.Name=", "Server.ListenPort=", "Server.DedicatedLoop="]) {
      assert.ok(start.includes(arg), `missing launch argument: ${arg}`);
    }
    assert.ok(start.endsWith("Server.DedicatedLoop={{DEDICATED_LOOP}}"), "argument list is complete");
  });
});
