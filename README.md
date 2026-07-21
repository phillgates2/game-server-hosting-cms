# 🎮 GameServer Manager — Modern Game Server Hosting Panel

A modern, open-source TCAdmin alternative built with **Next.js 16**, **PostgreSQL**, **Drizzle ORM**, and **Tailwind CSS 4**. Features a dark-themed control panel for managing game servers across multiple nodes, built-in forum, server monitoring with RAM buffer management, database viewer/editor, IPv6 support, and automatic game server file installation.

**Repository:** https://github.com/phillgates2/game-server-hosting-cms.git

---

## ✨ Features

- **🖥️ Multi-Node Support** — Manage game servers across multiple physical/virtual machines
- **🎮 Game Server Management** — Create, start, stop, and delete game server instances
- **📦 30+ Game Templates** — Pre-configured install scripts (install only what you need)
- **📊 Server Monitoring** — Real-time CPU, RAM, disk, and network monitoring with live charts
- **🧹 RAM Buffer Management** — Automatic buffer/cache threshold detection and one-click clearing
- **💬 Forum System** — Full forum with categories, threads, and posts
- **🗄️ Database Manager** — Built-in PostgreSQL viewer/editor (like phpMyAdmin) with SQL query editor
- **🔔 Discord Webhooks** — Real-time server event notifications
- **🌐 IPv6 Support** — Full IPv6 support for game servers and network monitoring
- **🔐 Authentication** — JWT-based auth with bcrypt password hashing, role-based access control
- **🎨 Modern Dark Theme** — Beautiful dark UI with smooth animations
- **🚀 Web Installer** — Step-by-step web-based installation wizard

### Supported Games (30+ Templates)

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
| 🎩 Team Fortress 2 | Source | 27015 | SteamCMD |
| 🔧 Garry's Mod | Source | 27015 | SteamCMD |
| 🧟 Left 4 Dead 2 | Source | 27015 | SteamCMD |

#### Survival Games
| Game | Engine | Default Port | Install Method |
|------|--------|-------------|----------------|
| 🪓 Rust | Unity | 28015 | SteamCMD |
| 🦖 ARK: Survival Evolved | Unreal Engine 4 | 7777 | SteamCMD |
| ⚔️ Valheim | Unity | 2456 | SteamCMD |
| 🧟‍♂️ 7 Days to Die | Unity | 26900 | SteamCMD |
| 🦎 Palworld | Unreal Engine 5 | 8211 | SteamCMD |
| 🏭 Satisfactory | Unreal Engine | 7777 | SteamCMD |
| ⛏️ Terraria (TShock) | Custom | 7777 | GitHub Release |
| 🏰 Enshrouded | Holistic | 15636 | SteamCMD |

#### FPS / Action
| Game | Engine | Default Port | Install Method |
|------|--------|-------------|----------------|
| 🎖️ Insurgency: Sandstorm | Unreal Engine 4 | 27102 | SteamCMD |
| 🪖 Squad | Unreal Engine 4 | 7787 | SteamCMD |
| 🎯 Arma 3 | Real Virtuality 4 | 2302 | SteamCMD |

#### Classic / Other
| Game | Engine | Default Port | Install Method |
|------|--------|-------------|----------------|
| 🐺 Wolfenstein: Enemy Territory | id Tech 3 | 27960 | Direct Download |
| ⚔️ OpenRA | OpenRA Engine | 1234 | GitHub Release |
| ⚡ Quake Live | id Tech 3 | 27960 | SteamCMD |
| 🧛 V Rising | Unity | 9876 | SteamCMD |
| ⚙️ Factorio | Custom | 34197 | Official Download |
| 🔥 Don't Starve Together | Custom | 10999 | SteamCMD |
| 🏎️ Assetto Corsa | Custom | 9600 | SteamCMD |

---

## 🖥️ Fresh Server Installation Guide

### Prerequisites

- **OS:** Ubuntu 22.04+ / Debian 12+ (or any Linux with systemd)
- **Node.js:** v20+ (v22 LTS recommended)
- **PostgreSQL:** 15+ (16 recommended)
- **RAM:** 2GB+ (4GB+ recommended)
- **Disk:** 20GB+ for panel, additional space for game servers

---

### Step 1: System Update & Base Packages

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install required packages
sudo apt install -y curl git build-essential unzip wget gnupg ca-certificates
```

---

### Step 2: Install Node.js 22 LTS

```bash
# Add NodeSource repository
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -

# Install Node.js
sudo apt install -y nodejs

