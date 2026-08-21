# Changelog

All notable changes to GameServer Manager are documented here.

---

## [1.9.0] — 2026-08-22

### 🔑 API Keys Were Completely Inert
- **The entire API key feature did nothing.** The panel generated a key, hashed it into `api_keys.key_hash`, and displayed instructions telling users to send `Authorization: Bearer gsm_...` — but **no code on the server ever read that header**, and the stored hash was never compared against anything. Every documented external integration failed with a `401`.
- **Now implemented properly** — wired into `getCurrentUser()`, so all 151 call sites accept API keys with no per-route changes. The lookup narrows by the indexed (non-secret) key prefix, compares the full SHA-256 digest with `timingSafeEqual`, rejects expired keys and keys whose owner is suspended or banned, and updates `last_used_at` on a best-effort basis.
- SHA-256 rather than bcrypt is deliberate: an API key is 32 bytes of CSPRNG output with no dictionary to attack, and this runs on the hot path for every API request.

### 🧪 The First Unit Tests
- **The repo had no tests.** The verify harnesses cover installers and grep the source for security fixes, but nothing exercised the logic that runs at request time. Added **81 tests** using Node's built-in runner — no new dependencies.
- **`config-render` (22)** — ten output formats, XML escaping, nested objects, `__files` routing, directive stripping. This is the code that writes every game's config, so a regression here produces a file the engine rejects or, worse, silently accepts with wrong values.
- **`server-file-ops` (18)** — `safePath()`, the guard on every file-manager operation, including the sibling-prefix case (`/srv/mc` vs `/srv/mc-evil`) that was a real vulnerability. **Verified these tests fail when the old buggy implementation is restored**, so they genuinely catch it.
- **`auth` (17)** — salted one-way password hashing, JWT round-trips, rejection of tampered and re-encoded payloads, cookie flags, and the login throttle.
- **`pagination` (14)** and **`api-key` (10)**.
- `npm test` runs them; `npm run verify` and CI now include them.

### 🔒 Verification
- Security suite grows to **57 checks**, pinning the API key verification path.

---

## [1.8.0] — 2026-08-22

### 🗄️ Unbounded Data Growth
- **The metrics tables had no cleanup whatsoever.** `node_metrics`, `server_metrics` and `audit_log` are append-only and nothing in the application ever deleted a row. A node heartbeating every 10 seconds writes roughly **8,600 rows per day**, so a five-node panel reaches about **16 million rows and ~2.4 GB within a year** — while the dashboards only ever read the recent tail.
- **Retention is now amortised onto the writes** — a heartbeat occasionally (2% of the time, at most once a minute) prunes rows past the retention window. No external cron, no extra moving parts, and failures are logged and swallowed so retention can never fail a heartbeat.
- **Configurable windows** — `METRICS_RETENTION_DAYS` (default 30) and `AUDIT_RETENTION_DAYS` (default 365, since audit trails are usually a compliance concern). Set either to `0` to keep everything.
- **Two more missing indexes** — `server_metrics(server_id, recorded_at)`. Without `recorded_at` the prune `DELETE` would sequential-scan the largest table in the schema.
- **`/api/maintenance/retention`** — admin-only endpoint to inspect row counts and force a prune on demand.

### 🔢 Pagination Hardening
- **Six unclamped query parameters across four routes** went straight from `parseInt` into SQL. `?limit=999999999` read an entire table into memory — a single authenticated request could exhaust server RAM against the very tables that grow without bound. `?limit=abc` produced `NaN` and `?limit=-1` a negative `LIMIT`, both of which Postgres rejects with a syntax error surfaced as a 500.
- Added `src/lib/pagination.ts`, which always returns a sane integer inside a fixed 500-row ceiling, and switched `audit-log`, `cms` and the database table browser over to it. (The chat endpoint already clamped correctly.)

### 🧪 Verification
- Security suite grows to **52 checks**, including a sweep that fails if any route reintroduces a raw `parseInt` on a pagination parameter.

---

## [1.7.0] — 2026-08-22

### 🛡️ Security Headers
- **The panel shipped with no security headers at all.** Since it executes shell commands, edits files on disk and holds database credentials, an XSS or clickjacking attack against a logged-in admin is effectively remote code execution on the host. Added a Content-Security-Policy plus `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy` and HSTS.
- **`X-Powered-By` disabled** — the exact framework version is no longer advertised to anyone scanning the panel.
- The CSP permits `'unsafe-inline'` for styles (Tailwind and the custom theme editor set inline style attributes) but **never `'unsafe-eval'` in production**. Verified against a running server: all headers present, every JS chunk still loads, page renders unchanged. The app references no external origins, so `default-src 'self'` breaks nothing.

