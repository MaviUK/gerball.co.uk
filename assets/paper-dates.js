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
return{day,isToday,todayOnly,upcomingToday,nextChangeAt};
});
