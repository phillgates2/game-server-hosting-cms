#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
#  GameServer Manager — Updater
# ═══════════════════════════════════════════════════════════════════════════════
#
#  Usage (run as root or with sudo):
#
#    bash <(curl -fsSL https://raw.githubusercontent.com/phillgates2/game-server-hosting-cms/main/public/update.sh)
#
#  Or from the install directory:
#
#    sudo bash /opt/gsm-panel/public/update.sh
#
#  Options:
#    --force          Skip the "are you sure?" prompt
#    --no-backup      Skip the pre-update backup
#    --branch NAME    Pull from a specific git branch (default: main)
#    --rollback       Restore the last backup instead of updating
#    --help, -h       Show this help
#
#  What this script does:
#    1. Backs up the current installation (.env, drizzle config, ecosystem)
#    2. Pulls the latest code from GitHub
#    3. Installs/updates npm dependencies
#    4. Applies any new database migrations (drizzle-kit push)
#    5. Builds the production bundle
#    6. Prunes devDependencies
#    7. Restarts the panel via PM2
#    8. Verifies the panel is healthy
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

# ── Defaults ──────────────────────────────────────────────────────────────────
INSTALL_DIR="/opt/gsm-panel"
GSM_USER="gsm"
BRANCH="main"
FORCE="false"
NO_BACKUP="false"
ROLLBACK="false"
BACKUP_DIR="/opt/gsm-panel-backups"

# ── Read install-info if it exists ────────────────────────────────────────────
if [[ -f "$INSTALL_DIR/.install-info" ]]; then
  source "$INSTALL_DIR/.install-info" 2>/dev/null || true
  PANEL_PORT="${PANEL_PORT:-3000}"
else
  PANEL_PORT="3000"
fi

# ── Parse arguments ───────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --force)      FORCE="true"; shift ;;
    --no-backup)  NO_BACKUP="true"; shift ;;
    --branch)     BRANCH="$2"; shift 2 ;;
    --rollback)   ROLLBACK="true"; shift ;;
    --install-dir) INSTALL_DIR="$2"; shift 2 ;;
    --help|-h)
      echo ""
      echo "GameServer Manager — Updater"
      echo ""
      echo "Usage:"
      echo "  bash update.sh [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --force          Skip confirmation prompt"
      echo "  --no-backup      Skip pre-update backup"
      echo "  --branch NAME    Git branch to pull from (default: main)"
      echo "  --rollback       Restore the last backup"
      echo "  --install-dir    Panel directory (default: /opt/gsm-panel)"
      echo "  --help, -h       Show this help"
      echo ""
      echo "One-liner:"
      echo "  bash <(curl -fsSL https://raw.githubusercontent.com/phillgates2/game-server-hosting-cms/main/public/update.sh)"
      echo ""
      exit 0
      ;;
    *) die "Unknown option: $1  (use --help)" ;;
  esac
done

# ── Root / sudo check ─────────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  if command -v sudo &>/dev/null; then
    warn "Not running as root — re-launching with sudo..."
    exec sudo bash "$0" "$@"
  else
    die "This updater needs root access. Run with:  sudo bash update.sh"
  fi
fi

if [[ ! -d "$INSTALL_DIR/.git" ]]; then
  die "$INSTALL_DIR is not a git repository. Is the panel installed?"
fi

if ! id "$GSM_USER" &>/dev/null; then
  die "System user '$GSM_USER' not found. Is the panel installed?"
fi

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║${NC}  ${BOLD}🎮  GameServer Manager — Updater${NC}                           ${CYAN}║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""

cd "$INSTALL_DIR"

# ── Fix git safe.directory ────────────────────────────────────────────────────
# When the repo is owned by 'gsm' but the updater runs as root, git refuses
# to operate due to safe.directory checks.  Mark this directory as safe.
git config --global --get safe.directory "$INSTALL_DIR" > /dev/null 2>&1 \
  || git config --global --add safe.directory "$INSTALL_DIR" 2>/dev/null || true

