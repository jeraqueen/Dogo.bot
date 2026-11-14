import { authorized, json } from "../../_lib/trading-engine.js";
export async function onRequestPost({request}) {
  if (!authorized(request, {DOGO_CONTROL_PIN: request.headers.get("x-dogo-pin")})) {
    return json({ok:false,message:"Trading is not enabled in this Matches scanner preview."},403);
  }
  return json({ok:false,active:false,message:"Automatic trading is disabled in this preview. No contract purchase was attempted."},409);
}
