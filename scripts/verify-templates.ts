/**
 * Template library self-check.
 *
 *   npx tsx scripts/verify-templates.ts          # summary + problems
 *   npx tsx scripts/verify-templates.ts --dump   # also print every rendered config
 *
 * For each built-in game this:
 *   1. fills every variable with its default value
 *   2. renders the install script, start command and config files
 *   3. reports any {{PLACEHOLDER}} left unresolved, duplicate variables,
 *      missing declarations and config keys pointing at variables that
 *      do not exist
 *
 * A clean run means every option a template advertises actually reaches a
 * config file or the command line.
 */

import { gameTemplates, getExpectedArtifactsBySlug, type GameTemplate } from "../src/db/games";
import { renderConfigFile, resolveConfigFiles } from "../src/lib/config-render";

const DUMP = process.argv.includes("--dump");

// Variables the panel injects at install time rather than the template.
const PANEL_PROVIDED = new Set([
  "SERVER_NAME",
  "INSTALL_PATH",
  "PORT",
  "QUERY_PORT",
  "RCON_PORT",
  "MAX_PLAYERS",
  "MAX_RAM",
]);

const PLACEHOLDER = /\{\{([A-Z0-9_]+)\}\}/g;
// Install scripts also receive every variable as a shell environment variable,
// so ${VAR} / $VAR in a script counts as using it.
const SHELL_VAR = /\$\{?([A-Z][A-Z0-9_]*)\b/g;

function fillVariables(template: GameTemplate): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of template.variables) out[v.env_variable] = v.default_value;
  // Mirror the panel's own defaults so the render is realistic. These are
  // filled in by buildVariables() at install time, and several of them are
  // declared with an empty default precisely because the panel supplies them.
  const fallback: Record<string, string> = {
    SERVER_NAME: "Test Server",
    INSTALL_PATH: "/opt/gameservers/test",
    PORT: String(template.defaultPort),
    QUERY_PORT: String(template.defaultPort + 1),
    RCON_PORT: String(template.defaultPort + 2),
    MAX_PLAYERS: "32",
    MAX_RAM: "4",
  };
  for (const [k, v] of Object.entries(fallback)) {
    if (!out[k]) out[k] = v;
  }
  return out;
}

function substitute(input: unknown, vars: Record<string, string>): unknown {
  if (typeof input === "string") {
    return input.replace(PLACEHOLDER, (_m, key: string) => vars[key] ?? "");
  }
  if (Array.isArray(input)) return input.map((v) => substitute(v, vars));
  if (input && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = substitute(v, vars);
    }
    return out;
  }
  return input;
}

function referencedIn(text: string): Set<string> {
  const found = new Set<string>();
  for (const m of text.matchAll(PLACEHOLDER)) found.add(m[1]);
  return found;
}

/** {{VAR}} plus shell $VAR references — used for install scripts. */
function referencedInScript(text: string): Set<string> {
  const found = referencedIn(text);
  for (const m of text.matchAll(SHELL_VAR)) found.add(m[1]);
  return found;
}

interface Report {
  slug: string;
  name: string;
  variableCount: number;
  configFileCount: number;
  errors: string[];
  warnings: string[];
}

