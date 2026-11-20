// Web-agent bridge: drive a ChatGPT-like web chat over Chrome CDP.
// Zero dependencies (Node >= 22 has global WebSocket). Design doc: WEB-AGENT.md.
// No hardcoded user paths or ports: every location comes from env with sane defaults.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const CDP_HTTP = process.env.GPTBRIDGE_CDP_HTTP || "http://127.0.0.1:9222";
const SESSIONS_FILE =
  process.env.GPTBRIDGE_WEB_SESSIONS || path.join(os.homedir(), ".gptbridge", "web-sessions.json");
const NAV_TIMEOUT = Number(process.env.GPTBRIDGE_WEB_NAV_TIMEOUT || 20_000);

export const CHATGPT_URL = process.env.GPTBRIDGE_WEB_URL || "https://chatgpt.com/";

// Selectors live here so a UI change is a one-line fix (see WEB-AGENT.md).
export const SELECTORS = {
  composer: ['#prompt-textarea', 'div[contenteditable="true"]', "textarea"],
  send: ['button[data-testid="send-button"]', 'button[aria-label*="Send"]'],
  stop: ['button[data-testid="stop-button"]', 'button[aria-label*="Stop"]'],
  generating: ['[data-is-streaming="true"]', ".result-streaming", '[aria-busy="true"]'],
  assistant: ['[data-message-author-role="assistant"]', 'li[data-message-role="assistant"]'],
  assistantContent: [".markdown", "[data-stream-target]"],
  conversationIdPattern: "^/(?:c|uc)/([0-9a-f-]{8,})",
  stabilityMs: 1200,
};

