# gptbridge — give ChatGPT's web UI hands

Use **ChatGPT's web UI as a local coding agent**: an MCP server that gives
ChatGPT native tools on your machine — run shell commands, read/write files,
list directories. No API keys, no text protocols: ChatGPT calls these tools
natively through its **Connectors** feature.

```
ChatGPT (web)  ──MCP──>  gptbridge (:8790)  ──>  your shell & files
```

## Why

Web chats are the easiest way to reach a frontier model — but out of the box
they can't touch your machine. gptbridge exposes a small MCP endpoint that
ChatGPT registers as a connector; from then on ChatGPT runs `gh`, `git`,
build tools, and edits real files on your machine as native tool calls.

## Requirements

- Node.js 18+
- ChatGPT account with **custom MCP connectors** (Plus/Pro, Developer mode)
- Optional: [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
  to expose the endpoint publicly

## Install

```bash
bash install.sh
```

This installs `~/.local/bin/gptbridge`, a `gptbridge.service` (systemd user
unit, autostart), generates a token at `~/.gptbridge/token`, then asks how
ChatGPT should reach this machine:

1. **OpenAI Secure MCP Tunnel** (default, recommended) — private connection,
   no public URL, no inbound ports. The wizard downloads
   [tunnel-client](https://github.com/openai/tunnel-client), verifies its
   checksum, installs a `gptbridge-tunnel.service`, and only asks you to paste
   two values you create in the [OpenAI Platform](https://platform.openai.com/settings/organization/tunnels):
   a **tunnel id** and a **Runtime API key** (permission: *Tunnels Read + Use*).
2. **cloudflared quick tunnel** — public URL, changes every start.
3. **Skip** — wire the tunnel yourself.

Non-interactive:

```bash
bash install.sh --tunnel=openai --tunnel-id=tunnel_... --api-key=sk-...
bash install.sh --tunnel=cloudflared
bash install.sh --tunnel=none
```

## Connect ChatGPT

Open **[chatgpt.com/plugins](https://chatgpt.com/plugins)** → **Add custom MCP**.

**Secure MCP Tunnel** (from the wizard above):
**Connection: Tunnel** → pick your tunnel → **Authentication: No
authentication** (the token is already in the local path).

**Public URL** (cloudflared or any tunnel):
- **MCP server URL**: `https://<your-tunnel>/mcp/<token>`
- **Authentication**: No authentication (the token is in the path)

## Use it

In a chat, enable the **gptbridge** connector (Developer mode toggle), then
just ask:

```
run hostname on my machine
```
→ `tin` — executed for real.

More things to try:

```
list the files in ~/projects
read ~/.gitconfig and summarize it
create /tmp/hello.txt containing 'hi'
run gh pr list in ~/projects/gptbridge and summarize the open PRs
```

`run_command` accepts an optional `cwd` (defaults to your home). Output is
capped at ~20k chars per call, file reads at ~50k.

## Watch it work

Every tool call is logged with its duration, so when a call feels slow you
can see whether the time went to the command itself or to the round trip
(model + tunnel):

```bash
gptbridge log      # live: every tool call ChatGPT makes, with durations
gptbridge status   # service state, endpoint ping, last tool calls
gptbridge tunnel   # live tunnel-client log
```

The Secure MCP Tunnel also serves a local UI with connection health:
[http://127.0.0.1:18790](http://127.0.0.1:18790) (`/ui`, `/healthz`, `/metrics`).

## Tools

| Tool | What it does |
|---|---|
| `run_command` | Shell command (optional `cwd`), stdout+stderr up to ~20k chars |
| `read_file` | File content (~50k chars max) |
| `write_file` | Create/overwrite a file |
| `list_dir` | Directory listing |

## Security — read this

The connector allows **arbitrary command execution on your machine**.

- **Secure MCP Tunnel** keeps everything private: no public URL, only
  outbound HTTPS to `api.openai.com`. The runtime API key lives in
  `~/.gptbridge/tunnel.env` (chmod 600) — give it *Tunnels Read + Use* only,
  never an admin key.
- With a public tunnel, the URL contains the token — keep it secret
  (`~/.gptbridge/token`) and rotate it (delete the token file, restart) if it leaks
- Anyone who reaches the endpoint can run commands

## Configuration

| Env | Default | Purpose |
|---|---|---|
| `LOCALMCP_PORT` | `8790` | MCP listen port |
| `LOCALMCP_HOST` | `127.0.0.1` | Bind address |
| `LOCALMCP_CWD` | `$HOME` | Default working directory for `run_command` |
| `LOCALMCP_TIMEOUT` | `120000` | Command timeout (ms) |

Tunnel (written to `~/.gptbridge/tunnel.env` by the wizard):

| Env | Purpose |
|---|---|
| `CONTROL_PLANE_API_KEY` | Runtime API key (Tunnels Read + Use) |
| `CONTROL_PLANE_TUNNEL_ID` | `tunnel_...` from Platform → Tunnels |
| `MCP_SERVER_URL` | Local MCP endpoint incl. token (`http://127.0.0.1:8790/mcp/<token>`) |
| `HEALTH_LISTEN_ADDR` | tunnel-client health UI (default `127.0.0.1:18790`) |

## License

MIT
