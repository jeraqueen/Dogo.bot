const API="https://dogo-bot-api.fx77.workers.dev";
export async function onRequestPost({request}) {
 const pin=request.headers.get("x-dogo-pin")||"";
 if(!pin)return Response.json({ok:false,message:"Enter your Dogo.bot control PIN."},{status:401});
 const upstream=await fetch(API+"/api/trading/stop",{method:"POST",headers:{"x-dogo-pin":pin,"accept":"application/json"}});
 return new Response(await upstream.text(),{status:upstream.status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
}
