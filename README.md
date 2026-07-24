<p align="center">
  <h1 align="center">🎮 GameServer Manager</h1>
  <p align="center">
    <strong>Modern, open-source game server hosting panel</strong><br/>
    A full-featured TCAdmin / Pterodactyl alternative built with Next.js, PostgreSQL, and Tailwind CSS
  </p>
  <p align="center">
    <a href="https://github.com/phillgates2/game-server-hosting-cms">Repository</a> ·
    <a href="#-quick-start">Quick Start</a> ·
    <a href="#-features">Features</a> ·
    <a href="#-screenshots">Screenshots</a> ·
    <a href="#-api-reference">API Reference</a>
  </p>
</p>

---

## ⚡ At a Glance

| | |
|---|---|
| **60 API routes** | Full REST API for every panel feature |
| **27 game templates** | Minecraft, CS2, Rust, ARK, Valheim, ET:Legacy, and more |
| **18 panel sections** | Servers, Files, RCON, Nodes, Games, Monitor, Forum, CMS, Users, Roles, Audit, Scheduler, API Keys, Database, and more |
| **40+ permissions** | Granular role-based access across 10 categories |
| **8 languages** | English, Spanish, German, French, Portuguese, Japanese, Chinese, Russian |
| **Dark + Light theme** | Toggle with persistence, full CSS variable swap |
| **Mobile responsive** | Hamburger sidebar, touch-friendly, works on phones |

---

## ✨ Features

### 🎮 Server Management
- **Create servers** with a guided 3-step wizard and game-specific settings
- **Start / Stop / Restart** with real process control (PID tracking, crash detection)
- **Install game files** from 27 Pterodactyl-style templates with verified binaries
- **Update servers** — one-click SteamCMD `app_update` without full reinstall
- **Backup & Restore** — timestamped `.tar.gz` archives with one-click restore
- **Clone servers** — duplicate with all settings and a new port
- **Server Console** — live log viewer with auto-refresh every 3 seconds
- **Uptime tracking** — shows how long each server has been running
- **Bulk actions** — select multiple servers and Start/Stop/Install all at once
- **Auto-restart on crash** — polls running servers every 15 seconds

### 📂 File Manager
- Browse, upload, download, rename, delete server files
- In-browser text editor for configs with Ctrl+S save
- Binary-safe — large/binary files are download-only

### 🖥️ RCON Console
- Source RCON (TCP), UDP RCON, WebRCON protocols
- Auto-detection per game template
- Terminal UI with command history and game-specific quick commands

### 🌐 Multi-Node
- Local and remote server nodes
- Auto-detection of hostname, IP, RAM, disk
- Heartbeat API for remote node health metrics
- Node editing — change paths, limits, SSH settings

### 📦 Game Templates
- 27 built-in templates with Pterodactyl-style install scripts
- AMP/Pterodactyl variable format with dropdowns, checkboxes, passwords
- Import from Pterodactyl eggs or AMP templates
- Create custom templates with full script editor
- Template audit tool with live binary verification

### 🔑 Permissions & Roles
- 40+ granular permissions across 10 categories
- Custom role creation with color, icon, priority
- Permission-aware sidebar — tabs hidden if user lacks access
- Three system roles: Administrator, Moderator, User

### 👥 Users
- User profiles with bio, location, website
- Login tracking (IP, timestamp, count)
- Suspend/ban accounts
- Per-user server limits
- Password change with current-password verification

### 💬 Forum
- Categories with thread/post counts
- User profiles in posts (role badge, post count, join date)
- Quoting, editing, deleting, pinning, locking
- Moderator permissions

### ✍️ CMS
- Blog posts, changelogs, and pages
- Publish/draft toggle, pinning, tags
- Public site shows blog and changelogs to visitors

### 📊 Monitoring
- Real-time CPU, RAM, disk, network from `/proc/*`
- RAM buffer/cache management with one-click clearing
- IPv6 status detection
- Historical resource charts