# ── Ensure git remote is configured ──────────────────────────────────────────
REPO_URL="https://github.com/phillgates2/game-server-hosting-cms.git"
CURRENT_REMOTE=$(git remote get-url origin 2>/dev/null || echo "")
if [[ -z "$CURRENT_REMOTE" ]]; then
  log "No git remote 'origin' found — adding it..."
  git remote add origin "$REPO_URL" 2>/dev/null || true
elif [[ "$CURRENT_REMOTE" != *"game-server-hosting-cms"* ]]; then
  warn "Remote 'origin' points to unexpected URL: $CURRENT_REMOTE"
  warn "Updating to $REPO_URL"
  git remote set-url origin "$REPO_URL" 2>/dev/null || true
fi

# If .git is completely broken, re-initialize
if ! git rev-parse HEAD > /dev/null 2>&1; then
  warn "Git repository appears broken — re-initializing..."
  # Save config files before nuke
  cp -f "$INSTALL_DIR/.env" /tmp/gsm-env-save 2>/dev/null || true
  cp -f "$INSTALL_DIR/drizzle.config.json" /tmp/gsm-drizzle-save 2>/dev/null || true
  cp -f "$INSTALL_DIR/ecosystem.config.cjs" /tmp/gsm-ecosystem-save 2>/dev/null || true
  cp -f "$INSTALL_DIR/.install-info" /tmp/gsm-installinfo-save 2>/dev/null || true

  rm -rf "$INSTALL_DIR/.git"
  git init 2>/dev/null || true
  git remote add origin "$REPO_URL" 2>/dev/null || true
  git fetch origin "$BRANCH" 2>/dev/null || true
  git checkout -f "origin/$BRANCH" 2>/dev/null || git checkout -f FETCH_HEAD 2>/dev/null || true
  git checkout -b "$BRANCH" 2>/dev/null || true

  # Restore config files
  cp -f /tmp/gsm-env-save "$INSTALL_DIR/.env" 2>/dev/null || true
  cp -f /tmp/gsm-drizzle-save "$INSTALL_DIR/drizzle.config.json" 2>/dev/null || true
  cp -f /tmp/gsm-ecosystem-save "$INSTALL_DIR/ecosystem.config.cjs" 2>/dev/null || true
  cp -f /tmp/gsm-installinfo-save "$INSTALL_DIR/.install-info" 2>/dev/null || true
  rm -f /tmp/gsm-env-save /tmp/gsm-drizzle-save /tmp/gsm-ecosystem-save /tmp/gsm-installinfo-save

  ok "Git repository re-initialized"
fi

# ── Current version info ──────────────────────────────────────────────────────
CURRENT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
log "Current version: commit $CURRENT_COMMIT on branch $CURRENT_BRANCH"
log "Install directory: $INSTALL_DIR"
log "Target branch: $BRANCH"

