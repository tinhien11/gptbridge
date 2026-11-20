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

function loadOrCreateToken() {
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

// Log every tool call to stdout (journald) with duration: `journalctl --user -u gptbridge -f`.
const log = (...parts) => console.log(new Date().toISOString(), ...parts);
let inflight = 0;
const oneLine = (s) => String(s).replace(/\s+/g, " ").slice(0, 120);
const describeArgs = (a = {}) => {
  if (a.command !== undefined) return `cmd="${oneLine(a.command)}"${a.cwd ? ` cwd=${a.cwd}` : ""}`;
  if (a.path !== undefined) return `path=${a.path}`;
  return oneLine(JSON.stringify(a));
};

const resolveInCwd = (p) =>
  path.isAbsolute(p) ? p : path.resolve(process.env.LOCALMCP_CWD || CWD, p);

function run(command, cwd) {
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

// --- optional billion-context bridge -------------------------------------
// billion-context is an HTTP proxy that folds LLM context. It is NOT required:
// with no proxy installed these tools stay out of tools/list. The origin is
// discovered at runtime (explicit env > bili env > XDG instance file); no
// install path or package version is baked into gptbridge.
const BILI_DISABLED = /^(1|true|yes|on)$/i.test(process.env.GPTBRIDGE_BILI_DISABLE || "");
const BILI_CACHE_MS = 10_000;
let biliCache = { at: 0, origin: null, promise: null };

function biliStateDir() {
  const state = process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state");
  return path.join(state, "billion-context");
}

function biliInstanceFile() {
  return path.join(biliStateDir(), "proxy-origin");
}

function originFromJson(value) {
  const origin = typeof value === "string" ? (value.startsWith("{") ? JSON.parse(value).origin : value) : value?.origin;
  return typeof origin === "string" && /^https?:\/\/\S+$/.test(origin) ? origin.replace(/\/+$/, "") : null;
}

function biliCandidateOrigins() {
  const out = [];
  const push = (v) => { if (v) out.push(v); };
  for (const key of ["GPTBRIDGE_BILI_ORIGIN", "BILI_MCP_PROXY", "BILLION_CONTEXT_PROXY"]) {
    const v = (process.env[key] || "").trim().replace(/;$/, "").replace(/\/+$/, "");
    if (/^https?:\/\/\S+$/.test(v)) push(v);
  }
  const state = biliStateDir();
  try {
    push(originFromJson(fs.readFileSync(biliInstanceFile(), "utf8").trim()));
  } catch {}
  // bili 0.1.213 writes instances/<id>.json and writers/<id>.json, not proxy-origin.
  for (const sub of ["instances", "writers"]) {
    let names = [];
    try {
      names = fs.readdirSync(path.join(state, sub)).filter((n) => n.endsWith(".json"));
    } catch {}
    for (const name of names) {
      try {
        push(originFromJson(JSON.parse(fs.readFileSync(path.join(state, sub, name), "utf8"))));
      } catch {}
    }
  }
  return [...new Set(out)];
}

async function biliOrigin() {
  if (BILI_DISABLED) return null;
  const now = Date.now();
  if (now - biliCache.at < BILI_CACHE_MS) return biliCache.origin;
  if (biliCache.promise) return biliCache.promise;
  biliCache.promise = (async () => {
    let found = null;
    for (const origin of biliCandidateOrigins()) {
      try {
        const res = await fetch(`${origin}/__bili/health`, { signal: AbortSignal.timeout(2_000) });
        if (res.ok) { found = origin; break; }
      } catch {}
    }
    biliCache = { at: Date.now(), origin: found, promise: null };
    return found;
  })();
  return biliCache.promise;
}

async function forwardBili(tool, args) {
  const origin = await biliOrigin();
  if (!origin) {
    return { text: "billion-context is not installed or reachable; gptbridge works without it.", isError: true };
  }
  const conversationId = String(args.conversation_id ?? args.conversationId ?? "").trim();
  const bodyArgs = { ...args };
  delete bodyArgs.conversation_id;
  delete bodyArgs.conversationId;
  const payload = { tool, args: bodyArgs };
  if (conversationId) payload.conversationId = conversationId;
  try {
    const res = await fetch(`${origin}/__bili/plugin/tool`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      return { text: `[billion-context] ${data?.error || `HTTP ${res.status}`}`, isError: true };
    }
    const text = typeof data.result === "string" ? data.result : JSON.stringify(data.result ?? "");
    return { text, isError: false };
  } catch (e) {
    return { text: `[billion-context] ${e.message ?? String(e)}`, isError: true };
  }
}

const BILI_TOOLS = [
  {
    name: "compress",
    description:
      "Fold this conversation's history with billion-context (optional). Pass conversation_id when known; otherwise the proxy uses its active session. If bili is not installed this tool is absent.",
    inputSchema: {
      type: "object",
      properties: { conversation_id: { type: "string", description: "bili conversation id (optional)" } },
    },
  },
  {
    name: "decompress",
    description: "Restore a compressed context block from billion-context.",
    inputSchema: {
      type: "object",
      properties: { conversation_id: { type: "string" }, ref: { type: "string" } },
    },
  },
  {
    name: "acp_status",
    description: "Read billion-context compression status for this conversation.",
    inputSchema: {
      type: "object",
      properties: { conversation_id: { type: "string" } },
    },
  },
];

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

const activeTools = async () => (await biliOrigin()) ? [...TOOLS, ...BILI_TOOLS] : TOOLS;

async function callTool(name, args) {
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
      case "compress":
      case "decompress":
      case "acp_status":
        return forwardBili(name, args);
      default:
        return { text: `unknown tool: ${name}`, isError: true };
    }
  } catch (e) {
    return { text: `[error] ${e.message ?? String(e)}`, isError: true };
  }
}

