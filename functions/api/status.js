import { openDemoSocket, derivRequest, DerivError } from "../_lib/deriv-connect.js";

export async function onRequestGet({ env }) {
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
  if (!env.DERIV_API_TOKEN) {
    const missing = ["DERIV_API_TOKEN"];
    return new Response(JSON.stringify({ ok:false, connected:false, stage:"config",
      message:`Missing in Cloudflare Pages Production settings: ${missing.join(", ")}.` }), { status:503, headers });
  }
  let ws;
  try {
    const opened = await openDemoSocket(env);
    ws = opened.ws;
    await derivRequest(ws, { ping:1 }, 901);
    const currency = opened.account.currency;
    return new Response(JSON.stringify({ ok:true, connected:true, authenticated:true, accountMode:"DEMO",
      currency:currency || null, demoReady:currency === "USD",
      message:currency === "USD" ? "Deriv connected · virtual USD demo account." :
        "Deriv connected, but the demo account is not USD. Demo trading will be rejected."
    }), { status:200, headers });
  } catch (error) {
    const e = error instanceof DerivError ? error : null;
    return new Response(JSON.stringify({ ok:false, connected:false, stage:e?.stage || "unknown",
      httpStatus:e?.httpStatus ?? null, message:e?.message || "Deriv connection failed." }), { status:502, headers });
  } finally { try { ws?.close(); } catch {} }
}
