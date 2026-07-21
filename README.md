# 🎮 GameServer Manager — Modern Game Server Hosting Panel

A modern, open-source TCAdmin alternative built with **Next.js 16**, **PostgreSQL**, **Drizzle ORM**, and **Tailwind CSS 4**. Features a dark-themed control panel for managing game servers, built-in forum, server monitoring with RAM buffer management, database viewer/editor, IPv6 support, and automatic game server file installation.

**Repository:** https://github.com/phillgates2/game-server-hosting-cms.git

---

## ✨ Features

- **🖥️ Game Server Management** — Create, start, stop, and delete game server instances
- **🎮 Auto-Install Game Files** — Pre-configured install scripts for 5 games via SteamCMD or direct download
- **📊 Server Monitoring** — Real-time CPU, RAM, disk, and network monitoring with live charts
- **🧹 RAM Buffer Management** — Automatic buffer/cache threshold detection and one-click clearing
- **💬 Forum System** — Full forum with categories, threads, and posts
- **🗄️ Database Manager** — Built-in PostgreSQL viewer/editor (like phpMyAdmin) with SQL query editor
- **🌐 IPv6 Support** — Full IPv6 support for game servers and network monitoring
- **🔐 Authentication** — JWT-based auth with bcrypt password hashing, role-based access control
- **🎨 Modern Dark Theme** — Beautiful dark UI with smooth animations
- **🚀 Web Installer** — Step-by-step web-based installation wizard

### Supported Games (40+ Pre-Seeded)

#### Minecraft
| Game | Engine | Default Port | Install Method |
|------|--------|-------------|----------------|
| 🧱 Minecraft: Java Edition | Java | 25565 | Official Download |
| 📄 Minecraft: Paper | Java (Paper) | 25565 | PaperMC API |
| 🪨 Minecraft: Bedrock Edition | Bedrock | 19132 | Official Download |

#### Valve / Source Engine
| Game | Engine | Default Port | Install Method |
|------|--------|-------------|----------------|
| 🔫 Counter-Strike 2 | Source 2 | 27015 | SteamCMD |
| 💣 Counter-Strike: Global Offensive | Source | 27015 | SteamCMD |
| 🎩 Team Fortress 2 | Source | 27015 | SteamCMD |
| 🔧 Garry's Mod | Source | 27015 | SteamCMD |
| 🧟 Left 4 Dead 2 | Source | 27015 | SteamCMD |

#### Survival Games
| Game | Engine | Default Port | Install Method |
|------|--------|-------------|----------------|
| 🪓 Rust | Unity | 28015 | SteamCMD |
| 🦖 ARK: Survival Evolved | Unreal Engine 4 | 7777 | SteamCMD |
| 🦕 ARK: Survival Ascended | Unreal Engine 5 | 7777 | SteamCMD |
| ⚔️ Valheim | Unity | 2456 | SteamCMD |
| 🧟‍♂️ 7 Days to Die | Unity | 26900 | SteamCMD |
| 🏚️ DayZ | Enfusion | 2302 | SteamCMD |
| 🦎 Palworld | Unreal Engine 5 | 8211 | SteamCMD |
| 🏭 Satisfactory | Unreal Engine | 7777 | SteamCMD |
| ⛏️ Terraria (TShock) | Custom | 7777 | GitHub Release |
| 🌲 The Forest | Unity | 8766 | SteamCMD |
| 🌳 Sons of the Forest | Unity | 8766 | SteamCMD |
| 🏰 Enshrouded | Holistic | 15636 | SteamCMD |

#### FPS / Action
| Game | Engine | Default Port | Install Method |
|------|--------|-------------|----------------|
| 🎖️ Insurgency: Sandstorm | Unreal Engine 4 | 27102 | SteamCMD |
| 🪖 Squad | Unreal Engine 4 | 7787 | SteamCMD |
| 🎯 Arma 3 | Real Virtuality 4 | 2302 | SteamCMD |
| 🪂 Arma Reforger | Enfusion | 2001 | SteamCMD |
| 🔨 Unturned | Unity | 27015 | SteamCMD |

#### RPG / Sandbox
| Game | Engine | Default Port | Install Method |
|------|--------|-------------|----------------|
| 🧛 V Rising | Unity | 9876 | SteamCMD |
| ⚔️ Conan Exiles | Unreal Engine 4 | 7777 | SteamCMD |
| 🚀 Space Engineers | VRAGE 2.0 | 27016 | SteamCMD |
| ⚙️ Factorio | Custom | 34197 | Official Download |
| 🧟‍♀️ Project Zomboid | Java | 16261 | SteamCMD |
| 🔥 Don't Starve Together | Custom | 10999 | SteamCMD |

