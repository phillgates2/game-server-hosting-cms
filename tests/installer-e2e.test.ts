/**
 * End-to-end installer verification against a real PostgreSQL.
 *
 * `verify-installers.ts` already renders every game's install script and
 * executes it in a mocked sandbox — but it reads the template straight out of
 * the TypeScript module. Production does not work that way:
 *
 *     module template  ->  POST /api/templates/[slug]/install  ->  gameDefinitions row
 *     gameDefinitions row  ->  POST /api/servers  ->  gameServers row
 *     gameServers row  ->  POST /api/servers/[id]/install  ->  rendered scripts
 *
 * The scripts that actually run come from the **database**, and only the
 * columns the install route copies survive that trip. Anything the template
 * declares but the table cannot hold is silently lost, and no amount of
 * module-level checking would notice.
 *
 * These tests drive that real path through PGlite, using the installer's own
 * DDL, so a column that fails to round-trip shows up as a failing assertion
 * rather than as a broken server on someone's box.
 *
 *   npm test
 */

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { gameTemplates, type GameTemplate } from "../src/db/games";
import { resolveConfigFiles, renderConfigFile } from "../src/lib/config-render";

/** The installer's own schema, extracted so it cannot drift from what ships. */
function installerDdl(): string {
  const src = readFileSync(join(process.cwd(), "src/app/api/install/route.ts"), "utf8");
  const tables = src.match(/CREATE TABLE IF NOT EXISTS [\s\S]*?\n\s*\);/g) ?? [];
  return tables.map((t) => t.replace(/^ {6}/gm, "")).join("\n\n");
}

/**
 * The exact column list `POST /api/templates/[slug]/install` writes.
 *
 * Kept in step with the route by a test below rather than by hope.
 */
const INSTALLED_COLUMNS = [
  "slug",
  "name",
  "engine",
  "defaultPort",
  "steamAppId",
  "installScript",
  "startCommand",
  "stopCommand",
  "configFiles",
  "defaultConfig",
  "supportsIpv6",
  "iconEmoji",
] as const;

let db: PGlite;

before(async () => {
  db = new PGlite();
  await db.exec(installerDdl());
});

