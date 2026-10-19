#!/usr/bin/env bash
set -euo pipefail

# gptbridge installer: MCP server + systemd user services + tunnel wizard.
#
# Interactive mode asks [Y/n] (Enter = Y) before every step that writes to
# your machine. Non-interactive (flags or no TTY) auto-accepts.
#
# Tunnel choices:
#   openai      OpenAI Secure MCP Tunnel (default) - private, no public URL,
#               no inbound ports. Needs 2 values only you can create:
#               a tunnel_id (platform.openai.com) + a runtime API key.
#   cloudflared cloudflared quick tunnel - public URL, changes per start.
#   none        skip; wire a tunnel yourself.
#
# Non-interactive:
#   bash install.sh --tunnel=openai --tunnel-id=tunnel_xxx --api-key=sk-xxx
#   bash install.sh --tunnel=cloudflared
#   bash install.sh --tunnel=none
# Override the tunnel-client version (default: latest GitHub release):
#   GPTBRIDGE_TC_VERSION=v0.0.16 bash install.sh ...

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || true)"
BIN_DIR="$HOME/.local/bin"
SVC_DIR="$HOME/.config/systemd/user"
GB_DIR="$HOME/.gptbridge"
APP_DIR="$HOME/.local/share/gptbridge"
NODE_BIN="$(command -v node || { echo "ERROR: node not found"; exit 1; })"

# where to fetch server.mjs / install.sh for remote (curl | bash) installs;
# pin a version with GPTBRIDGE_REF=v1.2.3
REPO_RAW="${GPTBRIDGE_REPO_RAW:-https://raw.githubusercontent.com/tinhien11/gptbridge/${GPTBRIDGE_REF:-master}}"

if command -v curl >/dev/null 2>&1; then
  fetch() { curl -fsSL -o "$1" "$2"; }
elif command -v wget >/dev/null 2>&1; then
  fetch() { wget -qO "$1" "$2"; }
else
  echo "ERROR: need curl or wget"; exit 1
fi

# curl | bash support: with the script on stdin, interactive prompts would
# eat the remaining script text. Materialize the canonical script and re-exec
# it with the terminal as stdin. CI (no tty anywhere) skips this and runs
# non-interactive.
if [ -z "${GPTBRIDGE_EXECED:-}" ] && [ ! -t 0 ] && { [ -t 1 ] || [ -t 2 ]; } && [ -c /dev/tty ]; then
  TMP_SELF="$(mktemp /tmp/gptbridge-install.XXXXXX.sh)"
  fetch "$TMP_SELF" "$REPO_RAW/install.sh"
  GPTBRIDGE_EXECED=1 exec bash "$TMP_SELF" "$@" < /dev/tty
fi

TUNNEL="" TUNNEL_ID="" API_KEY=""
for a in "$@"; do
  case "$a" in
    --tunnel=*) TUNNEL="${a#*=}" ;;
    --tunnel-id=*) TUNNEL_ID="${a#*=}" ;;
    --api-key=*) API_KEY="${a#*=}" ;;
    *) echo "ERROR: unknown arg: $a"; exit 1 ;;
  esac
done
case "$TUNNEL" in
  ""|openai|cloudflared|none) ;;
  *) echo "ERROR: --tunnel must be openai | cloudflared | none"; exit 1 ;;
esac
if [ -n "$TUNNEL_ID" ] && ! [[ "$TUNNEL_ID" =~ ^tunnel_[a-z0-9]{32}([a-z0-9]{4})?$ ]]; then
  echo "ERROR: '$TUNNEL_ID' doesn't look like a tunnel id (expected tunnel_ + 32 lowercase chars)."
  exit 1
fi

INTERACTIVE=0; [ -t 0 ] && INTERACTIVE=1

# ask "question" -> 0 = yes (Enter), 1 = no; auto-yes when non-interactive
ask() {
  [ "$INTERACTIVE" = 1 ] || return 0
  local ans
  printf "%s [Y/n] " "$1"
  read -r ans
  case "$ans" in n|N|no|NO) return 1 ;; *) return 0 ;; esac
}

# --- step 1: server files ---
# server.mjs: use it from this checkout when present (dev mode - the service
# runs the repo file), otherwise download it (curl | bash)
if [ -n "$DIR" ] && [ -f "$DIR/server.mjs" ]; then
  SERVER_MJS="$DIR/server.mjs"
else
  SERVER_MJS="$APP_DIR/server.mjs"
