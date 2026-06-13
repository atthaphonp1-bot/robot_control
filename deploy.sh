#!/bin/bash
#
# deploy.sh — Safely update ONLY the xyz_simulator folder on a CSOS unit.
#
# It never touches sibling code under motor_control/. It backs up the current
# xyz_simulator, swaps in this repo's copy, preserves the unit's own
# app/env.json, and restarts the service.
#
# Usage (run from a fresh clone of this repo, on the unit):
#   git clone -b <branch> https://github.com/atthaphonp1-bot/robot_control.git /tmp/rc_new
#   sudo bash /tmp/rc_new/deploy.sh
#
# Override defaults if your layout differs:
#   TARGET_DIR=/custom/path/motor_control/xyz_simulator SERVICE=my_service bash deploy.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$SCRIPT_DIR/motor_control/xyz_simulator"
SERVICE="${SERVICE:-motor_movement_web}"

# --- Resolve the target xyz_simulator path -------------------------------------
# Honour an explicit TARGET_DIR; otherwise auto-detect EMS 5 then EMS 4.
EMS5_DIR="/root/one_software/ems/robot_control/motor_control/xyz_simulator"
EMS4_DIR="/root/xsos/robot_control/motor_control/xyz_simulator"
if [[ -n "${TARGET_DIR:-}" ]]; then
  : # use as provided
elif [[ -d "$(dirname "$EMS5_DIR")" ]]; then
  TARGET_DIR="$EMS5_DIR"
elif [[ -d "$(dirname "$EMS4_DIR")" ]]; then
  TARGET_DIR="$EMS4_DIR"
else
  echo "ERROR: could not auto-detect the unit's motor_control directory." >&2
  echo "       Set TARGET_DIR=/.../motor_control/xyz_simulator and re-run." >&2
  exit 1
fi
PARENT_DIR="$(dirname "$TARGET_DIR")"   # the motor_control/ we must NOT disturb

# --- Sanity checks -------------------------------------------------------------
[[ -d "$SOURCE_DIR" ]]  || { echo "ERROR: source not found: $SOURCE_DIR" >&2; exit 1; }
[[ -f "$SOURCE_DIR/app/main.py" ]] || { echo "ERROR: source looks wrong (no app/main.py)" >&2; exit 1; }
[[ -d "$PARENT_DIR" ]]  || { echo "ERROR: target parent missing: $PARENT_DIR" >&2; exit 1; }

STAMP="$(date +%Y%m%d_%H%M%S)"
echo "==> Source : $SOURCE_DIR"
echo "==> Target : $TARGET_DIR"
echo "==> Service: $SERVICE"
echo "==> Only '$TARGET_DIR' will change; the rest of '$PARENT_DIR' is left untouched."
echo

# --- Stop the service (best-effort) --------------------------------------------
if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files 2>/dev/null | grep -q "^${SERVICE}\.service"; then
  echo "==> Stopping $SERVICE ..."
  systemctl stop "$SERVICE" || true
else
  echo "==> NOTE: service '$SERVICE' not found; skipping stop/start (start it manually after)."
  SERVICE=""
fi

# --- Preserve the unit's env.json ----------------------------------------------
SAVED_ENV=""
if [[ -f "$TARGET_DIR/app/env.json" ]]; then
  SAVED_ENV="$(mktemp)"
  cp -a "$TARGET_DIR/app/env.json" "$SAVED_ENV"
  echo "==> Saved current env.json"
fi

# --- Back up and swap ----------------------------------------------------------
if [[ -e "$TARGET_DIR" ]]; then
  BACKUP="${TARGET_DIR}.bak.${STAMP}"
  echo "==> Backing up existing -> $BACKUP"
  mv "$TARGET_DIR" "$BACKUP"
fi
echo "==> Installing new xyz_simulator ..."
cp -a "$SOURCE_DIR" "$TARGET_DIR"

# --- Restore the unit's env.json (keep repo's copy as env.json.repo) -----------
if [[ -n "$SAVED_ENV" ]]; then
  if [[ -f "$TARGET_DIR/app/env.json" ]]; then
    cp -a "$TARGET_DIR/app/env.json" "$TARGET_DIR/app/env.json.repo"
  fi
  cp -a "$SAVED_ENV" "$TARGET_DIR/app/env.json"
  rm -f "$SAVED_ENV"
  echo "==> Restored unit env.json (repo default kept as app/env.json.repo)"
else
  echo "==> NOTE: no previous env.json found; review $TARGET_DIR/app/env.json before use."
fi

# --- Restart the service -------------------------------------------------------
if [[ -n "$SERVICE" ]]; then
  echo "==> Starting $SERVICE ..."
  systemctl start "$SERVICE"
  sleep 1
  systemctl --no-pager --lines=0 status "$SERVICE" || true
fi

echo
echo "Done. Deployed to: $TARGET_DIR"
echo "Rollback if needed:"
echo "  ${SERVICE:+systemctl stop $SERVICE; }rm -rf '$TARGET_DIR' && mv '${TARGET_DIR}.bak.${STAMP}' '$TARGET_DIR'${SERVICE:+ && systemctl start $SERVICE}"