# ── Rollback mode ────────────────────────────────────────────────────────────
if [[ "$ROLLBACK" == "true" ]]; then
  LATEST_BACKUP=$(ls -1d "$BACKUP_DIR"/gsm-backup-* 2>/dev/null | sort -r | head -1 || true)
  if [[ -z "$LATEST_BACKUP" || ! -d "$LATEST_BACKUP" ]]; then
    die "No backups found in $BACKUP_DIR"
  fi

  echo -e "  ${BOLD}Backup to restore:${NC} $LATEST_BACKUP"
  echo ""

  if [[ "$FORCE" != "true" ]]; then
    read -rp "  Restore this backup? [y/N]: " confirm
    [[ "${confirm,,}" == "y" ]] || { log "Cancelled."; exit 0; }
  fi

  log "Stopping panel..."
  su - "$GSM_USER" -c "pm2 stop gsm-panel" 2>/dev/null || true

  log "Restoring backup..."
  # Restore config files
  cp -f "$LATEST_BACKUP/.env" "$INSTALL_DIR/.env" 2>/dev/null || true
  cp -f "$LATEST_BACKUP/drizzle.config.json" "$INSTALL_DIR/drizzle.config.json" 2>/dev/null || true
  cp -f "$LATEST_BACKUP/ecosystem.config.cjs" "$INSTALL_DIR/ecosystem.config.cjs" 2>/dev/null || true

  # Restore the git state
  if [[ -f "$LATEST_BACKUP/git-commit.txt" ]]; then
    RESTORE_COMMIT=$(cat "$LATEST_BACKUP/git-commit.txt")
    git checkout "$RESTORE_COMMIT" 2>/dev/null || warn "Could not checkout commit $RESTORE_COMMIT"
  fi

  # Rebuild
  log "Reinstalling dependencies..."
  su - "$GSM_USER" -c "cd $INSTALL_DIR && npm ci" > /dev/null 2>&1 || true
  log "Rebuilding..."
  su - "$GSM_USER" -c "cd $INSTALL_DIR && rm -rf .next && npx next build" > /tmp/gsm-rollback-build.log 2>&1 || true
  if ! su - "$GSM_USER" -c "test -f $INSTALL_DIR/.next/BUILD_ID" 2>/dev/null; then
    err "Rollback rebuild failed!"
    tail -30 /tmp/gsm-rollback-build.log
    die "The restored code did not build. Full log: /tmp/gsm-rollback-build.log"
  fi
  su - "$GSM_USER" -c "cd $INSTALL_DIR && npm prune --omit=dev" > /dev/null 2>&1 || true

  log "Starting panel..."
  su - "$GSM_USER" -c "pm2 restart gsm-panel" 2>/dev/null || su - "$GSM_USER" -c "cd $INSTALL_DIR && pm2 start ecosystem.config.cjs" 2>/dev/null || true

  ok "Rollback complete to $(cat "$LATEST_BACKUP/git-commit.txt" 2>/dev/null || echo 'previous backup')"
  echo ""
  exit 0
fi

# ── Check for updates ────────────────────────────────────────────────────────
log "Checking for updates..."
if ! git fetch origin "$BRANCH" 2>/dev/null; then
  warn "git fetch failed — trying full fetch..."
  if ! git fetch origin 2>/dev/null; then
    warn "git fetch origin failed — trying to fix remote..."
    git remote set-url origin "$REPO_URL" 2>/dev/null || true
    if ! git fetch origin "$BRANCH" 2>/dev/null; then
      die "Cannot fetch updates. Check your internet connection and try again."
    fi
  fi
fi

LOCAL_HEAD=$(git rev-parse HEAD 2>/dev/null || echo "")
REMOTE_HEAD=$(git rev-parse "origin/$BRANCH" 2>/dev/null || echo "")

if [[ "$LOCAL_HEAD" == "$REMOTE_HEAD" ]]; then
  ok "Already up to date (commit $CURRENT_COMMIT)"
  echo ""

  if [[ "$FORCE" != "true" ]]; then
    read -rp "  Force rebuild anyway? [y/N]: " confirm
    if [[ "${confirm,,}" != "y" ]]; then
      log "Nothing to do."
      exit 0
    fi
  else
    log "Already up to date but --force was set, continuing..."
  fi
fi

# Show what's new
NEW_COMMITS=$(git log --oneline HEAD..origin/$BRANCH 2>/dev/null || true)
if [[ -n "$NEW_COMMITS" ]]; then
  echo ""
  echo -e "  ${BOLD}New commits:${NC}"
  echo "$NEW_COMMITS" | head -20 | sed 's/^/    /'
  COMMIT_COUNT=$(echo "$NEW_COMMITS" | wc -l)
  if [[ $COMMIT_COUNT -gt 20 ]]; then
    echo "    ... and $((COMMIT_COUNT - 20)) more"
  fi
  echo ""
