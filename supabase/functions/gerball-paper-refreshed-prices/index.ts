const send=(status,body)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json; charset=utf-8","Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"apikey, content-type","Access-Control-Allow-Methods":"GET, OPTIONS","Cache-Control":status===200?"public,max-age=30":"no-store","X-Content-Type-Options":"nosniff"}});
function keys(raw){try{const value=JSON.parse(raw||"{}");return value&&typeof value==="object"&&!Array.isArray(value)?value:{}}catch{return{}}}
Deno.serve(async request=>{
 if(request.method==="OPTIONS")return new Response(null,{status:204,headers:{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"apikey, content-type","Access-Control-Allow-Methods":"GET, OPTIONS"}});
 if(request.method!=="GET")return send(405,{error:"GET required"});
 if(new URL(request.url).search)return send(400,{error:"Query parameters not supported"});
 const validKeys=Object.values(keys(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS"))).filter(v=>typeof v==="string"&&v.startsWith("sb_publishable_"));
 if(!validKeys.includes(request.headers.get("apikey")))return send(401,{error:"Application key required"});
 const base=Deno.env.get("SUPABASE_URL"),service=keys(Deno.env.get("SUPABASE_SECRET_KEYS")).default||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!base||!service)return send(503,{error:"Service unavailable"});
 try{
  const headers={"Content-Type":"application/json",apikey:service};
  if(!service.startsWith("sb_secret_"))headers.Authorization="Bearer "+service;
  const r=await fetch(base.replace(/\/$/,"")+"/rest/v1/rpc/gerball_paper_refreshed_prices",{
   method:"POST",headers,body:"{}",signal:AbortSignal.timeout(15000)});
  if(!r.ok){console.error("Paper price refresh report failed",r.status);return send(502,{error:"Refreshed prices unavailable"})}
  const report=await r.json();
  if(report?.version!=="paper_price_refresh_v1"||!Array.isArray(report.prices)||!Number.isInteger(report.total_prices)||
   report.total_prices!==report.prices.length||!Number.isInteger(report.total_eligible_events)||
   !Number.isInteger(report.events_with_refresh)||report.events_with_refresh>report.total_eligible_events||
   report.prices.some(x=>!["H","D","A"].includes(x.selection)||!(Number(x.odds)>1)||
    !Number.isFinite(Date.parse(x.quote_collected_at))||
    Date.parse(x.quote_collected_at)>=Date.parse(x.kickoff_at)||
    Date.parse(x.quote_updated_at)>Date.parse(x.quote_collected_at)))
   return send(502,{error:"Invalid refreshed price report"});
  return send(200,report);
 }catch{console.error("Paper refreshed prices request failed");return send(502,{error:"Refreshed prices unavailable"})}
});