/**
 * Regression tests for the installer debug pass.
 *
 * Shell checks run the real helper functions and sudoers text extracted from
 * public/install.sh, so they fail if the script drifts. The web-installer
 * behaviour (400 responses, the bootstrap, ALTER ROLE on re-run) was verified
 * against a live panel and PostgreSQL during the debug pass.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { checkInstallAccessKey } from "../src/lib/access-keys";

const root = path.resolve(__dirname, "..");
const installSh = readFileSync(path.join(root, "public", "install.sh"), "utf8");
const shopSource = readFileSync(path.join(root, "src", "lib", "shop.ts"), "utf8");
const clearBuffersRoute = readFileSync(path.join(root, "src", "app", "api", "monitor", "clear-buffers", "route.ts"), "utf8");

function extractFunction(name: string): string {
  const match = installSh.match(new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}`, "m"));
  assert.ok(match, `${name}() not found in install.sh`);
  return match[0];
}

function sudoersBody(): string {
  const match = installSh.match(/cat > \/etc\/sudoers\.d\/gsm-panel <<SUDOEOF\n([\s\S]*?)\nSUDOEOF/);
  assert.ok(match, "sudoers heredoc not found");
  return match[1];
}

test("install.sh is syntactically valid bash", () => {
  const result = spawnSync("bash", ["-n", path.join(root, "public", "install.sh")], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("json_escape produces JSON string bodies that parse back to the original value", () => {
  const values = ['plain', 'pa"ss\\word', "tab\tand\nnewline\rcr", 'dollar$ `tick` $(echo x)', "it's"];
  const script = [
    extractFunction("json_escape"),
    ...values.map((value, i) => `printf '%s\\n' "$(json_escape "$VALUE_${i}")"`),
  ].join("\n");
  const env: Record<string, string> = {};
  values.forEach((value, i) => { env[`VALUE_${i}`] = value; });
  const result = spawnSync("bash", ["-c", script], { encoding: "utf8", env: { ...process.env, ...env } });
  assert.equal(result.status, 0, result.stderr);
  const lines = result.stdout.split("\n").filter((line) => line.length > 0);
  // Each escaped value must be safe to place between quotes in a JSON body.
  lines.forEach((line, i) => {
    assert.equal(JSON.parse(`"${line}"`), values[i], `value ${i} did not round-trip`);
  });
});

test("the step-8 API payload is built from escaped values only", () => {
  const block = installSh.slice(installSh.indexOf('log "Server is up'), installSh.indexOf("# Stop the temporary server"));
  assert.match(block, /json_escape "\$ADMIN_PASS"/);
  assert.match(block, /json_escape "\$ACCESS_KEY"/);
  assert.match(block, /accessKey\\"/, "install API call must send the install key");
  assert.match(block, /licenseKey\\"/, "install API call must send the license key for standard installs");
  assert.doesNotMatch(block, /curl -sf[^\n]*api\/install/, "curl -sf hides the API's error body");
});

test("sudoers rules are exact commands, not wildcards that accept extra arguments", () => {
  const body = sudoersBody()
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
  assert.doesNotMatch(body, /\*/, "a wildcard lets sudo accept extra sysctl settings (kernel.core_pattern)");
  assert.doesNotMatch(body, /\?/, "a one-character glob in a shell string is a shell-syntax hole");
  assert.doesNotMatch(body, /compact_memory/, "nothing in the panel uses compact_memory");
  assert.match(body, /\/usr\/sbin\/sysctl -w vm\.drop_caches=3/);
  assert.match(body, /\/bin\/sh -c echo 3 > \/proc\/sys\/vm\/drop_caches/);
  assert.match(body, /\/usr\/sbin\/swapon -a/);
  assert.doesNotMatch(body, /swapon$/m, "bare swapon would accept any argument");
});

test("the clear-buffers hint matches the rules the installer writes", () => {
  assert.doesNotMatch(clearBuffersRoute, /vm\.drop_caches=\*/);
  assert.match(clearBuffersRoute, /sysctl -w vm\.drop_caches=3/);
});

test("installer does not write privileged files to predictable /tmp paths", () => {
  const predictable = installSh.match(/\/tmp\/gsm-(?!install-)[\w.-]+/g) ?? [];
  assert.deepEqual(predictable, [], `predictable /tmp paths found: ${predictable.join(", ")}`);
  assert.doesNotMatch(installSh, /\/tmp\/nodesource_setup\.sh/);
  assert.match(installSh, /GSM_LOG_DIR="\/var\/log\/gsm-install"/);
});

test("installer never rewrites the tracked drizzle.config.json", () => {
  assert.doesNotMatch(installSh, />\s*drizzle\.config\.json/, "credentials must not be written into the tracked config");
  assert.match(installSh, /drizzle-kit push --config "?\$DRIZZLE_INSTALL_CONFIG/);
  assert.match(installSh, /rm -f -- "\$DRIZZLE_INSTALL_CONFIG"/);
});

test("re-runs set the existing database role's password instead of skipping it", () => {
  assert.match(installSh, /ALTER ROLE \$DB_USER WITH LOGIN PASSWORD '\$DB_PASS'/);
});

test("git pull failures stop the installer instead of building stale code", () => {
  assert.doesNotMatch(installSh, /git pull --ff-only 2>\/dev\/null \|\| true/);
  assert.match(installSh, /git -c safe\.directory="\$INSTALL_DIR" pull --ff-only;? then|pull --ff-only; then/);
});

test("the installer never kills an unrelated process on the panel port", () => {
  assert.doesNotMatch(installSh, /^\s*fuser -k/m);
});

test("python3 is installed with the core packages (the DB URL step needs it)", () => {
  assert.match(installSh, /CORE_PKGS="[^"]*\bpython3\b[^"]*"/);
});

test("the PGDG key import cannot end the script before the distro fallback", () => {
  assert.match(installSh, /PGDG_KEY_OK="false"/);
});

test("shop_resellers is created before the ALTER that references it", () => {
  const create = shopSource.indexOf("CREATE TABLE IF NOT EXISTS shop_resellers");
  const alter = shopSource.indexOf("REFERENCES shop_resellers(id)");
  assert.ok(create > 0 && alter > 0, "both statements must exist");
  assert.ok(create < alter, "the FK target must exist before the ALTER that references it");
});

test("license_keys is created before shop_orders references it", () => {
  const ensure = shopSource.indexOf("ensureLicenseTables");
  const reference = shopSource.indexOf("REFERENCES license_keys(id)");
  assert.ok(ensure > 0 && reference > 0);
  assert.ok(ensure < reference, "ensureShopTables must create license_keys first");
});

test("install key comparison is exact and length-safe", () => {
  const key = "GSM-0123456789abcdef0123456789abcdef";
  assert.equal(checkInstallAccessKey({ masterKeyConfigured: true, masterKey: key, presented: key }).ok, true);
  assert.equal(checkInstallAccessKey({ masterKeyConfigured: true, masterKey: key, presented: key.slice(0, -1) + "0" }).ok, false);
  assert.equal(checkInstallAccessKey({ masterKeyConfigured: true, masterKey: key, presented: key + "x" }).ok, false);
  assert.equal(checkInstallAccessKey({ masterKeyConfigured: true, masterKey: key, presented: "short" }).ok, false);
});