fi

# ── Confirmation ──────────────────────────────────────────────────────────────
if [[ "$FORCE" != "true" ]]; then
  read -rp "  Proceed with update? [Y/n]: " confirm
  if [[ "${confirm,,}" == "n" ]]; then
    log "Update cancelled."
    exit 0
  fi
fi

TOTAL_STEPS=7
STEP=0
step() {
  STEP=$((STEP + 1))
  echo ""
  echo -e "${CYAN}━━━ Step $STEP/$TOTAL_STEPS: $1 ━━━${NC}"
}

# ═══════════════════════════════════════════════════════════════════════════════
#  STEP 1: Backup
# ═══════════════════════════════════════════════════════════════════════════════
step "Backing up current installation"

if [[ "$NO_BACKUP" == "true" ]]; then
  warn "Backup skipped (--no-backup)"
else
  TIMESTAMP=$(date +%Y%m%d-%H%M%S)
  THIS_BACKUP="$BACKUP_DIR/gsm-backup-$TIMESTAMP"
  mkdir -p "$THIS_BACKUP"

  # Save config files
  cp -f "$INSTALL_DIR/.env" "$THIS_BACKUP/.env" 2>/dev/null || true
  cp -f "$INSTALL_DIR/drizzle.config.json" "$THIS_BACKUP/drizzle.config.json" 2>/dev/null || true
  cp -f "$INSTALL_DIR/ecosystem.config.cjs" "$THIS_BACKUP/ecosystem.config.cjs" 2>/dev/null || true
  cp -f "$INSTALL_DIR/.install-info" "$THIS_BACKUP/.install-info" 2>/dev/null || true

  # Save current git commit for rollback
  echo "$CURRENT_COMMIT" > "$THIS_BACKUP/git-commit.txt"
  echo "$CURRENT_BRANCH" > "$THIS_BACKUP/git-branch.txt"
  date -u > "$THIS_BACKUP/backup-date.txt"

  # Dump the database
  if command -v pg_dump &>/dev/null; then
    log "Dumping database..."
    # Read DB URL from .env
    DB_URL=$(grep -E "^DATABASE_URL=" "$INSTALL_DIR/.env" 2>/dev/null | cut -d= -f2- || true)
    if [[ -n "$DB_URL" ]]; then
      pg_dump "$DB_URL" > "$THIS_BACKUP/database.sql" 2>/dev/null || warn "Database dump failed (non-fatal)"
      if [[ -f "$THIS_BACKUP/database.sql" ]]; then
        DUMP_SIZE=$(du -h "$THIS_BACKUP/database.sql" | cut -f1)
        ok "Database dumped ($DUMP_SIZE)"
      fi
    else
      warn "Could not read DATABASE_URL from .env — skipping database dump"
    fi
  else
    warn "pg_dump not found — skipping database dump"
  fi

  chown -R "$GSM_USER:$GSM_USER" "$BACKUP_DIR" 2>/dev/null || true
  ok "Backup saved to $THIS_BACKUP"

  # Prune old backups (keep last 5)
  BACKUP_COUNT=$(ls -1d "$BACKUP_DIR"/gsm-backup-* 2>/dev/null | wc -l || echo 0)
  if [[ $BACKUP_COUNT -gt 5 ]]; then
    ls -1d "$BACKUP_DIR"/gsm-backup-* | sort | head -n -5 | while read -r old; do
      rm -rf "$old"
    done
    log "Pruned old backups (keeping last 5)"
  fi
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  STEP 2: Stop the panel
# ═══════════════════════════════════════════════════════════════════════════════
step "Stopping panel"

su - "$GSM_USER" -c "pm2 stop gsm-panel" 2>/dev/null || true
sleep 2
ok "Panel stopped"

