#!/usr/bin/env bash
# Install the quiz server as a macOS background service (launchd):
# it starts when the Mac boots (no login needed) and restarts by itself if it crashes.
#
#   bash deploy/mac/install-service.sh
#
# Run it again after you pull changes: it rebuilds the web app and restarts the service.
#
# Options (environment variables):
#   PORT=3000       port the server listens on
#   HOST=0.0.0.0    0.0.0.0 = also reachable from your home network; 127.0.0.1 = this Mac only
#   DRY_RUN=1       only print the service file that would be installed (no sudo, no changes)
set -euo pipefail

LABEL="com.kahoot.ckhoan"
PLIST="/Library/LaunchDaemons/${LABEL}.plist"
PORT="${PORT:-3000}"
HOST="${HOST:-0.0.0.0}"
DRY_RUN="${DRY_RUN:-0}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG_DIR="$ROOT/logs"

say() { printf '\n==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
xml() { sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

[[ "$EUID" -ne 0 ]] || die "Run this as your normal user, not with sudo. It asks for your password when it needs it."
[[ "$PORT" =~ ^[0-9]+$ ]] && (( PORT >= 1 && PORT <= 65535 )) || die "PORT must be a number between 1 and 65535 (got '$PORT')."
[[ "$HOST" =~ ^[0-9A-Za-z.:-]+$ ]] || die "HOST looks wrong (got '$HOST'). Use 0.0.0.0 or 127.0.0.1."
if [[ "$DRY_RUN" != 1 ]]; then
  [[ "$(uname)" == "Darwin" ]] || die "This script is for macOS (use DRY_RUN=1 to preview on another system)."
fi

NODE="$(command -v node || true)"
[[ -n "$NODE" ]] || die "Node.js was not found. Install it first (https://nodejs.org or 'brew install node')."
NODE_MAJOR="$("$NODE" -p 'process.versions.node.split(".")[0]')"
(( NODE_MAJOR >= 18 )) || die "Node.js 18 or newer is required (found $("$NODE" -v))."
RUN_USER="$(id -un)"

if [[ "$DRY_RUN" == 1 ]]; then
  say "DRY RUN: would run 'npm install' and 'npm run build' in $ROOT"
else
  say "Installing dependencies and building the web app"
  (cd "$ROOT" && npm install --no-audit --no-fund && npm run build)
  [[ -f "$ROOT/client/dist/index.html" ]] || die "client/dist/index.html is missing: the build failed."
  mkdir -p "$LOG_DIR"
fi
[[ -f "$ROOT/data/questions.json" ]] || die "data/questions.json is missing. Run 'npm run convert' first."

make_plist() {
  local node_dir
  node_dir="$(dirname "$NODE")"
  cat <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>UserName</key><string>$(printf '%s' "$RUN_USER" | xml)</string>
  <key>WorkingDirectory</key><string>$(printf '%s' "$ROOT" | xml)</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(printf '%s' "$NODE" | xml)</string>
    <string>server/index.js</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key><string>production</string>
    <key>PORT</key><string>${PORT}</string>
    <key>HOST</key><string>${HOST}</string>
    <key>PATH</key><string>$(printf '%s' "$node_dir" | xml):/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>$(printf '%s' "$LOG_DIR/server.log" | xml)</string>
  <key>StandardErrorPath</key><string>$(printf '%s' "$LOG_DIR/server.log" | xml)</string>
</dict>
</plist>
PLIST
}

if [[ "$DRY_RUN" == 1 ]]; then
  say "DRY RUN: this file would be installed as $PLIST"
  make_plist
  exit 0
fi

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
make_plist > "$TMP"
plutil -lint "$TMP" >/dev/null || die "The generated service file is invalid."

say "Installing the service (your Mac password is needed)"
sudo install -m 644 -o root -g wheel "$TMP" "$PLIST"
sudo launchctl bootout "system/${LABEL}" 2>/dev/null || true   # in case an older copy is loaded
sleep 1
for attempt in 1 2 3; do
  sudo launchctl bootstrap system "$PLIST" && break
  [[ $attempt -lt 3 ]] || die "launchctl could not load the service."
  sleep 2
done
sudo launchctl enable "system/${LABEL}"
sudo launchctl kickstart -k "system/${LABEL}"

say "Waiting for the server to answer"
ok=0
for _ in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:${PORT}/api/info" >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done
if [[ $ok -ne 1 ]]; then
  echo "The server did not answer on port ${PORT}. Last lines of $LOG_DIR/server.log:" >&2
  tail -n 20 "$LOG_DIR/server.log" 2>/dev/null >&2 || true
  exit 1
fi
echo "Server is up: $(curl -fsS "http://127.0.0.1:${PORT}/api/info")"

LOCAL_NAME="$(scutil --get LocalHostName 2>/dev/null || true)"
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
echo
echo "Open it on this Mac:      http://localhost:${PORT}"
if [[ "$HOST" != "127.0.0.1" ]]; then
  [[ -z "$LOCAL_NAME" ]] || echo "On your home network:     http://${LOCAL_NAME}.local:${PORT}"
  [[ -z "$LAN_IP" ]]     || echo "                      or  http://${LAN_IP}:${PORT}"
fi
echo "Logs:                     tail -f $LOG_DIR/server.log"
echo "It starts at every boot. To remove it: bash deploy/mac/uninstall-service.sh"