### 🔔 Discord Webhooks
- 13 event types (start, stop, crash, install, backup, clone, login, etc.)
- Per-server webhook URL with event toggles
- Colored embeds with game icons

### ⏰ Scheduler
- Cron-based scheduled restarts, backups, updates, commands
- 6 preset schedules (hourly, daily, weekly, etc.)
- Enable/disable per task

### 🔐 Security
- JWT authentication with bcrypt password hashing
- Two-Factor Authentication (TOTP) with QR code setup
- API key system for external tools/scripts
- Secure cookie handling (HTTP/HTTPS auto-detection)

### 🗄️ Database Manager
- Browse tables, view structure, edit rows inline
- Full SQL query editor with Ctrl+Enter execution
- Like phpMyAdmin, built into the panel

### 📋 Activity Log
- Full audit trail — who did what and when
- Action icons, user info, IP address, timestamps

### ⚙️ Panel Settings
- Export/Import configuration as JSON
- Email notifications (SMTP) with built-in templates
- Dark/Light theme toggle with persistence
- 8-language localization

---

## 🖥️ Fresh Server Installation Guide

> Tested on Ubuntu 22.04+, Debian 12+/13. Run all commands as a regular user with `sudo` access.

### Step 1 — System Packages

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git build-essential unzip wget gnupg ca-certificates
```

### Step 2 — Install Node.js 22 LTS

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Verify
node --version   # v22.x.x
npm --version    # 10.x.x
```

### Step 3 — Install PostgreSQL

```bash
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable postgresql
sudo systemctl start postgresql

# Set a password once and reuse it below and in the .env file later
export DB_PASS='CHANGE_THIS_PASSWORD'

# Create database and user
sudo -u postgres psql -c "CREATE USER gsmadmin WITH PASSWORD '${DB_PASS}';"
sudo -u postgres psql -c "CREATE DATABASE gameserver_db OWNER gsmadmin;"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE gameserver_db TO gsmadmin;"

# Optional: verify the account works
PGPASSWORD="$DB_PASS" psql -h 127.0.0.1 -U gsmadmin -d gameserver_db -c 'select 1;'
```

### Step 4 — Install SteamCMD *(optional — for Steam games)*

```bash
# 1. Install 32-bit libraries (SteamCMD is a 32-bit application)
sudo dpkg --add-architecture i386
sudo apt update
sudo apt install -y lib32gcc-s1 lib32stdc++6 ca-certificates

# 2. Create directory, download, and extract SteamCMD
sudo mkdir -p /opt/steamcmd
cd /opt/steamcmd
sudo curl -sqL "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz" | sudo tar xzf -

# 3. Set ownership to YOUR user (NOT root — this prevents permission errors)
sudo chown -R $USER:$USER /opt/steamcmd

# 4. Set executable permissions
chmod +x /opt/steamcmd/steamcmd.sh
chmod +x /opt/steamcmd/linux32/steamcmd

# 5. Create a wrapper script
#    SteamCMD MUST run from /opt/steamcmd — a symlink does NOT work.
#    This wrapper cd's into the correct directory before running.
sudo bash -c 'cat > /usr/local/bin/steamcmd << "WRAPPER"
#!/bin/bash
cd /opt/steamcmd && exec ./steamcmd.sh "$@"
WRAPPER'
sudo chmod +x /usr/local/bin/steamcmd

# 6. Create package directory with correct permissions
mkdir -p /opt/steamcmd/package

# 7. First run — DO NOT use sudo!
#    Downloads ~40MB of updates. May take a few minutes.
cd /opt/steamcmd
./steamcmd.sh +quit
```

> Skip this step if you only want non-Steam games (Minecraft, Terraria, Factorio, etc.).

### Step 5 — Clone & Install the Panel

```bash
cd /opt
sudo git clone https://github.com/phillgates2/game-server-hosting-cms.git gsm-panel
cd gsm-panel
sudo chown -R $USER:$USER /opt/gsm-panel

npm install
```

