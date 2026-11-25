const answer=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json; charset=utf-8","Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"apikey, content-type","Access-Control-Allow-Methods":"GET, OPTIONS","Cache-Control":status===200?"public,max-age=30":"no-store","X-Content-Type-Options":"nosniff"}});
function keys(raw){try{const obj=JSON.parse(raw||"{}");return obj&&typeof obj==="object"&&!Array.isArray(obj)?obj:{}}catch{return{}}}
Deno.serve(async request=>{
 if(request.method==="OPTIONS")return new Response(null,{status:204,headers:{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"apikey, content-type","Access-Control-Allow-Methods":"GET, OPTIONS"}});
 if(request.method!=="GET")return answer({error:"GET required"},405);
 if(new URL(request.url).search)return answer({error:"No parameters supported"},400);
 const accepted=Object.values(keys(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS"))).filter(x=>typeof x==="string"&&x.startsWith("sb_publishable_"));
 if(!accepted.includes(request.headers.get("apikey")))return answer({error:"Application key required"},401);
 const base=Deno.env.get("SUPABASE_URL"),secrets=keys(Deno.env.get("SUPABASE_SECRET_KEYS"));
 const role=secrets.default||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!base||!role)return answer({error:"Service unavailable"},503);
 try{
  const headers={"Content-Type":"application/json",apikey:role};
  if(!role.startsWith("sb_secret_"))headers.Authorization="Bearer "+role;
  const result=await fetch(base.replace(/\/$/,"")+"/rest/v1/rpc/gerball_paper_breakdown",{
   method:"POST",headers,body:"{}",signal:AbortSignal.timeout(20000)});
  if(!result.ok){console.error("Paper breakdown DB",result.status);return answer({error:"Breakdown unavailable"},502)}
  const data=await result.json();
  if(data?.version!=="paper_breakdown_v1"||!Array.isArray(data.groups)||!Number.isInteger(data.total_bets)||
  !Number.isInteger(data.settled_bets)||data.settled_bets>data.total_bets)
   return answer({error:"Invalid breakdown"},502);
  for(const kind of ["market","league","home_team","away_team","bookmaker","season"]){
   const items=data.groups.filter(r=>r.kind===kind);
   if(items.reduce((s,r)=>s+r.bets,0)!==data.total_bets)return answer({error:"Inconsistent breakdown"},502);
  }
  if(data.groups.some(r=>r.bets!==r.settled+r.pending+r.review||r.settled!==r.won+r.lost||
    (r.settled_units===0)!==(r.roi_pct===null)))return answer({error:"Invalid settlement aggregates"},502);
  return answer(data);
 }catch{console.error("Paper breakdown unavailable");return answer({error:"Breakdown unavailable"},502)}
});