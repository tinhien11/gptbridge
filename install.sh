#!/usr/bin/env bash
set -euo pipefail

# gptbridge installer: MCP server + systemd user services (+ optional tunnel)

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="$HOME/.local/bin"
SVC_DIR="$HOME/.config/systemd/user"
NODE_BIN="$(command -v node || { echo "ERROR: node not found"; exit 1; })"

mkdir -p "$BIN_DIR" "$SVC_DIR" "$SVC_DIR/default.target.wants" "$HOME/.gptbridge"

# --- server launcher (absolute node path: systemd has no nvm PATH) ---
cat > "$BIN_DIR/gptbridge" <<L
#!/usr/bin/env bash
exec "$NODE_BIN" "$DIR/server.mjs"
L
chmod 755 "$BIN_DIR/gptbridge"

# --- server service ---
cat > "$SVC_DIR/gptbridge.service" <<SVC
[Unit]
Description=gptbridge MCP server (native tools for ChatGPT)
After=network-online.target

[Service]
ExecStart=$BIN_DIR/gptbridge
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
SVC

# --- token (persist once, stable across restarts) ---
if [ ! -s "$HOME/.gptbridge/token" ]; then
  openssl rand -hex 16 2>/dev/null || node -e "console.log(require('crypto').randomBytes(16).toString('hex'))" > "$HOME/.gptbridge/token.tmp" && mv "$HOME/.gptbridge/token.tmp" "$HOME/.gptbridge/token" 2>/dev/null || true
  [ -s "$HOME/.gptbridge/token" ] || echo "generate-a-token-and-place-it-here" > "$HOME/.gptbridge/token"
  chmod 600 "$HOME/.gptbridge/token"
fi

systemctl --user daemon-reload
systemctl --user enable --now gptbridge.service
sleep 2
systemctl --user is-active gptbridge.service

echo
echo "gptbridge installed."
echo "  local endpoint : http://127.0.0.1:8790/mcp"
echo "  token          : $HOME/.gptbridge/token"
echo
echo "Next: expose it publicly and add it in ChatGPT -> Connectors:"
echo "  cloudflared tunnel --url http://127.0.0.1:8790   (quick, URL changes per start)"
echo "  connector URL = <public-url>/mcp/\$(cat ~/.gptbridge/token)  - auth: No authentication"

# --- optional public tunnel service (needs cloudflared) ---
if command -v cloudflared >/dev/null 2>&1; then
  CF_BIN="$(command -v cloudflared)"
  cat > "$SVC_DIR/gptbridge-tunnel.service" <<SVC
[Unit]
Description=gptbridge public tunnel (cloudflared -> MCP :8790)
After=gptbridge.service network-online.target

[Service]
ExecStart=$CF_BIN tunnel --url http://127.0.0.1:8790 --logfile %h/.gptbridge/cloudflared.log
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
SVC
  systemctl --user daemon-reload
  systemctl --user enable --now gptbridge-tunnel.service
  sleep 6
  URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$HOME/.gptbridge/cloudflared.log" | tail -1)"
  echo
  echo "  tunnel service  : active"
  echo "  public MCP URL  : ${URL:-starting... check: gptbridge-tunnel log}"
  echo "  connector URL   : ${URL}/mcp/\$(cat ~/.gptbridge/token)"
else
  echo
  echo "  (cloudflared not found - install it to expose the endpoint publicly)"
fi