### 🔐 Dependencies
- **Three high-severity CVEs cleared** — `npm audit` flagged advisories reaching production dependencies transitively through Next.js: `sharp` (inherited libvips CVE-2026-33327, -33328, -35590, -35591), `postcss`, and Next itself. Upgrading **16.2.6 → 16.3.2** — a patch-level bump inside the existing major, no migration required — takes the audit to **0 vulnerabilities**.

### ⚙️ Continuous Integration
- **The repo had no CI.** Every gate built over the last few releases only ran when someone remembered to run it. A GitHub Actions workflow now runs typecheck, lint, the template and installer harnesses, the security suite, a production build, and a high-severity dependency audit on every push and pull request.
- **Weekly upstream monitoring** — `check-upstreams.sh` runs on a schedule and on demand rather than per-PR, so a game download endpoint going stale gets noticed without failing unrelated pull requests.

### 📄 Licensing
- **Added the missing `LICENSE` file.** The README advertised MIT, but no license text existed anywhere in the repo — which legally left the project as all-rights-reserved regardless of what the docs claimed.

---

## [1.6.0] — 2026-08-21

### 🎮 Three Game Installers Were Completely Broken
- **Terraria, Assetto Corsa and Minecraft Paper could never install** — install scripts live inside untagged template literals, so a single backslash is consumed by JavaScript before bash sees it. `\s` became `s` and `\K` became `K`, silently turning each PCRE into one that matches nothing. All three aborted with "could not find/resolve" every single time. Fixed by escaping the patterns, and verified end to end.
- **Minecraft Java installed the wrong JDK** — the script grepped Mojang's version JSON for `"major_version"`, but the real key is `"majorVersion"`. The pattern never matched, so the required Java version silently fell back to 21. Checked against the live API: Minecraft 26.2 needs Java **25**, so the installer provisioned a JDK too old to run the server. It now reads the correct key and keeps the old spelling as a fallback.
- **SteamCMD `chown` was a no-op** — the shared installer ran `chown -R $(whoami)` unquoted, which does nothing useful unless running as root. It now runs only as root, with the user and group quoted.

### 🧪 Installers Are Now Actually Executed in CI
- **`npm run verify:installers`** — renders each of the 27 templates, runs `bash -n` and shellcheck, then **runs the install script for real** inside a throwaway directory in a user + mount namespace, with `steamcmd`, `curl`, `wget` and `apt` mocked and a tmpfs over `/opt`. It then asserts the runtime artifacts the panel needs to launch the server were actually produced, and that the start command resolves to something that exists. All 27 games pass.
- **`npm run check:upstreams`** — hits the real download endpoints and release APIs and confirms our parsing expressions still match what upstream returns today (18/18 passing). Kept out of `npm run verify` because upstream outages are not repo regressions.
- **The mangled-backslash bug now fails the build** — `verify:templates` detects the pattern itself, so this class of bug cannot return.

### 🔒 Security & Correctness
- **69 error sites across 46 API routes leaked internal detail** — failures returned the raw exception message, exposing SQL fragments, driver internals and absolute filesystem paths. All now route through `apiError()`, which logs the detail server-side and returns a generic message in production.
- **`/api/health` leaked database credentials** — the endpoint is unauthenticated (the installer and updater poll it) and returned the driver's error verbatim, which includes the host, port and sometimes the password from the connection string.
- **Registration accepted almost anything** — no password strength requirement, no length caps (an over-long username produced a `500` from the database instead of a `400`), no rate limiting despite creating rows and running bcrypt, raw error text returned to the caller, and a race between the duplicate check and the insert. It now validates the username format and every field length, requires 8+ character passwords, reuses the login throttle, uses a single existence query, and handles the unique-violation race it cannot prevent.
- **Security regression suite grew from 33 to 40 checks**, including a sweep that fails if any route reintroduces a raw exception message.