### Step 6 — Configure Environment

```bash
# Generate a secure JWT secret
JWT_SECRET=$(openssl rand -hex 32)

# Recommended production setup: run app on 3000 and let Caddy expose it on :80/:443
cat > .env << EOF
DATABASE_URL=postgresql://gsmadmin:${DB_PASS}@127.0.0.1:5432/gameserver_db
JWT_SECRET=${JWT_SECRET}
NODE_ENV=production
PORT=3000
EOF

# Optional direct-bind setup (without Caddy):
# sed -i 's/PORT=3000/PORT=80/' .env
```

> **Why PORT=3000 by default?**
> It is the most reliable setup for PM2 and avoids root/capability issues.
> Caddy will expose the panel on the default IP/domain with no port in the URL.
>
> If you really want to bind Node directly to port 80:
> ```bash
> sudo setcap 'cap_net_bind_service=+ep' $(which node)
> sed -i 's/PORT=3000/PORT=80/' .env
> ```

### Step 7 — Build

```bash
npm run build
```

### Step 8 — Start with PM2

```bash
sudo npm install -g pm2

cd /opt/gsm-panel
pm2 start npm --name "gsm-panel" -- start

# Save and auto-start on boot
pm2 save
pm2 startup
# Run the sudo command that PM2 outputs!
```

### Step 9 — Put Caddy in Front *(recommended)*

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
```

Edit `/etc/caddy/Caddyfile`:

```caddyfile
YOUR_SERVER_IP {
    reverse_proxy 127.0.0.1:3000
}
```

Then reload Caddy:

```bash
sudo systemctl reload caddy
sudo systemctl status caddy
```

### Step 10 — Open the Panel

Visit `http://YOUR_SERVER_IP` (or your domain if you configured one).

The **installation wizard** appears automatically on first visit:
1. Enter your panel name and admin credentials
2. Click **Install Now**
3. Click **Go to Login** and sign in

### Step 10 — Initial Setup

After logging in:

1. **Nodes** → Click **"+ Add Local Node"**
2. **Games** → **Templates** tab → Install a game template
3. **Servers** → **"+ Create Server"** → follow the wizard
4. Click **Install Files** on the server to download game files
5. Click **▶ Start** to launch the server
6. Click **📋 Console** to watch the startup output

### Optional — Email Notifications

Add to your `.env` file:
```bash
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=noreply@example.com
SMTP_PASS=your_password
SMTP_FROM=noreply@example.com
```

### Optional — Discord Webhooks

When creating a server, expand **Discord Notifications** and paste your webhook URL. Get it from Discord: Server Settings → Integrations → Webhooks → New Webhook → Copy URL.

---

## 🔧 Troubleshooting

<details>
<summary><strong>Common issues</strong> (click to expand)</summary>

**Panel shows blank page after login:**
- Cookie issue — you're accessing via HTTP but `NODE_ENV=production` was set. The panel auto-detects HTTPS now, so this should work. Clear browser cookies and retry.

**SteamCMD wrapper / path issues:**
```bash
sudo rm -f /usr/local/bin/steamcmd
sudo bash -c 'cat > /usr/local/bin/steamcmd << "WRAPPER"
#!/bin/bash
cd /opt/steamcmd && exec ./steamcmd.sh "$@"
WRAPPER'
sudo chmod +x /usr/local/bin/steamcmd
```

**SteamCMD update / package issues:**
```bash
# Clean local cache and retry (do NOT use sudo)
rm -rf ~/Steam /opt/steamcmd/package
mkdir -p /opt/steamcmd/package
cd /opt/steamcmd
./steamcmd.sh +quit
```

**Important:** Do not run the first update with `sudo steamcmd ...` — keep ownership under your user so the cache and package directory remain writable.

