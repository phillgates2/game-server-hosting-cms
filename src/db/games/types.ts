// ─────────────────────────────────────────────────────────────────────────────
// Game template library — shared types & helpers
//
// Every built-in game lives in its own module under src/db/games/ and exports a
// single GameTemplate. src/db/seeds.ts aggregates them and keeps the historical
// exports (gameTemplates, getTemplateBySlug, ...) so existing imports keep
// working.
//
// A template owns four things:
//   1. installScript  — bash that fetches/builds the server files
//   2. startCommand   — how the panel launches it
//   3. variables[]    — every option surfaced in the create-server wizard
//   4. defaultConfig  — the config file(s) the panel materializes after install
//
// Install scripts deliberately do NOT write game config files anymore. The
// panel writes them from `defaultConfig` after the script finishes, so the
// wizard is the single source of truth for configuration.
// ─────────────────────────────────────────────────────────────────────────────

export interface GameTemplate {
  slug: string;
  name: string;
  engine: string | null;
  defaultPort: number;
  steamAppId: string | null;
  iconEmoji: string;
  supportsIpv6: boolean;
  installScript: string;
  startCommand: string;
  stopCommand: string | null;
  configFiles: Record<string, string>;
  defaultConfig: DefaultConfig;
  category: string;
  description: string;
  estimatedSize: string;
  variables: TemplateVariable[];
  expectedArtifacts?: string[]; // explicit runtime files to verify after install
}

/**
 * Values written into a generated config file.
 *
 * Two panel directives may appear alongside real config keys:
 *
 *  - `__gsm_format` picks the serializer (see ConfigFormat below). Without it
 *    the file extension decides.
 *  - `__files` maps a config-file path (as it appears in `configFiles`) to the
 *    values for *that* file. Use it when a game ships more than one config
 *    file; without it every file receives the same key set.
 */
export interface DefaultConfig {
  __gsm_format?: ConfigFormat;
  __files?: Record<string, ConfigValues>;
  [key: string]: ConfigValue | Record<string, ConfigValues> | undefined;
}

export type ConfigValue =
  | string
  | number
  | boolean
  | null
  | CsvValue
  | ConfigValue[]
  | { [key: string]: ConfigValue };

/**
 * A comma-separated string that should be emitted as a list.
 *
 * Several games expose "tags"-style options that are a single text field in the
 * wizard but an array in the config file (Factorio `tags`, Arma `headlessClients[]`).
 * Wrapping the value with csv() renders an empty list when the field is blank
 * instead of a list containing one empty string.
 */
export interface CsvValue {
  __gsm_csv: string;
}

/** Mark a templated value as a comma-separated list. */
export function csv(value: string): CsvValue {
  return { __gsm_csv: value };
}

export interface ConfigValues {
  __gsm_format?: ConfigFormat;
  [key: string]: ConfigValue | ConfigFormat | undefined;
}

/**
 * How a config file is serialized.
 *
 *  properties   key=value                         (Minecraft, Project Zomboid, Squad)
 *  quake3       set cvar "value"                  (Wolfenstein: ET / ET:Legacy)
 *  q3seta       seta cvar "value"                 (Quake Live, Xonotic)
 *  source       cvar "value"                      (CS2, TF2, GMod, L4D2, Rust)
 *  arma         key = value;                      (Arma 3)
 *  ini          [Section] + key=value             (ARK, Satisfactory, Insurgency, AC, DST)
 *  palworld     OptionSettings=(Key=Value,...)    (Palworld)
 *  json         JSON document                     (Enshrouded, Factorio, V Rising, TShock)
 *  xml          <property name=".." value=".."/>  (7 Days to Die)
 *  yaml         key: value                        (Paper)
 */
export type ConfigFormat =
  | "properties"
  | "quake3"
  | "q3seta"
  | "source"
  | "arma"
  | "ini"
  | "palworld"
  | "json"
  | "xml"
  | "yaml";

// Unified variable format used by the built-in server templates
export interface TemplateVariable {
  // Core (required)
  name: string;
  description: string;
  env_variable: string;
  default_value: string;
  // Access control
  user_viewable: boolean;
  user_editable: boolean;
  // Validation
  rules: string;
  field_type: "text" | "number" | "password" | "select" | "checkbox" | "hidden";
  // Optional metadata used by the UI
  category?: string;
  subcategory?: string;
  keywords?: string;
  enum_values?: Record<string, string>;
  min_value?: number;
  max_value?: number;
  param_field_name?: string;
}

