// functions/_lib/deriv-connect.js
// Deriv's current Options REST + WebSocket connection flow for Cloudflare Pages.
const API_BASE = "https://api.derivws.com";
const DEFAULT_APP_ID = "34QAdfWKVQBkld9sq3LRi";

export class DerivError extends Error {
  constructor(stage, message, extra = {}) {
    super(message);
    this.name = "DerivError";
    this.stage = stage;
    this.httpStatus = extra.httpStatus ?? null;
    this.code = extra.code ?? null;
  }
}

function requireEnv(env) {
  if (!env?.DERIV_API_TOKEN) throw new DerivError("config", "DERIV_API_TOKEN is missing from Cloudflare Pages Production secrets.");
}

async function derivRest(env, path, method = "GET") {
  let res;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers: {
        Authorization: `Bearer ${env.DERIV_API_TOKEN}`,
        "Deriv-App-ID": String(env.DERIV_APP_ID || DEFAULT_APP_ID),
        Accept: "application/json"
      }
    });
  } catch (e) {
    throw new DerivError(path.includes("/otp") ? "otp" : "accounts",
      `Network error reaching Deriv REST API: ${e?.message || "fetch failed"}`);
  }
  let body = null;
  try { body = await res.json(); } catch {}
  if (!res.ok) {
    const err = body?.errors?.[0] || {};
    throw new DerivError(path.includes("/otp") ? "otp" : "accounts",
      `Deriv REST ${method} returned HTTP ${res.status}` +
      (err.code ? ` (${err.code}${err.message ? ": " + err.message : ""})` : ""),
      { httpStatus:res.status, code:err.code });
  }
  return body;
}

export async function getDemoAccount(env) {
  requireEnv(env);
  const body = await derivRest(env, "/trading/v1/options/accounts");
  const list = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
  const normalize = a => ({
    id: String(a.account_id ?? a.loginid ?? a.id ?? ""),
    type: String(a.account_type ?? a.type ?? "").toLowerCase(),
    currency: String(a.currency ?? "").toUpperCase(),
    virtual: a.is_virtual === true || a.is_virtual === 1
  });
  const demos = list.map(normalize).filter(a => a.id && (a.type === "demo" || a.virtual || a.id.startsWith("VRTC")));
  if (env.DERIV_DEMO_ACCOUNT_ID) {
    const selected = demos.find(a => a.id === String(env.DERIV_DEMO_ACCOUNT_ID));
    if (selected) return selected;
    throw new DerivError("accounts", "DERIV_DEMO_ACCOUNT_ID did not match a demo account available to this token.");
  }
  const usd = demos.find(a => a.currency === "USD");
  if (usd) return usd;
  throw new DerivError("accounts", demos.length
    ? "A demo account exists, but no virtual USD demo account was found."
    : "No demo account was returned for this token. Check the token and its trade scope.");
}

async function openSocket(url, label) {
  // Cloudflare Workers also supports outbound WebSockets via fetch Upgrade.
  // Convert only the scheme; preserve the OTP query internally, never return/log it.
  const handshakeUrl = url.replace(/^wss:/i, "https:").replace(/^ws:/i, "http:");
  let response;
  try {
    response = await fetch(handshakeUrl, { headers: { Upgrade: "websocket" } });
  } catch (e) {
    throw new DerivError("websocket",
      `Network error opening the Deriv ${label} WebSocket: ${e?.message || "fetch failed"}`);
  }
  const socket = response.webSocket;
  if (!socket) {
    throw new DerivError("websocket",
      `Deriv ${label} WebSocket handshake failed (HTTP ${response.status}).`,
      { httpStatus: response.status });
  }
  socket.accept();
  return socket;
}

export async function openDemoSocket(env) {
  const account = await getDemoAccount(env);
  const otpBody = await derivRest(env, `/trading/v1/options/accounts/${encodeURIComponent(account.id)}/otp`, "POST");
  const wsUrl = otpBody?.data?.url;
  if (!wsUrl || !/^wss:\/\//.test(wsUrl)) throw new DerivError("otp", "Deriv did not return a valid WebSocket URL.");
  if (!wsUrl.includes("/ws/demo")) throw new DerivError("otp", "Refusing connection because Deriv did not return a demo WebSocket URL.");
  const ws = await openSocket(wsUrl, "demo");
  return { ws, account };
}

export async function openPublicSocket() {
  return openSocket("wss://api.derivws.com/trading/v1/options/ws/public", "public market data");
}

export function derivRequest(ws, payload, reqId, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const id = reqId ?? Math.floor(Math.random() * 1e9);
    const timer = setTimeout(() => { cleanup(); reject(new DerivError("request", `Deriv did not answer within ${timeoutMs} ms.`)); }, timeoutMs);
    const onMessage = evt => {
      let msg;
      try { msg = JSON.parse(typeof evt.data === "string" ? evt.data : ""); } catch { return; }
      if (msg.req_id !== id) return;
      cleanup();
      if (msg.error) reject(new DerivError("request", `Deriv error${msg.error.code ? " " + msg.error.code : ""}: ${msg.error.message || "request rejected"}`, { code:msg.error.code }));
      else resolve(msg);
    };
    const onClose = () => { cleanup(); reject(new DerivError("request", "Deriv closed the connection before replying.")); };
    function cleanup() {
      clearTimeout(timer);
      ws.removeEventListener("message", onMessage);
      ws.removeEventListener("close", onClose);
    }
    ws.addEventListener("message", onMessage);
    ws.addEventListener("close", onClose);
    try { ws.send(JSON.stringify({ ...payload, req_id:id })); }
    catch (e) { cleanup(); reject(new DerivError("request", `Could not send Deriv request: ${e?.message || "socket error"}`)); }
  });
}
