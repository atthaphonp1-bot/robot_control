#!/bin/bash
#
# run.command — Double-click launcher for macOS Finder.
#
# Opens this script in Terminal.app, runs run.sh (uvicorn --reload), and
# keeps the window open showing live logs/errors until you press Ctrl+C.
#
cd "$(dirname "${BASH_SOURCE[0]}")"
./run.sh