export type VariableType =
  | "string"
  | "number"
  | "float"
  | "boolean"
  | "password"
  | "select"
  | "hidden";

export interface VariableOptions {
  required?: boolean;
  type?: VariableType;
  viewable?: boolean;
  editable?: boolean;
  category?: string;
  subcategory?: string;
  keywords?: string;
  enum_values?: Record<string, string>;
  min_value?: number;
  max_value?: number;
  param_field_name?: string;
  /** Override the generated validation rule string entirely. */
  rules?: string;
}

function buildRules(type: VariableType, opts: VariableOptions): string {
  if (opts.rules) return opts.rules;

  const required = opts.required !== false;
  const prefix = required ? "required" : "nullable";
  const hasRange = opts.min_value !== undefined && opts.max_value !== undefined;
  const range = hasRange ? `|between:${opts.min_value},${opts.max_value}` : "";

  switch (type) {
    case "number":
      // Ports and other unbounded integers default to the valid port range so
      // the wizard never accepts a value the engine will reject.
      return `${prefix}|integer${range || (required ? "|between:1,65535" : "")}`;
    case "float":
      return `${prefix}|numeric${range}`;
    case "boolean":
      return `${prefix}|boolean`;
    case "select":
      return opts.enum_values
        ? `${prefix}|string|in:${Object.keys(opts.enum_values).join(",")}`
        : `${prefix}|string`;
    case "password":
      return `${prefix}|string|max:256`;
    case "hidden":
      return `${prefix}|string`;
    default:
      return `${prefix}|string|max:256`;
  }
}

function fieldTypeFor(type: VariableType): TemplateVariable["field_type"] {
  switch (type) {
    case "select":
      return "select";
    case "number":
    case "float":
      return "number";
    case "boolean":
      return "checkbox";
    case "password":
      return "password";
    case "hidden":
      return "hidden";
    default:
      return "text";
  }
}

/** Define a template variable for the built-in library. */
export function V(
  name: string,
  env_variable: string,
  description: string,
  default_value: string,
  opts: VariableOptions = {}
): TemplateVariable {
  const type = opts.type || "string";
  return {
    name,
    description,
    env_variable,
    default_value,
    user_viewable: opts.viewable !== false,
    user_editable: opts.editable !== false,
    rules: buildRules(type, opts),
    field_type: fieldTypeFor(type),
    category: opts.category,
    subcategory: opts.subcategory,
    keywords: opts.keywords,
    enum_values: opts.enum_values,
    min_value: opts.min_value,
    max_value: opts.max_value,
    param_field_name: opts.param_field_name,
  };
}

/** Apply a category to a whole block of variables without repeating it. */
export function group(category: string, vars: TemplateVariable[]): TemplateVariable[] {
  return vars.map((v) => ({ ...v, category: v.category ?? category }));
}

// ── Common variable sets ──────────────────────────────────────────────────────

export const CATEGORY_GENERAL = "General";
export const CATEGORY_NETWORK = "Network";

/** Server identity + install location. Present on every template. */
export const COMMON_VARS: TemplateVariable[] = [
  V("Server Name", "SERVER_NAME", "Display name shown in the server browser", "My Server", {
    category: CATEGORY_GENERAL,
  }),
  V("Port", "PORT", "Main server port", "", {
    type: "number",
    category: CATEGORY_NETWORK,
  }),
  V("Max Players", "MAX_PLAYERS", "Maximum concurrent players", "32", {
    required: false,
    type: "number",
    min_value: 1,
    max_value: 512,
    category: CATEGORY_GENERAL,
  }),
  V("Install Path", "INSTALL_PATH", "Server installation directory", "/opt/gameservers", {
    category: CATEGORY_GENERAL,
  }),
];

/** COMMON_VARS plus the Steam query port used by every SteamCMD game. */
export const STEAM_VARS: TemplateVariable[] = [
  ...COMMON_VARS,
  V("Steam Query Port", "QUERY_PORT", "Steam query port (usually main port + 1)", "", {
    required: false,
    type: "number",
    category: CATEGORY_NETWORK,
  }),
];

/** Remote console password — spread into templates that support RCON. */
export const RCON_VARS: TemplateVariable[] = [
  V("RCON Password", "RCON_PASSWORD", "Remote console password", "", {
    required: false,
    type: "password",
    category: "Passwords",
  }),
];
