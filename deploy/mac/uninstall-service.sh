#!/usr/bin/env bash
# Stop the quiz server service and remove it from launchd. Your project files are not touched.
set -euo pipefail

LABEL="com.kahoot.ckhoan"
PLIST="/Library/LaunchDaemons/${LABEL}.plist"

[[ "$EUID" -ne 0 ]] || { echo "Run this as your normal user, not with sudo." >&2; exit 1; }
[[ "$(uname)" == "Darwin" ]] || { echo "This script is for macOS." >&2; exit 1; }

sudo launchctl bootout "system/${LABEL}" 2>/dev/null || true
sudo rm -f "$PLIST"
echo "Service removed. (Start it manually any time with: npm start)"
