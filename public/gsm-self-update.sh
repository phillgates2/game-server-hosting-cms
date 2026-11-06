#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
#  GameServer Manager — panel self-update helper
# ═══════════════════════════════════════════════════════════════════════════════
#
#  This file is a TEMPLATE. The installer and the updater render it to
#  /usr/local/bin/gsm-self-update, replacing @INSTALL_DIR@ with the install
#  path, and add one sudo rule that lets the panel's own user run exactly that
#  command:
#
#    <panel user> ALL=(ALL) NOPASSWD: /usr/local/bin/gsm-self-update
#
#  Why a helper instead of a sudo rule for update.sh: sudo matches wildcards
#  across spaces, so "NOPASSWD: /bin/bash /opt/gsm-panel/public/update.sh *"
#  would let the panel run "update.sh --install-dir /etc --force", and a rule
#  with no arguments would not let the panel pass the --force it needs. This
#  script is the whitelist: the only argument it ever forwards is --no-backup,
#  so the panel cannot redirect the updater at another directory, branch or
#  repository.
#
#  Not meant to be run by hand — run update.sh directly for that.
#
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

UPDATER='@INSTALL_DIR@/public/update.sh'

EXTRA=()
if [[ $# -gt 1 ]]; then
  echo "gsm-self-update: too many arguments" >&2
  exit 2
fi

case "${1:-}" in
  "")
    ;;
  --no-backup)
    EXTRA+=(--no-backup)
    ;;
  *)
    echo "gsm-self-update: refusing unknown argument: ${1}" >&2
    exit 2
    ;;
esac

if [[ ! -f "$UPDATER" ]]; then
  echo "gsm-self-update: $UPDATER not found" >&2
  exit 1
fi

exec /bin/bash "$UPDATER" --force ${EXTRA[@]+"${EXTRA[@]}"}
