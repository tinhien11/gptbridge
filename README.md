# gptbridge — give ChatGPT's web UI hands

ChatGPT runs in the cloud; your shell and files are on this machine. gptbridge is an MCP server plus an **OpenAI Secure MCP Tunnel**: private by default, no public URL, no inbound ports.

```
ChatGPT (web)  ──OpenAI Secure MCP Tunnel──>  gptbridge (:8790)  ──>  shell & files
```

A free ChatGPT account is enough. No Plus, no Developer mode.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/tinhien11/gptbridge/master/install.sh | bash
```

Or from a checkout: `bash install.sh` (runs the repo's `server.mjs` directly).

Requirements: Node.js 18+, Linux with systemd, ChatGPT web account, OpenAI account.

The wizard asks `[Y/n]` before each write, then sets up the tunnel by default. You paste two values from [platform.openai.com](https://platform.openai.com/settings/organization/tunnels):

- **tunnel id** — Tunnels → Create a tunnel
- **runtime API key** — API keys, permission *Tunnels Read + Use*

It downloads `tunnel-client` (checksum verified), writes `~/.gptbridge/tunnel.env` (chmod 600), and installs `gptbridge-tunnel.service` with auto-reconnect. Choose **Skip** to wire your own tunnel.

Non-interactive:

```bash
bash install.sh --tunnel=openai --tunnel-id=tunnel_... --api-key=sk-...
bash install.sh --tunnel=none
```

Re-run without flags: saved `~/.gptbridge/tunnel.env` is reused, no re-paste. To update code/service only, with zero prompts:

```bash
curl -fsSL https://raw.githubusercontent.com/tinhien11/gptbridge/master/install.sh | bash -s -- --update
```

## Connect

[chatgpt.com/plugins](https://chatgpt.com/plugins) → **+ → Add custom MCP**:

- **Connection: Tunnel** → pick your tunnel
- **Authentication: No authentication** (token is in the local path)

Accept the risk warning → **Create as a plugin**.

## Use

Enable the gptbridge connector in a chat, then ask (e.g. `run hostname`, `list ~/projects`).

## Tools

| Tool | What it does |
|---|---|
| `run_command` | Shell command (optional `cwd`), stdout+stderr up to ~20k chars |
| `read_file` | File content (~50k chars max) |
| `write_file` | Create/overwrite a file |
| `list_dir` | Directory listing |
| `chatgpt_delegate` | Prompt ChatGPT web via Chrome CDP. ONE prompt per task (checklist + log/output files, `new_chat`); no multi-turn chains. Progress `~/.gptbridge/tasks/<session>.log`. See WEB-AGENT-SKILL.md |
| `task_status` | Delegated-task progress `{steps_done, last_step, finished, reply}`; poll it, never re-prompt the session |

## Watch

```bash
gptbridge log      # live tool calls + durations
gptbridge status   # service, endpoint, tunnel, last calls
gptbridge tunnel   # live tunnel log
```

## Security

This gives ChatGPT **arbitrary command execution on this machine**. The tunnel keeps it private:

- Server binds `127.0.0.1`; only `tunnel-client` dials out to OpenAI.
- Nothing exposed to the internet, no public URL, no inbound ports.
- Calls are gated by your OpenAI org and brokered by OpenAI's control plane.
- Runtime key lives in `~/.gptbridge/tunnel.env` (chmod 600). Give it *Tunnels Read + Use* only, never admin.

A self-wired public tunnel is your risk: anyone with its URL can run commands. On leak, delete `~/.gptbridge/token`, restart, update the connector.

## Optional: billion-context

[billion-context](https://github.com/ranxianglei/billion-context) folds long coding sessions so a small context window lasts. gptbridge bridges it to ChatGPT as **three extra tools**: `compress`, `decompress`, `acp_status`.

Optional and auto-detected. Nothing to configure if you do not install it — the tools are absent from `tools/list`. When a bili proxy is running, gptbridge finds its origin at runtime; no path, port or version is hardcoded.

- `GPTBRIDGE_BILI_ORIGIN` overrides detection; `GPTBRIDGE_BILI_DISABLE=1` hides the tools.
- `compress` takes `content` — one string of `mNNNNN–mNNNNN topic` blocks with ≥50-char summaries written by the model itself (bili cannot see ChatGPT's transcript). Call `acp_status` first for real refs.

## Configuration

Server env (`~/.gptbridge/env`):

| Env | Default | Purpose |
|---|---|---|
| `LOCALMCP_PORT` | `8790` | Listen port |
| `LOCALMCP_HOST` | `127.0.0.1` | Bind address |
| `LOCALMCP_CWD` | `$HOME` | Default `run_command` dir |
| `LOCALMCP_TIMEOUT` | `120000` | Command timeout (ms) |
| `GPTBRIDGE_CDP_HTTP` | `http://127.0.0.1:9222` | Chrome debug endpoint for `chatgpt_delegate` |
| `GPTBRIDGE_WEB_URL` | `https://chatgpt.com/` | Chat page the web agent drives |
| `GPTBRIDGE_WEB_SESSIONS` | `~/.gptbridge/web-sessions.json` | Session → conversation id |
| `GPTBRIDGE_WEB_COMPRESS_CHARS` | `60000` | bili fold threshold (4 recent turns stay raw) |

Tunnel env (`~/.gptbridge/tunnel.env`):

| Env | Purpose |
|---|---|
| `CONTROL_PLANE_API_KEY` | Runtime key (Tunnels Read + Use) |
| `CONTROL_PLANE_TUNNEL_ID` | `tunnel_...` id |
| `MCP_SERVER_URL` | Local endpoint incl. token |
| `HEALTH_LISTEN_ADDR` | tunnel-client health UI (`127.0.0.1:18790`) |

MIT