#### Classic / Retro
| Game | Engine | Default Port | Install Method |
|------|--------|-------------|----------------|
| 🐺 Wolfenstein: Enemy Territory | id Tech 3 | 27960 | Direct Download |
| ⚔️ OpenRA | OpenRA Engine | 1234 | GitHub Release |
| ⚡ Quake Live | id Tech 3 | 27960 | SteamCMD |
| 🔵 Xonotic | DarkPlaces | 26000 | Direct Download |

#### Other
| Game | Engine | Default Port | Install Method |
|------|--------|-------------|----------------|
| 🏎️ Assetto Corsa | Custom | 9600 | SteamCMD |
| 🏁 Assetto Corsa Competizione | Unreal Engine 4 | 9231 | SteamCMD |
| 🚜 Farming Simulator 22 | GIANTS Engine | 10823 | SteamCMD |
| 🌊 Barotrauma | Custom | 27015 | SteamCMD |
| 🌍 Eco | Unity | 3000 | SteamCMD |
| ⚔️ Mordhau | Unreal Engine 4 | 7777 | SteamCMD |
| 🗡️ Chivalry 2 | Unreal Engine 4 | 7777 | SteamCMD |

---

## 🖥️ Fresh Server Installation Guide

### Prerequisites

- **OS:** Ubuntu 22.04+ / Debian 12+ (or any Linux with systemd)
- **Node.js:** v20+ (v22 LTS recommended)
- **PostgreSQL:** 15+ (16 recommended)
- **Git:** 2.x+
- **SteamCMD:** (for Steam-based game servers)

### Step 1: System Setup

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install required packages
sudo apt install -y curl git build-essential lib32gcc-s1 unzip wget

# Install Node.js 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Verify
node --version   # v22.x.x
npm --version    # 10.x.x
```

### Step 2: Install PostgreSQL

```bash
# Install PostgreSQL 16
sudo apt install -y postgresql postgresql-contrib

# Start and enable
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Create database and user
sudo -u postgres psql <<EOF
CREATE USER gsmadmin WITH PASSWORD 'your_secure_password_here';
CREATE DATABASE gameserver_db OWNER gsmadmin;
GRANT ALL PRIVILEGES ON DATABASE gameserver_db TO gsmadmin;
\q
EOF
```

### Step 3: Install SteamCMD (for Steam games)

```bash
# Install 32-bit libraries (required for SteamCMD)
sudo dpkg --add-architecture i386
sudo apt update
sudo apt install -y lib32gcc-s1 lib32stdc++6 libc6-i386

# Create steamcmd directory and download
sudo mkdir -p /opt/steamcmd
cd /opt/steamcmd
sudo curl -sqL "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz" | sudo tar xzf -

# Fix permissions
sudo chmod +x /opt/steamcmd/steamcmd.sh
sudo chmod +x /opt/steamcmd/linux32/steamcmd

# Create a wrapper script that runs from the correct directory
sudo tee /usr/local/bin/steamcmd > /dev/null << 'STEAMWRAPPER'
#!/bin/bash
cd /opt/steamcmd
exec ./steamcmd.sh "$@"
STEAMWRAPPER
sudo chmod +x /usr/local/bin/steamcmd

# Test SteamCMD
steamcmd +quit
```

**Note:** SteamCMD must run from its installation directory. The wrapper script handles this automatically.

### Step 4: Clone & Install the Panel

```bash
# Clone the repository
cd /opt
sudo git clone https://github.com/phillgates2/game-server-hosting-cms.git
cd game-server-hosting-cms

# Set ownership
sudo chown -R $USER:$USER /opt/game-server-hosting-cms

# Install dependencies
npm install
```

### Step 5: Configure Environment

```bash
# Create .env file
cat > .env <<EOF
DATABASE_URL=postgresql://gsmadmin:your_secure_password_here@127.0.0.1:5432/gameserver_db
JWT_SECRET=$(openssl rand -hex 32)
NODE_ENV=production
PORT=3000
EOF
```

### Step 6: Build & Start

```bash
# Build the application
npm run build

# Start in production mode (for testing)
npm start
```

### Step 7: Setup PM2 Process Manager (Recommended)

PM2 keeps your panel running and auto-restarts on crashes/reboots.

```bash
# Install PM2 globally (requires sudo)
sudo npm install -g pm2

# Start the panel with PM2
cd /opt/game-server-hosting-cms
pm2 start npm --name "gsm-panel" -- start

# Save PM2 process list
pm2 save

# Generate startup script (run the command it outputs)
pm2 startup

