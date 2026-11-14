export async function onRequestGet() {
  try {
    const r = await fetch("https://dogo-bot-api-preview.fx77.workers.dev/api/status", {headers:{accept:"application/json","cache-control":"no-store"}});
    const data = await r.json().catch(()=>({}));
    return Response.json(data,{status:r.status,headers:{"cache-control":"no-store"}});
  } catch(e) {
    return Response.json({ok:false,connected:false,error:"Could not reach the private Deriv connector.",detail:e?.message||"Network error"},{status:502});
  }
}