# ═══════════════════════════════════════════════════════════════════════════════
#  STEP 3: Pull latest code
# ═══════════════════════════════════════════════════════════════════════════════
step "Pulling latest code"

# Save user config files before git operations might overwrite them
cp -f "$INSTALL_DIR/.env" /tmp/gsm-update-env-save 2>/dev/null || true
cp -f "$INSTALL_DIR/drizzle.config.json" /tmp/gsm-update-drizzle-save 2>/dev/null || true
cp -f "$INSTALL_DIR/ecosystem.config.cjs" /tmp/gsm-update-ecosystem-save 2>/dev/null || true
cp -f "$INSTALL_DIR/.install-info" /tmp/gsm-update-info-save 2>/dev/null || true

# Stash any local changes (e.g. edited config files that are tracked)
git stash 2>/dev/null || true

# Switch to target branch if different
if [[ "$CURRENT_BRANCH" != "$BRANCH" && "$CURRENT_BRANCH" != "unknown" ]]; then
  log "Switching from $CURRENT_BRANCH to $BRANCH..."
  git checkout "$BRANCH" 2>/dev/null || git checkout -b "$BRANCH" "origin/$BRANCH" 2>/dev/null || true
fi

# Pull latest — try multiple strategies
if git pull origin "$BRANCH" --ff-only 2>/dev/null; then
  ok "Fast-forward pull succeeded"
elif git pull origin "$BRANCH" 2>/dev/null; then
  ok "Merge pull succeeded"
else
  warn "Pull failed — resetting to remote..."
  git fetch origin "$BRANCH" 2>/dev/null || true
  git reset --hard "origin/$BRANCH" 2>/dev/null || die "Failed to update code from origin/$BRANCH"
  ok "Reset to origin/$BRANCH"
fi

# Restore stashed changes
git stash pop 2>/dev/null || true

# Restore user config files (git pull/reset may have overwritten them)
cp -f /tmp/gsm-update-env-save "$INSTALL_DIR/.env" 2>/dev/null || true
cp -f /tmp/gsm-update-drizzle-save "$INSTALL_DIR/drizzle.config.json" 2>/dev/null || true
cp -f /tmp/gsm-update-ecosystem-save "$INSTALL_DIR/ecosystem.config.cjs" 2>/dev/null || true
cp -f /tmp/gsm-update-info-save "$INSTALL_DIR/.install-info" 2>/dev/null || true
rm -f /tmp/gsm-update-env-save /tmp/gsm-update-drizzle-save /tmp/gsm-update-ecosystem-save /tmp/gsm-update-info-save

NEW_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
chown -R "$GSM_USER:$GSM_USER" "$INSTALL_DIR"
ok "Updated: $CURRENT_COMMIT → $NEW_COMMIT"

