import { connectDeriv, derivRequest } from "../_lib/trading-engine.js";

export async function onRequestGet({ env }) {
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
  if (!env.DERIV_API_TOKEN) {
    return new Response(JSON.stringify({ ok:false, connected:false, message:"Deriv API token is missing from the Cloudflare Pages production secrets." }), {status:503,headers});
  }
  let ws;
  try {
    ws = await connectDeriv();
    const result = await derivRequest(ws, { authorize: env.DERIV_API_TOKEN }, 901);
    const account = result.authorize || {};
    const loginid = String(account.loginid || "");
    const virtual = account.is_virtual === true || account.is_virtual === 1 || loginid.startsWith("VRTC");
    const currency = String(account.currency || "").toUpperCase();
    return new Response(JSON.stringify({
      ok:true, connected:true, authenticated:true,
      accountMode: virtual ? "DEMO" : "LIVE",
      currency: currency || null,
      demoReady: virtual && currency === "USD",
      message: virtual && currency === "USD"
        ? "Deriv authenticated · virtual USD demo account."
        : "Deriv authenticated, but this token is not connected to a virtual USD demo account. Demo trading will be rejected."
    }), {status:200,headers});
  } catch (error) {
    return new Response(JSON.stringify({ok:false,connected:false,message:error?.message || "Deriv authentication failed. Check token validity and permissions."}), {status:502,headers});
  } finally { try { ws?.close(); } catch {} }
}
