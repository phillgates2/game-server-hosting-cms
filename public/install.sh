#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
#  GameServer Manager — One-Liner Installer
# ═══════════════════════════════════════════════════════════════════════════════
#
#  Usage (run as root or with sudo):
#
#    bash <(curl -fsSL https://your-domain.com/install.sh)
#
#  Or with options:
#
#    bash <(curl -fsSL https://your-domain.com/install.sh) \
#      --admin-user admin \
#      --admin-email admin@example.com \
#      --admin-pass 'YourSecurePassword123!' \
#      --panel-name 'My Game Servers' \
#      --domain gs.example.com \
#      --port 3000
#
#  What this script does:
#    1. Installs system dependencies (Node.js 22, PostgreSQL 16, Git, PM2)
#    2. Creates a dedicated 'gsm' system user
#    3. Creates the PostgreSQL database & role
#    4. Clones the GameServer Manager repository
#    5. Installs npm packages & builds the production app
#    6. Generates a secure JWT secret
#    7. Runs the panel's database install (schema + admin user + seeds)
#    8. Sets up PM2 with systemd for auto-start on boot
#    9. (Optional) Configures Caddy reverse proxy with automatic HTTPS
#
#  Supported OS: Ubuntu 22.04+, Debian 12+
#  Minimum: 1 vCPU, 1 GB RAM, 10 GB disk
#
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

# ── Colors & helpers ──────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log()   { echo -e "${CYAN}[GSM]${NC} $*"; }
ok()    { echo -e "${GREEN}[✓]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
err()   { echo -e "${RED}[✗]${NC} $*" >&2; }
die()   { err "$*"; exit 1; }

banner() {
  echo ""
  echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║${NC}  ${BOLD}🎮  GameServer Manager — Installer${NC}                         ${CYAN}║${NC}"
  echo -e "${CYAN}║${NC}     Modern Game Server Hosting Panel                        ${CYAN}║${NC}"
  echo -e "${CYAN}║${NC}     github.com/phillgates2/game-server-hosting-cms          ${CYAN}║${NC}"
  echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
  echo ""
}

# ── Default configuration ─────────────────────────────────────────────────────
REPO_URL="https://github.com/phillgates2/game-server-hosting-cms.git"
INSTALL_DIR="/opt/gsm-panel"
GSM_USER="gsm"
DB_NAME="gsm_panel"
DB_USER="gsm"
DB_PASS=""
PANEL_PORT="3000"
PANEL_NAME="GameServer Manager"
ADMIN_USER=""
ADMIN_EMAIL=""
ADMIN_PASS=""
DOMAIN=""
JWT_SECRET=""
SETUP_CADDY="false"
NONINTERACTIVE="false"
NODE_MAJOR="22"

# ── Parse command-line arguments ──────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --admin-user)     ADMIN_USER="$2";    shift 2 ;;
    --admin-email)    ADMIN_EMAIL="$2";   shift 2 ;;
    --admin-pass)     ADMIN_PASS="$2";    shift 2 ;;
    --panel-name)     PANEL_NAME="$2";    shift 2 ;;
    --domain)         DOMAIN="$2";        shift 2 ;;
    --port)           PANEL_PORT="$2";    shift 2 ;;
    --db-name)        DB_NAME="$2";       shift 2 ;;
    --db-user)        DB_USER="$2";       shift 2 ;;
    --db-pass)        DB_PASS="$2";       shift 2 ;;
    --install-dir)    INSTALL_DIR="$2";   shift 2 ;;
    --jwt-secret)     JWT_SECRET="$2";    shift 2 ;;
    --caddy)          SETUP_CADDY="true"; shift   ;;
    --noninteractive) NONINTERACTIVE="true"; shift ;;
    -y)               NONINTERACTIVE="true"; shift ;;
    --help|-h)
      banner
      echo "Usage: bash install.sh [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --admin-user     USERNAME    Admin username (default: prompted)"
      echo "  --admin-email    EMAIL       Admin email (default: prompted)"
      echo "  --admin-pass     PASSWORD    Admin password (default: prompted)"
      echo "  --panel-name     NAME        Panel display name (default: GameServer Manager)"
      echo "  --domain         DOMAIN      Domain name for Caddy reverse proxy (e.g., gs.example.com)"
      echo "  --port           PORT        Panel port (default: 3000)"
      echo "  --db-name        NAME        PostgreSQL database name (default: gsm_panel)"
      echo "  --db-user        USER        PostgreSQL user (default: gsm)"
      echo "  --db-pass        PASSWORD    PostgreSQL password (default: auto-generated)"
      echo "  --install-dir    PATH        Installation directory (default: /opt/gsm-panel)"
      echo "  --jwt-secret     SECRET      JWT signing secret (default: auto-generated)"
      echo "  --caddy                      Set up Caddy reverse proxy with automatic HTTPS"
      echo "  --noninteractive, -y         Skip all prompts; use defaults/flags"
      echo "  --help, -h                   Show this help"
      echo ""
      echo "One-liner:"
      echo "  bash <(curl -fsSL https://your-domain.com/install.sh)"
      echo ""
      echo "Examples:"
      echo "  # Interactive (prompts for everything)"
      echo "  bash install.sh"
      echo ""
      echo "  # Fully automated with Caddy + automatic HTTPS"
      echo "  bash install.sh \\"
      echo "    --admin-user admin \\"
      echo "    --admin-email admin@example.com \\"
      echo "    --admin-pass 'SecurePass123!' \\"
      echo "    --domain gs.example.com \\"
      echo "    --caddy -y"
      echo ""
      exit 0
      ;;
    *) die "Unknown option: $1  (use --help for usage)" ;;
  esac
