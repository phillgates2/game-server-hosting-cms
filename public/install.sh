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
#    4. Installs SteamCMD for Steam-based game servers
#    5. Clones the GameServer Manager repository
#    6. Installs npm packages & builds the production app
#    7. Generates a secure JWT secret
#    8. Runs the panel's database install (schema + admin user + seeds)
#    9. Sets up PM2 with systemd for auto-start on boot
#   10. (Optional) Configures Caddy reverse proxy with automatic HTTPS
#
#  Supported OS: Ubuntu 22.04+, Debian 12+
#  Minimum: 1 vCPU, 2 GB RAM, 20 GB disk (more for game servers)
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
SKIP_STEAMCMD="false"
STEAMCMD_DIR="/opt/steamcmd"
GAMESERVERS_DIR="/opt/gameservers"
NONINTERACTIVE="false"
NODE_MAJOR="22"

# ── Parse command-line arguments ──────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --admin-user)       ADMIN_USER="$2";      shift 2 ;;
    --admin-email)      ADMIN_EMAIL="$2";     shift 2 ;;
    --admin-pass)       ADMIN_PASS="$2";      shift 2 ;;
    --panel-name)       PANEL_NAME="$2";      shift 2 ;;
    --domain)           DOMAIN="$2";          shift 2 ;;
    --port)             PANEL_PORT="$2";      shift 2 ;;
    --db-name)          DB_NAME="$2";         shift 2 ;;
    --db-user)          DB_USER="$2";         shift 2 ;;
    --db-pass)          DB_PASS="$2";         shift 2 ;;
    --install-dir)      INSTALL_DIR="$2";     shift 2 ;;
    --jwt-secret)       JWT_SECRET="$2";      shift 2 ;;
    --steamcmd-dir)     STEAMCMD_DIR="$2";    shift 2 ;;
    --gameservers-dir)  GAMESERVERS_DIR="$2"; shift 2 ;;
    --caddy)            SETUP_CADDY="true";   shift   ;;
    --no-steamcmd)      SKIP_STEAMCMD="true"; shift   ;;
    --noninteractive)   NONINTERACTIVE="true"; shift ;;
    -y)                 NONINTERACTIVE="true"; shift ;;
    --help|-h)
      banner
      echo "Usage: bash install.sh [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --admin-user       USERNAME    Admin username (default: prompted)"
      echo "  --admin-email      EMAIL       Admin email (default: prompted)"
      echo "  --admin-pass       PASSWORD    Admin password (default: prompted)"
      echo "  --panel-name       NAME        Panel display name (default: GameServer Manager)"
      echo "  --domain           DOMAIN      Domain name for Caddy reverse proxy"
      echo "  --port             PORT        Panel port (default: 3000)"
      echo "  --db-name          NAME        PostgreSQL database name (default: gsm_panel)"
      echo "  --db-user          USER        PostgreSQL user (default: gsm)"
      echo "  --db-pass          PASSWORD    PostgreSQL password (default: auto-generated)"
      echo "  --install-dir      PATH        Panel installation directory (default: /opt/gsm-panel)"
      echo "  --steamcmd-dir     PATH        SteamCMD installation directory (default: /opt/steamcmd)"
      echo "  --gameservers-dir  PATH        Game servers directory (default: /opt/gameservers)"
      echo "  --jwt-secret       SECRET      JWT signing secret (default: auto-generated)"
      echo "  --caddy                        Set up Caddy reverse proxy with automatic HTTPS"
      echo "  --no-steamcmd                  Skip SteamCMD installation"
      echo "  --noninteractive, -y           Skip all prompts; use defaults/flags"
      echo "  --help, -h                     Show this help"
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

