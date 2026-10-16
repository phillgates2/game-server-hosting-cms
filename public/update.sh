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
#    --install-dir    Panel directory (default: /opt/gsm-panel)
#    --help, -h       Show this help
#
#  Environment:
#    GSM_BACKUP_DIR   Where pre-update backups are stored
#                     (default: /opt/gsm-panel-backups)
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
umask 077

# Fail fast if git ever needs credentials, instead of hanging the whole update
# at a "Username for 'https://github.com':" prompt.
export GIT_TERMINAL_PROMPT=0

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

# ask_yes_no "prompt" <default: y|n>
# Asks on a TTY; when stdin is not a terminal (e.g. the one-liner run over
# ssh or piped) it falls back to the default answer, so a `read` hitting EOF
# can never kill the script silently under set -e.
ask_yes_no() {
  local prompt="$1" def="$2" ans=""
  if [[ -t 0 ]]; then
    read -rp "$prompt" ans || ans=""
  else
    warn "No interactive terminal — using the default answer."
  fi
  ans="${ans:-$def}"
  [[ "$ans" =~ ^[yY] ]]
}

# Read only the validated port needed for the local health probe. .install-info
# is plain data; it must never be sourced by this root updater.
read_panel_port() {
  local info_key="" info_value="" info_port
  PANEL_PORT="3000"
  [[ -f "$INSTALL_DIR/.install-info" ]] || return 0
  while IFS='=' read -r info_key info_value || [[ -n "$info_key" ]]; do
    info_key="${info_key%$'\r'}"
    info_value="${info_value%$'\r'}"
    if [[ "$info_key" == "PANEL_PORT" && "$info_value" =~ ^[0-9]{1,5}$ ]]; then
      info_port=$((10#$info_value))
      if (( info_port >= 1 && info_port <= 65535 )); then
        PANEL_PORT="$info_port"
      fi
    fi
  done < "$INSTALL_DIR/.install-info"
}

# ── Defaults ──────────────────────────────────────────────────────────────────
INSTALL_DIR="/opt/gsm-panel"
GSM_USER="gsm"
BRANCH="main"
FORCE="false"
NO_BACKUP="false"
ROLLBACK="false"
BACKUP_DIR="${GSM_BACKUP_DIR:-/opt/gsm-panel-backups}"
ORIGINAL_ARGS=("$@")
INSTALL_DIR_EXPLICIT="false"

# ── Parse arguments ───────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --force)      FORCE="true"; shift ;;
    --no-backup)  NO_BACKUP="true"; shift ;;
    --branch)
      [[ -n "${2:-}" ]] || die "--branch requires a branch name"
      BRANCH="$2"
      shift 2
      ;;
    --rollback)   ROLLBACK="true"; shift ;;
    --install-dir)
      [[ -n "${2:-}" ]] || die "--install-dir requires a path"
      INSTALL_DIR="$2"
      INSTALL_DIR_EXPLICIT="true"
      shift 2
      ;;
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
      echo "  --install-dir DIR Panel directory (default: /opt/gsm-panel)"
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

if ! (cd / && git check-ref-format --branch "$BRANCH" >/dev/null 2>&1); then
  die "Invalid branch name: $BRANCH"
fi

