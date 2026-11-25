const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json; charset=utf-8","Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"apikey, content-type","Access-Control-Allow-Methods":"GET, OPTIONS","Cache-Control":status===200?"public,max-age=30":"no-store","X-Content-Type-Options":"nosniff"}});
const keys=raw=>{try{const v=JSON.parse(raw||"{}");return v&&typeof v==="object"&&!Array.isArray(v)?v:{}}catch{return{}}};
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"apikey, content-type","Access-Control-Allow-Methods":"GET, OPTIONS"}});
 if(req.method!=="GET")return response({error:"GET required"},405);
 if(new URL(req.url).search)return response({error:"No parameters accepted"},400);
 const publicKeys=Object.values(keys(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS"))).filter(x=>typeof x==="string"&&x.startsWith("sb_publishable_"));
 if(!publicKeys.includes(req.headers.get("apikey")))return response({error:"Application key required"},401);
 const base=Deno.env.get("SUPABASE_URL"),secret=keys(Deno.env.get("SUPABASE_SECRET_KEYS")).default||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!base||!secret)return response({error:"Service unavailable"},503);
 try{
 const headers={"Content-Type":"application/json",apikey:secret};
 if(!secret.startsWith("sb_secret_"))headers.Authorization="Bearer "+secret;
 const r=await fetch(base.replace(/\/$/,"")+"/rest/v1/rpc/gerball_paper_settlement_health",{method:"POST",headers,body:"{}",signal:AbortSignal.timeout(15000)});
 if(!r.ok){console.error("Paper settlement health RPC",r.status);return response({error:"Settlement report unavailable"},502)}
 const data=await r.json();
 if(data?.version!=="paper_settlement_health_v1"||!Array.isArray(data.stages)||!Array.isArray(data.unsettled_examples)||
 !Number.isInteger(data.records_total)||!Number.isInteger(data.settled)||!Number.isInteger(data.pending_after_grace)||
 data.stages.reduce((v,x)=>v+x.bets,0)!==data.records_total||
 data.stages.filter(x=>x.stage==="settled").reduce((v,x)=>v+x.bets,0)!==data.settled)
 return response({error:"Invalid settlement report"},502);
 return response(data);
 }catch{console.error("Settlement report request error");return response({error:"Settlement report unavailable"},502)}
});