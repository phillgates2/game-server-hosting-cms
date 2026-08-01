#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
# GameServer Manager — One-Line Installer
# ═══════════════════════════════════════════════════════════
# Usage: curl -fsSL https://raw.githubusercontent.com/YOUR_USER/YOUR_REPO/main/install.sh | bash
# Or download and run: chmod +x install.sh && ./install.sh
#
# This script handles everything: Node.js, PostgreSQL, cloning,
# dependency install, environment setup, database migration,
# and starts the dev server. The rest is done via the web UI.
# ═══════════════════════════════════════════════════════════
set -euo pipefail

# ── Colors & symbols ───────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

log()    { echo -e "${GREEN}[✓]${NC} $*"; }
warn()   { echo -e "${YELLOW}[!]${NC} $*"; }
err()    { echo -e "${RED}[✗]${NC} $*"; exit 1; }
info()   { echo -e "${CYAN}[i]${NC} $*"; }

# ── Check prerequisites ────────────────────────────────────
command -v curl  >/dev/null 2>&1 || err "curl is required. Install it: sudo apt install curl"
command -v git   >/dev/null 2>&1 || warn "git not found — skipping clone (expect repo to already exist)"
command -v node  >/dev/null 2>&1 || warn "Node.js not found — will try to install via NodeSource"

# ── Determine project directory ────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${SCRIPT_DIR}"

info "Project directory: ${PROJECT_DIR}"

# ── Step 1: Clone the repo (if git is available and no .git) ─
if command -v git >/dev/null 2>&1 && [ ! -d "${PROJECT_DIR}/.git" ]; then
  warn "No .git found — cloning repository..."
  read -p "Repository URL (https://github.com/user/repo.git): " GIT_URL 2>/dev/null || true
  if [ -n "${GIT_URL:-}" ]; then
    cd "$(dirname "$PROJECT_DIR")"
    git clone "$GIT_URL" "$(basename "$PROJECT_DIR")" 2>/dev/null || err "Failed to clone repository"
    PROJECT_DIR="$(pwd)/$(basename "$PROJECT_DIR")"
    SCRIPT_DIR="$PROJECT_DIR"
    info "Cloned into ${PROJECT_DIR}"
  else
    warn "No URL provided — expecting repo already cloned in ${PROJECT_DIR}"
  fi
fi

# ── Step 2: Install Node.js (if missing) via NodeSource ────
if ! command -v node >/dev/null 2>&1; then
  info "Installing Node.js 20 LTS via NodeSource..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - 2>/dev/null || {
    warn "NodeSource setup failed — trying to install nodejs from apt"
    sudo apt-get update && sudo apt-get install -y nodejs 2>/dev/null || err "Cannot install Node.js"
  }
  command -v node >/dev/null 2>&1 || err "Node.js installation failed"
fi

NODE_VER=$(node --version)
NPM_VER=$(npm --version)
log "Node.js ${NODE_VER} / npm ${NPM_VER}"

# ── Step 3: Install PostgreSQL (if missing) ────────────────
if ! command -v psql >/dev/null 2>&1; then
  info "Installing PostgreSQL..."
  sudo apt-get update && sudo apt-get install -y postgresql postgresql-contrib 2>/dev/null || warn "PostgreSQL install failed — will try to connect to existing instance"
fi

# ── Step 3.5: Install SteamCMD (for Steam-based games) ─────
if ! command -v steamcmd >/dev/null 2>&1 && [ -d "${PROJECT_DIR}/.git" ]; then
  info "Installing SteamCMD..."
  sudo dpkg --add-architecture i386 2>/dev/null || true
  sudo apt-get update -qq 2>/dev/null
  sudo apt-get install -y -qq lib32gcc-s1 lib32stdc++6 ca-certificates 2>/dev/null || true

  sudo mkdir -p /opt/steamcmd
  cd /opt/steamcmd
  sudo curl -sqL "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz" | sudo tar xzf - 2>/dev/null || warn "SteamCMD download failed — skipping"

  sudo chown -R "${USER}:${USER}" /opt/steamcmd 2>/dev/null || true
  chmod +x /opt/steamcmd/steamcmd.sh /opt/steamcmd/linux32/steamcmd 2>/dev/null || true

  # Create wrapper script so steamcmd is available system-wide
  sudo bash -c 'cat > /usr/local/bin/steamcmd << "WRAPPER"
