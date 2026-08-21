/**
 * Game config file serialization.
 *
 * A template's `defaultConfig` is a plain object of values (usually containing
 * {{VAR}} placeholders). This module turns that object into the exact on-disk
 * syntax a given game expects.
 *
 * Two panel directives may appear inside a config object:
 *   __gsm_format  picks the serializer explicitly (see ConfigFormat)
 *   __files       maps a config file path to the values for that file, so a
 *                 template can ship several different config files
 *
 * Keys beginning with "__" are directives and are never written to disk.
 */

import type { ConfigFormat } from "@/db/seeds";

export type ConfigRecord = Record<string, unknown>;

const DIRECTIVE_PREFIX = "__";

function isDirective(key: string) {
  return key.startsWith(DIRECTIVE_PREFIX);
}

function isPlainObject(value: unknown): value is ConfigRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A value wrapped by csv() in a template — a comma string rendered as a list. */
function asCsv(value: unknown): string[] | null {
  if (!isPlainObject(value)) return null;
  const raw = value.__gsm_csv;
  if (typeof raw !== "string") return null;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function entriesOf(config: ConfigRecord): [string, unknown][] {
  return Object.entries(config).filter(([k]) => !isDirective(k));
}

/**
 * Split a config object into the per-file map the template asked for.
 *
 * With `__files` each listed path gets its own values. Without it, every config
 * file receives the same top-level object (the historical behaviour).
 */
export function resolveConfigFiles(
  configFiles: Record<string, string>,
  defaultConfig: ConfigRecord
): Record<string, ConfigRecord> {
  const perFile = defaultConfig.__files;
  const out: Record<string, ConfigRecord> = {};

  for (const path of Object.keys(configFiles)) {
    if (isPlainObject(perFile)) {
      const forThisFile = perFile[path];
      // A template that declares __files but omits a path leaves that file
      // alone rather than writing the whole option set into it.
      if (isPlainObject(forThisFile)) out[path] = forThisFile;
      continue;
    }
    out[path] = defaultConfig;
  }

  return out;
}

/** Decide which serializer to use for a file. */
export function resolveFormat(filePath: string, config: ConfigRecord): ConfigFormat {
  const explicit = config.__gsm_format;
  if (typeof explicit === "string") return explicit as ConfigFormat;

  const lower = filePath.toLowerCase();
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".xml")) return "xml";
  if (lower.endsWith(".yml") || lower.endsWith(".yaml")) return "yaml";
  if (lower.endsWith(".ini")) return "ini";
  return "properties";
}

// ── Scalar helpers ────────────────────────────────────────────────────────────

