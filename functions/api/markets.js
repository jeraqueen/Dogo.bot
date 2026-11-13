import { openPublicSocket, derivRequest } from "../_lib/deriv-connect.js";

function nameOf(x){return x.display_name || x.underlying_symbol_name || x.symbol || x.underlying_symbol || "Volatility market";}
function symbolOf(x){return x.symbol || x.underlying_symbol || "";}

export async function onRequestGet(){
  let ws;
  try{
    ws=await openPublicSocket();
    const response=await derivRequest(ws,{active_symbols:"brief",contract_type:["DIGITMATCH"]},1);
    const markets=(response.active_symbols||[])
      .filter(x=>/volatility\s*(10|15|25|30|50|75|90|100)/i.test(nameOf(x)))
      .map(x=>({name:nameOf(x),symbol:symbolOf(x),pipSize:x.pip_size||x.pip||null}));
    return Response.json({ok:true,strategy:"DIGITMATCH",discovery:"live",markets},{headers:{"cache-control":"no-store"}});
  }catch(error){
    return Response.json({ok:false,message:error?.message||"Could not discover Matches markets.",markets:[]},{status:502,headers:{"cache-control":"no-store"}});
  }finally{try{ws?.close();}catch{}}
}