### ⚡ Performance
- **14 database indexes added** — the schema declared 19 foreign keys and *zero* indexes, so every join and filter was a sequential scan. Indexed the columns the code actually filters on: `game_servers(user_id, node_id, game_id)`, `node_metrics(node_id, recorded_at)`, `forum_threads(category_id, user_id)`, `forum_posts(thread_id, user_id)`, `chat_messages(created_at, user_id)` — polled every 2.5 seconds by the chat widget — plus `audit_log(user_id, created_at)` and `api_keys(user_id)`. Applied automatically by `drizzle-kit push` during install and update.

---

## [1.5.0] — 2026-08-21

### 🔒 Security Audit — 11 Issues Found, 11 Fixed

A full-repository audit covering build/type/lint gates, correctness, security, and runtime behaviour. Two critical findings, five high, three medium, one low. See `DEBUG-REPORT.md` for the complete write-up.

**Critical**
- **Remote code execution in the backup route** — `POST/DELETE /api/servers/[id]/backup` interpolated the caller-supplied backup name into a shell string, so a name containing `;` or a backtick ran arbitrary commands as the panel user. Backups now spawn `tar` directly with an argument array (no shell), names must match `^backup-[A-Za-z0-9._-]+\.tar\.gz$`, and the resolved path is required to sit inside the server's backup directory.
- **SQL injection in the database row editor** — `/api/database/table/[name]/row` built `UPDATE`/`DELETE` statements by string-concatenating column names from the request body. Columns are now validated against a live `information_schema.columns` allowlist, identifiers are quoted with a dedicated `quoteIdent()` helper, and empty or unbounded statements are rejected before they reach the driver.

**High**
- **Path traversal in the file manager** — `safePath()` accepted sibling directories whose names merely started with the base path (`/opt/gameservers/foo-evil` passed the check for `/opt/gameservers/foo`). Containment is now an exact match or a `base + separator` prefix, which also fixes the file upload route that depends on it.
- **Hardcoded fallback JWT secret** — the shipped default `gsm-panel-secret-change-me` let anyone forge a session token against a deployment that never set `JWT_SECRET`. The fallback is gone; production requires the variable and refuses to boot without it, and development derives a random per-process secret.
- **2FA could be bypassed** — the login endpoint enforced TOTP but the login form never asked for a code, so accounts with 2FA enabled were unreachable rather than protected. The form now handles the `twoFactorRequired` response and submits the code.
- **Suspended and banned users kept working sessions** — account status was checked at login but nowhere afterwards. `getUserPermissions()` now denies everything for non-active users, and `/api/auth/me` returns 403 and clears the session cookie.
- **Node heartbeat accepted unconfigured keys** — a node with a `NULL` API key authenticated any caller, and the comparison was a plain string equality vulnerable to timing analysis. Heartbeats now require a configured key and compare with `timingSafeEqual`.

**Medium & low**
- **Brute-force protection on login** — 10 attempts per IP + username within a 15-minute window, answered with `429` and a `Retry-After` header.
- **Internal errors leaked to clients** — a new `apiError()` helper logs the detail server-side and returns a generic message in production.
- **Five `react-hooks/set-state-in-effect` violations** — `PublicChatWidget`, `SandboxChat`, `ForumPanel`, and `PublicSite` set state during render-phase effects, causing redundant re-renders and duplicate fetches. All are ref-guarded now, and ESLint is clean.

### 🎮 Complete Game Template Library
- **27 games, 1,551 configurable options** — every template now exposes its game's full server config surface, categorized, typed, validated, with enums and defaults, and each option is genuinely consumed by the install script, config files, or start command.
- **One module per game** — the monolithic seed file was split into `src/db/games/`, with shared `types.ts`, a reusable `steamcmd.ts` installer, and a `src/db/seeds.ts` shim so existing importers keep working unchanged.
- **Multi-file config rendering** — templates can emit several config files in different formats (INI with sections, JSON, key=value, Quake 3 `set` syntax) via `src/lib/config-render.ts`. V Rising writes both `ServerHostSettings.json` and `ServerGameSettings.json`; Assetto Corsa writes a sectioned `server_cfg.ini` alongside `entry_list.ini`.

### 🧪 Tooling
- **`npm run verify`** — one command chaining `typecheck`, `lint`, `verify:templates`, and `verify:security`.
- **`npm run verify:security`** — 33 regression checks pinning every fix above, so the vulnerabilities cannot silently return.
- **`npm run verify:templates`** — validates all 1,551 template options and reports unused or undeclared variables per game.
- **`.env.example`** — documents every supported environment variable, required and optional.
- **`.gitignore`** — added; build output, `node_modules`, and local `.env` files are no longer tracked.

