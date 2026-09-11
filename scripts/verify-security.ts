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
import { validatePresetInput, mergePresetVariables } from "../src/lib/server-presets";
import { scoreNode, recommendNodeId, type NodeCandidate } from "../src/lib/node-health";
import { normalizeServerNotes, SERVER_PATCH_FIELDS } from "../src/lib/server-lifecycle";
import { normalizeServerTags } from "../src/lib/server-tags";
import { clampFeedHours, FEED_MAX_HOURS } from "../src/lib/event-feed";
import { validateBatchRequest, validateBatchServerIds, partitionBatch, BATCH_MAX_SIZE } from "../src/lib/batch-ops";
import { validatePresetImport } from "../src/lib/server-presets";
import { parseDailyRestartCron, buildDailyRestartCron } from "../src/lib/daily-restart";
import { normalizeAccessKey, isValidAccessKeyFormat, hashAccessKey } from "../src/lib/access-keys";
import { connectInfoFor, pickHost } from "../src/lib/connect-info";
import { summarizeUptime, clampUptimeHours, uptimeGrade } from "../src/lib/uptime";
import { nextIdleStamp, idleDurationMs, isServerIdle, shouldIdleStop } from "../src/lib/idle-math";
import { isKeyStale, daysUntilExpiry } from "../src/lib/key-hygiene";
import { isAlertMuted, clampMuteHours } from "../src/lib/alert-mute";
import { forecastDaysUntil, capacityVerdict } from "../src/lib/capacity";
import { assessDrill, latestBackupName } from "../src/lib/backup-drill";
import { clampPaletteIndex, stepPaletteIndex } from "../src/lib/palette";
import { escapeCsvField, seriesToCsv } from "../src/lib/csv-export";
import { diffServerPatch } from "../src/lib/server-changes";
import { ipAllowed, parseAllowList } from "../src/lib/ip-allowlist";
import { isSafeInstallPath, clampTtlHours } from "../src/lib/ephemeral";
import { buildHeatmap } from "../src/lib/player-history";
import { detectAnomalies } from "../src/lib/anomaly";
import { formatFleetDigest } from "../src/lib/fleet-digest";
import { validateWebhookUrl, verifyWebhookSignature, signWebhookPayload } from "../src/lib/outbound-webhook";
import { validatePanelImport, IMPORTABLE_SETTING_KEYS, IMPORTABLE_TASK_TYPES } from "../src/lib/panel-export";

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
  check(
    "!etallofoz also probes ET servers configured outside the panel",
    /GSM_ET_EXTRA_SERVERS/.test(read("../src/lib/discord-settings.ts")) &&
      /GSM_ET_MASTER_URLS/.test(read("../src/lib/discord-settings.ts")) &&
      /"et_extra_servers"/.test(read("../src/lib/discord-settings.ts")) &&
      /loadExternalEtServers/.test(read("../src/lib/et-extra-servers.ts")) &&
      /parseExtraServerList/.test(read("../src/lib/et-extra-servers.ts")) &&
      /loadExternalEtServers\(\{/.test(read("../src/lib/discord-bot.ts")) &&
      /configText: settings\.extraServers/.test(read("../src/lib/discord-bot.ts")) &&
      /panelServers: servers\.map/.test(read("../src/lib/discord-bot.ts")) &&
      /external: true/.test(read("../src/lib/discord-bot.ts"))
  );
  check(
    "master-server discovery parses replies and is capped",
    /export function parseMasterChunk/.test(read("../src/lib/et-extra-servers.ts")) &&
      /getservers 69/.test(read("../src/lib/et-extra-servers.ts")) &&
      /MAX_DISCOVERED_SERVERS = 25/.test(read("../src/lib/et-extra-servers.ts")) &&
      /const cap = Math\.max\(0, input\.maxDiscovered \?\? MAX_DISCOVERED_SERVERS\)/.test(read("../src/lib/et-extra-servers.ts")) &&
      /export const DEFAULT_MASTER_URLS = \[/.test(read("../src/lib/et-extra-servers.ts")) &&
      /"etmaster\.idsoftware\.com",/.test(read("../src/lib/et-extra-servers.ts")) &&
      /"master0\.etmaster\.net",/.test(read("../src/lib/et-extra-servers.ts")) &&
      /"master3\.idsoftware\.com:27900",/.test(read("../src/lib/et-extra-servers.ts")) &&
      /"master\.etlegacy\.com",/.test(read("../src/lib/et-extra-servers.ts")) &&
      /masterUrls: DEFAULT_MASTER_URLS,/.test(read("../src/lib/discord-settings.ts")) &&
      /EXTRA_PROBE_BATCH = \d+/.test(read("../src/lib/discord-bot.ts")) &&
      !/EXTRA_PROBE_BATCH = 1\b/.test(read("../src/lib/discord-bot.ts"))
  );
  check(
    "the 32-bit Source servers warn when the i386 libs are missing",
    /dpkg --add-architecture i386/.test(read("../src/db/games/steamcmd.ts")) &&
      /i386\?: boolean/.test(read("../src/db/games/steamcmd.ts")) &&
      /i386: true/.test(read("../src/db/games/tf2.ts")) &&
      /i386: true/.test(read("../src/db/games/gmod.ts")) &&
      /i386: true/.test(read("../src/db/games/l4d2.ts"))
  );
  check(
    "Unturned installs AppID 1110390 with its Commands.dat config",
    /appId: "1110390"/.test(read("../src/db/games/unturned.ts")) &&
      /Unturned_Headless\.x86_64/.test(read("../src/db/games/unturned.ts")) &&
      /Servers\/\$SERVER_DIR\/Server\/Commands\.dat/.test(read("../src/db/games/unturned.ts")) &&
      /\+InternetServer\/\{\{SERVER_DIR\}\}/.test(read("../src/db/games/unturned.ts"))
  );
  check(
    "Core Keeper uses the dedicated-server AppID 1963720 and a local data path",
    /appId: "1963720"/.test(read("../src/db/games/core-keeper.ts")) &&
      /bash _launch\.sh/.test(read("../src/db/games/core-keeper.ts")) &&
      /-datapath "\{\{INSTALL_PATH\}\}\/DedicatedServer"/.test(read("../src/db/games/core-keeper.ts")) &&
      /"DedicatedServer\/ServerConfig\.json"/.test(read("../src/db/games/core-keeper.ts"))
  );
  check(
    "Mindustry pipes config port + host through a console-bridging wrapper",
    /server-release\.jar/.test(read("../src/db/games/mindustry.ts")) &&
      /config port %s/.test(read("../src/db/games/mindustry.ts")) &&
      /mindustry-start\.sh/.test(read("../src/db/games/mindustry.ts")) &&
      /bash mindustry-start\.sh/.test(read("../src/db/games/mindustry.ts"))
  );
  check(
    "Vintage Story pins a version, installs .NET 10 and starts with DOTNET_ROOT",
    /"VS_VERSION"/.test(read("../src/db/games/vintage-story.ts")) &&
    /"Server Version"/.test(read("../src/db/games/vintage-story.ts")) &&
      /--channel 10\.0/.test(read("../src/db/games/vintage-story.ts")) &&
      /DOTNET_ROOT="\{\{INSTALL_PATH\}\}\/\.dotnet"/.test(read("../src/db/games/vintage-story.ts")) &&
      /VintagestoryServer --dataPath/.test(read("../src/db/games/vintage-story.ts"))
  );
  check(
    "the Fabric template installs from the official meta API and runs the JRE bootstrap",
    /meta\.fabricmc\.net\/v2\/versions\/loader/.test(read("../src/db/games/minecraft-fabric.ts")) &&
      /"stable":true\)'/.test(read("../src/db/games/minecraft-fabric.ts")) &&
      /-downloadMinecraft/.test(read("../src/db/games/minecraft-fabric.ts")) &&
      /ensure_java "\$MIN_JAVA"/.test(read("../src/db/games/minecraft-fabric.ts")) &&
      /fabric-server-launch\.jar nogui/.test(read("../src/db/games/minecraft-fabric.ts")) &&
      /"minecraft-fabric": \{ kind: "minecraft"/.test(read("../src/lib/players.ts")) &&
      /"minecraft-fabric": \["fabric-server-launch\.jar"\]/.test(read("../src/db/games/index.ts"))
  );
  check(
    "Counter-Strike: Source installs AppID 740 with the 32-bit lib warning",
    /appId: "740"/.test(read("../src/db/games/counter-strike-source.ts")) &&
      /i386: true/.test(read("../src/db/games/counter-strike-source.ts")) &&
      /srcds_run -game cstrike/.test(read("../src/db/games/counter-strike-source.ts")) &&
      /"cstrike\/cfg\/server\.cfg"/.test(read("../src/db/games/counter-strike-source.ts")) &&
      /"counter-strike-source": \{ kind: "a2s"/.test(read("../src/lib/players.ts")) &&
      /"counter-strike-source": \["srcds_run"\]/.test(read("../src/db/games/index.ts"))
  );
  check(
    "the NeoForge template installs from the official Maven and runs the JRE bootstrap",
    /maven\.neoforged\.net\/releases\/net\/neoforged\/neoforge\/maven-metadata\.xml/.test(read("../src/db/games/minecraft-neoforge.ts")) &&
      /--installServer/.test(read("../src/db/games/minecraft-neoforge.ts")) &&
      /sort -V \| tail -1/.test(read("../src/db/games/minecraft-neoforge.ts")) &&
      /ensure_java "\$MIN_JAVA"/.test(read("../src/db/games/minecraft-neoforge.ts")) &&
      /exec bash run\.sh nogui/.test(read("../src/db/games/minecraft-neoforge.ts")) &&
      /eula=true/.test(read("../src/db/games/minecraft-neoforge.ts")) &&
      /"minecraft-neoforge": \{ kind: "minecraft"/.test(read("../src/lib/players.ts")) &&
      /"minecraft-neoforge": \["run\.sh"\]/.test(read("../src/db/games/index.ts"))
  );
  check(
    "TShock installs a server-local .NET runtime and the start uses it",
    /ensure_dotnet\(\) \{/.test(read("../src/db/games/terraria.ts")) &&
      /ensure_dotnet \|\| true/.test(read("../src/db/games/terraria.ts")) &&
      /https:\/\/dot\.net\/v1\/dotnet-install\.sh/.test(read("../src/db/games/terraria.ts")) &&
      /--channel 9\.0/.test(read("../src/db/games/terraria.ts")) &&
      /--runtime aspnetcore/.test(read("../src/db/games/terraria.ts")) &&
      /DOTNET_ROOT="\{\{INSTALL_PATH\}\}\/\.dotnet"/.test(read("../src/db/games/terraria.ts")) &&
      /exec \.\/TShock\.Server/.test(read("../src/db/games/terraria.ts"))
  );
  check(
    "TShock install extracts the zip-wrapped tar (TShock 6.x layout)",
    /INNER_TAR=\$\(find tshock-extract/.test(read("../src/db/games/terraria.ts")) &&
      /tar xf "\$INNER_TAR" -C "\$\(dirname "\$INNER_TAR"\)"/.test(read("../src/db/games/terraria.ts")) &&
      /MOCK_INNER_TAR/.test(read("../scripts/verify-installers.ts")) &&
      /inner\.tar/.test(read("../scripts/verify-installers.ts"))
  );
  check(
    "OpenRA starts FUSE-free (extracted runtime preferred, AppImage fallback self-extracts)",
    /if \[ -x \.\/openra-extracted\/AppRun \]; then RUNNER=\.\/openra-extracted\/AppRun/.test(read("../src/db/games/openra.ts")) &&
      /APPIMAGE_EXTRACT_AND_RUN=1/.test(read("../src/db/games/openra.ts")) &&
      /--appimage-extract/.test(read("../src/db/games/openra.ts")) &&
      /mv squashfs-root openra-extracted/.test(read("../src/db/games/openra.ts"))
  );
  check(
    "the node's SteamCMD path reaches install and update scripts",
    /STEAMCMD_PATH="\{\{STEAMCMD_PATH\}\}"/.test(read("../src/db/games/steamcmd.ts")) &&
      /\$STEAMCMD_PATH\/steamcmd\.sh/.test(read("../src/db/games/steamcmd.ts")) &&
      /\$STEAMCMD_PATH\/linux32\/steamclient\.so/.test(read("../src/db/games/steamcmd.ts")) &&
      /STEAMCMD_PATH: server\.nodeSteamcmdPath/.test(read("../src/app/api/servers/\[id\]/install/route.ts")) &&
      /nodeSteamcmdPath: nodes\.steamcmdPath/.test(read("../src/app/api/servers/\[id\]/install/route.ts")) &&
      /steamcmdDir/.test(read("../src/lib/server-update-runner.ts")) &&
      /server\.steamcmdPath/.test(read("../src/app/api/servers/\[id\]/update/route.ts"))
  );

}




// ── Age verification (Australian law) + pre-update backup safety net ────
console.log("\nAge verification & pre-update backup");
{
  const fs = require("node:fs") as typeof import("node:fs");
  const read = (p: string) => fs.readFileSync(new URL(p, import.meta.url), "utf8");

  const ageLib = read("../src/lib/age-verification.ts");
  check(
    "the age floor is 16 and cites the Online Safety Amendment Act 2024",
    /AUSTRALIAN_MINIMUM_ACCOUNT_AGE = 16/.test(ageLib) &&
      /Online Safety Amendment \(Social Media Minimum Age\) Act 2024/.test(ageLib) &&
      /export function ageInYears/.test(ageLib) &&
      /reason: "under-age"/.test(ageLib)
  );

  const register = read("../src/app/api/auth/register/route.ts");
  check(
    "registration enforces the age gate and stores the verified date of birth",
    /policy\.ageVerificationEnabled/.test(register) &&
      /checkMinimumAge\(dateOfBirth, policy\.minimumAccountAge\)/.test(register) &&
      /ADD COLUMN IF NOT EXISTS date_of_birth DATE/.test(register) &&
      /ADD COLUMN IF NOT EXISTS age_verified_at TIMESTAMP/.test(register) &&
      /dateOfBirth: verifiedDob/.test(register) &&
      /ageVerifiedAt: verifiedDob \? new Date\(\) : null/.test(register) &&
      /status: check\.reason === "under-age" \? 403 : 400/.test(register)
  );

  const authPolicy = read("../src/lib/auth-policy.ts");
  check(
    "the auth policy never accepts a minimum age below the statutory floor",
    /minimumAccountAge: AUSTRALIAN_MINIMUM_ACCOUNT_AGE/.test(authPolicy) &&
      /n >= AUSTRALIAN_MINIMUM_ACCOUNT_AGE/.test(authPolicy)
  );

  const loginForm = read("../src/components/LoginForm.tsx");
  check(
    "the register form collects a date of birth and warns about the law",
    /dateOfBirth: ""/.test(loginForm) &&
      /type="date"/.test(loginForm) &&
      /Australian law/.test(loginForm) &&
      /at least 16/.test(loginForm)
  );

  const panelSettings = read("../src/lib/panel-settings.ts");
  check(
    "the minimum-age setting cannot be saved below 16 and both gates are panel settings",
    /minimum_account_age: \{ min: 16, max: 120/.test(panelSettings) &&
      /"update_auto_backup"/.test(panelSettings) &&
      /"age_verification_enabled"/.test(panelSettings) &&
      /"minimum_account_age"/.test(panelSettings)
  );

  const update = read("../src/app/api/servers/[id]/update/route.ts");
  check(
    "updates create a backup first and abort when the backup fails",
    /eq\(settings\.key, "update_auto_backup"\)/.test(update) &&
      /createServerBackup\(server\.installPath\)/.test(update) &&
      /backupName = backup\.name/.test(update) &&
      /Automatic pre-update backup failed/.test(update) &&
      /const autoBackup = \(autoBackupRow\?\.value \?\? "true"\) !== "false"/.test(update) &&
      /pre-update backup: \$\{backupName\}/.test(update)
  );
}


// ── Metrics history, public status links, scheduler notifications ───────
console.log("\nMetrics history, status share links & scheduler webhooks");
{
  const fs = require("node:fs") as typeof import("node:fs");
  const read = (p: string) => fs.readFileSync(new URL(p, import.meta.url), "utf8");

  const serverMetricsRoute = read("../src/app/api/servers/[id]/metrics/route.ts");
  check(
    "the server metrics history route is permission- and owner-checked, with a clamped range",
    /servers\.view\.metrics/.test(serverMetricsRoute) &&
      /auth\.role !== "admin" && server\.userId !== auth\.userId/.test(serverMetricsRoute) &&
      /clampRangeHours/.test(serverMetricsRoute) &&
      /limit\(MAX_RAW_ROWS\)/.test(serverMetricsRoute)
  );

  const nodeMetricsRoute = read("../src/app/api/nodes/[id]/metrics/route.ts");
  check(
    "the node metrics history route is gated on nodes.view.metrics",
    /nodes\.view\.metrics/.test(nodeMetricsRoute) && /clampRangeHours/.test(nodeMetricsRoute)
  );

  const publicStatusRoute = read("../src/app/api/public/status/[token]/route.ts");
  check(
    "the public status endpoint stays anonymous and answers 404 for bad tokens",
    !/getCurrentUser/.test(publicStatusRoute) &&
      /lookupPublicStatus\(token\)/.test(publicStatusRoute) &&
      /status: 404/.test(publicStatusRoute) &&
      /cache-control/.test(publicStatusRoute)
  );

  const statusLookup = read("../src/lib/status-lookup.ts");
  check(
    "the public lookup selects only whitelisted columns (no paths, configs or webhooks)",
    !/installPath/.test(statusLookup) &&
      !/discordWebhook/.test(statusLookup) &&
      !/config: /.test(statusLookup) &&
      !/variables/.test(statusLookup) &&
      /isValidStatusToken\(token\)/.test(statusLookup) &&
      /publicStatusPayload/.test(statusLookup)
  );

  const statusLinkRoute = read("../src/app/api/servers/[id]/status-link/route.ts");
  // Both handlers (create + revoke) must independently carry the auth and
  // permission checks and route through the shared ownership gate, so count
  // occurrences rather than testing presence once — a regression that
  // stripped one handler still fails.
  const countMatches = (s: string, re: RegExp) => (s.match(re) ?? []).length;
  check(
    "share-link create AND revoke both require auth, servers.edit and ownership",
    countMatches(statusLinkRoute, /getCurrentUser\(req\.headers\)/g) >= 2 &&
      countMatches(statusLinkRoute, /servers\.edit/g) >= 2 &&
      countMatches(statusLinkRoute, /await loadOwnedServer\(serverId, auth\)/g) >= 2 &&
      /auth\.role !== "admin" && server\.userId !== auth\.userId/.test(statusLinkRoute) &&
      /generateStatusToken\(\)/.test(statusLinkRoute) &&
      /statusToken: null/.test(statusLinkRoute)
  );

  const statusShare = read("../src/lib/status-share.ts");
  check(
    "share tokens are 256 random bits with a strict shape check",
    /randomBytes\(STATUS_TOKEN_BYTES\)/.test(statusShare) &&
      /STATUS_TOKEN_BYTES = 32/.test(statusShare) &&
      /STATUS_TOKEN_RE = \/\^\[a-f0-9\]\{64\}\$\//.test(statusShare)
  );

  const statusPage = read("../src/app/status/[token]/page.tsx");
  check(
    "the public status page is server-rendered, non-indexable and self-refreshing",
    /lookupPublicStatus/.test(statusPage) &&
      /robots: \{ index: false/.test(statusPage) &&
      /httpEquiv="refresh"/.test(statusPage)
  );

  const scheduler = read("../src/lib/scheduler.ts");
  check(
    "scheduled tasks report their outcome to Discord behind a panel setting",
    /scheduler_discord_notify/.test(scheduler) &&
      /resolveWebhookUrl\(server\.discordWebhook\)/.test(scheduler) &&
      /notifyScheduledTask\(url, \{/.test(scheduler) &&
      /await notifyTaskResult\(task, server, next, ok, detail, serverStatus\)/.test(scheduler)
  );

  const discord = read("../src/lib/discord.ts");
  check(
    "Discord has a scheduled_task event and a tested message builder",
    /scheduled_task: "⏰ Scheduled Task"/.test(discord) &&
      /export function buildScheduledTaskMessage/.test(discord) &&
      /queueDiscordWebhook\(webhookUrl, \{/.test(discord)
  );
}


// ── Hardening: backup retention, disk guard, crash-loop breaker ─────────
console.log("\nBackup retention, disk guard & crash-loop breaker");
{
  const fs = require("node:fs") as typeof import("node:fs");
  const read = (p: string) => fs.readFileSync(new URL(p, import.meta.url), "utf8");

  const backup = read("../src/lib/backup.ts");
  check(
    "createServerBackup checks free space before tar and prunes after it",
    /await ensureBackupSpace\(installPath\)/.test(backup) &&
      /await pruneServerBackups\(installPath\)/.test(backup) &&
      /BACKUP_NAME\.test\(n\)/.test(backup),
    "retention must only ever delete archives the panel created"
  );
  check(
    "the space guard needs size plus margin, refusing a torn mid-tar archive",
    /BACKUP_SPACE_MARGIN_BYTES = 256 \* 1024 \* 1024/.test(backup) &&
      /const required = neededBytes \+ marginBytes/.test(backup) &&
      /freeBytes < required/.test(backup)
  );

  const processRoute = read("../src/app/api/servers/[id]/process/route.ts");
  check(
    "auto-restart is gated by the crash-loop breaker and a manual start resets it",
    /isCrashLooping\(crashHistory\.get\(server\.id\) \?\? \[\], Date\.now\(\)\)/.test(processRoute) &&
      /windowedCrashes\(crashHistory\.get\(server\.id\) \?\? \[\], crashNow\)/.test(processRoute) &&
      /crashHistory\.delete\(server\.id\)/.test(processRoute) &&
      /CRASH_LOOP_MAX/.test(processRoute)
  );

  const lifecycle = read("../src/lib/server-lifecycle.ts");
  check(
    "the breaker trips at 3 crashes inside a 10-minute window",
    /CRASH_LOOP_MAX = 3/.test(lifecycle) &&
      /CRASH_LOOP_WINDOW_MS = 10 \* 60_000/.test(lifecycle) &&
      /export function isCrashLooping/.test(lifecycle)
  );

  const scheduler = read("../src/lib/scheduler.ts");
  check(
    "a scheduled update takes a pre-update backup too (same toggle as the button)",
    /eq\(settings\.key, "update_auto_backup"\)/.test(scheduler) &&
      /const preBackup = await createServerBackup\(installPath\)/.test(scheduler) &&
      /latest version installed\$\{backupNote\}/.test(scheduler)
  );

  const panelSettings = read("../src/lib/panel-settings.ts");
  check(
    "backup retention is a bounded panel setting (0 keeps everything)",
    /backup_retention_count: \{ min: 0, max: 100/.test(panelSettings) &&
      /backupRetentionCount: num\("backup_retention_count", 10\)/.test(panelSettings)
  );
}


// ── Resource-limit watchdog ─────────────────────────────────────────────
console.log("\nResource-limit watchdog");
{
  const fs = require("node:fs") as typeof import("node:fs");
  const read = (p: string) => fs.readFileSync(new URL(p, import.meta.url), "utf8");

  const metrics = read("../src/lib/process-metrics.ts");
  check(
    "limits compare with a strict > and unset/zero limits never breach",
    /sample\.ramMb > limits\.maxRamMb/.test(metrics) &&
      /limits\.maxRamMb !== null && limits\.maxRamMb > 0/.test(metrics) &&
      /limits\.maxCpuPercent !== null && limits\.maxCpuPercent > 0/.test(metrics) &&
      /LIMIT_STRIKES_ENFORCE = 4/.test(metrics)
  );

  const processRoute = read("../src/app/api/servers/[id]/process/route.ts");
  check(
    "the poll enforces limits: strike, warn at 1, kill+stop at 4, cleared on stop/start",
    /checkResourceLimits\(/.test(processRoute) &&
      /strikeDecision\(limitStrikes\.get\(server\.id\) \?\? 0/.test(processRoute) &&
      // The enforcement branch must actually be gated on the decision — a
      // disabled gate with the kill still present is the regression to catch.
      /if \(decision\.enforce\) \{\n {16}const \{ killProcess \}/.test(processRoute) &&
      /killProcess\(server\.pid\)/.test(processRoute) &&
      /status: "stopped", pid: null, lastStopped: new Date\(\)/.test(processRoute) &&
      /limitStrikes\.delete\(server\.id\)/.test(processRoute) &&
      /maxRamMb: gameServers\.maxRamMb/.test(processRoute) &&
      /maxCpuPercent: gameServers\.maxCpuPercent/.test(processRoute)
  );

  const discord = read("../src/lib/discord.ts");
  check(
    "Discord has a resource_limit event for watchdog warnings and stops",
    /resource_limit: "⛔ Resource Limit"/.test(discord) &&
      /resource_limit: 0xef4444/.test(discord)
  );
}


// ── Password reset flow ────────────────────────────────────────────────
console.log("\nPassword reset flow");
{
  const fs = require("node:fs") as typeof import("node:fs");
  const read = (p: string) => fs.readFileSync(new URL(p, import.meta.url), "utf8");

  const lib = read("../src/lib/password-reset.ts");
  check(
    "reset tokens are 256 bits, SHA-256 hashed, and expire in an hour",
    /RESET_TOKEN_BYTES = 32/.test(lib) &&
      /RESET_TTL_MS = 60 \* 60_000/.test(lib) &&
      /createHash\("sha256"\)/.test(lib) &&
      // The generated pair must run the token through the hash — storing the
      // raw value defeats the whole design.
      /tokenHash: hashResetToken\(token\)/.test(lib) &&
      /RESET_TOKEN_RE = \/\^\[a-f0-9\]\{64\}\$\//.test(lib)
  );

  const forgot = read("../src/app/api/auth/forgot-password/route.ts");
  check(
    "forgot-password is throttled and never reveals whether an account exists",
    /loginRetryAfter\(throttleKey\)/.test(forgot) &&
      /recordFailedLogin\(throttleKey\)/.test(forgot) &&
      /status !== "active"/.test(forgot) &&
      /const GENERIC_OK =/.test(forgot) &&
      /return NextResponse\.json\(GENERIC_OK\);/.test(forgot) &&
      !/Username not found|No account|does not exist/.test(forgot)
  );

  const reset = read("../src/app/api/auth/reset-password/route.ts");
  check(
    "reset-password matches the hash, demands unspent + unexpired, and spends before it changes",
    /hashResetToken\(token\)/.test(reset) &&
      /isNull\(passwordResets\.usedAt\)/.test(reset) &&
      /gt\(passwordResets\.expiresAt, new Date\(\)\)/.test(reset) &&
      /set\(\{ usedAt: new Date\(\) \}\)/.test(reset) &&
      /MIN_PASSWORD = 8/.test(reset) &&
      /MAX_PASSWORD = 200/.test(reset)
  );

  const schema = read("../src/db/schema.ts");
  const install = read("../src/app/api/install/route.ts");
  check(
    "password_resets stores only the token hash (raw token never persisted)",
    /tokenHash: text\("token_hash"\)\.notNull\(\)\.unique\(\)/.test(schema) &&
      /token_hash TEXT NOT NULL UNIQUE/.test(install) &&
      !/token TEXT/.test(install)
  );

  const loginForm = read("../src/components/LoginForm.tsx");
  check(
    "the login form wires forgot + reset, reading the one-time token from the URL",
    /api\/auth\/forgot-password/.test(loginForm) &&
      /api\/auth\/reset-password/.test(loginForm) &&
      /URLSearchParams\(window\.location\.search\)/.test(loginForm) &&
      /params\.get\("reset"\)/.test(loginForm) &&
      /history\.replaceState/.test(loginForm)
  );
}


// ── Host threshold alerts ──────────────────────────────────────────────
console.log("\nHost threshold alerts");
{
  const fs = require("node:fs") as typeof import("node:fs");
  const read = (p: string) => fs.readFileSync(new URL(p, import.meta.url), "utf8");

  const lib = read("../src/lib/threshold-alerts.ts");
  check(
    "thresholds use strict >, off-at-zero, null-never-breaches, one alert per episode",
    /reading\.cpuPercent > cfg\.cpuPercent/.test(lib) &&
      /cfg\.cpuPercent > 0 && reading\.cpuPercent !== null/.test(lib) &&
      /const fire = !previous\.alerted && strikes >= sustained/.test(lib) &&
      /DEFAULT_ALERT_SUSTAINED = 3/.test(lib)
  );

  const scheduler = read("../src/lib/scheduler.ts");
  check(
    "the scheduler tick runs the alert check, throttled to once a minute, once per episode",
    /await runThresholdAlerts\(\)/.test(scheduler) &&
      /ALERT_INTERVAL_MS = 60_000/.test(scheduler) &&
      /if \(now - lastAlertCheck < ALERT_INTERVAL_MS\) return/.test(scheduler) &&
      /alertDecision\(alertEpisode, breaches\.length > 0, cfg\.sustained\)/.test(scheduler) &&
      /if \(!decision\.fire\) return/.test(scheduler) &&
      /event: "threshold_alert"/.test(scheduler)
  );

  const discord = read("../src/lib/discord.ts");
  check(
    "Discord has a distinct amber threshold_alert event",
    /threshold_alert: "⚠️ Threshold Alert"/.test(discord) &&
      /threshold_alert: 0xf59e0b/.test(discord)
  );

  const panelSettings = read("../src/lib/panel-settings.ts");
  check(
    "alert thresholds are bounded panel settings, defaulting to 90 and off-at-zero",
    /alert_cpu_percent: \{ min: 0, max: 1000/.test(panelSettings) &&
      /alert_ram_percent: \{ min: 0, max: 100/.test(panelSettings) &&
      /alert_disk_percent: \{ min: 0, max: 100/.test(panelSettings) &&
      /alertCpuPercent: num\("alert_cpu_percent", 90\)/.test(panelSettings)
  );
}


// ── Source modding (Metamod / SourceMod) ───────────────────────────────
console.log("\nSource modding (Metamod / SourceMod)");
{
  const fs = require("node:fs") as typeof import("node:fs");
  const read = (p: string) => fs.readFileSync(new URL(p, import.meta.url), "utf8");

  const mods = read("../src/db/games/source-mods.ts");
  check(
    "the shared block pulls latest stable from AlliedModders and writes the loader vdf",
    /mms\.alliedmods\.net\/mmsdrop\/\$MMS_BRANCH\/mmsource-latest-linux/.test(mods) &&
      /sm\.alliedmods\.net\/smdrop\/\$SM_BRANCH\/sourcemod-latest-linux/.test(mods) &&
      /\[ -n "\$MMS_FILE" \] \|\| \{ echo/.test(mods) &&
      /addons\/metamod\.vdf/.test(mods) &&
      /addons\/metamod\/bin\/server/.test(mods)
  );

  const slugs = ["tf2", "counter-strike-source", "gmod", "l4d2"] as const;
  const dirs: Record<string, string> = { tf2: "tf", "counter-strike-source": "cstrike", gmod: "garrysmod", l4d2: "left4dead2" };
  check(
    "all four Source templates offer MOD_PLATFORM and target their own game dir",
    slugs.every((slug) => {
      const t = read(`../src/db/games/${slug === "counter-strike-source" ? "counter-strike-source" : slug}.ts`);
      return /sourceModVariables\(\)/.test(t) &&
        new RegExp(`sourceModInstallBlock\\("${dirs[slug]}"\\)`).test(t);
    })
  );

  const harness = read("../scripts/verify-installers.ts");
  check(
    "the installer harness executes mod installs (overrides + artifact assertions)",
    /MOD_PLATFORM_OVERRIDES/.test(harness) &&
      /MOD_ARTIFACT_CHECKS/.test(harness) &&
      /\*mms\.alliedmods\.net\*/.test(harness) &&
      /\*sm\.alliedmods\.net\*/.test(harness)
  );

  const upstreams = read("../scripts/check-upstreams.sh");
  check(
    "check-upstreams follows the full latest-filename-then-download flow",
    /mmsource-latest-linux/.test(upstreams) && /sourcemod-latest-linux/.test(upstreams)
  );
}


// ── Discord OAuth sign-in ──────────────────────────────────────────────
console.log("\nDiscord OAuth sign-in");
{
  const fs = require("node:fs") as typeof import("node:fs");
  const read = (p: string) => fs.readFileSync(new URL(p, import.meta.url), "utf8");

  const oauth = read("../src/lib/discord-oauth.ts");
  check(
    "the OAuth decision matrix refuses 2FA bypass and under-age account creation",
    /if \(s\.twoFactorEnabled\) return "2fa"/.test(oauth) &&
      /if \(s\.ageVerificationEnabled\) return "age_gate"/.test(oauth) &&
      /if \(!s\.registrationEnabled\) return "no_register"/.test(oauth)
  );

  const callback = read("../src/app/api/auth/discord/callback/route.ts");
  check(
    "the callback verifies state, demands a verified email, and routes through the decision matrix",
    /state !== cookieState/.test(callback) &&
      /me\.verified !== true/.test(callback) &&
      /oauthLoginDecision\(\{/.test(callback) &&
      /if \(decision === "age_gate"\) return outcome\(req, "age_gate"\)/.test(callback) &&
      /if \(decision === "2fa"\) return outcome\(req, "2fa"\)/.test(callback)
  );

  const authorize = read("../src/app/api/auth/discord/route.ts");
  check(
    "the authorize endpoint uses a random state bound to a short-lived cookie",
    /randomBytes\(16\)\.toString\("hex"\)/.test(authorize) &&
      /OAUTH_STATE_COOKIE, state, \{/.test(authorize) &&
      /scope.*identify email|scope", "identify email"/.test(authorize) &&
      /maxAge: 600/.test(authorize)
  );

  const settingsRoute = read("../src/app/api/settings/discord/route.ts");
  check(
    "the OAuth secret is write-only: masked in GET, validated on save",
    /oauthConfigured: isOauthConfigured\(s\)/.test(settingsRoute) &&
      !/oauthClientSecret: s\.oauthClientSecret/.test(settingsRoute) &&
      /OAuth client ID must be a numeric Discord application ID/.test(settingsRoute)
  );

  const siteSettings = read("../src/app/api/site-settings/route.ts");
  check(
    "the public site-settings allowlist cannot serve the OAuth secret",
    !/discord_oauth_client_secret/.test(siteSettings) &&
      /PUBLIC_KEYS/.test(siteSettings)
  );
}


// ── Emails, bulk actions & player join/leave alerts ───────────────────
console.log("\nEmails, bulk actions & player alerts");
{
  const fs = require("node:fs") as typeof import("node:fs");
  const read = (p: string) => fs.readFileSync(new URL(p, import.meta.url), "utf8");

  const register = read("../src/app/api/auth/register/route.ts");
  check(
    "registration sends a best-effort welcome email that cannot fail the signup",
    /sendWelcomeEmail\(mail, uname\)/.test(register) &&
      /void sendWelcomeEmail\(mail, uname\)\.catch\(\(\) => \{\}\)/.test(register)
  );

  const processRoute = read("../src/app/api/servers/[id]/process/route.ts");
  check(
    "crashes email the owner and roster diffs only run on successful probes",
    /ownerEmail: users\.email/.test(processRoute) &&
      /sendServerCrashEmail\(server\.ownerEmail/.test(processRoute) &&
      /if \(probe\.ok\) \{/.test(processRoute) &&
      /diffRosters\(lastRoster\.get\(server\.id\), current\)/.test(processRoute) &&
      /describeRosterChange\(server\.name, change\)/.test(processRoute) &&
      /server\.discordNotifyPlayers !== false/.test(processRoute) &&
      /lastRoster\.delete\(server\.id\)/.test(processRoute)
  );

  const roster = read("../src/lib/roster-diff.ts");
  check(
    "the first sighting is a silent baseline, not an announcement",
    /if \(previous === undefined\) return \{ joined: \[\], left: \[\] \}/.test(roster) &&
      /MAX_LISTED_NAMES = 10/.test(roster)
  );

  const panel = read("../src/components/panels/ServersPanel.tsx");
  check(
    "bulk actions cover restart and backup as well as start/stop/install",
    /bulkAction\("restart"\)/.test(panel) &&
      /bulkAction\("backup"\)/.test(panel) &&
      /action === "backup"/.test(panel)
  );

  const lifecycle = read("../src/lib/server-lifecycle.ts");
  const install = read("../src/app/api/install/route.ts");
  check(
    "the players-notification toggle is patchable, cloneable and created by default-on",
    /"discordNotifyPlayers"/.test(lifecycle) &&
      /discord_notify_players BOOLEAN DEFAULT TRUE/.test(install)
  );
}


// ── Public board, 2FA recovery codes, disk metrics ─────────────────────
console.log("\nPublic board, recovery codes & disk metrics");
{
  const fs = require("node:fs") as typeof import("node:fs");
  const read = (p: string) => fs.readFileSync(new URL(p, import.meta.url), "utf8");

  const lookup = read("../src/lib/status-lookup.ts");
  check(
    "the public board lists only opted-in servers, capped, with whitelisted payloads",
    /eq\(gameServers\.statusPublic, true\)/.test(lookup) &&
      /limit\(MAX_PUBLIC_LIST_SERVERS\)/.test(lookup) &&
      /MAX_PUBLIC_LIST_SERVERS = 24/.test(lookup) &&
      /publicStatusPayload\(\{/.test(lookup) &&
      !/installPath/.test(lookup)
  );

  const listRoute = read("../src/app/api/public/status/route.ts");
  check(
    "the public list endpoint stays anonymous and never errors loudly",
    !/getCurrentUser/.test(listRoute) &&
      /lookupPublicList\(\)/.test(listRoute) &&
      /cache-control": "no-store/.test(listRoute)
  );

  const recovery = read("../src/lib/recovery-codes.ts");
  check(
    "recovery codes are random, hash-only and single-use",
    /randomBytes\(10\)/.test(recovery) &&
      /createHash\("sha256"\)/.test(recovery) &&
      /remaining = storedHashes\.filter\(\(_, i\) => i !== idx\)/.test(recovery) &&
      /if \(seen\.has\(raw\)\) continue/.test(recovery)
  );

  const verify2fa = read("../src/app/api/auth/2fa/verify/route.ts");
  const login = read("../src/app/api/auth/login/route.ts");
  check(
    "enabling 2FA mints codes once; login consumes them single-use",
    /generateRecoveryCodes\(\)/.test(verify2fa) &&
      /twoFactorRecovery: JSON\.stringify\(hashes\)/.test(verify2fa) &&
      /recoveryCodes: codes/.test(verify2fa) &&
      /consumeRecoveryCode\(stored, twoFactorCode\)/.test(login) &&
      /twoFactorRecovery: JSON\.stringify\(result\.remaining\)/.test(login) &&
      /isLikelyRecoveryCode\(twoFactorCode\)/.test(login)
  );

  const metrics = read("../src/app/api/servers/[id]/metrics/route.ts");
  check(
    "the metrics route adds cached folder size and filesystem usage",
    /estimateDirBytes\(server\.installPath/.test(metrics) &&
      /DIR_SIZE_CACHE_MS = 5 \* 60_000/.test(metrics) &&
      /statfsAsync\(server\.installPath\)/.test(metrics)
  );
}


// ── Anonymous-endpoint throttle ────────────────────────────────────────
console.log("\nAnonymous endpoint throttle");
{
  const fs = require("node:fs") as typeof import("node:fs");
  const read = (p: string) => fs.readFileSync(new URL(p, import.meta.url), "utf8");

  const lib = read("../src/lib/public-throttle.ts");
  check(
    "the throttle is a sliding window that does not extend on blocked hits",
    /PUBLIC_THROTTLE_MAX = 30/.test(lib) &&
      /PUBLIC_THROTTLE_WINDOW_MS = 60_000/.test(lib) &&
      /if \(recent\.length >= max\) \{/.test(lib) &&
      /recent\.push\(now\)/.test(lib)
  );

  const list = read("../src/app/api/public/status/route.ts");
  const token = read("../src/app/api/public/status/[token]/route.ts");
  check(
    "both public JSON endpoints refuse with 429 before probing",
    /publicThrottleAllowed\(`public-status:\$\{clientIp\(req\)\}`\)/.test(list) &&
      /status: 429/.test(list) &&
      /publicThrottleAllowed\(`public-status:\$\{clientIp\(req\)\}`\)/.test(token) &&
      /status: 429/.test(token)
  );

  const page = read("../src/app/status/page.tsx");
  const pageToken = read("../src/app/status/[token]/page.tsx");
  check(
    "the public pages throttle BEFORE probing the fleet",
    /const servers = throttled \? \[\] : await lookupPublicList\(\)/.test(page) &&
      /const status = throttled \? null : await lookupPublicStatus\(token\)/.test(pageToken) &&
      /publicThrottleAllowed\(`public-status:\$\{ip\}`\)/.test(page)
  );
}


// ── Remote node agent ──────────────────────────────────────────────────
console.log("\nRemote node agent");
{
  const fs = require("node:fs") as typeof import("node:fs");
  const read = (p: string) => fs.readFileSync(new URL(p, import.meta.url), "utf8");

  const agent = read("../agent/gsm-agent.mjs");
  check(
    "the agent authenticates before routing and compares keys constant-time",
    /if \(req\.method !== "POST"\) return send\(res, 405/.test(agent) &&
      /if \(!apiKey \|\| typeof presented !== "string" \|\| !constantTimeMatch\(apiKey, presented\)\)/.test(agent) &&
      /timingSafeEqual\(bufA, bufB\)/.test(agent) &&
      /size > MAX_BODY_BYTES/.test(agent)
  );
  check(
    "the agent re-roots every installPath against its allowed root",
    /const full = resolve\(base, candidate\)/.test(agent) &&
      /if \(full !== base && !full\.startsWith\(base \+ sep\)\) return null/.test(agent) &&
      /if \(!dir\) return send\(res, 400, \{ error: "installPath outside the allowed root" \}\)/.test(agent)
  );

  const client = read("../src/lib/node-client.ts");
  check(
    "the RPC client sends the key header, times out, and maps failures",
    /"x-api-key": node\.apiKey/.test(client) &&
      /AbortSignal\.timeout\(timeoutMs\)/.test(client) &&
      /throw new NodeRpcError\(\s*\n?\s*aborted/.test(client) &&
      /if \(!node\.apiUrl \|\| !node\.apiKey\)/.test(client)
  );

  const processRoute = read("../src/app/api/servers/[id]/process/route.ts");
  check(
    "remote servers are driven through the agent, never spawned locally",
    /return handleRemoteAction\(req, server, action\)/.test(processRoute) &&
      /nodeApiUrl: nodes\.apiUrl/.test(processRoute) &&
      /Node agent has no agent URL\/key configured|no agent URL\/key configured/.test(processRoute)
  );

  const scheduler = read("../src/lib/scheduler.ts");
  check(
    "scheduled restarts run remotely via the agent; file tasks report instead of skipping silently",
    /remoteProcessStart\(node, remotePath\)/.test(scheduler) &&
      /needs the node agent's file APIs and is not supported remotely yet/.test(scheduler) &&
      /await notifyTaskResult\(task, server, next, ok, detail, serverStatus\);\n    return;/.test(scheduler)
  );

  const lifecycle = read("../src/lib/server-lifecycle.ts");
  check(
    "stale remote nodes flip offline; never-seen nodes do not",
    /NODE_STALE_MS = 3 \* 60_000/.test(lifecycle) &&
      /if \(lastHeartbeat === null\) return false/.test(lifecycle) &&
      /markStaleNodesOffline/.test(read("../src/lib/scheduler.ts"))
  );

  const testRoute = read("../src/app/api/nodes/[id]/test/route.ts");
  check(
    "the connection test is permission-gated and pings the agent",
    /nodes\.edit/.test(testRoute) && /pingNodeAgent\(/.test(testRoute)
  );
}


// ── Remote file ops & backups ──────────────────────────────────────────
console.log("\nRemote file ops & backups");
{
  const fs = require("node:fs") as typeof import("node:fs");
  const read = (p: string) => fs.readFileSync(new URL(p, import.meta.url), "utf8");

  const agent = read("../agent/gsm-agent.mjs");
  check(
    "agent fs ops re-root every path, cap reads, and refuse to delete the root",
    /const full = containedPath\(root, rel\);\n  if \(!full\) return \{ error: "Path outside the allowed root"/.test(agent) &&
      /if \(full === resolve\(root\)\) return \{ error: "Refusing to delete the server root"/.test(agent) &&
      /TEXT_READ_MAX_BYTES = 2 \* 1024 \* 1024/.test(agent) &&
      /BIN_READ_MAX_BYTES = 20 \* 1024 \* 1024/.test(agent)
  );
  check(
    "agent backups validate the archive name twice and prune with retention",
    /BACKUP_NAME_RE = \/\^backup-\[A-Za-z0-9\._-\]\+\\\.tar\\\.gz\$\//.test(agent) &&
      /if \(containedPath\(dir, name\) !== file\) return \{ error: "Invalid backup name"/.test(agent) &&
      /for \(const f of files\.slice\(keep\)\) await rm/.test(agent) &&
      /--exclude=gsm-backups/.test(agent)
  );

  const backupRoute = read("../src/app/api/servers/[id]/backup/route.ts");
  check(
    "the backup route routes list/create/restore through the agent for remote servers",
    /remoteBackupList\(\{ apiUrl: server\.nodeApiUrl, apiKey: server\.nodeApiKey \}/.test(backupRoute) &&
      /remoteBackupCreate\(node, server\.installPath\)/.test(backupRoute) &&
      /remoteBackupRestore\(node, server\.installPath, backupName\)/.test(backupRoute) &&
      /Stop the server before restoring/.test(backupRoute)
  );

  const filesRoute = read("../src/app/api/servers/[id]/files/route.ts");
  check(
    "the files route runs list/read/download/write/mkdir/delete/rename on the agent",
    /remoteFs\(remoteNode, op, \{ path: reqPath \}\)/.test(filesRoute) &&
      /op: "readbin"/.test(filesRoute) === false &&
      /"readbin"/.test(filesRoute) &&
      /await remoteFs\(remoteNode, "write", \{ path: reqPath, content: content \|\| "" \}\)/.test(filesRoute) &&
      /not supported on remote nodes yet/.test(filesRoute)
  );
}


// ── One-click agent deploy over SSH ────────────────────────────────────
console.log("\nAgent deploy over SSH");
{
  const fs = require("node:fs") as typeof import("node:fs");
  const read = (p: string) => fs.readFileSync(new URL(p, import.meta.url), "utf8");

  const deploy = read("../src/lib/node-deploy.ts");
  check(
    "deploy quoting resists injection and the key cannot break the heredoc",
    /return `'\$\{value\.replace\(\/\'\/g, `'\\\\\\''\)\}'`/.test(deploy) === false &&
      /value\.replace\(\/\'\/g/.test(deploy) &&
      /\/\^\[A-Za-z0-9_-\]\{8,128\}\$\//.test(deploy) &&
      /throw new Error\("Agent key must be 8-128/.test(deploy)
  );
  check(
    "password auth stays out of argv (sshpass -e + SSHPASS env)",
    /return \{ cmd: "sshpass", args: \["-e", "ssh", "-o", "BatchMode=no", \.\.\.opts\], env: \{ SSHPASS: auth\.password \} \}/.test(deploy) &&
      /env: \{ SSHPASS: auth\.password \}/.test(deploy)
  );

  const route = read("../src/app/api/nodes/[id]/deploy/route.ts");
  check(
    "the deploy route is permission-gated, preflighted, and verifies the agent afterwards",
    /nodes\.edit/.test(route) &&
      /deployPreflight\(node\)/.test(route) &&
      /if \(node\.isLocal\)/.test(route) &&
      /pingNodeAgent\(\{ apiUrl, apiKey \}\)/.test(route) &&
      /randomBytes\(24\)\.toString\("hex"\)/.test(route)
  );
}


// ── Embed snippets & server event history ──────────────────────────────
console.log("\nEmbed snippets & event history");
{
  const fs = require("node:fs") as typeof import("node:fs");
  const read = (p: string) => fs.readFileSync(new URL(p, import.meta.url), "utf8");

  const publicRoute = read("../src/app/api/public/status/route.ts");
  check(
    "the public JSON endpoint opens CORS for embed widgets (on every response)",
    (publicRoute.match(/access-control-allow-origin": "\*/g) ?? []).length >= 2
  );

  const share = read("../src/lib/status-share.ts");
  check(
    "embed snippets trim the origin and the widget escapes names",
    /origin\.replace\(\/\\\/\+\$\/, ""\)/.test(share) &&
      /replace\(\/\[<>&\]\/g, ""\)/.test(share) &&
      /export function buildEmbedIframe/.test(share) &&
      /export function buildEmbedWidget/.test(share)
  );

  const events = read("../src/lib/server-events.ts");
  check(
    "event history is recorded best-effort and pruned per server",
    /SERVER_EVENT_RETENTION_DAYS = 14/.test(events) &&
      /await db\.insert\(serverEvents\)\.values\(\{ serverId, kind, detail: detail \?\? null \}\)/.test(events) &&
      /and\(eq\(serverEvents\.serverId, serverId\), lt\(serverEvents\.createdAt, cutoff\)\)/.test(events) &&
      /catch \{\n    \/\* history is best-effort \*\/\n  \}/.test(events)
  );

  const processRoute = read("../src/app/api/servers/[id]/process/route.ts");
  check(
    "crashes, watchdog stops and auto-restarts all write the event history",
    /recordServerEvent\(server\.id, "crashed"\)/.test(processRoute) &&
      /recordServerEvent\(server\.id, "watchdog-stop", violations\.join\("; "\)\)/.test(processRoute) &&
      /recordServerEvent\(server\.id, "auto-restarted", `pid \$\{pid\}`\)/.test(processRoute) &&
      /recordServerEvent\(server\.id, "crashed", "remote node"\)/.test(processRoute)
  );

  const metricsRoute = read("../src/app/api/servers/[id]/metrics/route.ts");
  const install = read("../src/app/api/install/route.ts");
  check(
    "the Metrics view serves the history and fresh installs create the table",
    /recentServerEvents\(serverId, 8\)/.test(metricsRoute) &&
      /CREATE TABLE IF NOT EXISTS server_events/.test(install)
  );
}


// ── Server migration between nodes ─────────────────────────────────────
console.log("\nServer migration");
{
  const fs = require("node:fs") as typeof import("node:fs");
  const read = (p: string) => fs.readFileSync(new URL(p, import.meta.url), "utf8");

  const agent = read("../agent/gsm-agent.mjs");
  check(
    "agent migration endpoints validate paths and names before touching disk",
    /MAX_BODY_BYTES = 32 \* 1024 \* 1024/.test(agent) &&
      /if \(containedPath\(dir, name\) !== file\) return \{ error: "Invalid backup name", code: 400 \};\n  const st = await stat\(file\);/.test(agent) &&
      /MIGRATION_SLICE_MAX = 8 \* 1024 \* 1024/.test(agent) &&
      /importStaging\.delete\(installPath\)/.test(agent) &&
      /await rm\(staged, \{ force: true \}\)/.test(agent)
  );

  const mig = read("../src/lib/migration.ts");
  check(
    "migration computes safe destinations and only moves stopped servers",
    /if \(status === "running"\) return "Stop the server before migrating it\."/.test(mig) &&
      /if \(status === "installing"\)/.test(mig) &&
      /\$\{base\}\/\$\{slugify\(gameSlug \|\| "game"\)\}\/\$\{slugify\(serverName\)\}/.test(mig) &&
      /MIGRATION_CHUNK_BYTES = 8 \* 1024 \* 1024/.test(mig) &&
      /--exclude=gsm-backups/.test(mig)
  );

  const route = read("../src/app/api/servers/[id]/migrate/route.ts");
  check(
    "the migrate route is permission-gated, blocks running servers, and reverts on failure",
    /servers\.edit/.test(route) &&
      /migrationBlockReason\(server\.status\)/.test(route) &&
      /server\.nodeId === destNodeId/.test(route) &&
      /status: "installing"/.test(route) &&
      /\.set\(\{ status: "stopped", updatedAt: new Date\(\) \}\)/.test(route) &&
      /if \(archivePath\) await cleanupLocalArchive\(archivePath\)/.test(route)
  );
}

// ── PRESETS: one-click setups must not smuggle env vars ─────────────────────
console.log("\nPRESETS server preset validation and apply-time filtering");
{
  const read = (p: string) =>
    require("node:fs").readFileSync(new URL(p, import.meta.url), "utf8") as string;

  // Runtime: the apply-time merge is the only place preset data reaches a
  // server's environment, and it must whitelist declared template variables.
  const merged = mergePresetVariables(
    { MAX_PLAYERS: "16" },
    { MAX_PLAYERS: "24", LD_PRELOAD: "/tmp/evil.so" },
    new Set(["MAX_PLAYERS"])
  );
  check(
    "preset apply drops undeclared keys (no env smuggling)",
    merged.MAX_PLAYERS === "24" && !("LD_PRELOAD" in merged)
  );

  check(
    "preset validation rejects oversized and malformed payloads",
    validatePresetInput({ name: "", gameId: 1 }).ok === false &&
      validatePresetInput({ name: "a".repeat(200), gameId: 1 }).ok === false &&
      validatePresetInput({ name: "x", gameId: 0 }).ok === false &&
      validatePresetInput({ name: "x", gameId: 1, variables: { bad_key: "1" } }).ok === false
  );

  const route = read("../src/app/api/presets/route.ts");
  check(
    "preset list/create is authenticated and create needs servers.create",
    /getCurrentUser\(req\.headers\)/.test(route) &&
      /if \(!\(await hasPermission\(auth\.userId, "servers\.create"\)\)\)/.test(route) &&
      /validatePresetInput\(body\)/.test(route) &&
      /limit\(200\)/.test(route)
  );

  const del = read("../src/app/api/presets/[id]/route.ts");
  check(
    "preset delete requires creator or admin",
    /getCurrentUser\(req\.headers\)/.test(del) &&
      /auth\.role !== "admin" && preset\.userId !== auth\.userId/.test(del) &&
      /Number\.isInteger\(presetId\)/.test(del)
  );
}

// ── NODE HEALTH: smart picker must not leak or mislead ──────────────────────
console.log("\nNODEH smart node picker scoring and metrics permission");
{
  const read = (p: string) =>
    require("node:fs").readFileSync(new URL(p, import.meta.url), "utf8") as string;

  const NOW = 1_700_000_000_000;
  const fresh = { cpuPercent: 10, ramUsedMb: 2048, ramTotalMb: 16384, diskUsedMb: 100_000, diskTotalMb: 500_000, recordedAt: NOW - 60_000 };
  const mk = (over: Partial<NodeCandidate> = {}): NodeCandidate => ({ id: 1, online: true, load: fresh, serverCount: 1, ...over });

  check(
    "offline nodes are never eligible and full disks disqualify",
    scoreNode(mk({ online: false }), NOW) === Infinity &&
      scoreNode(mk({ load: { ...fresh, diskTotalMb: 10_000, diskUsedMb: 9_999 } }), NOW) === Infinity
  );

  check(
    "recommendation skips offline/disqualified nodes",
    recommendNodeId([mk({ id: 1, online: false }), mk({ id: 2 })], NOW) === 2
  );

  const route = read("../src/app/api/nodes/route.ts");
  check(
    "node list embeds heartbeat metrics only for nodes.view.metrics holders",
    /hasPermission\(auth\.userId, "nodes\.view\.metrics"\)/.test(route) &&
      /if \(canSeeMetrics\) try/.test(route) &&
      /metrics: latestMetrics\[node\.id\] \?\? null/.test(route)
  );
}

// ── NOTES: per-server operator notes ────────────────────────────────────────
console.log("\nNOTES server notes validation and allowlist");
{
  const read = (p: string) =>
    require("node:fs").readFileSync(new URL(p, import.meta.url), "utf8") as string;

  check(
    "notes are trimmed, capped, and whitespace clears them",
    normalizeServerNotes(null).value === null &&
      normalizeServerNotes("   ").value === null &&
      normalizeServerNotes("  hi  ").value === "hi" &&
      normalizeServerNotes("a".repeat(2000)).ok === true &&
      normalizeServerNotes("a".repeat(2001)).ok === false &&
      normalizeServerNotes(42).ok === false
  );

  const patchFields = SERVER_PATCH_FIELDS as readonly string[];
  check(
    "notes and tags are whitelisted but identity/path/token fields stay locked",
    patchFields.includes("notes") &&
      patchFields.includes("tags") &&
      !patchFields.includes("installPath") &&
      !patchFields.includes("userId") &&
      !patchFields.includes("nodeId") &&
      !patchFields.includes("statusToken")
  );

  const patchRoute = read("../src/app/api/servers/[id]/route.ts");
  check(
    "PATCH validates notes through the normaliser under servers.edit",
    /hasPermission\(auth\.userId, "servers\.edit"\)/.test(patchRoute) &&
      /normalizeServerNotes\(updates\.notes\)/.test(patchRoute) &&
      /ADD COLUMN IF NOT EXISTS notes TEXT/.test(patchRoute)
  );

  const install = read("../src/app/api/install/route.ts");
  check(
    "fresh installs create the notes column",
    /notes TEXT,/.test(install)
  );
}

// ── TAGS: server grouping labels ────────────────────────────────────────────
console.log("\nTAGS server tag validation and plumbing");
{
  const read = (p: string) =>
    require("node:fs").readFileSync(new URL(p, import.meta.url), "utf8") as string;

  check(
    "tags are normalised safely and hostile input is rejected",
    normalizeServerTags(["  EU ", "eu"]).value?.join(",") === "eu" &&
      normalizeServerTags("../etc").ok === false &&
      normalizeServerTags(["a b"]).ok === false &&
      normalizeServerTags(Array.from({ length: 9 }, (_, i) => `t${i}`)).ok === false &&
      normalizeServerTags("tf2").ok === false
  );

  const patchRoute = read("../src/app/api/servers/[id]/route.ts");
  check(
    "PATCH validates tags through the normaliser under servers.edit",
    /hasPermission\(auth\.userId, "servers\.edit"\)/.test(patchRoute) &&
      /normalizeServerTags\(updates\.tags\)/.test(patchRoute) &&
      /ADD COLUMN IF NOT EXISTS tags JSONB/.test(patchRoute)
  );

  const list = read("../src/app/api/servers/route.ts");
  const install = read("../src/app/api/install/route.ts");
  check(
    "the server list serves tags and fresh installs create the column",
    /tags: gameServers\.tags/.test(list) &&
      /ADD COLUMN IF NOT EXISTS tags JSONB/.test(list) &&
      /tags JSONB,/.test(install)
  );
}

// ── FEED: fleet-wide incident feed ──────────────────────────────────────────
console.log("\nFEED fleet incident feed scoping and limits");
{
  const read = (p: string) =>
    require("node:fs").readFileSync(new URL(p, import.meta.url), "utf8") as string;

  check(
    "the hours window is clamped to 1..168 with a safe default",
    clampFeedHours(null) === 24 &&
      clampFeedHours("0") === 1 &&
      clampFeedHours("99999") === FEED_MAX_HOURS &&
      clampFeedHours("junk") === 24
  );

  const route = read("../src/app/api/servers/events/route.ts");
  check(
    "the feed is permission-gated and scoped to the caller's own servers",
    /hasPermission\(auth\.userId, "servers\.view"\)/.test(route) &&
      /auth\.role !== "admin" \? eq\(gameServers\.userId, auth\.userId\) : undefined/.test(route)
  );

  check(
    "the feed query is clamped and capped at 200 rows",
    /clampFeedHours\(req\.nextUrl\.searchParams\.get\("hours"\)\)/.test(route) &&
      /\.limit\(FEED_MAX_EVENTS\)/.test(route)
  );
}

// ── BATCH: batch process operations ─────────────────────────────────────────
console.log("\nBATCH batch start/stop/restart validation and scoping");
{
  const read = (p: string) =>
    require("node:fs").readFileSync(new URL(p, import.meta.url), "utf8") as string;

  check(
    "batch input is capped, deduped, and rejects hostile ids",
    validateBatchRequest({ action: "restart", serverIds: [1, 1, 2] }).value?.serverIds.join(",") === "1,2" &&
      validateBatchRequest({ action: "delete", serverIds: [1] }).ok === false &&
      validateBatchRequest({ action: "start", serverIds: [0] }).ok === false &&
      validateBatchRequest({ action: "start", serverIds: Array.from({ length: BATCH_MAX_SIZE + 1 }, (_, i) => i + 1) }).ok === false
  );

  check(
    "non-admin batches never dispatch another user's server",
    (() => {
      const rows = [
        { id: 1, name: "mine", userId: 10 },
        { id: 2, name: "theirs", userId: 99 },
      ];
      const { dispatchable, skippedIds } = partitionBatch(rows, [1, 2], false, 10);
      return dispatchable.map((r) => r.id).join(",") === "1" && skippedIds.join(",") === "2";
    })()
  );

  const route = read("../src/app/api/servers/batch/route.ts");
  check(
    "the batch route delegates to the real process handler with permission pre-check and ownership partition",
    /from "\.\.\/\[id\]\/process\/route"/.test(route) &&
      /if \(!canAct\)/.test(route) &&
      /hasPermission\(auth\.userId, "servers\.start_stop"\)/.test(route) &&
      /partitionBatch\(\s*rows,\s*serverIds,\s*auth\.role === "admin",\s*auth\.userId\s*\)/.test(route) &&
      /validateBatchRequest\(body\)/.test(route)
  );

  check(
    "batches leave an audit trail",
    /action: "server\.batch"/.test(route) &&
      /insert\(auditLog\)/.test(route)
  );
}

// ── PRESET IMPORT: shared setups ────────────────────────────────────────────
console.log("\nPIMPORT preset import validation and scoping");
{
  const read = (p: string) =>
    require("node:fs").readFileSync(new URL(p, import.meta.url), "utf8") as string;

  check(
    "imports are capped, per-item validated, and one bad item fails the batch",
    validatePresetImport({ presets: Array.from({ length: 21 }, (_, i) => ({ name: `p${i}`, gameId: 1 })) }).ok === false &&
      validatePresetImport({ presets: [{ name: "ok", gameId: 1 }, { name: "", gameId: 1 }] }).ok === false &&
      validatePresetImport({ presets: [{ name: "x", gameId: 1, variables: { bad_key: "1" } }] }).ok === false &&
      // LD_PRELOAD-shaped keys pass validation but are dropped at apply time.
      mergePresetVariables({}, { LD_PRELOAD: "evil" }, new Set(["MAX_PLAYERS"])).LD_PRELOAD === undefined
  );

  const route = read("../src/app/api/presets/import/route.ts");
  check(
    "the import route needs servers.create, validates payloads, and drops unknown games",
    /if \(!\(await hasPermission\(auth\.userId, "servers\.create"\)\)\)/.test(route) &&
      /validatePresetImport\(body\)/.test(route) &&
      /knownGames\.has\(p\.gameId\)/.test(route) &&
      /userId: auth\.userId/.test(route)
  );
}

// ── DAILY RESTART: one-click scheduled restarts ─────────────────────────────
console.log("\nDAILY one-click daily restart scoping and shape");
{
  const read = (p: string) =>
    require("node:fs").readFileSync(new URL(p, import.meta.url), "utf8") as string;

  check(
    "the toggle only claims strict daily crons, never custom schedules",
    parseDailyRestartCron(buildDailyRestartCron(4, 0))?.hour === 4 &&
      parseDailyRestartCron("0 4 * * 1") === null &&
      parseDailyRestartCron("*/30 * * * *") === null &&
      buildDailyRestartCron(24, 0) === null
  );

  const route = read("../src/app/api/servers/[id]/daily-restart/route.ts");
  const ownershipHits = (route.match(/auth\.role !== "admin" && server\.userId !== auth\.userId/g) ?? []).length;
  check(
    "GET and POST both enforce ownership and disable by flag, never delete",
    ownershipHits >= 2 &&
      /hasPermission\(auth\.userId, "scheduler\.create"\)/.test(route) &&
      /\.set\(\{ enabled: false \}\)/.test(route) &&
      !/delete\(scheduledTasks\)/.test(route)
  );
}

// ── MAINTENANCE: node maintenance mode ──────────────────────────────────────
console.log("\nMAINT node maintenance mode enforcement");
{
  const read = (p: string) =>
    require("node:fs").readFileSync(new URL(p, import.meta.url), "utf8") as string;
  const nowMs = Date.now();

  check(
    "maintenance nodes are disqualified and never recommended",
    scoreNode({ id: 1, online: true, load: null, serverCount: 0, maintenance: true }, nowMs) === Infinity &&
      recommendNodeId(
        [
          { id: 1, online: true, load: null, serverCount: 0, maintenance: true },
          { id: 2, online: true, load: null, serverCount: 5 },
        ],
        nowMs
      ) === 2
  );

  const create = read("../src/app/api/servers/route.ts");
  check(
    "server creation is blocked on maintenance nodes",
    /maintenanceMode: nodes\.maintenanceMode/.test(create) &&
      /if \(node\.maintenanceMode\)/.test(create) &&
      /maintenance mode/.test(create)
  );

  const lifecycle = read("../src/lib/server-lifecycle.ts");
  check(
    "maintenanceMode is publicly readable and admin-writable via the node PATCH allowlists",
    /"maintenanceMode"/.test(lifecycle) &&
      (lifecycle.match(/"maintenanceMode"/g) ?? []).length >= 2
  );
}

// ── ACCESS GATE: CD-key style panel protection ──────────────────────────────
console.log("\nGATE panel access key enforcement");
{
  const read = (p: string) =>
    require("node:fs").readFileSync(new URL(p, import.meta.url), "utf8") as string;

  check(
    "keys are normalised to the unambiguous alphabet and hashed",
    normalizeAccessKey("gsm-abcd-2345-xyz9-hjkm") === "ABCD2345XYZ9HJKM" &&
      isValidAccessKeyFormat(normalizeAccessKey("gsm-abcd-2345-xyz9-hjkm")) === true &&
      isValidAccessKeyFormat("ABCD2345XYZ9HJKM") === true &&
      isValidAccessKeyFormat("IIII00001111LLLL") === false &&
      hashAccessKey("ABCD").length === 64
  );

  const gateLib = read("../src/lib/access-gate.ts");
  check(
    "verification fails closed for revoked or unknown keys",
    /isNull\(accessKeys\.revokedAt\)/.test(gateLib) &&
      /return false;/.test(gateLib) &&
      /PANEL_MASTER_KEY_ENV/.test(gateLib)
  );

  // Every entry point must refuse without a valid key when the gate is on.
  const entryPoints: Array<[string, string]> = [
    ["login", "../src/app/api/auth/login/route.ts"],
    ["register", "../src/app/api/auth/register/route.ts"],
    ["reset-password", "../src/app/api/auth/reset-password/route.ts"],
    ["discord-oauth", "../src/app/api/auth/discord/route.ts"],
  ];
  for (const [name, path] of entryPoints) {
    const src = read(path);
    check(
      `the ${name} entry point enforces the access gate`,
      /accessGatePassed\(/.test(src) &&
        /ACCESS_GATE_ERROR|gate_required/.test(src) &&
        /status: 403|gate_required/.test(src)
    );
  }

  const keysRoute = read("../src/app/api/access-keys/route.ts");
  const delRoute = read("../src/app/api/access-keys/[id]/route.ts");
  const gateRoute = read("../src/app/api/access-keys/gate/route.ts");
  check(
    "key management is admin-only and stores hashes, never plaintext",
    /auth\.role !== "admin"/.test(keysRoute) &&
      /auth\.role !== "admin"/.test(delRoute) &&
      /auth\.role !== "admin"/.test(gateRoute) &&
      /keyHash: hash/.test(keysRoute) &&
      !/"key"/.test(keysRoute.split("generateAccessKey")[0])
  );

  check(
    "enabling the gate with zero keys bootstraps one instead of locking out",
    /bootstrapKey/.test(gateRoute) &&
      /if \(!active\)/.test(gateRoute) &&
      /generateAccessKey\(\)/.test(gateRoute) &&
      /isNull\(accessKeys\.revokedAt\)/.test(gateRoute) &&
      /ACCESS_GATE_ENV/.test(gateRoute)
  );
}

// ── CONNECT: game-specific join strings ─────────────────────────────────────
console.log("\nCONNECT join-string shapes and the public-payload privacy wall");
{
  const read = (p: string) =>
    require("node:fs").readFileSync(new URL(p, import.meta.url), "utf8") as string;

  check(
    "Source games get console commands and Minecraft elides default ports",
    connectInfoFor("tf2", "1.2.3.4", null, 27015).connect === "connect 1.2.3.4:27015" &&
      connectInfoFor("minecraft-paper", "mc.example.com", null, 25565).connect === "mc.example.com" &&
      pickHost("0.0.0.0", "203.0.113.9") === "203.0.113.9" &&
      pickHost(null, "2001:db8::7") === "[2001:db8::7]"
  );

  const share = read("../src/lib/status-share.ts");
  const page = read("../src/app/status/[token]/page.tsx");
  check(
    "the anonymous status surface still exposes no addresses",
    !/ipv4/.test(share.split("publicStatusPayload")[1] ?? "") &&
      !/connectInfoFor/.test(page) &&
      /no ids, no addresses/.test(share)
  );
}

// ── DAILY BACKUP: one-click scheduled backups ───────────────────────────────
console.log("\nDBACKUP one-click daily backup scoping and shape");
{
  const read = (p: string) =>
    require("node:fs").readFileSync(new URL(p, import.meta.url), "utf8") as string;

  const route = read("../src/app/api/servers/[id]/daily-backup/route.ts");
  const ownershipHits = (route.match(/auth\.role !== "admin" && server\.userId !== auth\.userId/g) ?? []).length;
  check(
    "GET and POST both enforce ownership, schedule backup tasks, and disable by flag",
    ownershipHits >= 2 &&
      /hasPermission\(auth\.userId, "scheduler\.create"\)/.test(route) &&
      /taskType: "backup"/.test(route) &&
      /\.set\(\{ enabled: false \}\)/.test(route) &&
      !/delete\(scheduledTasks\)/.test(route)
  );

  const scheduler = read("../src/lib/scheduler.ts");
  check(
    "the scheduler actually runs backup tasks through the backup engine",
    /case "backup":/.test(scheduler) &&
      /createServerBackup\(installPath\)/.test(scheduler)
  );
}

// ── UPTIME: fleet stability tracking ────────────────────────────────────────
console.log("\nUPTIME stability sampling math and scoping");
{
  const read = (p: string) =>
    require("node:fs").readFileSync(new URL(p, import.meta.url), "utf8") as string;

  const now = Date.now();
  const rows = [
    { online: true, checkedAt: now - 1_000 },
    { online: true, checkedAt: now - 2_000 },
    { online: false, checkedAt: now - 3_000 },
    { online: false, checkedAt: now - 400 * 24 * 3_600_000 }, // outside retention
  ];
  const sum = summarizeUptime(rows, 168 * 3_600_000, now);
  check(
    "stability math windows samples and clamps the hours param",
    sum.checks === 3 && sum.onlineChecks === 2 && sum.percent === 66.67 &&
      clampUptimeHours("99999") === 336 &&
      uptimeGrade(sum.percent) === "poor" &&
      uptimeGrade(99.9) === "excellent"
  );

  const one = read("../src/app/api/servers/[id]/uptime/route.ts");
  const fleet = read("../src/app/api/servers/uptime/route.ts");
  check(
    "uptime endpoints are ownership-scoped and row-capped",
    /auth\.role !== "admin" && server\.userId !== auth\.userId/.test(one) &&
      /\.limit\(10_000\)/.test(one) &&
      /auth\.role === "admin" \|\| s\.userId === auth\.userId/.test(fleet) &&
      /MAX_FLEET_ROWS/.test(fleet) &&
      /MAX_SERVERS_REPORTED/.test(fleet)
  );

  const tracker = read("../src/lib/uptime-tracker.ts");
  check(
    "the sampler only touches running local servers and prunes retention",
    /if \(server\.status !== "running"\) continue;/.test(tracker) &&
      /if \(server\.nodeIsLocal === false\) continue;/.test(tracker) &&
      /uptimeCutoffMs\(now\)/.test(tracker)
  );
}

// ── IDLE: zero-player detection ─────────────────────────────────────────────
console.log("\nIDLE zero-player detection honesty and scoping");
{
  const read = (p: string) =>
    require("node:fs").readFileSync(new URL(p, import.meta.url), "utf8") as string;

  const now = new Date();
  const earlier = new Date(Date.now() - 2 * 3_600_000);
  check(
    "unreachable probes never count as empty and first sighting wins",
    nextIdleStamp(false, undefined, earlier, now) === undefined &&
      nextIdleStamp(true, 3, earlier, now) === null &&
      nextIdleStamp(true, 0, null, now) === now &&
      nextIdleStamp(true, 0, earlier, now) === earlier &&
      isServerIdle(Date.now() - 7 * 3_600_000, Date.now(), 6 * 3_600_000) === true &&
      idleDurationMs(null, Date.now()) === null
  );

  const route = read("../src/app/api/servers/idle/route.ts");
  check(
    "the idle list is ownership-scoped and threshold-clamped",
    /auth\.role === "admin" \|\| r\.userId === auth\.userId/.test(route) &&
      /hoursParam >= 1 && hoursParam <= 72/.test(route) &&
      /\.slice\(0, 100\)/.test(route)
  );

  const detector = read("../src/lib/idle-detection.ts");
  check(
    "the detector caps probes per tick and skips remote nodes",
    /probeable\.slice\(0, IDLE_MAX_PROBES_PER_TICK\)/.test(detector) &&
      /if \(s\.nodeIsLocal === false\) return false;/.test(detector) &&
      /attempts: 1/.test(detector)
  );
}

// ── BATCH UPDATE: fleet Steam updates ───────────────────────────────────────
console.log("\nBUPD batch update validation and delegation");
{
  const read = (p: string) =>
    require("node:fs").readFileSync(new URL(p, import.meta.url), "utf8") as string;

  check(
    "batch update ids are validated with a tighter cap",
    validateBatchServerIds({ serverIds: [1, 2, 3] }, 10).value?.join(",") === "1,2,3" &&
      validateBatchServerIds({ serverIds: Array.from({ length: 11 }, (_, i) => i + 1) }, 10).ok === false &&
      validateBatchServerIds({ serverIds: [0] }, 10).ok === false
  );

  const route = read("../src/app/api/servers/batch-update/route.ts");
  check(
    "batch update delegates to the real update handler and never touches running servers",
    /from "\.\.\/\[id\]\/update\/route"/.test(route) &&
      /if \(server\.status !== "stopped"\)/.test(route) &&
      /hasPermission\(auth\.userId, "servers\.install"\)/.test(route) &&
      /partitionBatch\(/.test(route) &&
      /action: "server\.batch-update"/.test(route)
  );
}

// ── WEBHOOK: outbound event delivery ────────────────────────────────────────
console.log("\nHOOK outbound webhook SSRF guard and delivery wiring");
{
  const read = (p: string) =>
    require("node:fs").readFileSync(new URL(p, import.meta.url), "utf8") as string;

  check(
    "webhook URLs cannot target local, private or metadata endpoints",
    validateWebhookUrl("https://hooks.example.com/x").ok === true &&
      validateWebhookUrl("http://localhost/x").ok === false &&
      validateWebhookUrl("http://169.254.169.254/latest/meta-data").ok === false &&
      validateWebhookUrl("http://10.0.0.5/x").ok === false &&
      validateWebhookUrl("https://user:pass@example.com/x").ok === false
  );

  const body = JSON.stringify({ a: 1 });
  check(
    "signatures verify and tamper-detect",
    verifyWebhookSignature(body, "secretsecret", signWebhookPayload(body, "secretsecret")) === true &&
      verifyWebhookSignature(body, "secretsecret", "0".repeat(64)) === false
  );

  const audit = read("../src/app/api/audit-log/route.ts");
  const hookRoute = read("../src/app/api/settings/webhook/route.ts");
  check(
    "the audit funnel fires webhooks and the settings route is admin-only with masked secrets",
    /fireWebhookEvent\(/.test(audit) &&
      /import\("@\/lib\/webhook-dispatch"\)/.test(audit) &&
      /auth\.role !== "admin"/.test(hookRoute) &&
      (hookRoute.match(/maskWebhookSecret\(/g) ?? []).length >= 2 &&
      /validateWebhookUrl/.test(hookRoute) &&
      !/secret/.test("") &&
      !/\bvalue: secret\b/.test(hookRoute)
  );
}

// ── API DOCS: session-gated reference ───────────────────────────────────────
console.log("\nDOCS API reference page is session-gated");
{
  const read = (p: string) =>
    require("node:fs").readFileSync(new URL(p, import.meta.url), "utf8") as string;

  const page = read("../src/app/api-docs/page.tsx");
  check(
    "the reference page authenticates and refuses anonymous visitors",
    /getCurrentUser\(hdrs\)/.test(page) &&
      /if \(!auth\)/.test(page) &&
      /Sign in required/.test(page)
  );
}

// ── DISASTER RECOVERY: export/import ────────────────────────────────────────
console.log("\nDR conservative disaster-recovery import");
{
  const read = (p: string) =>
    require("node:fs").readFileSync(new URL(p, import.meta.url), "utf8") as string;

  check(
    "imports drop webhook/gate settings and never accept command tasks",
    IMPORTABLE_SETTING_KEYS.has("outbound_webhook_url") === false &&
      IMPORTABLE_SETTING_KEYS.has("accessGateEnabled") === false &&
      IMPORTABLE_TASK_TYPES.has("command") === false &&
      validatePanelImport({
        kind: "panel-export",
        scheduledTasks: [{ serverName: "x", taskType: "command", cronExpression: "* * * * *" }],
      }).value?.tasks.length === 0
  );

  const exp = read("../src/app/api/maintenance/export/route.ts");
  const imp = read("../src/app/api/maintenance/import/route.ts");
  check(
    "export/import are admin-only and the export omits credentials",
    /auth\.role !== "admin"/.test(exp) &&
      /auth\.role !== "admin"/.test(imp) &&
      !/sshPassword/.test(exp) &&
      !/sshKeyPath/.test(exp) &&
      !/apiKey/.test(exp.split("nodes")?.[0] ?? "") &&
      /validatePanelImport\(body\)/.test(imp)
  );
}

// ── IDLE AUTO-STOP: policy enforcement ──────────────────────────────────────
console.log("\nIDLESTOP auto-stop decision and enforcement rails");
{
  const read = (p: string) =>
    require("node:fs").readFileSync(new URL(p, import.meta.url), "utf8") as string;

  check(
    "auto-stop requires policy + running + idle-over-threshold, never remote",
    shouldIdleStop({ policyEnabled: true, serverStatus: "running", nodeIsLocal: true, idleForMs: 7 * 3_600_000, thresholdMs: 6 * 3_600_000 }) === true &&
      shouldIdleStop({ policyEnabled: false, serverStatus: "running", nodeIsLocal: true, idleForMs: 7 * 3_600_000, thresholdMs: 6 * 3_600_000 }) === false &&
      shouldIdleStop({ policyEnabled: true, serverStatus: "running", nodeIsLocal: false, idleForMs: 7 * 3_600_000, thresholdMs: 6 * 3_600_000 }) === false &&
      shouldIdleStop({ policyEnabled: true, serverStatus: "stopped", nodeIsLocal: true, idleForMs: 7 * 3_600_000, thresholdMs: 6 * 3_600_000 }) === false
  );

  const detector = read("../src/lib/idle-detection.ts");
  check(
    "the enforcer is capped, records events, and clears the clock after stopping",
    /IDLE_MAX_STOPS_PER_TICK/.test(detector) &&
      /nodeIsLocal: c\.nodeIsLocal/.test(detector) &&
      /recordServerEvent\(c\.serverId, "idle-stopped"/.test(detector) &&
      /zeroPlayersSince: null/.test(detector) &&
      /if \(!policy\.enabled\) return;/.test(detector)
  );

  const policyRoute = read("../src/app/api/settings/idle-policy/route.ts");
  check(
    "the policy route is admin-only and bounds the threshold",
    (policyRoute.match(/auth\.role !== "admin"/g) ?? []).length >= 1 &&
      /hours < IDLE_POLICY_MIN_HOURS \|\| hours > IDLE_POLICY_MAX_HOURS/.test(policyRoute)
  );
}

// ── KEY HYGIENE: expiry enforcement and staleness ───────────────────────────
console.log("\nKEYS API key expiry enforcement and staleness math");
{
  const read = (p: string) =>
    require("node:fs").readFileSync(new URL(p, import.meta.url), "utf8") as string;

  const auth = read("../src/lib/api-key-auth.ts");
  check(
    "expired API keys are still rejected at authentication time",
    /candidate\.expiresAt && candidate\.expiresAt\.getTime\(\) < now/.test(auth) &&
      /return null/.test(auth)
  );

  const now = Date.now();
  const DAY = 86_400_000;
  check(
    "staleness nudges fire for forgotten and long-unused keys",
    isKeyStale({ createdAt: now - 40 * DAY, lastUsedAt: null }, now) === true &&
      isKeyStale({ createdAt: now - 400 * DAY, lastUsedAt: now - 91 * DAY }, now) === true &&
      isKeyStale({ createdAt: now - 400 * DAY, lastUsedAt: now - DAY }, now) === false &&
      (daysUntilExpiry(now - DAY, now) ?? 1) <= 0
  );
}

// ── ALERT MUTE: planned-work silence windows ────────────────────────────────
console.log("\nMUTE alert mute windows fail open and stay scoped");
{
  const read = (p: string) =>
    require("node:fs").readFileSync(new URL(p, import.meta.url), "utf8") as string;

  const now = Date.now();
  check(
    "the mute fails open on garbage and caps at 72h",
    isAlertMuted(null, now) === false &&
      isAlertMuted("corrupted", now) === false &&
      isAlertMuted(new Date(now + 3_600_000).toISOString(), now) === true &&
      clampMuteHours(999) === 72 &&
      clampMuteHours(0) === null
  );

  const scheduler = read("../src/lib/scheduler.ts");
  const route = read("../src/app/api/settings/alert-mute/route.ts");
  check(
    "the scheduler consults the mute before firing and the route is admin-only",
    /isAlertMuted\(muteUntil, now\)/.test(scheduler) &&
      /alerted: true/.test(scheduler) &&
      /auth\.role !== "admin"/.test(route) &&
      /clampMuteHours\(b\.hours\)/.test(route)
  );
}

// ── CAPACITY: growth forecasting ────────────────────────────────────────────
console.log("\nCAP forecasting honesty and permission scoping");
{
  const read = (p: string) =>
    require("node:fs").readFileSync(new URL(p, import.meta.url), "utf8") as string;

  const now = Date.now();
  const DAY = 86_400_000;
  const growing = Array.from({ length: 8 }, (_, i) => ({ t: now - (7 - i) * DAY, v: 100 + i * 10 }));
  check(
    "forecasts are honest: shrinking and tiny samples return null",
      forecastDaysUntil(growing, 270, now).daysUntilTarget === 10 &&
      forecastDaysUntil(growing, 100, now).daysUntilTarget === 0 &&
      forecastDaysUntil(growing.map((s) => ({ t: s.t, v: 500 - s.v })), 9999, now).daysUntilTarget === null &&
      forecastDaysUntil(growing.slice(0, 3), 9999, now).daysUntilTarget === null &&
      capacityVerdict(null).tone === "unknown"
  );

  const route = read("../src/app/api/nodes/capacity/route.ts");
  check(
    "the capacity endpoint needs the metrics permission and bounds its rows",
    /hasPermission\(auth\.userId, "nodes\.view\.metrics"\)/.test(route) &&
      /\.limit\(MAX_ROWS_PER_NODE\)/.test(route) &&
      /MAX_FIT_SAMPLES/.test(route) &&
      /gte\(nodeMetrics\.recordedAt, since\)/.test(route)
  );
}

// ── DRILL: backup restore drills ────────────────────────────────────────────
console.log("\nDRILL restore drill verdicts and path safety");
{
  const read = (p: string) =>
    require("node:fs").readFileSync(new URL(p, import.meta.url), "utf8") as string;

  check(
    "empty or all-empty extractions fail the drill",
    assessDrill([]).ok === false &&
      assessDrill([{ name: "x", size: 0, isFile: true }]).ok === false &&
      assessDrill([{ name: "x", size: 9, isFile: true }]).ok === true &&
      latestBackupName(["evil.sh", "backup-2026-01-01T00-00-00.tar.gz"]) === "backup-2026-01-01T00-00-00.tar.gz"
  );

  const route = read("../src/app/api/servers/[id]/backup-drill/route.ts");
  check(
    "the drill is permission-gated, path-contained, and always cleans up",
    /hasPermission\(auth\.userId, "servers\.backup"\)/.test(route) &&
      /auth\.role !== "admin" && server\.userId !== auth\.userId/.test(route) &&
      /startsWith\(base \+ sep\)/.test(route) &&
      /rm\(scratch, \{ recursive: true, force: true \}\)/.test(route) &&
      /finally/.test(route)
  );
}

// ── PALETTE: keyboard navigation ────────────────────────────────────────────
console.log("\nPALETTE command palette selection integrity");
{
  const read = (p: string) =>
    require("node:fs").readFileSync(new URL(p, import.meta.url), "utf8") as string;

  check(
    "selection math never escapes the result list",
    clampPaletteIndex(99, 5) === 4 &&
      clampPaletteIndex(-2, 5) === 0 &&
      clampPaletteIndex(3, 0) === 0 &&
      stepPaletteIndex(0, 5, -1) === 0 &&
      stepPaletteIndex(4, 5, 1) === 4 &&
      stepPaletteIndex(99, 5, -1) === 3
  );

  const dash = read("../src/components/Dashboard.tsx");
  check(
    "the palette stays fully keyboard-operable (arrows + enter wired)",
    /"ArrowDown"/.test(dash) &&
      /"ArrowUp"/.test(dash) &&
      /e\.key === "Enter"/.test(dash) &&
      /clampPaletteIndex\(paletteIndex, selectables\.length\)/.test(dash)
  );
}

// ── CSV: metrics export ─────────────────────────────────────────────────────
console.log("\nCSV metrics export escaping and wiring");
{
  const read = (p: string) =>
    require("node:fs").readFileSync(new URL(p, import.meta.url), "utf8") as string;

  check(
    "CSV fields with quotes/commas are RFC-4180 escaped",
    escapeCsvField('say "hi"') === '"say ""hi"""' &&
      escapeCsvField("a,b") === '"a,b"' &&
      seriesToCsv([{ name: "x", points: [{ t: 1700000000000, v: 1 }] }]).startsWith("time,x\r\n")
  );

  const node = read("../src/app/api/nodes/[id]/metrics/route.ts");
  const server = read("../src/app/api/servers/[id]/metrics/route.ts");
  check(
    "both metrics routes offer attachment CSVs behind the same auth",
    /searchParams\.get\("format"\) === "csv"/.test(node) &&
      /content-disposition.*attachment/.test(node) &&
      /searchParams\.get\("format"\) === "csv"/.test(server) &&
      /content-disposition.*attachment/.test(server)
  );
}

// ── CHANGES: field-level server history ─────────────────────────────────────
console.log("\nCHG server change history recording and scoping");
{
  const read = (p: string) =>
    require("node:fs").readFileSync(new URL(p, import.meta.url), "utf8") as string;

  check(
    "diffs skip unchanged values and cap giant ones",
    diffServerPatch({ a: 1 }, { a: 1 }).length === 0 &&
      diffServerPatch({ a: 1 }, { a: 2 }).length === 1 &&
      diffServerPatch({ n: null }, { n: "x".repeat(5000) })[0].to.length === 2000
  );

  const patchRoute = read("../src/app/api/servers/[id]/route.ts");
  const listRoute = read("../src/app/api/servers/[id]/changes/route.ts");
  check(
    "PATCH records history and the history endpoint is ownership-scoped",
    /diffServerPatch\(/.test(patchRoute) &&
      /import\("@\/lib\/server-changes"\)/.test(patchRoute) &&
      /informational only/.test(patchRoute) &&
      /auth\.role !== "admin" && server\.userId !== auth\.userId/.test(listRoute) &&
      /CHANGE_LIST_MAX/.test(listRoute)
  );
}

// ── SESSIONS + ALLOWLIST: revocable logins and IP gating ────────────────────
console.log("\nSESS session revocation and IP allowlist enforcement");
{
  const read = (p: string) =>
    require("node:fs").readFileSync(new URL(p, import.meta.url), "utf8") as string;

  check(
    "the allowlist fails closed for unknown IPs and always frees loopback",
    ipAllowed("127.0.0.1", ["203.0.113.9"]) === true &&
      ipAllowed(null, ["203.0.113.9"]) === false &&
      ipAllowed("203.0.113.9", parseAllowList("203.0.113.9, 10.*")) === true &&
      ipAllowed("8.8.8.8", ["203.0.113.9"]) === false
  );

  const auth = read("../src/lib/auth.ts");
  const logout = read("../src/app/api/auth/logout/route.ts");
  const store = read("../src/lib/session-store.ts");
  check(
    "auth enforces both gates, logout revokes, and store keys by hash only",
    /sessionGate\(token\)/.test(auth) &&
      /ipGate\(headers\)/.test(auth) &&
      /revokeIssuedSession\(token\)/.test(logout) &&
      /tokenHash: hashSessionToken\(token\)/.test(store) &&
      !/token: string/.test(store.split("authSessions")[0] ?? "x")
  );

  check(
    "session revocation is owner-or-admin and the allowlist route is admin-only",
    /if \(!isAdmin && row\.userId !== requesterId\) return false;/.test(store) &&
      /auth\.role !== "admin"/.test(read("../src/app/api/settings/ip-allowlist/route.ts")) &&
      /is not a valid IP or IP\.\* pattern/.test(read("../src/app/api/settings/ip-allowlist/route.ts"))
  );
}

// ── EPHEMERAL: TTL test servers ─────────────────────────────────────────────
console.log("\nEPHEM TTL clone safety and sweep guardrails");
{
  const read = (p: string) =>
    require("node:fs").readFileSync(new URL(p, import.meta.url), "utf8") as string;

  check(
    "recursive deletes only ever touch deep, non-system paths",
    isSafeInstallPath("/opt/gameservers/tf2/srv") === true &&
      isSafeInstallPath("/opt") === false &&
      isSafeInstallPath("/opt/gameservers/../../etc") === false &&
      isSafeInstallPath("/home") === false &&
      clampTtlHours(0) === null &&
      clampTtlHours(9999) === 168
  );

  const sweeper = read("../src/lib/ephemeral-sweeper.ts");
  const clone = read("../src/app/api/servers/[id]/clone/route.ts");
  check(
    "the sweep is local-only, path-gated, capped, and audited",
    /server\.nodeIsLocal !== false && isSafeInstallPath\(server\.installPath\)/.test(sweeper) &&
      /\.limit\(EXPIRE_SWEEP_LIMIT\)/.test(sweeper) &&
      /action: "server\.expired"/.test(sweeper) &&
      /ttlHours must be between 1 and 168/.test(clone) &&
      /clampTtlHours\(body\.ttlHours\)/.test(clone)
  );
}

// ── ROSTER + HEATMAP: live players and peak hours ───────────────────────────
console.log("\nROSTER live rosters and player-history scoping");
{
  const read = (p: string) =>
    require("node:fs").readFileSync(new URL(p, import.meta.url), "utf8") as string;

  const t = (day: number, hour: number, players: number) => ({ ts: new Date(2026, 8, 6 + day, hour).getTime(), players });
  check(
    "heatmap peaks need two sightings and empty buckets stay empty",
    buildHeatmap([t(0, 19, 99)]).peak === null &&
      buildHeatmap([t(0, 19, 10), t(0, 19, 20)]).peak?.avg === 15 &&
      buildHeatmap([t(1, 5, 3)]).cells.length === 1
  );

  const roster = read("../src/app/api/servers/[id]/roster/route.ts");
  const history = read("../src/app/api/servers/[id]/player-history/route.ts");
  check(
    "rosters are cooldown-limited, local-only, and ownership-scoped",
    /ROSTER_COOLDOWN_MS/.test(roster) &&
      /status: 429/.test(roster) &&
      /server\.nodeIsLocal === false/.test(roster) &&
      /auth\.role !== "admin" && server\.userId !== auth\.userId/.test(roster) &&
      /auth\.role !== "admin" && server\.userId !== auth\.userId/.test(history) &&
      /MAX_SAMPLES/.test(history)
  );
}

// ── ANOMALY: rolling z-score spike detection ────────────────────────────────
console.log("\nANOM spike detection conservatism");
{
  const read = (p: string) =>
    require("node:fs").readFileSync(new URL(p, import.meta.url), "utf8") as string;

  const jitter = Array.from({ length: 40 }, (_, i) => ({ t: i * 60_000, v: 50 + (i % 2 === 0 ? 2 : -2) }));
  const spiked = [...jitter.slice(0, 30), { t: 30 * 60_000, v: 600 }, ...jitter.slice(30)];
  const deadFlat = Array.from({ length: 60 }, (_, i) => ({ t: i * 60_000, v: 50 }));
  // Flat history then a spike: with zero variance there is no "normal" to
  // deviate from, so the guard must keep this quiet.
  const flatThenSpike = [...Array.from({ length: 30 }, (_, i) => ({ t: i * 60_000, v: 50 })), { t: 30 * 60_000, v: 500 }];
  check(
    "spikes are flagged only with real history and flat series stay quiet",
    detectAnomalies(spiked).length >= 1 &&
      detectAnomalies(jitter).length === 0 &&
      detectAnomalies(deadFlat).length === 0 &&
      detectAnomalies(flatThenSpike).length === 0 &&
      detectAnomalies(spiked.slice(0, 8)).length === 0
  );

  const route = read("../src/app/api/nodes/[id]/metrics/route.ts");
  check(
    "the metrics endpoint caps anomaly output",
    /detectAnomalies\(cpu\)\.slice\(-20\)/.test(route) &&
      /detectAnomalies\(ram\)\.slice\(-20\)/.test(route)
  );
}

// ── DIGEST: weekly fleet summary ────────────────────────────────────────────
console.log("\nDIGEST fleet digest scoping and shape");
{
  const read = (p: string) =>
    require("node:fs").readFileSync(new URL(p, import.meta.url), "utf8") as string;

  const text = formatFleetDigest({
    serversTotal: 5, serversRunning: 3, crashed: 1, watchdogStops: 0, idleStops: 0,
    uptime: [{ name: "x", percent: 97 }],
  });
  check(
    "the digest summarises fleet health and stays within Discord limits",
    /Fleet digest/.test(text) &&
      /3 running \/ 5 total/.test(text) &&
      text.length <= 1900
  );

  const scheduler = read("../src/lib/scheduler.ts");
  const route = read("../src/app/api/scheduler/route.ts");
  const digest = read("../src/lib/fleet-digest.ts");
  check(
    "fleet-digest is a panel task: admin-only, runner wired, both channels fired",
    /"fleet-digest"/.test(scheduler) &&
      /sendFleetDigest/.test(scheduler) &&
      /Only administrators can schedule panel-level tasks/.test(route) &&
      /taskType === "fleet-digest"/.test(route) &&
      /fireWebhookEvent/.test(digest) &&
      /DIGEST_MAX_LENGTH/.test(digest)
  );
}

// ── IDLE UPDATE: update only when empty ─────────────────────────────────────
console.log("\nIDLEUPD idle-aware update guardrails");
{
  const read = (p: string) =>
    require("node:fs").readFileSync(new URL(p, import.meta.url), "utf8") as string;

  const scheduler = read("../src/lib/scheduler.ts");
  check(
    "idle-update refuses busy servers, keeps the backup safety net, and restarts after",
    /"idle-update"/.test(scheduler) &&
      /players may be online/.test(scheduler) &&
      /idleDurationMs\(idleRow\?\.zeroPlayersSince \?\? null, Date\.now\(\)\)/.test(scheduler) &&
      /createServerBackup\(installPath\)/.test(scheduler) &&
      /wasRunning/.test(scheduler) &&
      /idleThresholdMs/.test(scheduler)
  );
  check(
    "idle-update gate is a strict less-than, skips running+busy, restarts only when wasRunning",
    /idleFor === null \|\| idleFor < idleThresholdMs/.test(scheduler) &&
      /players may be online/.test(scheduler) &&
      /wasRunning/.test(scheduler) &&
      /startDetachedScript\(join\([^)]*installPath, "gsm-start\.sh"\)\)/.test(scheduler) &&
      /if \(wasRunning\) \{/.test(scheduler) &&
      /\(idleBackupPref\?\.value \?\? "true"\) !== "false"/.test(scheduler)
  );
}

// ── STAGED ROLLOUT: canary before the fleet ─────────────────────────────────
console.log("\nSTAGED rollout safety rails");
{
  const read = (p: string) =>
    require("node:fs").readFileSync(new URL(p, import.meta.url), "utf8") as string;

  const route = read("../src/app/api/servers/batch-update/route.ts");
  const lib = read("../src/lib/staged-rollout.ts");
  check(
    "staged rollout plans a canary, boot-verifies it, and halts before sweeping on failure",
    /planStagedRollout\(dispatchable\)/.test(route) &&
      /shouldSweepRest\(canaryUpdateOk, canaryBootAlive\)/.test(route) &&
      /halted = canaryUpdateOk \? "canary-boot-failed" : "canary-update-failed"/.test(route) &&
      /setTimeout\(r, BOOT_GRACE_MS\)/.test(route)
  );
  check(
    "sweep only happens inside the canary-passed branch",
    /if \(!shouldSweepRest\(canaryUpdateOk, canaryBootAlive\)\) \{/.test(route) &&
      /for \(const server of plan\.rest\) \{/.test(route) &&
      /canaryVerified = true/.test(route)
  );
  check(
    "pure planner keeps blocked servers visible and canary out of the sweep",
    /eligible\.slice\(1\)/.test(lib) &&
      /status is \$\{server\.status\} — stop it first/.test(lib) &&
      /return canaryUpdateOk && canaryBootAlive/.test(lib)
  );
  check(
    "canary is restored to stopped state after boot verification",
    /\{ action: "stop" \}/.test(route) &&
      /best-effort cleanup/.test(route)
  );
}

// ── COLLAB: server sharing rails ────────────────────────────────────────────
console.log("\nCOLLAB server-sharing rails");
{
  const read = (p: string) =>
    require("node:fs").readFileSync(new URL(p, import.meta.url), "utf8") as string;

  const listRoute = read("../src/app/api/servers/route.ts");
  const getRoute = read("../src/app/api/servers/[id]/route.ts");
  const procRoute = read("../src/app/api/servers/[id]/process/route.ts");
  const collabRoute = read("../src/app/api/servers/[id]/collaborators/route.ts");
  const lib = read("../src/lib/server-collab.ts");

  check(
    "server list includes shared servers and marks them",
    /sharedServerIdsFor\(auth\.userId\)/.test(listRoute) &&
      /inArray\(gameServers\.id, sharedIds\)/.test(listRoute) &&
      /sharedWithMe: sharedSet\.has\(srv\.id\)/.test(listRoute)
  );
  check(
    "server detail: strangers get 404, collaborators never see the webhook secret",
    /getCollaboratorRole\(server\.id, auth\.userId\)/.test(getRoute) &&
      /server\.discordWebhook = null/.test(getRoute)
  );
  check(
    "process route: collaborators pass the ownership gate, viewers can't control",
    /collabRole = await getCollaboratorRole\(server\.id, auth\.userId\)/.test(procRoute) &&
      /collabRole === "viewer" && action !== "status"/.test(procRoute) &&
      /Viewers can't control this server/.test(procRoute)
  );
  check(
    "collaborators route: owner/admin manage, roles validated, no self-owner rows, self-removal allowed",
    /canManageSharing/.test(collabRoute) &&
      /isCollaboratorRole\(role\)/.test(collabRoute) &&
      /The owner already has full access/.test(collabRoute) &&
      /const selfRemoval = targetUserId === \(auth\.userId as number\)/.test(collabRoute)
  );
  check(
    "pure access model: control = owner+operator, manage = owner only",
    /return access === "owner" \|\| access === "operator"/.test(lib) &&
      /return access === "owner"/.test(lib) &&
      /if \(input\.isAdmin \|\| input\.isOwner\) return "owner"/.test(lib)
  );
}

// ── BLUEPRINT: multi-server deploy rails ────────────────────────────────────
console.log("\nBLUEPRINT deploy rails");
{
  const read = (p: string) =>
    require("node:fs").readFileSync(new URL(p, import.meta.url), "utf8") as string;

  const lib = read("../src/lib/blueprints.ts");
  const deploy = read("../src/app/api/blueprints/[id]/deploy/route.ts");
  const crud = read("../src/app/api/blueprints/[id]/route.ts");

  check(
    "blueprint caps enforced at validation AND again at expansion (no fork bombs)",
    /total > BLUEPRINT_MAX_TOTAL/.test(lib) &&
      /plan\.length > BLUEPRINT_MAX_TOTAL/.test(lib) &&
      /count < 1 \|\| count > BLUEPRINT_MAX_PER_ENTRY/.test(lib)
  );
  check(
    "deploy: blueprint access gate, preset visibility, and real create path",
    /blueprint\.userId !== auth\.userId/.test(deploy) &&
      /is not shared with you/.test(deploy) &&
      /createServerAction\(new NextRequest\(inner\)\)/.test(deploy) &&
      /nextFreePort\(preset\.defaultPort \?\? MIN_SERVER_PORT, taken, 2\)/.test(deploy)
  );
  check(
    "deploy stops at the first failed server instead of plowing into a wall",
    /if \(!res\.ok\) break;/.test(deploy)
  );
  check(
    "blueprint CRUD: strangers get 404 on read/update/delete",
    /auth\.role === "admin" \|\| blueprint\.userId === auth\.userId/.test(crud)
  );
}

// ── ROLLING RESTART: one at a time, verified ────────────────────────────────
console.log("\nROLLING restart rails");
{
  const read = (p: string) =>
    require("node:fs").readFileSync(new URL(p, import.meta.url), "utf8") as string;

  const batch = read("../src/app/api/servers/batch/route.ts");
  const lib = read("../src/lib/rolling-restart.ts");
  check(
    "rolling restart verifies each server after a settle window before continuing",
    /planRollingRestart\(dispatchable\)/.test(batch) &&
      /setTimeout\(\(\) => void verifyServerAlive\(server\.id\)\.then\(resolve\)\.catch\(\(\) => resolve\(false\)\), SETTLE_MS\)/.test(batch) &&
      /shouldContinueRolling\(verified\)/.test(batch)
  );
  check(
    "first unverified restart halts the sweep and leaves the rest untouched",
    /if \(!shouldContinueRolling\(verified\)\) \{/.test(batch) &&
      /rolling restart halted before this server/.test(batch) &&
      /haltedAt = server\.name/.test(batch)
  );
  check(
    "pure planner admits only running servers and the halt decision is explicit",
    /server\.status === "running"/.test(lib) &&
      /return lastVerified/.test(lib)
  );
}

// ── UPDATE DIFF: know what Steam touched ────────────────────────────────────
console.log("\nUPDDIFF update snapshot rails");
{
  const read = (p: string) =>
    require("node:fs").readFileSync(new URL(p, import.meta.url), "utf8") as string;

  const route = read("../src/app/api/servers/[id]/update/route.ts");
  const lib = read("../src/lib/update-diff.ts");
  check(
    "update route snapshots before AND after the Steam run",
    /snapshotInstallPath\(server\.installPath\)/.test(route) &&
      /const pre = await snapshotInstallPath/.test(route) &&
      /const post = await snapshotInstallPath/.test(route) &&
      /diffSnapshots\(pre\.entries, post\.entries, pre\.truncated, post\.truncated\)/.test(route)
  );
  check(
    "diff report is persisted as an update-report event and surfaced in the response",
    /recordServerEvent\(server\.id, "update-report"/.test(route) &&
      /configsChanged/.test(route)
  );
  check(
    "pure diff: size-or-mtime change detection, caps, config flagging",
    /prev\.size !== entry\.size \|\| prev\.mtimeMs !== entry\.mtimeMs/.test(lib) &&
      /slice\(0, REPORT_MAX_PATHS\)/.test(lib) &&
      /CONFIG_EXTENSIONS\.some/.test(lib) &&
      /entries\.length >= SNAPSHOT_MAX_FILES/.test(lib)
  );
  check(
    "walker never follows symlinks",
    /if \(st\.isSymbolicLink\(\)\) continue;/.test(lib)
  );
}

// ── MAINTWINDOWS: scheduled drain/release rails ─────────────────────────────
console.log("\nMAINTW scheduled maintenance rails");
{
  const read = (p: string) =>
    require("node:fs").readFileSync(new URL(p, import.meta.url), "utf8") as string;

  const lib = read("../src/lib/maintenance-windows.ts");
  const scheduler = read("../src/lib/scheduler.ts");
  const post = read("../src/app/api/maintenance-windows/route.ts");
  const del = read("../src/app/api/maintenance-windows/[id]/route.ts");

  check(
    "phase math is boundary-exact and the applier only releases what it applied",
    /if \(nowMs < input\.startsAtMs\) return "pending"/.test(lib) &&
      /if \(nowMs < input\.endsAtMs\) return "active"/.test(lib) &&
      /if \(win\.appliedAt\) \{/.test(lib) &&
      /phase === "active" && !win\.appliedAt/.test(lib)
  );
  check(
    "validation caps window length and rejects backwards windows",
    /endsAt\.getTime\(\) <= startsAt\.getTime\(\)/.test(lib) &&
      /MAINTENANCE_WINDOW_MAX_HOURS \* 3_600_000/.test(lib)
  );
  check(
    "scheduler tick runs the window sweep best-effort",
    /applyMaintenanceWindows\(\)/.test(scheduler) &&
      /maintenance window sweep failed/.test(scheduler)
  );
  check(
    "routes gate on nodes.maintenance and cancelling an applied window releases the node",
    /hasPermission\(auth\.userId, "nodes\.maintenance"\)/.test(post) &&
      /hasPermission\(auth\.userId, "nodes\.maintenance"\)/.test(del) &&
      /maintenanceMode: false/.test(del)
  );
}

// ── PLAYERALERT: edge-triggered crowd alerts ────────────────────────────────
console.log("\nPALERT player-alert rails");
{
  const read = (p: string) =>
    require("node:fs").readFileSync(new URL(p, import.meta.url), "utf8") as string;

  const lib = read("../src/lib/player-alerts.ts");
  const idle = read("../src/lib/idle-detection.ts");
  const patch = read("../src/app/api/servers/[id]/route.ts");
  check(
    "evaluation is edge-triggered and null players never touch the armed state",
    /const above = input\.players >= input\.threshold/.test(lib) &&
      /return \{ fire: above && !input\.wasAbove, above \}/.test(lib) &&
      /if \(input\.threshold === null \|\| input\.players === null\) \{/.test(lib) &&
      /return \{ fire: false, above: input\.wasAbove \}/.test(lib)
  );
  check(
    "threshold parsing rejects floats/zero/oversized and accepts null to disable",
    /!Number\.isInteger\(n\) \|\| n < 1 \|\| n > PLAYER_ALERT_MAX_THRESHOLD/.test(lib) &&
      /if \(value === null \|\| value === "" \|\| value === undefined\) return null/.test(lib)
  );
  check(
    "idle tick feeds the alert evaluator on successful probes only",
    /processPlayerProbeForAlerts\(\{/.test(idle) &&
      /server\.playerAlertThreshold !== null/.test(idle)
  );
  check(
    "PATCH validates the threshold and clears the edge state when disabling",
    /parsePlayerAlertThreshold\(updates\.playerAlertThreshold\)/.test(patch) &&
      /updates\.playerAlertAbove = false/.test(patch) &&
      /playerAlertThreshold must be a whole number between 1 and 1000/.test(patch)
  );
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`${failures} security check(s) FAILED`);
  process.exit(1);
}