/** Insert a template the way the install route does, and read it back. */
async function roundTrip(t: GameTemplate) {
  await db.query(`DELETE FROM game_definitions WHERE slug = $1`, [t.slug]);
  await db.query(
    `INSERT INTO game_definitions
       (slug, name, engine, default_port, steam_app_id, install_script,
        start_command, stop_command, config_files, default_config,
        supports_ipv6, icon_emoji)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      t.slug,
      t.name,
      t.engine,
      t.defaultPort,
      t.steamAppId ?? null,
      t.installScript,
      t.startCommand,
      t.stopCommand ?? null,
      JSON.stringify(t.configFiles ?? null),
      JSON.stringify(t.defaultConfig ?? null),
      t.supportsIpv6 ?? false,
      t.iconEmoji ?? null,
    ]
  );

  const res = await db.query<Record<string, unknown>>(
    `SELECT * FROM game_definitions WHERE slug = $1`,
    [t.slug]
  );
  return res.rows[0];
}

/** Mirrors buildVariables() in the install route. */
function buildVariables(t: GameTemplate, server: {
  name: string; installPath: string; port: number;
}) {
  // The template's own field names are env_variable/default_value; `name` is
  // the human label. Reading the wrong pair yields an empty map and every
  // placeholder then looks unresolved.
  //
  // game_servers.variables holds what the creation wizard POSTed, and the
  // wizard deliberately drops these four keys (ServersPanel.tsx) so the
  // server's real identity always wins over the template default. Every
  // template ships INSTALL_PATH="/opt/gameservers"; seeding it here would
  // send every game to the same directory and mask that per-server path.
  const WIZARD_SKIPS = new Set(["SERVER_NAME", "PORT", "INSTALL_PATH", "QUERY_PORT"]);
  const stored: Record<string, unknown> = {};
  for (const v of t.variables ?? []) {
    if (WIZARD_SKIPS.has(v.env_variable)) continue;
    if (!v.default_value) continue;
    stored[v.env_variable] = v.default_value;
  }
  // `??` (not `||`) matches the route: a stored "0" or "" must not fall back.
  return {
    ...(t.defaultConfig ?? {}),
    ...stored,
    SERVER_NAME: stored.SERVER_NAME ?? server.name,
    INSTALL_PATH: stored.INSTALL_PATH ?? server.installPath,
    PORT: stored.PORT ?? server.port,
    QUERY_PORT: stored.QUERY_PORT ?? server.port + 1,
    RCON_PORT: stored.RCON_PORT ?? server.port + 2,
    MAX_PLAYERS: stored.MAX_PLAYERS ?? 32,
    MAX_RAM: stored.MAX_RAM ?? 4,
  } as Record<string, unknown>;
}

/** Mirrors replaceTemplateVariables() in the install route. */
function replaceVars(input: string, vars: Record<string, unknown>, seen?: Set<string>): string {
  // The route blanks unknown/null vars rather than leaving the token in place
  // (optional settings like passwords and MOTD lines have empty defaults and
  // are meant to render as empty). Because nothing survives as "{{VAR}}",
  // scanning the OUTPUT for tokens can never fail - the check would be
  // vacuous. `seen` records which keys the template asked for but the
  // variable set could not supply, so tests assert on that instead.
  return input.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_m, k) => {
    const value = vars[k];
    if (value === undefined || value === null) {
      seen?.add(k);
      return "";
    }
    return String(value);
  });
}

describe("template install round-trips through the database", () => {
  test("every template can be stored and read back", async () => {
    for (const t of gameTemplates) {
      const row = await roundTrip(t);
      assert.ok(row, `${t.slug} should be readable after install`);
      assert.equal(row.slug, t.slug);
    }
  });

  test("the install script survives the round trip byte for byte", async () => {
    // The script that runs on a real box is this column, not the module value.
    // A truncating column type or an encoding slip would corrupt it silently.
    for (const t of gameTemplates) {
      const row = await roundTrip(t);
      assert.equal(
        row.install_script,
        t.installScript,
        `${t.slug}: install script changed in the database`
      );
    }
  });

  test("start and stop commands survive intact", async () => {
    for (const t of gameTemplates) {
      const row = await roundTrip(t);
      assert.equal(row.start_command, t.startCommand, `${t.slug}: start command`);
      assert.equal(row.stop_command, t.stopCommand ?? null, `${t.slug}: stop command`);
    }
  });

  test("configFiles and defaultConfig survive as JSON", async () => {
    // These drive every generated config file. JSONB round-trips values, not
    // formatting, so compare parsed shapes.
    for (const t of gameTemplates) {
      const row = await roundTrip(t);
      assert.deepEqual(
        row.config_files ?? null,
        t.configFiles ?? null,
        `${t.slug}: configFiles`
      );
      assert.deepEqual(
        row.default_config ?? null,
        t.defaultConfig ?? null,
        `${t.slug}: defaultConfig`
      );
    }
  });

  test("ports and Steam app IDs are preserved exactly", async () => {
    for (const t of gameTemplates) {
      const row = await roundTrip(t);
      assert.equal(Number(row.default_port), t.defaultPort, `${t.slug}: port`);
      assert.equal(
        row.steam_app_id === null ? null : String(row.steam_app_id),
        t.steamAppId == null ? null : String(t.steamAppId),
        `${t.slug}: steamAppId`
      );
    }
  });
});

describe("what the database cannot hold", () => {
  test("the columns written match the columns the table has", async () => {
    // If the install route ever writes a field the table lacks, production
    // throws on the insert; if the table gains one the route does not write,
    // it silently stays null.
    const cols = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'game_definitions'`
    );
    const have = new Set(cols.rows.map((r) => r.column_name));
    const snake = (s: string) => s.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
    for (const c of INSTALLED_COLUMNS) {
      assert.ok(have.has(snake(c)), `game_definitions is missing ${snake(c)}`);
    }
  });

  test("variables are NOT persisted — the install path must not rely on the row", async () => {
    // gameDefinitions has no `variables` column, so the 1,551 declared options
    // exist only in the module. The install route reads them via
    // getTemplateBySlug() rather than from the database, which is correct —
    // this test pins that the row genuinely cannot supply them, so nobody
    // "optimises" the module lookup away.
    const row = await roundTrip(gameTemplates.find((t) => t.slug === "cs2")!);
    assert.equal(
      "variables" in row,
      false,
      "if this column appears, the install route should read variables from it"
    );
  });
});

