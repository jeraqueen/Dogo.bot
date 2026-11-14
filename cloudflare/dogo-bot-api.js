const previewAPI="https://api.derivws.com";
const previewAPP_ID="34XcNcUTAuV2B1KKEcQsu";
const previewJson=(data,status=200)=>Response.json(data,{status,headers:{"cache-control":"no-store"}});
const previewSleep=ms=>new Promise(r=>setTimeout(r,ms));
const previewIsRateLimit=e=>/429|rate.?limit/i.test(String(e?.message||""));
const previewNow=()=>new Date().toISOString();
const previewInitial=()=>({ok:true,active:false,mode:"DEMO",stake:1,cycleNumber:1,contractsOpened:0,wins:0,losses:0,grossProfit:0,netProfit:0,marketWins:{},transactions:[],signals:[],scannedAt:null,openContract:null,purchasePending:null,purchaseUncertain:false,lastError:null,events:[]});
function previewEvent(s,message,type="info",extra={}){s.events=[{at:previewNow(),message,type,...extra},...(s.events||[])].slice(0,80);}
async function previewRest(env,path,method="GET"){if(!env.DERIV_API_TOKEN)throw Error("Preview Worker is missing DERIV_API_TOKEN.");const r=await fetch(previewAPI+path,{method,headers:{Authorization:"Bearer "+env.DERIV_API_TOKEN,"Deriv-App-ID":previewAPP_ID,Accept:"application/json"}});const d=await r.json().catch(()=>({}));if(!r.ok){const e=d?.errors?.[0]||{};throw Error("Deriv REST "+r.status+" "+(e.code||"")+" "+(e.message||""));}return d;}
async function previewOpenSocket(url,label){const r=await fetch(url.replace(/^wss:/i,"https:"),{headers:{Upgrade:"websocket"}}),ws=r.webSocket;if(!ws)throw Error("Deriv "+label+" WebSocket HTTP "+r.status+": "+(await r.text().catch(()=>"")).slice(0,160));ws.accept();return ws;}
async function previewDemoSocket(env,accountId){if(!accountId){const b=await previewRest(env,"/trading/v1/options/accounts"),a=(b.data||[]).find(x=>(String(x.account_type||"").toLowerCase()==="demo"||x.is_virtual===true||String(x.account_id||x.loginid||"").startsWith("VRTC"))&&String(x.currency||"").toUpperCase()==="USD");if(!a)throw Error("Safety stop: no virtual USD demo account. No trade placed.");accountId=String(a.account_id||a.loginid||a.id);}const otp=await previewRest(env,"/trading/v1/options/accounts/"+encodeURIComponent(accountId)+"/otp","POST"),url=otp?.data?.url;if(!url||!url.includes("/ws/demo"))throw Error("Safety stop: Deriv did not return a demo-only WebSocket URL.");return{ws:await previewOpenSocket(url,"demo"),accountId};}
function previewAsk(ws,p,id,timeout=12000){return new Promise((resolve,reject)=>{let settled=false;const clean=()=>{clearTimeout(timer);ws.removeEventListener("message",msg);ws.removeEventListener("close",closed);ws.removeEventListener("error",failed);};const done=(fn,v)=>{if(settled)return;settled=true;clean();fn(v);};const timer=setTimeout(()=>done(reject,Error("Deriv request timed out; purchase state must be reconciled before another buy.")),timeout);const msg=e=>{let d;try{d=JSON.parse(e.data);}catch{return;}if(d.req_id!==id)return;d.error?done(reject,Error("Deriv "+(d.error.code||"error")+": "+d.error.message)):done(resolve,d);};const closed=()=>done(reject,Error("Deriv demo socket closed."));const failed=()=>done(reject,Error("Deriv demo socket error."));ws.addEventListener("message",msg);ws.addEventListener("close",closed);ws.addEventListener("error",failed);try{ws.send(JSON.stringify({...p,req_id:id}));}catch(e){done(reject,e);}});}
const previewDecimals=p=>{const n=Number(p);if(Number.isInteger(n)&&n>=0&&n<=10)return n;return Number.isFinite(n)&&n>0?Math.max(0,Math.min(10,Math.round(-Math.log10(n)))):2;};
function previewDistribution(prices,n,pip){const sample=prices.slice(-n);if(sample.length<n)return[];const counts=Array(10).fill(0);for(const price of sample){const fraction=Number(price).toFixed(previewDecimals(pip)).split(".")[1]||"",digit=fraction.slice(-1);if(!/^\d$/.test(digit))return[];counts[Number(digit)]++;}return counts.map((count,digit)=>({digit,count,percent:+(count/n*100).toFixed(2)})).sort((a,b)=>b.count-a.count||a.digit-b.digit);}
const previewIsVol=name=>/volatility\s*(10|25|50|75|100)(?:\s*\(1s\))?/i.test(String(name||""));
async function previewScanSignals(){const ws=await previewOpenSocket("wss://api.derivws.com/trading/v1/options/ws/public","public");try{let id=1,last=0;const send=async p=>{const wait=Math.max(0,350-(Date.now()-last));if(wait)await previewSleep(wait);last=Date.now();return previewAsk(ws,p,id++);};const a=await send({active_symbols:"brief"}),markets=(a.active_symbols||[]).filter(x=>previewIsVol(x.display_name||x.underlying_symbol_name||x.symbol)&&x.symbol).slice(0,18),found=[];for(const m of markets){try{const cf=await send({contracts_for:m.symbol});if(!(cf.contracts_for?.available||[]).some(x=>x.contract_type==="DIGITMATCH"))continue;const h=await send({ticks_history:m.symbol,count:100,end:"latest",style:"ticks"}),w={};for(const n of [100,50,25,10])w[n]=previewDistribution(h.history?.prices||[],n,Number(m.pip_size||m.pip));if(!w[100].length)continue;const top=w[100].slice(0,2).map(x=>({...x,qualifying:x.percent>=11.8||[100,50,25,10].filter(n=>(w[n]||[]).some(y=>y.digit===x.digit&&y.percent>=11.8)).length>=2}));for(const x of top.filter(x=>x.qualifying))found.push({symbol:m.symbol,name:m.display_name||m.underlying_symbol_name||m.symbol,digit:x.digit,percent:x.percent,windows:Object.fromEntries([100,50,25,10].map(n=>[n,(w[n]||[]).slice(0,2)]))});}catch(e){if(previewIsRateLimit(e))throw e;}}return found.sort((a,b)=>b.percent-a.percent);}finally{try{ws.close();}catch{}}}

