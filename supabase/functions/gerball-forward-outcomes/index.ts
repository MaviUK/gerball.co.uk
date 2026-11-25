const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json; charset=utf-8","Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"apikey, content-type","Access-Control-Allow-Methods":"GET, OPTIONS","Cache-Control":status===200?"public, max-age=60":"no-store","X-Content-Type-Options":"nosniff"}});
const parseKeys=raw=>{try{const parsed=JSON.parse(raw||"{}");return parsed&&typeof parsed==="object"&&!Array.isArray(parsed)?parsed:{}}catch{return{}}};
Deno.serve(async request=>{
 if(request.method==="OPTIONS")return new Response(null,{status:204,headers:{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"apikey, content-type","Access-Control-Allow-Methods":"GET, OPTIONS"}});
 if(request.method!=="GET")return json({error:"GET only"},405);
 if(new URL(request.url).search)return json({error:"No parameters supported"},400);
 const allowed=Object.values(parseKeys(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS"))).filter(x=>typeof x==="string"&&x.startsWith("sb_publishable_"));
 if(!allowed.includes(request.headers.get("apikey")))return json({error:"Valid application key required"},401);
 const base=Deno.env.get("SUPABASE_URL");
 const role=parseKeys(Deno.env.get("SUPABASE_SECRET_KEYS")).default||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!base||!role)return json({error:"Service temporarily unavailable"},503);
 try{
 const headers={"Content-Type":"application/json",apikey:role};if(!role.startsWith("sb_secret_"))headers.Authorization="Bearer "+role;
 const response=await fetch(base.replace(/\/$/,"")+"/rest/v1/rpc/gerball_forward_outcomes",{method:"POST",headers,body:"{}",signal:AbortSignal.timeout(15000)});
 if(!response.ok){console.error("Forward outcome RPC status",response.status);return json({error:"Forward report temporarily unavailable"},502)}
 const report=await response.json();
 if(!report||report.version!=="forward_outcomes_v1"||report.rule_version!=="ppg_last5_dates_050_v1"||
 !Array.isArray(report.summary)||report.summary.length!==6||!Array.isArray(report.leagues)||
 !Number.isInteger(report.total_unique_market_observations))return json({error:"Invalid forward report"},502);
 if(report.summary.some(x=>!["H","D","A"].includes(x.market)||!["calibration","post_boundary"].includes(x.phase)||
 !Number.isInteger(x.qualifying)||x.qualifying!==x.settled+x.pending+x.review||
 x.settled!==x.matched+x.not_matched||x.match_rate_pct!==null&&typeof x.match_rate_pct!=="number"))
 return json({error:"Inconsistent forward results"},502);
 return json(report);
 }catch(e){console.error("Forward results request failed");return json({error:"Forward report temporarily unavailable"},502)}
});