# Example output - run the sudo command it provides:
# sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u admin --hp /home/admin

# Verify it's running
pm2 status
pm2 logs gsm-panel
```

#### PM2 Useful Commands

```bash
# View status
pm2 status

# View logs
pm2 logs gsm-panel

# Restart panel
pm2 restart gsm-panel

# Stop panel
pm2 stop gsm-panel

# Monitor resources
pm2 monit
```

### Step 8: Run the Web Installer

1. Open your browser: `http://YOUR_SERVER_IP:3000`
2. The installation wizard will appear
3. Configure your panel name and admin credentials
4. Click "Install Now" — this will:
   - Create all database tables with multi-node support
   - Create the admin user
   - Make 30+ game templates available (install as needed)
   - Create forum categories
   - Save panel settings
5. Log in with your admin credentials

### Step 9: Initial Setup (After Installation)

1. **Add a Node:**
   - Go to **Nodes** panel
   - Click **"+ Add Local Node"** to add this server
   - This auto-detects your server's resources

2. **Install Game Templates:**
   - Go to **Games** → **Templates** tab
   - Click on a game to view details
   - Click **"Install Game"** to make it available

3. **Create Your First Server:**
   - Go to **Servers** panel
   - Click **"+ New Server"**
   - Select your node, game, and configure settings

---

## 🖥️ Multi-Node Server Management

GameServer Manager supports managing game servers across multiple physical or virtual machines (nodes).

### Node Types

| Type | Description |
|------|-------------|
| **Local Node** | This server running the panel (auto-detected) |
| **Remote Node** | External server connected via SSH or API |

### Adding Nodes

#### Add Local Node (This Server)
1. Go to **Nodes** panel
2. Click **"+ Add Local Node"**
3. The panel automatically detects:
   - Hostname, IPv4, IPv6
   - Total RAM and disk space
   - Sets as default node

#### Add Remote Node
1. Go to **Nodes** panel
2. Click **"+ Add Remote Node"**
3. Fill in:
   - **Name** — Display name (e.g., "US East Server")
   - **Hostname** — FQDN or IP address
   - **SSH Port** — Usually 22
   - **SSH User** — root or dedicated user
   - **SSH Key Path** — Path to private key on panel server
   - **Max Servers** — Limit for this node
   - **Max RAM** — Total RAM available
   - **Game Server Path** — Where servers are installed
   - **Location** — Physical location (e.g., "New York, USA")
   - **Provider** — Hosting provider (e.g., "Hetzner", "OVH")

### Node Heartbeat API

Remote nodes can send health metrics to the panel:

```bash
# Example heartbeat from node
curl -X POST https://panel.example.com/api/nodes/1/heartbeat \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-node-api-key" \
  -d '{
    "cpuPercent": 45,
    "cpuLoad1": 1.5,
    "ramUsedMb": 8192,
    "ramTotalMb": 16384,
    "diskUsedMb": 50000,
    "diskTotalMb": 100000,
    "serverCount": 5,
    "ipv6Enabled": true
  }'
```

### Node Selection

When creating a game server:
1. Select the target **Node** from dropdown
2. Only online nodes are shown
3. Install path auto-updates based on node's game server path
4. Server inherits node's IPv4 address by default

---

## 🔔 Discord Webhook Notifications

GameServer Manager supports Discord webhooks for real-time server notifications.

### Setting Up Webhooks

1. **Create a Discord Webhook:**
   - Open Discord → Server Settings → Integrations → Webhooks
   - Click "New Webhook"
   - Choose the channel for notifications
   - Copy the Webhook URL

2. **Configure in Panel:**
   - When creating a server, expand "Discord Notifications"
   - Paste your webhook URL
   - Select which events to notify:
     - ✅ Server Start
     - ✅ Server Stop
     - ✅ Server Restart
     - ✅ Server Crash

3. **Test Your Webhook:**
   - Click "Test 🔔" button on any server with a webhook configured

### Notification Types

| Event | Color | Description |
|-------|-------|-------------|
| 🆕 Server Created | Green | Server has been created |
| ▶️ Server Started | Blue | Server is now online |
| ⏹️ Server Stopped | Amber | Server has been stopped |
| 🔄 Server Restarted | Purple | Server is restarting |
| 💥 Server Crashed | Red | Server crashed unexpectedly |
| 🗑️ Server Deleted | Gray | Server was deleted |

### Example Webhook Payload

```json
{
  "username": "GameServer Manager",
  "embeds": [{
    "title": "▶️ Server Started",
    "description": "**My Minecraft Server** is now online!",
    "color": 3447003,
    "fields": [
      { "name": "🎮 Game", "value": "Minecraft", "inline": true },
      { "name": "🌐 Connection", "value": "`192.168.1.100:25565`", "inline": true }
    ],
    "timestamp": "2024-01-15T12:00:00.000Z"
  }]
}
```