fi
if ! ask "Install gptbridge server? (writes $BIN_DIR/gptbridge, $SVC_DIR/gptbridge.service, $GB_DIR/token, server code at $SERVER_MJS)"; then
  echo "Aborted - nothing was written."
  exit 0
fi

mkdir -p "$BIN_DIR" "$SVC_DIR" "$SVC_DIR/default.target.wants" "$GB_DIR" "$APP_DIR"

if [ "$SERVER_MJS" = "$APP_DIR/server.mjs" ]; then
  fetch "$SERVER_MJS" "$REPO_RAW/server.mjs"
fi

# server launcher (absolute node path: systemd has no nvm PATH) + CLI
cat > "$BIN_DIR/gptbridge" <<L
#!/usr/bin/env bash
# gptbridge CLI: no args = run server | log = live tool calls | status | tunnel
case "\${1:-}" in
  "") exec "$NODE_BIN" "$SERVER_MJS" ;;
  log) exec journalctl --user -u gptbridge.service -f -o cat ;;
  tunnel) exec journalctl --user -u gptbridge-tunnel.service -f -o cat ;;
  status)
    echo "service : \$(systemctl --user is-active gptbridge.service 2>/dev/null || echo unknown)"
    port="\$(grep -oE '^LOCALMCP_PORT=[0-9]+' "\$HOME/.gptbridge/env" 2>/dev/null | cut -d= -f2)"
    port="\${port:-8790}"
    if command -v curl >/dev/null 2>&1; then
      code="\$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:\${port}/mcp/\$(cat "\$HOME/.gptbridge/token")" -d '{"jsonrpc":"2.0","id":1,"method":"ping"}' 2>/dev/null || true)"
      echo "endpoint: http://127.0.0.1:\${port}/mcp (ping \${code:-000})"
      t="\$(systemctl --user is-active gptbridge-tunnel.service 2>/dev/null || echo inactive)"
      if [ "\$t" = "active" ]; then
        echo "tunnel  : active (ui: http://127.0.0.1:18790)"
      else
        echo "tunnel  : \$t"
      fi
    fi
    echo "recent:"
    journalctl --user -u gptbridge.service -n 30 --no-pager -o cat 2>/dev/null | grep -E 'tool |401 ' | tail -8 || true
    ;;
  *) echo "usage: gptbridge [log|status|tunnel]  (no args = run the server)"; exit 1 ;;
esac
L
chmod 755 "$BIN_DIR/gptbridge"

# server service (optional machine overrides: ~/.gptbridge/env)
cat > "$SVC_DIR/gptbridge.service" <<SVC
[Unit]
Description=gptbridge MCP server (native tools for ChatGPT)
After=network-online.target

[Service]
EnvironmentFile=-%h/.gptbridge/env
ExecStart=$BIN_DIR/gptbridge
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
SVC

# token (persist once, stable across restarts)
if [ ! -s "$GB_DIR/token" ]; then
  "$NODE_BIN" -e "console.log(require('crypto').randomBytes(16).toString('hex'))" > "$GB_DIR/token"
  chmod 600 "$GB_DIR/token"
fi

# port override written by the user in ~/.gptbridge/env (LOCALMCP_PORT=...)
GBPORT="$(grep -oE '^LOCALMCP_PORT=[0-9]+' "$GB_DIR/env" 2>/dev/null | cut -d= -f2 || true)"
GBPORT="${GBPORT:-8790}"

# --- step 2: start service ---
code=""
if ask "Enable + start gptbridge.service now?"; then
  systemctl --user daemon-reload
  systemctl --user enable --now gptbridge.service
  # wait for the MCP endpoint to answer (max ~10s), never abort the installer on it
  if command -v curl >/dev/null 2>&1; then
    for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
      code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:${GBPORT}/mcp/$(cat "$GB_DIR/token")" \
        -d '{"jsonrpc":"2.0","id":1,"method":"ping"}' || true)"
      [ "$code" = "200" ] && break
      sleep 0.5
    done
  fi
fi

echo
echo "gptbridge installed."
echo "  local endpoint : http://127.0.0.1:${GBPORT}/mcp"
echo "  token          : $GB_DIR/token"
if [ "$code" = "200" ]; then
  echo "  service        : healthy (MCP ping OK)"
elif [ -n "$code" ]; then
  echo "  service        : not responding yet - check: journalctl --user -u gptbridge -f"
else
  echo "  service        : not started - later: systemctl --user enable --now gptbridge.service"
fi

