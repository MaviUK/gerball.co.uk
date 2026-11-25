const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{
 "Content-Type":"application/json; charset=utf-8","Access-Control-Allow-Origin":"*",
 "Access-Control-Allow-Headers":"apikey, content-type","Access-Control-Allow-Methods":"GET, OPTIONS",
 "Cache-Control":status===200?"public, max-age=30":"no-store","X-Content-Type-Options":"nosniff"
}});
const keys=raw=>{try{const k=JSON.parse(raw||"{}");return k&&typeof k==="object"&&!Array.isArray(k)?k:{}}catch{return{}}};
const ukFormatter=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",year:"numeric",month:"2-digit",day:"2-digit"});
const ukDay=value=>{
 const date=new Date(value);
 if(!Number.isFinite(date.getTime()))return null;
 const parts=Object.fromEntries(ukFormatter.formatToParts(date).map(part=>[part.type,part.value]));
 return parts.year+"-"+parts.month+"-"+parts.day;
};
const validDate=value=>{
 if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value.slice(0,4)==="0000")return false;
 const date=new Date(value+"T00:00:00Z");
 return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
};
const validDaySummary=(summary,total)=>{
 if(!summary||typeof summary!=="object"||Array.isArray(summary))return false;
 const fields=["bets","settled","pending","review","won","lost","units_recommended","units_settled"];
 if(fields.some(field=>!Number.isInteger(summary[field])||summary[field]<0))return false;
 return summary.bets===total&&summary.bets===summary.settled+summary.pending+summary.review&&
  summary.settled===summary.won+summary.lost&&summary.units_settled<=summary.units_recommended&&
  Number.isFinite(summary.net_units)&&
  (summary.units_settled===0?summary.roi_pct===null:Number.isFinite(summary.roi_pct));
};

Deno.serve(async request=>{
 if(request.method==="OPTIONS")return new Response(null,{status:204,headers:{
  "Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"apikey, content-type",
  "Access-Control-Allow-Methods":"GET, OPTIONS"
 }});
 if(request.method!=="GET")return json({error:"Use GET"},405);
 const params=new URL(request.url).searchParams;
 if([...params.keys()].some(k=>!["limit","offset","q","scope","date"].includes(k)||params.getAll(k).length!==1))
  return json({error:"Supported parameters: limit, offset, q, scope, date"},400);
 const limit=params.get("limit")??"250",offset=params.get("offset")??"0";
 const query=params.get("q"),scope=params.get("scope"),date=params.get("date"),today=ukDay(Date.now());
 if(scope!==null&&!["today","history","date"].includes(scope))return json({error:"Invalid scope"},400);
 if(scope==="date"?(!validDate(date)||date>today):date!==null)
  return json({error:"Use scope=date with a valid date on or before today (UK)"},400);
 if(query!==null&&(query.length>100||/[\u0000-\u001f\u007f]/.test(query)))return json({error:"Invalid search"},400);
 if(!/^[0-9]{1,4}$/.test(limit)||+limit<1||+limit>1000||!/^[0-9]{1,5}$/.test(offset)||+offset>50000)
  return json({error:"Invalid pagination"},400);
 const available=Object.values(keys(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS"))).filter(x=>typeof x==="string"&&x.startsWith("sb_publishable_"));
 if(!available.includes(request.headers.get("apikey")))return json({error:"Application key required"},401);
 const base=Deno.env.get("SUPABASE_URL"),role=keys(Deno.env.get("SUPABASE_SECRET_KEYS")).default||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!base||typeof role!=="string"||!role)return json({error:"Service unavailable"},503);

 try {
  const headers={"Content-Type":"application/json",apikey:role,
   ...(!role.startsWith("sb_secret_")?{Authorization:"Bearer "+role}:{})};
  const scoped=scope==="today"||scope==="date";
  const rpc=scope==="date"?"gerball_paper_day":scope==="today"?"gerball_paper_today":query===null?"gerball_paper_report":"gerball_paper_search";
  const args={p_limit:+limit,p_offset:+offset,
   ...(scoped||query!==null?{p_query:query??""}:{}),
   ...(scope==="date"?{p_date:date}:{})};
  const result=await fetch(base.replace(/\/$/,"")+"/rest/v1/rpc/"+rpc,{
   method:"POST",headers,body:JSON.stringify(args),signal:AbortSignal.timeout(25000)
  });
  if(!result.ok){console.error("Paper report RPC failed",result.status);return json({error:"Recommendations temporarily unavailable"},502)}
  const value=await result.json();
  if(scoped){
   const expectedVersion=scope==="date"?"paper_day_v1":"paper_today_v1";
   // At midnight a Today request may finish on the next UK day; accept that day only.
   const matchesDate=scope==="date"?value?.date===date:value?.date===today||value?.date===ukDay(Date.now());
   if(value?.version!==expectedVersion||!validDate(value.date)||!matchesDate||
    !Array.isArray(value.records)||!Number.isInteger(value.total_records)||value.total_records<0||
    value.records.length>+limit||value.records.length>value.total_records||
    value.query!==(query??"").trim().toLowerCase()||!validDaySummary(value.summary,value.total_records)||
    value.records.some(record=>!record||ukDay(record.kickoff_at)!==value.date))
    return json({error:"Invalid date report"},502);
  }else if(query===null){
   if(value?.version!=="paper_ledger_v1"||!Array.isArray(value.summary)||!Array.isArray(value.records)||
    !Array.isArray(value.preview?.fixtures)||!Number.isInteger(value.total_records))return json({error:"Invalid report"},502);
  }else{
   if(value?.version!=="paper_search_v1"||!Array.isArray(value.records)||!Number.isInteger(value.total_records)||
    value.query!==query.trim().toLowerCase())return json({error:"Invalid search report"},502);
  }
  return json(value);
 }catch(e){console.error("Paper report request failed");return json({error:"Recommendations temporarily unavailable"},502)}
});
