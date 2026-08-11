# 🎮 GameServer Manager

**Modern Game Server Hosting Panel** — A self-hosted, open-source alternative to TCAdmin for managing game servers across multiple nodes.

Built with **Next.js 16**, **PostgreSQL**, **Drizzle ORM**, and **Tailwind CSS**.

---

## ⚡ One-Liner Install

Run this on a fresh **Ubuntu 22.04+** or **Debian 12+** server:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/phillgates2/game-server-hosting-cms/main/public/install.sh)
```

The interactive installer will prompt you for an admin username, email, and password, then handle everything else automatically.

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
| `--domain` | Domain for Caddy reverse proxy (e.g., `gs.example.com`) | None (IP access) |
| `--port` | Panel port | `3000` |
| `--db-name` | PostgreSQL database | `gsm_panel` |
| `--db-user` | PostgreSQL user | `gsm` |
| `--db-pass` | PostgreSQL password | Auto-generated |
| `--jwt-secret` | JWT signing secret | Auto-generated |
| `--install-dir` | Installation path | `/opt/gsm-panel` |
| `--caddy` | Set up Caddy reverse proxy with automatic HTTPS | No |
| `-y`, `--noninteractive` | Skip prompts | No |

### What the Installer Does

1. **System packages** — Installs curl, git, build-essential, ufw, fail2ban
2. **Node.js 22** — Via NodeSource repository
3. **PostgreSQL** — Latest from official repo, creates database + role
4. **System user** — Creates a dedicated `gsm` user
5. **Clones repo** — Downloads source to `/opt/gsm-panel`
6. **Environment** — Auto-generates `.env` with secure JWT secret & DB credentials
7. **Build** — Runs `npm ci` and `npx next build`
8. **Database init** — Pushes schema & runs install (admin user, roles, forum categories, seeds)
9. **PM2** — Configures process manager with systemd auto-start
10. **Caddy** — (Optional) Reverse proxy with **automatic HTTPS** via Let's Encrypt — no Certbot needed

---

## 🌐 Caddy Reverse Proxy

The installer uses [Caddy](https://caddyserver.com/) as the reverse proxy. Caddy provides:

- **Automatic HTTPS** — Obtains and renews Let's Encrypt certificates without any extra configuration
- **HTTP/2 & HTTP/3** — Enabled by default
- **Zero-config SSL** — Just point your domain's DNS A record to your server IP and Caddy handles the rest
- **WebSocket support** — Built-in for live logs, RCON console, and real-time monitoring

### Caddyfile Location

```
/etc/caddy/Caddyfile
```

### Caddy Commands

```bash
systemctl status caddy          # Check Caddy status
systemctl restart caddy         # Restart Caddy
caddy validate --config /etc/caddy/Caddyfile  # Validate config
journalctl -u caddy             # View Caddy logs
```

### Manual Caddy Setup

If you installed without `--caddy` and want to add it later:

```bash
# Install Caddy
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy

# Write Caddyfile
sudo tee /etc/caddy/Caddyfile <<EOF
gs.example.com {
    reverse_proxy 127.0.0.1:3000
    encode gzip zstd
}
EOF

# Start Caddy
sudo systemctl enable --now caddy
```

---

## 🧰 Management Commands

```bash
# View panel status
pm2 status

# View live logs
pm2 logs gsm-panel

# Restart panel
pm2 restart gsm-panel

# Stop panel
pm2 stop gsm-panel
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
# Keep database and user
sudo bash /opt/gsm-panel/public/uninstall.sh

# Full purge (removes database, user, Caddy, everything)
sudo bash /opt/gsm-panel/public/uninstall.sh --purge
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

# 2. Configure
cp .env.example .env
# Edit .env with your DATABASE_URL and JWT_SECRET

# 3. Install & build
npm ci
npx next build

# 4. Push database schema
npx drizzle-kit push

# 5. Start
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
| RAM | 1 GB |
| Disk | 10 GB |
| CPU | 1 vCPU |

---

## 🌐 Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `JWT_SECRET` | ⚠️ | JWT signing secret (auto-generated if missing) |
| `PORT` | ❌ | Panel port (default: 3000) |
| `SMTP_HOST` | ❌ | SMTP server for email |
| `SMTP_PORT` | ❌ | SMTP port (default: 587) |
| `SMTP_USER` | ❌ | SMTP username |
| `SMTP_PASS` | ❌ | SMTP password |
| `SMTP_FROM` | ❌ | From email address |

---

## 📄 License

MIT

---

<p align="center">
  Built with ❤️ for the game server hosting community
</p>