**"Permission denied" writing to game server path:**
```bash
# For non-root installs, the panel defaults to ~/gameservers
mkdir -p ~/gameservers

# Or fix /opt/gameservers permissions
sudo mkdir -p /opt/gameservers
sudo chown -R $USER:$USER /opt/gameservers
```

**"spawn bash ENOENT" during Install Files:**
- Fixed in current version — the panel now finds bash at `/usr/bin/bash` or `/bin/bash` automatically.

**PostgreSQL connection refused:**
```bash
sudo systemctl status postgresql
sudo systemctl start postgresql
```

**PM2 permission denied:**
```bash
sudo npm install -g pm2
```

**PM2 not starting on reboot:**
```bash
pm2 startup
# Run the sudo command it outputs!
pm2 save
```

**Port 80 permission denied:**
```bash
sudo setcap 'cap_net_bind_service=+ep' $(which node)
# Or use PORT=3000 and Caddy reverse proxy
```

**LXC/Proxmox containers — SteamCMD fails:**
```bash
# Run on the HOST (not in the container)
pct set YOUR_CONTAINER_ID -features nesting=1,keyctl=1
pct restart YOUR_CONTAINER_ID
```

</details>

---

## 🔧 Caddy Reverse Proxy

Caddy is already covered in **Step 9** of the installation guide above.
Use it to expose the panel on the default IP/domain with no port in the URL while the Node app runs safely on `127.0.0.1:3000`.

---

## 📦 Tech Stack

| Technology | Version | Purpose |
|-----------|---------|---------|
| Next.js | 16.x | Fullstack React framework |
| React | 19.x | UI components |
| TypeScript | 5.9.x | Type safety |
| PostgreSQL | 15+ | Database |
| Drizzle ORM | 0.45.x | Database queries |
| Tailwind CSS | 4.x | Styling |
| bcryptjs | Latest | Password hashing |
| jsonwebtoken | Latest | JWT auth |
| otpauth | Latest | TOTP 2FA |
| nodemailer | Latest | Email notifications |
| qrcode | Latest | 2FA QR codes |

---

## 📁 Project Structure

```
gsm-panel/
├── src/
│   ├── app/api/          # 60 API routes
│   │   ├── auth/         # Login, register, 2FA, profile, permissions
│   │   ├── servers/      # CRUD, install, process, files, RCON, backup, clone, update, log
│   │   ├── nodes/        # Multi-node management, heartbeat
│   │   ├── games/        # Templates, custom, import, variables
│   │   ├── forum/        # Categories, threads, posts
│   │   ├── cms/          # Blog posts, changelogs
│   │   ├── users/        # User management
│   │   ├── roles/        # Role & permission management
│   │   ├── scheduler/    # Scheduled tasks
│   │   ├── api-keys/     # API key generation
│   │   ├── audit-log/    # Activity log
│   │   ├── database/     # DB viewer/editor/query
│   │   ├── monitor/      # System monitoring, buffer management
│   │   ├── search/       # Global search
│   │   ├── settings/     # Export, import, email
│   │   ├── templates/    # Game template library
│   │   └── audit/        # Template audit tool
│   ├── components/
│   │   ├── panels/       # 17 dashboard panels
│   │   ├── Dashboard.tsx # Sidebar, routing, command palette, shortcuts
│   │   ├── ToastProvider.tsx    # Toast notifications
│   │   ├── ConfirmDialog.tsx    # Styled confirmation modals
│   │   ├── NotificationCenter.tsx  # Bell icon + notification history
│   │   ├── ThemeToggle.tsx      # Dark/light theme
│   │   ├── ErrorBoundary.tsx    # Per-panel crash isolation
│   │   ├── PublicSite.tsx       # Public CMS frontend
│   │   ├── InstallWizard.tsx    # 3-step installer
│   │   └── LoginForm.tsx        # Authentication forms
│   ├── db/
│   │   ├── schema.ts     # 14 database tables
│   │   └── seeds.ts      # 27 game templates + variable definitions
│   └── lib/
│       ├── auth.ts       # JWT, bcrypt, cookies
│       ├── discord.ts    # 13 webhook event types
│       ├── email.ts      # SMTP + email templates
│       ├── i18n.ts       # 8-language localization
│       ├── permissions.ts # 40+ permission definitions
│       └── rcon.ts       # Source/UDP/WebRCON protocols
├── .env
├── CHANGELOG.md
├── README.md
└── package.json
```

