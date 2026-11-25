(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.GerballSurebets=api;})(typeof globalThis!=='undefined'?globalThis:null,function(){
'use strict';
const MARKET_NAMES={full_time_result:'Full-time result',goals_total:'Total goals',btts:'Both teams to score',h2h_3_way_h1:'Half-time result',halftime_fulltime:'Half-time/full-time',alternate_totals_corners:'Total corners',alternate_totals_cards:'Total cards'};
const MARKET_KEYS=Object.keys(MARKET_NAMES);
const halfLine=x=>Number.isFinite(Number(x))&&Math.abs(Number(x)%1)===.5;
const cleanString=x=>typeof x==='string'&&x.length>0&&x.length<160?x:'';
function resultToken(name,row){
 if(name==='Draw')return'D';
 if(name===row.home)return'H';
 if(name===row.away)return'A';
 return null;
}
function normalize(row){
 if(!row||!MARKET_KEYS.includes(row.market)||!cleanString(row.event_id)||!cleanString(row.bookmaker_key)||
 !cleanString(row.home)||!cleanString(row.away)||!cleanString(row.outcome)||!cleanString(row.kickoff_at))return null;
 const odds=Number(row.decimal_odds),stamp=Date.parse(row.collected_at),source=Date.parse(row.source_updated_at),kickoff=Date.parse(row.kickoff_at);
 if(!Number.isFinite(odds)||odds<=1||odds>1000||!Number.isFinite(stamp)||!Number.isFinite(source)||
 !Number.isFinite(kickoff)||source>stamp||stamp>=kickoff)return null;
 let outcome=null,need=null,line=null;
 switch(row.market){
 case'full_time_result':
  need=['H','D','A'];outcome=['H','D','A'].includes(row.outcome)?row.outcome:null;break;
 case'goals_total':
  if(Number(row.line)!==2.5)return null;
  line=2.5;need=['Over','Under'];outcome=need.includes(row.outcome)?row.outcome:null;break;
 case'btts':
  need=['Yes','No'];outcome=need.includes(row.outcome)?row.outcome:null;break;
 case'h2h_3_way_h1':
  need=['H','D','A'];outcome=resultToken(row.outcome,row);break;
 case'halftime_fulltime':{
  const parts=row.outcome.split('/');if(parts.length!==2)return null;
  const first=resultToken(parts[0],row),second=resultToken(parts[1],row);
  need=['H','D','A'].flatMap(a=>['H','D','A'].map(b=>a+'/'+b));
  outcome=first&&second?first+'/'+second:null;break;
 }
 case'alternate_totals_corners':
 case'alternate_totals_cards':
  if(!halfLine(row.line))return null;
  if(row.description!==undefined&&row.description!=='')return null;
  line=Number(row.line);need=['Over','Under'];outcome=need.includes(row.outcome)?row.outcome:null;break;
 default:return null;
 }
 if(!outcome||!need)return null;
 return{...row,outcome,need,line,odds,stamp,source,kickoff};
}
function allocate(legs,stake=100){
 const totalCents=Math.round(Number(stake)*100);
 if(!Number.isSafeInteger(totalCents)||totalCents<100||totalCents>100000000)return null;
 const implied=legs.reduce((sum,l)=>sum+1/l.odds,0);
 if(!Number.isFinite(implied)||implied<=0)return null;
 let used=0;
 const placed=legs.map((leg,index)=>{
  const cents=index===legs.length-1?totalCents-used:Math.round(totalCents*(1/leg.odds)/implied);
  used+=cents;return{...leg,stake:cents/100,payout:Number((cents/100*leg.odds).toFixed(4))};
 });
 const guaranteedPayout=Math.min(...placed.map(l=>l.payout));
 return{legs:placed,stake:totalCents/100,implied,marginPct:(1-implied)*100,
 guaranteedPayout,profit:Number((guaranteedPayout-totalCents/100).toFixed(4)),
 roiPct:(guaranteedPayout/ (totalCents/100)-1)*100};
}
function scan(rows,{stake=100,now=Date.now(),liveMinutes=15,snapshotMinutes=2}={}){
 if(!Array.isArray(rows))return[];
 const groups=new Map();
 for(const raw of rows){
  const row=normalize(raw);if(!row||row.kickoff<=now)continue;
  const id=JSON.stringify([row.event_id,row.kickoff,row.market,row.line??'',row.description||'']);
  if(!groups.has(id))groups.set(id,[]);
  groups.get(id).push(row);
 }
 const results=[];
 for(const group of groups.values()){
  const first=group[0],need=first.need;
  const best=new Map();for(const p of group){
   const old=best.get(p.outcome);
   if(!old||p.odds>old.odds||(p.odds===old.odds&&p.stamp>old.stamp))best.set(p.outcome,p)
  }
  if(best.size!==need.length||!need.every(x=>best.has(x)))continue;
  const chosen=need.map(x=>best.get(x));
  const timestamps=chosen.map(x=>x.stamp);
  const newest=Math.max(...timestamps),oldest=Math.min(...timestamps);
  if(newest-oldest>snapshotMinutes*60*1000)continue;
  const uniq=new Set(chosen.map(x=>x.bookmaker_key));
  if(uniq.size<2)continue;
  const allocation=allocate(chosen,stake);if(!allocation||allocation.implied>=1||allocation.profit<=0)continue;
  const fresh=now-newest>=0&&now-newest<=liveMinutes*60*1000&&chosen.every(x=>now-x.source<=liveMinutes*60*1000);
  results.push({
   event_id:first.event_id,league:first.league,home:first.home,away:first.away,
   market:first.market,market_name:MARKET_NAMES[first.market],line:first.line,description:first.description||'',
   kickoff_at:first.kickoff_at,captured_at:new Date(newest).toISOString(),fresh,bookmakers:uniq.size,
   ...allocation
  });
 }
 return results.sort((a,b)=>Number(b.fresh)-Number(a.fresh)||b.profit-a.profit||a.kickoff_at.localeCompare(b.kickoff_at));
}
return{scan,allocate,normalize,MARKET_NAMES};
});