// --- sessions ---------------------------------------------------------------
let sessions = (() => {
  try { return JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf8")); } catch { return {}; }
})();

function rememberSession(key, conversationId) {
  if (!conversationId) return;
  sessions[key] = conversationId;
  try {
    fs.mkdirSync(path.dirname(SESSIONS_FILE), { recursive: true });
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
  } catch { /* best effort */ }
}

// --- minimal CDP over WebSocket ----------------------------------------------
const wsQueue = new Map(); // ws url -> Promise<WebSocket>
function wsConnect(url) {
  if (!wsQueue.has(url)) {
    wsQueue.set(
      url,
      new Promise((resolve, reject) => {
        const ws = new WebSocket(url);
        ws.pending = new Map();
        ws.nextId = 1;
        ws.onopen = () => resolve(ws);
        ws.onerror = () => { wsQueue.delete(url); reject(new Error("ws error " + url)); };
        ws.onclose = () => wsQueue.delete(url);
        ws.onmessage = (ev) => {
          const msg = JSON.parse(ev.data);
          const p = ws.pending.get(msg.id);
          if (p) {
            ws.pending.delete(msg.id);
            msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
          }
        };
      })
    );
  }
  return wsQueue.get(url);
}

async function cdpCall(ws, method, params = {}) {
  const id = ws.nextId++;
  const p = new Promise((resolve, reject) => ws.pending.set(id, { resolve, reject }));
  ws.send(JSON.stringify({ id, method, params }));
  return p;
}

async function cdpEval(ws, expression) {
  const r = await cdpCall(ws, "Runtime.evaluate", {
    expression, awaitPromise: true, returnByValue: true,
  });
  if (r.exceptionDetails) {
    throw new Error("page eval failed: " + (r.exceptionDetails.exception?.description || "unknown"));
  }
  return r.result?.value;
}

async function findTarget(host) {
  const r = await fetch(`${CDP_HTTP}/json/list`);
  const targets = await r.json();
  return targets.find((t) => t.type === "page" && new URL(t.url).host === host);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ensureTab(host, url) {
  let t = await findTarget(host);
  if (!t) {
    const r = await fetch(`${CDP_HTTP}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
    t = await r.json();
    await sleep(1000);
  }
  const ws = await wsConnect(t.webSocketDebuggerUrl);
  return { target: t, ws };
}

// --- in-page turn logic (adapted from tablm page-core, simplified) -----------
// Written as a plain async-function SOURCE STRING: it is evaluated inside the
// page via Runtime.evaluate(awaitPromise), not run in Node, so stringifying a
// real function is fragile with nested templates.
/* eslint-disable */
export function pageTurnJs(cfg) {
  return "(" + asyncPageTurnSource + ")(" + JSON.stringify(cfg) + ")";
}

const asyncPageTurnSource = `async function pageTurn(cfg) {
    const S = cfg.selectors;
    const all = (sel, root) => { try { return [...(root || document).querySelectorAll(sel)]; } catch { return []; } };
    const visible = (el) => !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
    const firstVisible = (sels) => { for (const s of sels) for (const el of all(s)) if (visible(el)) return el; return null; };
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const OUTAGE = /chatgpt is temporarily|something went wrong|unable to load/i;
    const strip = (t) => t
      .replace(/^[ \\t]*(?:#{1,6} )?(?:\\*\\*)?(?:ChatGPT|You|Assistant) said:?(?:\\*\\*)?[ \\t]*$/gim, "")
      .replace(/^[ \\t]*(?:Copy|Download|Regenerate|Share|Edit)[ \\t]*$/gim, "")
      .replace(/\\n{3,}/g, "\\n\\n").trim();
    const readMessage = (el) => {
      for (const s of S.assistantContent || []) {
        const parts = all(s, el).filter((n, _i, arr) => !arr.some((o) => o !== n && o.contains(n)));
        if (parts.length) {
          const t = strip(parts.map((p) => p.innerText || "").join("\\n").trim());
          return OUTAGE.test(t) ? "" : t;
        }
      }
      const t = strip((el.innerText || el.textContent || "").trim());
      return OUTAGE.test(t) ? "" : t;
    };
    const composer = () => firstVisible(S.composer);
    const sendBtn = () => firstVisible(S.send);
    const stopBtn = () => firstVisible(S.stop);
    const generating = () => !!stopBtn() || S.generating.some((s) => all(s).length > 0);
    const messageNodes = () => S.assistant.flatMap((s) => all(s)).sort((a, b) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
    const convId = () => { const m = location.pathname.match(new RegExp(S.conversationIdPattern)); return m ? (m[1] || m[0]) : null; };
    const setComposer = (el, value) => {
      el.focus();
      const tag = el.tagName.toLowerCase();
      if (tag === "textarea" || tag === "input") {
        const proto = tag === "textarea" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const d = Object.getOwnPropertyDescriptor(proto, "value");
        if (d && d.set) d.set.call(el, value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return;
      }
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      if (sel) { sel.removeAllRanges(); sel.addRange(range); }
      document.execCommand("insertText", false, value);
    };
    const deadline = Date.now() + cfg.timeoutMs;
    let comp = null;
    while (Date.now() < deadline) { comp = composer(); if (comp) break; await sleep(300); }
    if (!comp) return { status: "error", text: "", conversationId: null, error: "composer not found on " + location.host };
    const READ_WINDOW = 8;
    const baseline = messageNodes().slice(-READ_WINDOW).map(readMessage);
    // send: set composer, then click send; retry a few times, fall back to Enter
    let send = null;
    for (let attempt = 0; attempt < 6 && !send; attempt++) {
      const target = composer() || comp;
      setComposer(target, cfg.prompt);
      for (let t = 0; t < 5 && !send; t++) { send = sendBtn(); if (send) break; await sleep(400); }
      if (!send) await sleep(500);
    }
    if (!send) {
      const target = composer() || comp;
      for (const type of ["keydown", "keypress", "keyup"]) {
        target.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      }
    }
    const submitted = () => {
      const c = composer();
      const cur = c ? ((c.value ?? c.innerText ?? "")) : "";
      if (!cur.includes(String(cfg.prompt).slice(0, 32))) return true;
      if (generating()) return true;
      return messageNodes().map(readMessage).some((t, i) => Boolean(t) && (baseline[i] === undefined || baseline[i] !== t));
    };
    let accepted = false;
    for (let attempt = 0; attempt < 3 && !accepted; attempt++) {
      const btn = attempt === 0 ? send : sendBtn();
      if (!btn) break;
      btn.click();
      for (let t = 0; t < 6; t++) { await sleep(500); if (submitted()) { accepted = true; break; } }
    }
    if (!accepted) return { status: "error", text: "", conversationId: null, error: "site did not accept the prompt" };
    // poll until stable response
    let lastSeen = null, lastActivity = Date.now(), stableSince = null, candidate = "";
    while (Date.now() < deadline) {
      const active = generating();
      const nodes = messageNodes().slice(-READ_WINDOW);
      const texts = nodes.map(readMessage);
      const fresh = [];
      for (let i = 0; i < texts.length; i++) {
        const t = texts[i];
        if (t && (baseline[i] === undefined || baseline[i] !== t)) fresh.push(t);
      }
      candidate = fresh.length ? fresh[fresh.length - 1] : "";
      if (active || candidate !== lastSeen) { lastSeen = candidate; lastActivity = Date.now(); stableSince = null; }
      else if (candidate && stableSince === null) { stableSince = Date.now(); }
      if (Date.now() - lastActivity > cfg.idleMs) {
        return { status: "timeout", text: candidate || "", conversationId: convId(), error: "no activity for " + Math.round((Date.now() - lastActivity) / 1000) + "s" };
      }
      if (candidate && !active && stableSince !== null && Date.now() - stableSince >= S.stabilityMs) {
        return { status: "done", text: candidate, conversationId: convId() };
      }
      await sleep(400);
    }
    return { status: "timeout", text: candidate || "", conversationId: convId(), error: "hard deadline reached" };
  }`;
/* eslint-enable */

// --- public API ---------------------------------------------------------------
export async function delegate({ prompt, session, new_chat, timeout_s }) {
  if (!prompt) throw new Error("prompt is required");
  const host = new URL(CHATGPT_URL).host;
  const key = session || "default";
  let convId = new_chat ? null : sessions[key] || null;
  const timeoutMs = Math.max(10_000, (timeout_s ?? 180) * 1000);
  const idleMs = Math.max(10_000, Math.round(timeoutMs * 0.8));

  const { target, ws } = await ensureTab(host, CHATGPT_URL);
  // reuse conversation if known, else open a fresh chat
  if (convId && !new URL(target.url).pathname.includes(convId)) {
    await cdpCall(ws, "Page.navigate", { url: `${CHATGPT_URL}c/${convId}` });
    await sleep(2000);
  } else if (!convId && new URL(target.url).pathname !== new URL(CHATGPT_URL).pathname) {
    await cdpCall(ws, "Page.navigate", { url: CHATGPT_URL });
    await sleep(2000);
  }
  const cfg = { prompt, timeoutMs, idleMs, selectors: SELECTORS };
  const result = await cdpEval(ws, pageTurnJs(cfg));
  if (result?.conversationId) rememberSession(key, result.conversationId);
  // chat refused the message -> fresh chat, retry once
  if (result?.status === "error" && /composer not found|did not accept/i.test(result.error ?? "") && !new_chat) {
    delete sessions[key];
    await cdpCall(ws, "Page.navigate", { url: CHATGPT_URL });
    await sleep(2000);
    const retry = await cdpEval(ws, pageTurnJs(cfg));
    if (retry?.conversationId) rememberSession(key, retry.conversationId);
    return retry;
  }
  return result;
}

export function resetSessions() { sessions = {}; try { fs.rmSync(SESSIONS_FILE, { force: true }); } catch {} }