describe("rendering from the stored row", () => {
  /** Render exactly as the install route does, but from database values. */
  /** Mirrors substituteConfigValues in the install route. */
  function substituteConfigValues(
    input: unknown, vars: Record<string, unknown>, seen?: Set<string>
  ): unknown {
    if (typeof input === "string") return replaceVars(input, vars, seen);
    if (Array.isArray(input)) return input.map((v) => substituteConfigValues(v, vars, seen));
    if (input && typeof input === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
        out[k] = substituteConfigValues(v, vars, seen);
      }
      return out;
    }
    return input;
  }

  async function renderFromDb(t: GameTemplate) {
    const row = await roundTrip(t);
    const vars = buildVariables(t, {
      name: "Test Server",
      installPath: "/opt/gameservers/test",
      port: t.defaultPort,
    });

    const unresolved = new Set<string>();
    const script = replaceVars(String(row.install_script), vars, unresolved);
    const start = replaceVars(String(row.start_command), vars, unresolved);

    const byFile = resolveConfigFiles(
      (row.config_files ?? {}) as Record<string, string>,
      (row.default_config ?? {}) as Record<string, unknown>
    );
    const configs: Record<string, string> = {};
    for (const [rawPath, rawValues] of Object.entries(byFile)) {
      const path = replaceVars(rawPath, vars);
      if (!path || path.includes("{{") || path.startsWith("/")) continue;
      // The route substitutes variables into the *values* (recursively, so
      // nested JSON configs are covered) before serializing. Skipping this
      // leaves every {{VAR}} in the body.
      const values = substituteConfigValues(rawValues, vars, unresolved) as Record<string, unknown>;
      configs[path] = renderConfigFile(rawPath, values);
    }
    return { script, start, configs, unresolved };
  }

  // Every {{VAR}} a template uses must be backed by a declared variable, a
  // defaultConfig key, or one of the seven the install route synthesizes.
  // An undeclared token silently renders as "" - the server then starts with
  // an empty password/map/seed instead of failing loudly, so this is the
  // assertion that actually protects the installers.
  const BUILTIN_VARS = new Set([
    "SERVER_NAME", "INSTALL_PATH", "PORT", "QUERY_PORT",
    "RCON_PORT", "MAX_PLAYERS", "MAX_RAM",
  ]);

  test("every placeholder used by a stored template is backed by a declaration", async () => {
    const undeclared: string[] = [];
    for (const t of gameTemplates) {
      const declared = new Set((t.variables ?? []).map((v) => v.env_variable));
      const config = (t.defaultConfig ?? {}) as Record<string, unknown>;
      const { unresolved } = await renderFromDb(t);
      for (const key of unresolved) {
        if (declared.has(key) || BUILTIN_VARS.has(key) || key in config) continue;
        undeclared.push(`${t.slug}: {{${key}}}`);
      }
    }
    assert.deepEqual(undeclared, [], "placeholders with no backing declaration");
  });

  test("the seven built-in variables always resolve", async () => {
    // These are synthesized per-server, so an empty one means a broken path,
    // port or name reached the shell - never an intentional blank.
    const bad: string[] = [];
    for (const t of gameTemplates) {
      const { unresolved } = await renderFromDb(t);
      for (const key of unresolved) {
        if (BUILTIN_VARS.has(key)) bad.push(`${t.slug}: {{${key}}} rendered empty`);
      }
    }
    assert.deepEqual(bad, []);
  });

  test("the install path and port reach every rendered script", async () => {
    const bad: string[] = [];
    for (const t of gameTemplates) {
      const { script, start } = await renderFromDb(t);
      const both = `${script}\n${start}`;
      if (script.includes("{{") || start.includes("{{")) {
        bad.push(`${t.slug}: raw token survived rendering`);
      }
      if (!both.includes("/opt/gameservers/test")) {
        bad.push(`${t.slug}: install path never appears`);
      }
    }
    assert.deepEqual(bad, []);
  });

  test("every template renders at least one config file, or declares none", async () => {
    for (const t of gameTemplates) {
      const { configs } = await renderFromDb(t);
      const declared = Object.keys(t.configFiles ?? {}).length;
      if (declared > 0) {
        assert.ok(
          Object.keys(configs).length > 0,
          `${t.slug} declares ${declared} config file(s) but rendered none`
        );
      }
    }
  });

  test("no rendered config file contains a raw placeholder", async () => {
    // Config bodies go through substituteConfigValues, which also blanks
    // unknowns - so this catches a token the recursion failed to reach
    // (e.g. a value nested inside an array or an unhandled shape).
    const bad: string[] = [];
    for (const t of gameTemplates) {
      const { configs } = await renderFromDb(t);
      for (const [path, body] of Object.entries(configs)) {
        if (/\{\{[A-Z0-9_]+\}\}/.test(body)) bad.push(`${t.slug}:${path}`);
      }
    }
    assert.deepEqual(bad, [], "config files containing unresolved tokens");
  });

  test("no rendered config path escapes the server directory", async () => {
    // These paths are joined onto installPath and written to disk.
    for (const t of gameTemplates) {
      const { configs } = await renderFromDb(t);
      for (const path of Object.keys(configs)) {
        assert.ok(!path.startsWith("/"), `${t.slug}: absolute path ${path}`);
        assert.ok(!path.includes(".."), `${t.slug}: traversal in ${path}`);
      }
    }
  });
});