# ── LXC / Container network fix ──────────────────────────────────────────────
# ASUSTOR Linux Center (and some other NAS platforms) run Debian inside LXC
# containers with multiple interfaces.  The real LAN (for port forwarding)
# can be on ANY interface — not necessarily eth0.  ASUSTOR also injects an
# internal management gateway that can steal the default route.
#
# Strategy: find the interface carrying a routable private IP on the same
# subnet as the physical LAN router (usually 192.168.x.x or a user-chosen
# subnet), make THAT the default route, and remove everything else.
if [[ -f /proc/1/environ ]] && grep -qa "container=lxc" /proc/1/environ 2>/dev/null \
   || [[ -f /.dockerenv ]] \
   || grep -qsai "lxc\|docker\|container" /proc/1/cgroup 2>/dev/null; then

  IS_CONTAINER="true"
  log "Running inside a container (LXC/Docker detected)"

  # ── Find the real LAN interface and gateway ────────────────────────────────
  # We score each interface.  192.168.x.x and 172.16-31.x.x score highest
  # because they are almost always the home/office LAN.  10.x.x.x scores
  # lower because NAS platforms use 10.0.3.x (LXC bridge) and 10.172.x.x
  # (internal management) — both of which are NOT the real LAN.
  LAN_DEV=""
  LAN_GW=""
  LAN_IP=""
  BEST_SCORE=0

  while IFS= read -r line; do
    iface=$(echo "$line" | awk '{print $2}' | tr -d ':' || true)
    cidr=$(echo "$line" | awk '{print $4}' || true)
    ip_addr=${cidr%/*}

    [[ -z "$ip_addr" || -z "$iface" ]] && continue
    # Skip loopback
    [[ "$iface" == "lo" ]] && continue

    score=0
    # 192.168.x.x — almost always the real home/office LAN
    if [[ "$ip_addr" =~ ^192\.168\. ]]; then
      score=100
    # 172.16-31.x.x — common corporate/prosumer LAN
    elif [[ "$ip_addr" =~ ^172\.(1[6-9]|2[0-9]|3[01])\. ]]; then
      score=80
    # 10.x.x.x — could be LAN but also could be LXC bridge or NAS internal
    elif [[ "$ip_addr" =~ ^10\. ]]; then
      # 10.0.3.x is the standard LXC bridge — very low score
      if [[ "$ip_addr" =~ ^10\.0\.3\. ]]; then
        score=5
      # 10.172.x.x is ASUSTOR internal — very low score
      elif [[ "$ip_addr" =~ ^10\.172\. ]]; then
        score=2
      else
        score=30
      fi
    fi

    if [[ $score -gt $BEST_SCORE ]]; then
      BEST_SCORE=$score
      LAN_DEV="$iface"
      LAN_IP="$ip_addr"
      # Guess gateway as x.x.x.1
      if [[ "$ip_addr" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)\.[0-9]+$ ]]; then
        LAN_GW="${BASH_REMATCH[1]}.${BASH_REMATCH[2]}.${BASH_REMATCH[3]}.1"
      fi
    fi
  done < <(ip -4 -o addr show 2>/dev/null || true)

  # Override gateway guess with an existing default route on the chosen device
  if [[ -n "$LAN_DEV" ]]; then
    EXISTING_GW=$(ip route show default dev "$LAN_DEV" 2>/dev/null \
      | awk '/default via/ {print $3; exit}' || true)
    if [[ -n "$EXISTING_GW" ]]; then
      LAN_GW="$EXISTING_GW"
    fi
  fi

  # Also check DHCP leases for a router option
  if [[ -z "$LAN_GW" && -d /var/lib/dhcp ]]; then
    LAN_GW=$(grep -RhoP 'option routers\s+\K[0-9.]+' /var/lib/dhcp 2>/dev/null | head -1 || true)
  fi

  # Show what we found
  if [[ -n "$LAN_DEV" && -n "$LAN_GW" ]]; then
    log "Detected LAN: $LAN_IP on $LAN_DEV → gateway $LAN_GW (score $BEST_SCORE)"
  fi

  # Show all current defaults for context
  log "Current default route(s) before fix:"
  ip route show default 2>/dev/null || true

  if [[ -n "$LAN_DEV" && -n "$LAN_GW" && $BEST_SCORE -ge 30 ]]; then
    # Force the LAN gateway as the preferred default route
    ip route replace default via "$LAN_GW" dev "$LAN_DEV" metric 10 2>/dev/null || true

    # Remove any competing default routes on OTHER interfaces
    while IFS= read -r route_line; do
      r_via=$(echo "$route_line" | grep -oP 'via \K[0-9.]+' || true)
      r_dev=$(echo "$route_line" | grep -oP 'dev \K\S+' || true)
      if [[ -n "$r_via" && -n "$r_dev" && "$r_dev" != "$LAN_DEV" ]]; then
        ip route del default via "$r_via" dev "$r_dev" 2>/dev/null || true
        log "Removed competing default: $r_via via $r_dev"
      fi
    done < <(ip route show default 2>/dev/null || true)

    # Re-assert our preferred route after cleanup
    ip route replace default via "$LAN_GW" dev "$LAN_DEV" metric 10 2>/dev/null || true

    ok "Default route set to $LAN_GW via $LAN_DEV"

    # Verify internet access
    sleep 1
    if curl -sf --max-time 5 "http://deb.debian.org" > /dev/null 2>&1 \
       || curl -sf --max-time 5 "http://google.com" > /dev/null 2>&1; then
      ok "Internet is reachable"
    else
      warn "Internet may not be reachable — check your router/NAT config"
    fi

    # Install the persistent fix as a systemd service
    if command -v systemctl &>/dev/null; then
      log "Installing persistent routing fix for container reboots..."

      cat > /usr/local/bin/fix-container-routing.sh <<ROUTEFIX
#!/bin/bash
# Force LAN gateway for ASUSTOR/NAS Linux Center containers
# Installed by GameServer Manager installer
# LAN interface: $LAN_DEV  Gateway: $LAN_GW
sleep 10

# Remove default routes on every interface EXCEPT $LAN_DEV
while IFS= read -r route_line; do
  r_via=\$(echo "\$route_line" | grep -oP 'via \K[0-9.]+' || true)
  r_dev=\$(echo "\$route_line" | grep -oP 'dev \K\S+' || true)
  if [[ -n "\$r_via" && -n "\$r_dev" && "\$r_dev" != "$LAN_DEV" ]]; then
    ip route del default via "\$r_via" dev "\$r_dev" 2>/dev/null || true
  fi
done < <(ip route show default 2>/dev/null || true)

# Force LAN gateway as the default
ip route replace default via "$LAN_GW" dev "$LAN_DEV" metric 10 2>/dev/null || true
ROUTEFIX
      chmod +x /usr/local/bin/fix-container-routing.sh

      cat > /etc/systemd/system/fix-container-routing.service <<'ROUTESVC'
[Unit]
Description=Force LAN gateway for LXC container networking
After=network.target network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/fix-container-routing.sh
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
ROUTESVC

      systemctl daemon-reload 2>/dev/null || true
      systemctl enable fix-container-routing.service 2>/dev/null || true
      ok "Persistent routing fix installed (survives reboots)"
    fi

    log "Final default route(s):"
    ip route show default 2>/dev/null || true
  else
    if [[ $BEST_SCORE -lt 30 && -n "$LAN_DEV" ]]; then
      warn "Best interface found was $LAN_DEV ($LAN_IP) but confidence is low (score $BEST_SCORE)"
      warn "This looks like an internal bridge, not your real LAN"
    fi
    warn "Could not confidently detect the LAN gateway"
    warn "The installer will continue, but port forwarding may not work"
    warn "You may need to manually set the default route:"
    warn "  ip route replace default via <YOUR_ROUTER_IP> dev <LAN_INTERFACE>"
    warn ""
    warn "Current routing table:"
    ip route show 2>/dev/null || true
  fi
else
  IS_CONTAINER="false"
fi

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

  read -rp "  Game servers directory [$GAMESERVERS_DIR]: " input
  GAMESERVERS_DIR="${input:-$GAMESERVERS_DIR}"

  read -rp "  Install SteamCMD for Steam games? [Y/n]: " input
  if [[ "${input,,}" == "n" ]]; then
    SKIP_STEAMCMD="true"
  fi

  echo ""
  echo -e "${BOLD}Review Configuration${NC}"
  echo "───────────────────────────────────────────"
  echo "  Admin:           $ADMIN_USER ($ADMIN_EMAIL)"
  echo "  Panel:           $PANEL_NAME"
  echo "  Port:            $PANEL_PORT"
  echo "  Domain:          ${DOMAIN:-<none — access via IP>}"
  echo "  Caddy:           $SETUP_CADDY"
  echo "  SteamCMD:        $([ "$SKIP_STEAMCMD" == "true" ] && echo "skip" || echo "$STEAMCMD_DIR")"
  echo "  Game Servers:    $GAMESERVERS_DIR"
  echo "  Panel Install:   $INSTALL_DIR"
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

TOTAL_STEPS=10
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
apt-get update -qq || {
  err "apt-get update failed"
  apt-get update
  die "Cannot continue without package lists"
}

log "Installing base packages..."
# Core packages (required)
CORE_PKGS="curl wget ca-certificates gnupg lsb-release git tar gzip unzip psmisc"
# Build tools (required for native npm modules)
BUILD_PKGS="build-essential"
# Security (optional but recommended)
SECURITY_PKGS="ufw fail2ban"
# Ubuntu-only package — skip on Debian
if [[ "$OS_ID" == "ubuntu" ]]; then
  EXTRA_PKGS="software-properties-common"
else
  EXTRA_PKGS=""
fi

# Install core packages first (fail if these are missing)
log "  → Core packages..."
if ! apt-get install -y $CORE_PKGS > /tmp/gsm-apt-core.log 2>&1; then
  err "Failed to install core packages!"
  cat /tmp/gsm-apt-core.log
  die "Cannot continue without core packages: $CORE_PKGS"
fi

# Build tools
log "  → Build tools..."
if ! apt-get install -y $BUILD_PKGS > /tmp/gsm-apt-build.log 2>&1; then
  warn "Failed to install build-essential — native npm modules may fail"
  cat /tmp/gsm-apt-build.log
fi

# Security packages (non-fatal if missing)
log "  → Security packages (ufw, fail2ban)..."
apt-get install -y $SECURITY_PKGS > /tmp/gsm-apt-security.log 2>&1 || {
  warn "Some security packages could not be installed (non-fatal)"
}

# Ubuntu extras
if [[ -n "$EXTRA_PKGS" ]]; then
  apt-get install -y $EXTRA_PKGS > /dev/null 2>&1 || true
fi

ok "Base packages installed"

# ═══════════════════════════════════════════════════════════════════════════════
#  STEP 2: Node.js 22
# ═══════════════════════════════════════════════════════════════════════════════
step "Installing Node.js $NODE_MAJOR"

install_nodejs() {
  log "Adding NodeSource repository..."
  if ! curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" -o /tmp/nodesource_setup.sh; then
    err "Failed to download NodeSource setup script"
    return 1
  fi
  
  if ! bash /tmp/nodesource_setup.sh > /tmp/gsm-nodesource.log 2>&1; then
    err "NodeSource setup failed!"
    cat /tmp/gsm-nodesource.log
    return 1
  fi
  
  log "Installing Node.js..."
  if ! apt-get install -y nodejs > /tmp/gsm-nodejs-install.log 2>&1; then
    err "Failed to install Node.js!"
    cat /tmp/gsm-nodejs-install.log
    return 1
  fi
  return 0
}

if command -v node &>/dev/null; then
  CURRENT_NODE="$(node -v | sed 's/v//' | cut -d. -f1)"
  if [[ "$CURRENT_NODE" -ge "$NODE_MAJOR" ]]; then
    ok "Node.js $(node -v) already installed"
  else
    warn "Node.js v$CURRENT_NODE found, upgrading to v$NODE_MAJOR..."
    if ! install_nodejs; then
      die "Failed to install Node.js $NODE_MAJOR"
    fi
    ok "Node.js $(node -v) installed"
  fi
else
  if ! install_nodejs; then
    die "Failed to install Node.js $NODE_MAJOR"
  fi
  ok "Node.js $(node -v) installed"
fi

# Verify Node.js is working
if ! node --version > /dev/null 2>&1; then
  die "Node.js installation verification failed"
fi

# Install PM2 globally
if ! command -v pm2 &>/dev/null; then
  log "Installing PM2..."
  if ! npm install -g pm2 > /tmp/gsm-pm2-install.log 2>&1; then
    warn "PM2 installation failed — you can install it manually later"
    cat /tmp/gsm-pm2-install.log
  else
    ok "PM2 installed"
  fi
else
  ok "PM2 already installed"
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  STEP 3: PostgreSQL
# ═══════════════════════════════════════════════════════════════════════════════
step "Installing & configuring PostgreSQL"

if ! command -v psql &>/dev/null; then
  log "Adding PostgreSQL APT repository..."
  
  # Get the codename — Debian 13 (Trixie) may need special handling
  CODENAME=$(lsb_release -cs 2>/dev/null || echo "")
  if [[ -z "$CODENAME" ]]; then
    # Fallback: read from os-release
    CODENAME=$(grep VERSION_CODENAME /etc/os-release 2>/dev/null | cut -d= -f2 || echo "bookworm")
  fi
  
  # Debian 13 (Trixie) may not have packages yet — fall back to bookworm
  if [[ "$CODENAME" == "trixie" ]]; then
    warn "Debian 13 (Trixie) detected — using Bookworm PostgreSQL packages"
    CODENAME="bookworm"
  fi
  
  # Add PostgreSQL APT repo
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    | gpg --dearmor -o /usr/share/keyrings/postgresql-archive-keyring.gpg 2>/dev/null
  echo "deb [signed-by=/usr/share/keyrings/postgresql-archive-keyring.gpg] https://apt.postgresql.org/pub/repos/apt ${CODENAME}-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list
  
  log "Updating package lists..."
  apt-get update -qq
  
  log "Installing PostgreSQL..."
  if ! apt-get install -y postgresql postgresql-contrib > /tmp/gsm-postgresql-install.log 2>&1; then
    err "PostgreSQL installation failed!"
    cat /tmp/gsm-postgresql-install.log
    
    # Try without the official repo (use distro's version)
    warn "Trying distro's PostgreSQL package..."
    rm -f /etc/apt/sources.list.d/pgdg.list
    apt-get update -qq
    if ! apt-get install -y postgresql postgresql-contrib > /tmp/gsm-postgresql-install.log 2>&1; then
      cat /tmp/gsm-postgresql-install.log
      die "Cannot install PostgreSQL"
    fi
  fi
fi

# Ensure PostgreSQL is running
if command -v systemctl &>/dev/null; then
  systemctl enable postgresql > /dev/null 2>&1 || true
  systemctl start postgresql > /dev/null 2>&1 || true
else
  # Non-systemd fallback (e.g., containers)
  service postgresql start > /dev/null 2>&1 || true
fi

# Verify PostgreSQL is running
sleep 2
if ! su - postgres -c "psql -c 'SELECT 1'" > /dev/null 2>&1; then
  err "PostgreSQL is installed but not responding"
  die "Please start PostgreSQL manually: systemctl start postgresql"
fi

PG_VERSION=$(psql --version 2>/dev/null | grep -oP '\d+' | head -1 || echo "?")
ok "PostgreSQL $PG_VERSION running"

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

# Create game servers directory
mkdir -p "$GAMESERVERS_DIR"
chown "$GSM_USER:$GSM_USER" "$GAMESERVERS_DIR"
chmod 755 "$GAMESERVERS_DIR"
ok "Game servers directory: $GAMESERVERS_DIR"

# ═══════════════════════════════════════════════════════════════════════════════
#  STEP 5: SteamCMD
# ═══════════════════════════════════════════════════════════════════════════════
step "Installing SteamCMD"

if [[ "$SKIP_STEAMCMD" == "true" ]]; then
  warn "SteamCMD installation skipped (--no-steamcmd)"
  ok "Skipping SteamCMD"
else
  # Install 32-bit libraries required by SteamCMD
  log "Installing 32-bit libraries for SteamCMD..."

  # Enable i386 architecture
  dpkg --add-architecture i386
  apt-get update -qq

  # Try multiple package name variants (different across distro versions)
  STEAM_LIBS_INSTALLED="false"
  
  # Modern naming (Debian 11+, Ubuntu 20.04+)
  if apt-get install -y lib32gcc-s1 lib32stdc++6 > /tmp/gsm-steamlibs.log 2>&1; then
    STEAM_LIBS_INSTALLED="true"
  # Older naming (Debian 10, Ubuntu 18.04)
  elif apt-get install -y lib32gcc1 lib32stdc++6 > /tmp/gsm-steamlibs.log 2>&1; then
    STEAM_LIBS_INSTALLED="true"
  # Minimal fallback — just libc6:i386
  elif apt-get install -y libc6:i386 > /tmp/gsm-steamlibs.log 2>&1; then
    warn "Only installed libc6:i386 — some games may have issues"
    STEAM_LIBS_INSTALLED="true"
  fi

  if [[ "$STEAM_LIBS_INSTALLED" != "true" ]]; then
    warn "Could not install 32-bit libraries — SteamCMD may not work"
    warn "Log: /tmp/gsm-steamlibs.log"
    cat /tmp/gsm-steamlibs.log
  else
    ok "32-bit libraries installed"
  fi

  # Create SteamCMD directory
  mkdir -p "$STEAMCMD_DIR"
  cd "$STEAMCMD_DIR"

  # Download and extract SteamCMD
  if [[ ! -f "$STEAMCMD_DIR/steamcmd.sh" ]]; then
    log "Downloading SteamCMD..."
    curl -fsSL "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz" -o steamcmd_linux.tar.gz
    tar -xzf steamcmd_linux.tar.gz
    rm -f steamcmd_linux.tar.gz
    ok "SteamCMD downloaded and extracted"
  else
    ok "SteamCMD already installed"
  fi

  # Set ownership
  chown -R "$GSM_USER:$GSM_USER" "$STEAMCMD_DIR"
  chmod +x "$STEAMCMD_DIR/steamcmd.sh"

  # Run SteamCMD once to complete installation and update itself
  log "Running SteamCMD first-time setup (this may take a moment)..."
  su - "$GSM_USER" -c "cd $STEAMCMD_DIR && ./steamcmd.sh +quit" > /dev/null 2>&1 || true
  ok "SteamCMD ready at $STEAMCMD_DIR"

  # Create a convenient symlink
  if [[ ! -L /usr/local/bin/steamcmd ]]; then
    ln -sf "$STEAMCMD_DIR/steamcmd.sh" /usr/local/bin/steamcmd
    ok "Symlink created: /usr/local/bin/steamcmd"
  fi

  # Create a helper script for common game installs
  cat > "$STEAMCMD_DIR/install-game.sh" <<'STEAMHELPER'
#!/usr/bin/env bash
# SteamCMD Game Installation Helper
# Usage: ./install-game.sh <app_id> <install_dir> [beta_branch]
#
# Examples:
#   ./install-game.sh 740 /opt/gameservers/csgo          # CS:GO
#   ./install-game.sh 730 /opt/gameservers/cs2           # CS2
#   ./install-game.sh 896660 /opt/gameservers/valheim    # Valheim
#   ./install-game.sh 376030 /opt/gameservers/ark        # ARK
#   ./install-game.sh 258550 /opt/gameservers/rust       # Rust

set -e

APP_ID="${1:-}"
INSTALL_DIR="${2:-}"
BETA="${3:-}"

if [[ -z "$APP_ID" || -z "$INSTALL_DIR" ]]; then
  echo "Usage: $0 <app_id> <install_dir> [beta_branch]"
  echo ""
  echo "Common App IDs:"
  echo "  730     Counter-Strike 2"
  echo "  740     Counter-Strike: Global Offensive"
  echo "  896660  Valheim Dedicated Server"
  echo "  376030  ARK: Survival Evolved"
  echo "  258550  Rust Dedicated Server"
  echo "  443030  Conan Exiles Dedicated Server"
  echo "  1007    DayZ Server"
  echo "  232250  Team Fortress 2 Dedicated Server"
  echo "  4020    Garry's Mod Dedicated Server"
  echo "  294420  7 Days to Die Dedicated Server"
  echo "  233780  Arma 3 Dedicated Server"
  echo "  2394010 Palworld Dedicated Server"
  exit 1
fi

STEAMCMD_DIR="$(dirname "$0")"
mkdir -p "$INSTALL_DIR"

BETA_ARG=""
if [[ -n "$BETA" ]]; then
  BETA_ARG="-beta $BETA"
fi

echo "Installing Steam App $APP_ID to $INSTALL_DIR..."
"$STEAMCMD_DIR/steamcmd.sh" \
  +force_install_dir "$INSTALL_DIR" \
  +login anonymous \
  +app_update "$APP_ID" $BETA_ARG validate \
  +quit

echo "Done! Game installed to $INSTALL_DIR"
STEAMHELPER
  chmod +x "$STEAMCMD_DIR/install-game.sh"
  chown "$GSM_USER:$GSM_USER" "$STEAMCMD_DIR/install-game.sh"
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  STEP 6: Clone repository
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
#  STEP 7: Configure environment & install dependencies
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

# Paths
STEAMCMD_PATH=$STEAMCMD_DIR
GAMESERVERS_PATH=$GAMESERVERS_DIR

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
# Full install INCLUDING devDependencies — typescript, tailwindcss, postcss,
# drizzle-kit, etc. are all required to build the production bundle.
# After the build, we prune devDeps to save disk space.
#
# NOTE: "|| true" prevents set -e from killing the script so our error
# handling below actually runs.
su - "$GSM_USER" -c "cd $INSTALL_DIR && npm ci" > /tmp/gsm-npm-install.log 2>&1 || true
NPM_EXIT=${PIPESTATUS[0]:-$?}

# Check if it actually worked by looking for node_modules
if ! su - "$GSM_USER" -c "test -d $INSTALL_DIR/node_modules/next" 2>/dev/null; then
  warn "npm ci did not produce node_modules — falling back to npm install..."
  echo "─── npm ci log (last 20 lines) ───"
  tail -20 /tmp/gsm-npm-install.log
  echo "───────────────────────────────────"

  su - "$GSM_USER" -c "cd $INSTALL_DIR && npm install" > /tmp/gsm-npm-install.log 2>&1 || true

  if ! su - "$GSM_USER" -c "test -d $INSTALL_DIR/node_modules/next" 2>/dev/null; then
    err "npm install also failed!"
    echo "─── npm install log (last 30 lines) ───"
    tail -30 /tmp/gsm-npm-install.log
    echo "────────────────────────────────────────"
    die "Cannot continue without dependencies."
  fi
fi

# Verify critical devDependencies are actually installed
if ! su - "$GSM_USER" -c "test -f $INSTALL_DIR/node_modules/.bin/tsc" 2>/dev/null; then
  err "TypeScript compiler is missing — devDependencies were likely skipped."
  err "Retrying with explicit install..."
  su - "$GSM_USER" -c "cd $INSTALL_DIR && npm install" > /tmp/gsm-npm-install.log 2>&1 || true
  if ! su - "$GSM_USER" -c "test -f $INSTALL_DIR/node_modules/.bin/tsc" 2>/dev/null; then
    tail -20 /tmp/gsm-npm-install.log
    die "Cannot install TypeScript. Check /tmp/gsm-npm-install.log"
  fi
fi

ok "Dependencies installed"
log "  (full log: /tmp/gsm-npm-install.log)"

# Push database schema BEFORE building — drizzle-kit is a devDependency
log "Pushing database schema..."
su - "$GSM_USER" -c "cd $INSTALL_DIR && npx drizzle-kit push" > /tmp/gsm-drizzle-push.log 2>&1 || true
tail -3 /tmp/gsm-drizzle-push.log
if grep -qi "error\|fail" /tmp/gsm-drizzle-push.log 2>/dev/null && ! grep -qi "Changes applied" /tmp/gsm-drizzle-push.log 2>/dev/null; then
  warn "drizzle-kit push may have had issues"
  warn "You can retry later: cd $INSTALL_DIR && npx drizzle-kit push"
  tail -10 /tmp/gsm-drizzle-push.log
else
  ok "Database schema applied"
fi

log "Building production bundle (this may take a minute)..."
su - "$GSM_USER" -c "cd $INSTALL_DIR && npx next build" > /tmp/gsm-next-build.log 2>&1 || true

# Check if .next directory was created (proof the build succeeded)
if ! su - "$GSM_USER" -c "test -d $INSTALL_DIR/.next" 2>/dev/null; then
  err "Build failed! .next directory was not created."
  echo "─── Build log (last 40 lines) ───"
  tail -40 /tmp/gsm-next-build.log
  echo "──────────────────────────────────"
  die "Cannot continue without a successful build. Full log: /tmp/gsm-next-build.log"
fi
tail -8 /tmp/gsm-next-build.log
ok "Production build complete"

# Remove devDependencies to save disk space (typescript, eslint, tailwind, etc.
# are no longer needed after the build is done)
log "Pruning devDependencies to save disk space..."
su - "$GSM_USER" -c "cd $INSTALL_DIR && npm prune --omit=dev" > /dev/null 2>&1 || true
ok "DevDependencies pruned"

# ═══════════════════════════════════════════════════════════════════════════════
#  STEP 8: Initialize database & run panel install
# ═══════════════════════════════════════════════════════════════════════════════
step "Initializing database"

# Start the app temporarily to run the install API
log "Starting temporary server for panel setup..."
su - "$GSM_USER" -c "cd $INSTALL_DIR && PORT=$PANEL_PORT npx next start > /tmp/gsm-temp-server.log 2>&1 &
echo \$!" > /tmp/gsm-temp-pid
TEMP_PID=$(cat /tmp/gsm-temp-pid 2>/dev/null || echo "")

# Wait for server to be ready (up to 60 seconds)
SERVER_READY="false"
sleep 3  # give Next.js a moment to fully start
for i in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:$PANEL_PORT/api/health" > /dev/null 2>&1; then
    SERVER_READY="true"
    break
  fi
  # Also try localhost (some systems resolve differently)
  if curl -sf "http://localhost:$PANEL_PORT/api/health" > /dev/null 2>&1; then
    SERVER_READY="true"
    break
  fi
  sleep 1
done

if [[ "$SERVER_READY" != "true" ]]; then
  warn "Server did not respond within 60 seconds"
  warn "Temp server log:"
  tail -15 /tmp/gsm-temp-server.log 2>/dev/null || true
  warn "You can complete setup via the web install wizard on first visit"
else
  log "Server is up — calling install API..."

  # Call the install API (try both 127.0.0.1 and localhost)
  INSTALL_PAYLOAD="{\"adminUsername\":\"$ADMIN_USER\",\"adminEmail\":\"$ADMIN_EMAIL\",\"adminPassword\":\"$ADMIN_PASS\",\"panelName\":\"$PANEL_NAME\"}"
  INSTALL_RESPONSE=$(curl -sf --max-time 30 -X POST "http://localhost:$PANEL_PORT/api/install" \
    -H "Content-Type: application/json" \
    -d "$INSTALL_PAYLOAD" 2>&1) || \
  INSTALL_RESPONSE=$(curl -sf --max-time 30 -X POST "http://127.0.0.1:$PANEL_PORT/api/install" \
    -H "Content-Type: application/json" \
    -d "$INSTALL_PAYLOAD" 2>&1) || true

  if echo "$INSTALL_RESPONSE" | grep -q '"ok":true'; then
    ok "Panel installed successfully"
  else
    warn "API install returned: $INSTALL_RESPONSE"
    warn "You can complete setup via the web install wizard on first visit"
  fi
fi

# Stop the temporary server
if [[ -n "$TEMP_PID" ]]; then
  # Kill the Next.js process and any children
  su - "$GSM_USER" -c "kill $TEMP_PID 2>/dev/null" || true
  sleep 1
fi
# Also kill any leftover next processes on the panel port
fuser -k "$PANEL_PORT/tcp" 2>/dev/null || true
sleep 1

# ═══════════════════════════════════════════════════════════════════════════════
#  STEP 9: Set up PM2 & systemd
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
su - "$GSM_USER" -c "cd $INSTALL_DIR && pm2 start ecosystem.config.cjs" || {
  warn "PM2 start failed — trying alternative method..."
  su - "$GSM_USER" -c "cd $INSTALL_DIR && pm2 start npm --name gsm-panel -- start" || true
}
su - "$GSM_USER" -c "pm2 save" || true

# Set up PM2 to start on boot via systemd
env PATH=$PATH:/usr/bin pm2 startup systemd -u "$GSM_USER" --hp "/home/$GSM_USER" 2>/dev/null || true

# Create a wrapper script so root (and other users) can manage the gsm PM2 instance
# without needing to `su - gsm` first
cat > /usr/local/bin/gsm <<'GSMWRAPPER'
#!/bin/bash
# GameServer Manager — PM2 helper
# Runs pm2 commands against the gsm user's PM2 daemon
GSM_USER="gsm"

case "${1:-}" in
  status|list|ls)
    su - "$GSM_USER" -c "pm2 status" ;;
  logs|log)
    su - "$GSM_USER" -c "pm2 logs gsm-panel ${*:2}" ;;
  restart)
    su - "$GSM_USER" -c "pm2 restart gsm-panel" ;;
  update)
    bash "$0/../public/update.sh" ${@:2} 2>/dev/null \
      || bash /opt/gsm-panel/public/update.sh ${@:2} ;;
  stop)
    su - "$GSM_USER" -c "pm2 stop gsm-panel" ;;
  start)
    su - "$GSM_USER" -c "pm2 start gsm-panel" ;;
  reload)
    su - "$GSM_USER" -c "pm2 reload gsm-panel" ;;
  monit|monitor)
    su - "$GSM_USER" -c "pm2 monit" ;;
  *)
    echo "GameServer Manager — Panel Management"
    echo ""
    echo "Usage: gsm <command>"
    echo ""
    echo "Commands:"
    echo "  status    Show panel process status"
    echo "  logs      View live panel logs (Ctrl+C to exit)"
    echo "  restart   Restart the panel"
    echo "  stop      Stop the panel"
    echo "  start     Start the panel"
    echo "  reload    Graceful reload"
    echo "  update    Update panel to latest version"
    echo "  monit     Live monitoring dashboard"
    echo ""
    echo "Direct PM2 access:  su - gsm -c 'pm2 <command>'"
    ;;
esac
GSMWRAPPER
chmod +x /usr/local/bin/gsm

ok "PM2 configured — panel running as 'gsm-panel'"
log "'gsm' command installed — run 'gsm status' from any user"

# ═══════════════════════════════════════════════════════════════════════════════
#  STEP 10: Caddy reverse proxy (optional)
# ═══════════════════════════════════════════════════════════════════════════════
step "Configuring web server"

if [[ "$SETUP_CADDY" == "true" && -n "$DOMAIN" ]]; then
  log "Installing Caddy..."

  # Install prerequisites
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https > /tmp/gsm-caddy-prereq.log 2>&1 || {
    warn "Some Caddy prerequisites could not be installed (may be fine)"
  }

  # Add Caddy APT repository
  log "Adding Caddy APT repository..."
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  
  apt-get update -qq
  
  log "Installing Caddy..."
  if ! apt-get install -y caddy > /tmp/gsm-caddy-install.log 2>&1; then
    err "Caddy installation failed!"
    cat /tmp/gsm-caddy-install.log
    warn "You can set up Caddy manually later"
    SETUP_CADDY="false"
  else
    ok "Caddy $(caddy version 2>/dev/null | head -1 || echo '?') installed"
  fi
fi

if [[ "$SETUP_CADDY" == "true" && -n "$DOMAIN" ]]; then

  # Write Caddyfile
  # The Caddyfile has TWO server blocks:
  #   1. The domain with automatic HTTPS (for external access)
  #   2. A plain HTTP listener on :PANEL_PORT (for LAN / direct access)
  # This way the panel is ALWAYS reachable on the LAN IP even if the
  # ACME challenge fails or the domain isn't set up yet.
  log "Writing Caddyfile for $DOMAIN..."

  # Create Caddy log directory with correct permissions BEFORE writing the config
  mkdir -p /var/log/caddy
  chown caddy:caddy /var/log/caddy
  chmod 755 /var/log/caddy
  # Pre-create the log file so Caddy doesn't fail on first write
  touch /var/log/caddy/gsm-panel.log
  chown caddy:caddy /var/log/caddy/gsm-panel.log

  cat > /etc/caddy/Caddyfile <<CADDYEOF
# GameServer Manager — Caddy reverse proxy

# ── HTTPS via domain (automatic Let's Encrypt) ──────────────
$DOMAIN {
    reverse_proxy 127.0.0.1:$PANEL_PORT
    request_body {
        max_size 256MB
    }
    encode gzip zstd
    header {
        X-Content-Type-Options nosniff
        X-Frame-Options SAMEORIGIN
        Referrer-Policy strict-origin-when-cross-origin
        -Server
    }
}

# ── Plain HTTP on port 8080 (LAN direct access — always works) ──
:8080 {
    reverse_proxy 127.0.0.1:$PANEL_PORT
    request_body {
        max_size 256MB
    }
    encode gzip zstd
}
CADDYEOF

  # Validate config
  caddy validate --config /etc/caddy/Caddyfile > /dev/null 2>&1 \
    && ok "Caddyfile validated" \
    || warn "Caddyfile validation had warnings (Caddy may still work)"

  # Enable and start Caddy
  systemctl enable caddy > /dev/null 2>&1
  systemctl restart caddy
  ok "Caddy started"

  # Wait a moment then check if Caddy is actually running
  sleep 2
  if systemctl is-active caddy > /dev/null 2>&1; then
    ok "Caddy is running"
  else
    warn "Caddy may have failed to start — checking logs..."
    journalctl -u caddy --no-pager -n 15 2>/dev/null || true
  fi

  # Check if the HTTP fallback port is reachable
  if curl -sf --max-time 3 "http://localhost:8080/api/health" > /dev/null 2>&1; then
    ok "Caddy HTTP fallback is working on port 8080"
  fi

  log "Caddy will attempt to obtain SSL certificate for $DOMAIN"
  log "If ACME fails (port 80 not forwarded), use http://<LAN-IP>:8080 instead"

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

# ── Skip UFW entirely inside containers ──────────────────────────────────────
# Enabling UFW inside an LXC container fights with the host's iptables/nftables
# and will drop SSH connections.  The host OS (ASUSTOR, Proxmox, etc.) manages
# the firewall.  Port forwarding is done on the router, not inside the container.
if [[ "${IS_CONTAINER:-false}" == "true" ]]; then
  log "Container detected — skipping UFW firewall configuration"
  log "Your host OS / router handles the firewall and port forwarding"
  log "Ensure your router forwards the following ports to this container's IP:"
  log "  - TCP $PANEL_PORT (panel)"
  if [[ "$SETUP_CADDY" == "true" ]]; then
    log "  - TCP 80 + 443 (Caddy HTTPS)"
  fi
  log "  - Game server ports as needed (see README for full list)"
  ok "Firewall step skipped (container — host manages firewall)"
elif ! command -v ufw &>/dev/null; then
  warn "UFW is not installed — skipping firewall configuration"
  warn "You should manually configure your firewall to allow:"
  warn "  - SSH (port 22 or your custom port)"
  warn "  - Panel (port $PANEL_PORT)"
  warn "  - Game server ports as needed"
  ok "Firewall step skipped (no UFW)"
else
  # ── Bare-metal / VM: configure UFW ─────────────────────────────────────────

  # Detect SSH port to avoid locking ourselves out
  SSH_PORT="22"
  if [[ -f /etc/ssh/sshd_config ]]; then
    DETECTED_PORT=$(grep -E "^[[:space:]]*Port[[:space:]]+" /etc/ssh/sshd_config 2>/dev/null | awk '{print $2}' | head -1 || true)
    if [[ -n "${DETECTED_PORT:-}" && "${DETECTED_PORT:-}" =~ ^[0-9]+$ ]]; then
      SSH_PORT="$DETECTED_PORT"
    fi
  fi

  # Check drop-in configs (Ubuntu 24.04+, Debian 12+)
  if [[ -d /etc/ssh/sshd_config.d ]]; then
    for cfg in /etc/ssh/sshd_config.d/*.conf; do
      [[ -f "$cfg" ]] || continue
      DROP_PORT=$(grep -E "^[[:space:]]*Port[[:space:]]+" "$cfg" 2>/dev/null | awk '{print $2}' | head -1 || true)
      if [[ -n "${DROP_PORT:-}" && "${DROP_PORT:-}" =~ ^[0-9]+$ ]]; then
        SSH_PORT="$DROP_PORT"
      fi
    done
  fi

  # Check current SSH session port as a safeguard
  if [[ -n "${SSH_CONNECTION:-}" ]]; then
    CONN_PORT=$(echo "$SSH_CONNECTION" | awk '{print $4}' || true)
    if [[ -n "${CONN_PORT:-}" && "${CONN_PORT:-}" =~ ^[0-9]+$ && "$CONN_PORT" != "$SSH_PORT" ]]; then
      warn "Current SSH session is on port $CONN_PORT (sshd_config says $SSH_PORT) — allowing both"
      ufw allow "$CONN_PORT/tcp" comment "SSH (active session)" > /dev/null 2>&1 || true
    fi
  fi

  # Allow SSH FIRST — before anything else and before enabling UFW
  ufw allow "$SSH_PORT/tcp" comment "SSH" > /dev/null 2>&1 || true
  # Also always allow port 22 as a safety net even if sshd is on another port
  ufw allow 22/tcp comment "SSH (fallback)" > /dev/null 2>&1 || true
  if [[ "$SSH_PORT" != "22" ]]; then
    log "SSH detected on port $SSH_PORT (non-default) — both 22 and $SSH_PORT allowed"
  fi

  # Panel / Caddy
  if [[ "$SETUP_CADDY" == "true" ]]; then
    ufw allow 80/tcp  comment "HTTP  (Caddy)" > /dev/null 2>&1 || true
    ufw allow 443/tcp comment "HTTPS (Caddy)" > /dev/null 2>&1 || true
  else
    ufw allow "$PANEL_PORT/tcp" comment "GSM Panel" > /dev/null 2>&1 || true
  fi

  # Game server ports (every game in the template library)
  ufw allow 27015:27030/tcp comment "Source engine"         > /dev/null 2>&1 || true
  ufw allow 27015:27030/udp comment "Source engine"         > /dev/null 2>&1 || true
  ufw allow 25565/tcp     comment "Minecraft Java"          > /dev/null 2>&1 || true
  ufw allow 25565/udp     comment "Minecraft Java"          > /dev/null 2>&1 || true
  ufw allow 19132/udp     comment "Minecraft Bedrock"       > /dev/null 2>&1 || true
  ufw allow 28015/tcp     comment "Rust"                    > /dev/null 2>&1 || true
  ufw allow 28015/udp     comment "Rust"                    > /dev/null 2>&1 || true
  ufw allow 28016/tcp     comment "Rust RCON"               > /dev/null 2>&1 || true
  ufw allow 7777:7778/tcp comment "ARK/Satisfactory/Terraria" > /dev/null 2>&1 || true
  ufw allow 7777:7778/udp comment "ARK/Satisfactory/Terraria" > /dev/null 2>&1 || true
  ufw allow 15000/udp     comment "Satisfactory beacon"     > /dev/null 2>&1 || true
  ufw allow 2456:2458/tcp comment "Valheim"                 > /dev/null 2>&1 || true
  ufw allow 2456:2458/udp comment "Valheim"                 > /dev/null 2>&1 || true
  ufw allow 26900:26902/tcp comment "7 Days to Die"         > /dev/null 2>&1 || true
  ufw allow 26900:26902/udp comment "7 Days to Die"         > /dev/null 2>&1 || true
  ufw allow 8211/tcp      comment "Palworld"                > /dev/null 2>&1 || true
  ufw allow 8211/udp      comment "Palworld"                > /dev/null 2>&1 || true
  ufw allow 15636:15637/tcp comment "Enshrouded"            > /dev/null 2>&1 || true
  ufw allow 15636:15637/udp comment "Enshrouded"            > /dev/null 2>&1 || true
  ufw allow 27102/tcp     comment "Insurgency: Sandstorm"   > /dev/null 2>&1 || true
  ufw allow 27102/udp     comment "Insurgency: Sandstorm"   > /dev/null 2>&1 || true
  ufw allow 27131/udp     comment "Insurgency query"        > /dev/null 2>&1 || true
  ufw allow 7787/tcp      comment "Squad"                   > /dev/null 2>&1 || true
  ufw allow 7787/udp      comment "Squad"                   > /dev/null 2>&1 || true
  ufw allow 2302:2306/udp comment "Arma 3"                  > /dev/null 2>&1 || true
  ufw allow 27960/tcp     comment "ET:Legacy/QuakeLive"     > /dev/null 2>&1 || true
  ufw allow 27960/udp     comment "ET:Legacy/QuakeLive"     > /dev/null 2>&1 || true
  ufw allow 1234/tcp      comment "OpenRA"                  > /dev/null 2>&1 || true
  ufw allow 1234/udp      comment "OpenRA"                  > /dev/null 2>&1 || true
  ufw allow 26000/tcp     comment "Xonotic"                 > /dev/null 2>&1 || true
  ufw allow 26000/udp     comment "Xonotic"                 > /dev/null 2>&1 || true
  ufw allow 9876:9877/tcp comment "V Rising"                > /dev/null 2>&1 || true
  ufw allow 9876:9877/udp comment "V Rising"                > /dev/null 2>&1 || true
  ufw allow 16261:16262/tcp comment "Project Zomboid"       > /dev/null 2>&1 || true
  ufw allow 16261:16262/udp comment "Project Zomboid"       > /dev/null 2>&1 || true
  ufw allow 34197/udp     comment "Factorio"                > /dev/null 2>&1 || true
  ufw allow 10999:11000/udp comment "Don't Starve Together" > /dev/null 2>&1 || true
  ufw allow 9600/tcp      comment "Assetto Corsa"           > /dev/null 2>&1 || true
  ufw allow 9600/udp      comment "Assetto Corsa"           > /dev/null 2>&1 || true

  # Enable UFW
  ufw --force enable > /dev/null 2>&1 || true
  ok "Firewall configured (SSH $SSH_PORT + panel + all game server ports)"
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  Done!
# ═══════════════════════════════════════════════════════════════════════════════

# Determine access URLs
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

# LAN fallback URL (always works, no SSL, no domain needed)
if [[ -n "${LAN_IP:-}" ]]; then
  SERVER_LAN_IP_FINAL="$LAN_IP"
else
  SERVER_LAN_IP_FINAL=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "unknown")
fi
if [[ "$SETUP_CADDY" == "true" ]]; then
  LAN_URL="http://$SERVER_LAN_IP_FINAL:8080"
else
  LAN_URL="http://$SERVER_LAN_IP_FINAL:$PANEL_PORT"
fi

# ── Post-install connectivity check ───────────────────────────────────────────
log "Checking panel connectivity..."
sleep 3

PANEL_LOCAL_OK="false"
if curl -sf --max-time 5 "http://localhost:$PANEL_PORT/api/health" > /dev/null 2>&1 \
   || curl -sf --max-time 5 "http://127.0.0.1:$PANEL_PORT/api/health" > /dev/null 2>&1; then
  PANEL_LOCAL_OK="true"
fi

# Detect the container/server's LAN IP for the summary
if [[ -n "${LAN_IP:-}" ]]; then
  SERVER_LAN_IP="$LAN_IP"
else
  SERVER_LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "unknown")
fi

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║${NC}  ${BOLD}🎉  Installation Complete!${NC}                                 ${GREEN}║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${BOLD}Panel URL:${NC}       $ACCESS_URL"
echo -e "  ${BOLD}LAN Access:${NC}      ${GREEN}$LAN_URL${NC}  ← ${BOLD}use this first${NC}"
echo -e "  ${BOLD}Admin User:${NC}      $ADMIN_USER"
echo -e "  ${BOLD}Admin Email:${NC}     $ADMIN_EMAIL"
if [[ "$NONINTERACTIVE" == "true" && -n "$ADMIN_PASS" ]]; then
  echo -e "  ${BOLD}Admin Password:${NC}  $ADMIN_PASS"
fi
echo ""

if [[ "$PANEL_LOCAL_OK" == "true" ]]; then
  ok "Panel is running and responding on localhost:$PANEL_PORT"
else
  warn "Panel is not responding on localhost:$PANEL_PORT yet"
  warn "It may still be starting up — check:  gsm logs"
fi

echo ""
echo -e "  ${BOLD}Panel Dir:${NC}       $INSTALL_DIR"
echo -e "  ${BOLD}Database:${NC}        $DB_NAME (user: $DB_USER)"
echo -e "  ${BOLD}Game Servers:${NC}    $GAMESERVERS_DIR"
if [[ "$SKIP_STEAMCMD" != "true" ]]; then
  echo -e "  ${BOLD}SteamCMD:${NC}        $STEAMCMD_DIR"
fi
echo -e "  ${BOLD}Logs (panel):${NC}    /var/log/gsm-panel/"
if [[ "$SETUP_CADDY" == "true" ]]; then
  echo -e "  ${BOLD}Logs (caddy):${NC}    /var/log/caddy/"
fi
echo ""
echo -e "  ${CYAN}Panel management (works as any user):${NC}"
echo -e "    gsm status      # View panel process status"
echo -e "    gsm logs        # View live logs (Ctrl+C to exit)"
echo -e "    gsm restart     # Restart the panel"
echo -e "    gsm stop        # Stop the panel"
echo -e "    gsm start       # Start the panel"
echo -e "    gsm monit       # Live monitoring dashboard"
if [[ "$SKIP_STEAMCMD" != "true" ]]; then
  echo ""
  echo -e "  ${CYAN}SteamCMD usage:${NC}"
  echo -e "    steamcmd +login anonymous +quit                  # Test SteamCMD"
  echo -e "    $STEAMCMD_DIR/install-game.sh 730 $GAMESERVERS_DIR/cs2     # Install CS2"
  echo -e "    $STEAMCMD_DIR/install-game.sh 896660 $GAMESERVERS_DIR/valheim  # Install Valheim"
fi
if [[ "$SETUP_CADDY" == "true" ]]; then
  echo ""
  echo -e "  ${CYAN}Caddy commands:${NC}"
  echo -e "    systemctl status caddy      # Caddy status"
  echo -e "    systemctl restart caddy     # Restart Caddy"
  echo -e "    journalctl -u caddy         # Caddy logs"
fi
echo ""
echo -e "  ${CYAN}Update to latest version:${NC}"
echo -e "    cd $INSTALL_DIR && git pull && npm ci && npx next build && gsm restart"
echo ""

if [[ "$SETUP_CADDY" == "true" && -n "$DOMAIN" ]]; then
  echo -e "  ${CYAN}${BOLD}📡 Access your panel:${NC}"
  echo -e "     ${GREEN}$LAN_URL${NC}  ← works right now on your LAN (no SSL)"
  echo -e "     $ACCESS_URL  ← works after router port forwarding"
  echo ""
  echo -e "  ${YELLOW}${BOLD}⚠  For HTTPS ($DOMAIN) to work, forward on your router:${NC}"
  echo -e "     TCP 80   → $SERVER_LAN_IP_FINAL:80    (Let's Encrypt ACME challenge)"
  echo -e "     TCP 443  → $SERVER_LAN_IP_FINAL:443   (HTTPS traffic)"
  echo ""
  echo -e "  ${CYAN}Troubleshooting ERR_CONNECTION_REFUSED:${NC}"
  echo -e "     1. Open ${GREEN}$LAN_URL${NC} in your browser first — if this works, the panel is fine"
  echo -e "     2. Forward TCP 80+443 on your router to $SERVER_LAN_IP_FINAL"
  echo -e "     3. Check Caddy logs:  journalctl -u caddy --no-pager -n 30"
  echo -e "     4. Some ISPs block port 80 — try the LAN URL instead"
  echo ""
fi

# Save install details to a file for reference
cat > "$INSTALL_DIR/.install-info" <<INFOEOF
# GameServer Manager — Install Details
# Generated: $(date -u +"%Y-%m-%d %H:%M:%S UTC")
PANEL_URL=$ACCESS_URL
PANEL_LAN_URL=$LAN_URL
ADMIN_USER=$ADMIN_USER
ADMIN_EMAIL=$ADMIN_EMAIL
INSTALL_DIR=$INSTALL_DIR
DB_NAME=$DB_NAME
DB_USER=$DB_USER
PANEL_PORT=$PANEL_PORT
DOMAIN=$DOMAIN
SERVER_LAN_IP=$SERVER_LAN_IP_FINAL
REVERSE_PROXY=caddy
STEAMCMD_DIR=$STEAMCMD_DIR
GAMESERVERS_DIR=$GAMESERVERS_DIR
INFOEOF
chmod 600 "$INSTALL_DIR/.install-info"

log "Installation details saved to $INSTALL_DIR/.install-info"
echo ""
