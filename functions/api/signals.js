import { DIGIT_MARKETS } from "../_lib/digit-markets.js";
import { evaluateDigitDiffers } from "../_lib/digit-strategy.js";

const APP_ID = "34QAdfWKVQBkld9sq3LRi";

function openDerivSocket() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
    const timer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error("Deriv market-data connection timed out")); }, 10000);
    ws.addEventListener("open", () => { clearTimeout(timer); resolve(ws); }, { once: true });
    ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("Could not connect to Deriv market data")); }, { once: true });
  });
}

function request(ws, payload, requestId) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeEventListener("message", onMessage);
      reject(new Error("Deriv market-data request timed out"));
    }, 8000);
    function onMessage(event) {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.req_id !== requestId) return;
      clearTimeout(timer);
      ws.removeEventListener("message", onMessage);
      if (message.error) reject(new Error(message.error.message || "Deriv request failed"));
      else resolve(message);
    }
    ws.addEventListener("message", onMessage);
    ws.send(JSON.stringify({ ...payload, req_id: requestId }));
  });
}

function quoteWithPipSize(price, pipSize) {
  const decimals = Number.isFinite(pipSize) && pipSize > 0
    ? Math.max(0, Math.min(10, Math.round(-Math.log10(pipSize))))
    : 2;
  return Number(price).toFixed(decimals);
}

export async function onRequestGet() {
  let ws;
  try {
    ws = await openDerivSocket();
    const symbols = await request(ws, { active_symbols: "brief", product_type: "basic" }, 1);
    const active = new Map((symbols.active_symbols || []).map(item => [item.symbol, item]));
    const results = [];

    for (let i = 0; i < DIGIT_MARKETS.length; i++) {
      const market = DIGIT_MARKETS[i];
      const meta = active.get(market.symbol);
      if (!meta) {
        results.push({ ...market, eligible: false, reason: "MARKET_NOT_AVAILABLE" });
        continue;
      }
      const history = await request(ws, {
        ticks_history: market.symbol,
        count: 100,
        end: "latest",
        style: "ticks"
      }, 100 + i);
      const pipSize = Number(meta.pip_size || meta.pip);
      const quotes = (history.history?.prices || []).map(price => quoteWithPipSize(price, pipSize));
      const signal = evaluateDigitDiffers(quotes, 100);
      results.push({ ...market, ...signal });
    }

    return Response.json({
      ok: true,
      mode: "signal-scan-only",
      scannedAt: new Date().toISOString(),
      strategy: "DIGITDIFF",
      marketsScanned: results.length,
      results
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({
      ok: false,
      mode: "signal-scan-only",
      message: error?.message || "Market scan failed"
    }, { status: 502, headers: { "cache-control": "no-store" } });
  } finally {
    try { ws?.close(); } catch {}
  }
}
