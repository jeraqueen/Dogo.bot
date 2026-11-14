const API="https://api.derivws.com";
const APP_ID="34XcNcUTAuV2B1KKEcQsu";
const json=(data,status=200)=>Response.json(data,{status,headers:{"cache-control":"no-store"}});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const isRateLimit=e=>/429|rate.?limit/i.test(String(e?.message||""));
const now=()=>new Date().toISOString();
const initial=()=>({ok:true,active:false,mode:"DEMO",stake:1,cycleNumber:1,contractsOpened:0,wins:0,losses:0,grossProfit:0,netProfit:0,marketWins:{},transactions:[],signals:[],scannedAt:null,openContract:null,purchasePending:null,purchaseUncertain:false,lastError:null,events:[]});
function event(s,message,type="info",extra={}){s.events=[{at:now(),message,type,...extra},...(s.events||[])].slice(0,80);}
async function rest(env,path,method="GET"){if(!env.DERIV_API_TOKEN)throw Error("Preview Worker is missing DERIV_API_TOKEN.");const r=await fetch(API+path,{method,headers:{Authorization:"Bearer "+env.DERIV_API_TOKEN,"Deriv-App-ID":APP_ID,Accept:"application/json"}});const d=await r.json().catch(()=>({}));if(!r.ok){const e=d?.errors?.[0]||{};throw Error("Deriv REST "+r.status+" "+(e.code||"")+" "+(e.message||""));}return d;}
async function openSocket(url,label){const r=await fetch(url.replace(/^wss:/i,"https:"),{headers:{Upgrade:"websocket"}}),ws=r.webSocket;if(!ws)throw Error("Deriv "+label+" WebSocket HTTP "+r.status+": "+(await r.text().catch(()=>"")).slice(0,160));ws.accept();return ws;}
async function demoSocket(env,accountId){if(!accountId){const b=await rest(env,"/trading/v1/options/accounts"),a=(b.data||[]).find(x=>(String(x.account_type||"").toLowerCase()==="demo"||x.is_virtual===true||String(x.account_id||x.loginid||"").startsWith("VRTC"))&&String(x.currency||"").toUpperCase()==="USD");if(!a)throw Error("Safety stop: no virtual USD demo account. No trade placed.");accountId=String(a.account_id||a.loginid||a.id);}const otp=await rest(env,"/trading/v1/options/accounts/"+encodeURIComponent(accountId)+"/otp","POST"),url=otp?.data?.url;if(!url||!url.includes("/ws/demo"))throw Error("Safety stop: Deriv did not return a demo-only WebSocket URL.");return{ws:await openSocket(url,"demo"),accountId};}
function ask(ws,p,id,timeout=12000){return new Promise((resolve,reject)=>{let settled=false;const clean=()=>{clearTimeout(timer);ws.removeEventListener("message",msg);ws.removeEventListener("close",closed);ws.removeEventListener("error",failed);};const done=(fn,v)=>{if(settled)return;settled=true;clean();fn(v);};const timer=setTimeout(()=>done(reject,Error("Deriv request timed out; purchase state must be reconciled before another buy.")),timeout);const msg=e=>{let d;try{d=JSON.parse(e.data);}catch{return;}if(d.req_id!==id)return;d.error?done(reject,Error("Deriv "+(d.error.code||"error")+": "+d.error.message)):done(resolve,d);};const closed=()=>done(reject,Error("Deriv demo socket closed."));const failed=()=>done(reject,Error("Deriv demo socket error."));ws.addEventListener("message",msg);ws.addEventListener("close",closed);ws.addEventListener("error",failed);try{ws.send(JSON.stringify({...p,req_id:id}));}catch(e){done(reject,e);}});}
const decimals=p=>Number.isFinite(p)&&p>0?Math.max(0,Math.min(10,Math.round(-Math.log10(p)))):2;
function distribution(prices,n,pip){const sample=prices.slice(-n);if(sample.length<n)return[];const counts=Array(10).fill(0);for(const price of sample){const fraction=Number(price).toFixed(decimals(pip)).split(".")[1]||"",digit=fraction.slice(-1);if(!/^\d$/.test(digit))return[];counts[Number(digit)]++;}return counts.map((count,digit)=>({digit,count,percent:+(count/n*100).toFixed(2)})).sort((a,b)=>b.count-a.count||a.digit-b.digit);}
const family=name=>String(name||"").match(/volatility\s*(10|25|50|75|100)/i)?.[1]||"";
const isVol=name=>!!family(name);
async function scanSignals(){
 const ws=await openSocket("wss://api.derivws.com/trading/v1/options/ws/public","public");
 try{
  let id=1,last=0;
  const send=async p=>{const wait=Math.max(0,10000-(Date.now()-last));if(wait)await sleep(wait);last=Date.now();return ask(ws,p,id++);};
  const a=await send({active_symbols:"brief"});
  const markets=(a.active_symbols||[])
   .filter(x=>isVol(x.display_name||x.underlying_symbol_name||x.symbol)&&x.symbol)
   .sort((x,y)=>Number(String(y.display_name||y.underlying_symbol_name||y.symbol).toLowerCase().includes("(1s)"))-Number(String(x.display_name||x.underlying_symbol_name||x.symbol).toLowerCase().includes("(1s)")))
   .filter((m,i,arr)=>arr.findIndex(x=>family(x.display_name||x.underlying_symbol_name||x.symbol)===family(m.display_name||m.underlying_symbol_name||m.symbol))===i)
   .slice(0,5),found=[];
  for(const m of markets){
   try{
    const h=await send({ticks_history:m.symbol,count:100,end:"latest",style:"ticks"}),w={};
    for(const n of [100,50,25,10])w[n]=distribution(h.history?.prices||[],n,Number(m.pip_size||m.pip));
    if(!w[100].length)continue;
    const top=w[100].slice(0,2).map(x=>({...x,qualifying:x.percent>=11.8||[100,50,25,10].filter(n=>(w[n]||[]).some(y=>y.digit===x.digit&&y.percent>=11.8)).length>=2}));
    for(const x of top.filter(x=>x.qualifying))found.push({symbol:m.symbol,name:m.display_name||m.underlying_symbol_name||m.symbol,digit:x.digit,percent:x.percent,windows:Object.fromEntries([100,50,25,10].map(n=>[n,(w[n]||[]).slice(0,2)]))});
   }catch(e){if(isRateLimit(e))throw e;}
  }
  return found.sort((a,b)=>b.percent-a.percent);
 }finally{try{ws.close();}catch{}}
}
export class DogoTrader{
 constructor(ctx,env){
  this.ctx=ctx;this.env=env;this.busy=false;this.tradeBusy=false;this.demoWs=null;this.publicWs=null;
  this.reqId=1000;this.feedReady=false;this.liveBuffers={};this.marketMeta={};this.liveMarkets=[];
  this.subscriptionSymbols={};this.lastPersistAt=0;this.lastAttemptAt=0;
 }
 async get(){return (await this.ctx.storage.get("state"))||initial();}
 async put(s){s.updatedAt=now();await this.ctx.storage.put("state",s);}
 async connection(){
  if(this.demoWs&&this.demoWs.readyState===1)return this.demoWs;
  const saved=await this.ctx.storage.get("demoAccountId"),d=await demoSocket(this.env,saved);
  this.demoWs=d.ws;await this.ctx.storage.put("demoAccountId",d.accountId);return this.demoWs;
 }
 closeDemo(){try{this.demoWs?.close();}catch{}this.demoWs=null;}
 closePublic(){try{this.publicWs?.close();}catch{}this.publicWs=null;this.feedReady=false;}
 async startMarketFeed(){
  if(this.publicWs&&this.publicWs.readyState===1&&this.feedReady)return;
  if(this.publicWs)this.closePublic();
  this.feedReady=false;
  const ws=await openSocket("wss://api.derivws.com/trading/v1/options/ws/public","public live tick stream");
  this.publicWs=ws;this.subscriptionSymbols={};this.liveBuffers={};this.marketMeta={};this.liveMarkets=[];
  ws.addEventListener("message",e=>{this.handleMarketMessage(e.data).catch(err=>this.feedFailure(err));});
  ws.addEventListener("close",()=>{if(this.publicWs===ws){this.publicWs=null;this.feedReady=false;this.feedFailure(new Error("Deriv live tick stream disconnected."));}});
  ws.addEventListener("error",()=>{this.feedFailure(new Error("Deriv live tick stream reported a socket error."));});
  const active=await ask(ws,{active_symbols:"brief"},this.reqId++);
  const family=n=>String(n||"").match(/volatility\s*(10|25|50|75|100)/i)?.[1]||"";
  const nameOf=x=>x.display_name||x.underlying_symbol_name||x.symbol||x.underlying_symbol||"Volatility market";
  const symbols=(active.active_symbols||[])
   .filter(x=>family(nameOf(x))&&(x.symbol||x.underlying_symbol))
   .sort((a,b)=>Number(String(nameOf(b)).toLowerCase().includes("(1s)"))-Number(String(nameOf(a)).toLowerCase().includes("(1s)")))
   .filter((x,i,a)=>a.findIndex(y=>family(nameOf(y))===family(nameOf(x)))===i).slice(0,5);
  if(!symbols.length)throw new Error("Deriv returned no supported Volatility 10/25/50/75/100 markets.");
  for(const m of symbols){
   const symbol=m.symbol||m.underlying_symbol,name=nameOf(m),pip=Number(m.pip_size||m.pip||0.01);
   this.marketMeta[symbol]={symbol,name,pip};
   const h=await ask(ws,{ticks_history:symbol,count:100,end:"latest",style:"ticks",subscribe:1},this.reqId++);
   const prices=h.history?.prices||[];
   this.liveBuffers[symbol]=prices.slice(-100).map(q=>({quote:String(q),digit:this.digitOf(q,pip)})).filter(x=>x.digit!==null);
   if(h.subscription?.id)this.subscriptionSymbols[String(h.subscription.id)]=symbol;
   this.liveMarkets.push(this.snapshot(symbol,null));
   await sleep(350);
  }
  this.feedReady=true;
  const s=await this.get();s.feedStatus="LIVE";s.feedError=null;s.marketCount=symbols.length;
  event(s,"Live tick stream connected · "+symbols.length+" Volatility markets · one subscription per market","success");
  await this.put(s);await this.persistMarkets(true);
 }
 decimals(pip){return Number.isFinite(pip)&&pip>0?Math.max(0,Math.min(10,Math.round(-Math.log10(pip)))):2;}
 digitOf(quote,pip){
  const n=Number(quote);if(!Number.isFinite(n))return null;
  const f=n.toFixed(this.decimals(pip)).split(".")[1]||"";
  const d=f.slice(-1);return /^\d$/.test(d)?Number(d):null;
 }
 countDigit(items,digit){return items.reduce((n,x)=>n+(x.digit===digit?1:0),0);}
 distribution(items){
  const counts=Array(10).fill(0);
  for(const x of items)if(Number.isInteger(x.digit)&&x.digit>=0&&x.digit<=9)counts[x.digit]++;
  const total=items.length||1;
  return counts.map((count,digit)=>({digit,count,percent:+(count/total*100).toFixed(2)}));
 }
 snapshot(symbol,cursorDigit){
  const meta=this.marketMeta[symbol]||{symbol,name:symbol,pip:0.01},buf=this.liveBuffers[symbol]||[];
  const d100=this.distribution(buf.slice(-100)),ranked=[...d100].sort((a,b)=>b.count-a.count||a.digit-b.digit);
  const low=[...d100].sort((a,b)=>a.count-b.count||a.digit-b.digit);
  const green=ranked[0]||{digit:null,percent:0},red=low[0]||{digit:null,percent:0};
  const last10=buf.slice(-10),prior10=buf.slice(-20,-10);
  const redNotRising=prior10.length===10&&this.countDigit(last10,red.digit)<=this.countDigit(prior10,red.digit);
  const separated=green.digit!==null&&red.digit!==null&&Math.abs(green.digit-red.digit)>=2;
  const qualifies=buf.length>=100&&green.percent>=11.8&&red.percent<=9&&separated&&redNotRising;
  const windows={};
  for(const n of [100,50,25,10]){
   const rows=this.distribution(buf.slice(-n)).sort((a,b)=>b.count-a.count||a.digit-b.digit);
   windows[n]=buf.length>=n?rows.slice(0,2):[];
  }
  return {symbol,name:meta.name,tickCount:buf.length,lastQuote:buf.length?buf[buf.length-1].quote:null,
   cursorDigit:cursorDigit===undefined?(buf.length?buf[buf.length-1].digit:null):cursorDigit,
   greenDigit:green.digit,greenPercent:green.percent,redDigit:red.digit,redPercent:red.percent,
   redNotRising,separated,qualifies,bars:d100,windows,marketWins:0,updatedAt:now()};
 }
 async persistMarkets(force=false){
  if(!force&&Date.now()-this.lastPersistAt<900)return;
  this.lastPersistAt=Date.now();
  const s=await this.get(),wins=s.marketWins||{};
  this.liveMarkets=this.liveMarkets.map(m=>({...m,marketWins:Number(wins[m.symbol]||0)}));
  await this.ctx.storage.put("liveMarkets",this.liveMarkets);
 }
 async feedFailure(error){
  const s=await this.get();s.feedStatus="RECONNECTING";s.feedError=error?.message||"Live feed error";
  s.lastError=s.feedError;event(s,"Live feed: "+s.feedError,"error");await this.put(s);
  if(s.active)await this.ctx.storage.setAlarm(Date.now()+5000);
 }
 async handleMarketMessage(raw){
  let d;try{d=JSON.parse(typeof raw==="string"?raw:"");}catch{return;}
  if(d.msg_type!=="tick"||!d.tick)return;
  const t=d.tick,symbol=t.symbol||this.subscriptionSymbols[String(d.subscription?.id)]||"";
  const meta=this.marketMeta[symbol];if(!meta)return;
  const digit=this.digitOf(t.quote,Number(t.pip_size||meta.pip));if(digit===null)return;
  const buf=this.liveBuffers[symbol]||[],before=this.snapshot(symbol,buf.length?buf[buf.length-1].digit:null);
  buf.push({quote:String(t.quote),digit,epoch:t.epoch||null});if(buf.length>100)buf.shift();this.liveBuffers[symbol]=buf;
  const next=this.snapshot(symbol,digit),idx=this.liveMarkets.findIndex(x=>x.symbol===symbol);
  if(idx>=0)this.liveMarkets[idx]=next;else this.liveMarkets.push(next);
  await this.persistMarkets();
  if(before.qualifies&&digit===before.greenDigit){
   const s=await this.get();
   if(s.active&&!s.openContract&&!s.purchasePending&&Number(s.marketWins?.[symbol]||0)<2){
    event(s,"GREEN CURSOR TOUCH · "+symbol+" · digit #"+digit+" · "+before.greenPercent+"% green / "+before.redPercent+"% red","success");
    await this.put(s);this.tradeOnSignal(symbol,before).catch(e=>this.feedFailure(e));
   }
  }
 }
 async tradeOnSignal(symbol,signal){
  if(this.tradeBusy||Date.now()-this.lastAttemptAt<1200)return;
  this.tradeBusy=true;this.lastAttemptAt=Date.now();
  try{
   let s=await this.get();
   if(!s.active||s.openContract||s.purchasePending||Number(s.marketWins?.[symbol]||0)>=2)return;
   const symbols=this.liveMarkets.map(x=>x.symbol),wins=s.marketWins||{};
   if(symbols.length&&symbols.every(x=>Number(wins[x]||0)>=2)){
    s.marketWins={};s.cycleNumber=(s.cycleNumber||1)+1;
    event(s,"Every monitored market reached two settled wins · rotation cycle "+s.cycleNumber+" restarted","info");
    await this.put(s);
   }
   const ws=await this.connection(),id1=this.reqId++;
   const proposal=await ask(ws,{proposal:1,amount:s.stake,basis:"stake",contract_type:"DIGITMATCH",currency:"USD",duration:1,duration_unit:"t",underlying_symbol:symbol,barrier:String(signal.greenDigit)},id1);
   const q=proposal.proposal;
   if(!q?.id||!Number.isFinite(Number(q.ask_price)))throw new Error("Deriv did not return a valid one-tick DIGITMATCH proposal.");
   s=await this.get();if(!s.active||s.openContract){return;}
   s.purchasePending={phase:"READY",symbol,name:this.marketMeta[symbol]?.name||symbol,digit:signal.greenDigit,stake:s.stake,proposalId:q.id,startedAt:now()};
   event(s,"MATCHES proposal accepted · "+symbol+" · green digit #"+signal.greenDigit+" · ask $"+Number(q.ask_price).toFixed(2),"info");
   await this.put(s);
   s=await this.get();if(!s.active){s.purchasePending=null;event(s,"Purchase cancelled because Stop was pressed before buy submission.","warning");await this.put(s);return;}
   s.purchasePending.phase="SENT";s.purchasePending.sentAt=now();await this.put(s);
   let response;
   try{response=await ask(ws,{buy:q.id,price:Number(q.ask_price)},this.reqId++);}
   catch(e){s=await this.get();s.active=false;s.purchaseUncertain=true;s.lastError="Buy response uncertain: "+e.message+" Bot paused to prevent a duplicate purchase.";event(s,s.lastError,"error");await this.put(s);await this.ctx.storage.deleteAlarm();this.closePublic();this.closeDemo();return;}
   const bought=response.buy;
   if(!bought?.contract_id){s=await this.get();s.active=false;s.purchaseUncertain=true;s.lastError="Deriv buy response did not contain a contract ID. Reconcile demo transactions before restarting.";event(s,s.lastError,"error");await this.put(s);await this.ctx.storage.deleteAlarm();this.closePublic();this.closeDemo();return;}
   s=await this.get();s.purchasePending=null;s.purchaseUncertain=false;s.contractsOpened++;
   s.openContract={contractId:String(bought.contract_id),symbol,name:this.marketMeta[symbol]?.name||symbol,digit:signal.greenDigit,stake:Number(bought.buy_price||s.stake),payout:Number(bought.payout||0),boughtAt:now(),status:"OPEN",currentProfit:0};
   s.currentMarket=symbol;s.lastError=null;
   event(s,"DEMO PURCHASE CONFIRMED · DIGITMATCH #"+signal.greenDigit+" · "+symbol+" · contract "+bought.contract_id,"success",{contractId:String(bought.contract_id)});
   await this.put(s);await this.ctx.storage.setAlarm(Date.now()+1200);
  }catch(e){
   const s=await this.get();s.lastError=e?.message||"Trade attempt failed";event(s,"MATCHES entry rejected · "+s.lastError,"error");
   if(/429|rate.?limit|too many requests/i.test(s.lastError)){s.backoffMs=Math.min(Math.max(Number(s.backoffMs||15000)*2,30000),300000);this.lastAttemptAt=Date.now()+15000;}else this.lastAttemptAt=Date.now()+4000;
   await this.put(s);
  }finally{this.tradeBusy=false;}
 }
 async fetch(req){
  const p=new URL(req.url).pathname;
  if(req.method==="GET"&&p==="/state"){
   const s=await this.get();s.liveMarkets=this.liveMarkets.length?this.liveMarkets:((await this.ctx.storage.get("liveMarkets"))||[]);
   return json(s);
  }
  if(req.method==="POST"&&p==="/start"){
   const b=await req.json().catch(()=>({})),stake=Number(b.stake),s=await this.get();
   if(!Number.isFinite(stake)||stake<.35||stake>1000)return json({ok:false,message:"Stake must be between $0.35 and $1,000."},400);
   if(s.purchasePending||s.purchaseUncertain)return json({ok:false,message:"A previous purchase has an uncertain outcome. Reconcile it before restarting; no duplicate purchase will be attempted."},409);
   if(s.active&&this.publicWs&&this.publicWs.readyState===1&&this.feedReady)return json({ok:true,active:true,message:"Live digit stream is already running."});
   Object.assign(s,{ok:true,active:true,mode:"DEMO",stake:+stake.toFixed(2),lastError:null,feedStatus:"CONNECTING",feedError:null,marketWins:s.marketWins||{}});
   event(s,"Starting live digit monitor · green-touch DIGITMATCH · demo only · stake $"+stake.toFixed(2),"info");await this.put(s);
   try{await this.startMarketFeed();await this.ctx.storage.setAlarm(Date.now()+30000);return json({ok:true,active:true,message:"Live digit stream connected. The bot will open a one-tick MATCHES contract when the green cursor touches a qualifying digit."});}
   catch(e){const failed=await this.get();failed.active=false;failed.feedStatus="ERROR";failed.feedError=e?.message||"Could not start live market feed";failed.lastError=failed.feedError;event(failed,"Live monitor failed: "+failed.feedError,"error");await this.put(failed);this.closePublic();return json({ok:false,active:false,message:failed.feedError},502);}
  }
  if(req.method==="POST"&&p==="/stop"){
   const s=await this.get();s.active=false;event(s,s.openContract?"Stop requested · no new purchases; current demo contract will settle.":"Live scanner and demo bot stopped.","warning");await this.put(s);this.closePublic();
   if(s.openContract||s.purchasePending)await this.ctx.storage.setAlarm(Date.now()+1000);
   else{await this.ctx.storage.deleteAlarm();this.closeDemo();}
   return json({ok:true,active:false,settlingOpenContract:!!s.openContract,message:s.openContract?"Stop received. Current demo contract will settle; no new buys.":"Live monitor stopped. No new buys."});
  }
  return json({ok:false,message:"Not found"},404);
 }
 async alarm(){
  if(this.busy){await this.ctx.storage.setAlarm(Date.now()+1500);return;}
  this.busy=true;
  try{
   let s=await this.get();
   if(s.purchasePending){
    s.active=false;s.purchaseUncertain=true;s.lastError="Purchase outcome uncertain after interruption. Bot paused to prevent a duplicate buy; reconcile Deriv transactions before restarting.";
    event(s,s.lastError,"error");await this.put(s);await this.ctx.storage.deleteAlarm();this.closePublic();this.closeDemo();return;
   }
   if(s.openContract){
    const ws=await this.connection(),r=await ask(ws,{proposal_open_contract:1,contract_id:Number(s.openContract.contractId)},this.reqId++),c=r.proposal_open_contract||{};
    if(c.is_sold===1||c.is_sold===true||c.status==="won"||c.status==="lost"){
     const profit=Number(c.profit||0),won=c.status==="won"||profit>0,tx={contractId:s.openContract.contractId,symbol:s.openContract.symbol,name:s.openContract.name,digit:s.openContract.digit,stake:Number(s.openContract.stake),payout:Number(c.payout||0),profit,result:won?"WON":"LOST",settledAt:now()};
     if(won){s.wins++;s.grossProfit=+(s.grossProfit+Math.max(0,profit)).toFixed(2);s.marketWins[tx.symbol]=Number(s.marketWins[tx.symbol]||0)+1;}else s.losses++;
     s.netProfit=+(s.netProfit+profit).toFixed(2);s.transactions=[tx,...(s.transactions||[])].slice(0,100);s.openContract=null;s.lastSettlement=tx;s.lastError=null;
     event(s,"Contract "+tx.result+" · "+tx.symbol+" · digit #"+tx.digit+" · net "+(profit>=0?"+":"")+"$"+profit.toFixed(2),won?"success":"warning",{contractId:tx.contractId});
     await this.put(s);await this.persistMarkets(true);
     const monitored=this.liveMarkets.map(x=>x.symbol);if(won&&monitored.length&&monitored.every(x=>Number(s.marketWins[x]||0)>=2)){s.marketWins={};s.cycleNumber=(s.cycleNumber||1)+1;event(s,"All monitored markets completed two settled wins · rotation cycle "+s.cycleNumber+" restarted","info");await this.put(s);await this.persistMarkets(true);}
     if(!s.active){await this.ctx.storage.deleteAlarm();this.closeDemo();return;}
     await this.ctx.storage.setAlarm(Date.now()+30000);return;
    }
    s.openContract.status=c.status||"OPEN";s.openContract.currentProfit=Number(c.profit||0);await this.put(s);
    await this.ctx.storage.setAlarm(Date.now()+1800);return;
   }
   if(!s.active){await this.ctx.storage.deleteAlarm();this.closePublic();this.closeDemo();return;}
   if(!this.publicWs||this.publicWs.readyState!==1||!this.feedReady){
    try{await this.startMarketFeed();s=await this.get();s.feedStatus="LIVE";s.feedError=null;await this.put(s);}
    catch(e){s=await this.get();s.feedStatus="RECONNECTING";s.feedError=e?.message||"Feed reconnect failed";s.lastError=s.feedError;event(s,"Live feed reconnect: "+s.feedError,"error");await this.put(s);await this.ctx.storage.setAlarm(Date.now()+15000);return;}
   }
   await this.ctx.storage.setAlarm(Date.now()+30000);
  }catch(e){
   const s=await this.get();s.lastError=e?.message||"Trading engine error";event(s,"Trading engine: "+s.lastError,"error");await this.put(s);
   if(s.active||s.openContract)await this.ctx.storage.setAlarm(Date.now()+10000);
   else{await this.ctx.storage.deleteAlarm();this.closePublic();this.closeDemo();}
  }finally{this.busy=false;}
 }
}
export default{async fetch(req,env){const origin=req.headers.get("Origin")||"",u=new URL(origin||"https://invalid"),allowed=u.hostname==="26d1a910.dogo-bot.pages.dev"||u.hostname.endsWith(".dogo-bot.pages.dev"),headers={"Access-Control-Allow-Origin":allowed?origin:"https://26d1a910.dogo-bot.pages.dev","Access-Control-Allow-Methods":"GET, POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type, X-Dogo-Pin","Vary":"Origin","Cache-Control":"no-store"};if(req.method==="OPTIONS")return new Response(null,{status:204,headers});const p=new URL(req.url).pathname;if(p==="/health")return json({ok:true,service:"Dogo.bot preview",token_configured:!!env.DERIV_API_TOKEN,pin_configured:!!env.DOGO_CONTROL_PIN,mode:"DEMO_ONLY"});if(p==="/api/status"){try{const b=await rest(env,"/trading/v1/options/accounts"),accounts=b.data||[];return json({ok:true,connected:true,account_count:accounts.length,accounts:accounts.filter(x=>String(x.account_type||"").toLowerCase()==="demo"||x.is_virtual===true||String(x.account_id||x.loginid||"").startsWith("VRTC")).map(x=>({account_id:x.account_id||x.id,loginid:x.loginid,account_type:"demo",currency:x.currency})),message:"Authenticated · demo-only trading."});}catch(e){return json({ok:false,connected:false,error:e.message},502);}}
 if(p.startsWith("/api/preview/trading/")){const pin=req.headers.get("X-Dogo-Pin")||"";if(!env.DOGO_CONTROL_PIN||pin!==env.DOGO_CONTROL_PIN)return json({ok:false,message:"Preview control PIN is incorrect or not configured."},401);const stub=env.TRADER.get(env.TRADER.idFromName("dogo-preview-main")),path=p.slice("/api/preview/trading".length);if(path==="/state"&&req.method==="GET"){try{const r=await stub.fetch("https://trader/state");const s=await r.json();return json({...s,ok:true});}catch(e){return json({ok:false,message:"Could not read preview bot state: "+e.message},502);}}if(path==="/start"&&req.method==="POST")return stub.fetch(new Request("https://trader/start",{method:"POST",headers:{"Content-Type":"application/json"},body:await req.text()}));if(path==="/stop"&&req.method==="POST")return stub.fetch(new Request("https://trader/stop",{method:"POST"}));return json({ok:false,message:"Not found"},404);}return json({ok:false,message:"Not found"},404);}};
