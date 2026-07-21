# 🎮 GamePanel — Game Server Hosting CMS

A modern, full-featured game server hosting panel built with Next.js 16, PostgreSQL, and Drizzle ORM. Deploy and manage game servers with automatic file installation, community forums, and a beautiful dark gaming theme.

![GamePanel](https://img.shields.io/badge/version-1.0.0-blue.svg)
![Next.js](https://img.shields.io/badge/Next.js-16.2.6-black.svg)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15+-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

---

## ✨ Features

- **🚀 Web-Based Installer** — Guided setup wizard with automatic database seeding
- **🖥️ Game Server Management** — Create, start, stop, restart, and configure servers
- **📦 Automatic Game Installation** — SteamCMD integration for 8+ popular games
- **💬 Community Forum** — Built-in discussion boards with categories and replies
- **👥 User Management** — Role-based access control (Admin/User)
- **🌐 Multi-Node Support** — Manage servers across multiple physical nodes
- **📊 Admin Dashboard** — System statistics and management tools
- **🎨 Modern Dark Theme** — Glass-morphism UI with gaming aesthetics

### Supported Games

| Game | Steam App ID | Default Port |
|------|-------------|--------------|
| Counter-Strike 2 | 730 | 27015 |
| Minecraft Java | — | 25565 |
| Rust | 258550 | 28015 |
| ARK: Survival Evolved | 376030 | 7777 |
| Garry's Mod | 4020 | 27015 |
| Valheim | 896660 | 2456 |
| Team Fortress 2 | 232250 | 27015 |
| 7 Days to Die | 294420 | 26900 |
| ET: Legacy | — | 27960 |
| OpenRA | — | 1234 |
| Palworld | 2394010 | 8211 |
| Satisfactory | 1690800 | 7777 |
| Terraria | 105600 | 7777 |

---

## 📋 Requirements

### System Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| CPU | 1 vCPU | 2+ vCPU |
| RAM | 1 GB | 2+ GB |
| Disk | 10 GB | 20+ GB SSD |
| OS | Ubuntu 20.04+ / Debian 11+ / CentOS 8+ | Ubuntu 22.04 LTS |

### Software Requirements

- **Node.js** 18.17+ (LTS recommended)
- **PostgreSQL** 14+ 
- **npm** 9+ or **yarn** 1.22+
- **Git** 2.x

---

## 🚀 Installation Guide

### Step 1: Prepare Your Server

#### Ubuntu/Debian

```bash
# Update system packages
sudo apt update && sudo apt upgrade -y

# Install essential tools
sudo apt install -y curl wget git build-essential

# Install Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify installation
node --version  # Should show v20.x.x
npm --version   # Should show 10.x.x
```

#### CentOS/RHEL/Rocky Linux

```bash
# Update system
sudo dnf update -y

# Install essential tools
sudo dnf install -y curl wget git

# Install Node.js 20 LTS
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo dnf install -y nodejs

# Verify installation
node --version
npm --version
```

---

### Step 2: Install PostgreSQL

#### Ubuntu/Debian

```bash
# Install PostgreSQL
sudo apt install -y postgresql postgresql-contrib

# Start and enable PostgreSQL
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Create database and user
sudo -u postgres psql << EOF
CREATE USER gamepanel WITH PASSWORD 'your_secure_password';
CREATE DATABASE gamepanel_db OWNER gamepanel;
GRANT ALL PRIVILEGES ON DATABASE gamepanel_db TO gamepanel;
\q
EOF
```

#### CentOS/RHEL/Rocky Linux

```bash
# Install PostgreSQL
sudo dnf install -y postgresql-server postgresql-contrib

# Initialize database
sudo postgresql-setup --initdb

# Start and enable PostgreSQL
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Create database and user
sudo -u postgres psql << EOF
CREATE USER gamepanel WITH PASSWORD 'your_secure_password';
CREATE DATABASE gamepanel_db OWNER gamepanel;
GRANT ALL PRIVILEGES ON DATABASE gamepanel_db TO gamepanel;
\q
EOF
```

#### Configure PostgreSQL Authentication

Edit `/etc/postgresql/*/main/pg_hba.conf` (Ubuntu) or `/var/lib/pgsql/data/pg_hba.conf` (CentOS):

```bash
# Find and edit pg_hba.conf
sudo nano /etc/postgresql/*/main/pg_hba.conf
```

Add or modify this line to allow password authentication:

```
# IPv4 local connections:
host    all             all             127.0.0.1/32            md5
```

Restart PostgreSQL:

```bash
sudo systemctl restart postgresql
```

---

### Step 3: Download GamePanel

```bash
# Create application directory
sudo mkdir -p /var/www/gamepanel
sudo chown $USER:$USER /var/www/gamepanel

# Clone the repository
cd /var/www/gamepanel
git clone https://github.com/phillgates2/game-server-hosting-cms.git .
```

---

### Step 4: Configure Environment

```bash
# Copy example environment file
cp .env.example .env

# Or create new .env file
nano .env
```

Add the following configuration to `.env`:

```env
# Database Configuration
DATABASE_URL="postgresql://gamepanel:your_secure_password@127.0.0.1:5432/gamepanel_db"

# Application Settings
NODE_ENV=production
PORT=3000

# Security (generate a random 32+ character string)
JWT_SECRET="your-super-secure-jwt-secret-key-here-minimum-32-chars"

# Optional: Domain configuration for production
# NEXT_PUBLIC_APP_URL=https://panel.yourdomain.com
```

Generate a secure JWT secret:

```bash
# Generate random secret
openssl rand -base64 32
```

---

### Step 5: Install Dependencies

```bash
cd /var/www/gamepanel

# Install Node.js dependencies
npm install

# Or using yarn
# yarn install
```

---

### Step 6: Initialize Database

```bash
# Push database schema
npx drizzle-kit push

# Verify tables were created
psql postgresql://gamepanel:your_secure_password@127.0.0.1:5432/gamepanel_db -c "\dt"
```

Expected output:

```
              List of relations
 Schema |       Name        | Type  |   Owner   
--------+-------------------+-------+-----------
 public | activity_log      | table | gamepanel
 public | forum_categories  | table | gamepanel
 public | forum_posts       | table | gamepanel
 public | forum_topics      | table | gamepanel
 public | game_servers      | table | gamepanel
 public | games             | table | gamepanel
 public | nodes             | table | gamepanel
 public | plans             | table | gamepanel
 public | site_settings     | table | gamepanel
 public | ticket_replies    | table | gamepanel
 public | tickets           | table | gamepanel
 public | users             | table | gamepanel
```

---

### Step 7: Build for Production

```bash
# Build the application
npm run build
```

This will create an optimized production build in the `.next` directory.

---

### Step 8: Start the Application

#### Option A: Direct Start (Testing)

```bash
# Start production server
npm run start

# Application will be available at http://your-server-ip:3000
```

#### Option B: Using PM2 (Recommended for Production)

```bash
# Install PM2 globally
sudo npm install -g pm2

# Start with PM2
pm2 start npm --name "gamepanel" -- start

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup
# Follow the instructions provided by the command above
```

PM2 Management Commands:

```bash
pm2 status          # Check status
pm2 logs gamepanel  # View logs
pm2 restart gamepanel  # Restart
pm2 stop gamepanel  # Stop
pm2 delete gamepanel  # Remove from PM2
```

---

### Step 9: Configure Reverse Proxy (Optional but Recommended)

#### Nginx

```bash
# Install Nginx
sudo apt install -y nginx  # Ubuntu/Debian
# sudo dnf install -y nginx  # CentOS

# Create site configuration
sudo nano /etc/nginx/sites-available/gamepanel
```

Add the following configuration:

```nginx
server {
    listen 80;
    server_name panel.yourdomain.com;  # Replace with your domain

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
    }
}
```

Enable the site and restart Nginx:

```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/gamepanel /etc/nginx/sites-enabled/

# Test configuration
sudo nginx -t

# Restart Nginx
sudo systemctl restart nginx
sudo systemctl enable nginx
```

#### Setup SSL with Let's Encrypt (Recommended)

```bash
# Install Certbot
sudo apt install -y certbot python3-certbot-nginx

# Obtain SSL certificate
sudo certbot --nginx -d panel.yourdomain.com

# Auto-renewal is configured automatically
# Test renewal with:
sudo certbot renew --dry-run
```

---

### Step 10: Complete Web Installation

1. **Open your browser** and navigate to:
   - `http://your-server-ip:3000` (direct)
   - `https://panel.yourdomain.com` (with reverse proxy)

2. **Follow the Installation Wizard**:
   - **Step 1**: Welcome screen — Click "Begin Installation"
   - **Step 2**: Enter your site name
   - **Step 3**: Create admin account (username, email, password)
   - **Step 4**: Watch the installation progress

3. **Installation Complete!** You'll be redirected to the dashboard.

---

## 🔧 Post-Installation

### Configure Firewall

```bash
# Ubuntu/Debian (UFW)
sudo ufw allow 22/tcp      # SSH
sudo ufw allow 80/tcp      # HTTP
sudo ufw allow 443/tcp     # HTTPS
sudo ufw allow 3000/tcp    # Direct access (if needed)
sudo ufw enable

# CentOS (firewalld)
sudo firewall-cmd --permanent --add-service=ssh
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --permanent --add-port=3000/tcp
sudo firewall-cmd --reload
```

### Setup Automatic Backups

Create a backup script:

```bash
sudo nano /usr/local/bin/backup-gamepanel.sh
```

```bash
#!/bin/bash
BACKUP_DIR="/var/backups/gamepanel"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

# Backup database
pg_dump -U gamepanel -h 127.0.0.1 gamepanel_db > $BACKUP_DIR/db_$DATE.sql

# Backup application files
tar -czf $BACKUP_DIR/files_$DATE.tar.gz /var/www/gamepanel/.env

# Keep only last 7 days of backups
find $BACKUP_DIR -type f -mtime +7 -delete

echo "Backup completed: $DATE"
```

```bash
# Make executable
sudo chmod +x /usr/local/bin/backup-gamepanel.sh

# Add to crontab (daily at 2 AM)
echo "0 2 * * * /usr/local/bin/backup-gamepanel.sh" | sudo crontab -
```

---

## 📖 Usage Guide

### Admin Login

After installation, log in with the admin credentials you created during setup.

### Creating a Game Server

1. Navigate to **Servers** → **Create Server**
2. Select a game from the grid
3. Enter server name and player slots
4. Click **Deploy & Auto-Install Server**
5. Watch the installation progress
6. Server is ready to manage!

### Managing Servers

From the server detail page, you can:
- **Start/Stop/Restart** the server
- View **Console** output and send commands
- Edit **Configuration** settings
- Browse **Files** on the server
- **Reinstall** or **Delete** the server

### Forum Management

- Create topics in any category
- Reply to discussions
- Admins can pin/lock topics

---

## 🔄 Updating GamePanel

```bash
cd /var/www/gamepanel

# Stop the application
pm2 stop gamepanel

# Backup current installation
cp .env .env.backup

# Pull latest changes
git pull origin main

# Install updated dependencies
npm install

# Apply database migrations
npx drizzle-kit push

# Rebuild application
npm run build

# Restart application
pm2 restart gamepanel
```

---

## 🐛 Troubleshooting

### Application won't start

```bash
# Check logs
pm2 logs gamepanel --lines 100

# Verify environment variables
cat .env

# Test database connection
psql $DATABASE_URL -c "SELECT 1"
```

### Database connection errors

```bash
# Check PostgreSQL is running
sudo systemctl status postgresql

# Verify authentication settings
sudo cat /etc/postgresql/*/main/pg_hba.conf | grep -v "^#"

# Test connection manually
psql -U gamepanel -h 127.0.0.1 -d gamepanel_db
```

### Port already in use

```bash
# Find what's using port 3000
sudo lsof -i :3000

# Kill the process
sudo kill -9 <PID>
```

### Permission issues

```bash
# Fix ownership
sudo chown -R $USER:$USER /var/www/gamepanel

# Fix permissions
chmod -R 755 /var/www/gamepanel
```

### Reset installation

```bash
# Connect to database and clear settings
psql $DATABASE_URL -c "DELETE FROM site_settings WHERE key = 'installed';"

# Restart application
pm2 restart gamepanel

# Visit the site to run installer again
```

---

## 📁 Directory Structure

```
/var/www/gamepanel/
├── .env                    # Environment configuration
├── .next/                  # Next.js build output
├── node_modules/           # Dependencies
├── public/                 # Static assets
├── src/
│   ├── app/               # Next.js App Router pages
│   │   ├── (panel)/       # Authenticated panel routes
│   │   ├── api/           # API routes
│   │   ├── install/       # Installation wizard
│   │   ├── login/         # Login page
│   │   └── register/      # Registration page
│   ├── components/        # React components
│   ├── db/                # Database schema and connection
│   └── lib/               # Utility functions
├── drizzle.config.json    # Drizzle ORM configuration
├── package.json           # Node.js dependencies
└── README.md              # This file
```

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

---

## 💬 Support

- **Documentation**: [Wiki](https://github.com/phillgates2/game-server-hosting-cms/wiki)
- **Issues**: [GitHub Issues](https://github.com/phillgates2/game-server-hosting-cms/issues)
- **Repository**: [GitHub](https://github.com/phillgates2/game-server-hosting-cms)

---

## 📜 Seed Scripts

GamePanel includes seed scripts to add or update game configurations:

### Seed All Games

```bash
npm run seed:all
```

### Seed ET: Legacy Only

```bash
npm run seed:etlegacy
```

### Seed OpenRA Only

```bash
npm run seed:openra
```

### Seed Palworld Only

```bash
npm run seed:palworld
```

### Seed Satisfactory Only

```bash
npm run seed:satisfactory
```

### Seed Terraria Only

```bash
npm run seed:terraria
```

### Manual Database Commands

```bash
# Push schema changes
npm run db:push

# Open Drizzle Studio (database viewer)
npm run db:studio
```

---

## 🪖 ET: Legacy Configuration

ET: Legacy (Wolfenstein: Enemy Territory) is fully supported with automatic installation.

### Server Ports

| Port | Protocol | Description |
|------|----------|-------------|
| 27960 | UDP | Game server |
| 27960 | TCP | Query port |

### Default Maps

- `oasis` - Classic objective map
- `goldrush` - Steal the Nazi gold
- `battery` - Coastal defense
- `radar` - Destroy radar equipment
- `railgun` - Rail gun destruction
- `fuel_dump` - Fuel depot assault

### Gametypes

| ID | Mode | Description |
|----|------|-------------|
| 2 | Objective | Single-map objective |
| 3 | Stopwatch | Timed competitive mode |
| 4 | Campaign | Multi-map campaign (default) |
| 5 | LMS | Last Man Standing |

### Configuration Variables

```cfg
// Server identity
set sv_hostname "My ET Server"
set sv_maxclients 32

// Passwords
set g_password ""
set rconPassword "secret"
set refereePassword ""

// Gameplay
set g_gametype 4
set g_antilag 1
set g_friendlyFire 1
set g_teamforcebalance 1

// Downloads
set sv_allowDownload 1
set sv_dl_maxRate 42000
```

---

## 🎖️ OpenRA Configuration

OpenRA is an open-source RTS engine that recreates classic Westwood games.

### Available Mods

| Mod ID | Game | Description |
|--------|------|-------------|
| `ra` | Red Alert | Cold War alternate history RTS |
| `td` | Tiberian Dawn | Original Command & Conquer |
| `d2k` | Dune 2000 | Sci-fi RTS on Arrakis |

### Server Ports

| Port | Protocol | Description |
|------|----------|-------------|
| 1234 | UDP | Game server (default) |

### Configuration Options

```yaml
Server:
  Name: "My OpenRA Server"
  ListenPort: 1234
  ExternalPort: 1234           # For NAT traversal
  AdvertiseOnline: true        # List on master server
  Password: ""                 # Empty = public
  RequireAuthentication: false # Require OpenRA account
  Map: "random"                # Map hash or "random"
```

### Game Speeds

| Speed | Multiplier |
|-------|------------|
| `slowest` | 40% |
| `slower` | 60% |
| `default` | 100% |
| `fast` | 125% |
| `faster` | 150% |
| `fastest` | 200% |

### Running Different Mods

To run a specific mod, update the `mod` config setting:

```bash
# Red Alert (default)
./start-ra.sh

# Tiberian Dawn  
./start-td.sh

# Dune 2000
./start-d2k.sh
```

### Firewall Rules

```bash
# Allow OpenRA server port
sudo ufw allow 1234/udp
```

---

## 🦊 Palworld Configuration

Palworld is a multiplayer creature-collection survival game.

### Server Ports

| Port | Protocol | Description |
|------|----------|-------------|
| 8211 | UDP | Game server |
| 25575 | TCP | RCON (optional) |

### Key Settings

```ini
[/Script/Pal.PalGameWorldSettings]
ServerName="My Palworld Server"
ServerPassword=""
AdminPassword="admin123"
ServerPlayerMaxNum=32
PublicPort=8211
RCONEnabled=True
RCONPort=25575
bIsPvP=False
DeathPenalty=All
ExpRate=1.0
PalCaptureRate=1.0
```

### Death Penalty Options

| Value | Description |
|-------|-------------|
| `None` | No penalty |
| `Item` | Drop items |
| `ItemAndEquipment` | Drop items & equipment |
| `All` | Drop everything |

### RCON Commands

```
/Shutdown {Seconds} {Message}
/Broadcast {Message}
/KickPlayer {SteamID}
/BanPlayer {SteamID}
/Save
```

---

## 🏭 Satisfactory Configuration

Satisfactory is a first-person factory building game.

### Server Ports

| Port | Protocol | Description |
|------|----------|-------------|
| 7777 | UDP | Game server |
| 15000 | UDP | Beacon port |
| 15777 | UDP | Query port |

### Config Files

```
FactoryGame/Saved/Config/LinuxServer/
├── Engine.ini          # Network settings
├── Game.ini            # Max players
├── GameUserSettings.ini # Autosave
└── ServerSettings.ini   # Server name/password
```

### Firewall Rules

```bash
sudo ufw allow 7777/udp
sudo ufw allow 15000/udp
sudo ufw allow 15777/udp
```

---

## ⛏️ Terraria Configuration

Terraria is a 2D sandbox adventure game.

### Server Port

| Port | Protocol | Description |
|------|----------|-------------|
| 7777 | TCP | Game server |

### World Sizes

| Value | Size | Dimensions |
|-------|------|------------|
| 1 | Small | 4200 × 1200 |
| 2 | Medium | 6400 × 1800 |
| 3 | Large | 8400 × 2400 |

### Difficulty Levels

| Value | Mode |
|-------|------|
| 0 | Classic/Normal |
| 1 | Expert |
| 2 | Master |
| 3 | Journey |

### Server Commands

```
help              - Show commands
playing           - Show online players
kick <player>     - Kick player
ban <player>      - Ban player
password <pw>     - Set password
save              - Save world
exit              - Save and shutdown
say <message>     - Broadcast message
dawn/noon/dusk/midnight - Set time
```

### Config File (serverconfig.txt)

```ini
world=/servers/{id}/Worlds/World1.wld
autocreate=2
worldname=World1
maxplayers=16
port=7777
password=
motd=Welcome to Terraria!
difficulty=0
secure=1
```

---

## 🙏 Acknowledgments

- [Next.js](https://nextjs.org/) — React framework
- [Drizzle ORM](https://orm.drizzle.team/) — TypeScript ORM
- [Tailwind CSS](https://tailwindcss.com/) — Utility-first CSS
- [PostgreSQL](https://www.postgresql.org/) — Database
- [ET: Legacy](https://www.etlegacy.com/) — Open-source Wolfenstein: Enemy Territory
- [OpenRA](https://www.openra.net/) — Open-source Command & Conquer engine

---

<p align="center">
  Made with ❤️ by the GamePanel Team
</p>