function scalar(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function quoteEscape(value: unknown): string {
  return scalar(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function xmlEscape(value: unknown): string {
  return scalar(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * JSON configs expect real numbers and booleans, not strings that look like
 * them — the values arrive as strings because they came from {{VAR}} templates.
 */
function coerceJsonScalar(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed !== "" && !Number.isNaN(Number(trimmed))) return Number(trimmed);
  return value;
}

function coerceJsonTree(input: unknown): unknown {
  const csvList = asCsv(input);
  if (csvList) return csvList;
  if (typeof input === "string") return coerceJsonScalar(input);
  if (Array.isArray(input)) return input.map(coerceJsonTree);
  if (isPlainObject(input)) {
    const out: ConfigRecord = {};
    for (const [k, v] of Object.entries(input)) {
      if (isDirective(k)) continue;
      out[k] = coerceJsonTree(v);
    }
    return out;
  }
  return input;
}

// ── Format renderers ──────────────────────────────────────────────────────────

/** key=value — Minecraft server.properties, Squad Server.cfg, PZ servertest.ini */
function renderProperties(config: ConfigRecord): string {
  return (
    entriesOf(config)
      .map(([k, v]) => {
        const csvList = asCsv(v);
        return `${k}=${csvList ? csvList.join(",") : scalar(v)}`;
      })
      .join("\n") + "\n"
  );
}

/** set cvar "value" — id Tech 3 (Wolfenstein: ET / ET:Legacy) */
function renderQuake3(config: ConfigRecord): string {
  return entriesOf(config).map(([k, v]) => `set ${k} "${quoteEscape(v)}"`).join("\n") + "\n";
}

/** seta cvar "value" — Quake Live, Xonotic (archived cvars) */
function renderQ3Seta(config: ConfigRecord): string {
  return entriesOf(config).map(([k, v]) => `seta ${k} "${quoteEscape(v)}"`).join("\n") + "\n";
}

/** cvar "value" — Source engine server.cfg (CS2, TF2, GMod, L4D2, Rust) */
function renderSource(config: ConfigRecord): string {
  return entriesOf(config).map(([k, v]) => `${k} "${quoteEscape(v)}"`).join("\n") + "\n";
}

/** key = value; with quoted strings and array[] = {...}; — Arma 3 */
function renderArma(config: ConfigRecord): string {
  const lines = entriesOf(config).map(([k, v]) => {
    const csvList = asCsv(v);
    const list = csvList ?? (Array.isArray(v) ? v.map(scalar) : null);

    if (list) {
      const items = list.map((item) => `"${quoteEscape(item)}"`).join(", ");
      const key = k.endsWith("[]") ? k : `${k}[]`;
      return `${key} = {${items}};`;
    }

    const text = scalar(v);
    // Arma accepts bare numbers; everything else must be quoted.
    const isNumeric = text !== "" && !Number.isNaN(Number(text));
    return `${k} = ${isNumeric ? text : `"${quoteEscape(text)}"`};`;
  });

  return `//\n// Generated by GameServer Manager\n//\n${lines.join("\n")}\n`;
}

/**
 * [Section] + key=value.
 *
 * Nested objects become sections; scalars at the top level are written above
 * the first section header.
 */
function renderIni(config: ConfigRecord): string {
  const rootLines: string[] = [];
  const sections: string[] = [];

  for (const [key, value] of entriesOf(config)) {
    if (isPlainObject(value) && !asCsv(value)) {
      const body = entriesOf(value)
        .map(([k, v]) => {
          const csvList = asCsv(v);
          return `${k}=${csvList ? csvList.join(",") : scalar(v)}`;
        })
        .join("\n");
      sections.push(`[${key}]\n${body}`);
    } else {
      const csvList = asCsv(value);
      rootLines.push(`${key}=${csvList ? csvList.join(",") : scalar(value)}`);
    }
  }

  const parts = [rootLines.join("\n"), sections.join("\n\n")].filter(Boolean);
  return parts.join("\n\n") + "\n";
}

/**
 * Palworld packs every option into one OptionSettings tuple:
 *   [/Script/Pal.PalGameWorldSettings]
 *   OptionSettings=(Key=Value,Other="text")
 * Strings are quoted, numbers/booleans/enums and pre-bracketed values are not.
 */
function renderPalworld(config: ConfigRecord): string {
  const pairs = entriesOf(config).map(([k, v]) => {
    const text = scalar(v);
    const isNumeric = text !== "" && !Number.isNaN(Number(text));
    const isBool = text === "true" || text === "false" || text === "True" || text === "False";
    const isTuple = text.startsWith("(") && text.endsWith(")");
    // Bare enum identifiers (None, Item, Casual, Text...) must stay unquoted.
    const isEnum = /^[A-Za-z][A-Za-z0-9_]*$/.test(text) && !isBool;

    if (isNumeric || isBool || isTuple) return `${k}=${text}`;
    if (isEnum && (k === "Difficulty" || k === "DeathPenalty" || k === "LogFormatType" || k === "RandomizerType")) {
      return `${k}=${text}`;
    }
    return `${k}="${quoteEscape(text)}"`;
  });

  return `[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(${pairs.join(",")})\n`;
}

/** <property name=".." value=".."/> — 7 Days to Die serverconfig.xml */
function renderXml(config: ConfigRecord): string {
  const items = entriesOf(config)
    .map(([k, v]) => `  <property name="${xmlEscape(k)}" value="${xmlEscape(v)}"/>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<ServerSettings>\n${items}\n</ServerSettings>\n`;
}

/** Minimal YAML — enough for Paper's config/paper-global.yml. */
function renderYaml(config: ConfigRecord, indent = 0): string {
  const pad = "  ".repeat(indent);
  const lines: string[] = [];

  for (const [key, value] of entriesOf(config)) {
    const csvList = asCsv(value);
    if (csvList) {
      lines.push(csvList.length === 0 ? `${pad}${key}: []` : `${pad}${key}:\n${csvList.map((i) => `${pad}  - ${JSON.stringify(i)}`).join("\n")}`);
    } else if (isPlainObject(value)) {
      lines.push(`${pad}${key}:`);
      lines.push(renderYaml(value, indent + 1).replace(/\n$/, ""));
    } else if (Array.isArray(value)) {
      lines.push(value.length === 0 ? `${pad}${key}: []` : `${pad}${key}:\n${value.map((i) => `${pad}  - ${JSON.stringify(coerceJsonScalar(i))}`).join("\n")}`);
    } else {
      lines.push(`${pad}${key}: ${JSON.stringify(coerceJsonScalar(value))}`);
    }
  }

  return lines.join("\n") + (indent === 0 ? "\n" : "\n");
}

function renderJson(config: ConfigRecord): string {
  return `${JSON.stringify(coerceJsonTree(config), null, 2)}\n`;
}

/** Serialize one config file. */
export function renderConfigFile(filePath: string, config: ConfigRecord): string {
  switch (resolveFormat(filePath, config)) {
    case "json":
      return renderJson(config);
    case "xml":
      return renderXml(config);
    case "yaml":
      return renderYaml(config);
    case "ini":
      return renderIni(config);
    case "quake3":
      return renderQuake3(config);
    case "q3seta":
      return renderQ3Seta(config);
    case "source":
      return renderSource(config);
    case "arma":
      return renderArma(config);
    case "palworld":
      return renderPalworld(config);
    case "properties":
    default:
      return renderProperties(config);
  }
}