const APP_ID="34XcNcUTAuV2B1KKEcQsu",API="https://api.derivws.com";
const ORIGINS=new Set(["https://dogo-bot.pages.dev","https://matches-auto-market-scanner.dogo-bot.pages.dev","https://a4532e1a.dogo-bot.pages.dev","https://f8a48a8b.dogo-bot.pages.dev","https://7236b4b1.dogo-bot.pages.dev","https://80b48f1c.dogo-bot.pages.dev"]);
const out=(d,s=200,h={})=>Response.json(d,{status:s,headers:{"cache-control":"no-store",...h}});
const eq=(a,b)=>{if(!a||typeof a!=="string"||typeof b!=="string"||a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0;};
async function rest(env,path,method="GET"){if(!env.DERIV_API_TOKEN)throw Error("Deriv API token is not configured.");const r=await fetch(API+path,{method,headers:{Authorization:"Bearer "+env.DERIV_API_TOKEN,"Deriv-App-ID":APP_ID,Accept:"application/json"}}),d=await r.json().catch(()=>({}));if(!r.ok){const e=d?.errors?.[0]||{};throw Error("Deriv REST "+r.status+" "+(e.code||"")+" "+(e.message||""));}return d;}
async function socket(url,label){const r=await fetch(url.replace(/^wss:/i,"https:"),{headers:{Upgrade:"websocket"}}),ws=r.webSocket;if(!ws)throw Error("Deriv "+label+" WebSocket HTTP "+r.status+": "+(await r.text().catch(()=>"")).slice(0,180));ws.accept();return ws;}
async function demoSocket(env){const b=await rest(env,"/trading/v1/options/accounts"),a=(b.data||[]).find(x=>(String(x.account_type||"").toLowerCase()==="demo"||x.is_virtual===true||String(x.account_id||x.loginid||"").startsWith("VRTC"))&&String(x.currency||"").toUpperCase()==="USD");if(!a)throw Error("Safety stop: no virtual USD demo account. No trade placed.");const id=String(a.account_id||a.loginid||a.id),otp=await rest(env,"/trading/v1/options/accounts/"+encodeURIComponent(id)+"/otp","POST"),url=otp?.data?.url;if(!url||!url.includes("/ws/demo"))throw Error("Safety stop: Deriv did not return a demo WebSocket URL.");return{ws:await socket(url,"demo")};}
function ask(ws,p,id){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{clean();reject(Error("Deriv request timed out."));},12000),msg=e=>{let d;try{d=JSON.parse(e.data);}catch{return;}if(d.req_id!==id)return;clean();d.error?reject(Error("Deriv "+(d.error.code||"error")+": "+d.error.message)):resolve(d);},close=()=>{clean();reject(Error("Deriv closed the socket."));};function clean(){clearTimeout(timer);ws.removeEventListener("message",msg);ws.removeEventListener("close",close);}ws.addEventListener("message",msg);ws.addEventListener("close",close);try{ws.send(JSON.stringify({...p,req_id:id}));}catch(e){clean();reject(e);}});}
const dec=p=>Number.isFinite(p)&&p>0?Math.max(0,Math.min(10,Math.round(-Math.log10(p)))):2;
function dist(prices,n,pip){const a=prices.slice(-n);if(a.length<n)return[];const c=Array(10).fill(0);for(const p of a){const f=Number(p).toFixed(dec(pip)).split(".")[1]||"",d=f.slice(-1);if(!/^\d$/.test(d))return[];c[Number(d)]++;}return c.map((count,digit)=>({digit,count,percent:+(count/n*100).toFixed(2)})).sort((a,b)=>b.count-a.count||a.digit-b.digit);}
const isVol=n=>/volatility\s*(10|15|20|25|30|50|75|90|100)/i.test(String(n||""));
async function scan(ws){
 let id=1;
 const a=await ask(ws,{active_symbols:"full"},id++);
 const items=(a.active_symbols||[]).filter(x=>isVol(x.display_name||x.underlying_symbol_name||x.symbol)&&/\(1s\)/i.test(x.display_name||x.underlying_symbol_name||"")&&x.symbol).slice(0,5),out=[];
 for(const m of items){
  try{
   const c=await ask(ws,{contracts_for:m.symbol},id++);
   if(!(c.contracts_for?.available||[]).some(x=>x.contract_type==="DIGITMATCH"))continue;
   await new Promise(r=>setTimeout(r,250));
   const h=await ask(ws,{ticks_history:m.symbol,count:100,end:"latest",style:"ticks"},id++),pip=Number(m.pip_size||m.pip),w={};
   for(const n of [100,50,25,10])w[n]=dist(h.history?.prices||[],n,pip);
   if(!w[100].length)continue;
   const top=w[100].slice(0,2).map(x=>({...x,ok:x.percent>=11.8||[100,50,25,10].filter(n=>(w[n]||[]).some(y=>y.digit===x.digit&&y.percent>=11.8)).length>=2}));
   const pick=top.filter(x=>x.ok).sort((x,y)=>y.percent-x.percent)[0];
   if(pick)out.push({symbol:m.symbol,name:m.display_name||m.underlying_symbol_name||m.symbol,digit:pick.digit,percent:pick.percent,windows:Object.fromEntries([100,50,25,10].map(n=>[n,(w[n]||[]).slice(0,2)]))});
  }catch(e){if(/429|ratelimit|rate limit/i.test(e.message))throw e;}
  await new Promise(r=>setTimeout(r,250));
 }
 return out.sort((a,b)=>b.percent-a.percent);
}
export class DogoTrader{
 constructor(ctx,env){this.ctx=ctx;this.env=env;this.busy=false;this.isPreview=ctx.id.equals(env.TRADER.idFromName("dogo-preview-main"));this.demoWs=null;this.previewTickListenerWs=null;this.previewPublicWs=null;this.previewDemoWs=null;this.previewReqId=1000;this.previewBuffers={};this.previewMeta={};this.previewMarkets=[];this.previewSubs={};this.previewFeedReady=false;this.previewTradeBusy=false;this.previewLastPersist=0;this.previewLastAttempt=0;}
 async get(){return await this.ctx.storage.get("state")||{active:false,mode:"DEMO",stake:1,cycleNumber:1,contractsOpened:0,wins:0,losses:0,grossProfit:0,netProfit:0,marketWins:{},transactions:[],signals:[],scannedAt:null,openContract:null,lastError:null};}
 async connection(){if(this.demoWs&&this.demoWs.readyState===1)return {ws:this.demoWs};const d=await demoSocket(this.env);this.demoWs=d.ws;return d;}
 closeConnection(){try{this.demoWs?.close();}catch{}this.demoWs=null;}

