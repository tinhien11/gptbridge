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
unit, autostart), generates a token at `~/.gptbridge/token`, and prints your
connector URL + token.

## Connect ChatGPT

1. Expose the endpoint publicly (ChatGPT's cloud must reach your machine).
   Easiest — a quick tunnel:
   ```bash
   cloudflared tunnel --url http://127.0.0.1:8790
   ```
2. ChatGPT → **Settings → Connectors → Create**:
   - **MCP server URL**: `https://<your-tunnel>/mcp/<token>`
   - **Authentication**: No authentication (the token is in the path)
3. In a chat, enable the connector, then just ask:
   ```
   run hostname on my machine
   ```
   → `tin` — executed for real.

## Tools

| Tool | What it does |
|---|---|
| `run_command` | Shell command (optional `cwd`), stdout+stderr up to ~20k chars |
| `read_file` | File content (~50k chars max) |
| `write_file` | Create/overwrite a file |
| `list_dir` | Directory listing |

## Security — read this

The connector URL contains the token and allows **arbitrary command
execution on your machine**.

- Keep the URL + token secret (`~/.gptbridge/token`)
- Prefer a **named Cloudflare tunnel** (stable URL) over quick tunnels
- Anyone with the URL can run commands — rotate the token (delete the token
  file, restart) if it leaks

## Configuration

| Env | Default | Purpose |
|---|---|---|
| `LOCALMCP_PORT` | `8790` | MCP listen port |
| `LOCALMCP_HOST` | `127.0.0.1` | Bind address |
| `LOCALMCP_CWD` | `$HOME` | Default working directory for `run_command` |
| `LOCALMCP_TIMEOUT` | `120000` | Command timeout (ms) |

## License

MIT
