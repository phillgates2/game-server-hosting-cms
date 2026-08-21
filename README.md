# 🎮 GameServer Manager

**Modern Game Server Hosting Panel** — A self-hosted, open-source alternative to TCAdmin for managing game servers across multiple nodes.

Built with **Next.js 16**, **PostgreSQL**, **Drizzle ORM**, and **Tailwind CSS**.

---

## ⚡ One-Liner Install

Run this on a fresh **Ubuntu 22.04+** or **Debian 12+** server (bare-metal, VM, or LXC container):

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/phillgates2/game-server-hosting-cms/main/public/install.sh)
```

The interactive installer will:
- Detect and fix LXC container networking (ASUSTOR, Proxmox, etc.)
- Install **Node.js 22**, **PostgreSQL**, **PM2**
- Install **SteamCMD** with 32-bit libraries for Steam game servers
- Set up the panel with automatic database configuration
- Open firewall ports for every supported game template
- Optionally configure **Caddy** for automatic HTTPS

### Non-Interactive Install

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/phillgates2/game-server-hosting-cms/main/public/install.sh) \
  --admin-user admin \
  --admin-email admin@example.com \
  --admin-pass 'YourSecurePassword123!' \
  --panel-name 'My Game Servers' \
  --domain gs.example.com \
  --caddy \
  -y
```

### Installer Options

| Flag | Description | Default |
|------|-------------|---------|
| `--admin-user` | Admin username | `admin` (prompted) |
| `--admin-email` | Admin email | `admin@localhost` (prompted) |
| `--admin-pass` | Admin password | Prompted (min 8 chars) |
| `--panel-name` | Panel display name | `GameServer Manager` |
| `--domain` | Domain for Caddy reverse proxy | None (IP access) |
| `--port` | Panel port | `3000` |
| `--db-name` | PostgreSQL database | `gsm_panel` |
| `--db-user` | PostgreSQL user | `gsm` |
| `--db-pass` | PostgreSQL password | Auto-generated |
| `--install-dir` | Panel installation path | `/opt/gsm-panel` |
| `--steamcmd-dir` | SteamCMD installation path | `/opt/steamcmd` |
| `--gameservers-dir` | Game servers directory | `/opt/gameservers` |
| `--jwt-secret` | JWT signing secret | Auto-generated |
| `--caddy` | Set up Caddy with automatic HTTPS | No |
| `--no-steamcmd` | Skip SteamCMD installation | No |
| `-y`, `--noninteractive` | Skip prompts | No |

---

## 🐳 LXC / Container Support

The installer automatically detects LXC and Docker containers and fixes a common networking issue found on **ASUSTOR Linux Center**, **Proxmox**, and similar NAS/hypervisor platforms.

### The Problem

NAS platforms like ASUSTOR inject internal gateways (e.g. `10.172.5.1`) into the container's routing table at boot. The real LAN interface can be on **any** interface — not necessarily `eth0`. For example, on ASUSTOR:
- `eth0` = `10.0.3.x` (LXC internal bridge — **not** the real LAN)
- `eth1` = `192.168.50.x` (your real LAN, bridged to your physical NIC)
- ASUSTOR injects `10.172.5.1` as a default via `eth1` (internal management)

This breaks both outbound internet access and **inbound port forwarding** from your router to game servers.

### What the Installer Does

1. **Detects the container** — checks `/proc/1/environ`, `/.dockerenv`, and cgroup markers
2. **Scans all interfaces** — enumerates every interface's IP and scores them:
   - `192.168.x.x` → score 100 (home/office LAN)
   - `172.16–31.x.x` → score 80 (corporate LAN)
   - `10.x.x.x` → score 30 (possible LAN, but could be internal)
   - `10.0.3.x` → score 5 (LXC bridge — almost never the real LAN)
   - `10.172.x.x` → score 2 (ASUSTOR internal — never the real LAN)
3. **Picks the highest-scoring interface** as the LAN device
4. **Forces that interface as default** — `ip route replace default via <GATEWAY> dev <LAN_DEV> metric 10`
5. **Removes competing default routes** on every other interface
6. **Installs a persistent systemd service** — so the fix survives container reboots

### Persistent Boot Fix