# Verify installation
node --version   # Should show v22.x.x
npm --version    # Should show 10.x.x
```

---

### Step 3: Install PostgreSQL

```bash
# Install PostgreSQL
sudo apt install -y postgresql postgresql-contrib

# Start and enable PostgreSQL
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Verify it's running
sudo systemctl status postgresql
```

#### Create Database and User

```bash
# Switch to postgres user and create database
sudo -u postgres psql -c "CREATE USER gsmadmin WITH PASSWORD 'CHANGE_THIS_PASSWORD';"
sudo -u postgres psql -c "CREATE DATABASE gameserver_db OWNER gsmadmin;"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE gameserver_db TO gsmadmin;"
sudo -u postgres psql -c "ALTER USER gsmadmin CREATEDB;"

# Test connection
psql -h 127.0.0.1 -U gsmadmin -d gameserver_db -c "SELECT 1;"
# Enter password when prompted
```

> ⚠️ **Important:** Replace `CHANGE_THIS_PASSWORD` with a secure password!

---

### Step 4: Install SteamCMD (Optional - for Steam games)

```bash
# Add 32-bit architecture support (SteamCMD is a 32-bit application)
sudo dpkg --add-architecture i386
sudo apt update
sudo apt install -y lib32gcc-s1 lib32stdc++6 ca-certificates

# Create directory and download SteamCMD
sudo mkdir -p /opt/steamcmd
cd /opt/steamcmd
sudo curl -sqL "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz" | sudo tar xzf -

# Set executable permissions
sudo chmod +x /opt/steamcmd/steamcmd.sh
sudo chmod +x /opt/steamcmd/linux32/steamcmd

# Create a wrapper script
# (SteamCMD MUST run from /opt/steamcmd — a symlink does NOT work)
sudo bash -c 'cat > /usr/local/bin/steamcmd << "WRAPPER"
#!/bin/bash
cd /opt/steamcmd && exec ./steamcmd.sh "$@"
WRAPPER'
sudo chmod +x /usr/local/bin/steamcmd

# First run — downloads ~40MB of updates (may take a minute)
# If it fails on the first try, just run it again
steamcmd +quit
```

> **Why a wrapper and not a symlink?**
> SteamCMD's `steamcmd.sh` uses relative paths internally (e.g., `./linux32/steamcmd`).
> A symlink like `ln -sf /opt/steamcmd/steamcmd.sh /usr/local/bin/steamcmd` runs from
> `/usr/local/bin/` where `./linux32/steamcmd` doesn't exist, causing
> `"No such file or directory"`. The wrapper `cd`s into the correct directory first.

#### If SteamCMD update fails

```bash
# Clean cached data and retry
rm -rf ~/Steam /opt/steamcmd/package
steamcmd +quit

# If still failing, retry in a loop (network issues)
until steamcmd +quit; do
    echo "Retrying in 5s..."
    rm -rf ~/Steam/package
    sleep 5
done
```

---

### Step 5: Clone & Install the Panel

```bash
# Clone repository
cd /opt
sudo git clone https://github.com/phillgates2/game-server-hosting-cms.git gsm-panel
cd gsm-panel

# Set ownership to your user
sudo chown -R $USER:$USER /opt/gsm-panel

# Install Node.js dependencies
npm install
```

---

### Step 6: Configure Environment

```bash
# Generate a secure JWT secret
JWT_SECRET=$(openssl rand -hex 32)

# Create .env file (replace password with your PostgreSQL password)
cat > .env << EOF
DATABASE_URL=postgresql://gsmadmin:CHANGE_THIS_PASSWORD@127.0.0.1:5432/gameserver_db
JWT_SECRET=${JWT_SECRET}
NODE_ENV=production
PORT=3000
EOF

# Verify .env was created
cat .env
```

> ⚠️ **Important:** Replace `CHANGE_THIS_PASSWORD` with the password you set in Step 3!

---

### Step 7: Build the Application

```bash
# Build for production
npm run build

# You should see output like:
# ✓ Compiled successfully
# ✓ Collecting page data
# ✓ Generating static pages
```

---

### Step 8: Test the Panel

```bash
# Start the panel (for testing)
npm start

# Open in browser: http://YOUR_SERVER_IP:3000
# Press Ctrl+C to stop after testing
```

---

### Step 9: Setup PM2 (Production Process Manager)

PM2 keeps your panel running 24/7 and auto-restarts on crashes or server reboots.

```bash
# Install PM2 globally
sudo npm install -g pm2

# Start the panel with PM2
cd /opt/gsm-panel
pm2 start npm --name "gsm-panel" -- start

# Verify it's running
pm2 status

