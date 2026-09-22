import { getTemplateBySlug } from "../db/seeds";

interface UpdateServer {
  name: string;
  installPath: string;
  port: number;
  queryPort: number | null;
  rconPort: number | null;
  variables: unknown;
  config: unknown;
  gameSlug: string | null;
  installScript: string | null;
  steamcmdPath: string | null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/** Resolve the current bundled downloader, falling back to custom game scripts.
 * Keep configured version/branch pins: updating must not silently switch editions.
 * Do not run installation's config/start-script generation over existing files.
 */
export function buildTemplateUpdateScript(server: UpdateServer): string | null {
  const template = server.gameSlug ? getTemplateBySlug(server.gameSlug) : undefined;
  const source = template?.installScript || server.installScript;
  if (!source?.trim()) return null;
  const defaults = Object.fromEntries((template?.variables ?? []).map(v => [v.env_variable, v.default_value]));
  const stored = { ...record(server.config), ...record(server.variables) };
  const variables: Record<string, unknown> = {
    ...defaults,
    SERVER_NAME: server.name,
    PORT: server.port,
    QUERY_PORT: server.queryPort ?? server.port + 1,
    RCON_PORT: server.rconPort ?? server.port + 2,
    MAX_PLAYERS: 32,
    MAX_RAM: 4,
    ...stored,
    // Paths are authoritative server/node properties, not user variable overrides.
    INSTALL_PATH: server.installPath,
    STEAMCMD_PATH: server.steamcmdPath?.trim() || "/opt/steamcmd",
  };
  for (const def of template?.variables ?? []) {
    if (def.field_type !== "checkbox" || !["0", "1"].includes(def.default_value)) continue;
    const value = variables[def.env_variable] ?? def.default_value;
    variables[def.env_variable] = /^(true|yes|on|1)$/i.test(String(value).trim()) ? "1" : "0";
  }
  // Match installation's renderer, including placeholders in quoted heredocs
  // which intentionally do not perform shell variable expansion.
  const script = source.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_match, key: string) => String(variables[key] ?? ""));
  return `#!/usr/bin/env bash\nset -e\ncd ${shellQuote(server.installPath)}\n${script}\n`;
}
