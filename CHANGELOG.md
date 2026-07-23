# Changelog

All notable changes to GameServer Manager are documented in this file.

---

## [2.1.0] — 2026-07-21

### Changed
- **All 27 install scripts rewritten to use Pterodactyl-style patterns**
  - **19 SteamCMD games** now use the proven Pterodactyl pattern:
    - Downloads SteamCMD to a local directory inside the server path
    - Sets `HOME` and ownership for non-root compatibility
    - Installs via `steamcmd.sh +force_install_dir +login anonymous +app_update`
    - Copies Steam SDK libraries to `.steam/sdk32` and `.steam/sdk64`
    - No more global `/usr/local/bin/steamcmd` wrapper needed
  - **Minecraft Java** — Uses Mojang version manifest API with proper JSON parsing
  - **Minecraft Paper** — Uses PaperMC API v2 with version/build resolution
  - **Minecraft Bedrock** — Direct download from Mojang CDN with fallback URL
  - **Terraria/TShock** — GitHub Releases API with Linux-specific asset detection
  - **Factorio** — Direct headless download with initial world creation
  - **Xonotic** — Direct download from dl.xonotic.org
  - **ET:Legacy** — Architecture-detected archive download (x86_64/aarch64/i386)
  - **OpenRA** — GitHub release with AppImage extraction fallbacks

### Fixed
- SteamCMD is no longer installed globally — each server gets its own copy inside the install directory, eliminating all permission and PATH issues
- Shell variable escaping fixed in all template literals (`${VAR}` properly escaped inside JS backtick strings)

---

## [2.2.0] — 2026-07-23

### Fixed
- **Full seed binary audit** across all 27 built-in templates
- Corrected broken placeholder substitution in 19 SteamCMD templates (`{{INSTALL_PATH}}`)
- Corrected runtime binary/start paths to match upstream templates:
  - CS2 → `game/bin/linuxsteamrt64/cs2`
  - Satisfactory → `Engine/Binaries/Linux/*-Linux-Shipping`
  - Squad → `SquadGame/Binaries/Linux/SquadGameServer`
  - Assetto Corsa → `AssettoServer`
- Added explicit expected-artifact verification for every built-in seed
  - supports exact paths, wildcard paths, and alternative paths
  - install now fails clearly if the expected runtime file is missing
- ET:Legacy and OpenRA verification hardened with explicit artifact checks

---

## [2.0.0] — 2026-07-21

### Added
- **📥 Pterodactyl Egg & AMP Template Import** — Paste JSON from external repositories directly into the panel
  - Auto-detects format (Pterodactyl `PTDL_v2` or AMP `Meta.DisplayName` / `App.DisplayName`)
  - Pterodactyl import parses: name, startup, install script, variables → default config, stop command
  - AMP import parses: DisplayName, ExecutableLinux, CommandLineArgs, MaxUsers, ExitString, SupportsIPv6
  - Import tab in Games panel with format selector and JSON paste area
  - Links to source repos: `pelican-eggs/eggs` and `CubeCoders/AMPTemplates`
  - `POST /api/games/import` — Import endpoint with format auto-detection
- **Unified variable format** — Supports both Pterodactyl and AMP variable fields in one interface
  - Core: `env_variable`, `default_value`, `user_viewable`, `user_editable`, `rules`, `field_type`
  - AMP extensions: `category`, `subcategory`, `keywords`, `enum_values`, `min_value`, `max_value`, `param_field_name`
  - `enum_values` enables select/dropdown fields (`{ "value": "label" }`)
  - `min_value` / `max_value` for numeric range validation
  - `param_field_name` for binding variables to config file keys
- Games panel now has 4 tabs: **Installed**, **Templates**, **+ Custom**, **📥 Import**

---

## [1.9.0] — 2026-07-21