# A directly invoked updater can infer its install from <install>/public. This
# keeps installs made with --install-dir working without relying on .install-info
# being executable shell code.
if [[ "$INSTALL_DIR_EXPLICIT" != "true" ]]; then
  SCRIPT_SOURCE="${BASH_SOURCE[0]:-$0}"
  if [[ "$SCRIPT_SOURCE" != /dev/fd/* && "$SCRIPT_SOURCE" != /proc/self/fd/* && -f "$SCRIPT_SOURCE" ]]; then
    SCRIPT_DIR=$(cd -- "$(dirname -- "$SCRIPT_SOURCE")" && pwd -P 2>/dev/null || true)
    if [[ "$(basename -- "$SCRIPT_DIR" 2>/dev/null || true)" == "public" && -e "$SCRIPT_DIR/../.git" ]]; then
      INSTALL_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd -P)
    fi
  fi
fi

if [[ -d "$INSTALL_DIR" ]]; then
  INSTALL_DIR=$(cd -- "$INSTALL_DIR" && pwd -P)
fi

# ── Root / sudo check ─────────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  if ! command -v sudo &>/dev/null; then
    die "This updater needs root access. Run with:  sudo bash update.sh"
  fi

  warn "Not running as root — re-launching with sudo..."
  SCRIPT_SOURCE="${BASH_SOURCE[0]:-$0}"
  REEXEC_SCRIPT="$SCRIPT_SOURCE"
  REEXEC_DIR=""

  # The public one-liner runs the script through /dev/fd. Bash has already
  # consumed that pipe by the time the script starts, so fetch the matching
  # branch's updater into a private file before handing execution to sudo.
  if [[ "$SCRIPT_SOURCE" == /dev/fd/* || "$SCRIPT_SOURCE" == /proc/self/fd/* || ! -f "$SCRIPT_SOURCE" ]]; then
    REEXEC_DIR=$(mktemp -d /tmp/gsm-update-reexec.XXXXXX) \
      || die "Could not create a temporary directory for sudo re-exec"
    chmod 700 "$REEXEC_DIR"
    UPDATE_SCRIPT_URL="https://raw.githubusercontent.com/phillgates2/game-server-hosting-cms/$BRANCH/public/update.sh"
    if ! curl -fsSL --retry 3 --max-time 30 "$UPDATE_SCRIPT_URL" -o "$REEXEC_DIR/update.sh"; then
      rm -rf -- "$REEXEC_DIR"
      die "Could not download the updater for sudo re-exec. Save public/update.sh locally and run it with sudo."
    fi
    chmod 600 "$REEXEC_DIR/update.sh"
    REEXEC_SCRIPT="$REEXEC_DIR/update.sh"
    trap 'rm -rf -- "$REEXEC_DIR"' EXIT
  else
    REEXEC_SCRIPT=$(readlink -f -- "$SCRIPT_SOURCE" 2>/dev/null || printf '%s' "$SCRIPT_SOURCE")
  fi

  # The original arguments were consumed by the parser above. Forward them
  # verbatim (including --branch/--rollback), and append the resolved path so
  # the elevated invocation targets the same custom install directory. Keep the
  # documented backup-directory override too; sudo normally filters it out.
  SUDO_ENV=()
  if [[ -n "${GSM_BACKUP_DIR+x}" ]]; then
    SUDO_ENV=(env "GSM_BACKUP_DIR=$GSM_BACKUP_DIR")
  fi
  if sudo "${SUDO_ENV[@]}" bash "$REEXEC_SCRIPT" "${ORIGINAL_ARGS[@]}" --install-dir "$INSTALL_DIR"; then
    exit 0
  else
    REEXEC_STATUS=$?
    exit "$REEXEC_STATUS"
  fi
fi

read_panel_port

if [[ ! -e "$INSTALL_DIR/.git" ]]; then
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

# Private scratch space for config snapshots; a predictable /tmp filename can
# be planted as a symlink by another local user before a root updater writes it.
WORK_DIR=$(mktemp -d /tmp/gsm-update.XXXXXX) || die "Could not create updater scratch space"
chmod 700 "$WORK_DIR"
trap 'rm -rf -- "$WORK_DIR"' EXIT

LOG_DIR="/var/log/gsm-update"
install -d -o root -g root -m 700 "$LOG_DIR" \
  || die "Could not create the root-only update log directory $LOG_DIR"
LOG_PREFIX="$LOG_DIR/gsm-update-$(date +%Y%m%d-%H%M%S)-$$"
NPM_LOG="$LOG_PREFIX-npm.log"
DRIZZLE_LOG="$LOG_PREFIX-drizzle.log"
BUILD_LOG="$LOG_PREFIX-build.log"
ROLLBACK_BUILD_LOG="$LOG_PREFIX-rollback-build.log"
CONFIG_FILES=(.env drizzle.config.json ecosystem.config.cjs .install-info)

# Shell-quoted form of the install dir, for use inside `su -c "..."` strings
# (a custom --install-dir with spaces would otherwise break those commands).
INSTALL_DIR_Q=$(printf '%q' "$INSTALL_DIR")

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

# If .git is completely broken, re-initialize. Keep config in the private
# scratch directory and fail if the repair cannot fetch/check out the target.
if ! git rev-parse HEAD > /dev/null 2>&1; then
  warn "Git repository appears broken — re-initializing..."
  REPAIR_CONFIG_DIR="$WORK_DIR/git-repair"
  mkdir -p "$REPAIR_CONFIG_DIR"
  for config_file in "${CONFIG_FILES[@]}"; do
    if [[ -f "$INSTALL_DIR/$config_file" ]]; then
      cp -p -- "$INSTALL_DIR/$config_file" "$REPAIR_CONFIG_DIR/$config_file" \
        || die "Could not snapshot $INSTALL_DIR/$config_file before Git repair"
      : > "$REPAIR_CONFIG_DIR/present-$config_file"
    else
      : > "$REPAIR_CONFIG_DIR/absent-$config_file"
    fi
  done

  rm -rf -- "$INSTALL_DIR/.git"
  git init --quiet || die "Could not re-initialize Git in $INSTALL_DIR"
  git remote add origin "$REPO_URL" || die "Could not configure the Git remote"
  REPAIR_REMOTE_REF="refs/remotes/origin/$BRANCH"
  REPAIR_FETCH_REFSPEC="+refs/heads/$BRANCH:$REPAIR_REMOTE_REF"
  if ! git fetch --no-tags origin "$REPAIR_FETCH_REFSPEC"; then
    die "Could not fetch origin/$BRANCH while repairing Git; retry when the remote is available. The panel code was not switched."
  fi
  if ! git checkout --force -B "$BRANCH" "$REPAIR_REMOTE_REF"; then
    for config_file in "${CONFIG_FILES[@]}"; do
      if [[ -f "$REPAIR_CONFIG_DIR/present-$config_file" ]]; then
        cp -p -- "$REPAIR_CONFIG_DIR/$config_file" "$INSTALL_DIR/$config_file" 2>/dev/null || true
      elif [[ -f "$REPAIR_CONFIG_DIR/absent-$config_file" ]]; then
        rm -f -- "$INSTALL_DIR/$config_file"
      fi
    done
    die "Could not check out origin/$BRANCH while repairing Git; config restore was attempted."
  fi

  for config_file in "${CONFIG_FILES[@]}"; do
    if [[ -f "$REPAIR_CONFIG_DIR/present-$config_file" ]]; then
      cp -p -- "$REPAIR_CONFIG_DIR/$config_file" "$INSTALL_DIR/$config_file" \
        || die "Could not restore $INSTALL_DIR/$config_file after Git repair"
    elif [[ -f "$REPAIR_CONFIG_DIR/absent-$config_file" ]]; then
      rm -f -- "$INSTALL_DIR/$config_file"
    fi
  done
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

  if [[ ! -f "$LATEST_BACKUP/git-commit.txt" ]]; then
    die "Backup $LATEST_BACKUP has no saved commit; refusing an incomplete rollback"
  fi
  RESTORE_COMMIT=$(cat "$LATEST_BACKUP/git-commit.txt")
  if ! git cat-file -e "$RESTORE_COMMIT^{commit}" 2>/dev/null; then
    die "Saved commit $RESTORE_COMMIT is not available in the local Git repository"
  fi

  echo -e "  ${BOLD}Backup to restore:${NC} $LATEST_BACKUP"
  echo -e "  ${BOLD}Commit:${NC} $RESTORE_COMMIT"
  echo ""

  if [[ "$FORCE" != "true" ]]; then
    if ! ask_yes_no "  Restore this backup? [y/N]: " n; then
      log "Cancelled."
      exit 0
    fi
  fi

  log "Stopping panel..."
  su - "$GSM_USER" -c "pm2 stop gsm-panel" 2>/dev/null || true

  log "Restoring Git state..."
  RESTORE_BRANCH=""
  if [[ -f "$LATEST_BACKUP/git-branch.txt" ]]; then
    RESTORE_BRANCH=$(cat "$LATEST_BACKUP/git-branch.txt")
  fi
  if [[ -n "$RESTORE_BRANCH" && "$RESTORE_BRANCH" != "unknown" && "$RESTORE_BRANCH" != "HEAD" ]] \
     && (cd / && git check-ref-format --branch "$RESTORE_BRANCH" >/dev/null 2>&1); then
    git checkout --force -B "$RESTORE_BRANCH" "$RESTORE_COMMIT" \
      || die "Could not restore branch $RESTORE_BRANCH at $RESTORE_COMMIT"
  else
    git checkout --force "$RESTORE_COMMIT" \
      || die "Could not check out saved commit $RESTORE_COMMIT"
  fi

  log "Restoring installation config..."
  for config_file in "${CONFIG_FILES[@]}"; do
    if [[ -f "$LATEST_BACKUP/$config_file" ]]; then
      cp -p -- "$LATEST_BACKUP/$config_file" "$INSTALL_DIR/$config_file" \
        || die "Could not restore $INSTALL_DIR/$config_file"
    fi
  done

  chown -R "$GSM_USER:$GSM_USER" "$INSTALL_DIR" \
    || die "Could not restore ownership to $GSM_USER"
  if [[ -f "$INSTALL_DIR/.env" ]]; then
    chmod 600 "$INSTALL_DIR/.env"
  fi
  if [[ -f "$INSTALL_DIR/.install-info" ]]; then
    chown root:root "$INSTALL_DIR/.install-info"
    chmod 600 "$INSTALL_DIR/.install-info"
  fi
  read_panel_port

  # Rebuild
  log "Reinstalling dependencies..."
  if ! su - "$GSM_USER" -c "cd $INSTALL_DIR_Q && npm ci" > "$NPM_LOG" 2>&1; then
    err "Dependency reinstall failed during rollback!"
    tail -30 "$NPM_LOG" 2>/dev/null || true
    die "Could not restore dependencies. The panel remains stopped."
  fi
  log "Rebuilding..."
  su - "$GSM_USER" -c "cd $INSTALL_DIR_Q && rm -rf .next && npx next build" > "$ROLLBACK_BUILD_LOG" 2>&1 || true
  if ! su - "$GSM_USER" -c "test -f $INSTALL_DIR_Q/.next/BUILD_ID" 2>/dev/null; then
    err "Rollback rebuild failed!"
    tail -30 "$ROLLBACK_BUILD_LOG" 2>/dev/null || true
    die "The restored code did not build. Full log: $ROLLBACK_BUILD_LOG"
  fi
  su - "$GSM_USER" -c "cd $INSTALL_DIR_Q && npm prune --omit=dev" > /dev/null 2>&1 \
    || warn "Could not prune devDependencies after rollback."

  log "Starting panel..."
  if su - "$GSM_USER" -c "pm2 restart gsm-panel" 2>/dev/null; then
    :
  elif su - "$GSM_USER" -c "cd $INSTALL_DIR_Q && pm2 start ecosystem.config.cjs" 2>/dev/null; then
    :
  elif su - "$GSM_USER" -c "cd $INSTALL_DIR_Q && pm2 start npm --name gsm-panel -- start" 2>/dev/null; then
    :
  else
    die "PM2 could not restart the rolled-back panel."
  fi
  su - "$GSM_USER" -c "pm2 save" 2>/dev/null \
    || warn "PM2 could not save its process list after rollback."

  log "Waiting for panel health..."
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

  if [[ "$PANEL_OK" != "true" ]]; then
    die "Rollback restored commit $RESTORE_COMMIT, but the panel did not become healthy. Check gsm status and gsm logs."
  fi
  ok "Rollback complete to $RESTORE_COMMIT; panel is healthy"
  echo ""
  exit 0
fi

# ── Check for updates ────────────────────────────────────────────────────────
log "Checking for updates..."
REMOTE_REF="refs/remotes/origin/$BRANCH"
FETCH_REFSPEC="+refs/heads/$BRANCH:$REMOTE_REF"
if ! git fetch --no-tags origin "$FETCH_REFSPEC" 2>/dev/null; then
  warn "Fetching origin/$BRANCH failed — checking the configured remote..."
  git remote set-url origin "$REPO_URL" 2>/dev/null || true
  if ! git fetch --no-tags origin "$FETCH_REFSPEC" 2>/dev/null; then
    die "Cannot fetch origin/$BRANCH. Check the branch and your internet connection, then try again."
  fi
fi

# If this installation is running an older updater, restart using the version
# stored on the fetched branch before touching the panel. This makes a single
# `gsm update` benefit from updater fixes in the same update, not the next one.
if [[ "${GSM_UPDATER_REFRESHED:-}" != "1" ]]; then
  REMOTE_UPDATER="$WORK_DIR/update.sh"
  if ! git show "$REMOTE_REF:public/update.sh" > "$REMOTE_UPDATER"; then
    die "origin/$BRANCH does not contain public/update.sh"
  fi
  RUNNING_UPDATER="${BASH_SOURCE[0]:-$0}"
  if [[ ! -f "$RUNNING_UPDATER" ]] || ! cmp -s -- "$RUNNING_UPDATER" "$REMOTE_UPDATER"; then
    chmod 600 "$REMOTE_UPDATER"
    log "Updater differs from origin/$BRANCH — restarting with the fetched updater..."
    if GSM_UPDATER_REFRESHED=1 bash "$REMOTE_UPDATER" "${ORIGINAL_ARGS[@]}" --install-dir "$INSTALL_DIR"; then
      exit 0
    else
      REFRESH_STATUS=$?
      exit "$REFRESH_STATUS"
    fi
  fi
fi

LOCAL_HEAD=$(git rev-parse HEAD 2>/dev/null || echo "")
REMOTE_HEAD=$(git rev-parse "$REMOTE_REF" 2>/dev/null || echo "")
[[ -n "$REMOTE_HEAD" ]] || die "Fetched branch origin/$BRANCH has no commit to update to."

if [[ "$LOCAL_HEAD" == "$REMOTE_HEAD" && "$CURRENT_BRANCH" == "$BRANCH" ]]; then
  ok "Already up to date (commit $CURRENT_COMMIT)"
  echo ""

  if [[ "$FORCE" != "true" ]]; then
    if ! ask_yes_no "  Force rebuild anyway? [y/N]: " n; then
      log "Nothing to do."
      exit 0
    fi
  else
    log "Already up to date but --force was set, continuing..."
  fi
fi

# Show what's new
NEW_COMMITS=$(git log --oneline HEAD.."$REMOTE_REF" 2>/dev/null || true)
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

# Do not silently merge local source edits into a production update or reset a
# local-only commit. Install-specific files are snapshotted/restored below;
# anything else must be committed or backed up explicitly by the operator.
LOCAL_BRANCH_REF="refs/heads/$BRANCH"
if git show-ref --verify --quiet "$LOCAL_BRANCH_REF" \
   && ! git merge-base --is-ancestor "$LOCAL_BRANCH_REF" "$REMOTE_REF"; then
  die "Local branch '$BRANCH' has commits that are not on origin/$BRANCH. Back them up or move them to another branch before updating."
fi
if ! git status --porcelain --untracked-files=no -- \
    . ':(exclude)drizzle.config.json' ':(exclude)ecosystem.config.cjs' \
    > "$WORK_DIR/local-status.txt"; then
  die "Could not inspect local changes in $INSTALL_DIR"
fi
LOCAL_CHANGES=$(cat "$WORK_DIR/local-status.txt")
if [[ -n "$LOCAL_CHANGES" ]]; then
  err "Local tracked code changes would be overwritten:"
  printf '%s\n' "$LOCAL_CHANGES"
  die "Commit or back up those changes, then run the updater again."
fi

# ── Confirmation ──────────────────────────────────────────────────────────────
if [[ "$FORCE" != "true" ]]; then
  if ! ask_yes_no "  Proceed with update? [Y/n]: " y; then
    log "Update cancelled."
    exit 0
  fi
fi

# Preserve per-install files in private scratch space before switching code.
# Track absent files too so a release cannot unexpectedly create them.
for config_file in "${CONFIG_FILES[@]}"; do
  if [[ -f "$INSTALL_DIR/$config_file" ]]; then
    cp -p -- "$INSTALL_DIR/$config_file" "$WORK_DIR/$config_file" \
      || die "Could not snapshot $INSTALL_DIR/$config_file"
    : > "$WORK_DIR/present-$config_file"
  else
    : > "$WORK_DIR/absent-$config_file"
  fi
done

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
  mkdir -p "$BACKUP_DIR"
  chmod 700 "$BACKUP_DIR"
  THIS_BACKUP=$(mktemp -d "$BACKUP_DIR/gsm-backup-$TIMESTAMP-XXXXXX") \
    || die "Could not create a backup directory in $BACKUP_DIR"

  # Save config files. A failed copy of a present file must stop the update:
  # the backup is the only reliable rollback for the previous install.
  for config_file in "${CONFIG_FILES[@]}"; do
    if [[ -f "$INSTALL_DIR/$config_file" ]]; then
      cp -p -- "$INSTALL_DIR/$config_file" "$THIS_BACKUP/$config_file" \
        || die "Could not back up $INSTALL_DIR/$config_file"
    fi
  done

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

  # Backups hold .env, the database dump and the license key — they must
  # stay unreadable to the unprivileged panel user. Root-only, mode 700.
  chown -R root:root "$BACKUP_DIR" 2>/dev/null || true
  chmod 700 "$BACKUP_DIR" 2>/dev/null || true
  ok "Backup saved to $THIS_BACKUP"

  # Prune old backups (keep last 5)
  # (`wc -l` always prints a number, even for an empty directory — the old
  # `|| echo 0` appended a second line and broke the numeric comparison.)
  BACKUP_COUNT=$(ls -1d "$BACKUP_DIR"/gsm-backup-* 2>/dev/null | wc -l || true)
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

# Switch to the exact fetched commit. `git pull` can create an unintended merge
# (or use the wrong upstream); a refspec + explicit checkout is deterministic.
if [[ "$CURRENT_BRANCH" != "$BRANCH" && "$CURRENT_BRANCH" != "unknown" ]]; then
  log "Switching from $CURRENT_BRANCH to $BRANCH..."
fi
git checkout --force -B "$BRANCH" "$REMOTE_REF" \
  || die "Could not switch to origin/$BRANCH; the current commit and config backup are unchanged."

# Restore the saved per-install files after the checkout.
for config_file in "${CONFIG_FILES[@]}"; do
  if [[ -f "$WORK_DIR/present-$config_file" ]]; then
    cp -p -- "$WORK_DIR/$config_file" "$INSTALL_DIR/$config_file" \
      || die "Could not restore $INSTALL_DIR/$config_file"
  elif [[ -f "$WORK_DIR/absent-$config_file" ]]; then
    rm -f -- "$INSTALL_DIR/$config_file"
  fi
done

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
if ! su - "$GSM_USER" -c "cd $INSTALL_DIR_Q && npm ci" > "$NPM_LOG" 2>&1 \
   || ! su - "$GSM_USER" -c "test -d $INSTALL_DIR_Q/node_modules/next" 2>/dev/null; then
  warn "npm ci failed or left Next.js unavailable — falling back to npm install..."
  if ! su - "$GSM_USER" -c "cd $INSTALL_DIR_Q && npm install" > "$NPM_LOG" 2>&1 \
     || ! su - "$GSM_USER" -c "test -d $INSTALL_DIR_Q/node_modules/next" 2>/dev/null; then
    err "npm install failed!"
    tail -20 "$NPM_LOG"
    die "Cannot continue without dependencies."
  fi
fi
ok "Dependencies installed"

# ═══════════════════════════════════════════════════════════════════════════════
#  STEP 5: Apply database migrations
# ═══════════════════════════════════════════════════════════════════════════════
step "Applying database migrations"

if su - "$GSM_USER" -c "cd $INSTALL_DIR_Q && npx drizzle-kit push" \
    > "$DRIZZLE_LOG" 2>&1 </dev/null; then
  tail -3 "$DRIZZLE_LOG" 2>/dev/null || true
  ok "Database schema up to date"
else
  err "Database migration failed!"
  tail -30 "$DRIZZLE_LOG" 2>/dev/null || true
  die "Cannot continue with an unapplied database schema. The panel is stopped; inspect the migration log and run the updater again."
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  STEP 6: Build production bundle
# ═══════════════════════════════════════════════════════════════════════════════
step "Building production bundle"

su - "$GSM_USER" -c "cd $INSTALL_DIR_Q && rm -rf .next && npx next build" > "$BUILD_LOG" 2>&1 || true

# A failed build still leaves a partial .next directory behind, so check for
# BUILD_ID, which Next only writes once the build completes successfully.
if ! su - "$GSM_USER" -c "test -f $INSTALL_DIR_Q/.next/BUILD_ID" 2>/dev/null; then
  err "Build failed!"
  tail -30 "$BUILD_LOG" 2>/dev/null || true
  die "Cannot continue without a successful build. Rollback with:  bash update.sh --rollback"
fi
tail -8 "$BUILD_LOG"
ok "Production build complete"

# Prune devDependencies
log "Pruning devDependencies..."
su - "$GSM_USER" -c "cd $INSTALL_DIR_Q && npm prune --omit=dev" > /dev/null 2>&1 || true
ok "DevDependencies pruned"

# ═══════════════════════════════════════════════════════════════════════════════
#  STEP 7: Restart panel & verify
# ═══════════════════════════════════════════════════════════════════════════════
step "Restarting panel"

if su - "$GSM_USER" -c "pm2 restart gsm-panel" 2>/dev/null; then
  :
elif su - "$GSM_USER" -c "cd $INSTALL_DIR_Q && pm2 start ecosystem.config.cjs" 2>/dev/null; then
  :
elif su - "$GSM_USER" -c "cd $INSTALL_DIR_Q && pm2 start npm --name gsm-panel -- start" 2>/dev/null; then
  :
else
  die "PM2 could not restart or start gsm-panel. Roll back with: sudo bash $INSTALL_DIR/public/update.sh --rollback"
fi

su - "$GSM_USER" -c "pm2 save" 2>/dev/null \
  || warn "PM2 could not save its process list; the panel may not restart on boot."

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
if [[ "$PANEL_OK" == "true" ]]; then
  echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}║${NC}  ${BOLD}🎉  Update Complete!${NC}                                       ${GREEN}║${NC}"
  echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
else
  echo -e "${RED}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${RED}║${NC}  ${BOLD}⚠️  Update Needs Attention${NC}                                 ${RED}║${NC}"
  echo -e "${RED}╚══════════════════════════════════════════════════════════════╝${NC}"
fi
echo ""
echo -e "  ${BOLD}Previous:${NC}  $CURRENT_COMMIT ($CURRENT_BRANCH)"
echo -e "  ${BOLD}Current:${NC}   $NEW_COMMIT ($BRANCH)"
echo ""

if [[ "$PANEL_OK" == "true" ]]; then
  ok "Panel is running and healthy"
else
  err "Panel did not pass the health check after the update."
  warn "Check: gsm status; logs: gsm logs"
  if [[ "$NO_BACKUP" != "true" && -n "${THIS_BACKUP:-}" ]]; then
    warn "Rollback is available: sudo bash $INSTALL_DIR/public/update.sh --rollback"
  fi
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

if [[ "$PANEL_OK" != "true" ]]; then
  die "The update was installed but the panel did not become healthy. Resolve the cause, then retry or roll back."
fi
