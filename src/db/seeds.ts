// Game Template Library
// These are NOT automatically installed - admins choose which games to enable.
// Each template contains all variables and scripts needed for installation.
//
// The library itself now lives in src/db/games/, one module per game, so a
// single title can be reviewed and fixed without touching the others. This file
// re-exports it so existing imports (`@/db/seeds`) keep working.

export type {
  GameTemplate,
  TemplateVariable,
  VariableType,
  VariableOptions,
  DefaultConfig,
  ConfigValues,
  ConfigValue,
  ConfigFormat,
  CsvValue,
} from "./games";

export {
  // Template library
  gameTemplates,
  getTemplatesByCategory,
  getTemplateBySlug,
  EXPECTED_ARTIFACTS_BY_SLUG,
  getExpectedArtifactsBySlug,
  // Authoring helpers, re-exported for custom templates
  V,
  csv,
  group,
  steamInstallScript,
  COMMON_VARS,
  STEAM_VARS,
  RCON_VARS,
} from "./games";
