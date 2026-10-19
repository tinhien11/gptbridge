# gptbridge — give ChatGPT's web UI hands

ChatGPT runs in the cloud. Your shell and files are on your machine.
**gptbridge bridges the two**: an MCP server on your machine plus a
**tunnel** so ChatGPT can call it — private by default, no public URL,
no inbound ports.

```
ChatGPT (web)  ──tunnel──>  gptbridge (:8790)  ──>  your shell & files
```

**A free ChatGPT account is enough** — no Plus, no Developer mode. Add the
server at [chatgpt.com/plugins](https://chatgpt.com/plugins) → **Add custom MCP**.

## Requirements

- Node.js 18+
- Linux with systemd (the installer sets up autostart; on macOS run
  `node server.mjs` by hand)
- Any ChatGPT account (web only — custom MCP is not available on mobile)

## Install

One-liner (downloads everything from GitHub):

```bash
curl -fsSL https://raw.githubusercontent.com/tinhien11/gptbridge/master/install.sh | bash
```

Or from a checkout (the service then runs the repo's `server.mjs` directly —
handy when hacking on it):

```bash
bash install.sh
```

The wizard asks `[Y/n]` (Enter = yes) before every step that writes to your
machine, then asks how ChatGPT should reach you — **the tunnel is the
interesting part**:

1. **OpenAI Secure MCP Tunnel** (default, recommended) — a private connection.
   Nothing is exposed to the internet: the `tunnel-client` daemon on your
   machine dials out to OpenAI's control plane, ChatGPT's tool calls flow
   back down the same connection. You paste two values you create in the
   [OpenAI Platform](https://platform.openai.com/settings/organization/tunnels)
   (the prompts show the exact URLs):
   - a **tunnel id** — Platform → Tunnels → *Create a tunnel*
   - a **runtime API key** — Platform → API keys, permission *Tunnels Read + Use*
   The wizard downloads `tunnel-client` (checksum verified), writes the key
   to `~/.gptbridge/tunnel.env` (chmod 600) and installs a
   `gptbridge-tunnel.service` that keeps the connection alive and reconnects
   on failure.
2. **cloudflared quick tunnel** — a public `trycloudflare.com` URL; changes
   every start. You add it to ChatGPT as a plain URL.
3. **Skip** — wire any tunnel yourself (ngrok, tailscale funnel, ...), then
   add its public URL in ChatGPT.

Non-interactive:

```bash
bash install.sh --tunnel=openai --tunnel-id=tunnel_... --api-key=sk-...
bash install.sh --tunnel=cloudflared
bash install.sh --tunnel=none
```

## Connect ChatGPT

Open **[chatgpt.com/plugins](https://chatgpt.com/plugins)** → **+ → Add custom MCP**:

- **Secure MCP Tunnel**: **Connection: Tunnel** → pick your tunnel
- Public tunnel: **Connection: URL** → `https://<your-tunnel>/mcp/<token>`

**Authentication: No authentication** either way — the token is in the local
path. Accept the risk warning → **Create as a plugin**.

## Use it

In a chat, type `@` and pick **gptbridge**, then just ask:

```
run hostname on my machine
```
→ `tin` — executed for real.

```
list the files in ~/projects
read ~/.gitconfig and summarize it
create /tmp/hello.txt containing 'hi'
run gh pr list in ~/projects/gptbridge and summarize the open PRs
```

## Watch it work

Every tool call is logged with its duration — when a call feels slow, the log
tells you whether the time went to the command itself or to the round trip
(model + tunnel):

```bash
gptbridge log      # live: every tool call ChatGPT makes, with durations
gptbridge status   # service state, endpoint ping, tunnel state, last calls
gptbridge tunnel   # live tunnel log
```

## Tools

| Tool | What it does |
|---|---|
| `run_command` | Shell command (optional `cwd`), stdout+stderr up to ~20k chars |
| `read_file` | File content (~50k chars max) |
| `write_file` | Create/overwrite a file |
| `list_dir` | Directory listing |

## Security — read this

The connector gives ChatGPT **arbitrary command execution on your machine**.
What stands in front of that depends on the tunnel:

- **Secure MCP Tunnel (default)** — nothing is exposed to the internet: the
  server binds to `127.0.0.1` and only `tunnel-client` dials out to OpenAI.
  Tool calls are gated by your OpenAI org: whoever can select your tunnel in
  ChatGPT (members of your workspace — just you on a personal account) can
  run commands, and OpenAI's control plane brokers every call. The runtime
  API key lives in `~/.gptbridge/tunnel.env` (chmod 600) — give it
  *Tunnels Read + Use* only, never an admin key.
- **Public tunnel (cloudflared, ngrok, ...)** — anyone holding the URL can
  run commands. The URL contains the token, and token-in-path leaks the way
  URLs do (shell history, logs, screenshots, referers). Keep it secret and
  rotate on leak: delete `~/.gptbridge/token`, restart, update the connector
  URL in ChatGPT.

## Configuration

Server env (put overrides in `~/.gptbridge/env`, the systemd unit reads it):

| Env | Default | Purpose |
|---|---|---|
| `LOCALMCP_PORT` | `8790` | MCP listen port |
| `LOCALMCP_HOST` | `127.0.0.1` | Bind address |
| `LOCALMCP_CWD` | `$HOME` | Default working directory for `run_command` |
| `LOCALMCP_TIMEOUT` | `120000` | Command timeout (ms) |

Tunnel env (written to `~/.gptbridge/tunnel.env` by the wizard):

| Env | Purpose |
|---|---|
| `CONTROL_PLANE_API_KEY` | Runtime API key (Tunnels Read + Use) |
| `CONTROL_PLANE_TUNNEL_ID` | `tunnel_...` from Platform → Tunnels |
| `MCP_SERVER_URL` | Local MCP endpoint incl. token (`http://127.0.0.1:8790/mcp/<token>`) |
| `HEALTH_LISTEN_ADDR` | tunnel-client health UI (the wizard sets `127.0.0.1:18790`) |

## License

MIT
