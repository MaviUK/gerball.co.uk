(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.GerballPaperPriceHelpers=api;})(typeof globalThis!=='undefined'?globalThis:null,function(){'use strict';
function currentQuote(report,eventId,selection,kickoffAt,now=new Date()){
 if(!report||report.version!=='paper_price_refresh_v1'||!Array.isArray(report.prices)||
 !['H','D','A'].includes(selection)||typeof eventId!=='string'||!eventId)return null;
 const kickoff=Date.parse(kickoffAt),clock=new Date(now).getTime();
 if(!Number.isFinite(kickoff)||!Number.isFinite(clock)||clock>=kickoff)return null;
 const row=report.prices.find(p=>p.event_id===eventId&&p.selection===selection&&
  Math.abs(Date.parse(p.kickoff_at)-kickoff)<60000);
 if(!row)return null;
 const odds=Number(row.odds),captured=Date.parse(row.quote_collected_at),updated=Date.parse(row.quote_updated_at);
 if(!Number.isFinite(odds)||odds<=1||odds>1000||
 !Number.isFinite(captured)||!Number.isFinite(updated)||updated>captured||captured>=kickoff||
 captured>clock||updated>clock||captured-updated>15*60000||
 ['betfair_ex_uk','smarkets','matchbook'].includes(row.bookmaker_key))return null;
 const ageMinutes=Math.floor((clock-captured)/60000);
 const sourceAgeMinutes=Math.floor((clock-updated)/60000);
 return{...row,odds,ageMinutes,sourceAgeMinutes,fresh:ageMinutes<=15&&sourceAgeMinutes<=15};
}
return{currentQuote};
});