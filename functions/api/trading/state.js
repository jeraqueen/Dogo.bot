const API="https://dogo-bot-api-preview.fx77.workers.dev";
export async function onRequestGet({request}) {
  const pin=request.headers.get("x-dogo-pin")||"";
  if(!pin) return Response.json({ok:false,message:"Enter your Dogo.bot control PIN."},{status:401});
  const upstream=await fetch(API+"/api/trading/state",{headers:{"x-dogo-pin":pin}});
  return new Response(await upstream.text(),{status:upstream.status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
}