### 📦 Installer, Updater & Uninstaller
- **The updater no longer breaks on the new `JWT_SECRET` requirement** — `update.sh` now backfills a secret into `.env` after pulling code if the variable is missing, empty, or shorter than 32 characters, and adds `NODE_ENV=production` when absent. Without this, every pre-1.5.0 install would have failed at the build step. Secrets that are already valid are left untouched, so sessions survive the upgrade.
- **Build success is detected correctly** — `install.sh` and `update.sh` checked for a `.next` *directory*, which Next.js creates even when the build fails; a broken build was reported as successful and the panel was restarted onto stale output. Both now check for `.next/BUILD_ID`, which is only written on success, and the build directory is cleared first so a previous build cannot mask a failure.
- **Rollback verifies its own rebuild** — `update.sh --rollback` discarded all build output and never checked the result, so a failed rollback looked clean. It now logs to `/tmp/gsm-rollback-build.log` and aborts loudly if the restored code does not build.
- **`--jwt-secret` is validated up front** — passing a secret shorter than 32 characters previously produced a fully installed panel that crashed on first boot. The installer now rejects it before making any system changes.
- **Uninstaller gained `--install-dir` and `-y`** — it hardcoded `/opt/gsm-panel`, so panels installed with `--install-dir` could not be removed. It also now rejects unknown flags instead of ignoring them, supports `--help`, and no longer lets `.install-info` override an explicitly passed directory.

### ⚠️ Breaking Changes
- **`JWT_SECRET` is now required in production** and must be at least 32 characters. The panel exits at startup if it is missing. Generate one with `openssl rand -hex 32`.
  - Installs created by `install.sh` are **unaffected** — the installer already generates a 62-character secret and writes it to `.env`.
  - Only manual installations that relied on the old auto-generated fallback need to add the variable before upgrading. Existing sessions are invalidated the first time the secret changes.

---

## [1.4.0] — 2026-01-01

### 🐺 Wolfenstein: Enemy Territory — Full server.cfg Options in the Installer
- **Every ET server.cfg option is now exposed in the server creation installer** — the Wolfenstein: Enemy Territory / ET:Legacy template grew from 2 variables to **150+ template variables**, covering the complete official `etl_server.cfg` and `legacy.cfg` option sets.
- **Grouped, collapsible option categories** — the Create Server wizard's "Game Settings" step now groups template variables by category with collapsible sections, so large option sets stay navigable:
  - Server Identity (mod, game type select with labels, start map, 2.60 rotation override, all 6 MOTD lines)
  - Clients, Passwords (server/RCON/referee/shoutcast), Network (advertising, timeouts, ping limits, IPv4/IPv6 bind overrides)
  - Master Servers (all 6 `sv_master*` cvars), Download (rates, allow/web download, www redirect URLs)
  - Logging & Protection (logfile, pure, DDoS protection, flood protect, per-IP limits, PunkBuster)
  - Mod Logging & Protection (g_log, GUID check), Optimizations (anti-warp)
  - XP Skill Levels (all 7 `skill_*` thresholds), Class Limits (all 5), Weapon Limits (all 9)
  - Gameplay (34 cvars incl. friendly fire, lives, warmup, intermission, complaints, pmove physics)
  - Match (6 cvars), LMS (5 cvars), Voting (all 23 `vote_allow_*` flags + percent/limit), Map Voting, Lua, Omni-Bot, Watchdog
- **Complete generated server.cfg** — the installer now writes a fully populated server.cfg with all 140+ cvars (mirroring upstream `etl_server.cfg` + `legacy.cfg`), with bash-derived map-rotation directives matching the chosen game type (`objectivecycle.cfg` / `campaigncycle.cfg` / `lmscycle.cfg` / `mapvotecycle.cfg` / single map / legacy `sv_mapRotation`).
- **Template-driven default config** — `defaultConfig` now carries the full cvar map so the panel's config materializer regenerates a complete config; new `__gsm_format: "quake3"` directive renders `.cfg` files as `set cvar "value"` lines.
- **Numeric checkbox normalization** — wizard checkboxes with `0`/`1` defaults are normalized to `"0"`/`"1"` at install time (id Tech 3 treats the strings "true"/"false" as 0), keeping other engines' `true`/`false` semantics untouched.
- **Safer tokenized config paths** — `configFiles` entries like `{{ET_MOD}}/server.cfg` are skipped if the token resolved to an empty value instead of writing to a stray root path.
- **Improved start command** — ET launches with `+set vm_game 0` for reliable `.so` game-module loading, honoring the selected mod folder.