# Save the process list
pm2 save

# Setup auto-start on boot
pm2 startup
# PM2 will output a command - COPY AND RUN IT!
# Example: sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u youruser --hp /home/youruser
```

#### PM2 Commands Reference

```bash
pm2 status              # View all processes
pm2 logs gsm-panel      # View logs (Ctrl+C to exit)
pm2 restart gsm-panel   # Restart the panel
pm2 stop gsm-panel      # Stop the panel
pm2 delete gsm-panel    # Remove from PM2
pm2 monit               # Real-time monitoring dashboard
```

---

### Step 10: Run the Web Installer

1. Open your browser: `http://YOUR_SERVER_IP:3000`
2. The installation wizard will appear
3. Enter:
   - **Panel Name:** Your panel's display name
   - **Admin Username:** Your admin username
   - **Admin Email:** Your email address
   - **Admin Password:** A strong password
4. Click **"Install Now"**
5. Wait for installation to complete
6. Click **"Go to Login"** and sign in

---

### Step 11: Initial Panel Setup

After logging in:

1. **Add a Node (Required):**
   - Go to **Nodes** in the sidebar
   - Click **"+ Add Local Node"**
   - This auto-detects your server's resources

2. **Install Game Templates:**
   - Go to **Games** in the sidebar
   - Click the **"Templates"** tab
   - Click on a game (e.g., Minecraft)
   - Click **"Install Game"**

3. **Create Your First Server:**
   - Go to **Servers** in the sidebar
   - Click **"+ New Server"**
   - Select your node and game
   - Configure settings and click **"Create Server"**

---

## 🔧 Caddy Reverse Proxy (Recommended for Production)

Caddy provides automatic HTTPS with Let's Encrypt certificates.

### Install Caddy

```bash
# Add Caddy repository
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
```

### Configure Caddy

```bash
# Edit Caddyfile
sudo nano /etc/caddy/Caddyfile
```

Replace contents with:

```caddyfile
panel.yourdomain.com {
    reverse_proxy localhost:3000
}
```

```bash
# Reload Caddy
sudo systemctl reload caddy

# Check status
sudo systemctl status caddy
```

That's it! Caddy automatically:
- Obtains SSL certificates from Let's Encrypt
- Redirects HTTP to HTTPS
- Renews certificates automatically

### Caddy with IPv6

```caddyfile
panel.yourdomain.com {
    bind 0.0.0.0 [::]
    reverse_proxy localhost:3000
}
```

---

## 🖥️ Multi-Node Server Management

GameServer Manager supports managing game servers across multiple physical or virtual machines.

### Node Types

| Type | Description |
|------|-------------|
| **Local Node** | This server running the panel (auto-detected) |
| **Remote Node** | External server connected via SSH or API |

### Adding a Remote Node

1. Go to **Nodes** panel
2. Click **"+ Add Remote Node"**
3. Fill in:
   - **Name** — Display name (e.g., "US East Server")
   - **Hostname** — FQDN or IP address
   - **SSH Port** — Usually 22
   - **SSH User** — root or dedicated user
   - **SSH Key Path** — Path to private key on panel server
   - **Max Servers** — Limit for this node
   - **Max RAM** — Total RAM available (MB)
   - **Game Server Path** — Where servers are installed
   - **Location** — Physical location
   - **Provider** — Hosting provider

### Node Heartbeat API

Remote nodes can send health metrics to the panel:

```bash
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

---

## 🔔 Discord Webhook Notifications

### Setting Up Webhooks

1. **Create a Discord Webhook:**
   - Open Discord → Server Settings → Integrations → Webhooks
   - Click "New Webhook"
   - Choose the channel for notifications
   - Copy the Webhook URL

2. **Configure in Panel:**
   - When creating a server, expand "Discord Notifications"
   - Paste your webhook URL
   - Select which events to notify

### Notification Events

| Event | Color | Description |
|-------|-------|-------------|
| 🆕 Server Created | Green | Server has been created |
| ▶️ Server Started | Blue | Server is now online |
| ⏹️ Server Stopped | Amber | Server has been stopped |
| 🔄 Server Restarted | Purple | Server is restarting |
| 💥 Server Crashed | Red | Server crashed unexpectedly |

---

## 🌐 IPv6 Configuration

### Enable IPv6 on Your Server

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

---

## 🧹 RAM Buffer Management

The panel includes automatic RAM buffer/cache monitoring:

- **Threshold:** Configurable (default 80%)
- **Auto-detection:** Monitors `/proc/meminfo`
- **One-click clearing:** Admin can clear caches via the Monitor panel

### Automatic Buffer Clearing (Cron)

```bash
# Clear buffers when usage exceeds 80% (every 5 minutes)
(crontab -l 2>/dev/null; echo "*/5 * * * * free | awk '/Mem/{if(\$6/\$2*100 > 80) system(\"sync && echo 3 > /proc/sys/vm/drop_caches\")}'") | crontab -
```

---

## 🗄️ Database Manager

The built-in database manager provides:

- **Table browser** — View all tables with row counts
- **Data editor** — Edit rows inline, insert, delete
- **Structure viewer** — View column types, nullability, defaults
- **SQL query editor** — Execute raw SQL with results display
- **Keyboard shortcut:** Ctrl+Enter to execute queries

Access from the admin sidebar (admin role required).

---

## 🔧 Troubleshooting

### SteamCMD Issues

**"/usr/local/bin/linux32/steamcmd: No such file or directory":**

This means you used `ln -sf` to create a symlink. SteamCMD doesn't work as a symlink.
Fix it by replacing the symlink with a wrapper script:

```bash
# Remove the broken symlink
sudo rm -f /usr/local/bin/steamcmd