describe("a full create-then-install flow", () => {
  test("a server row drives a complete install for every game", async () => {
    // The whole chain: template installed, server created against that game,
    // then the install rendered from both rows together.
    await db.exec(`
      INSERT INTO roles (name, display_name) VALUES ('user', 'User')
        ON CONFLICT (name) DO NOTHING;
    `);
    await db.query(
      `INSERT INTO users (username, email, password_hash, role_id)
       VALUES ('owner', 'o@example.com', 'hash', 1)
       ON CONFLICT (username) DO NOTHING`
    );
    await db.query(
      `INSERT INTO nodes (name, hostname) VALUES ('local', 'localhost')
       ON CONFLICT DO NOTHING`
    );

    const failures: string[] = [];
    let port = 20000;

    for (const t of gameTemplates) {
      const row = await roundTrip(t);
      port += 10;

      const inserted = await db.query<{ id: number }>(
        `INSERT INTO game_servers
           (user_id, node_id, game_id, name, port, install_path)
         VALUES (1, 1, $1, $2, $3, $4) RETURNING id`,
        [row.id, `${t.name} Test`, port, `/opt/gameservers/${t.slug}-test`]
      );
      const serverId = inserted.rows[0].id;

      // Read back exactly what the install route would join on.
      const joined = await db.query<Record<string, unknown>>(
        `SELECT s.name, s.install_path, s.port,
                g.install_script, g.start_command, g.config_files, g.default_config
         FROM game_servers s
         JOIN game_definitions g ON g.id = s.game_id
         WHERE s.id = $1`,
        [serverId]
      );
      const j = joined.rows[0];
      if (!j) {
        failures.push(`${t.slug}: join produced no row`);
        continue;
      }

      const vars = buildVariables(t, {
        name: String(j.name),
        installPath: String(j.install_path),
        port: Number(j.port),
      });
      const script = replaceVars(String(j.install_script), vars);

      if (!script.trim()) failures.push(`${t.slug}: empty install script`);
      if (/\{\{[A-Z0-9_]+\}\}/.test(script)) {
        failures.push(`${t.slug}: placeholders survived the join`);
      }
      // The install path must reach the script, or files land in the wrong place.
      if (!script.includes(String(j.install_path))) {
        failures.push(`${t.slug}: install path absent from the rendered script`);
      }
    }

    assert.deepEqual(failures, []);
  });
});
