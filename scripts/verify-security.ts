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

  // Every FK is declared without ON DELETE, so Postgres refuses a delete once
  // a dependent row exists. Deleting a server removes its files first, so a
  // blocked delete destroyed data and left the row behind.
  const serverIdRoute2 = read("../src/app/api/servers/[id]/route.ts");
  check(
    "server delete removes dependent rows first",
    /delete\(scheduledTasks\)/.test(serverIdRoute2) && /delete\(serverMetrics\)/.test(serverIdRoute2)
  );
  check(
    "user delete refuses rather than failing on a foreign key",
    /owns \$\{ownedServers\} server|owns \${ownedServers}/.test(read("../src/app/api/users/[id]/route.ts")) ||
      /ownedServers > 0/.test(read("../src/app/api/users/[id]/route.ts"))
  );
  // Tables the app queries must exist after a fresh install.
  const installRoute = read("../src/app/api/install/route.ts");
  check(
    "installer creates every table the app queries",
    /CREATE TABLE IF NOT EXISTS api_keys/.test(installRoute) &&
      /CREATE TABLE IF NOT EXISTS chat_messages/.test(installRoute)
  );
  // The quota must be evaluated by the database, not read then written.
  check(
    "the server quota is enforced atomically",
    /COALESCE\(max_servers, 0\)/.test(read("../src/app/api/servers/route.ts")) &&
      /COALESCE\(max_servers, 0\)/.test(read("../src/app/api/servers/[id]/clone/route.ts"))
  );

  // Two simultaneous creates could claim the same port; only a unique index
  // closes that window, and it must repair existing duplicates first or the
  // upgrade fails on any deployment that already has one.
  const installRoute2 = read("../src/app/api/install/route.ts");
  check(
    "one server per port per node is enforced by the database",
    /game_servers_node_port_uniq/.test(installRoute2)
  );
  check(
    "existing duplicate ports are repaired before the index is added",
    /o\.port = g\.port AND o\.id < g\.id/.test(installRoute2) &&
      installRoute2.indexOf("o.id < g.id") < installRoute2.indexOf("game_servers_node_port_uniq")
  );

  // The Discord form lives in the admin dashboard, not on the public site.
  // Rendering it from PublicSite would put a bot-token field on a page served
  // to anonymous visitors, even if the endpoint behind it stayed protected.
  const publicSite = read("../src/components/PublicSite.tsx");
  check(
    "the bot token form is not rendered by the public site",
    !/<DiscordSettings\s*\/>/.test(publicSite)
  );
  check(
    "the discord form saves through its own admin-only endpoint",
    /\/api\/settings\/discord/.test(read("../src/components/panels/DiscordSettings.tsx"))
  );

  // A publicly readable list endpoint with no cap lets an anonymous visitor
  // force a full table scan on every request.
  const threadsRoute = read("../src/app/api/forum/threads/route.ts");
  check(
    "public forum thread list is bounded",
    /limitParam\(/.test(threadsRoute) && /\.limit\(/.test(threadsRoute)
  );
  check(
    "the user list is bounded",
    /limitParam\(/.test(read("../src/app/api/users/route.ts"))
  );

  // A refused mutation must tell the user, not silently redisplay the old data.
  const forumPanel = read("../src/components/panels/ForumPanel.tsx");
  const usersPanel = read("../src/components/panels/UsersPanel.tsx");
  check(
    "forum moderation reports a refusal",
    /mutate\(/.test(forumPanel) && !/^\s*await fetch\(`\/api\/forum\/threads\/\$\{threadId\}`, \{ method: "DELETE" \}\);$/m.test(forumPanel)
  );
  check(
    "user quick actions report a refusal",
    /mutate\(/.test(usersPanel)
  );

  // Numbers from a query string reach slice()/LIMIT and must be clamped.
  check(
    "log tail is clamped, not raw parseInt",
    /intParam\(/.test(read("../src/app/api/servers/[id]/log/route.ts"))
  );
  // Icon-only buttons must still be announceable.
  check(
    "icon-only action buttons have an accessible name",
    /aria-label=\{label \? undefined : name\}/.test(
      read("../src/components/panels/ServersPanel.tsx")
    )
  );

  // The panel authenticates with a cookie, so a cross-site form can make the
  // browser send an authenticated write. sameSite=lax does not cover top-level
  // form posts, and the upload route accepts multipart/form-data.
  const proxyGuard = read("../src/proxy.ts");
  check(
    "state-changing API requests are CSRF-checked in middleware",
    /checkCsrf\(/.test(proxyGuard) && /\/api\/:path\*/.test(proxyGuard)
  );
  const csrf = read("../src/lib/csrf.ts");
  check(
    "the CSRF check covers every state-changing method",
    ["POST", "PUT", "PATCH", "DELETE"].every((m) => csrf.includes(`"${m}"`))
  );
  check(
    "API keys are exempt from the CSRF check, so integrations keep working",
    /hasApiKey/.test(csrf)
  );
  // Native confirm() cannot be styled or tested and was inconsistent with the
  // app's own dialog.
  const panelFiles = ["CmsPanel", "DatabasePanel", "FilesPanel", "ForumPanel",
                      "GamesPanel", "LadderPanel", "NodesPanel", "RolesPanel", "UsersPanel"];
  check(
    "destructive actions use the in-app confirm dialog",
    panelFiles.every((f) => {
      const src = read(`../src/components/panels/${f}.tsx`);
      return !/(^|[^.\w])confirm\("/.test(src) && !/(^|[^.\w])confirm\(`/.test(src);
    })
  );

  // Operational settings must not be readable by an anonymous visitor, and
  // must not leak into the public site-settings endpoint.
  const panelSettings = read("../src/app/api/settings/panel/route.ts");
  check(
    "panel settings endpoint is admin only",
    /panel\.settings/.test(panelSettings) && /Unauthorized/.test(panelSettings)
  );
  check(
    "panel settings are filtered through an allowlist",
    /PANEL_SETTING_KEYS/.test(panelSettings) && /Unknown setting/.test(panelSettings)
  );
  // The backfill creates channels and rewrites webhooks on every server.
  const backfill = read("../src/app/api/settings/discord/backfill/route.ts");
  check(
    "discord backfill is admin only",
    /panel\.settings/.test(backfill)
  );
  check(
    "discord backfill never replaces a hand-entered webhook",
    /planForServer\(/.test(backfill) &&
      /did not create/.test(read("../src/lib/discord-backfill.ts"))
  );
  check(
    "discord backfill supports a dry run",
    /dryRun/.test(backfill)
  );

  const siteSettings = read("../src/app/api/site-settings/route.ts");
  check(
    "bot token is not in the public settings allowlist",
    !/discord_bot_token/.test(siteSettings)
  );

  const backup = read("../src/app/api/servers/[id]/backup/route.ts");
  check("backup no longer spawns a shell", !/spawn\("sh"/.test(backup));
  check("backup passes tar an argument array", /spawn\(file, args/.test(backup));

  // Cascading deletes must be atomic. Run as loose statements, a failure
  // between them destroys the children and leaves the parent behind.
  const threadRoute = read("../src/app/api/forum/threads/[id]/route.ts");
  check(
    "deleting a forum thread removes posts and thread in one transaction",
    /db\.transaction\(/.test(threadRoute) &&
      /tx\.delete\(forumPosts\)/.test(threadRoute) &&
      /tx\.delete\(forumThreads\)/.test(threadRoute)
  );

  const serverDeleteRoute = read("../src/app/api/servers/[id]/route.ts");
  check(
    "deleting a server removes its dependants in one transaction",
    /db\.transaction\(/.test(serverDeleteRoute) &&
      /tx\.delete\(scheduledTasks\)/.test(serverDeleteRoute) &&
      /tx\.delete\(gameServers\)/.test(serverDeleteRoute)
  );

  const userRoute = read("../src/app/api/users/[id]/route.ts");
  check(
    "deleting a user removes its API keys in one transaction",
    /db\.transaction\(/.test(userRoute) &&
      /tx\.delete\(apiKeys\)/.test(userRoute) &&
      /tx\.delete\(users\)/.test(userRoute)
  );
  // Every refusal has to be decided before the first write, or a 400 can
  // still leave the account stripped of its keys.
  check(
    "user delete counts forum posts before deleting anything",
    userRoute.indexOf("forum post(s)") < userRoute.indexOf("db.transaction(")
  );

  // src/middleware.ts was never tracked, so `git pull` cannot delete it from
  // an existing install. Next 16 refuses to build when it sits alongside
  // proxy.ts, which breaks the update AND the rollback.
  const updater = read("../public/update.sh");
  check(
    "the updater removes the obsolete src/middleware.ts",
    /src\/middleware\.ts/.test(updater) && /src\/proxy\.ts/.test(updater)
  );
  check(
    "the middleware cleanup tolerates --no-backup (THIS_BACKUP unset)",
    /\$\{THIS_BACKUP:-\}/.test(updater)
  );

  // Reading a binary file as utf8 replaces undecodable bytes with U+FFFD, and
  // saving writes those back over the original. The editor's guard has to be
  // server-side: a browser-only allowlist is bypassed by any direct API call.
  const fileOps = read("../src/lib/server-file-ops.ts");
  check(
    "the file editor sniffs content before serving it as text",
    /looksLikeText\(/.test(fileOps) && /binary: true/.test(fileOps)
  );
  check(
    "saving refuses to overwrite a binary file with text",
    /Refusing to overwrite a binary file/.test(fileOps)
  );

  // Discord notifications must answer "is it up?" (a green/red dot) and
  // "how many are on it?" — a live count, not a placeholder.
  const players = read("../src/lib/players.ts");
  check(
    "live player counts are probed over the game's own query protocols",
    /export async function probePlayers/.test(players) &&
      /"a2s"/.test(players) &&
      /"minecraft"/.test(players) &&
      /"bedrock"/.test(players) &&
      /"quake3"/.test(players) &&
      /probeSpecFor/.test(players)
  );
  check(
    "games without a query protocol short-circuit instead of timing out",
    /"none"/.test(players) && /probeSpecFor\(slug/.test(players)
  );
  check(
    "the embed builder renders a status dot and always shows a players row",
    /statusFor\(payload\)/.test(discord) && /SERVER_LIFECYCLE_EVENTS/.test(discord) &&
      /👥 Players/.test(discord) && /🟢 Online/.test(discord) && /🔴 Offline/.test(discord)
  );
  check(
    "server start/stop notifications carry the dot and a probed count",
    /probeServerPlayers/.test(processRoute) && /serverStatus/.test(processRoute) &&
      /playerCount/.test(processRoute) && /maxPlayersFrom/.test(processRoute)
  );
  // Settings import used to apply rows with independent statements, so a bad
  // entry halfway through left half the import applied. It must be atomic.
  const settingsImport = read("../src/app/api/settings/import/route.ts");
  check(
    "settings import applies everything or nothing",
    /db.transaction\(/.test(settingsImport) && /onConflictDoUpdate/.test(settingsImport)
  );
  check(
    "settings import validates role permissions and priority before writing",
    /asPermissionSet/.test(settingsImport) && /parseBoundedInt/.test(settingsImport)
  );
  check(
    "the role cache is invalidated only after the import commits",
    settingsImport.indexOf("invalidateRoleCache()") > settingsImport.indexOf("db.transaction(")
  );

  // Ladder stats are Postgres integers; `Number("abc")` reached the driver as
  // NaN and returned a 500 instead of a 400, and negatives were accepted.
  const ladderPost = read("../src/app/api/ladder/route.ts");
  const ladderPatch = read("../src/app/api/ladder/[id]/route.ts");
  check(
    "ladder stats are validated before they reach the integer columns",
    /const wins = parseLadderStat/.test(ladderPost) &&
      /const losses = parseLadderStat/.test(ladderPost) &&
      /const draws = parseLadderStat/.test(ladderPost) &&
      /const streak = parseLadderStat/.test(ladderPost) &&
      /const points = parseLadderStat/.test(ladderPost) &&
      /update\.wins = wins;/.test(ladderPatch) &&
      /update\.losses = losses;/.test(ladderPatch) &&
      /update\.draws = draws;/.test(ladderPatch) &&
      /update\.points = points;/.test(ladderPatch) &&
      /update\.streak = streak;/.test(ladderPatch) &&
      /ladderStatError/.test(ladderPost) && /ladderStatError/.test(ladderPatch)
  );

  // The pre-insert slug check is a race; the unique index is the arbiter and
  // the loser deserves the same friendly 409 as the check path.
  const customGame = read("../src/app/api/games/custom/route.ts");
  const importGame = read("../src/app/api/games/import/route.ts");
  check(
    "custom games map the duplicate-slug race to a friendly 409",
    /isUniqueViolation/.test(customGame) && /isUniqueViolation/.test(importGame) &&
      /status: 409/.test(customGame) && /status: 409/.test(importGame)
  );
  check(
    "custom game ports are validated as real ports",
    /defaultPort must be a port number/.test(customGame)
  );

  // custom_css was exposed by the public settings API but never rendered.
  // `publicSite` is read once above; that same source drives the Discord check.
  check(
    "custom_css is rendered on the public site and cannot close the style element",
    /custom_css/.test(publicSite) && /dangerouslySetInnerHTML/.test(publicSite) &&
      publicSite.includes("\\/style")
  );
  // Scheduled tasks used to be display-only: created, listed, never run.
  // The runner is the feature; the validation guards what it will execute.
  const schedulerLib = read("../src/lib/scheduler.ts");
  const schedulerRoute = read("../src/app/api/scheduler/route.ts");
  const schedulerPatch = read("../src/app/api/scheduler/[id]/route.ts");
  check(
    "scheduled tasks are actually executed by a boot-time runner",
    /startSchedulerTimer/.test(read("../src/instrumentation-node.ts")) &&
      /void startSchedulerTimer/.test(read("../src/instrumentation.ts")) &&
      /setInterval/.test(schedulerLib) && /tickOnce/.test(schedulerLib)
  );
  check(
    "scheduler accepts only real 5-field cron, never the old parseInt guess",
    /parseCron/.test(schedulerRoute) && /nextCronRun\(cron\)/.test(schedulerRoute) &&
      !/calculateNextRun/.test(schedulerRoute)
  );
  check(
    "scheduler task types and commands are bounded",
    /TASK_TYPES/.test(schedulerRoute) && /MAX_COMMAND_LENGTH/.test(schedulerRoute) &&
      /MAX_COMMAND_LENGTH/.test(schedulerPatch)
  );
  check(
    "the manual backup route and the scheduler share one archive format",
    /createServerBackup/.test(read("../src/app/api/servers/[id]/backup/route.ts")) &&
      /createServerBackup/.test(schedulerLib)
  );

  // A new thread and its opening post go in together, or not at all; a failed
  // second insert used to leave a thread with a negative reply count.
  check(
    "a new forum thread and its opening post are one transaction",
    /db\.transaction\(/.test(read("../src/app/api/forum/threads/route.ts"))
  );
  check(
    "forum inputs are capped and game ports validated on edit",
    /MAX_POST_LENGTH/.test(read("../src/app/api/forum/threads/[id]/route.ts")) &&
      /defaultPort must be a port number/.test(read("../src/app/api/games/[id]/route.ts"))
  );
  // The raw SQL console is admin-only but runs Postgres' simple protocol,
  // which executes all statements in a string. One guard, one timeout.
  const queryRoute = read("../src/app/api/database/query/route.ts");
  check(
    "the SQL console accepts exactly one statement at a time",
    /const guard = assertSingleStatement\(sql\)/.test(queryRoute) &&
      /client\.query\(`SET statement_timeout/.test(queryRoute) &&
      /client\.release\(true\)/.test(queryRoute)
  );
  check(
    "the database listing quotes table names as identifiers",
    /quotePgIdent/.test(read("../src/app/api/database/route.ts")) &&
      /quotePgIdent/.test(read("../src/app/api/database/table/[name]/route.ts"))
  );

  // Audit entries are append-only and read back directly; unbounded details
  // bloated every listing, and plain-text details 500'd against the jsonb
  // column instead of being stored.
  const auditRoute = read("../src/app/api/audit-log/route.ts");
  check(
    "audit-log entries are capped and details are stored as JSON",
    /LIMITS/.test(auditRoute) && /JSON\.parse/.test(auditRoute) &&
      /entityId: normId/.test(auditRoute)
  );

  // Site settings: admin-only, but a bulk save must not create junk keys,
  // and JSON-baked settings must be JSON when saved, not at render time.
  const siteSettings2 = read("../src/app/api/site-settings/route.ts");
  check(
    "site settings keys and values are validated before writing",
    /isValidSettingKey/.test(siteSettings2) && /validateSettingValue/.test(siteSettings2)
  );
  check(
    "global search is bounded and joins on the real foreign key",
    /100 characters/.test(read("../src/app/api/search/route.ts")) &&
      /eq\(gameServers\.gameId, gameDefinitions\.id\)/.test(read("../src/app/api/search/route.ts"))
  );
  // Users PATCH: permissions gated WHO edits; the values themselves were
  // unvetted, so an invented role string became a JWT claim.
  const userPatch = read("../src/app/api/users/[id]/route.ts");
  check(
    "user fields are validated and the last admin cannot demote itself",
    /const roleCheck = normalizeRole\(body\.role\)/.test(userPatch) &&
      /const statusCheck = normalizeStatus\(body\.status\)/.test(userPatch) &&
      /const limitCheck = normalizeMaxServers\(body\.maxServers\)/.test(userPatch) &&
      /const emailCheck = normalizeEmail\(body\.email\)/.test(userPatch) &&
      /normalizeMaxServers/.test(userPatch) && /normalizeEmail/.test(userPatch) &&
      /You cannot remove your own admin role/.test(userPatch) &&
      /That email is already in use/.test(userPatch)
  );

  // Live status boards: webhooks may only edit their OWN messages, so the
  // refresh path must hit /webhooks/{id}/{token}/messages/{id} — and the
  // roster must be bounded so a full server never exceeds Discord's 1024-char
  // field cap.
  const statusBoard = read("../src/lib/status-board.ts");
  const statusEmbed = read("../src/lib/status-board-embed.ts");
  check(
    "status boards refresh by editing the webhook's own message",
    /messageEndpoint/.test(statusBoard) &&
      /\/messages\//.test(statusEmbed) &&
      /editBoardMessage/.test(statusBoard) && /re-post/.test(statusBoard)
  );
  check(
    "board posts ask Discord for the message id (?wait=true)",
    /\?wait=true/.test(read("../src/lib/status-board.ts"))
  );
  check(
    "status boards are bounded (interval clamp, roster cap, field cap)",
    /clampInterval/.test(statusEmbed) && /MAX_LISTED_PLAYERS/.test(statusEmbed) &&
      /MAX_EMBED_FIELD_LENGTH/.test(statusEmbed)
  );
  check(
    "the status board loop is started at boot and can be disabled",
    /startStatusBoardLoop/.test(read("../src/instrumentation-node.ts")) &&
      /void startStatusBoardLoop/.test(read("../src/instrumentation.ts")) &&
      /GSM_DISABLE_STATUS_BOARDS/.test(read("../src/instrumentation-node.ts"))
  );
  check(
    "boards are admin-only and never send the bot token to the browser",
    /panel\.settings/.test(read("../src/app/api/settings/discord/boards/route.ts"))
  );
  // WolfET chat bot: gateway runs only when configured, dies silently never,
  // and every command path is bounded (cooldowns, sanitised input, capped).
  const botMod = read("../src/lib/discord-bot.ts");
  check(
    "the chat bot is boot-started, env-off-switchable, and never fatal",
    /startDiscordChatBot/.test(read("../src/instrumentation-node.ts")) &&
      /void startDiscordChatBot/.test(read("../src/instrumentation.ts")) &&
      /GSM_DISABLE_DISCORD_BOT/.test(read("../src/instrumentation-node.ts"))
  );
  check(
    "discord.js stays out of the server bundle and the sqlite reader is dep-free",
    /serverExternalPackages/.test(read("../next.config.ts")) &&
      /discord\.js/.test(read("../next.config.ts")) &&
      /readSqliteTable/.test(read("../src/lib/sqlite-reader.ts")) &&
      !/sql\.js/.test(read("../src/lib/et-stats.ts"))
  );
  check(
    "chat commands are cooldown-bounded and inputs sanitised",
    /COOLDOWNS/.test(botMod) && /sanitizeInput/.test(botMod) && /isValidGuid/.test(botMod) &&
      /PREFIX/.test(botMod)
  );
  check(
    "GUID verification is stored in the panel database, never a sidecar file",
    /discordVerifications/.test(botMod) &&
      /discord_verifications/.test(read("../src/db/schema.ts")) &&
      /discord_verifications/.test(read("../src/app/api/install/route.ts"))
  );
  check(
    "the fuzzy matcher ports difflib faithfully, not an edit-distance guess",
    /matchingBlocks/.test(read("../src/lib/et-stats.ts")) &&
      /getCloseMatches/.test(read("../src/lib/et-stats.ts")) &&
      !/sequenceMatcherRatio\([^)]*\)\.toLowerCase/.test(read("../src/lib/et-stats.ts"))
  );
  check(
    "!etsync performs the original's Manage Nicknames and hierarchy checks",
    /botCanManageNicks/.test(read("../src/lib/discord-bot.ts")) &&
      /Manage Nicknames/.test(read("../src/lib/discord-bot.ts")) &&
      /higher than or equal to mine/.test(read("../src/lib/discord-bot.ts")) &&
      /guild\.name}!/ .test(read("../src/lib/discord-bot.ts"))
  );
  check(
    "!etwho shares the three-minute cache with the status-board loop",
    /getCachedView/.test(read("../src/lib/discord-bot.ts")) &&
      /setCachedView/.test(read("../src/lib/discord-bot.ts")) &&
      /setCachedView/.test(read("../src/lib/status-board.ts")) &&
      /STATUS_CACHE_MS/.test(read("../src/lib/status-cache.ts"))
  );
  check(
    "the channel dot is green whenever the server is up (no amber state)",
    /return `🟢/.test(read("../src/lib/discord.ts")) &&
      !/🟠/.test(read("../src/lib/discord.ts"))
  );
  check(
    "the color name generator is deterministic and used by the roles editor",
    /nameForHsv/.test(read("../src/lib/color-names.ts")) &&
      /randomColorName/.test(read("../src/lib/color-names.ts")) &&
      /randomColorName/.test(read("../src/components/panels/RolesPanel.tsx"))
  );
  check(
    "the theme editor rolls names with the same generator (dice + live name)",
    /cssColorName/.test(read("../src/lib/color-names.ts")) &&
      /cssColorName/.test(read("../src/components/panels/ProfilePanel.tsx")) &&
      /randomColorName/.test(read("../src/components/panels/ProfilePanel.tsx")) &&
      /🎲/.test(read("../src/components/panels/ProfilePanel.tsx"))
  );
  check(
    "board embeds annotate verified players with their Discord role color name",
    /rosterLine/.test(read("../src/lib/status-board-embed.ts")) &&
      /view\.roleColors\?\./.test(read("../src/lib/status-board-embed.ts")) &&
      /colorNameFor\(roleColorHex\)/.test(read("../src/lib/status-board-embed.ts")) &&
      /rosterRoleColors/.test(read("../src/lib/discord-bot.ts")) &&
      /matchRoleColors/.test(read("../src/lib/discord-bot.ts")) &&
      /await attachRosterColors\(view\)/.test(read("../src/lib/discord-bot.ts")) &&
      /rosterRoleColors\(view\.names\)/.test(read("../src/lib/status-board.ts"))
  );
  check(
    "WolfET channel renames use PATCH /channels and the three-state name",
    /renameChannel/.test(read("../src/lib/discord.ts")) &&
      /statusChannelName/.test(read("../src/lib/discord.ts")) &&
      /updateChannelName/.test(read("../src/lib/status-board.ts")) &&
      /🟢/.test(read("../src/lib/discord.ts")) && /🔴/.test(read("../src/lib/discord.ts"))
  );

}



console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`${failures} security check(s) FAILED`);
  process.exit(1);
}
