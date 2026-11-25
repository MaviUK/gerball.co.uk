const send=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json; charset=utf-8","Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"apikey, content-type","Access-Control-Allow-Methods":"GET, OPTIONS","Cache-Control":status===200?"public,max-age=60":"no-store","X-Content-Type-Options":"nosniff"}});
const keys=raw=>{try{const v=JSON.parse(raw||"{}");return v&&typeof v==="object"&&!Array.isArray(v)?v:{}}catch{return{}}};
Deno.serve(async request=>{
 if(request.method==="OPTIONS")return new Response(null,{status:204,headers:{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"apikey, content-type","Access-Control-Allow-Methods":"GET, OPTIONS"}});
 if(request.method!=="GET")return send({error:"GET required"},405);
 if(new URL(request.url).search)return send({error:"Query parameters not supported"},400);
 const pub=Object.values(keys(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS"))).filter(x=>typeof x==="string"&&x.startsWith("sb_publishable_"));
 if(!pub.includes(request.headers.get("apikey")))return send({error:"Application key required"},401);
 const base=Deno.env.get("SUPABASE_URL"),service=keys(Deno.env.get("SUPABASE_SECRET_KEYS")).default||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!base||!service)return send({error:"Service unavailable"},503);
 try{
  const headers={"Content-Type":"application/json",apikey:service};
  if(!service.startsWith("sb_secret_"))headers.Authorization="Bearer "+service;
  const r=await fetch(base.replace(/\/$/,"")+"/rest/v1/rpc/gerball_paper_odds_movement",{method:"POST",headers,body:"{}",signal:AbortSignal.timeout(20000)});
  if(!r.ok){console.error("Paper odds movement RPC failed",r.status);return send({error:"Movement report unavailable"},502)}
  const data=await r.json();
  if(data?.version!=="paper_odds_movement_v1"||!Array.isArray(data.items)||
   !Number.isInteger(data.total_eligible_bets)||!Number.isInteger(data.followed_bets)||
   !Number.isInteger(data.unfollowed_bets)||data.total_eligible_bets!==data.followed_bets+data.unfollowed_bets||
   data.followed_bets!==data.positive_model_edge_at_latest+data.nonpositive_model_edge_at_latest||
   data.followed_bets!==data.higher_fixed_price+data.lower_fixed_price+data.unchanged_fixed_price||
   data.items.length>100||
   data.items.some(x=>!["H","D","A"].includes(x.market)||!(Number(x.original_odds)>1)||!(Number(x.latest_fixed_odds)>1)||
    Date.parse(x.latest_fixed_capture)<Date.parse(x.original_recorded_at)||
    Date.parse(x.latest_fixed_capture)>=Date.parse(x.kickoff_at)))
   return send({error:"Invalid movement report"},502);
  return send(data);
 }catch{console.error("Paper odds movement query failed");return send({error:"Movement report unavailable"},502)}
});