---

## 🔐 Security

- JWT tokens with httpOnly cookies (HTTPS auto-detection)
- bcrypt password hashing (12 rounds)
- Two-Factor Authentication (TOTP)
- API keys with SHA-256 hashing (shown once on creation)
- Role-based access control (40+ permissions)
- RCON passwords stored in server variables, never exposed
- SQL query access restricted to `database.view` permission
- Suspended/banned users blocked at login
- Per-panel error boundaries prevent cascade failures

---

## 🎮 Supported Games

<details>
<summary><strong>27 game templates</strong> (click to expand)</summary>

| Game | Engine | Port | Install |
|------|--------|------|---------|
| 🧱 Minecraft Java | Java | 25565 | Mojang API |
| 📄 Minecraft Paper | Java | 25565 | PaperMC API |
| 🪨 Minecraft Bedrock | Bedrock | 19132 | Mojang CDN |
| 🔫 Counter-Strike 2 | Source 2 | 27015 | SteamCMD |
| 🎩 Team Fortress 2 | Source | 27015 | SteamCMD |
| 🔧 Garry's Mod | Source | 27015 | SteamCMD |
| 🧟 Left 4 Dead 2 | Source | 27015 | SteamCMD |
| 🪓 Rust | Unity | 28015 | SteamCMD |
| 🦖 ARK: Survival Evolved | UE4 | 7777 | SteamCMD |
| ⚔️ Valheim | Unity | 2456 | SteamCMD |
| 🧟‍♂️ 7 Days to Die | Unity | 26900 | SteamCMD |
| 🦎 Palworld | UE5 | 8211 | SteamCMD |
| 🏭 Satisfactory | UE | 7777 | SteamCMD |
| ⛏️ Terraria (TShock) | Custom | 7777 | GitHub |
| 🏰 Enshrouded | Custom | 15636 | SteamCMD |
| 🎖️ Insurgency: Sandstorm | UE4 | 27102 | SteamCMD |
| 🪖 Squad | UE4 | 7787 | SteamCMD |
| 🎯 Arma 3 | RV4 | 2302 | SteamCMD |
| 🐺 ET:Legacy | id Tech 3 | 27960 | Direct |
| ⚔️ OpenRA | Custom | 1234 | GitHub |
| ⚡ Quake Live | id Tech 3 | 27960 | SteamCMD |
| 🔵 Xonotic | DarkPlaces | 26000 | Direct |
| 🧛 V Rising | Unity | 9876 | SteamCMD |
| 🧟‍♀️ Project Zomboid | Java | 16261 | SteamCMD |
| ⚙️ Factorio | Custom | 34197 | Direct |
| 🔥 Don't Starve Together | Custom | 10999 | SteamCMD |
| 🏎️ Assetto Corsa | Custom | 9600 | GitHub |

</details>

---

## 📡 API Reference

<details>
<summary><strong>60 API routes</strong> (click to expand)</summary>

#### Authentication
| Route | Method | Description |
|-------|--------|-------------|
| `/api/auth/login` | POST | Login with username/password |
| `/api/auth/register` | POST | Create account |
| `/api/auth/logout` | POST | Clear session |
| `/api/auth/me` | GET | Current user + permissions |
| `/api/auth/profile` | GET/PATCH | View/edit own profile |
| `/api/auth/permissions` | GET | Current user's permissions |
| `/api/auth/2fa/setup` | POST | Generate TOTP secret + QR |
| `/api/auth/2fa/verify` | POST | Enable/disable 2FA |

