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
return{day,isToday,todayOnly};
});