function verify(template: GameTemplate): Report {
  const errors: string[] = [];
  const warnings: string[] = [];
  const vars = fillVariables(template);
  const declared = new Set(Object.keys(vars));

  // 1. Duplicate variable declarations
  const seen = new Map<string, number>();
  for (const v of template.variables) {
    seen.set(v.env_variable, (seen.get(v.env_variable) || 0) + 1);
  }
  for (const [name, count] of seen) {
    if (count > 1) errors.push(`variable ${name} declared ${count} times`);
  }

  // 1b. Regex metacharacters eaten by the template literal.
  //
  // Install scripts live inside untagged template literals, so a single
  // backslash is consumed by JS before bash ever sees it: `\s` becomes `s`
  // and `\K` becomes `K`, silently turning a working PCRE into one that
  // matches nothing. Three shipped installers were broken this way. Any
  // backslash intended for the shell must be written `\\` in the source.
  const PCRE_LINE = /grep\s+-o?P|grep\s+-P|sed\s+-E|perl\s+-/;
  const MANGLED = [
    { re: /[^\\]s\*\s*:/, hint: "\\s* lost its backslash" },
    { re: /:\s*[^\\]?s\*/, hint: "\\s* lost its backslash" },
    { re: /"K\[/, hint: "\\K lost its backslash" },
    { re: /[^\\]\bK\[0-9/, hint: "\\K lost its backslash" },
    { re: /[^\\]Khttps?:/, hint: "\\K lost its backslash" },
    { re: /\[0-9\]\+\.\[0-9\]\+\(\./, hint: "\\. lost its backslash" },
  ];
  for (const [i, line] of template.installScript.split("\n").entries()) {
    if (!PCRE_LINE.test(line)) continue;
    for (const m of MANGLED) {
      if (m.re.test(line)) {
        errors.push(
          `installScript line ${i + 1}: ${m.hint} — write \\\\ in the source. (${line.trim().slice(0, 70)})`
        );
        break;
      }
    }
  }

  // 2. Variable metadata sanity
  for (const v of template.variables) {
    if (!v.name.trim()) errors.push(`variable ${v.env_variable} has no display name`);
    if (!v.description.trim()) warnings.push(`variable ${v.env_variable} has no description`);
    if (v.field_type === "select" && (!v.enum_values || Object.keys(v.enum_values).length === 0)) {
      errors.push(`select variable ${v.env_variable} has no enum_values`);
    }
    if (v.enum_values && v.default_value && !(v.default_value in v.enum_values)) {
      errors.push(`variable ${v.env_variable} default "${v.default_value}" is not one of its enum_values`);
    }
    if (v.min_value !== undefined && v.max_value !== undefined && v.min_value > v.max_value) {
      errors.push(`variable ${v.env_variable} has min_value > max_value`);
    }
    const numericDefault = Number(v.default_value);
    if (
      (v.field_type === "number") &&
      v.default_value !== "" &&
      !Number.isNaN(numericDefault) &&
      v.min_value !== undefined &&
      v.max_value !== undefined &&
      (numericDefault < v.min_value || numericDefault > v.max_value)
    ) {
      errors.push(`variable ${v.env_variable} default ${v.default_value} is outside ${v.min_value}..${v.max_value}`);
    }
  }

  // 3. Every {{PLACEHOLDER}} must be backed by a declared variable.
  //    (Only real {{...}} tokens count here — a script's own shell locals are
  //    not template variables.)
  const substituted = new Set<string>([
    ...referencedIn(template.installScript),
    ...referencedIn(template.startCommand),
    ...referencedIn(template.stopCommand || ""),
    ...referencedIn(JSON.stringify(template.configFiles)),
    ...referencedIn(JSON.stringify(template.defaultConfig)),
  ]);
  for (const name of substituted) {
    if (!declared.has(name) && !PANEL_PROVIDED.has(name)) {
      errors.push(`{{${name}}} is used but never declared as a variable`);
    }
  }

  // 4. Every declared variable should actually be consumed somewhere.
  //    Install scripts also read variables from the environment, so a bare
  //    $VAR in the script counts as consuming it.
  const consumed = new Set<string>([
    ...substituted,
    ...referencedInScript(template.installScript),
  ]);
  for (const name of declared) {
    if (PANEL_PROVIDED.has(name)) continue;
    if (!consumed.has(name)) {
      errors.push(`variable ${name} is declared but never used in a script or config`);
    }
  }

  // 5. Render config files and check nothing is left unresolved
  const byFile = resolveConfigFiles(template.configFiles, template.defaultConfig as Record<string, unknown>);
  for (const [path, values] of Object.entries(byFile)) {
    const filled = substitute(values, vars) as Record<string, unknown>;
    let body: string;
    try {
      body = renderConfigFile(path, filled);
    } catch (e) {
      errors.push(`rendering ${path} threw: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    const leftover = [...referencedIn(body)];
    if (leftover.length) errors.push(`${path} still contains ${leftover.map((l) => `{{${l}}}`).join(", ")}`);
    if (body.includes("__gsm_")) errors.push(`${path} leaked a panel directive into the output`);
    if (DUMP) {
      console.log(`\n----- ${template.slug} :: ${path} -----`);
      console.log(body.trimEnd());
    }
  }

  // 6. Templates that declare config files must define their contents
  if (Object.keys(template.configFiles).length > 0 && Object.keys(byFile).length === 0) {
    errors.push("declares configFiles but resolveConfigFiles produced nothing");
  }

  // 7. Start command must resolve
  const startFilled = substitute(template.startCommand, vars) as string;
  const startLeft = [...referencedIn(startFilled)];
  if (startLeft.length) errors.push(`start command still contains ${startLeft.map((l) => `{{${l}}}`).join(", ")}`);

  // 8. Install script must resolve and look like bash
  const installFilled = substitute(template.installScript, vars) as string;
  const installLeft = [...referencedIn(installFilled)];
  if (installLeft.length) errors.push(`install script still contains ${installLeft.map((l) => `{{${l}}}`).join(", ")}`);
  if (!template.installScript.startsWith("#!/bin/bash")) errors.push("install script has no bash shebang");

  // 9. Expected artifacts should be registered
  if (getExpectedArtifactsBySlug(template.slug).length === 0) {
    warnings.push("no expected install artifacts registered");
  }

  return {
    slug: template.slug,
    name: template.name,
    variableCount: template.variables.length,
    configFileCount: Object.keys(template.configFiles).length,
    errors,
    warnings,
  };
}

const reports = gameTemplates.map(verify);

const slugs = new Set<string>();
for (const t of gameTemplates) {
  if (slugs.has(t.slug)) console.error(`DUPLICATE SLUG: ${t.slug}`);
  slugs.add(t.slug);
}

console.log(`\nTemplate library: ${gameTemplates.length} games\n`);
console.log("slug                      vars  cfgs  status");
console.log("-".repeat(60));

let totalErrors = 0;
let totalWarnings = 0;
let totalVars = 0;

for (const r of reports) {
  totalErrors += r.errors.length;
  totalWarnings += r.warnings.length;
  totalVars += r.variableCount;
  const status = r.errors.length ? `${r.errors.length} ERROR(S)` : r.warnings.length ? `ok (${r.warnings.length} warn)` : "ok";
  console.log(`${r.slug.padEnd(25)} ${String(r.variableCount).padStart(4)}  ${String(r.configFileCount).padStart(4)}  ${status}`);
}

console.log("-".repeat(60));
console.log(`${totalVars} configurable options across ${gameTemplates.length} games`);

if (totalErrors || totalWarnings) {
  console.log("\nDetails:");
  for (const r of reports) {
    if (!r.errors.length && !r.warnings.length) continue;
    console.log(`\n  ${r.slug}`);
    for (const e of r.errors) console.log(`    ERROR   ${e}`);
    for (const w of r.warnings) console.log(`    warning ${w}`);
  }
}

console.log(`\n${totalErrors} error(s), ${totalWarnings} warning(s)`);
process.exit(totalErrors > 0 ? 1 : 0);
