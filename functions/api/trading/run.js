import { authorized, connectDeriv, derivRequest, contractStatus, buyDiffers, quoteWithPipSize, json, DIGIT_MARKETS, DIGIT_STRATEGY } from "../_lib/trading-engine.js";
import { evaluateDigitDiffers } from "../_lib/digit-strategy.js";

export async function onRequestPost({request,env}) {
  if(!authorized(request,env)) return json({ok:false,message:"Enter your Dogo.bot control PIN first."},401);
  if(!env.BOT_DB) return json({ok:false,message:"Trading database binding is not ready."},503);
  const db=env.BOT_DB;
  const now=Date.now();
  const lock=await db.prepare("UPDATE cycle_state SET lock_until=?,updated_at=? WHERE id=1 AND (lock_until IS NULL OR lock_until<?)")
    .bind(now+45000,new Date(now).toISOString(),now).run();
  if(!lock.meta?.changes) return json({ok:true,busy:true,message:"Previous scan is still running."});
  let ws;
  try {
    const state=await db.prepare("SELECT cycle_number,active FROM cycle_state WHERE id=1").first();
    if(!state?.active) return json({ok:true,active:false,message:"Demo trading is stopped."});
    ws=await connectDeriv();
    const auth=await derivRequest(ws,{authorize:env.DERIV_API_TOKEN},1);
    const account=auth.authorize||{};
    const loginid=String(account.loginid||"");
    if(account.is_virtual!==true && !loginid.startsWith("VRTC")) {
      await db.prepare("UPDATE cycle_state SET active=0 WHERE id=1").run();
      return json({ok:false,active:false,message:"Safety stop: account is not verified as demo. No new orders were placed."},403);
    }
    if(String(account.currency||"").toUpperCase()!=="USD") {
      await db.prepare("UPDATE cycle_state SET active=0 WHERE id=1").run();
      return json({ok:false,active:false,message:"Safety stop: demo account currency is not USD."},403);
    }

    const openRows=await db.prepare("SELECT contract_id,symbol FROM trades WHERE status='OPEN' AND cycle_number=?").bind(state.cycle_number).all();
    let settled=0;
    for(const trade of (openRows.results||[])) {
      try {
        const c=await contractStatus(ws,trade.contract_id,20+settled);
        if(c && (c.is_sold===true || c.status==="won" || c.status==="lost" || c.status==="sold")) {
          const soldAt=new Date().toISOString();
          const profit=Number(c.profit||0);
          await db.batch([
            db.prepare("UPDATE trades SET status=?,profit=?,sell_time=? WHERE contract_id=? AND status='OPEN'")
              .bind(String(c.status||"sold").toUpperCase(),profit,soldAt,trade.contract_id),
            db.prepare("UPDATE market_state SET trades_completed=trades_completed+1 WHERE symbol=?").bind(trade.symbol)
          ]);
          settled++;
        }
      } catch(_) { /* Keep the contract open until Deriv confirms settlement. */ }
    }

    const marketRows=await db.prepare("SELECT symbol,trades_placed,trades_completed,last_predicted_digit,last_predicted_percent FROM market_state").all();
    const allDone=DIGIT_MARKETS.every(m=>(marketRows.results||[]).some(x=>x.symbol===m.symbol && Number(x.trades_placed)>=DIGIT_STRATEGY.maximumTradesPerMarket));
    const remaining=await db.prepare("SELECT COUNT(*) AS n FROM trades WHERE status='OPEN' AND cycle_number=?").bind(state.cycle_number).first();
    if(allDone && Number(remaining?.n||0)===0) {
      await db.batch([
        db.prepare("UPDATE cycle_state SET cycle_number=cycle_number+1,updated_at=? WHERE id=1").bind(new Date().toISOString()),
        db.prepare("UPDATE market_state SET trades_placed=0,trades_completed=0,last_predicted_digit=NULL,last_predicted_percent=NULL,status='ACTIVE'").bind()
      ]);
      return json({ok:true,active:true,cycleCompleted:true,cycleNumber:Number(state.cycle_number)+1,settled,message:"All ten markets completed four trades and all contracts settled. A new cycle has started."});
    }

    const rows=new Map((marketRows.results||[]).map(x=>[x.symbol,x]));
    const activeResp=await derivRequest(ws,{active_symbols:"brief",product_type:"basic"},3);
    const metas=new Map((activeResp.active_symbols||[]).map(x=>[x.symbol,x]));
    const purchased=[];
    const signals=[];
    let req=10;

    for(const market of DIGIT_MARKETS) {
      const row=rows.get(market.symbol)||{trades_placed:0};
      if(Number(row.trades_placed)>=DIGIT_STRATEGY.maximumTradesPerMarket) continue;
      const meta=metas.get(market.symbol);
      if(!meta) { signals.push({symbol:market.symbol,status:"MARKET_UNAVAILABLE"}); continue; }
      const history=await derivRequest(ws,{ticks_history:market.symbol,count:100,end:"latest",style:"ticks"},req++);
      const quotes=(history.history?.prices||[]).map(p=>quoteWithPipSize(p,Number(meta.pip_size||meta.pip)));
      const signal=evaluateDigitDiffers(quotes,100);
      if(!signal.eligible) { signals.push({symbol:market.symbol,status:signal.reason||"NO_SIGNAL"}); continue; }
      const previousDigit=row.last_predicted_digit===null?null:Number(row.last_predicted_digit);
      const previousPercent=row.last_predicted_percent===null?null:Number(row.last_predicted_percent);
      if(previousDigit===signal.predictedDigit && previousPercent!==null && signal.predictedPercent>previousPercent) {
        signals.push({symbol:market.symbol,status:"PREDICTED_PERCENT_INCREASED"});
        continue;
      }
      await db.prepare("UPDATE market_state SET last_predicted_digit=?,last_predicted_percent=? WHERE symbol=?")
        .bind(signal.predictedDigit,signal.predictedPercent,market.symbol).run();

      const fresh=await derivRequest(ws,{ticks_history:market.symbol,count:100,end:"latest",style:"ticks"},req++);
      const freshQuotes=(fresh.history?.prices||[]).map(p=>quoteWithPipSize(p,Number(meta.pip_size||meta.pip)));
      const confirm=evaluateDigitDiffers(freshQuotes,100);
      if(!confirm.eligible || confirm.predictedDigit!==signal.predictedDigit || confirm.predictedPercent>signal.predictedPercent) {
        signals.push({symbol:market.symbol,status:"SIGNAL_CHANGED_BEFORE_ENTRY"});
        continue;
      }
      try {
        const bought=await buyDiffers(ws,market.symbol,confirm,req);
        req+=2;
        const stamp=new Date().toISOString();
        await db.batch([
          db.prepare("INSERT INTO trades (contract_id,symbol,cycle_number,barrier,stake,status,buy_time) VALUES (?,?,?,?,?,'OPEN',?)")
            .bind(bought.contractId,market.symbol,state.cycle_number,confirm.predictedDigit,DIGIT_STRATEGY.stake,stamp),
          db.prepare("UPDATE market_state SET trades_placed=trades_placed+1 WHERE symbol=?").bind(market.symbol)
        ]);
        purchased.push({symbol:market.symbol,contractId:bought.contractId,barrier:confirm.predictedDigit,stake:DIGIT_STRATEGY.stake});
        signals.push({symbol:market.symbol,status:"PURCHASED",barrier:confirm.predictedDigit,percent:confirm.predictedPercent});
      } catch(error) {
        signals.push({symbol:market.symbol,status:"BUY_FAILED",message:error?.message||"Proposal/buy failed"});
      }
    }
    const counts=await db.prepare("SELECT symbol,trades_placed,trades_completed FROM market_state ORDER BY symbol").all();
    const opens=await db.prepare("SELECT COUNT(*) AS n FROM trades WHERE status='OPEN' AND cycle_number=?").bind(state.cycle_number).first();
    return json({ok:true,active:true,mode:"DEMO",currency:"USD",cycleNumber:Number(state.cycle_number),marketsScanned:DIGIT_MARKETS.length,settled,purchased,openContracts:Number(opens?.n||0),marketCounts:counts.results||[],signals,scannedAt:new Date().toISOString()});
  } catch(error) {
    return json({ok:false,message:error?.message||"Trading cycle failed"},502);
  } finally {
    try{ws?.close();}catch{}
    try{await db.prepare("UPDATE cycle_state SET lock_until=NULL WHERE id=1").run();}catch{}
  }
}
