const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json; charset=utf-8","Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"apikey, content-type","Access-Control-Allow-Methods":"GET, OPTIONS","Cache-Control":status===200?"public, max-age=30":"no-store","X-Content-Type-Options":"nosniff"}});
const keys=raw=>{try{const k=JSON.parse(raw||"{}");return k&&typeof k==="object"&&!Array.isArray(k)?k:{}}catch{return{}}};
Deno.serve(async request=>{
 if(request.method==="OPTIONS")return new Response(null,{status:204,headers:{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"apikey, content-type","Access-Control-Allow-Methods":"GET, OPTIONS"}});
 if(request.method!=="GET")return json({error:"Use GET"},405);
 const params=new URL(request.url).searchParams;
 if([...params.keys()].some(k=>!["limit","offset"].includes(k)||params.getAll(k).length!==1))return json({error:"Supported parameters: limit, offset"},400);
 const limit=params.get("limit")??"250",offset=params.get("offset")??"0";
 if(!/^[0-9]{1,4}$/.test(limit)||+limit<1||+limit>1000||!/^[0-9]{1,5}$/.test(offset)||+offset>50000)return json({error:"Invalid pagination"},400);
 const available=Object.values(keys(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS"))).filter(x=>typeof x==="string"&&x.startsWith("sb_publishable_"));
 if(!available.includes(request.headers.get("apikey")))return json({error:"Application key required"},401);
 const base=Deno.env.get("SUPABASE_URL"),role=keys(Deno.env.get("SUPABASE_SECRET_KEYS")).default||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!base||!role)return json({error:"Service unavailable"},503);
 try{
 const headers={"Content-Type":"application/json",apikey:role};
 if(!role.startsWith("sb_secret_"))headers.Authorization="Bearer "+role;
 const result=await fetch(base.replace(/\/$/,"")+"/rest/v1/rpc/gerball_paper_report",{
 method:"POST",headers,body:JSON.stringify({p_limit:+limit,p_offset:+offset}),signal:AbortSignal.timeout(25000)});
 if(!result.ok){console.error("Paper report RPC failed",result.status);return json({error:"Recommendations temporarily unavailable"},502)}
 const value=await result.json();
 if(value?.version!=="paper_ledger_v1"||!Array.isArray(value.summary)||!Array.isArray(value.records)||!Array.isArray(value.preview?.fixtures)||!Number.isInteger(value.total_records))return json({error:"Invalid report"},502);
 return json(value);
 }catch(e){console.error("Paper report request failed");return json({error:"Recommendations temporarily unavailable"},502)}
});