const ukFormatter=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'});
export function ukDay(value){
 const date=new Date(value);if(!Number.isFinite(date.getTime()))return null;
 const parts=Object.fromEntries(ukFormatter.formatToParts(date).map(part=>[part.type,part.value]));
 return parts.year+'-'+parts.month+'-'+parts.day;
}
export function validDay(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<'0001-01-01')return false;
 const date=new Date(value+'T12:00:00Z');
 return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
}
const headers={
 'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*',
 'Access-Control-Allow-Headers':'apikey, content-type','Access-Control-Allow-Methods':'GET, OPTIONS',
 'X-Content-Type-Options':'nosniff','Vary':'apikey'
};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{...headers,
 'Cache-Control':status===200?'public, max-age=30':'no-store'}});
const keys=raw=>{try{const value=JSON.parse(raw||'{}');return value&&typeof value==='object'&&!Array.isArray(value)?value:{}}catch{return{}}};
const count=value=>Number.isSafeInteger(value)&&value>=0;
const finite=value=>typeof value==='number'&&Number.isFinite(value);
export function validSummary(value){
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 if(['bets','settled','won','lost','pending','review','missing_odds','units','units_settled'].some(key=>!count(value[key])))return false;
 return value.bets===value.settled+value.pending+value.review&&value.settled===value.won+value.lost&&
  value.units_settled<=value.units&&finite(value.net_units)&&
  (value.units_settled===0?value.roi_pct===null:finite(value.roi_pct));
}
export function validReport(value,expected){
 if(!value||value.version!=='paper_dashboard_v1'||value.model!==expected.model||
  value.month!==expected.month||value.date!==expected.date||value.query!==expected.query||
  !validDay(value.through_date)||![expected.today,expected.todayEnd??expected.today].includes(value.through_date)||
  (value.earliest_date!==null&&(!validDay(value.earliest_date)||value.earliest_date>value.through_date))||
  !validSummary(value.summary)||!validSummary(value.month_summary)||
  (expected.date===null?value.day_summary!==null:!validSummary(value.day_summary))||
  !Array.isArray(value.daily)||!Array.isArray(value.records)||
  !count(value.total_records)||value.records.length>expected.limit||value.records.length>value.total_records||
  value.limit!==expected.limit||value.offset!==expected.offset)return false;
 const first=expected.month+'-01',last=new Date(first+'T12:00:00Z');
 last.setUTCMonth(last.getUTCMonth()+1);last.setUTCDate(0);
 const days=last.getUTCDate();
 if(value.daily.length!==days)return false;
 if(value.daily.some((day,index)=>!validSummary(day)||day.date!==expected.month+'-'+String(index+1).padStart(2,'0')||
   day.is_future!==(day.date>value.through_date)))return false;
 const sum=key=>value.daily.reduce((total,day)=>total+day[key],0);
 for(const key of ['bets','settled','won','lost','pending','review','missing_odds','units','units_settled']){
  if(sum(key)!==value.month_summary[key]||value.month_summary[key]>value.summary[key])return false;
 }
 if(Math.abs(sum('net_units')-value.month_summary.net_units)>0.011)return false;
 if(expected.date!==null){
  const selected=value.daily[Number(expected.date.slice(-2))-1];
  for(const key of ['bets','settled','won','lost','pending','review','missing_odds','units','units_settled','net_units']){
   if(Math.abs(selected[key]-value.day_summary[key])>0.011)return false;
  }
 }
 const ids=new Set();
 for(const record of value.records){
  if(!record||!Number.isSafeInteger(record.id)||ids.has(record.id)||typeof record.home!=='string'||
   typeof record.away!=='string'||!validDay(record.date)||record.date!==ukDay(record.kickoff_at)||
   record.date>value.through_date||(expected.date!==null&&record.date!==expected.date)||
   !['pending','review','settled','odds_unavailable'].includes(record.status)||
   !Number.isInteger(record.units)||record.units<1||record.units>5)return false;
  ids.add(record.id);
  if(expected.model==='extra'){
   if(!['h2h_3_way_h1','halftime_fulltime','btts'].includes(record.market))return false;
  }else if(expected.model==='reverse'){
   if(!['H','A'].includes(record.market)||!['H','A'].includes(record.original_market)||
    record.market===record.original_market||record.original_id!==record.id)return false;
  }else if(!['H','D','A','O25','U25'].includes(record.market))return false;
  if(record.status==='odds_unavailable'){
   if(expected.model!=='reverse'||record.odds!==null||record.won!==null||record.net_units!==null)return false;
  }else if(!finite(record.odds)||record.odds<=1)return false;
  if(record.status==='settled'){
   if(typeof record.won!=='boolean'||!finite(record.net_units))return false;
  }else if(record.won!==null||record.net_units!==null)return false;
 }
 return true;
}

export function createHandler({env=name=>globalThis.Deno?.env.get(name),fetchImpl=globalThis.fetch,now=()=>Date.now()}={}){
 return async function handler(request){
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(request.method!=='GET')return json({error:'Use GET'},405);
  const params=new URL(request.url).searchParams;
  if([...params.keys()].some(key=>!['model','month','date','q','limit','offset'].includes(key)||params.getAll(key).length!==1))
   return json({error:'Supported parameters: model, month, date, q, limit, offset'},400);
  const today=ukDay(now()),model=params.get('model')??'odds',month=params.get('month')??today.slice(0,7),
   date=params.get('date'),rawQuery=params.get('q')??'',query=rawQuery.trim().toLowerCase(),
   rawLimit=params.get('limit')??'100',rawOffset=params.get('offset')??'0';
  if(!['odds','reverse','extra'].includes(model)||!/^\d{4}-\d{2}$/.test(month)||
   !validDay(month+'-01')||month>today.slice(0,7)||
   (date!==null&&(!validDay(date)||date.slice(0,7)!==month||date>today))||
   rawQuery.length>100||/[\u0000-\u001f\u007f]/.test(rawQuery)||
   !/^[0-9]{1,3}$/.test(rawLimit)||+rawLimit<1||+rawLimit>250||
   !/^[0-9]{1,7}$/.test(rawOffset)||+rawOffset>1000000)
   return json({error:'Invalid dashboard filters'},400);
  const available=Object.values(keys(env('SUPABASE_PUBLISHABLE_KEYS')))
   .filter(value=>typeof value==='string'&&value.startsWith('sb_publishable_'));
  if(!available.includes(request.headers.get('apikey')))return json({error:'Application key required'},401);
  const base=env('SUPABASE_URL'),role=keys(env('SUPABASE_SECRET_KEYS')).default||env('SUPABASE_SERVICE_ROLE_KEY');
  if(!base||typeof role!=='string'||!role)return json({error:'Service unavailable'},503);
  try{
   const response=await fetchImpl(base.replace(/\/$/,'')+'/rest/v1/rpc/gerball_paper_dashboard',{
    method:'POST',headers:{'Content-Type':'application/json',apikey:role,
     ...(!role.startsWith('sb_secret_')?{Authorization:'Bearer '+role}:{})},
    body:JSON.stringify({p_model:model,p_month:month+'-01',p_date:date,p_query:query,p_limit:+rawLimit,p_offset:+rawOffset}),
    signal:AbortSignal.timeout(25000)
   });
   if(!response.ok)return json({error:'Paper results temporarily unavailable'},502);
   const value=await response.json();
   if(!validReport(value,{model,month,date,query,limit:+rawLimit,offset:+rawOffset,today,todayEnd:ukDay(now())}))
    return json({error:'Invalid paper results'},502);
   return json(value);
  }catch{return json({error:'Paper results temporarily unavailable'},502)}
 };
}
