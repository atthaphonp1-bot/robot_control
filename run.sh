#!/bin/bash
#
# run.sh — Run the Robot Control UI locally for development.
#
# Starts the xyz_simulator FastAPI app with uvicorn (auto-reload) so you can
# open http://localhost:8000/ in a browser. Installs requirements.txt on
# first run if needed.
#
# Usage:
#   ./run.sh            # start on port 8000
#   PORT=8080 ./run.sh  # start on a different port
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$SCRIPT_DIR/motor_control/xyz_simulator"
PORT="${PORT:-8000}"

if ! python3 -c "import uvicorn, fastapi" >/dev/null 2>&1; then
  echo "Installing requirements..."
  pip3 install -r "$SCRIPT_DIR/requirements.txt"
fi

cd "$APP_DIR"
echo "Starting Robot Control UI at http://localhost:$PORT/"
exec uvicorn app.main:app --reload --host 0.0.0.0 --port "$PORT"