### Added
- **Pterodactyl/AMP-compatible variable format** — All 27 game templates now use the Pterodactyl egg variable structure
  - `env_variable` — Environment variable name (e.g., `QUERY_PORT`)
  - `default_value` — Default value for the variable
  - `user_viewable` — Whether users can see this variable
  - `user_editable` — Whether users can change it
  - `rules` — Laravel-style validation: `required|integer|between:1,65535`, `nullable|string|max:256`, etc.
  - `field_type` — Input type: `text`, `number`, `password`, `select`, `checkbox`
- Variable detail view in template browser now shows rules, field type, viewable/editable badges
- Compatible with Pterodactyl game-eggs repository format for variable definitions

### Changed
- All 58 variable definitions across 27 templates migrated from legacy `{ key, defaultValue, required, type }` to Pterodactyl-style `{ env_variable, default_value, user_viewable, user_editable, rules, field_type }`
- `V()` helper function generates Pterodactyl-compatible variable objects from a compact shorthand

---

## [1.8.0] — 2026-07-21

### Added
- **🎮 Template Editor** — Full UI for editing, creating, and managing game templates
  - **Edit installed games** — Change name, install script, start/stop commands, config files, default config, port, engine, icon, IPv6 support
  - **Create custom templates** — Build game definitions from scratch with the same editor
  - **Inline script editor** — Dark monospace editor for install scripts and start commands
  - **Variable reference** — Shows all available `{{VARIABLE}}` placeholders in the editor
  - **Config file editor** — JSON editors for `configFiles` and `defaultConfig` maps
  - Three-tab layout: Installed (with Edit), Templates (built-in library), + Custom (create new)
  - `GET /api/games/[id]` — Get full game definition
  - `PATCH /api/games/[id]` — Edit installed game (name, scripts, config, etc.)
  - `POST /api/games/custom` — Create fully custom game template
  - Requires `games.install` permission
- **▶ Real Process Start/Stop** — Game servers now launch as actual background processes
  - `POST /api/servers/[id]/process` — Start, stop, restart, or check status
  - Uses `gsm-start.sh` generated by Install Files
  - Spawns detached process, records PID, pipes output to `gsm-server.log`
  - Stop sends SIGTERM then SIGKILL after 5s
  - Restart kills existing process then starts fresh
  - Status checks if PID is alive and syncs DB
  - Discord webhook on start/stop/restart
  - Buttons: ▶ Start, ⏹ Stop, 🔄 Restart (context-dependent)

### Changed
- Install Files now always uses the **latest built-in template** from code (not stale DB copies)
- Install Files generates `gsm-start.sh`, `gsm-stop.sh`, `gsm-server.env`, config files, and `GSM-README.txt`
- SteamCMD auto-install falls back to `~/bin/steamcmd` for non-root users
- Wrapper shebang changed from `#!/usr/bin/env sh` to `#!/usr/bin/env bash` (fixes dash/bash incompatibility)
- ET:Legacy template uses tar.gz archive with architecture auto-detection instead of `.sh` binary

---

## [1.6.0] — 2026-07-21

### Added
- **📂 Web-Based File Manager** — Full browser-based server file management (SFTP-like experience without a separate client)
  - Browse server directories with breadcrumbs
  - Create files and folders
  - Upload files via browser (`multipart/form-data`)
  - Download files as attachments
  - Rename and delete files/folders inline
  - Built-in text editor for common config/script/log files
  - `Ctrl+S` save shortcut in the editor
  - Binary/large-file safety — files over 2MB are download-only
  - File-type icons for configs, scripts, archives, images, binaries, etc.
  - `GET /api/servers/[id]/files` — List/read/download files
  - `POST /api/servers/[id]/files` — Save/create/rename/delete
  - `POST /api/servers/[id]/files/upload` — Upload files
  - Requires `servers.files` permission

### Changed
- **Local-node game server path behavior**
  - New local nodes default to `~/gameservers` for non-root panel installs
  - Root installs still default to `/opt/gameservers`
  - Existing local servers using `/opt/gameservers/...` are auto-migrated to a writable home-directory path during **Install Files** if the panel is not running as root