# ---------------- tunnel wizard ----------------
if [ -z "$TUNNEL" ]; then
  if [ "$INTERACTIVE" = 1 ]; then
    echo
    echo "How should ChatGPT reach this machine?"
    echo "  1) OpenAI Secure MCP Tunnel  - private, no public URL (recommended)"
    echo "  2) cloudflared quick tunnel  - public URL, changes every start"
    echo "  3) Skip - I'll wire the tunnel myself"
    printf "Choose [1]: "
    read -r CHOICE
    case "${CHOICE:-1}" in
      2) TUNNEL=cloudflared ;;
      3) TUNNEL=none ;;
      *) TUNNEL=openai ;;
    esac
  else
    # non-interactive, no flags: legacy behavior
    if command -v cloudflared >/dev/null 2>&1; then TUNNEL=cloudflared; else TUNNEL=none; fi
  fi
fi

setup_openai_tunnel() {
  # --- step 3: tunnel-client binary ---
  case "$(uname -m)" in
    x86_64) TC_ARCH=amd64 ;;
    aarch64|arm64) TC_ARCH=arm64 ;;
    *) echo "ERROR: unsupported arch: $(uname -m)"; return 1 ;;
  esac
  if [ -x "$BIN_DIR/tunnel-client" ] && "$BIN_DIR/tunnel-client" --version >/dev/null 2>&1; then
    echo
    echo "tunnel-client already installed: $("$BIN_DIR/tunnel-client" --version 2>/dev/null | head -1)"
  else
    command -v unzip >/dev/null 2>&1 || { echo "ERROR: need unzip"; return 1; }

    TC_VER="${GPTBRIDGE_TC_VERSION:-}"
    if [ -z "$TC_VER" ]; then
      TC_VER="$(fetch /dev/stdout https://api.github.com/repos/openai/tunnel-client/releases/latest 2>/dev/null \
        | grep -oE '"tag_name": *"v[0-9.]+"' | grep -oE 'v[0-9.]+' | head -1 || true)"
    fi
    [ -n "$TC_VER" ] || TC_VER="v0.0.16"
    TC_ASSET="tunnel-client-${TC_VER}-linux-${TC_ARCH}.zip"
    TC_URL="https://github.com/openai/tunnel-client/releases/download/${TC_VER}/${TC_ASSET}"
    ask "Download tunnel-client ${TC_VER} (linux-${TC_ARCH}, ~40 MB) to $BIN_DIR/tunnel-client?" || {
      echo "Skipped - tunnel-client is required for the Secure MCP Tunnel."
      return 0
    }
    echo "Downloading tunnel-client ${TC_VER} (linux-${TC_ARCH})..."
    TC_TMP="$(mktemp -d)"
    fetch "$TC_TMP/$TC_ASSET" "$TC_URL"
    fetch "$TC_TMP/SHA256SUMS.txt" "https://github.com/openai/tunnel-client/releases/download/${TC_VER}/SHA256SUMS.txt"
    (cd "$TC_TMP" && grep "  $TC_ASSET\$" SHA256SUMS.txt | sha256sum -c - >/dev/null)
    unzip -o -q "$TC_TMP/$TC_ASSET" tunnel-client -d "$TC_TMP/x"
    install -m 755 "$TC_TMP/x/tunnel-client" "$BIN_DIR/tunnel-client"
    rm -rf "$TC_TMP"
  fi

  # --- step 4: the two values only the user can create ---
  if [ -z "$TUNNEL_ID" ]; then
    echo
    echo "Two values are needed; create them with your OpenAI account:"
    echo
    echo "  1) Tunnel ID"
    echo "     URL : https://platform.openai.com/settings/organization/tunnels"
    echo "     How : 'Create a tunnel' -> copy the id (starts with tunnel_)"
    printf "     paste tunnel id  : "
    read -r TUNNEL_ID
    echo
    echo "  2) Runtime API key"
    echo "     URL : https://platform.openai.com/settings/organization/api-keys"
    echo "     How : 'Create API key' (Runtime type) -> permission: Tunnels Read + Use"
    echo "     Note: input is hidden; paste and press Enter"
    printf "     paste runtime key: "
    read -rs API_KEY
    echo
  fi
  if ! [[ "$TUNNEL_ID" =~ ^tunnel_[a-z0-9]{32}([a-z0-9]{4})?$ ]]; then
    echo "ERROR: '$TUNNEL_ID' doesn't look like a tunnel id (expected tunnel_ + 32 chars)."
    return 1
  fi
  [ -n "$API_KEY" ] || { echo "ERROR: empty runtime API key"; return 1; }

  # --- step 5: env file + tunnel service ---
  if ! ask "Write $GB_DIR/tunnel.env (contains the API key, chmod 600) + install gptbridge-tunnel.service + enable now?"; then
    echo
    echo "Tunnel not installed. Manual steps later:"
    echo "  re-run: bash install.sh --tunnel=openai --tunnel-id=$TUNNEL_ID --api-key=..."
    return 0
  fi
  umask 077
  cat > "$GB_DIR/tunnel.env" <<E