function reply(id, result, error) {
  return { jsonrpc: "2.0", id, ...(error ? { error } : { result }) };
}

const fail = (code, message) => ({ code, message });

async function handle(body) {
  const id = body?.id ?? null;
  switch (body?.method ?? "") {
    case "initialize":
      return reply(id, {
        protocolVersion:
          typeof body?.params?.protocolVersion === "string" ? body.params.protocolVersion : "2025-03-26",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "gptbridge", version: "1.1.0" },
      });
    case "notifications/initialized":
      return null;
    case "ping":
      return reply(id, {});
    case "tools/list":
      return reply(id, { tools: await activeTools() });
    case "tools/call": {
      const { text, isError } = await callTool(
        String(body?.params?.name ?? ""),
        body?.params?.arguments ?? {}
      );
      return reply(id, { content: [{ type: "text", text }], isError });
    }
    default:
      return reply(id, undefined, fail(-32601, `method not found: ${body?.method ?? ""}`));
  }
}

const authorized = (req, urlPath) => {
  const auth = req.headers.authorization;
  if (auth === `Bearer ${TOKEN}`) return true;
  const m = /^\/mcp\/([0-9a-f]{8,64})$/.exec(urlPath);
  return m !== null && m[1] === TOKEN;
};

const server = http.createServer((req, res) => {
  const chunks = [];
  let body = {};
  req.on("data", (c) => chunks.push(c));
  req.on("end", async () => {
    const url = (req.url ?? "").split("?")[0];
    const send = (status, payload) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    if (!authorized(req, url)) {
      log(`401 unauthorized ${url}`);
      send(401, reply(null, undefined, fail(-32001, "unauthorized")));
      return;
    }
    try {
      const raw = Buffer.concat(chunks).toString("utf8");
      body = raw ? JSON.parse(raw) : {};
    } catch {
      send(400, reply(null, undefined, fail(-32700, "invalid JSON")));
      return;
    }
    try {
      const started = Date.now();
      const method = String(body?.method ?? "");
      inflight += 1;
      let out;
      try {
        out = await handle(body);
      } finally {
        inflight -= 1;
      }
      const ms = Date.now() - started;
      if (method === "tools/call") {
        log(
          `tool ${String(body?.params?.name ?? "")} ${describeArgs(body?.params?.arguments)}` +
            ` -> ${out?.result?.isError ? "ERROR" : "ok"} in ${ms}ms (inflight ${inflight})`
        );
      } else if (method && method !== "ping") {
        log(`${method} -> ok in ${ms}ms`);
      }
      if (out === null) {
        res.writeHead(202);
        res.end();
      } else {
        send(200, out);
      }
    } catch (e) {
      send(200, reply(body?.id ?? null, undefined, fail(-32603, String(e?.message ?? e))));
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`gptbridge MCP listening on http://${HOST}:${PORT}/mcp`);
  console.log(`token: ${TOKEN_FILE}`);
});