---

## [1.3.0] — 2026-08-15

### 💬 Public Chat Widget (Guest-Visible, Configurable)
- **Public-facing chat widget** — a floating community chat overlay visible on all public site pages (home, forums, blog, changelog, ladder). Guests and unauthenticated visitors can **read** the chat in real-time, but only logged-in users can **send** messages.
- **Read-only for guests** — the `GET /api/forum/chat` endpoint no longer requires authentication, allowing anyone to poll and view chat messages. `POST` and `DELETE` still require a valid session.
- **Login prompt** — unauthenticated users see a "Login to Chat" button in the chat input area, making it easy to convert visitors into registered users.
- **Configurable position** — admins can set the widget's default screen position via the Site Editor: Bottom Right, Bottom Left, Top Right, or Top Left.
- **Configurable size** — admins can set the widget's width (280–600px) and height (200–800px) from the Site Editor, controlling how much screen real estate the chat uses.
- **Enable/disable toggle** — the widget can be fully disabled from the Site Editor without code changes.
- **Draggable** — users can click-and-drag the chat header to reposition the widget anywhere on their screen during their session for maximum flexibility.
- **Site Settings integration** — four new public setting keys: `chat_enabled`, `chat_position`, `chat_width`, `chat_height` — all configurable from the ✏️ Edit Frontpage panel.
- **Minimized by default** — the floating widget starts collapsed to avoid blocking content; unread badge shows new message count while minimized.
- **Same theme integration** — inherits all CSS custom properties from the 5 built-in themes, maintaining visual consistency with the rest of the site.
- **3-second polling** — the public widget polls every 3 seconds (vs 2.5s in the dashboard chat) to balance real-time feel with guest traffic load.

---

## [1.2.0] — 2026-08-15

### 🗨️ Real-Time Sandbox Chat
- **New Forum Sandbox Chat** — a persistent, real-time chat box embedded in the Forum panel sidebar. Think of it as a community shoutbox / lobby chat for your game server community.
- **Live polling** — messages update every 2.5 seconds via short-polling (`GET /api/forum/chat?after=<lastId>`), giving a near real-time experience without WebSocket complexity.
- **New database table** — `chat_messages` table (id, user_id, body, created_at) with foreign key to `users`.
- **Full REST API** — `GET /api/forum/chat` (fetch messages with optional `?after=<id>` for incremental polling and `?limit=<n>`), `POST /api/forum/chat` (send message, max 1000 chars), `DELETE /api/forum/chat` (delete own message or any message if admin/moderator).
- **Active user count** — header shows how many unique users have chatted in the last 5 minutes, with a pulsing green dot indicator.
- **Unread badge** — when the chat is minimized, new incoming messages increment an unread counter badge on the header.
- **Collapsible UI** — click the chat header to minimize/expand; chat state persists during the session.
- **Auto-scroll** — automatically scrolls to the latest message unless the user has scrolled up to read history.
- **User avatars** — displays initials with color-coded badges (accent for own messages, muted for others).
- **Role badges** — ADMIN and MOD badges displayed next to usernames, matching the forum's role badge style.
- **Message moderation** — admins and moderators can delete any message; regular users can delete only their own.
- **Responsive layout** — on large screens (xl+), the chat appears as a sticky sidebar next to forum content. On smaller screens, it stacks below the forum content.
- **Themed** — fully integrated with all 5 panel themes (Nebula Dark, Cloud Light, Ember Sun, Forest Command, custom user themes) using existing CSS custom properties.
- **Character limit** — 1000 character limit per message with server-side validation.
- **Relative timestamps** — messages show "just now", "5m ago", "2h ago", or date for older messages.

---

## [1.1.0] — 2026-08-12

