# 🎮 GameServer Manager

**Modern Game Server Hosting Panel** — A self-hosted, open-source alternative to TCAdmin for managing game servers across multiple nodes.

Built with **Next.js 16**, **PostgreSQL**, **Drizzle ORM**, and **Tailwind CSS**.

---

## ⚡ One-Liner Install

Run this on a fresh **Ubuntu 22.04+** or **Debian 12+** server:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/phillgates2/game-server-hosting-cms/main/public/install.sh)
```

The interactive installer will:
- Prompt for admin credentials
- Install **Node.js 22**, **PostgreSQL**, **PM2**
- Install **SteamCMD** with 32-bit libraries for Steam game servers
- Set up the panel with automatic database configuration
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

## 🎮 SteamCMD

The installer automatically sets up [SteamCMD](https://developer.valvesoftware.com/wiki/SteamCMD) for downloading and updating Steam-based game servers.

### What's Installed

- **SteamCMD** at `/opt/steamcmd`
- **32-bit libraries** (`lib32gcc-s1`, `lib32stdc++6`, `libc6-i386`)
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

## 🧰 Management Commands

### Panel

```bash
pm2 status              # View panel status
pm2 logs gsm-panel      # View live logs
pm2 restart gsm-panel   # Restart panel
pm2 stop gsm-panel      # Stop panel
```

### Update to Latest Version

```bash
cd /opt/gsm-panel
git pull
npm ci
npx next build
pm2 restart gsm-panel
```

### Uninstall

```bash
# Keep database, user, SteamCMD, and game servers
sudo bash /opt/gsm-panel/public/uninstall.sh

# Full purge (removes everything)
sudo bash /opt/gsm-panel/public/uninstall.sh --purge

# Purge but keep game server files
sudo bash /opt/gsm-panel/public/uninstall.sh --purge --keep-servers
```

---

## 🚀 Features

| Feature | Description |
|---------|-------------|
| 🖥️ **Multi-Node** | Manage game servers across multiple machines via SSH/API |
| 🎮 **30+ Game Templates** | Minecraft, CS2, Rust, ARK, Valheim, Palworld, Terraria, and more |
| 📊 **Real-Time Monitoring** | CPU, RAM, disk, network metrics with live charts |
| 🔧 **RCON Console** | Remote server management from the browser |
| 📁 **File Manager** | Browse, edit, upload, and download server files |
| 💬 **Forum** | Built-in community forum with categories and threads |
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
# Edit .env with your DATABASE_URL and JWT_SECRET

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
| OS | Ubuntu 22.04+ / Debian 12+ |
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
| `JWT_SECRET` | ⚠️ | JWT signing secret (auto-generated if missing) |
| `PORT` | ❌ | Panel port (default: 3000) |
| `STEAMCMD_PATH` | ❌ | SteamCMD directory (default: /opt/steamcmd) |
| `GAMESERVERS_PATH` | ❌ | Game servers directory (default: /opt/gameservers) |
| `SMTP_HOST` | ❌ | SMTP server for email |
| `SMTP_PORT` | ❌ | SMTP port (default: 587) |
| `SMTP_USER` | ❌ | SMTP username |
| `SMTP_PASS` | ❌ | SMTP password |
| `SMTP_FROM` | ❌ | From email address |

---

## 🔥 Firewall Ports

The installer automatically detects your SSH port (including non-standard ports) and allows it **before** enabling UFW, so you'll never be locked out. It then opens ports for every game in the template library:

| Port | Protocol | Service |
|------|----------|---------|
| Auto-detected | TCP | SSH (reads from `sshd_config` + active session) |
| 80 | TCP | HTTP (Caddy) |
| 443 | TCP | HTTPS (Caddy) |
| 3000 | TCP | Panel (if no Caddy) |
| 25565 | TCP/UDP | Minecraft Java |
| 19132 | UDP | Minecraft Bedrock |
| 27015-27030 | TCP/UDP | Source engine (CS2, TF2, GMod, L4D2) |
| 28015 | TCP/UDP | Rust |
| 28016 | TCP | Rust RCON |
| 7777-7778 | TCP/UDP | ARK / Satisfactory / Terraria |
| 15000 | UDP | Satisfactory beacon |
| 2456-2458 | TCP/UDP | Valheim |
| 26900-26902 | TCP/UDP | 7 Days to Die |
| 8211 | TCP/UDP | Palworld |
| 15636-15637 | TCP/UDP | Enshrouded |
| 27102 | TCP/UDP | Insurgency: Sandstorm |
| 27131 | UDP | Insurgency query |
| 7787 | TCP/UDP | Squad |
| 2302-2306 | UDP | Arma 3 |
| 27960 | TCP/UDP | ET: Legacy / Quake Live |
| 1234 | TCP/UDP | OpenRA |
| 26000 | TCP/UDP | Xonotic |
| 9876-9877 | TCP/UDP | V Rising |
| 16261-16262 | TCP/UDP | Project Zomboid |
| 34197 | UDP | Factorio |
| 10999-11000 | UDP | Don't Starve Together |
| 9600 | TCP/UDP | Assetto Corsa |

To open additional ports:

```bash
sudo ufw allow 12345/tcp
sudo ufw allow 12345/udp
```

---

## 📄 License

MIT

---

<p align="center">
  Built with ❤️ for the game server hosting community
</p>
