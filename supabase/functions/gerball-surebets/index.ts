const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json; charset=utf-8","Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"apikey, content-type","Access-Control-Allow-Methods":"GET, OPTIONS","Cache-Control":status===200?"public, max-age=30":"no-store","X-Content-Type-Options":"nosniff"}});
const keys=raw=>{try{const v=JSON.parse(raw||"{}");return v&&typeof v==="object"&&!Array.isArray(v)?v:{}}catch{return{}}};
Deno.serve(async request=>{
 if(request.method==="OPTIONS")return new Response(null,{status:204,headers:{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"apikey, content-type","Access-Control-Allow-Methods":"GET, OPTIONS"}});
 if(request.method!=="GET")return json({error:"GET required"},405);
 if(new URL(request.url).search)return json({error:"No query parameters supported"},400);
 const allowed=Object.values(keys(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS"))).filter(v=>typeof v==="string"&&v.startsWith("sb_publishable_"));
 if(!allowed.includes(request.headers.get("apikey")))return json({error:"Application key required"},401);
 const base=Deno.env.get("SUPABASE_URL");
 const secret=keys(Deno.env.get("SUPABASE_SECRET_KEYS")).default||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!base||!secret)return json({error:"Service unavailable"},503);
 try{
  const headers={"Content-Type":"application/json",apikey:secret};
  if(!secret.startsWith("sb_secret_"))headers.Authorization="Bearer "+secret;
  const response=await fetch(base.replace(/\/$/,"")+"/rest/v1/rpc/gerball_surebet_feed",{
   method:"POST",headers,body:"{}",signal:AbortSignal.timeout(20000)});
  if(!response.ok){console.error("Surebet feed database status",response.status);return json({error:"Price feed temporarily unavailable"},502)}
  const data=await response.json();
  if(data?.version!=="surebet_feed_v1"||!Array.isArray(data.quotes)||data.quotes.length>6000||
   !Number.isInteger(data.complete_market_quote_rows)||typeof data.generated_at!=="string")
   return json({error:"Invalid price feed"},502);
  return json(data);
 }catch{console.error("Surebet feed query failed");return json({error:"Price feed temporarily unavailable"},502)}
});