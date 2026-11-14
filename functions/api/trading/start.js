const API="https://dogo-bot-api.fx77.workers.dev";
export async function onRequestPost({request}) {
  const pin=request.headers.get("x-dogo-pin")||"";
  if(!pin) return Response.json({ok:false,message:"Enter your Dogo.bot control PIN."},{status:401});
  const body=await request.json().catch(()=>({}));
  const upstream=await fetch(API+"/api/trading/start",{method:"POST",headers:{"content-type":"application/json","x-dogo-pin":pin},body:JSON.stringify({stake:body.stake})});
  return new Response(await upstream.text(),{status:upstream.status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
}
