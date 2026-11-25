const dayNames=Object.freeze({Mon:"MON",Tue:"TUE",Wed:"WED",Thu:"THU",Fri:"FRI",Sat:"SAT",Sun:"SUN"});
const fmt=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",weekday:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
function getTime(){const fields=Object.fromEntries(fmt.formatToParts(new Date()).map(x=>[x.type,x.value]));return{weekday:fields.weekday,hour:+fields.hour,minute:+fields.minute}}
async function sha256(txt){const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(txt));return Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,"0")).join("")}
function secretKey(){let s={};try{s=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}")}catch{}
return s.default||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}
async function rpc(name,args){const url=Deno.env.get("SUPABASE_URL"),key=secretKey();if(!url||!key)throw Error("server_credentials_missing");
const headers={"content-type":"application/json",apikey:key};if(!key.startsWith("sb_secret_"))headers.Authorization="Bearer "+key;
const r=await fetch(url.replace(/\/$/,"")+"/rest/v1/rpc/"+name,{method:"POST",headers,body:JSON.stringify(args),signal:AbortSignal.timeout(15000)});
if(!r.ok)throw Error("rpc_"+name+"_http_"+r.status);return r.json()}
const usable=(x)=>typeof x==="string"&&x.length>0&&x.length<=160;
function parseQuotes(event,recordedAt,selected){
 if(!event||event.id!==selected.event_id||event.sport_key!==selected.sport_key||
 event.home_team!==selected.home||event.away_team!==selected.away||
 Math.abs(Date.parse(event.commence_time)-Date.parse(selected.kickoff_at))>60000)return null;
 const collected=Date.parse(recordedAt),kickoff=Date.parse(selected.kickoff_at);
 if(!Number.isFinite(kickoff)||kickoff<=collected)return null;
 const result=[];const seen=new Set();
 for(const book of event.bookmakers??[]){
  if(!usable(book.key)||!usable(book.title))continue;
  for(const market of book.markets??[]){
   if(market.key!=="h2h"||!Array.isArray(market.outcomes))continue;
   const updated=Date.parse(market.last_update??book.last_update??"");
   if(!Number.isFinite(updated)||updated>collected||updated>=kickoff)continue;
   for(const item of market.outcomes){
    const selection=item.name===selected.home?"H":item.name===selected.away?"A":item.name==="Draw"?"D":null;
    if(!selection||typeof item.price!=="number"||!Number.isFinite(item.price)||item.price<=1||item.price>1000)continue;
    const unique=book.key+"|"+selection;if(seen.has(unique))continue;seen.add(unique);
    result.push({event_id:selected.event_id,selection,bookmaker_key:book.key,bookmaker:book.title,
       odds:item.price,updated_at:new Date(updated).toISOString(),collected_at:recordedAt});
   }
  }
 }
 return result.slice(0,150)
}
Deno.serve(async request=>{
 if(request.method!=="POST")return reply(405,{error:"POST required"});
 const token=request.headers.get("x-gerball-token")||"";
 if(!/^[a-f0-9]{64}$/.test(token))return reply(401,{error:"Unauthorized"});
 try{
  if(!await rpc("gerball_odds_authorized",{p_digest:await sha256(token)}))return reply(401,{error:"Unauthorized"});
  if(!(request.headers.get("content-type")||"").toLowerCase().startsWith("application/json"))return reply(415,{error:"Invalid content type"});
  const raw=await request.text();if(raw.length>300)return reply(413,{error:"Request too large"});
  let data;try{data=JSON.parse(raw)}catch{return reply(400,{error:"Invalid JSON"})}
  if(!data||Object.keys(data).some(x=>x!=="mode")||!["scheduled","probe"].includes(data.mode))return reply(400,{error:"Invalid mode"});
  const clock=getTime();
  if(data.mode==="scheduled"&&(clock.hour<14||clock.hour>20||clock.minute%15>4))return reply(200,{status:"outside_uk_collection_window"});
  const claim=await rpc("gerball_arb_claim",{p_mode:data.mode});
  if(!claim.claimed)return reply(200,{status:"skipped",reason:claim.reason});
  const credentials=Deno.env.get("ODDS_API_KEY_"+dayNames[clock.weekday]);
  let status="failed",reason="",cost=0,remaining=null,quotes=[];
  try{
   if(!credentials)throw Error("weekday_odds_credentials_missing");
   const url="https://api.the-odds-api.com/v4/sports/"+encodeURIComponent(claim.sport_key)+
    "/events/"+encodeURIComponent(claim.event_id)+"/odds?regions=uk&markets=h2h&oddsFormat=decimal&dateFormat=iso";
   const r=await fetch(url,{headers:{"x-api-key":credentials,accept:"application/json"},signal:AbortSignal.timeout(16000)});
   const costHeader=r.headers.get("x-requests-last"),remainingHeader=r.headers.get("x-requests-remaining");
   cost=costHeader!==null&&/^\d+$/.test(costHeader)?Math.min(4,+costHeader):1;
   remaining=remainingHeader!==null&&/^\d+$/.test(remainingHeader)?+remainingHeader:null;
   if(!r.ok)throw Error("provider_http_"+r.status);
   const body=await r.text();if(body.length>4000000)throw Error("provider_payload_too_large");
   let response;try{response=JSON.parse(body)}catch{throw Error("invalid_provider_json")}
   quotes=parseQuotes(response,new Date().toISOString(),claim);
   if(!quotes)throw Error("provider_fixture_mismatch");
   if(!quotes.length)throw Error("no_valid_quote");
   status="completed";
  }catch(e){reason=typeof e?.message==="string"?e.message:"provider_failed"}
  const done=await rpc("gerball_arb_finish",{p_id:claim.id,p_payload:{
   status,credits_used:cost,remaining_credits:remaining===null?"":remaining,quotes,reason}});
  return reply(status==="completed"?200:502,{...done,slot:claim.slot,fixture:claim.event_id,reason:reason||null});
 }catch(e){console.error("Surebet refresh failure",typeof e?.message==="string"?e.message:"unknown");
  return reply(503,{error:"Refresh unavailable"})}
});