# ── Migrate .env for newer requirements ──────────────────────────────────────
# As of 1.5.0 JWT_SECRET is mandatory in production (the app refuses to boot
# and `next build` fails without it). Installs made before that release may
# have relied on the old auto-generated fallback, so backfill it here.
ENV_FILE="$INSTALL_DIR/.env"
if [[ -f "$ENV_FILE" ]]; then
  EXISTING_JWT=$(grep -E "^JWT_SECRET=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- || true)
  if [[ -z "$EXISTING_JWT" || ${#EXISTING_JWT} -lt 32 ]]; then
    NEW_JWT=$(openssl rand -base64 48 2>/dev/null | tr -d '=/+' || head -c 64 /dev/urandom | od -An -tx1 | tr -d ' \n')
    # Drop any empty/short existing entry, then append the new one.
    sed -i '/^JWT_SECRET=/d' "$ENV_FILE"
    echo "JWT_SECRET=$NEW_JWT" >> "$ENV_FILE"
    chown "$GSM_USER:$GSM_USER" "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    if [[ -z "$EXISTING_JWT" ]]; then
      warn "JWT_SECRET was missing from .env — generated one (required since 1.5.0)."
    else
      warn "JWT_SECRET in .env was shorter than 32 chars — replaced it."
    fi
    warn "Existing login sessions will be invalidated; users must sign in again."
  fi
fi

# NODE_ENV=production is what makes the panel enforce the JWT policy.
if [[ -f "$ENV_FILE" ]] && ! grep -qE "^NODE_ENV=" "$ENV_FILE" 2>/dev/null; then
  echo "NODE_ENV=production" >> "$ENV_FILE"
  log "Added NODE_ENV=production to .env"
fi

# ── Remove files a release deleted that git cannot clean up ──────────────────
# Next 16 replaced the middleware.ts convention with proxy.ts, and refuses to
# build when both exist:
#
#   Error: Both middleware file "./src/middleware.ts" and proxy file
#   "./src/proxy.ts" are detected.
#
# src/middleware.ts was never tracked in git, so a pull cannot delete it. On
# any install that ran before the rename the stale file survives the update
# and the build fails hard -- and because --rollback restores the same
# untracked file, retrying fails the same way. Remove it before building.
STALE_MIDDLEWARE="$INSTALL_DIR/src/middleware.ts"
if [[ -f "$STALE_MIDDLEWARE" && -f "$INSTALL_DIR/src/proxy.ts" ]]; then
  # THIS_BACKUP only exists when a backup was taken; --no-backup leaves it
  # unset, and this script runs under `set -u`.
  if [[ -n "${THIS_BACKUP:-}" && -d "${THIS_BACKUP:-}" ]]; then
    mv -f "$STALE_MIDDLEWARE" "$THIS_BACKUP/middleware.ts.removed" 2>/dev/null \
      || rm -f "$STALE_MIDDLEWARE"
    log "A copy was kept in $THIS_BACKUP/ if you had customised it."
  else
    rm -f "$STALE_MIDDLEWARE"
  fi
  warn "Removed the obsolete src/middleware.ts (replaced by src/proxy.ts in Next 16)."
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  STEP 4: Install dependencies
# ═══════════════════════════════════════════════════════════════════════════════
step "Installing dependencies"

log "Running npm ci (full install including devDependencies)..."
su - "$GSM_USER" -c "cd $INSTALL_DIR && npm ci" > /tmp/gsm-update-npm.log 2>&1 || true

# Verify
if ! su - "$GSM_USER" -c "test -d $INSTALL_DIR/node_modules/next" 2>/dev/null; then
  warn "npm ci failed — falling back to npm install..."
  su - "$GSM_USER" -c "cd $INSTALL_DIR && npm install" > /tmp/gsm-update-npm.log 2>&1 || true
  if ! su - "$GSM_USER" -c "test -d $INSTALL_DIR/node_modules/next" 2>/dev/null; then
    err "npm install failed!"
    tail -20 /tmp/gsm-update-npm.log
    die "Cannot continue without dependencies."
  fi
fi
ok "Dependencies installed"

# ═══════════════════════════════════════════════════════════════════════════════
#  STEP 5: Apply database migrations
# ═══════════════════════════════════════════════════════════════════════════════
step "Applying database migrations"

su - "$GSM_USER" -c "cd $INSTALL_DIR && npx drizzle-kit push" > /tmp/gsm-update-drizzle.log 2>&1 || true
tail -3 /tmp/gsm-update-drizzle.log

if grep -qi "Changes applied\|No changes\|already up" /tmp/gsm-update-drizzle.log 2>/dev/null; then
  ok "Database schema up to date"
else
  warn "drizzle-kit push may have had issues — check /tmp/gsm-update-drizzle.log"
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  STEP 6: Build production bundle
# ═══════════════════════════════════════════════════════════════════════════════
step "Building production bundle"

su - "$GSM_USER" -c "cd $INSTALL_DIR && rm -rf .next && npx next build" > /tmp/gsm-update-build.log 2>&1 || true

# A failed build still leaves a partial .next directory behind, so check for
# BUILD_ID, which Next only writes once the build completes successfully.
if ! su - "$GSM_USER" -c "test -f $INSTALL_DIR/.next/BUILD_ID" 2>/dev/null; then
  err "Build failed!"
  tail -30 /tmp/gsm-update-build.log
  die "Cannot continue without a successful build. Rollback with:  bash update.sh --rollback"
fi
tail -8 /tmp/gsm-update-build.log
ok "Production build complete"

# Prune devDependencies
log "Pruning devDependencies..."
su - "$GSM_USER" -c "cd $INSTALL_DIR && npm prune --omit=dev" > /dev/null 2>&1 || true
ok "DevDependencies pruned"

# ═══════════════════════════════════════════════════════════════════════════════
#  STEP 7: Restart panel & verify
# ═══════════════════════════════════════════════════════════════════════════════
step "Restarting panel"

su - "$GSM_USER" -c "pm2 restart gsm-panel" 2>/dev/null \
  || su - "$GSM_USER" -c "cd $INSTALL_DIR && pm2 start ecosystem.config.cjs" 2>/dev/null \
  || su - "$GSM_USER" -c "cd $INSTALL_DIR && pm2 start npm --name gsm-panel -- start" 2>/dev/null \
  || true

su - "$GSM_USER" -c "pm2 save" 2>/dev/null || true

# Wait for the panel to come back up
log "Waiting for panel to start..."
sleep 3
PANEL_OK="false"
for _ in $(seq 1 30); do
  if curl -sf --max-time 3 "http://localhost:$PANEL_PORT/api/health" > /dev/null 2>&1 \
     || curl -sf --max-time 3 "http://127.0.0.1:$PANEL_PORT/api/health" > /dev/null 2>&1; then
    PANEL_OK="true"
    break
  fi
  sleep 1
done

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║${NC}  ${BOLD}🎉  Update Complete!${NC}                                       ${GREEN}║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${BOLD}Previous:${NC}  $CURRENT_COMMIT ($CURRENT_BRANCH)"
echo -e "  ${BOLD}Current:${NC}   $NEW_COMMIT ($BRANCH)"
echo ""

if [[ "$PANEL_OK" == "true" ]]; then
  ok "Panel is running and healthy"
else
  warn "Panel may still be starting — check:  gsm status"
  warn "View logs:  gsm logs"
fi

if [[ "$NO_BACKUP" != "true" && -n "${THIS_BACKUP:-}" ]]; then
  echo ""
  echo -e "  ${CYAN}Rollback if needed:${NC}"
  echo -e "    sudo bash $INSTALL_DIR/public/update.sh --rollback"
fi

echo ""
echo -e "  ${CYAN}Management:${NC}"
echo -e "    gsm status      # Check panel status"
echo -e "    gsm logs        # View live logs"
echo -e "    gsm restart     # Restart panel"
echo ""

# Update the version in .install-info
if [[ -f "$INSTALL_DIR/.install-info" ]]; then
  if grep -q "^PANEL_VERSION=" "$INSTALL_DIR/.install-info" 2>/dev/null; then
    sed -i "s/^PANEL_VERSION=.*/PANEL_VERSION=$NEW_COMMIT/" "$INSTALL_DIR/.install-info"
  else
    echo "PANEL_VERSION=$NEW_COMMIT" >> "$INSTALL_DIR/.install-info"
  fi
  if grep -q "^LAST_UPDATE=" "$INSTALL_DIR/.install-info" 2>/dev/null; then
    sed -i "s/^LAST_UPDATE=.*/LAST_UPDATE=$(date -u +"%Y-%m-%d %H:%M:%S UTC")/" "$INSTALL_DIR/.install-info"
  else
    echo "LAST_UPDATE=$(date -u +"%Y-%m-%d %H:%M:%S UTC")" >> "$INSTALL_DIR/.install-info"
  fi
fi
