const answer=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json; charset=utf-8","Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"apikey, content-type","Access-Control-Allow-Methods":"GET, OPTIONS","Cache-Control":status===200?"public, max-age=60":"no-store"}});
const keys=raw=>{try{const o=JSON.parse(raw||"{}");return o&&typeof o==="object"?o:{}}catch{return{}}};
Deno.serve(async request=>{
 if(request.method==="OPTIONS")return new Response(null,{status:204,headers:{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"apikey, content-type","Access-Control-Allow-Methods":"GET, OPTIONS"}});
 if(request.method!=="GET")return answer({error:"GET required"},405);
 const params=new URL(request.url).searchParams;
 if([...params.keys()].some(k=>k!=="date"||params.getAll(k).length!==1))return answer({error:"Use date only"},400);
 const day=params.get("date");
 if(day!==null&&(!/^\d{4}-\d{2}-\d{2}$/.test(day)||Number.isNaN(Date.parse(day+"T00:00:00Z"))||new Date(day+"T00:00:00Z").toISOString().slice(0,10)!==day))return answer({error:"Invalid date"},400);
 const allowed=Object.values(keys(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS"))).filter(x=>typeof x==="string"&&x.startsWith("sb_publishable_"));
 if(!allowed.includes(request.headers.get("apikey")))return answer({error:"Application key required"},401);
 const base=Deno.env.get("SUPABASE_URL"),role=keys(Deno.env.get("SUPABASE_SECRET_KEYS")).default||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!base||!role)return answer({error:"Service unavailable"},503);
 try{const headers={"Content-Type":"application/json",apikey:role};if(!role.startsWith("sb_secret_"))headers.Authorization="Bearer "+role;
 const r=await fetch(base.replace(/\/$/,"")+"/rest/v1/rpc/gerball_price_readiness",{method:"POST",headers,body:JSON.stringify({p_capture_date:day}),signal:AbortSignal.timeout(15000)});
 if(!r.ok){console.error("Readiness SQL response",r.status);return answer({error:"Report temporarily unavailable"},502)}
 const d=await r.json();if(!d||!Number.isInteger(d.total_observations)||!Number.isInteger(d.priced_markets)||!Array.isArray(d.markets))return answer({error:"Invalid report"},502);return answer(d);
 }catch{console.error("Readiness SQL failure");return answer({error:"Report temporarily unavailable"},502)}
});