# Create a wrapper script instead
sudo bash -c 'cat > /usr/local/bin/steamcmd << "WRAPPER"
#!/bin/bash
cd /opt/steamcmd && exec ./steamcmd.sh "$@"
WRAPPER'
sudo chmod +x /usr/local/bin/steamcmd

# Test
steamcmd +quit
```

**"Permission denied" error:**
```bash
sudo chmod +x /opt/steamcmd/steamcmd.sh
sudo chmod +x /opt/steamcmd/linux32/steamcmd
sudo chmod +x /usr/local/bin/steamcmd
```

**"Download of package failed" or update errors:**
```bash
# Clean cache and retry
rm -rf ~/Steam /opt/steamcmd/package
steamcmd +quit
```

**32-bit library missing:**
```bash
sudo dpkg --add-architecture i386
sudo apt update
sudo apt install -y lib32gcc-s1 lib32stdc++6
```

### PM2 Issues

**"EACCES permission denied" when installing:**
```bash
sudo npm install -g pm2
```

**PM2 not auto-starting on reboot:**
```bash
pm2 startup
# Run the command it outputs!
pm2 save
```

### Database Connection Issues

**"ECONNREFUSED" error:**
```bash
# Check PostgreSQL status
sudo systemctl status postgresql
sudo systemctl start postgresql
```

**"password authentication failed":**
```bash
# Reset password
sudo -u postgres psql -c "ALTER USER gsmadmin WITH PASSWORD 'new_password';"
# Update .env file with new password
```

### Panel Not Loading

**Check if running:**
```bash
pm2 status
pm2 logs gsm-panel
```

**Check port 3000:**
```bash
sudo lsof -i :3000
curl http://localhost:3000/api/health
```

**Firewall:**
```bash
sudo ufw allow 3000/tcp
# or
sudo iptables -A INPUT -p tcp --dport 3000 -j ACCEPT
```

### Caddy Issues

**Check status:**
```bash
sudo systemctl status caddy
sudo journalctl -u caddy -f
```

**Validate config:**
```bash
caddy validate --config /etc/caddy/Caddyfile
```

---

## 📁 Project Structure

```
gsm-panel/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── auth/          # Authentication
│   │   │   ├── database/      # DB viewer/editor
│   │   │   ├── forum/         # Forum system
│   │   │   ├── games/         # Game definitions
│   │   │   ├── install/       # Web installer
│   │   │   ├── monitor/       # System monitoring
│   │   │   ├── nodes/         # Multi-node management
│   │   │   ├── servers/       # Game server CRUD
│   │   │   └── templates/     # Game templates
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── components/
│   │   ├── panels/            # Dashboard panels
│   │   ├── Dashboard.tsx
│   │   ├── InstallWizard.tsx
│   │   └── LoginForm.tsx
│   ├── db/
│   │   ├── index.ts           # Database connection
│   │   ├── schema.ts          # Drizzle ORM schema
│   │   └── seeds.ts           # Game templates
│   └── lib/
│       ├── auth.ts            # JWT utilities
│       └── discord.ts         # Webhook utilities
├── .env                       # Environment config
├── package.json
└── README.md
```

---

## 🔒 Security Notes

- Change `JWT_SECRET` in production (auto-generated during setup)
- Use strong PostgreSQL passwords
- Enable SSL/TLS via Caddy reverse proxy
- Database manager is admin-only
- Buffer clearing requires admin role
- First registered user gets admin role

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