The installer creates:
- `/usr/local/bin/fix-container-routing.sh` — runs at boot with a 10-second delay (waits for the NAS platform to finish injecting routes, then overrides them)
- `/etc/systemd/system/fix-container-routing.service` — systemd oneshot service enabled on `multi-user.target`

### Manual Fix (if not using the installer)

```bash
# See current routes and interfaces
ip -4 -o addr show
ip route show default

# Remove the internal gateway (adjust IPs for your setup)
sudo ip route del default via 10.172.5.1 dev eth1

# Force your LAN router as default (adjust interface + IP)
sudo ip route replace default via 192.168.50.1 dev eth1 metric 10
```

---

## 🎮 SteamCMD

The installer automatically sets up [SteamCMD](https://developer.valvesoftware.com/wiki/SteamCMD) for downloading and updating Steam-based game servers.

### What's Installed

- **SteamCMD** at `/opt/steamcmd`
- **32-bit libraries** (`lib32gcc-s1`, `lib32stdc++6`)
- **Helper script** for easy game installation
- **Symlink** at `/usr/local/bin/steamcmd`

### Installing Games with SteamCMD

```bash
# Using the helper script (recommended)
/opt/steamcmd/install-game.sh <app_id> <install_dir>

# Examples:
/opt/steamcmd/install-game.sh 730 /opt/gameservers/cs2        # Counter-Strike 2
/opt/steamcmd/install-game.sh 896660 /opt/gameservers/valheim # Valheim
/opt/steamcmd/install-game.sh 376030 /opt/gameservers/ark     # ARK
/opt/steamcmd/install-game.sh 258550 /opt/gameservers/rust    # Rust
/opt/steamcmd/install-game.sh 2394010 /opt/gameservers/palworld # Palworld

# Or use SteamCMD directly
steamcmd +force_install_dir /opt/gameservers/cs2 +login anonymous +app_update 730 validate +quit
```

### Common Steam App IDs

| App ID | Game |
|--------|------|
| 730 | Counter-Strike 2 |
| 740 | CS:GO (legacy) |
| 896660 | Valheim Dedicated Server |
| 376030 | ARK: Survival Evolved |
| 258550 | Rust Dedicated Server |
| 443030 | Conan Exiles |
| 1007 | DayZ Server |
| 232250 | Team Fortress 2 |
| 4020 | Garry's Mod |
| 294420 | 7 Days to Die |
| 233780 | Arma 3 |
| 2394010 | Palworld |
| 211820 | Starbound |
| 343050 | Don't Starve Together |

### Skip SteamCMD

If you only need non-Steam games (Minecraft, etc.):

```bash
bash install.sh --no-steamcmd
```

---

## 🌐 Caddy Reverse Proxy

The installer uses [Caddy](https://caddyserver.com/) as the reverse proxy:

- **Automatic HTTPS** — Obtains and renews Let's Encrypt certificates
- **HTTP/2 & HTTP/3** — Enabled by default
- **Zero-config SSL** — Just point your DNS A record to your server
- **WebSocket support** — For live logs, RCON console, monitoring

### Caddy Commands

```bash
systemctl status caddy          # Check status
systemctl restart caddy         # Restart
caddy validate --config /etc/caddy/Caddyfile  # Validate config
journalctl -u caddy             # View logs
```

### Caddyfile Location

```
/etc/caddy/Caddyfile
```

---

## 🔥 Automatic Firewall Management

### Installer — Opens All Game Ports

The installer detects your SSH port (including non-standard ports) and allows it **before** enabling UFW. It then opens TCP+UDP for every game in the template library:

| Port | Protocol | Service |
|------|----------|---------|
| Auto-detected | TCP | SSH (reads `sshd_config` + active session) |
| 80 | TCP | HTTP (Caddy) |
| 443 | TCP | HTTPS (Caddy) |
| 3000 | TCP | Panel (if no Caddy) |
| 25565 | TCP/UDP | Minecraft Java |
| 19132 | UDP | Minecraft Bedrock |
| 27015–27030 | TCP/UDP | Source engine (CS2, TF2, GMod, L4D2) |
| 28015 | TCP/UDP | Rust |
| 28016 | TCP | Rust RCON |
| 7777–7778 | TCP/UDP | ARK / Satisfactory / Terraria |
| 15000 | UDP | Satisfactory beacon |
| 2456–2458 | TCP/UDP | Valheim |
| 26900–26902 | TCP/UDP | 7 Days to Die |
| 8211 | TCP/UDP | Palworld |
| 15636–15637 | TCP/UDP | Enshrouded |
| 27102 | TCP/UDP | Insurgency: Sandstorm |
| 27131 | UDP | Insurgency query |
| 7787 | TCP/UDP | Squad |
| 2302–2306 | UDP | Arma 3 |
| 27960 | TCP/UDP | ET: Legacy / Quake Live |
| 1234 | TCP/UDP | OpenRA |
| 26000 | TCP/UDP | Xonotic |
| 9876–9877 | TCP/UDP | V Rising |
| 16261–16262 | TCP/UDP | Project Zomboid |
| 34197 | UDP | Factorio |
| 10999–11000 | UDP | Don't Starve Together |
| 9600 | TCP/UDP | Assetto Corsa |

> **Containers:** UFW is **never enabled** inside LXC/Docker containers. The host OS and your router manage the firewall — enabling UFW inside a container conflicts with the host's iptables/nftables and will drop SSH connections. The installer detects containers and skips the UFW step entirely, printing a reminder of which ports to forward on your router instead.
>
> **Bare-metal / VM:** UFW is configured and enabled. Port 22 is always allowed as a safety net even if SSH is on a non-standard port.

### Runtime — Dynamic Port Management

When you create, update, or delete game servers through the panel, firewall rules are **automatically managed**:

- **Create server** → `ufw allow <port>/tcp` + `ufw allow <port>/udp` (game port, query port, RCON port)
- **Change server port** → old port rules removed, new port rules added
- **Delete server** → port rules cleaned up

Each rule is tagged with `GSM:<serverId> <serverName>` so `ufw status` shows which server owns which port.

### Firewall API

Admins can view and manage firewall rules from the panel:

```
GET  /api/firewall          # View UFW status + panel-managed rules
POST /api/firewall          # Manually allow/deny a port
     { "action": "allow", "port": 27015, "comment": "My server" }
```

To open additional ports manually:

```bash
sudo ufw allow 12345/tcp
sudo ufw allow 12345/udp
```

---

## 🗨️ Sandbox Chat

The **Forum** section includes a built-in real-time chat box — a community shoutbox where users can have quick conversations without creating forum threads.

### Features

- **Real-time messaging** — polls every 2.5 seconds for new messages via incremental `?after=<id>` queries
- **Active user indicator** — shows how many users chatted in the last 5 minutes
- **Unread badge** — minimized chat shows an unread message counter
- **Collapsible** — click the header to minimize/expand the chat
- **Auto-scroll** — scrolls to new messages unless user is reading history
- **Role badges** — admin and moderator badges displayed next to usernames
- **Message moderation** — admins/mods can delete any message; users can delete their own
- **Responsive** — sidebar on xl+ screens, stacked on mobile
- **1000 char limit** — server-validated message length

### Chat API

```
GET    /api/forum/chat              # Fetch messages (?after=<id>&limit=<n>)
POST   /api/forum/chat              # Send message { "body": "Hello!" }
DELETE /api/forum/chat              # Delete message { "messageId": 123 }
```

All endpoints require authentication via the `gsm_token` cookie.

---

## 🧰 Management Commands

### Panel

```bash
pm2 status              # View panel status
pm2 logs gsm-panel      # View live logs
pm2 restart gsm-panel   # Restart panel
pm2 stop gsm-panel      # Stop panel
```

### Update to Latest Version

One-liner (from any server):
```bash
bash <(curl -fsSL https://raw.githubusercontent.com/phillgates2/game-server-hosting-cms/main/public/update.sh)
```

Or use the `gsm` command:
```bash
gsm update
```

Or from the install directory:
```bash
sudo bash /opt/gsm-panel/public/update.sh
```

The updater will:
1. **Backup** — saves `.env`, configs, database dump, and current git commit
2. **Pull** — fetches latest code from GitHub
3. **Install** — runs `npm ci` with devDependencies
4. **Migrate** — applies any new database schema changes via `drizzle-kit push`
5. **Build** — runs `npx next build`
6. **Prune** — removes devDependencies after build
7. **Restart** — restarts via PM2 and verifies health check

### Updater Options

| Flag | Description |
|------|-------------|
| `--force` | Skip confirmation prompts |
| `--no-backup` | Skip pre-update backup |
| `--branch NAME` | Pull from a specific branch (default: `main`) |
| `--rollback` | Restore the last backup |

### Rollback

If an update breaks something:
```bash
sudo bash /opt/gsm-panel/public/update.sh --rollback
```

This restores the `.env`, configs, and git commit from the last backup. Backups include a full database dump. The last 5 backups are kept automatically.

### Uninstall

```bash
# Keep database, user, SteamCMD, and game servers
sudo bash /opt/gsm-panel/public/uninstall.sh

# Full purge (removes everything)
sudo bash /opt/gsm-panel/public/uninstall.sh --purge

# Purge but keep game server files
sudo bash /opt/gsm-panel/public/uninstall.sh --purge --keep-servers

# Non-interactive, or for a panel installed outside /opt/gsm-panel
sudo bash /opt/gsm-panel/public/uninstall.sh --purge -y
sudo bash /opt/gsm-panel/public/uninstall.sh --install-dir /srv/gsm
```

| Flag | Description |
|------|-------------|
| `--purge` | Also drop the database, remove the `gsm` user, Caddy, and SteamCMD |
| `--keep-servers` | Keep `/opt/gameservers` when purging |
| `--install-dir` | Panel directory to remove (default: `/opt/gsm-panel`) |
| `-y`, `--yes` | Skip the confirmation prompt |

---

## 🚀 Features

| Feature | Description |
|---------|-------------|
| 🖥️ **Multi-Node** | Manage game servers across multiple machines via SSH/API |
| 🎮 **27 Game Templates** | Minecraft, CS2, Rust, ARK, Valheim, Palworld, Terraria, and more — 1,551 configurable options, fully typed and validated |
| 📊 **Real-Time Monitoring** | CPU, RAM, disk, network metrics with live charts |
| 🔧 **RCON Console** | Remote server management from the browser |
| 📁 **File Manager** | Browse, edit, upload, and download server files |
| 💬 **Forum** | Built-in community forum with categories and threads |
| 🗨️ **Sandbox Chat** | Real-time chat box in the forum section with live polling, unread badges, and moderation |
| 📝 **CMS** | Blog posts, changelogs, and static pages |
| 🏆 **League Ladder** | Team rankings and competitive standings |
| 🗄️ **Database Manager** | phpMyAdmin-style database browser and SQL editor |
| ⏰ **Scheduler** | Cron-based automated restarts, backups, and commands |
| 🔑 **API Keys** | Token-based API access for external integrations |
| 📋 **Audit Log** | Full activity tracking for security |
| 🔔 **Discord** | Webhook notifications for server start/stop/crash |
| 📧 **Email** | SMTP notifications via Nodemailer |
| 🔐 **2FA** | Two-factor authentication (TOTP) |
| 👥 **Roles & Permissions** | Granular role-based access control |
| 🎨 **Themes** | 5 built-in themes + custom theme editor |
| 🌐 **IPv6** | Full IPv6 support for servers and nodes |
| 🛡️ **Install Wizard** | Web-based first-run setup |
| 🔥 **Auto Firewall** | Ports opened/closed automatically when servers are created/deleted |
| 🐳 **LXC/Container Support** | Auto-fixes NAS container networking for port forwarding |

---

## 🔧 Manual Installation

If you prefer manual setup:

```bash
# 1. Clone
git clone https://github.com/phillgates2/game-server-hosting-cms.git
cd game-server-hosting-cms

# 2. Install SteamCMD (optional, for Steam games)
sudo dpkg --add-architecture i386
sudo apt update
sudo apt install lib32gcc-s1 lib32stdc++6
mkdir -p /opt/steamcmd && cd /opt/steamcmd
curl -fsSL https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz | tar -xz
./steamcmd.sh +quit

# 3. Configure
cp .env.example .env
# Edit .env and set DATABASE_URL, then generate a JWT_SECRET:
#   openssl rand -hex 32
# JWT_SECRET is mandatory in production — the panel refuses to start without it.

# 4. Install & build
npm ci
npx next build

# 5. Push database schema
npx drizzle-kit push

# 6. Start
npm start
# Or with PM2:
pm2 start npm --name gsm-panel -- start
```

Then visit `http://your-server:3000` to complete setup via the install wizard.

---

## 📋 Requirements

| Requirement | Minimum |
|-------------|---------|
| OS | Ubuntu 22.04+ / Debian 12+ (incl. Debian 13 Trixie) |
| Platform | Bare-metal, VM, LXC container (ASUSTOR, Proxmox, etc.) |
| Node.js | 22.x |
| PostgreSQL | 14+ |
| RAM | 2 GB (more for game servers) |
| Disk | 20 GB (more for game servers) |
| CPU | 1 vCPU |

---

## 🌐 Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `JWT_SECRET` | ✅ | JWT signing secret, **min 32 characters**. Required in production — the panel exits at startup if unset. Generate with `openssl rand -hex 32`. In development a random per-process secret is used instead (sessions drop on restart) |
| `PORT` | ❌ | Panel port (default: 3000) |
| `STEAMCMD_PATH` | ❌ | SteamCMD directory (default: /opt/steamcmd) |
| `GAMESERVERS_PATH` | ❌ | Game servers directory (default: /opt/gameservers) |
| `SMTP_HOST` | ❌ | SMTP server for email |
| `SMTP_PORT` | ❌ | SMTP port (default: 587) |
| `SMTP_USER` | ❌ | SMTP username |
| `SMTP_PASS` | ❌ | SMTP password |
| `SMTP_FROM` | ❌ | From email address |
| `DISCORD_WEBHOOK_URL` | ❌ | Default Discord webhook for server notifications |

Copy `.env.example` to `.env` as a starting point — it documents every variable above.

> **Upgrading an existing install?** `JWT_SECRET` used to be optional and was
> auto-generated at runtime if missing. It is now **required in production**.
> Deployments made with `install.sh` are unaffected: the installer already
> generates a 62-character secret and writes it to `.env`. Only manual installs
> that never set the variable need to add one before upgrading.

---

## ✅ Verification & Quality Gates

The repo ships with four checks, wired together behind a single command:

```bash
npm run verify
```

| Script | What it checks |
|--------|----------------|
| `npm run typecheck` | `tsc --noEmit` across the whole project |
| `npm run lint` | ESLint, including the React hooks rules |
| `npm run verify:templates` | Every game template: option types, enum values, defaults, and that each declared variable is actually consumed by the install script, config files, or start command |
| `npm run verify:security` | 33 regression checks covering the fixes from the security audit — path traversal containment, backup-name allowlisting, SQL identifier quoting, and JWT secret policy |

All four must pass before a release. `npm run verify` exits non-zero on the
first failure, so it drops straight into CI.

Building the app requires the environment to be populated, since route modules
connect at import time:

```bash
DATABASE_URL="postgres://user:pass@127.0.0.1:5432/gsm" \
JWT_SECRET="$(openssl rand -hex 32)" \
npx next build
```

---

## 🐞 Installer Debug Logs

If the installer fails at any step, check these log files on the server:

| File | Step |
|------|------|
| `/tmp/gsm-apt-core.log` | System packages |
| `/tmp/gsm-nodesource.log` | Node.js repo setup |
| `/tmp/gsm-nodejs-install.log` | Node.js installation |
| `/tmp/gsm-pm2-install.log` | PM2 installation |
| `/tmp/gsm-postgresql-install.log` | PostgreSQL installation |
| `/tmp/gsm-steamlibs.log` | SteamCMD 32-bit libraries |
| `/tmp/gsm-npm-install.log` | npm dependencies |
| `/tmp/gsm-drizzle-push.log` | Database schema push |
| `/tmp/gsm-next-build.log` | Next.js production build |
| `/tmp/gsm-caddy-install.log` | Caddy installation |
| `/tmp/gsm-temp-server.log` | Temporary server (install API) |

---

## 📄 License

MIT

---

<p align="center">
  Built with ❤️ for the game server hosting community
</p>