### Fixed
- Clearer install-path permission errors with actionable remediation commands
- Local server creation now rewrites non-root `/opt/gameservers/...` paths to writable home-directory paths automatically

---

## [1.5.0] — 2026-07-21

### Added
- **🖥️ Full RCON Console** — Send remote commands to game servers from the panel
  - Source RCON protocol (TCP) for CS2, TF2, GMod, Minecraft, ARK, Valheim, and 30+ games
  - UDP RCON protocol for Wolfenstein ET, Quake Live, Xonotic
  - WebRCON protocol (HTTP) for Rust
  - Auto-protocol detection based on game template
  - Terminal-style UI with dark theme, colored output, timestamps, response timing
  - Command history with Arrow Up/Down navigation (100 entries)
  - Game-specific quick command buttons (status, save, list players, etc.)
  - Multi-packet response reassembly
  - `GET /api/servers/[id]/rcon` — Connection info endpoint
  - `POST /api/servers/[id]/rcon` — Command execution endpoint
  - Requires `servers.console` permission

---

## [1.4.0] — 2026-07-21

### Added
- **🔑 Advanced Permissions System** — 40+ granular permissions across 10 categories
  - Custom role creation with name, display name, color picker, icon, priority
  - Per-permission toggles with "Select all / Deselect all" per category
  - Three system roles seeded on install: Administrator, Moderator, User
  - Permission-aware sidebar — tabs hidden if user lacks permission
  - `roles` database table with `permissions` JSONB column
  - In-memory permission cache with 30-second TTL
  - `GET /api/roles` — List roles with user counts and permission definitions
  - `POST /api/roles` — Create custom role
  - `PATCH /api/roles/[id]` — Edit role permissions
  - `DELETE /api/roles/[id]` — Delete non-system roles
  - `GET /api/auth/permissions` — Get current user's permissions
- **👥 Comprehensive User Management**
  - Admin Users panel with search, role/status badges, server counts, login tracking
  - Inline edit: change role, status, max servers, email, reset password
  - Quick suspend/activate buttons
  - User profile panel for all users: edit bio, location, website, change password
  - My Servers list, forum post count, security info (2FA status, last login IP)
