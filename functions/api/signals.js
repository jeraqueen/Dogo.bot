import { openPublicSocket, derivRequest } from "../_lib/deriv-connect.js";

const WINDOWS=[100,50,25,10], MIN_PERCENT=11.8, MAX_CANDIDATES=10;
const ACTIVE_SYMBOLS_TTL=15*60, CONTRACTS_TTL=6*60*60, REQUEST_GAP_MS=1200;

function quoteWithPipSize(price,pipSize){const decimals=Number.isFinite(pipSize)&&pipSize>0?Math.max(0,Math.min(10,Math.round(-Math.log10(pipSize)))):2;return Number(price).toFixed(decimals);}
function lastDigit(quote){const s=String(quote??"").trim();if(!/^-?\d+(?:\.\d+)?$/.test(s))return null;const fraction=s.split(".")[1]||"";const digit=(fraction||s.replace("-","")).slice(-1);return /^\d$/.test(digit)?Number(digit):null;}
function distribution(quotes,size){const sample=quotes.slice(-size);if(sample.length<size)return null;const counts=Array(10).fill(0);for(const quote of sample){const digit=lastDigit(quote);if(digit===null)return null;counts[digit]++;}return counts.map((count,digit)=>({digit,count,percent:Number((count/size*100).toFixed(2))})).sort((a,b)=>b.count-a.count||a.digit-b.digit);}
function getSymbol(item){return item.symbol||item.underlying_symbol||"";}
function getName(item){return item.display_name||item.underlying_symbol_name||item.symbol||item.underlying_symbol||"Volatility market";}
function isVolatility(item){return /volatility\s*(10|15|20|25|30|50|75|90|100)/i.test(getName(item));}
function analyze(quotes,threshold){const windows={};for(const size of WINDOWS)windows[size]=distribution(quotes,size);const windowLeaders={};for(const size of WINDOWS)windowLeaders[size]=(windows[size]||[]).slice(0,2).map((x,i)=>({...x,rank:i+1}));if(!windows[100])return{valid:false,reason:"INSUFFICIENT_TICKS",tickCount:quotes.length,requiredTicks:100,windowLeaders,windows:windowLeaders};const topDigits=windows[100].slice(0,2).map((item,index)=>{const qualifyingWindows=WINDOWS.filter(size=>(windows[size]||[]).some(x=>x.digit===item.digit&&x.percent>=threshold));return{...item,rank:index+1,qualifying:item.percent>=threshold||qualifyingWindows.length>=2,qualifyingWindows};});const qualifying=topDigits.filter(x=>x.qualifying);return{valid:true,hasSignal:qualifying.length>0,tickCount:quotes.length,mostAppearing:topDigits[0]?.digit??null,predictedDigits:qualifying.map(x=>x.digit),predictedDigit:qualifying[0]?.digit??null,topDigits,windowLeaders,windows:windowLeaders,threshold};}

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function cachedRequest(cacheKey,ttlSeconds,load){
  const cache=globalThis.caches?.default;
  const key=new Request("https://dogo-cache.invalid/deriv/"+cacheKey);
  if(cache){
    try{
      const hit=await cache.match(key);
      if(hit){const saved=await hit.json();if(saved?.cachedAt&&Date.now()-saved.cachedAt<ttlSeconds*1000)return saved.value;}
    }catch{}
  }
  const value=await load();
  if(cache){
    try{await cache.put(key,new Response(JSON.stringify({cachedAt:Date.now(),value}),{headers:{"content-type":"application/json","cache-control":"public, max-age="+ttlSeconds}}));}catch{}
  }
  return value;
}
function isRateLimit(error){return /ratelimit|rate.?limit|too many requests|\b429\b/i.test(String(error?.message||""));}
export async function onRequestGet({request}){
  const url=new URL(request.url),threshold=Number(url.searchParams.get("threshold")||MIN_PERCENT);
  if(!Number.isFinite(threshold)||threshold<MIN_PERCENT||threshold>100)return Response.json({ok:false,message:"Frequency threshold must be between 11.8 and 100."},{status:400});
  let ws;
  try{
    ws=await openPublicSocket();
    let reqId=1,lastRequestAt=0;
    const paced=async payload=>{
      const wait=Math.max(0,REQUEST_GAP_MS-(Date.now()-lastRequestAt));
      if(wait)await sleep(wait);
      lastRequestAt=Date.now();
      return derivRequest(ws,payload,reqId++);
    };
    const all=await cachedRequest("active-symbols-brief-v2",ACTIVE_SYMBOLS_TTL,async()=>{
      const response=await paced({active_symbols:"brief"});
      return response.active_symbols||[];
    });
    const candidates=all.filter(item=>isVolatility(item)&&getSymbol(item)).slice(0,MAX_CANDIDATES);
    const results=[];
    for(const item of candidates){
      const symbol=getSymbol(item),name=getName(item);
      try{
        const available=await cachedRequest("contracts-for-"+symbol,CONTRACTS_TTL,async()=>{
          const contracts=await paced({contracts_for:symbol});
          return contracts.contracts_for?.available||[];
        });
        if(!available.some(c=>c.contract_type==="DIGITMATCH")){
          results.push({name,symbol,active:true,matchAvailable:false,status:"MATCHES_NOT_OFFERED"});
          continue;
        }
        const history=await paced({ticks_history:symbol,count:100,end:"latest",style:"ticks"});
        const pip=Number(item.pip_size||item.pip),quotes=(history.history?.prices||[]).map(p=>quoteWithPipSize(p,pip)),analysis=analyze(quotes,threshold);
        results.push({name,symbol,active:true,matchAvailable:true,status:analysis.hasSignal?"QUALIFYING":"WAITING_FOR_SIGNAL",...analysis});
      }catch(error){
        if(isRateLimit(error))throw error;
        results.push({name,symbol,active:true,matchAvailable:false,status:"CHECK_FAILED",reason:error?.message||"Deriv check failed"});
      }
    }
    results.sort((a,b)=>Number(b.status==="QUALIFYING")-Number(a.status==="QUALIFYING")||Number(b.topDigits?.[0]?.percent||0)-Number(a.topDigits?.[0]?.percent||0));
    return Response.json({ok:true,strategy:"DIGITMATCH",threshold,windows:WINDOWS,marketsDiscovered:all.filter(isVolatility).length,marketsChecked:results.length,validMarkets:results.filter(x=>x.matchAvailable).length,qualifyingMarkets:results.filter(x=>x.status==="QUALIFYING").length,scannedAt:new Date().toISOString(),requestPolicy:{activeSymbolsCacheMinutes:15,contractsForCacheHours:6,minimumGapMs:REQUEST_GAP_MS,sequentialMarketChecks:true,maxMarkets:MAX_CANDIDATES,volatilityFamilies:[10,25,50,75,100],includeOneSecondVariants:true},results},{headers:{"cache-control":"no-store"}});
  }catch(error){
    const limited=isRateLimit(error);
    return Response.json({ok:false,message:limited?"Deriv rate limit reached. Scanning paused automatically; wait before starting again.":(error?.message||"Market scan failed"),rateLimited:limited,retryAfterSeconds:limited?60:undefined,results:[]},{status:limited?429:502,headers:{"cache-control":"no-store","retry-after":limited?"60":"0"}});
  }finally{try{ws?.close();}catch{}}
}