---

## 🌐 IPv6 Configuration

### Enable IPv6 on your server

```bash
# Check if IPv6 is enabled
cat /proc/sys/net/ipv6/conf/all/disable_ipv6
# 0 = enabled, 1 = disabled

# Enable if disabled
sudo sysctl -w net.ipv6.conf.all.disable_ipv6=0
sudo sysctl -w net.ipv6.conf.default.disable_ipv6=0

# Make permanent
echo "net.ipv6.conf.all.disable_ipv6 = 0" | sudo tee -a /etc/sysctl.conf
echo "net.ipv6.conf.default.disable_ipv6 = 0" | sudo tee -a /etc/sysctl.conf
sudo sysctl -p
```

### Bind game servers to IPv6

When creating a server in the panel, add the IPv6 address in the IPv6 field. The panel supports dual-stack (IPv4 + IPv6) game server configurations.

---

## 🧹 RAM Buffer Management

The panel includes automatic RAM buffer/cache monitoring:

- **Threshold:** Configurable (default 80%) — alerts when buffers exceed this
- **Auto-detection:** Monitors `/proc/meminfo` for buffer and cache levels
- **One-click clearing:** Admin can clear page cache, dentries, and inodes via the panel
- **Linux command used:** `sync && echo 3 > /proc/sys/vm/drop_caches`

For automatic buffer clearing, you can set up a cron job:

```bash
# Clear buffers when usage exceeds 80% (check every 5 minutes)
(crontab -l 2>/dev/null; echo "*/5 * * * * free | awk '/Mem/{if(\$6/\$2*100 > 80) system(\"sync && echo 3 > /proc/sys/vm/drop_caches\")}'") | crontab -
```

---

## 🔧 Caddy Reverse Proxy (Recommended)

Caddy is a modern web server with **automatic HTTPS** — no manual SSL configuration needed!

### Install Caddy

```bash
# Install Caddy on Ubuntu/Debian
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy

# Start and enable Caddy
sudo systemctl enable caddy
sudo systemctl start caddy
```

### Configure Caddy

Create or edit `/etc/caddy/Caddyfile`:

```caddyfile
panel.yourdomain.com {
    reverse_proxy localhost:3000
}
```

That's it! Caddy automatically:
- Obtains SSL certificates from Let's Encrypt
- Redirects HTTP to HTTPS
- Renews certificates automatically

### Reload Caddy

```bash
sudo systemctl reload caddy
```

### With IPv6 Support

```caddyfile
panel.yourdomain.com {
    # Listen on both IPv4 and IPv6
    bind 0.0.0.0 [::]
    
    reverse_proxy localhost:3000
}
```

### Multiple Panels / Nodes

```caddyfile
# Main panel
panel.yourdomain.com {
    reverse_proxy localhost:3000
}

# Node 1 panel (if running panel on each node)
node1.yourdomain.com {
    reverse_proxy localhost:3000
}

# Node 2 panel
node2.yourdomain.com {
    reverse_proxy localhost:3000
}
```

### With WebSocket Support (for real-time features)

```caddyfile
panel.yourdomain.com {
    reverse_proxy localhost:3000 {
        # WebSocket support
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }
}
```

### Caddy as Systemd Service

Caddy installs as a systemd service automatically. Useful commands:

```bash
# Check status
sudo systemctl status caddy

# View logs
sudo journalctl -u caddy -f

# Validate Caddyfile
caddy validate --config /etc/caddy/Caddyfile

# Format Caddyfile
caddy fmt --overwrite /etc/caddy/Caddyfile
```

---

## 🗄️ Database Manager

The built-in database manager provides:

- **Table browser** — View all tables with row counts and column info
- **Data editor** — Edit rows inline, insert new rows, delete rows
- **Structure viewer** — View column types, nullability, defaults
- **SQL query editor** — Execute raw SQL with syntax highlighting and result display
- **Keyboard shortcut:** Ctrl+Enter to execute queries

Access the database manager from the admin sidebar (admin role required).

---

## 📁 Project Structure