CONTROL_PLANE_API_KEY=$API_KEY
CONTROL_PLANE_TUNNEL_ID=$TUNNEL_ID
MCP_SERVER_URL=http://127.0.0.1:${GBPORT}/mcp/$(cat "$GB_DIR/token")
HEALTH_LISTEN_ADDR=127.0.0.1:18790
E
  chmod 600 "$GB_DIR/tunnel.env"
  umask 022

  systemctl --user disable --now gptbridge-tunnel.service 2>/dev/null || true
  cat > "$SVC_DIR/gptbridge-tunnel.service" <<SVC
[Unit]
Description=gptbridge OpenAI Secure MCP Tunnel -> local MCP
After=gptbridge.service network-online.target

[Service]
EnvironmentFile=%h/.gptbridge/tunnel.env
ExecStart=$BIN_DIR/tunnel-client run
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
SVC
  systemctl --user daemon-reload
  systemctl --user enable --now gptbridge-tunnel.service
  local ok=0
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if curl -fsS http://127.0.0.1:18790/readyz >/dev/null 2>&1; then ok=1; break; fi
    sleep 1
  done
  if [ "$ok" = 1 ]; then
    echo "  tunnel service  : active (readyz OK)"
  else
    echo "  tunnel service  : starting/not ready - check: journalctl --user -u gptbridge-tunnel -f"
  fi
  echo
  echo "Last step: https://chatgpt.com/plugins -> Add custom MCP"
  echo "  Connection     : Tunnel  -> pick $TUNNEL_ID"
  echo "  Authentication : No authentication (the token is in the local path)"
  echo
  echo "Using it: open a chat, enable the gptbridge connector (Developer mode), then ask:"
  echo "  run hostname on my machine"
  echo "  list the files in ~/projects"
  echo "  read ~/.gitconfig and summarize it"
  echo "  create /tmp/hello.txt containing 'hi'"
}

case "$TUNNEL" in
  openai) setup_openai_tunnel ;;
  none)
    echo
    echo "Tunnel skipped. To expose it later, re-run: bash install.sh"
    echo "  or: bash install.sh --tunnel=openai --tunnel-id=tunnel_... --api-key=sk-..."
    echo
    echo "Once a tunnel is up, add the connector at: https://chatgpt.com/plugins -> Add custom MCP"
    ;;
  cloudflared)
    if command -v cloudflared >/dev/null 2>&1; then
      if ask "Install gptbridge-tunnel.service (cloudflared, public URL) + enable now?"; then
        CF_BIN="$(command -v cloudflared)"
        cat > "$SVC_DIR/gptbridge-tunnel.service" <<SVC
[Unit]
Description=gptbridge public tunnel (cloudflared -> local MCP)
After=gptbridge.service network-online.target

[Service]
ExecStart=$CF_BIN tunnel --url http://127.0.0.1:${GBPORT} --logfile %h/.gptbridge/cloudflared.log
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
SVC
        systemctl --user daemon-reload
        systemctl --user enable --now gptbridge-tunnel.service
        sleep 6
        URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$GB_DIR/cloudflared.log" | tail -1 || true)"
        echo
        echo "  tunnel service  : active"
        echo "  public MCP URL  : ${URL:-starting... check: journalctl --user -u gptbridge-tunnel}"
        echo
        echo "Last step: https://chatgpt.com/plugins -> Add custom MCP"
        echo "  MCP Server URL : ${URL}/mcp/\$(cat ~/.gptbridge/token)"
        echo "  Authentication : No authentication"
        echo
        echo "Using it: open a chat, enable the gptbridge connector (Developer mode), then ask:"
        echo "  run hostname on my machine"
        echo "  list the files in ~/projects"
        echo "  read ~/.gitconfig and summarize it"
        echo "  create /tmp/hello.txt containing 'hi'"
      else
        echo "Tunnel skipped."
      fi
    else
      echo
      echo "  (cloudflared not found - install it or re-run with --tunnel=openai)"
    fi
    ;;
esac
