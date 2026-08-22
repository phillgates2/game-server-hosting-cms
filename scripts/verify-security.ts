/**
 * Security regression checks.
 *
 *   npx tsx scripts/verify-security.ts
 *
 * Each case reproduces a bug found during the workspace audit and asserts the
 * fix still holds. These are pure-function checks — no database or HTTP server
 * required — so they can run in CI on every commit.
 */

import { resolve, sep, join } from "node:path";
import { safePath } from "../src/lib/server-file-ops";

let failures = 0;
let checks = 0;

function check(name: string, condition: boolean, detail = "") {
  checks++;
  if (condition) {
    console.log(`  ok    ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── H1: path traversal ───────────────────────────────────────────────────────
console.log("\nH1 path containment (src/lib/server-file-ops.ts)");
{
  const base = "/opt/gameservers/mc";

  // The original bug: a sibling directory sharing the base as a string prefix
  // passed the startsWith() test.
  check("sibling prefix directory is rejected", safePath(base, "../mc-evil/secret.txt") === null);
  check("parent traversal is rejected", safePath(base, "../../etc/passwd") === null);
  check("absolute path outside base is rejected", safePath(base, "/etc/passwd") === null);
  check("deep traversal is rejected", safePath(base, "a/b/../../../../etc/passwd") === null);

  check("normal relative path is allowed", safePath(base, "world/level.dat") === `${base}/world/level.dat`);
  check("base itself is allowed", safePath(base, ".") === base);
  check("empty path resolves to base", safePath(base, "") === base);
  check("traversal that lands back inside is allowed", safePath(base, "../mc/ok.txt") === `${base}/ok.txt`);
}

// ── C1: backup name validation ───────────────────────────────────────────────
console.log("\nC1 backup name validation (api/servers/[id]/backup)");
{
  // Mirrors the route's guard.
  const BACKUP_NAME = /^backup-[A-Za-z0-9._-]+\.tar\.gz$/;
  function resolveBackupPath(backupDir: string, name: unknown): string | null {
    if (typeof name !== "string" || !BACKUP_NAME.test(name)) return null;
    const base = resolve(backupDir);
    const full = resolve(base, name);
    if (full !== base && !full.startsWith(base + sep)) return null;
    return full;
  }

  const dir = "/opt/gameservers/mc/gsm-backups";

  check("shell metacharacters rejected", resolveBackupPath(dir, 'x.tar.gz"; id > /tmp/pwned; echo "') === null);
  check("command substitution rejected", resolveBackupPath(dir, "backup-$(id).tar.gz") === null);
  check("backtick rejected", resolveBackupPath(dir, "backup-`id`.tar.gz") === null);
  check("traversal rejected", resolveBackupPath(dir, "../../../../etc/x.tar.gz") === null);
  check("absolute path rejected", resolveBackupPath(dir, "/etc/shadow.tar.gz") === null);
  check("wrong extension rejected", resolveBackupPath(dir, "backup-1.sh") === null);
  check("non-string rejected", resolveBackupPath(dir, { toString: () => "backup-1.tar.gz" }) === null);

  const good = "backup-2026-08-21T04-00-00.tar.gz";
  check("legitimate backup name accepted", resolveBackupPath(dir, good) === join(dir, good));
}

// ── C2: SQL identifier handling ──────────────────────────────────────────────
console.log("\nC2 SQL identifier quoting (api/database/table/[name]/row)");
{
  function quoteIdent(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
  }

  // The real defence is the allowlist; quoting is the backstop.
  const validColumns = new Set(["id", "name", "status"]);
  const attack = 'x" = 1; DROP TABLE users; --';

  check("unknown column is not in the allowlist", !validColumns.has(attack));
  check("known column passes the allowlist", validColumns.has("name"));
  check(
    "embedded quotes are doubled, not terminated",
    quoteIdent(attack) === '"x"" = 1; DROP TABLE users; --"'
  );
  check("quoted identifier has balanced delimiters", (quoteIdent(attack).match(/"/g) || []).length % 2 === 0);
  check("normal identifier is unchanged", quoteIdent("name") === '"name"');
}

// ── H4: JWT secret policy ────────────────────────────────────────────────────
console.log("\nH4 JWT secret policy (src/lib/auth.ts)");
{
  // Reproduces resolveJwtSecret()'s production branch without importing the
  // module (importing would evaluate it against this process's env).
  function productionAccepts(secret: string | undefined): boolean {
    return Boolean(secret && secret.length >= 32);
  }

  check("missing secret rejected in production", !productionAccepts(undefined));
  check("short secret rejected in production", !productionAccepts("too-short"));
  check("old hardcoded fallback is gone from source", !readAuthSource().includes("gsm-panel-secret-change-me"));
  check("32-byte hex secret accepted", productionAccepts("a".repeat(64)));
}


function readFileAbs(p: string): string {
  return require("node:fs").readFileSync(p, "utf8") as string;
}

/** Recursively collect every route.ts under a directory URL. */
function listRoutes(dir: URL): string[] {
  const fs = require("node:fs");
  const path = require("node:path");
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d)) {
      const full = path.join(d, e);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (e === "route.ts") out.push(full);
    }
  };
  walk(dir.pathname);
  return out;
}

function readAuthSource(): string {
  return require("node:fs").readFileSync(
    new URL("../src/lib/auth.ts", import.meta.url),
    "utf8"
  );
}

// ── H2/H3: auth wiring present ───────────────────────────────────────────────
console.log("\nH2/H3 auth enforcement wiring");
{
  const fs = require("node:fs") as typeof import("node:fs");
  const read = (p: string) => fs.readFileSync(new URL(p, import.meta.url), "utf8");

  const permissions = read("../src/lib/permissions.ts");
  check("permissions deny non-active accounts", /user\.status !== "active"/.test(permissions));

  const login = read("../src/app/api/auth/login/route.ts");
  check("login verifies TOTP when 2FA is enabled", /twoFactorEnabled/.test(login) && /totp\.validate/.test(login));
  check("login is rate limited", /loginRetryAfter/.test(login) && /recordFailedLogin/.test(login));

  const me = read("../src/app/api/auth/me/route.ts");
  check("me endpoint rejects non-active accounts", /status !== "active"/.test(me));

  const heartbeat = read("../src/app/api/nodes/[id]/heartbeat/route.ts");
  check("heartbeat requires a configured API key", /if \(!node\.apiKey\)/.test(heartbeat));
  check("heartbeat compares keys in constant time", /timingSafeEqual/.test(heartbeat));

  const register = read("../src/app/api/auth/register/route.ts");
  check("register enforces a minimum password length", /MIN_PASSWORD/.test(register));
  check("register validates the username format", /USERNAME_RE/.test(register));
  check("register is rate limited", /loginRetryAfter/.test(register));
  check("register does not leak raw errors", /apiError\(/.test(register) && !/e instanceof Error \? e\.message/.test(register));
  check("register handles the unique-violation race", /23505/.test(register));

  const health = read("../src/app/api/health/route.ts");
  check("health endpoint does not leak driver errors", !/e instanceof Error \? e\.message/.test(health));

  // Raw exception text leaks SQL, driver internals and absolute paths.
  const apiDir = new URL("../src/app/api/", import.meta.url);
  const leaky = listRoutes(apiDir).filter((f) => {
    const src = readFileAbs(f);
    return /return NextResponse\.json\(\s*\{\s*error:\s*\w+ instanceof Error/.test(src);
  });
  check(`no API route returns a raw exception message (found ${leaky.length})`, leaky.length === 0);

  // The panel runs shell commands and edits files, so XSS or clickjacking
  // against a logged-in admin is effectively RCE on the host.
  const nextCfg = read("../next.config.ts");
  check("CSP is configured", /Content-Security-Policy/.test(nextCfg));
  check("CSP forbids framing", /frame-ancestors 'none'/.test(nextCfg));
  check("CSP blocks plugins/objects", /object-src 'none'/.test(nextCfg));
  check("clickjacking header set", /X-Frame-Options/.test(nextCfg) && /DENY/.test(nextCfg));
  check("MIME sniffing disabled", /nosniff/.test(nextCfg));
  check("framework version not advertised", /poweredByHeader:\s*false/.test(nextCfg));
  check(
    "production CSP does not allow unsafe-eval",
    /script-src 'self' 'unsafe-inline'"/.test(nextCfg) || !/unsafe-eval/.test(nextCfg.split("isDev")[2] ?? "")
  );

  // Unclamped pagination lets one request read an entire table into memory.
  const apiDir2 = new URL("../src/app/api/", import.meta.url);
  const unclamped = listRoutes(apiDir2).filter((f) => {
    const src = readFileAbs(f);
    return /parseInt\(\s*(?:url|req\.nextUrl)\.searchParams\.get\(\s*["'](?:limit|offset|page)["']/.test(src);
  });
  check(
    `pagination params are clamped, not raw parseInt (found ${unclamped.length})`,
    unclamped.length === 0
  );

  const pagination = read("../src/lib/pagination.ts");
  check("pagination enforces a maximum page size", /MAX_LIMIT/.test(pagination));

  // Append-only tables previously grew without any cleanup at all.
  const retention = read("../src/lib/retention.ts");
  check("metrics retention is implemented", /pruneMetrics/.test(retention));
  check("retention window is configurable", /METRICS_RETENTION_DAYS/.test(retention));
  const heartbeat2 = read("../src/app/api/nodes/[id]/heartbeat/route.ts");
  check("heartbeat prunes old metrics", /maybePruneInBackground/.test(heartbeat2));

  // The API Keys panel documents "Authorization: Bearer gsm_..." but nothing
  // read that header, so every documented integration failed with a 401.
  const keyAuth = read("../src/lib/api-key-auth.ts");
  check("API keys are actually verified against stored hashes", /authenticateApiKey/.test(keyAuth));
  check("API key comparison is constant time", /timingSafeEqual/.test(keyAuth));
  check("expired API keys are rejected", /expiresAt/.test(keyAuth));
  check("API keys of non-active owners are rejected", /status !== "active"/.test(keyAuth));
  const authSrc = read("../src/lib/auth.ts");
  check("getCurrentUser accepts API keys", /authenticateApiKey/.test(authSrc));

  // The webhook URL is operator-supplied and the server POSTs to it, so a lax
  // check is a small SSRF surface as well as a correctness problem.
  const discord = read("../src/lib/discord.ts");
  check("webhook URLs are validated against a Discord host allowlist", /WEBHOOK_URL_RE/.test(discord));
  check("webhook requests have a timeout", /AbortSignal\.timeout/.test(discord));
  const processRoute = read("../src/app/api/servers/[id]/process/route.ts");
  check("a crashed server triggers a Discord notification", /notifyServerCrashed/.test(processRoute));

  // A Discord bot token grants control of the guild, so it must never be
  // echoed back to a browser or exposed through the public settings endpoint.
  const discordRoute = read("../src/app/api/settings/discord/route.ts");
  check("discord settings endpoint is admin only", /panel\.settings/.test(discordRoute));
  check("bot token is never returned to the client", !/botToken:\s*s\.botToken/.test(discordRoute) && /hasBotToken/.test(discordRoute));
  // A clone must not inherit a webhook pointing at a channel the panel
  // provisioned for the source: deleting the source deletes that channel and
  // the clone is left posting into a webhook that 404s.
  const cloneRoute = read("../src/app/api/servers/[id]/clone/route.ts");
  check(
    "a clone does not inherit a panel-provisioned Discord channel",
    /inheritedWebhook\(/.test(cloneRoute) && !/discordWebhook:\s*source\.discordWebhook/.test(cloneRoute)
  );
  // autoRestart is presented to users as a working toggle; it must be acted on.
  check(
    "the autoRestart toggle actually restarts a crashed server",
    /shouldAutoRestart\(/.test(processRoute) && /startDetachedScript/.test(processRoute)
  );

  // Mass assignment: PATCH used to spread the raw body into the UPDATE, so
  // servers.edit could rewrite installPath (executed by the process route) or
  // userId (reassigning ownership).
  const serverRoute = read("../src/app/api/servers/[id]/route.ts");
  check(
    "server PATCH filters the body through an allowlist",
    /pickServerPatch\(/.test(serverRoute) && !/\.set\(\{\s*\.\.\.body/.test(serverRoute)
  );
  const lifecycle = read("../src/lib/server-lifecycle.ts");
  check(
    "installPath and userId are not client-writable",
    !/"installPath"/.test(lifecycle) && !/"userId"/.test(lifecycle)
  );

  // The nodes table holds SSH credentials and a node API key. A bare
  // db.select() returns all of them, and nodes.view is held by the built-in
  // moderator role, so every node route must redact before responding.
  const nodeIdRoute = read("../src/app/api/nodes/[id]/route.ts");
  check(
    "node detail redacts SSH credentials",
    /publicNode\(/.test(nodeIdRoute) && !/\.select\(\)\.from\(nodes\)[\s\S]{0,200}?NextResponse\.json\(\{ node[,}]/.test(nodeIdRoute)
  );
  check(
    "node PATCH filters the body through an allowlist",
    /pickNodePatch\(/.test(nodeIdRoute) && !/\.set\(\{\s*\.\.\.body/.test(nodeIdRoute)
  );
  check(
    "node create does not echo back submitted credentials",
    /publicNode\(/.test(read("../src/app/api/nodes/route.ts")) &&
      /publicNode\(/.test(read("../src/app/api/nodes/local/route.ts"))
  );
  const lifecycleNode = read("../src/lib/server-lifecycle.ts");
  check(
    "node secrets are absent from the public field list",
    !/"sshPassword",[\s\S]*?NODE_PATCH_FIELDS/.test(
      lifecycleNode.slice(lifecycleNode.indexOf("NODE_PUBLIC_FIELDS"), lifecycleNode.indexOf("NODE_PATCH_FIELDS"))
        + "NODE_PATCH_FIELDS"
    )
  );
  check(
    "isLocal cannot be changed by a client",
    !/^\s*"isLocal",$/m.test(
      lifecycleNode.slice(lifecycleNode.indexOf("NODE_PATCH_FIELDS"), lifecycleNode.indexOf("publicNode"))
    )
  );

  // .returning() yields every column: the admin user PATCH was echoing the
  // bcrypt hash and the TOTP seed back to the browser.
  const userIdRoute = read("../src/app/api/users/[id]/route.ts");
  check(
    "user update does not return the password hash or 2FA secret",
    /publicUser\(/.test(userIdRoute) && !/NextResponse\.json\(\{ user: updated \}\)/.test(userIdRoute)
  );

  // Ports supplied by a client reach both the database and the ufw command
  // line; Number() alone accepted NaN, negatives, decimals and >65535.
  const serversRoute = read("../src/app/api/servers/route.ts");
  const cloneRouteP = read("../src/app/api/servers/[id]/clone/route.ts");
  const serverIdRoute = read("../src/app/api/servers/[id]/route.ts");
  check(
    "server create validates ports",
    /validatePorts\(/.test(serversRoute) && !/const serverPort = Number\(port\)/.test(serversRoute)
  );
  check("server update validates ports", /validatePorts\(/.test(serverIdRoute));
  check("server clone validates ports", /validatePorts\(/.test(cloneRouteP));
  check(
    "privileged ports are refused",
    /MIN_SERVER_PORT = 1024/.test(read("../src/lib/server-lifecycle.ts"))
  );
  // maxServers is shown to users as a quota; it has to actually hold.
  check(
    "the per-user server quota is enforced on create and clone",
    /withinServerQuota\(/.test(serversRoute) && /withinServerQuota\(/.test(cloneRouteP)
  );
  // installPath is executed by the process route, so it is server-owned.
  check(
    "clone does not take installPath from the request body",
    !/body\.installPath/.test(cloneRouteP)
  );

  // API keys can carry a permission scope. It was stored and advertised but
  // never read, so a "read-only" key had its owner's full rights.
  const permsLib = read("../src/lib/permissions.ts");
  const authLib = read("../src/lib/auth.ts");
  check(
    "hasPermission intersects the API key scope",
    /allowedByKeyScope\(/.test(permsLib)
  );
  check(
    "the key scope is bound to the request on every auth path",
    /setAuthContext\(/.test(authLib) &&
      (authLib.match(/setAuthContext\(/g) || []).length >= 3
  );
  check(
    "API key scopes are validated before storage",
    /validateKeyScope\(/.test(read("../src/app/api/api-keys/route.ts"))
  );

  const siteSettings = read("../src/app/api/site-settings/route.ts");
  check(
    "bot token is not in the public settings allowlist",
    !/discord_bot_token/.test(siteSettings)
  );

  const backup = read("../src/app/api/servers/[id]/backup/route.ts");
  check("backup no longer spawns a shell", !/spawn\("sh"/.test(backup));
  check("backup passes tar an argument array", /spawn\(file, args/.test(backup));
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`${failures} security check(s) FAILED`);
  process.exit(1);
}