```
game-server-hosting-cms/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── auth/          # Login, register, logout, session
│   │   │   ├── database/      # DB viewer/editor/query APIs
│   │   │   ├── forum/         # Forum categories, threads, posts
│   │   │   ├── games/         # Game definitions
│   │   │   ├── health/        # Health check endpoint
│   │   │   ├── install/       # Web installer API
│   │   │   ├── monitor/       # System monitoring & buffer management
│   │   │   └── servers/       # Game server CRUD
│   │   ├── globals.css        # Tailwind + dark theme
│   │   ├── layout.tsx         # Root layout
│   │   └── page.tsx           # Main entry point
│   ├── components/
│   │   ├── panels/
│   │   │   ├── DatabasePanel.tsx   # phpMyAdmin-like DB manager
│   │   │   ├── ForumPanel.tsx      # Forum system
│   │   │   ├── GamesPanel.tsx      # Game definitions browser
│   │   │   ├── MonitorPanel.tsx    # Server monitoring
│   │   │   ├── OverviewPanel.tsx   # Dashboard overview
│   │   │   └── ServersPanel.tsx    # Server management
│   │   ├── Dashboard.tsx           # Main dashboard layout
│   │   ├── InstallWizard.tsx       # Web installer
│   │   └── LoginForm.tsx           # Authentication forms
│   ├── db/
│   │   ├── index.ts           # Database connection
│   │   ├── schema.ts          # Drizzle ORM schema
│   │   └── seeds.ts           # Game definition seed data
│   └── lib/
│       └── auth.ts            # JWT + bcrypt auth utilities
├── .env                       # Environment variables
├── drizzle.config.json        # Drizzle Kit configuration
├── package.json
├── tsconfig.json
└── README.md
```

---

## 🔒 Security Notes

- Change `JWT_SECRET` in production (auto-generated during setup)
- Use strong PostgreSQL passwords
- Enable SSL/TLS via Nginx reverse proxy
- The database manager is admin-only
- Buffer clearing requires admin role
- First registered user automatically gets admin role

---

## 🔧 Troubleshooting

### SteamCMD Issues

**"No such file or directory" error:**
```bash
# Install 32-bit libraries
sudo dpkg --add-architecture i386
sudo apt update
sudo apt install -y lib32gcc-s1 lib32stdc++6 libc6-i386

# Reinstall SteamCMD
cd /opt/steamcmd
sudo rm -rf *
sudo curl -sqL "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz" | sudo tar xzf -
sudo chmod +x steamcmd.sh linux32/steamcmd
```

**"Permission denied" error:**
```bash
# Fix permissions
sudo chown -R $USER:$USER /opt/steamcmd
chmod +x /opt/steamcmd/steamcmd.sh
chmod +x /opt/steamcmd/linux32/steamcmd
```

### PM2 Issues

**"EACCES permission denied" when installing PM2:**
```bash
# Use sudo for global install
sudo npm install -g pm2
```

**PM2 not found after install:**
```bash
# Check if installed globally
which pm2
# or
sudo which pm2

# If using sudo, you may need to run pm2 with full path
sudo /usr/lib/node_modules/pm2/bin/pm2 status
```

### Database Connection Issues

**"ECONNREFUSED" error:**
```bash
# Check PostgreSQL is running
sudo systemctl status postgresql

# Start if not running
sudo systemctl start postgresql
```

**"password authentication failed":**
```bash
# Reset user password
sudo -u postgres psql
ALTER USER gsmadmin WITH PASSWORD 'new_password_here';
\q

# Update .env file
nano /opt/game-server-hosting-cms/.env
```

### Panel Not Loading

**Check if Node.js app is running:**
```bash
pm2 status
pm2 logs gsm-panel
```

**Check if port 3000 is in use:**
```bash
sudo lsof -i :3000
sudo netstat -tlnp | grep 3000
```

**Check firewall:**
```bash
# UFW
sudo ufw allow 3000/tcp

# iptables
sudo iptables -A INPUT -p tcp --dport 3000 -j ACCEPT
```

### Caddy Not Working

**Check Caddy status:**
```bash
sudo systemctl status caddy
sudo journalctl -u caddy -f
```

**Validate configuration:**
```bash
caddy validate --config /etc/caddy/Caddyfile
```

**Test without Caddy:**
```bash
# Access directly on port 3000
curl http://localhost:3000/api/health
```

---

## 📦 Tech Stack

| Technology | Version | Purpose |
|-----------|---------|---------|
| Next.js | 16.x | React fullstack framework |
| React | 19.x | UI library |
| TypeScript | 5.9.x | Type safety |
| PostgreSQL | 15+ | Database |
| Drizzle ORM | 0.45.x | Database ORM |
| Tailwind CSS | 4.x | Styling |
| bcryptjs | Latest | Password hashing |
| jsonwebtoken | Latest | JWT authentication |
| zod | Latest | Schema validation |

---

## 📄 License

MIT License — See [LICENSE](LICENSE) file for details.

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

**Built with ❤️ for the game server hosting community**