 async put(s){s.updatedAt=new Date().toISOString();await this.ctx.storage.put("state",s);}
 async previewGet(){return (await this.ctx.storage.get("state"))||previewInitial();}
 async previewPut(s){s.updatedAt=previewNow();await this.ctx.storage.put("state",s);}
 async previewConnection(){if(this.previewDemoWs&&this.previewDemoWs.readyState===1)return this.previewDemoWs;const d=await demoSocket(this.env);this.previewDemoWs=d.ws;return this.previewDemoWs;}
 previewCloseConnection(){try{this.previewDemoWs?.close();}catch{}this.previewDemoWs=null;this.previewTickListenerWs=null;this.previewPublicWs=null;this.previewFeedReady=false;}
 previewClosePublic(){this.previewPublicWs=null;this.previewFeedReady=false;}
 previewDecimals(pip){return Number.isFinite(pip)&&pip>0?Math.max(0,Math.min(10,Math.round(-Math.log10(pip)))):2;}
 previewDigitOf(quote,pip){const n=Number(quote);if(!Number.isFinite(n))return null;const f=n.toFixed(this.previewDecimals(pip)).split(".")[1]||"",d=f.slice(-1);return /^\d$/.test(d)?Number(d):null;}
 previewDistribution(items){const counts=Array(10).fill(0);for(const x of items)if(Number.isInteger(x.digit)&&x.digit>=0&&x.digit<=9)counts[x.digit]++;const total=items.length||1;return counts.map((count,digit)=>({digit,count,percent:+(count/total*100).toFixed(2)}));}
 previewCount(items,digit){return items.reduce((n,x)=>n+(x.digit===digit?1:0),0);}
 previewSnapshot(symbol,cursorDigit){
  const meta=this.previewMeta[symbol]||{symbol,name:symbol,pip:0.01},buf=this.previewBuffers[symbol]||[];
  const bars=this.previewDistribution(buf.slice(-100)),ranked=[...bars].sort((a,b)=>b.count-a.count||a.digit-b.digit),low=[...bars].sort((a,b)=>a.count-b.count||a.digit-b.digit);
  const green=ranked[0]||{digit:null,percent:0},red=low[0]||{digit:null,percent:0},last10=buf.slice(-10),prior10=buf.slice(-20,-10);
  const redNotRising=prior10.length===10&&this.previewCount(last10,red.digit)<=this.previewCount(prior10,red.digit);
  const separated=green.digit!==null&&red.digit!==null&&Math.abs(green.digit-red.digit)>=2;
  const qualifies=buf.length>=100&&green.percent>=11.8&&red.percent<=9&&separated&&redNotRising,windows={};
  for(const n of [100,50,25,10]){const rows=this.previewDistribution(buf.slice(-n)).sort((a,b)=>b.count-a.count||a.digit-b.digit);windows[n]=buf.length>=n?rows.slice(0,2):[];}
  return {symbol,name:meta.name,tickCount:buf.length,lastQuote:buf.length?buf[buf.length-1].quote:null,cursorDigit:cursorDigit===undefined?(buf.length?buf[buf.length-1].digit:null):cursorDigit,greenDigit:green.digit,greenPercent:green.percent,redDigit:red.digit,redPercent:red.percent,redNotRising,separated,qualifies,bars,windows,marketWins:0,updatedAt:previewNow()};
 }
 async previewPersistMarkets(force=false){
  if(!force&&Date.now()-this.previewLastPersist<900)return;this.previewLastPersist=Date.now();
  const s=await this.previewGet(),wins=s.marketWins||{};this.previewMarkets=this.previewMarkets.map(m=>({...m,marketWins:Number(wins[m.symbol]||0)}));
  await this.ctx.storage.put("liveMarkets",this.previewMarkets);
 }
 async previewFeedFailure(error){
  const s=await this.previewGet();if(!s.active)return;
  s.feedStatus="RECONNECTING";s.feedError=error?.message||"Live tick feed error";s.lastError=s.feedError;
  previewEvent(s,"Live feed: "+s.feedError,"error");await this.previewPut(s);await this.ctx.storage.setAlarm(Date.now()+5000);
 }
 async previewStartMarketFeed(){
  if(this.previewDemoWs&&this.previewDemoWs.readyState===1&&this.previewFeedReady)return;
  this.previewFeedReady=false;
  const ws=await this.previewConnection();
  this.previewPublicWs=ws;this.previewSubs={};this.previewBuffers={};this.previewMeta={};this.previewMarkets=[];
  if(this.previewTickListenerWs!==ws){this.previewTickListenerWs=ws;ws.addEventListener("message",e=>{this.previewHandleTick(e.data).catch(err=>this.previewFeedFailure(err));});ws.addEventListener("close",()=>{if(this.previewDemoWs===ws)this.previewDemoWs=null;if(this.previewPublicWs===ws){this.previewPublicWs=null;this.previewFeedReady=false;this.previewFeedFailure(Error("Deriv demo tick stream disconnected."));}this.previewTickListenerWs=null;});ws.addEventListener("error",()=>this.previewFeedFailure(Error("Deriv demo tick stream socket error.")));}
  // Use fixed Deriv 1-second Volatility symbols; no symbol-directory request is needed.
  const symbols=[
   {symbol:"1HZ10V",display_name:"Volatility 10 (1s) Index",pip_size:0.01},
   {symbol:"1HZ25V",display_name:"Volatility 25 (1s) Index",pip_size:0.01},
   {symbol:"1HZ50V",display_name:"Volatility 50 (1s) Index",pip_size:0.01},
   {symbol:"1HZ75V",display_name:"Volatility 75 (1s) Index",pip_size:0.01},
   {symbol:"1HZ100V",display_name:"Volatility 100 (1s) Index",pip_size:0.01}
  ];
  let failedMarkets=[];
  for(const m of symbols){
   const symbol=m.symbol,name=m.display_name,pip=Number(m.pip_size||0.01);
   this.previewMeta[symbol]={symbol,name,pip};
   try{
    const h=await ask(ws,{ticks_history:symbol,count:100,end:"latest",style:"ticks",subscribe:1},this.previewReqId++);
    const prices=h.history?.prices||[];
    this.previewBuffers[symbol]=prices.slice(-100).map(q=>({quote:String(q),digit:this.previewDigitOf(q,Number(h.pip_size||pip))})).filter(x=>x.digit!==null);
    if(h.subscription?.id)this.previewSubs[String(h.subscription.id)]=symbol;
    this.previewMarkets.push(this.previewSnapshot(symbol,null));
   }catch(err){failedMarkets.push(name+": "+(err?.message||"unavailable"));}
   await new Promise(r=>setTimeout(r,500));
  }
  if(!this.previewMarkets.length)throw Error("No 1-second Volatility market stream could be started. "+failedMarkets.join(" | "));
  if(failedMarkets.length){const state=await this.previewGet();previewEvent(state,"Some markets were unavailable: "+failedMarkets.join(" | "),"warning");await this.previewPut(state);}
  this.previewFeedReady=true;
  const s=await this.previewGet();s.feedStatus="LIVE";s.feedError=null;s.marketCount=this.previewMarkets.length;
  previewEvent(s,"Live tick stream connected · "+s.marketCount+" Volatility markets · no repeated history scans","success");
  await this.previewPut(s);await this.previewPersistMarkets(true);
 }
 async previewHandleTick(raw){
  let d;try{d=JSON.parse(typeof raw==="string"?raw:"");}catch{return;}
  if(d.msg_type!=="tick"||!d.tick)return;
  const t=d.tick,symbol=t.symbol||this.previewSubs[String(d.subscription?.id)]||d.echo_req?.ticks_history||"";
  const meta=this.previewMeta[symbol];if(!meta)return;
  const digit=this.previewDigitOf(t.quote,Number(t.pip_size||meta.pip));if(digit===null)return;
  const buf=this.previewBuffers[symbol]||[],before=this.previewSnapshot(symbol,buf.length?buf[buf.length-1].digit:null);
  buf.push({quote:String(t.quote),digit,epoch:t.epoch||null});if(buf.length>100)buf.shift();this.previewBuffers[symbol]=buf;
  const next=this.previewSnapshot(symbol,digit),idx=this.previewMarkets.findIndex(x=>x.symbol===symbol);
  if(idx>=0)this.previewMarkets[idx]=next;else this.previewMarkets.push(next);
  await this.previewPersistMarkets();
  if(before.qualifies&&digit===before.greenDigit){
   const s=await this.previewGet(),wins=s.marketWins||{};
   if(!s.currentMarket){const next=this.previewMarkets.find(m=>Number(wins[m.symbol]||0)<2);if(next){s.currentMarket=next.symbol;await this.previewPut(s);}}
   if(s.active&&s.currentMarket===symbol&&!s.openContract&&!s.purchasePending&&Number(s.marketWins?.[symbol]||0)<2){
    previewEvent(s,"GREEN CURSOR TOUCH · "+symbol+" · digit #"+digit+" · "+before.greenPercent+"% green / "+before.redPercent+"% red","success");
    await this.previewPut(s);this.previewTradeOnSignal(symbol,before).catch(e=>this.previewFeedFailure(e));
   }
  }
 }
 async previewTradeOnSignal(symbol,signal){
  if(this.previewTradeBusy||Date.now()-this.previewLastAttempt<1200)return;
  this.previewTradeBusy=true;this.previewLastAttempt=Date.now();
  try{
   let s=await this.previewGet();
   if(!s.active||s.openContract||s.purchasePending||Number(s.marketWins?.[symbol]||0)>=2||(s.currentMarket&&s.currentMarket!==symbol))return;
   s.currentMarket=symbol;await this.previewPut(s);
   const ws=await this.previewConnection();
   const proposal=await ask(ws,{proposal:1,amount:s.stake,basis:"stake",contract_type:"DIGITMATCH",currency:"USD",duration:1,duration_unit:"t",underlying_symbol:symbol,barrier:String(signal.greenDigit)},this.previewReqId++);
   const q=proposal.proposal;if(!q?.id||!Number.isFinite(Number(q.ask_price)))throw Error("Deriv did not return a valid one-tick DIGITMATCH proposal.");
   s=await this.previewGet();if(!s.active||s.openContract)return;
   s.purchasePending={phase:"READY",symbol,name:this.previewMeta[symbol]?.name||symbol,digit:signal.greenDigit,stake:s.stake,proposalId:q.id,startedAt:previewNow()};
   previewEvent(s,"MATCHES proposal accepted · "+symbol+" · green digit #"+signal.greenDigit+" · ask $"+Number(q.ask_price).toFixed(2),"info");await this.previewPut(s);
   s=await this.previewGet();if(!s.active){s.purchasePending=null;previewEvent(s,"Purchase cancelled because Stop was pressed before buy submission.","warning");await this.previewPut(s);return;}
   s.purchasePending.phase="SENT";s.purchasePending.sentAt=previewNow();await this.previewPut(s);
   let result;try{result=await ask(ws,{buy:q.id,price:Number(q.ask_price)},this.previewReqId++);}
   catch(e){s=await this.previewGet();s.active=false;s.purchaseUncertain=true;s.lastError="Buy response uncertain: "+e.message+" Bot paused to prevent a duplicate purchase.";previewEvent(s,s.lastError,"error");await this.previewPut(s);await this.ctx.storage.deleteAlarm();this.previewClosePublic();this.previewCloseConnection();return;}
   const bought=result.buy;if(!bought?.contract_id){s=await this.previewGet();s.active=false;s.purchaseUncertain=true;s.lastError="Deriv buy response did not contain a contract ID. Reconcile demo transactions before restarting.";previewEvent(s,s.lastError,"error");await this.previewPut(s);await this.ctx.storage.deleteAlarm();this.previewClosePublic();this.previewCloseConnection();return;}
   s=await this.previewGet();s.purchasePending=null;s.purchaseUncertain=false;s.contractsOpened++;
   s.openContract={contractId:String(bought.contract_id),symbol,name:this.previewMeta[symbol]?.name||symbol,digit:signal.greenDigit,stake:Number(bought.buy_price||s.stake),payout:Number(bought.payout||0),boughtAt:previewNow(),status:"OPEN",currentProfit:0};
   s.currentMarket=symbol;s.lastError=null;previewEvent(s,"DEMO PURCHASE CONFIRMED · DIGITMATCH #"+signal.greenDigit+" · "+symbol+" · contract "+bought.contract_id,"success",{contractId:String(bought.contract_id)});
   await this.previewPut(s);await this.ctx.storage.setAlarm(Date.now()+1200);
  }catch(e){
   const s=await this.previewGet();s.lastError=e?.message||"MATCHES entry failed";previewEvent(s,"MATCHES entry rejected · "+s.lastError,"error");
   if(/429|rate.?limit|too many requests/i.test(s.lastError))this.previewLastAttempt=Date.now()+15000;else this.previewLastAttempt=Date.now()+4000;
   await this.previewPut(s);
  }finally{this.previewTradeBusy=false;}
 }
 async previewFetch(req){
  const p=new URL(req.url).pathname;
  if(req.method==="GET"&&p==="/state"){const s=await this.previewGet();s.liveMarkets=this.previewMarkets.length?this.previewMarkets:((await this.ctx.storage.get("liveMarkets"))||[]);return previewJson(s);}
  if(req.method==="POST"&&p==="/start"){
   const b=await req.json().catch(()=>({})),stake=Number(b.stake),s=await this.previewGet();
   if(!Number.isFinite(stake)||stake<.35||stake>1000)return previewJson({ok:false,message:"Stake must be between $0.35 and $1,000."},400);
   if(s.purchasePending||s.purchaseUncertain)return previewJson({ok:false,message:"A previous purchase has an uncertain outcome. Reconcile it before restarting; no duplicate purchase will be attempted."},409);
   if(s.active&&this.previewPublicWs&&this.previewPublicWs.readyState===1&&this.previewFeedReady)return previewJson({ok:true,active:true,message:"Live digit stream is already running."});
   Object.assign(s,{ok:true,active:true,mode:"DEMO",stake:+stake.toFixed(2),lastError:null,feedStatus:"CONNECTING",feedError:null,marketWins:s.marketWins||{}});
   previewEvent(s,"Starting live digit monitor · green-touch MATCHES · demo only · stake $"+stake.toFixed(2),"info");await this.previewPut(s);
   try{await this.previewStartMarketFeed();await this.ctx.storage.setAlarm(Date.now()+30000);return previewJson({ok:true,active:true,message:"Live digit stream connected. The bot will open a one-tick MATCHES contract when the green cursor touches a qualifying digit."});}
   catch(e){const failed=await this.previewGet();failed.active=false;failed.feedStatus="ERROR";failed.feedError=e?.message||"Could not start live market feed";failed.lastError=failed.feedError;previewEvent(failed,"Live monitor failed: "+failed.feedError,"error");await this.previewPut(failed);this.previewClosePublic();return previewJson({ok:false,active:false,message:failed.feedError},502);}
  }
  if(req.method==="POST"&&p==="/stop"){
   const s=await this.previewGet();s.active=false;previewEvent(s,s.openContract?"Stop requested · no new purchases; current demo contract will settle.":"Live scanner and 

--- TRUNCATED ---
Response was ~9,132 tokens (limit: 6,000). Use more specific queries to reduce response size.