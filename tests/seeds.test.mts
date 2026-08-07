import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const seedModulePath = resolve(process.cwd(), "src/db/seeds.ts");
const seedSource = readFileSync(seedModulePath, "utf8");

test("every built-in template has a usable install path and start command", async () => {
  const seedModuleUrl = pathToFileURL(seedModulePath).href;
  const { gameTemplates } = await import(seedModuleUrl);

  assert.ok(gameTemplates.length > 0, "expected at least one built-in template");

  for (const template of gameTemplates) {
    assert.ok(template.slug, `${template.name} is missing a slug`);
    assert.ok(template.name, `${template.slug} is missing a name`);
    assert.ok(template.installScript?.includes("{{INSTALL_PATH}}"), `${template.slug} install script is missing {{INSTALL_PATH}}`);
    assert.ok(template.startCommand?.includes("{{INSTALL_PATH}}"), `${template.slug} start command is missing {{INSTALL_PATH}}`);
    assert.ok(template.defaultPort > 0, `${template.slug} has an invalid default port`);
  }
});

test("seed definitions no longer carry Pterodactyl or AMP branding", () => {
  assert.equal(seedSource.includes("Pterodactyl"), false, "seed definitions should not mention Pterodactyl");
  assert.equal(seedSource.includes("AMP"), false, "seed definitions should not mention AMP");
  assert.equal(seedSource.includes("PTDL"), false, "seed definitions should not mention PTDL");
});