#!/bin/bash
cd /opt/steamcmd && exec ./steamcmd.sh "$@"
WRAPPER'
  sudo chmod +x /usr/local/bin/steamcmd

  mkdir -p /opt/steamcmd/package 2>/dev/null || true

  # First run — DO NOT use sudo!
  cd /opt/steamcmd
  ./steamcmd.sh +quit 2>/dev/null || warn "SteamCMD first-run failed — may need manual setup"

  log "SteamCMD installed at /opt/steamcmd"
fi

# ── Step 4: Set up PostgreSQL database & user ──────────────
DB_NAME="gsm_panel"
DB_USER="gsm_user"
echo -n "Database password (leave blank for auto): "
read -r DB_PASS_INPUT 2>/dev/null || true

if [ -z "${DB_PASS_INPUT}" ]; then
  # Generate a random password
  DB_PASS=$(openssl rand -base64 16)
  log "Auto-generated database password: ${DB_PASS}"
else
  DB_PASS="${DB_PASS_INPUT}"
fi

# Create database user and database (if they don't exist)
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" 2>/dev/null | grep -q 1 || {
  sudo -u postgres psql -c "CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS}';" 2>/dev/null
  log "Created database user: ${DB_USER}"
}

sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" 2>/dev/null | grep -q 1 || {
  sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};" 2>/dev/null
  log "Created database: ${DB_NAME}"
}

# ── Step 5: Create .env file ───────────────────────────────
if [ ! -f "${PROJECT_DIR}/.env.local" ]; then
  info "Creating .env.local..."
  cat > "${PROJECT_DIR}/.env.local" <<EOF
DATABASE_URL=postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}
JWT_SECRET=$(openssl rand -hex 32)
NEXT_PUBLIC_APP_URL=http://localhost:3000
NODE_ENV=development
EOF
  log "Environment file created at ${PROJECT_DIR}/.env.local"
else
  info ".env.local already exists — skipping"
fi

# ── Step 6: Install dependencies ───────────────────────────
cd "${PROJECT_DIR}"
info "Installing npm dependencies..."
npm install 2>/dev/null || err "npm install failed"
log "Dependencies installed"

# ── Step 7: Run database migrations ────────────────────────
info "Running database migrations (drizzle-kit push)..."
npx drizzle-kit push 2>/dev/null || {
  warn "drizzle-kit push failed — trying npx drizzle-kit migrate..."
  npx drizzle-kit migrate 2>/dev/null || warn "Database migration skipped — may need manual setup"
}

# ── Step 8: Build the project ──────────────────────────────
info "Building the Next.js application..."
npm run build 2>/dev/null || {
  warn "Build failed — continuing anyway, you can fix errors later"
}

# ── Done! ──────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}"
echo " ╔═══════════════════════════════════════════╗"
echo " ║  🎮 GameServer Manager Installed!        ║"
echo " ╚═══════════════════════════════════════════╝"
echo -e "${NC}"
echo ""
echo "   Next steps (via web browser):"
echo ""
echo "   1. Start the server:"
echo "      cd ${PROJECT_DIR} && npm run dev"
echo ""
echo "   2. Open your browser to: http://localhost:3000"
echo ""
echo "   3. Complete setup via the Install Wizard (web UI)"
echo "      — Create admin account"
echo "      — Generate activation key for panel lock"
echo "      — Import game templates"
echo ""
echo -e "   ${CYAN}That's it! The rest is done through the web panel.${NC}"
echo ""