### 🐳 LXC / Container Support
- **Auto-detect LXC and Docker containers** at install time via `/proc/1/environ`, `/.dockerenv`, and cgroup markers.
- **Subnet-scored interface detection** — scans all interfaces and scores them by IP range: `192.168.x.x` (100), `172.16–31.x.x` (80), general `10.x.x.x` (30), `10.0.3.x` LXC bridge (5), `10.172.x.x` ASUSTOR internal (2). Picks the highest-scoring interface as the real LAN — works correctly even when the LAN is on `eth1` (ASUSTOR) instead of `eth0`.
- **Force LAN gateway** — always sets the detected LAN interface as the default route (`metric 10`), regardless of which `ethN` device it's on, ensuring port forwarding from your router works correctly.
- **Remove conflicting internal gateways** — strips default routes on every interface except the detected LAN device, including ASUSTOR's injected `10.172.5.1` management gateway.
- **Persistent boot fix** — installs a systemd oneshot service (`fix-container-routing.service`) that re-applies the LAN gateway preference on every container reboot, with a 10-second delay to let the host platform finish its own network setup first.
- **Internet verification** — tests outbound connectivity after applying the routing fix and warns if the internet is still unreachable.
- **UFW skipped in containers** — `ufw --force enable` inside an LXC container conflicts with the host's iptables/nftables and drops SSH connections. The installer now detects containers and skips UFW entirely, printing a reminder of which ports to forward on the router instead. UFW is only configured and enabled on bare-metal/VM installs.

### 🔥 Automatic Firewall Management
- **Dynamic port rules** — creating a game server now automatically opens its game port, query port, and RCON port in UFW (TCP + UDP). Deleting a server removes the rules. Changing a server's port updates the rules.
- **Tagged rules** — each UFW rule is labeled `GSM:<serverId> <serverName>` for easy identification in `ufw status`.
- **Port change tracking** — `PATCH /api/servers/[id]` diffs old vs new ports and only adds/removes the changed rules.
- **Firewall API** — new `GET/POST /api/firewall` endpoint for admins to view UFW status and manually allow/deny ports from the panel.
- **Firewall utility module** — `src/lib/firewall.ts` wraps all UFW operations with best-effort error handling (missing `ufw` binary never crashes the panel).

### 🎮 SteamCMD Integration
- **Automatic installation** — the installer downloads SteamCMD, extracts it to `/opt/steamcmd`, installs 32-bit libraries (`lib32gcc-s1`, `lib32stdc++6`), and runs first-time setup.
- **Helper script** — `/opt/steamcmd/install-game.sh <app_id> <install_dir>` for quick game server installation with common App ID reference.
- **Global symlink** — `/usr/local/bin/steamcmd` for easy command-line access.
- **Skip option** — `--no-steamcmd` flag for Minecraft-only or non-Steam setups.
- **Multi-distro lib32 support** — tries `lib32gcc-s1`, `lib32gcc1`, and `libc6:i386` in order for maximum compatibility.

