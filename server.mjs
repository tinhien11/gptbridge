#!/usr/bin/env node
// gptbridge - MCP server that gives ChatGPT's web UI native tools on this
// machine: run shell commands, read/write files, list directories.
//
// Zero dependencies (Node >= 18 builtins only). Transport: MCP Streamable
// HTTP - JSON-RPC 2.0 POSTed to /mcp, responses as application/json.
//
// Auth (either works):
//   Authorization: Bearer <token>
//   POST /mcp/<token>            <- token in the path (ChatGPT "No auth" mode)
//
// Token lives at ~/.gptbridge/token (created on first start, chmod 600).
// Port: LOCALMCP_PORT (default 8790). Bind: LOCALMCP_HOST (default 127.0.0.1).
// Working dir for run_command: LOCALMCP_CWD (default $HOME).

import http from "node:http";
import { exec as execCb } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

const PORT = Number(process.env.LOCALMCP_PORT || 8790);
const HOST = process.env.LOCALMCP_HOST || "127.0.0.1";
const CWD = process.env.LOCALMCP_CWD || os.homedir();
const TIMEOUT = Number(process.env.LOCALMCP_TIMEOUT || 120_000);
const TOKEN_DIR = path.join(os.homedir(), ".gptbridge");
const TOKEN_FILE = path.join(TOKEN_DIR, "token");

function loadOrCreateToken(): string {
  try {
    const saved = fs.readFileSync(TOKEN_FILE, "utf8").trim();
    if (saved) return saved;
  } catch {}
  const t = crypto.randomBytes(16).toString("hex");
  fs.mkdirSync(TOKEN_DIR, { recursive: true });
  fs.writeFileSync(TOKEN_FILE, t, { mode: 0o600 });
  return t;
}
const TOKEN = loadOrCreateToken();

const resolveInCwd = (p: string) =>
  path.isAbsolute(p) ? p : path.resolve(process.env.LOCALMCP_CWD || CWD, p);

function run(command: string, cwd?: string): Promise<string> {
  return new Promise((resolve) => {
    execCb(
      command,
      { cwd: cwd ? resolveInCwd(cwd) : CWD, timeout: TIMEOUT, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        let out = "";
        if (stdout) out += stdout;
        if (stderr) out += (out ? "\n[stderr]\n" : "") + stderr;
        if (err && !stdout && !stderr) out += `[error] ${err.message}`;
        resolve(out.slice(0, 20_000) || "(no output)");
      }
    );
  });
}

const TOOLS = [
  {
    name: "run_command",
    description:
      "Run a shell command on the user's real machine (has gh authenticated to their Git hosts, private network access, and all local files). Optional cwd sets the working directory. Returns stdout+stderr (~20k chars max).",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string" },
        cwd: { type: "string", description: "working directory (default: user's home)" },
      },
      required: ["command"],
    },
  },
  {
    name: "read_file",
    description: "Read a file on the user's real machine (content capped at ~50k chars).",
    inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
  {
    name: "write_file",
    description: "Write or create a file on the user's real machine.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
    },
  },
  {
    name: "list_dir",
    description: "List entries of a directory on the user's real machine.",
    inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
];

async function callTool(name: string, args: any): Promise<{ text: string; isError: boolean }> {
  try {
    switch (name) {
      case "run_command":
        return {
          text: await run(String(args.command ?? ""), args.cwd ? String(args.cwd) : undefined),
          isError: false,
        };
      case "read_file": {
        const p = resolveInCwd(String(args.path ?? ""));
        return { text: fs.readFileSync(p, "utf8").slice(0, 50_000), isError: false };
      }
      case "write_file": {
        const p = resolveInCwd(String(args.path ?? ""));
        const content = String(args.content ?? "");
        fs.writeFileSync(p, content, "utf8");
        return { text: `wrote ${Buffer.byteLength(content)} bytes to ${p}`, isError: false };
      }
      case "list_dir": {
        const p = resolveInCwd(String(args.path ?? "."));
        return { text: fs.readdirSync(p).join("\n"), isError: false };
      }
      default:
        return { text: `unknown tool: ${name}`, isError: true };
    }
  } catch (e: any) {
    return { text: `[error] ${e.message ?? String(e)}`, isError: true };
  }
}

async function handle(body: any): Promise<any | null> {
  const id = body?.id ?? null;
  switch (body?.method ?? "") {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion:
            typeof body?.params?.protocolVersion === "string" ? body.params.protocolVersion : "2025-03-26",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "gptbridge", version: "1.0.0" },
        },
      };
    case "notifications/initialized":
      return null;
    case "ping":
      return { jsonrpc: "2.0", id, result: {} };
    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
    case "tools/call": {
      const { text, isError } = await callTool(
        String(body?.params?.name ?? ""),
        body?.params?.arguments ?? {}
      );
      return {
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text }], isError },
      };
    }
    default:
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `method not found: ${body?.method ?? ""}` },
      };
  }
}

const authorized = (req: http.IncomingMessage, path: string): boolean => {
  const auth = req.headers.authorization;
  if (auth === `Bearer ${TOKEN}`) return true;
  const m = /^\/mcp\/([0-9a-f]{8,64})$/.exec(path);
  return m !== null && m[1] === TOKEN;
};

const server = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  let body: any = {};
  req.on("data", (c) => chunks.push(c));
  req.on("end", async () => {
    const url = (req.url ?? "").split("?")[0];
    if (!authorized(req, url)) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "unauthorized" } }));
      return;
    }
    try {
      const raw = Buffer.concat(chunks).toString("utf8");
      body = raw ? JSON.parse(raw) : {};
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "invalid JSON" } }));
      return;
    }
    try {
      const out = await handle(body);
      if (out === null) {
        res.writeHead(202);
        res.end();
      } else {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(out));
      }
    } catch (e: any) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: body?.id ?? null, error: { code: -32603, message: String(e?.message ?? e) } }));
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`gptbridge MCP listening on http://${HOST}:${PORT}/mcp`);
  console.log(`token: ${TOKEN_FILE}`);
});
