import { openPublicSocket, derivRequest } from "../_lib/deriv-connect.js";

const WINDOWS = [100, 50, 25, 10];
const MIN_PERCENT = 11.8;
const MAX_CANDIDATES = 30;

function quoteWithPipSize(price, pipSize) {
  const decimals = Number.isFinite(pipSize) && pipSize > 0
    ? Math.max(0, Math.min(10, Math.round(-Math.log10(pipSize)))) : 2;
  return Number(price).toFixed(decimals);
}
function lastDigit(quote) {
  const s = String(quote ?? "").trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(s)) return null;
  const fraction = s.split(".")[1] || "";
  const digit = (fraction || s.replace("-", "")).slice(-1);
  return /^\d$/.test(digit) ? Number(digit) : null;
}
function distribution(quotes, size) {
  const slice = quotes.slice(-size);
  if (slice.length < size) return null;
  const counts = Array(10).fill(0);
  for (const quote of slice) {
    const d = lastDigit(quote);
    if (d === null) return null;
    counts[d]++;
  }
  return counts.map((count, digit) => ({
    digit, count, percent: count / size * 100
  }));
}
function getSymbol(item) {
  return item.symbol || item.underlying_symbol || "";
}
function getName(item) {
  return item.display_name || item.underlying_symbol_name || item.symbol || item.underlying_symbol || "Volatility market";
}
function isVolatility(item) {
  return /volatility\s*(10|15|25|30|50|75|90|100)/i.test(getName(item));
}
function analyze(quotes, threshold) {
  const windows = {};
  for (const size of WINDOWS) windows[size] = distribution(quotes, size);
  if (!windows[100]) return { valid: false, reason: "INSUFFICIENT_TICKS", windows };
  const ranked = [...windows[100]].sort((a,b) => b.count-a.count || a.digit-b.digit);
  const predicted = ranked.slice(0,2).map((item, index) => ({
    ...item, rank: index + 1,
    qualifying: WINDOWS.some(size => (windows[size] || []).some(x => x.digit === item.digit && x.percent >= threshold))
  }));
  const qualified = predicted.filter(x => x.qualifying);
  return {
    valid: true,
    hasSignal: qualified.length > 0,
    topDigits: predicted,
    strongestDigit: qualified.sort((a,b) => b.percent-a.percent)[0]?.digit ?? null,
    windows: Object.fromEntries(WINDOWS.map(size => [
      size, (windows[size] || []).map(x => ({digit:x.digit,count:x.count,percent:Number(x.percent.toFixed(2))}))
    ])),
    threshold
  };
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const threshold = Number(url.searchParams.get("threshold") || MIN_PERCENT);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
    return Response.json({ok:false,message:"Frequency threshold must be between 0 and 100."},{status:400});
  }
  let ws;
  try {
    ws = await openPublicSocket();
    let reqId = 1;
    const activeResponse = await derivRequest(ws, {
      active_symbols: "brief"
    }, reqId++);
    const all = activeResponse.active_symbols || [];
    const candidates = all.filter(item => isVolatility(item) && getSymbol(item)).slice(0, MAX_CANDIDATES);
    const results = [];
    // Check a few symbols concurrently to avoid a long serial scan and to
    // keep the Deriv websocket request load bounded.
    for (let offset = 0; offset < candidates.length; offset += 4) {
      const batch = candidates.slice(offset, offset + 4);
      const checked = await Promise.all(batch.map(async item => {
        const symbol = getSymbol(item);
        const name = getName(item);
        try {
          const contractResp = await derivRequest(ws, { contracts_for: symbol }, reqId++);
          const available = contractResp.contracts_for?.available || [];
          if (!available.some(c => c.contract_type === "DIGITMATCH")) {
            return {name,symbol,active:true,matchAvailable:false,status:"MATCHES_NOT_OFFERED"};
          }
          const history = await derivRequest(ws, {
            ticks_history: symbol, count:100, end:"latest", style:"ticks"
          }, reqId++);
          const pip = Number(item.pip_size || item.pip);
          const quotes = (history.history?.prices || []).map(p => quoteWithPipSize(p,pip));
          const analysis = analyze(quotes,threshold);
          return {name,symbol,active:true,matchAvailable:true,status:analysis.hasSignal?"QUALIFYING":"WAITING_FOR_SIGNAL",...analysis};
        } catch (error) {
          return {name,symbol,active:true,matchAvailable:false,status:"CHECK_FAILED",reason:error?.message || "Deriv check failed"};
        }
      }));
      results.push(...checked);
    }
    return Response.json({
      ok:true, strategy:"DIGITMATCH", threshold, windows:WINDOWS,
      marketsDiscovered:all.filter(isVolatility).length,
      marketsChecked:results.length,
      validMarkets:results.filter(x=>x.matchAvailable).length,
      qualifyingMarkets:results.filter(x=>x.status==="QUALIFYING").length,
      scannedAt:new Date().toISOString(),results
    },{headers:{"cache-control":"no-store"}});
  } catch (error) {
    return Response.json({ok:false,message:error?.message || "Market scan failed",results:[]},{status:502,headers:{"cache-control":"no-store"}});
  } finally { try { ws?.close(); } catch {} }
}