### 🌐 Caddy Reverse Proxy (replaces Nginx)
- **Replaced Nginx/Certbot** with [Caddy](https://caddyserver.com/) — automatic HTTPS with zero configuration.
- **Single `--caddy` flag** replaces the old `--nginx` + `--ssl` flags.
- **Caddyfile** includes WebSocket support, 256MB upload limit, gzip/zstd compression, and security headers.
- **Graceful failure** — if Caddy can't be installed, the installer warns and continues without it.

### 🔒 Full Game Port Coverage
- Installer now opens UFW ports for **every game in the template library** (27 games):
  - Added: Rust (28015 + 28016 RCON), Satisfactory beacon (15000), 7 Days to Die (26900–26902), Palworld (8211), Enshrouded (15636–15637), Insurgency: Sandstorm (27102 + 27131), Squad (7787), Arma 3 (2302–2306), ET: Legacy / Quake Live (27960), OpenRA (1234), Xonotic (26000), V Rising (9876–9877), Project Zomboid (16261–16262), Factorio (34197), Don't Starve Together (10999–11000), Assetto Corsa (9600).
  - Previously only covered: Source engine, Minecraft, ARK, Valheim.
- **UFW not required** — if `ufw` is not installed (common in LXC containers), the firewall step is skipped with a warning listing ports to open manually.

### 🛡️ SSH Safety
- **Auto-detect SSH port** — reads from `/etc/ssh/sshd_config`, drop-in configs in `/etc/ssh/sshd_config.d/*.conf`, and the active `$SSH_CONNECTION` environment variable.
- **Allow SSH before enabling UFW** — prevents lockouts even on non-standard SSH ports.
- **Dual-port safety** — if the active session is on a different port than sshd_config specifies, both ports are allowed.
- **Port 22 safety net** — port 22 is always allowed in addition to the detected SSH port, preventing lockouts if the detection is wrong.

### 🐧 Debian 13 (Trixie) Support
- **PostgreSQL fallback** — the official PGDG repo uses Bookworm packages that have unmet dependencies on Trixie (`libicu72`); installer now falls back to Debian's built-in PostgreSQL 17 package.
- **Removed `software-properties-common`** — Ubuntu-only package that doesn't exist on Debian; base package install no longer fails silently.
- **Split package installation** — core, build, and security packages installed separately with individual error handling.
- **Container-aware service management** — uses `systemctl` when available, falls back to `service` for non-systemd environments.

### 📦 Installer Reliability
- **Fixed `set -e` silent kills** — all `su -c`, `npm ci`, `npx next build`, `npx drizzle-kit push`, and `grep` pipeline commands now use `|| true` to prevent `set -euo pipefail` from terminating the script before error handling can run.
- **Full `npm ci` with devDependencies** — fixed the `--omit=dev` bug that skipped typescript, tailwindcss, postcss, and drizzle-kit (all required to build). DevDependencies are pruned after the build to save disk.
- **Build verification** — checks for `.next` directory existence instead of exit codes to confirm the build succeeded.
- **Dependency verification** — checks `node_modules/.bin/tsc` exists before attempting the build.
- **Improved error output** — all steps log to `/tmp/gsm-*.log` files; failures display the last 20–40 lines of the relevant log instead of failing silently.
- **Temp server fix** — uses `npx next start` instead of `node .next/standalone/server.js`; health check tries both `127.0.0.1` and `localhost`; 3-second startup delay; proper cleanup with `fuser -k`.

### 🔄 Updater Script
- **One-liner updater** — `bash <(curl -fsSL .../update.sh)` or `gsm update` to update the panel to the latest version.
- **Pre-update backup** — automatically backs up `.env`, `drizzle.config.json`, `ecosystem.config.cjs`, `.install-info`, current git commit, and a full `pg_dump` of the database before updating.
- **Backup rotation** — keeps the last 5 backups in `/opt/gsm-panel-backups/`, prunes older ones automatically.
- **Rollback** — `update.sh --rollback` restores the last backup including config files and git checkout.
- **Changelog preview** — shows new commits before applying the update.
- **Branch support** — `--branch staging` to pull from a non-default branch.
- **Health check** — verifies the panel responds on `/api/health` after restart.
- **`gsm update` command** — added to the `gsm` wrapper so `gsm update` works from any user.

### 🔧 Install Wizard Fix
- **Fixed `POST /api/install` crash** — the settings table query that checks if the panel is already installed now has a try-catch wrapper, so the install wizard works on a completely fresh database where tables don't exist yet.

---

## [1.0.0] — 2026-08-11

### Initial Release
- **Next.js 16 App Router** with TypeScript and Tailwind CSS 4.
- **30+ game templates** — Minecraft (Java, Paper, Bedrock), CS2, TF2, GMod, L4D2, Rust, ARK, Valheim, 7 Days to Die, Palworld, Satisfactory, Terraria, Enshrouded, Insurgency: Sandstorm, Squad, Arma 3, ET: Legacy, OpenRA, Quake Live, Xonotic, V Rising, Project Zomboid, Factorio, Don't Starve Together, Assetto Corsa.
- **Multi-node support** — manage game servers across multiple machines via SSH/API.
- **Real-time monitoring** — CPU, RAM, disk, network metrics with Recharts.
- **RCON console** — remote server management from the browser.
- **File manager** — browse, edit, upload, and download server files.
- **Forum** — categories, threads, posts with user attribution.
- **CMS** — blog posts, changelogs, and static pages.
- **League ladder** — team rankings, standings, and competitive seasons.
- **Database manager** — phpMyAdmin-style table browser and SQL editor.
- **Scheduler** — cron-based automated restarts, backups, and commands.
- **API keys** — token-based API access with per-key permissions.
- **Audit log** — full activity tracking with user, action, entity, and IP.
- **Discord webhooks** — notifications for server start/stop/restart/crash.
- **Email** — SMTP notifications via Nodemailer.
- **2FA** — TOTP two-factor authentication with QR code setup.
- **Roles & permissions** — admin, moderator, user with granular permission flags.
- **5 themes** — Nebula Dark, Cloud Light, Ember Sun, Forest Command, and custom user themes.
- **IPv6 support** — full dual-stack for servers and nodes.
- **Install wizard** — web-based first-run setup with admin account creation.
- **PostgreSQL** via Drizzle ORM with 18 tables.
- **One-liner installer** for Ubuntu 22.04+ and Debian 12+.
