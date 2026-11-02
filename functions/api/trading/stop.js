import { authorized, json } from "../../_lib/trading-engine.js";
export async function onRequestPost({request,env}) {
  if(!authorized(request,env)) return json({ok:false,message:"Enter your Dogo.bot control PIN first."},401);
  if(!env.BOT_DB) return json({ok:false,message:"Trading database is not configured."},503);
  await env.BOT_DB.prepare("UPDATE cycle_state SET active=0,updated_at=? WHERE id=1").bind(new Date().toISOString()).run();
  return json({ok:true,active:false,message:"Demo trading stopped. Existing open contracts will still be tracked to settlement."});
}
