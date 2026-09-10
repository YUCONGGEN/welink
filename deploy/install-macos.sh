#!/bin/sh
set -eu
ROOT="$HOME/bin/welink"
mkdir -p "$ROOT/data" "$ROOT/logs" "$ROOT/downloads" "$HOME/Library/LaunchAgents"
chmod 700 "$ROOT" "$ROOT/data" "$ROOT/logs"
chmod 755 "$ROOT/welink-server"
PLIST="$HOME/Library/LaunchAgents/cn.welink.server.plist"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>cn.welink.server</string>
<key>ProgramArguments</key><array>
<string>$ROOT/welink-server</string><string>-listen</string><string>:8250</string>
<string>-download-listen</string><string>:8251</string>
<string>-data</string><string>$ROOT/data</string>
<string>-downloads</string><string>$ROOT/downloads</string></array>
<key>WorkingDirectory</key><string>$ROOT</string>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>5</integer>
<key>StandardOutPath</key><string>$ROOT/logs/stdout.log</string>
<key>StandardErrorPath</key><string>$ROOT/logs/stderr.log</string>
</dict></plist>
EOF
chmod 600 "$PLIST"
DOMAIN="gui/$(id -u)"
launchctl bootout "$DOMAIN/cn.welink.server" >/dev/null 2>&1 || true
ATTEMPT=0
until launchctl bootstrap "$DOMAIN" "$PLIST"; do
  ATTEMPT=$((ATTEMPT+1))
  [ "$ATTEMPT" -lt 5 ] || exit 1
  sleep 1
done
launchctl kickstart "$DOMAIN/cn.welink.server"
echo "WeLink installed in $ROOT"