done

# ── Root check ────────────────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  die "This installer must be run as root. Use:  sudo bash install.sh"
fi

banner

# ── Detect OS ─────────────────────────────────────────────────────────────────
if [[ -f /etc/os-release ]]; then
  . /etc/os-release
  OS_ID="${ID}"
  OS_VERSION="${VERSION_ID}"
else
  die "Cannot detect OS. This installer supports Ubuntu 22.04+ and Debian 12+."
fi

case "$OS_ID" in
  ubuntu)
    if [[ "${OS_VERSION%%.*}" -lt 22 ]]; then
      die "Ubuntu $OS_VERSION is not supported. Minimum: Ubuntu 22.04"
    fi
    ;;
  debian)
    if [[ "${OS_VERSION%%.*}" -lt 12 ]]; then
      die "Debian $OS_VERSION is not supported. Minimum: Debian 12"
    fi
    ;;
  *)
    warn "Untested OS: $OS_ID $OS_VERSION — proceeding anyway (may not work)"
    ;;
esac

log "Detected OS: $OS_ID $OS_VERSION"

# ── Interactive prompts (if not all values provided) ──────────────────────────
if [[ "$NONINTERACTIVE" != "true" ]]; then
  echo ""
  echo -e "${BOLD}Panel Configuration${NC}"
  echo "───────────────────────────────────────────"

  if [[ -z "$ADMIN_USER" ]]; then
    read -rp "  Admin username [admin]: " ADMIN_USER
    ADMIN_USER="${ADMIN_USER:-admin}"
  fi

  if [[ -z "$ADMIN_EMAIL" ]]; then
    read -rp "  Admin email [admin@localhost]: " ADMIN_EMAIL
    ADMIN_EMAIL="${ADMIN_EMAIL:-admin@localhost}"
  fi

  if [[ -z "$ADMIN_PASS" ]]; then
    while true; do
      read -rsp "  Admin password (min 8 chars): " ADMIN_PASS
      echo ""
      if [[ ${#ADMIN_PASS} -lt 8 ]]; then
        warn "Password must be at least 8 characters"
        continue
      fi
      read -rsp "  Confirm password: " ADMIN_PASS_CONFIRM
      echo ""
      if [[ "$ADMIN_PASS" != "$ADMIN_PASS_CONFIRM" ]]; then
        warn "Passwords do not match"
        continue
      fi
      break
    done
  fi

  read -rp "  Panel name [$PANEL_NAME]: " input
  PANEL_NAME="${input:-$PANEL_NAME}"

  read -rp "  Panel port [$PANEL_PORT]: " input
  PANEL_PORT="${input:-$PANEL_PORT}"

  read -rp "  Domain name (blank for IP access): " input
  DOMAIN="${input:-$DOMAIN}"

  if [[ -n "$DOMAIN" ]]; then
    read -rp "  Set up Caddy reverse proxy with automatic HTTPS? [Y/n]: " input
    if [[ "${input,,}" != "n" ]]; then
      SETUP_CADDY="true"
    fi
  fi

  echo ""
  echo -e "${BOLD}Review Configuration${NC}"
  echo "───────────────────────────────────────────"
  echo "  Admin:       $ADMIN_USER ($ADMIN_EMAIL)"
  echo "  Panel:       $PANEL_NAME"
  echo "  Port:        $PANEL_PORT"
  echo "  Domain:      ${DOMAIN:-<none — access via IP>}"
  echo "  Caddy:       $SETUP_CADDY"
  echo "  Install to:  $INSTALL_DIR"
  echo "───────────────────────────────────────────"
  echo ""
  read -rp "  Proceed with installation? [Y/n]: " input
  if [[ "${input,,}" == "n" ]]; then
    log "Installation cancelled."
    exit 0
  fi
else
  # Non-interactive defaults
  ADMIN_USER="${ADMIN_USER:-admin}"
  ADMIN_EMAIL="${ADMIN_EMAIL:-admin@localhost}"
  if [[ -z "$ADMIN_PASS" ]]; then
    ADMIN_PASS="$(openssl rand -base64 16 | tr -d '=/+')"
    warn "Auto-generated admin password: $ADMIN_PASS"
  fi
fi

# ── Auto-generate secrets ────────────────────────────────────────────────────
if [[ -z "$DB_PASS" ]]; then
  DB_PASS="$(openssl rand -base64 32 | tr -d '=/+')"
fi
if [[ -z "$JWT_SECRET" ]]; then
  JWT_SECRET="$(openssl rand -base64 48 | tr -d '=/+')"
fi

TOTAL_STEPS=9
STEP=0

step() {
  STEP=$((STEP + 1))
  echo ""
  echo -e "${CYAN}━━━ Step $STEP/$TOTAL_STEPS: $1 ━━━${NC}"
}

# ═══════════════════════════════════════════════════════════════════════════════
#  STEP 1: System packages
# ═══════════════════════════════════════════════════════════════════════════════
step "Installing system dependencies"

export DEBIAN_FRONTEND=noninteractive

log "Updating package lists..."
apt-get update -qq

log "Installing base packages..."
apt-get install -y -qq \
  curl wget gnupg2 ca-certificates lsb-release \
  git build-essential software-properties-common \
  ufw fail2ban \
  > /dev/null 2>&1
ok "Base packages installed"

# ═══════════════════════════════════════════════════════════════════════════════
#  STEP 2: Node.js 22
# ═══════════════════════════════════════════════════════════════════════════════
step "Installing Node.js $NODE_MAJOR"

if command -v node &>/dev/null; then
  CURRENT_NODE="$(node -v | sed 's/v//' | cut -d. -f1)"
  if [[ "$CURRENT_NODE" -ge "$NODE_MAJOR" ]]; then
    ok "Node.js $(node -v) already installed"
  else
    warn "Node.js v$CURRENT_NODE found, upgrading to v$NODE_MAJOR..."
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - > /dev/null 2>&1
    apt-get install -y -qq nodejs > /dev/null 2>&1
    ok "Node.js $(node -v) installed"
  fi
else
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - > /dev/null 2>&1
  apt-get install -y -qq nodejs > /dev/null 2>&1
  ok "Node.js $(node -v) installed"
fi

# Install PM2 globally
if ! command -v pm2 &>/dev/null; then
  npm install -g pm2 > /dev/null 2>&1
  ok "PM2 installed"
else
  ok "PM2 already installed"
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  STEP 3: PostgreSQL
# ═══════════════════════════════════════════════════════════════════════════════
step "Installing & configuring PostgreSQL"

if ! command -v psql &>/dev/null; then
  # Add PostgreSQL APT repo for latest version
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    | gpg --dearmor -o /usr/share/keyrings/postgresql-archive-keyring.gpg 2>/dev/null
  echo "deb [signed-by=/usr/share/keyrings/postgresql-archive-keyring.gpg] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list
  apt-get update -qq
  apt-get install -y -qq postgresql postgresql-contrib > /dev/null 2>&1
fi

# Ensure PostgreSQL is running
systemctl enable --now postgresql > /dev/null 2>&1
ok "PostgreSQL $(psql --version | grep -oP '\d+\.\d+') running"

# Create database user & database
log "Creating database role '$DB_USER' and database '$DB_NAME'..."
su - postgres -c "psql -tc \"SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'\" | grep -q 1" 2>/dev/null \
  || su - postgres -c "psql -c \"CREATE ROLE $DB_USER WITH LOGIN PASSWORD '$DB_PASS';\""
su - postgres -c "psql -tc \"SELECT 1 FROM pg_database WHERE datname='$DB_NAME'\" | grep -q 1" 2>/dev/null \
  || su - postgres -c "psql -c \"CREATE DATABASE $DB_NAME OWNER $DB_USER;\""
su - postgres -c "psql -c \"GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;\""

# Grant schema-level privileges for PostgreSQL 15+
PG_MAJOR="$(psql --version | grep -oP '\d+' | head -1)"
if [[ "$PG_MAJOR" -ge 15 ]]; then
  su - postgres -c "psql -d $DB_NAME -c \"GRANT ALL ON SCHEMA public TO $DB_USER;\""
fi

ok "Database '$DB_NAME' ready (user: $DB_USER)"

DATABASE_URL="postgresql://$DB_USER:$(python3 -c "import urllib.parse; print(urllib.parse.quote('$DB_PASS'))")@127.0.0.1:5432/$DB_NAME"

# ═══════════════════════════════════════════════════════════════════════════════
#  STEP 4: Create system user
# ═══════════════════════════════════════════════════════════════════════════════
step "Creating system user '$GSM_USER'"

if id "$GSM_USER" &>/dev/null; then
  ok "User '$GSM_USER' already exists"
else
  useradd -r -m -d /home/$GSM_USER -s /bin/bash "$GSM_USER"
  ok "System user '$GSM_USER' created"
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  STEP 5: Clone repository
# ═══════════════════════════════════════════════════════════════════════════════
step "Cloning GameServer Manager"

if [[ -d "$INSTALL_DIR/.git" ]]; then
  log "Existing installation found, pulling latest..."
  cd "$INSTALL_DIR"
  git pull --ff-only 2>/dev/null || true
else
  if [[ -d "$INSTALL_DIR" ]]; then
    warn "Directory $INSTALL_DIR exists but is not a git repo — backing up"
    mv "$INSTALL_DIR" "${INSTALL_DIR}.bak.$(date +%s)"
  fi
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

chown -R "$GSM_USER:$GSM_USER" "$INSTALL_DIR"
ok "Source code ready at $INSTALL_DIR"

# ═══════════════════════════════════════════════════════════════════════════════
#  STEP 6: Configure environment & install dependencies
# ═══════════════════════════════════════════════════════════════════════════════
step "Installing dependencies & building"

cd "$INSTALL_DIR"

# Write .env file
cat > .env <<ENVEOF
# GameServer Manager — auto-generated by installer
DATABASE_URL=$DATABASE_URL
JWT_SECRET=$JWT_SECRET
NODE_ENV=production
PORT=$PANEL_PORT

# SMTP (optional — configure for email notifications)
# SMTP_HOST=smtp.example.com
# SMTP_PORT=587
# SMTP_USER=your-email@example.com
# SMTP_PASS=your-smtp-password
# SMTP_FROM=noreply@example.com
ENVEOF

chown "$GSM_USER:$GSM_USER" .env
chmod 600 .env

# Update drizzle.config.json to use the real database URL
cat > drizzle.config.json <<DRIZZLE
{
  "dialect": "postgresql",
  "schema": "./src/db/schema.ts",
  "dbCredentials": {
    "url": "$DATABASE_URL"
  }
}
DRIZZLE
chown "$GSM_USER:$GSM_USER" drizzle.config.json

log "Installing npm packages (this may take a minute)..."
su - "$GSM_USER" -c "cd $INSTALL_DIR && npm ci --omit=dev 2>&1 | tail -3"
ok "Dependencies installed"

log "Building production bundle..."
su - "$GSM_USER" -c "cd $INSTALL_DIR && npx next build 2>&1 | tail -5"
ok "Production build complete"

# ═══════════════════════════════════════════════════════════════════════════════
#  STEP 7: Initialize database & run panel install
# ═══════════════════════════════════════════════════════════════════════════════
step "Initializing database"

# Push schema with drizzle-kit
log "Pushing database schema..."
su - "$GSM_USER" -c "cd $INSTALL_DIR && npx drizzle-kit push 2>&1 | tail -3"
ok "Database schema applied"

# Start the app temporarily to run the install API
log "Running panel installation (creating admin user, roles, seeds)..."
su - "$GSM_USER" -c "cd $INSTALL_DIR && PORT=$PANEL_PORT node .next/standalone/server.js &" 2>/dev/null
TEMP_PID=$!

# Wait for server to be ready
for i in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:$PANEL_PORT/api/health" > /dev/null 2>&1; then
    break
  fi
  sleep 1
done

# Call the install API
INSTALL_RESPONSE=$(curl -sf -X POST "http://127.0.0.1:$PANEL_PORT/api/install" \
  -H "Content-Type: application/json" \
  -d "{
    \"adminUsername\": \"$ADMIN_USER\",
    \"adminEmail\": \"$ADMIN_EMAIL\",
    \"adminPassword\": \"$ADMIN_PASS\",
    \"panelName\": \"$PANEL_NAME\"
  }" 2>&1) || true

# Stop temporary server
kill "$TEMP_PID" 2>/dev/null || true
wait "$TEMP_PID" 2>/dev/null || true

if echo "$INSTALL_RESPONSE" | grep -q '"ok":true'; then
  ok "Panel installed successfully"
else
  # If the API approach fails, the panel's web wizard will handle it on first visit
  warn "API install returned: $INSTALL_RESPONSE"
  warn "You can complete setup via the web install wizard on first visit"
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  STEP 8: Set up PM2 & systemd
# ═══════════════════════════════════════════════════════════════════════════════
step "Configuring PM2 process manager"

# Create PM2 ecosystem file
cat > "$INSTALL_DIR/ecosystem.config.cjs" <<'PMEOF'
module.exports = {
  apps: [{
    name: 'gsm-panel',
    cwd: __dirname,
    script: 'node_modules/next/dist/bin/next',
    args: 'start',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '512M',
    env: {
      NODE_ENV: 'production',
    },
    error_file: '/var/log/gsm-panel/error.log',
    out_file: '/var/log/gsm-panel/out.log',
    merge_logs: true,
    time: true,
  }]
};
PMEOF
chown "$GSM_USER:$GSM_USER" "$INSTALL_DIR/ecosystem.config.cjs"

# Create log directory
mkdir -p /var/log/gsm-panel
chown "$GSM_USER:$GSM_USER" /var/log/gsm-panel

# Start with PM2
su - "$GSM_USER" -c "cd $INSTALL_DIR && pm2 start ecosystem.config.cjs"
su - "$GSM_USER" -c "pm2 save"

# Set up PM2 to start on boot via systemd
env PATH=$PATH:/usr/bin pm2 startup systemd -u "$GSM_USER" --hp "/home/$GSM_USER" 2>/dev/null || true

ok "PM2 configured — panel running as 'gsm-panel'"

# ═══════════════════════════════════════════════════════════════════════════════
#  STEP 9: Caddy reverse proxy (optional)
# ═══════════════════════════════════════════════════════════════════════════════
step "Configuring web server"

if [[ "$SETUP_CADDY" == "true" && -n "$DOMAIN" ]]; then
  log "Installing Caddy..."

  # Install Caddy via official APT repository
  apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https > /dev/null 2>&1
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy > /dev/null 2>&1

  ok "Caddy $(caddy version | head -1) installed"

  # Write Caddyfile
  # Caddy handles HTTPS automatically — no Certbot or manual certs needed.
  # If a domain is provided, Caddy will obtain and renew Let's Encrypt
  # certificates automatically. If the domain is an IP or localhost,
  # Caddy serves over plain HTTP.
  log "Writing Caddyfile for $DOMAIN..."
  cat > /etc/caddy/Caddyfile <<CADDYEOF
# GameServer Manager — Caddy reverse proxy
# Automatic HTTPS is handled by Caddy (Let's Encrypt)

$DOMAIN {
    reverse_proxy 127.0.0.1:$PANEL_PORT {
        # WebSocket support (for live logs, RCON, etc.)
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }

    # File upload limit (for server file manager)
    request_body {
        max_size 256MB
    }

    # Compression
    encode gzip zstd

    # Security headers
    header {
        X-Content-Type-Options nosniff
        X-Frame-Options SAMEORIGIN
        Referrer-Policy strict-origin-when-cross-origin
        -Server
    }

    # Logging
    log {
        output file /var/log/caddy/gsm-panel.log {
            roll_size 10mb
            roll_keep 5
        }
    }
}
CADDYEOF

  # Create Caddy log directory
  mkdir -p /var/log/caddy
  chown caddy:caddy /var/log/caddy

  # Validate config
  caddy validate --config /etc/caddy/Caddyfile > /dev/null 2>&1 \
    && ok "Caddyfile validated" \
    || warn "Caddyfile validation had warnings (Caddy may still work)"

  # Enable and start Caddy
  systemctl enable caddy > /dev/null 2>&1
  systemctl restart caddy
  ok "Caddy running — automatic HTTPS enabled for $DOMAIN"
  log "Caddy will automatically obtain and renew SSL certificates from Let's Encrypt"

elif [[ -n "$DOMAIN" ]]; then
  warn "Domain '$DOMAIN' provided but Caddy setup was skipped"
  warn "To enable later:  bash install.sh --domain $DOMAIN --caddy"
  log "Panel accessible at http://$DOMAIN:$PANEL_PORT (no reverse proxy)"
  ok "Web server step complete"
else
  log "No domain specified — panel accessible at http://<server-ip>:$PANEL_PORT"
  ok "Web server step complete"
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  Configure firewall
# ═══════════════════════════════════════════════════════════════════════════════
log "Configuring firewall..."
ufw allow ssh > /dev/null 2>&1 || true
if [[ "$SETUP_CADDY" == "true" ]]; then
  # Caddy needs ports 80 (HTTP) and 443 (HTTPS) for automatic certificates
  ufw allow 80/tcp > /dev/null 2>&1 || true
  ufw allow 443/tcp > /dev/null 2>&1 || true
else
  ufw allow "$PANEL_PORT/tcp" > /dev/null 2>&1 || true
fi
ufw --force enable > /dev/null 2>&1 || true
ok "Firewall configured"

# ═══════════════════════════════════════════════════════════════════════════════
#  Done!
# ═══════════════════════════════════════════════════════════════════════════════

# Determine access URL
if [[ -n "$DOMAIN" ]]; then
  if [[ "$SETUP_CADDY" == "true" ]]; then
    ACCESS_URL="https://$DOMAIN"
  else
    ACCESS_URL="http://$DOMAIN:$PANEL_PORT"
  fi
else
  SERVER_IP=$(hostname -I | awk '{print $1}')
  ACCESS_URL="http://$SERVER_IP:$PANEL_PORT"
fi

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║${NC}  ${BOLD}🎉  Installation Complete!${NC}                                 ${GREEN}║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${BOLD}Panel URL:${NC}       $ACCESS_URL"
echo -e "  ${BOLD}Admin User:${NC}      $ADMIN_USER"
echo -e "  ${BOLD}Admin Email:${NC}     $ADMIN_EMAIL"
if [[ "$NONINTERACTIVE" == "true" && -n "$ADMIN_PASS" ]]; then
  echo -e "  ${BOLD}Admin Password:${NC}  $ADMIN_PASS"
fi
echo ""
echo -e "  ${BOLD}Install Dir:${NC}     $INSTALL_DIR"
echo -e "  ${BOLD}Database:${NC}        $DB_NAME (user: $DB_USER)"
echo -e "  ${BOLD}Logs (panel):${NC}    /var/log/gsm-panel/"
if [[ "$SETUP_CADDY" == "true" ]]; then
  echo -e "  ${BOLD}Logs (caddy):${NC}    /var/log/caddy/"
fi
echo ""
echo -e "  ${CYAN}Management commands:${NC}"
echo -e "    pm2 status              # View panel status"
echo -e "    pm2 logs gsm-panel      # View live logs"
echo -e "    pm2 restart gsm-panel   # Restart panel"
echo -e "    pm2 stop gsm-panel      # Stop panel"
if [[ "$SETUP_CADDY" == "true" ]]; then
  echo ""
  echo -e "  ${CYAN}Caddy commands:${NC}"
  echo -e "    systemctl status caddy      # Caddy status"
  echo -e "    systemctl restart caddy     # Restart Caddy"
  echo -e "    caddy validate --config /etc/caddy/Caddyfile  # Validate config"
  echo -e "    journalctl -u caddy         # Caddy logs"
fi
echo ""
echo -e "  ${CYAN}Update to latest version:${NC}"
echo -e "    cd $INSTALL_DIR && git pull && npm ci && npx next build && pm2 restart gsm-panel"
echo ""

# Save install details to a file for reference
cat > "$INSTALL_DIR/.install-info" <<INFOEOF
# GameServer Manager — Install Details
# Generated: $(date -u +"%Y-%m-%d %H:%M:%S UTC")
PANEL_URL=$ACCESS_URL
ADMIN_USER=$ADMIN_USER
ADMIN_EMAIL=$ADMIN_EMAIL
INSTALL_DIR=$INSTALL_DIR
DB_NAME=$DB_NAME
DB_USER=$DB_USER
PANEL_PORT=$PANEL_PORT
DOMAIN=$DOMAIN
REVERSE_PROXY=caddy
INFOEOF
chmod 600 "$INSTALL_DIR/.install-info"

log "Installation details saved to $INSTALL_DIR/.install-info"
echo ""
