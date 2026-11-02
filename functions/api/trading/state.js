import { authorized, json } from "../_lib/trading-engine.js";
export async function onRequestGet({request,env}) {
  if(!authorized(request,env)) return json({ok:false,message:"Enter your Dogo.bot control PIN."},401);
  if(!env.BOT_DB) return json({ok:false,message:"Trading database is not configured."},503);
  const cycle=await env.BOT_DB.prepare("SELECT cycle_number,active FROM cycle_state WHERE id=1").first();
  const markets=await env.BOT_DB.prepare("SELECT symbol,trades_placed,trades_completed,status FROM market_state ORDER BY symbol").all();
  const open=await env.BOT_DB.prepare("SELECT COUNT(*) AS n FROM trades WHERE status='OPEN'").first();
  return json({ok:true,active:!!cycle?.active,cycleNumber:Number(cycle?.cycle_number||1),markets:markets.results||[],openContracts:Number(open?.n||0)});
}
