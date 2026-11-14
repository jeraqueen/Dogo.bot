// Legacy Pages-side trading execution is intentionally retired.
// All purchases and settlement tracking now run in the private demo-only
// DogoTrader Durable Object. This module contains no contract purchase code.
export function json(data,status=200){return Response.json(data,{status,headers:{"cache-control":"no-store"}});}
export function authorized(request,env){
  const expected=env?.DOGO_CONTROL_PIN||"";
  const supplied=request.headers.get("x-dogo-pin")||"";
  if(!expected||supplied.length!==expected.length)return false;
  let diff=0;
  for(let i=0;i<expected.length;i++)diff|=expected.charCodeAt(i)^supplied.charCodeAt(i);
  return diff===0;
}