#### Servers
| Route | Method | Description |
|-------|--------|-------------|
| `/api/servers` | GET/POST | List/create servers |
| `/api/servers/[id]` | GET/PATCH/DELETE | Server CRUD |
| `/api/servers/[id]/install` | POST | Install game files |
| `/api/servers/[id]/process` | POST | Start/stop/restart/status |
| `/api/servers/[id]/update` | POST | SteamCMD app_update |
| `/api/servers/[id]/backup` | GET/POST | List/create/restore backups |
| `/api/servers/[id]/clone` | POST | Clone server |
| `/api/servers/[id]/files` | GET/POST | File manager operations |
| `/api/servers/[id]/files/upload` | POST | Upload files |
| `/api/servers/[id]/log` | GET | Read server console log |
| `/api/servers/[id]/rcon` | GET/POST | RCON connection/commands |

#### Games & Templates
| Route | Method | Description |
|-------|--------|-------------|
| `/api/games` | GET/POST | List/create game definitions |
| `/api/games/[id]` | GET/PATCH | View/edit game |
| `/api/games/[id]/variables` | GET | Template variables |
| `/api/games/custom` | POST | Create custom template |
| `/api/games/import` | POST | Import Pterodactyl/AMP template |
| `/api/templates` | GET | Built-in template library |
| `/api/templates/[slug]` | GET | Template details |
| `/api/templates/[slug]/install` | POST/DELETE | Install/uninstall template |

#### Nodes
| Route | Method | Description |
|-------|--------|-------------|
| `/api/nodes` | GET/POST | List/create nodes |
| `/api/nodes/[id]` | GET/PATCH/DELETE | Node CRUD |
| `/api/nodes/[id]/heartbeat` | POST | Node health metrics |
| `/api/nodes/local` | POST | Add local node |

#### Users & Roles
| Route | Method | Description |
|-------|--------|-------------|
| `/api/users` | GET | List users |
| `/api/users/[id]` | GET/PATCH/DELETE | User CRUD |
| `/api/roles` | GET/POST | List/create roles |
| `/api/roles/[id]` | PATCH/DELETE | Role CRUD |
| `/api/api-keys` | GET/POST/DELETE | API key management |

#### Forum & CMS
| Route | Method | Description |
|-------|--------|-------------|
| `/api/forum/categories` | GET | Forum categories |
| `/api/forum/threads` | GET/POST | Threads |
| `/api/forum/threads/[id]` | GET/POST/PATCH/DELETE | Thread CRUD + replies |
| `/api/forum/posts/[id]` | PATCH/DELETE | Edit/delete posts |
| `/api/cms` | GET/POST | CMS posts |
| `/api/cms/[slug]` | GET/PATCH/DELETE | Single post CRUD |

#### System
| Route | Method | Description |
|-------|--------|-------------|
| `/api/monitor` | GET | System metrics |
| `/api/monitor/clear-buffers` | POST | Clear RAM buffers |
| `/api/database` | GET | List tables |
| `/api/database/table/[name]` | GET | Browse table |
| `/api/database/table/[name]/row` | POST | Insert/update/delete row |
| `/api/database/query` | POST | Execute SQL |
| `/api/scheduler` | GET/POST | Scheduled tasks |
| `/api/scheduler/[id]` | PATCH/DELETE | Task CRUD |
| `/api/audit-log` | GET/POST | Activity log |
| `/api/audit/templates` | GET | Template audit |
| `/api/search` | GET | Global search |
| `/api/settings/export` | GET | Export config |
| `/api/settings/import` | POST | Import config |
| `/api/settings/email` | GET/POST | Email config/test |
| `/api/health` | GET | Health check |
| `/api/install` | GET/POST | Web installer |
| `/api/discord/test` | POST | Test webhook |

</details>

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

MIT License — See [LICENSE](LICENSE) file for details.

---

<p align="center">
  <strong>Built with ❤️ for the game server hosting community</strong>
</p>
