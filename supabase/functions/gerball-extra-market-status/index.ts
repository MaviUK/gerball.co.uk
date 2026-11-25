// Read-only projection of the separate event-market evidence tables.
const headers={"content-type":"application/json; charset=utf-8","access-control-allow-origin":"*",
"access-control-allow-headers":"apikey,content-type","access-control-allow-methods":"GET,OPTIONS",
"x-content-type-options":"nosniff","cache-control":"public,max-age=60"};
const response=(status,body)=>new Response(JSON.stringify(body),{status,headers:{...headers,...(status===200?{}:{"cache-control":"no-store"})}});
function keys(raw){try{const x=JSON.parse(raw||"{}");return x&&typeof x==="object"&&!Array.isArray(x)?x:{}}catch{return{}}}
Deno.serve(async request=>{
 if(request.method==="OPTIONS")return new Response(null,{status:204,headers});
 if(request.method!=="GET")return response(405,{error:"GET required"});
 if(new URL(request.url).search)return response(400,{error:"No query parameters"});
 const publicKeys=Object.values(keys(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")))
 .filter(v=>typeof v==="string"&&v.startsWith("sb_publishable_"));
 if(!publicKeys.includes(request.headers.get("apikey")))return response(401,{error:"Application key required"});
 const base=Deno.env.get("SUPABASE_URL");
 const secret=keys(Deno.env.get("SUPABASE_SECRET_KEYS")).default||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!base||!secret)return response(503,{error:"Service configuration missing"});
 try{
 const auth={apikey:secret,"content-type":"application/json"};
 if(!secret.startsWith("sb_secret_"))auth.Authorization="Bearer "+secret;
 const r=await fetch(base.replace(/\/$/,"")+"/rest/v1/rpc/gerball_extra_status",{
 method:"POST",headers:auth,body:"{}",signal:AbortSignal.timeout(15000)});
 if(!r.ok)return response(502,{error:"Market report unavailable"});
 const obj=await r.json();
 if(!obj||!Array.isArray(obj.runs)||!Array.isArray(obj.markets)||!Array.isArray(obj.availability)||!Array.isArray(obj.latest_quotes))
 return response(502,{error:"Invalid market report"});
 return response(200,{version:"extra_markets_v1",generated_at:new Date().toISOString(),...obj,
 disclaimer:"Stored bookmaker prices only; no invented card or same-game combination prices."});
 }catch{return response(502,{error:"Market report unavailable"})}
});