- **💬 Forum Upgrades**
  - User profiles in posts: avatar, role badge, post count, join date, location
  - Post quoting with `>` blockquote rendering
  - Post editing and deletion (own posts or moderator)
  - Thread pinning, locking, deletion (moderator/admin)
  - Reply counts per thread, thread/post counts per category
  - Post numbering (#1, #2, #3) and "(edited)" indicator
  - `PATCH /api/forum/threads/[id]` — Pin, lock, edit title
  - `DELETE /api/forum/threads/[id]` — Delete thread + posts
  - `PATCH /api/forum/posts/[id]` — Edit post
  - `DELETE /api/forum/posts/[id]` — Delete post
- **User schema expanded** — status, bio, location, website, 2FA fields, max_servers, last_login_at, last_login_ip, login_count
- **Login tracking** — IP, timestamp, count tracked on every login
- **Suspended/banned users** — Cannot log in, shown specific error message

---

## [1.3.0] — 2026-07-21

### Added
- **🌐 Public CMS Site** — Full public-facing website at root URL
  - Hero section, feature cards, blog posts, changelogs
  - Navigation: Home, Blog, Changelog, Login button
  - Single-post view with tags, author, date
  - Everything at one URL — installer → public site → admin panel (no `/panel` subfolder)
- **✍️ CMS System** — Blog posts, changelogs, and pages
  - `cms_pages` database table with slug, type, excerpt, tags, pinned, published
  - Create, edit, delete, publish/unpublish from admin panel
  - Filter by type (Blog, Changelog, Page) with counts
  - `GET/POST /api/cms` — List and create posts
  - `GET/PATCH/DELETE /api/cms/[slug]` — Single post operations

### Changed
- Login button on public site switches to login form in-place (no navigation)
- After logout, returns to public site instead of login form
- Installer completion shows "Go to Login" button

---

## [1.2.0] — 2026-07-21

### Added
- **🎮 Game File Installation** — Install actual game server files on nodes
  - `POST /api/servers/[id]/install` — Runs game template install script
  - Template variable substitution (`{{PORT}}`, `{{INSTALL_PATH}}`, etc.)
  - Install log modal with full stdout/stderr output
  - Status tracking: stopped → installing → stopped/install_failed
  - Local node direct execution, remote node agent API support
- **Install script header** — Prints game name, server name, path, node before running

### Fixed
- **Bash path detection** — `findBash()` checks `/bin/bash`, `/usr/bin/bash`, `/usr/local/bin/bash` (Debian 13 compatibility)
- **Shebang** — Changed to `#!/usr/bin/env bash` for portability
- **ET:Legacy install script** — Fixed: was using `.tar.gz` extraction on a `.sh` installer file. Now uses `--noexec --target` extraction and downloads assets from `mirror.etlegacy.com`
- **OpenRA install script** — Added fallback for AppImage extraction without FUSE
- **SteamCMD install block** — Fixed in all 19 game templates: installs 32-bit libs, uses wrapper script instead of broken symlink

---

## [1.1.0] — 2026-07-21

### Added
- **🖥️ Multi-Node Support** — Manage game servers across multiple machines
  - `nodes` and `node_metrics` database tables
  - Add local node (auto-detects hostname, IP, RAM, disk)
  - Add remote nodes with SSH config, location, provider
  - Node heartbeat API for health metrics
  - Server creation requires node selection
  - `GET/POST /api/nodes`, `GET/PATCH/DELETE /api/nodes/[id]`
  - `POST /api/nodes/[id]/heartbeat`, `POST /api/nodes/local`
- **🔔 Discord Webhooks** — Server event notifications
  - Per-server webhook URL with event toggles (start, stop, restart, crash)
  - Colored embeds per event type, rate-limited queue
  - Test webhook button on each server
  - `POST /api/discord/test`
- **📦 Template-Based Game System** — Games not auto-seeded
  - 30+ game templates stored in code, install on-demand
  - Template variables with types, descriptions, defaults
  - `GET /api/templates`, `GET /api/templates/[slug]`
  - `POST/DELETE /api/templates/[slug]/install`
- **🧹 RAM Buffer Management** — Rewritten clear-buffers endpoint
  - Direct `writeFile` to `/proc/sys/vm/drop_caches` (avoids shell redirect)
  - 3-tier attempt: direct write → sudo tee → sh redirect
  - Swap clear with `swapoff -a && swapon -a`
  - Memory compaction via `/proc/sys/vm/compact_memory`
  - Before/after reporting with freed MB stats

### Fixed
- **Secure cookie over HTTP** — `getCookieOptions()` detects HTTPS via `x-forwarded-proto` instead of trusting `NODE_ENV`. Fixes blank page after login when accessing via HTTP.
- **SteamCMD wrapper script** — Replaced broken `ln -sf` symlink with `cd /opt/steamcmd && exec ./steamcmd.sh` wrapper

---

## [1.0.0] — 2026-07-21

### Initial Release
- **🎮 Game Server Management** — CRUD for game server instances
- **📊 Server Monitoring** — CPU, RAM, disk, network from `/proc/*`
- **💬 Forum System** — Categories, threads, posts
- **🗄️ Database Manager** — Table browser, row editor, SQL query tool
- **🔐 Authentication** — JWT + bcrypt, role-based access
- **🎨 Dark Theme** — Modern dark UI with Tailwind CSS 4
- **🚀 Web Installer** — 3-step setup wizard
- **🌐 IPv6 Support** — Dual-stack networking
- **Error Boundaries** — Per-panel crash isolation
- **📖 README** — Full installation guide for fresh Ubuntu/Debian servers

### Tech Stack
- Next.js 16, React 19, TypeScript 5.9
- PostgreSQL + Drizzle ORM
- Tailwind CSS 4
- bcryptjs, jsonwebtoken
