import { authorized, connectDeriv, derivRequest, json } from "../_lib/trading-engine.js";

export async function onRequestPost({ request, env }) {
  if (!authorized(request, env)) return json({ok:false,message:"Enter your Dogo.bot control PIN first."},401);
  if (!env.BOT_DB) return json({ok:false,message:"Trading database binding is not ready. Deploy the latest Pages configuration."},503);
  let ws;
  try {
    ws=await connectDeriv();
    const auth=await derivRequest(ws,{authorize:env.DERIV_API_TOKEN},1);
    const account=auth.authorize||{};
    const loginid=String(account.loginid||"");
    if(account.is_virtual!==true && !loginid.startsWith("VRTC")) {
      return json({ok:false,message:"Safety stop: this Deriv token authenticated to a non-demo account. No trades were placed."},403);
    }
    if(String(account.currency||"").toUpperCase()!=="USD") {
      return json({ok:false,message:"Safety stop: the authenticated demo account is not USD. No trades were placed."},403);
    }
    await env.BOT_DB.prepare("INSERT OR IGNORE INTO market_state (symbol) VALUES (?)").bind("R_10").run();
    const { DIGIT_MARKETS } = await import("../_lib/digit-markets.js");
    for(const market of DIGIT_MARKETS) {
      await env.BOT_DB.prepare("INSERT OR IGNORE INTO market_state (symbol) VALUES (?)").bind(market.symbol).run();
    }
    await env.BOT_DB.prepare("UPDATE cycle_state SET active=1, updated_at=? WHERE id=1").bind(new Date().toISOString()).run();
    return json({ok:true,active:true,mode:"DEMO",currency:"USD",stake:3.5,markets:10,tradesPerMarket:4,message:"Demo trading armed. The engine will buy only qualifying DIGITDIFF signals."});
  } catch(error) {
    return json({ok:false,message:error?.message||"Could not verify the Deriv demo account."},502);
  } finally { try{ws?.close();}catch{} }
}
