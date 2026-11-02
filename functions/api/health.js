export async function onRequestGet() {
  return Response.json({ ok:true, service:"dogo-bot-pages-functions", deployed:true, checkedAt:new Date().toISOString() }, { headers:{ "cache-control":"no-store" } });
}
