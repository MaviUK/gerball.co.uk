(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.GerballPaperDates=api;})(typeof globalThis!=='undefined'?globalThis:null,function(){'use strict';
const london=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'});
function day(value){
 const d=value instanceof Date?value:new Date(value);
 if(!Number.isFinite(d.getTime()))return null;
 const p=Object.fromEntries(london.formatToParts(d).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
 return p.year+'-'+p.month+'-'+p.day;
}
function isToday(fixture,now=new Date()){
 return !!fixture&&day(fixture.kickoff_at)!==null&&day(fixture.kickoff_at)===day(now);
}
function todayOnly(fixtures,now=new Date()){
 return Array.isArray(fixtures)?fixtures.filter(f=>isToday(f,now)):[];
}
function upcomingToday(fixtures,now=new Date()){
 const timestamp=new Date(now).getTime();
 if(!Number.isFinite(timestamp))return [];
 return todayOnly(fixtures,now).filter(f=>Date.parse(f.kickoff_at)>timestamp);
}
function nextChangeAt(fixtures,now=new Date()){
 const today=day(now);if(!today)return null;
 const [year,month,date]=today.split('-').map(Number);
 const midnightUtc=Date.UTC(year,month-1,date+1);
 // A London midnight is either UTC midnight or 23:00 UTC, including clock-change days.
 let next=day(midnightUtc-3600000)!==today?midnightUtc-3600000:midnightUtc;
 for(const fixture of upcomingToday(fixtures,now))next=Math.min(next,Date.parse(fixture.kickoff_at));
 return next;
}
// Price observations are research snapshots. "recent" is not bookmaker-executable.
function priceState(fixture,now=new Date()){
 const clock=Number(new Date(now).getTime());
 const odds=Number(fixture?.quoted_odds);
 if(!Number.isFinite(odds)||odds<=1)return{status:'unavailable',label:'Price unavailable',detail:'No valid bookmaker price was saved for this assessment.',captureMinutes:null,providerMinutes:null};
 const captured=Date.parse(fixture?.quote_collected_at??'');
 const source=Date.parse(fixture?.quote_updated_at??'');
 const recorded=Date.parse(fixture?.recorded_at??'');
 const kickoff=Date.parse(fixture?.kickoff_at??'');
 if(![clock,captured,source,recorded,kickoff].every(Number.isFinite)||
 captured>clock||source>clock||source>captured||recorded>clock||recorded>kickoff||
 captured>recorded||captured>=kickoff)
 return{status:'unverified',label:'Unverified price time',detail:'Snapshot timestamps are missing or inconsistent; do not treat this price as available.',captureMinutes:null,providerMinutes:null};
 const capturedAge=(clock-captured)/60000,providerAge=(clock-source)/60000;
 const captureMinutes=Math.floor(capturedAge),providerMinutes=Math.floor(providerAge);
 if(capturedAge<=15&&providerAge<=15)
 return{status:'recent',label:'Recent saved quote',detail:'Captured and provider-updated within 15 minutes. Still verify the bookmaker price and stake limit.',captureMinutes,providerMinutes};
 if(capturedAge<=120&&providerAge<=120)
 return{status:'aging',label:'Aging saved quote',detail:'Saved price is older than 15 minutes; verify current odds before considering any stake.',captureMinutes,providerMinutes};
 return{status:'old',label:'Old saved quote',detail:'Price is older than 2 hours or provider-updated too long ago; research only, not a usable quote.',captureMinutes,providerMinutes};
}
return{day,isToday,todayOnly,upcomingToday,nextChangeAt,priceState};
});
