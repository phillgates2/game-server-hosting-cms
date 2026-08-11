#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
#  GameServer Manager — Uninstaller
# ═══════════════════════════════════════════════════════════════════════════════
#
#  Usage:  sudo bash uninstall.sh [--purge]
#
#  --purge    Also remove the PostgreSQL database, system user, and Caddy
#
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log()  { echo -e "${CYAN}[GSM]${NC} $*"; }
ok()   { echo -e "${GREEN}[✓]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[✗]${NC} $*" >&2; }
die()  { err "$*"; exit 1; }

INSTALL_DIR="/opt/gsm-panel"
GSM_USER="gsm"
DB_NAME="gsm_panel"
DB_USER="gsm"
PURGE="false"

for arg in "$@"; do
  case "$arg" in
    --purge) PURGE="true" ;;
  esac
done

[[ $EUID -ne 0 ]] && die "Run as root: sudo bash uninstall.sh"

# Read install info if available
if [[ -f "$INSTALL_DIR/.install-info" ]]; then
  source "$INSTALL_DIR/.install-info" 2>/dev/null || true
fi

echo ""
echo -e "${RED}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${RED}║${NC}  ${BOLD}🗑️  GameServer Manager — Uninstaller${NC}                        ${RED}║${NC}"
echo -e "${RED}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""

if [[ "$PURGE" == "true" ]]; then
  warn "PURGE mode: database, user, Caddy config, and all data will be removed!"
fi

read -rp "Are you sure you want to uninstall? [y/N]: " confirm
[[ "${confirm,,}" != "y" ]] && { log "Cancelled."; exit 0; }

# Stop PM2 process
log "Stopping panel..."
su - "$GSM_USER" -c "pm2 delete gsm-panel" 2>/dev/null || true
su - "$GSM_USER" -c "pm2 save --force" 2>/dev/null || true
ok "Panel stopped"

# Remove Caddy config (keep Caddy installed unless --purge)
if [[ -f /etc/caddy/Caddyfile ]]; then
  if grep -q "gsm-panel\|GameServer Manager" /etc/caddy/Caddyfile 2>/dev/null; then
    log "Removing Caddy configuration..."
    # Replace Caddyfile with empty default
    echo "# Caddy — default config (GSM panel removed)" > /etc/caddy/Caddyfile
    systemctl reload caddy 2>/dev/null || true
    ok "Caddy configuration removed"
  fi
fi

# Remove log directories
if [[ -d /var/log/gsm-panel ]]; then
  rm -rf /var/log/gsm-panel
  ok "Panel logs removed"
fi

# Remove application directory
if [[ -d "$INSTALL_DIR" ]]; then
  log "Removing $INSTALL_DIR..."
  rm -rf "$INSTALL_DIR"
  ok "Application files removed"
fi

if [[ "$PURGE" == "true" ]]; then
  # Drop database
  log "Dropping database '$DB_NAME'..."
  su - postgres -c "psql -c \"DROP DATABASE IF EXISTS $DB_NAME;\"" 2>/dev/null || true
  su - postgres -c "psql -c \"DROP ROLE IF EXISTS $DB_USER;\"" 2>/dev/null || true
  ok "Database removed"

  # Remove Caddy entirely
  if command -v caddy &>/dev/null; then
    log "Removing Caddy..."
    systemctl stop caddy 2>/dev/null || true
    systemctl disable caddy 2>/dev/null || true
    apt-get remove -y -qq caddy 2>/dev/null || true
    rm -rf /var/log/caddy 2>/dev/null || true
    rm -f /etc/apt/sources.list.d/caddy-stable.list 2>/dev/null || true
    rm -f /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null || true
    ok "Caddy removed"
  fi

  # Remove system user
  log "Removing system user '$GSM_USER'..."
  userdel -r "$GSM_USER" 2>/dev/null || true
  ok "System user removed"
fi

echo ""
echo -e "${GREEN}[✓] GameServer Manager has been uninstalled.${NC}"
if [[ "$PURGE" != "true" ]]; then
  echo ""
  echo "  Database '$DB_NAME' and user '$GSM_USER' were kept."
  echo "  Caddy remains installed (config was cleared)."
  echo "  To fully remove everything:  sudo bash uninstall.sh --purge"
fi
echo ""
