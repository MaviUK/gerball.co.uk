// Isolated, credit-bounded event-market collector. Never touches the standard odds snapshots.
const days = Object.freeze({Mon:"MON",Tue:"TUE",Wed:"WED",Thu:"THU",Fri:"FRI",Sat:"SAT",Sun:"SUN"});
const markets = Object.freeze(["halftime_fulltime","alternate_totals_cards","alternate_totals_corners","btts","h2h_3_way_h1","alternate_team_totals_corners","player_to_receive_card"]);
const allowed = new Set(markets);
const fmt = new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",weekday:"short",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
const response=(status,body)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
const onlyText=(v,max=120)=>typeof v==="string"&&v.trim()&&v.length<=max;
function london(now=new Date()){const p=Object.fromEntries(fmt.formatToParts(now).map(x=>[x.type,x.value]));return{date:`${p.year}-${p.month}-${p.day}`,weekday:p.weekday,hour:+p.hour,minute:+p.minute}}
async function sha(v){const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));return Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,"0")).join("")}
async function rpc(name,args){const base=Deno.env.get("SUPABASE_URL");
 let all={};try{all=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}")}catch{}
 const key=all.default||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!base||!key)throw Error("database_configuration_missing");
 const r=await fetch(base.replace(/\/$/,"")+"/rest/v1/rpc/"+name,{method:"POST",
 headers:{apikey:key,...(key.startsWith("sb_secret_")?{}:{Authorization:"Bearer "+key}),"content-type":"application/json"},
 body:JSON.stringify(args),signal:AbortSignal.timeout(18000)});
 if(!r.ok)throw Error("database_"+name+"_http_"+r.status);
 return await r.json();
}
async function provider(path,key){const r=await fetch("https://api.the-odds-api.com/v4"+path,{
 headers:{"x-api-key":key,accept:"application/json"},signal:AbortSignal.timeout(12000)});
 const raw=await r.text();if(raw.length>2000000)throw Error("response_too_large");
 let data;try{data=JSON.parse(raw)}catch{data=null}
 const quota=(name)=>{const value=r.headers.get(name);return value!==null&&/^\d+$/.test(value)?Number(value):null};
 return{ok:r.ok,status:r.status,data,remaining:quota("x-requests-remaining"),cost:quota("x-requests-last"),error:typeof data?.error_code==="string"?data.error_code:"provider_http_"+r.status};
}
function matches(event,item){
 return event&&event.id===item.event_id&&event.sport_key===item.sport_key&&
 event.home_team===item.home&&event.away_team===item.away&&
 Math.abs(Date.parse(event.commence_time)-Date.parse(item.kickoff_at))<60000;
}
function readMarkets(event,item,at){
 const availability=[];const candidate=new Set();
 for(const bookmaker of event.bookmakers??[]){
  if(!onlyText(bookmaker.key)||!onlyText(bookmaker.title)||!Array.isArray(bookmaker.markets))continue;
  for(const market of bookmaker.markets){
   if(!onlyText(market.key)||!allowed.has(market.key))continue;
   const stamp=Date.parse(market.last_update??bookmaker.last_update??"");
   if(!Number.isFinite(stamp)||stamp>Date.parse(at))continue;
   availability.push({event_id:item.event_id,sport_key:item.sport_key,league:item.league,
    home:item.home,away:item.away,kickoff_at:item.kickoff_at,discovered_at:at,
    bookmaker_key:bookmaker.key,bookmaker:bookmaker.title,market:market.key,
    source_updated_at:new Date(stamp).toISOString()});
   candidate.add(market.key);
  }
 }
 return{availability,marketKeys:markets.filter(key=>candidate.has(key)).slice(0,5)};
}
function readPrices(event,item,at,requested){
 const records=[];const keys=new Set(requested);
 for(const bookmaker of event.bookmakers??[]){
  if(!onlyText(bookmaker.key)||!onlyText(bookmaker.title)||!Array.isArray(bookmaker.markets))continue;
  for(const market of bookmaker.markets){
   if(!keys.has(market.key)||!Array.isArray(market.outcomes))continue;
   const t=Date.parse(market.last_update??bookmaker.last_update??"");
   if(!Number.isFinite(t)||t>Date.parse(at)||t>=Date.parse(item.kickoff_at))continue;
   for(const outcome of market.outcomes){
    if(!onlyText(outcome.name)||typeof outcome.price!=="number"||
    !Number.isFinite(outcome.price)||outcome.price<=1||outcome.price>10000)continue;
    if(outcome.description!==undefined&&typeof outcome.description!=="string")continue;
    const point=outcome.point;
    if(point!==undefined&&(typeof point!=="number"||!Number.isFinite(point)||Math.abs(point)>1000))continue;
    records.push({event_id:item.event_id,sport_key:item.sport_key,league:item.league,
      home:item.home,away:item.away,kickoff_at:item.kickoff_at,
      bookmaker_key:bookmaker.key,bookmaker:bookmaker.title,market:market.key,
      outcome:outcome.name,description:outcome.description??"",line:point===undefined?"":String(point),
      odds:outcome.price,source_updated_at:new Date(t).toISOString(),collected_at:at});
   }
  }
 }
 return records.slice(0,800);
}
async function collect(mode,now=new Date()){
 const clock=london(now);const minimum=mode==="probe"?1:2;
 const key=Deno.env.get("ODDS_API_KEY_"+days[clock.weekday]);
 if(!key)return response(503,{status:"missing_weekday_odds_key"});
 const claim=await rpc("gerball_extra_claim",{p_mode:mode});
 if(!claim.claimed)return response(200,{status:"already_attempted_today",collection_date:clock.date});
 const availability=[],quotes=[];let credits=0,priceCalls=0,remaining=null,fixtureCount=0;
 let status="completed",detail="";
 try{
  const seeds=await rpc("gerball_extra_seed",{p_limit:minimum});
  if(!Array.isArray(seeds))throw Error("invalid_seed");
  for(const item of seeds){
   if(!item||!onlyText(item.event_id)||!onlyText(item.sport_key)||
      !Number.isFinite(Date.parse(item.kickoff_at))||Date.parse(item.kickoff_at)<=Date.now()+3600000)continue;
   if(credits>=8||(remaining!==null&&remaining<8)){detail="quota_reserve_reached";break}
   fixtureCount++;
   const path="/sports/"+encodeURIComponent(item.sport_key)+"/events/"+encodeURIComponent(item.event_id);
   const discovery=await provider(path+"/markets?regions=uk&dateFormat=iso",key);
   credits+=discovery.cost??1;remaining=discovery.remaining;
   if(!discovery.ok){status="failed";detail=discovery.error;break}
   if(!matches(discovery.data,item)){detail="provider_event_identity_mismatch";continue}
   const at=new Date().toISOString();const found=readMarkets(discovery.data,item,at);
   availability.push(...found.availability);
   if(!found.marketKeys.length)continue;
   const potentialCost=found.marketKeys.length;
   if(credits+potentialCost>10||(remaining!==null&&remaining<potentialCost+2)){detail="quota_reserve_reached";break}
   const params=new URLSearchParams({regions:"uk",markets:found.marketKeys.join(","),oddsFormat:"decimal",dateFormat:"iso"});
   const odds=await provider(path+"/odds?"+params,key);priceCalls++;
   credits+=odds.cost??potentialCost;remaining=odds.remaining;
   if(!odds.ok){status="failed";detail=odds.error;break}
   if(!matches(odds.data,item)){detail="provider_price_identity_mismatch";continue}
   quotes.push(...readPrices(odds.data,item,new Date().toISOString(),found.marketKeys));
  }
 }catch(error){status="failed";detail=typeof error?.message==="string"?error.message:"collection_failed"}
 const result=await rpc("gerball_extra_finish",{p_id:claim.id,p_report:{
  status,detail:detail.slice(0,100),fixture_count:fixtureCount,price_calls:priceCalls,
  credits_reported:Math.min(10,credits),requests_remaining:remaining===null?"":remaining,
  availability:availability.slice(0,500),quotes:quotes.slice(0,1500)}});
 return response(status==="completed"?200:502,{...result,mode,collection_date:clock.date,
  fixtures_checked:fixtureCount,credits_reported:credits,requests_remaining:remaining,
  reason:detail||null});
}
Deno.serve(async req=>{
 if(req.method!=="POST")return response(405,{error:"method_not_allowed"});
 const token=req.headers.get("x-gerball-token")??"";
 if(!/^[a-f0-9]{64}$/.test(token))return response(401,{error:"unauthorized"});
 try{
  if(!await rpc("gerball_odds_authorized",{p_digest:await sha(token)}))return response(401,{error:"unauthorized"});
  if(!(req.headers.get("content-type")??"").startsWith("application/json"))return response(415,{error:"content_type"});
  const raw=await req.text();if(raw.length>400)return response(413,{error:"payload_too_large"});
  let body;try{body=JSON.parse(raw)}catch{return response(400,{error:"invalid_json"})}
  if(!body||Object.keys(body).some(k=>k!=="mode")||!["probe","daily"].includes(body.mode))return response(400,{error:"invalid_mode"});
  const uk=london();
  if(body.mode==="daily"&&!(uk.hour===12&&uk.minute>=50&&uk.minute<=59))
   return response(200,{status:"outside_schedule"});
  return await collect(body.mode);
 }catch(error){console.error("Extra odds collector failure",typeof error?.message==="string"?error.message:"unknown");
  return response(503,{error:"collector_unavailable"})}
});
