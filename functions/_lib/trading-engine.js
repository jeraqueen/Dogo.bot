import { DIGIT_MARKETS } from "./digit-markets.js";
import { evaluateDigitDiffers, DIGIT_STRATEGY } from "./digit-strategy.js";

import { openDemoSocket } from "./deriv-connect.js";

export function json(data, status=200) {
  return Response.json(data, { status, headers: { "cache-control":"no-store" } });
}

export function authorized(request, env) {
  const expected = env.DOGO_CONTROL_PIN;
  const supplied = request.headers.get("x-dogo-pin") || "";
  if (!expected || supplied.length !== expected.length) return false;
  let diff = 0;
  for (let i=0; i<expected.length; i++) diff |= expected.charCodeAt(i) ^ supplied.charCodeAt(i);
  return diff === 0;
}

export async function connectDeriv(env) {
  // The returned socket is authenticated by Deriv's one-time-password flow.
  return await openDemoSocket(env);
}

export function derivRequest(ws,payload,reqId) {
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{ws.removeEventListener("message",onMessage);reject(new Error("Deriv request timed out"));},10000);
    function onMessage(event){
      let m; try{m=JSON.parse(event.data);}catch{return;}
      if(m.req_id!==reqId)return;
      clearTimeout(timer); ws.removeEventListener("message",onMessage);
      if(m.error) reject(new Error(m.error.message||"Deriv API request failed")); else resolve(m);
    }
    ws.addEventListener("message",onMessage);
    ws.send(JSON.stringify({...payload,req_id:reqId}));
  });
}

export async function authorizeDemo(ws, token) {
  if(!token) throw new Error("Deriv API token is missing from Cloudflare Pages secrets");
  const r=await derivRequest(ws,{authorize:token},1);
  const a=r.authorize||{};
  const loginid=String(a.loginid||"");
  if(a.is_virtual!==true && !loginid.startsWith("VRTC")) {
    throw new Error("Safety stop: the connected Deriv account is not verified as a demo account. No order was placed.");
  }
  if(String(a.currency||"").toUpperCase()!=="USD") {
    throw new Error("Safety stop: the authenticated demo account is not in USD. No order was placed.");
  }
  return {loginid,currency:a.currency,isVirtual:true,balance:a.balance};
}

export function quoteWithPipSize(price,pipSize) {
  const decimals=Number.isFinite(pipSize)&&pipSize>0?Math.max(0,Math.min(10,Math.round(-Math.log10(pipSize)))):2;
  return Number(price).toFixed(decimals);
}

export async function readSignal(ws,symbol,reqId) {
  const metaResp=await derivRequest(ws,{active_symbols:"brief",product_type:"basic"},reqId);
  const meta=(metaResp.active_symbols||[]).find(x=>x.symbol===symbol);
  if(!meta) return {eligible:false,reason:"MARKET_NOT_AVAILABLE"};
  const history=await derivRequest(ws,{ticks_history:symbol,count:DIGIT_STRATEGY.sampleSize,end:"latest",style:"ticks"},reqId+1);
  const quotes=(history.history?.prices||[]).map(p=>quoteWithPipSize(p,Number(meta.pip_size||meta.pip)));
  return evaluateDigitDiffers(quotes,DIGIT_STRATEGY.sampleSize);
}

export async function buyDiffers(ws,symbol,signal,reqId) {
  const proposal=await derivRequest(ws,{
    proposal:1,amount:DIGIT_STRATEGY.stake,basis:"stake",contract_type:"DIGITDIFF",
    currency:"USD",duration:1,duration_unit:"t",symbol,barrier:String(signal.predictedDigit)
  },reqId);
  const p=proposal.proposal;
  if(!p?.id) throw new Error("Deriv did not return a valid DIGITDIFF proposal");
  const bought=await derivRequest(ws,{buy:p.id,price:DIGIT_STRATEGY.stake},reqId+1);
  const b=bought.buy;
  if(!b?.contract_id) throw new Error("Deriv did not confirm the contract purchase");
  return {contractId:String(b.contract_id),buyPrice:Number(b.buy_price||DIGIT_STRATEGY.stake),transactionId:b.transaction_id||null};
}

export async function contractStatus(ws,contractId,reqId) {
  const r=await derivRequest(ws,{proposal_open_contract:1,contract_id:Number(contractId)},reqId);
  return r.proposal_open_contract||null;
}

export { DIGIT_MARKETS, DIGIT_STRATEGY };
