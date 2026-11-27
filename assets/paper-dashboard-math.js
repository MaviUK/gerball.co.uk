(function(root,factory){
 const dates=typeof module==='object'&&module.exports?require('./paper-dates.js'):root&&root.GerballPaperDates;
 const api=factory(dates);
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.GerballPaperDashboardMath=api;
})(typeof globalThis!=='undefined'?globalThis:null,function(dates){
'use strict';
if(!dates||typeof dates.day!=='function'||typeof dates.validDay!=='function')throw new Error('Paper dashboard requires GerballPaperDates.');

const skippedStatuses=new Set(['odds_unavailable','skipped','skip','excluded','no_bet','not_selected','no_selection']);
const neutralStatuses=new Set(['void','voided','push','pushed','refunded']);
const pendingStatuses=new Set(['','pending','open','unsettled','recorded','candidate']);
const marketNames={H:'Home win',D:'Draw',A:'Away win',O25:'Over 2.5 goals',U25:'Under 2.5 goals',h2h:'Match winner',totals:'Over under goals',cards:'Cards',h1h2:'Half time full time'};
const normalized=value=>String(value??'').trim().toLocaleLowerCase('en-GB');
const statusOf=row=>normalized(row.status).replace(/[\s-]+/g,'_');

function isSkipped(row){
 return row.skipped===true||row.skip===true||row.excluded===true||skippedStatuses.has(statusOf(row))||
  skippedStatuses.has(normalized(row.decision).replace(/[\s-]+/g,'_'));
}
function checkedRows(records){
 if(!Array.isArray(records))throw new TypeError('Paper bet records must be an array.');
 for(const row of records)if(!row||typeof row!=='object'||Array.isArray(row))throw new TypeError('Each paper bet must be a record.');
 return records;
}
function numeric(value){
 if(typeof value==='number')return Number.isFinite(value)?value:null;
 if(typeof value!=='string'||!value.trim()||!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i.test(value.trim()))return null;
 const result=Number(value);return Number.isFinite(result)?result:null;
}
function rounded(value){
 if(!Number.isFinite(value))return null;
 const result=Math.sign(value)*Math.round((Math.abs(value)+Number.EPSILON)*100)/100;
 return Number.isFinite(result)?(Object.is(result,-0)?0:result):null;
}
// Missing money must remain unknown. In particular, Number(null) must never turn
// an incomplete settlement into a zero-return settled bet.
function summarize(records){
 const out={bets:0,wins:0,losses:0,pending:0,review:0,void:0,settled:0,staked:0,settledStaked:0,net:0,roi:null,winRate:null};
 let stakedKnown=true,settledStakedKnown=true,netKnown=true;
 for(const row of checkedRows(records)){
  if(isSkipped(row))continue;
  out.bets++;
  const units=numeric(row.units),validUnits=units!==null&&units>0,status=statusOf(row),net=numeric(row.net_units);
  if(validUnits)out.staked+=units;else stakedKnown=false;
  const neutral=neutralStatuses.has(status)||(status==='settled'&&[row.outcome,row.result].some(value=>neutralStatuses.has(normalized(value))));
  if(neutral){
   // An explicit void/push has zero profit even when the API omits net_units.
   // A contradictory nonzero or malformed supplied return needs review.
   const missingNet=row.net_units===null||row.net_units===undefined;
   if(validUnits&&(missingNet||net===0)){
    out.void++;out.settled++;out.settledStaked+=units;
   }else{
    out.review++;netKnown=false;
    if(!validUnits)settledStakedKnown=false;
   }
  }else if(status==='settled'){
   if(validUnits&&net!==null){
    out.settled++;out.settledStaked+=units;out.net+=net;
    // Do not derive outcome from a positive/negative return or a truthy string.
    if(row.won===true)out.wins++;else if(row.won===false)out.losses++;
   }else{
    out.review++;netKnown=false;
    if(!validUnits)settledStakedKnown=false;
   }
  }else if(pendingStatuses.has(status))out.pending++;
  else out.review++;
 }
 const rawNet=netKnown&&Number.isFinite(out.net)?out.net:null;
 const rawSettledStaked=settledStakedKnown&&Number.isFinite(out.settledStaked)?out.settledStaked:null;
 out.roi=rawNet!==null&&rawSettledStaked!==null&&rawSettledStaked>0?rounded(rawNet/rawSettledStaked*100):null;
 out.winRate=out.wins+out.losses?rounded(out.wins/(out.wins+out.losses)*100):null;
 out.staked=stakedKnown?rounded(out.staked):null;
 out.settledStaked=rawSettledStaked===null?null:rounded(rawSettledStaked);
 out.net=rawNet===null?null:rounded(rawNet);
 return out;
}

function recordDay(row){
 if(!row||typeof row!=='object')return null;
 const value=row.kickoff_at;
 let usable=value instanceof Date?Number.isFinite(value.getTime()):typeof value==='number'?Number.isFinite(value):
  typeof value==='string'&&/^\d{4}-\d{2}-\d{2}(?:$|[T ])/.test(value)&&dates.validDay(value.slice(0,10));
 if(usable){
  const date=dates.day(value);
  if(dates.validDay(date))return date;
 }
 return dates.validDay(row.fixture_date)?row.fixture_date:null;
}

function groupDays(records){
 const groups=new Map();
 for(const row of checkedRows(records)){
  if(isSkipped(row))continue;
  const date=recordDay(row);
  if(!groups.has(date))groups.set(date,[]);
  groups.get(date).push(row);
 }
 // An undated group is retained, last, so its bets and returns cannot disappear
 // silently from reconciliation. The chart can flag it without inventing a date.
 return [...groups.entries()].sort(([a],[b])=>a===null?1:b===null?-1:a.localeCompare(b)).map(([date,rows])=>({...summarize(rows),date}));
}

function validMonth(value){
 return typeof value==='string'&&/^\d{4}-\d{2}$/.test(value)&&dates.validDay(value+'-01');
}
function monthDays(month){
 if(!validMonth(month))return [];
 const result=[];
 for(let day=1;day<=31;day++){
  const date=month+'-'+String(day).padStart(2,'0');
  if(!dates.validDay(date))break;
  result.push(date);
 }
 return result;
}
function shiftMonth(month,amount){
 if(!validMonth(month)||!Number.isInteger(amount))return null;
 const [year,number]=month.split('-').map(Number),index=(year-1)*12+number-1+amount;
 if(!Number.isSafeInteger(index)||index<0||index>=9999*12)return null;
 return String(Math.floor(index/12)+1).padStart(4,'0')+'-'+String(index%12+1).padStart(2,'0');
}
function filterRecords(records,date,query=''){
 if(date!==null&&date!==undefined&&!dates.validDay(date))throw new RangeError('The selected paper bet date must be a valid ISO day.');
 const needle=normalized(query);
 return checkedRows(records).filter(row=>!isSkipped(row)&&(date===null||date===undefined||recordDay(row)===date)&&
  (!needle||[row.home,row.away,row.home_team,row.away_team,row.league,row.league_name,row.market,marketNames[row.market],row.bookmaker,row.outcome,row.status,
   row.won===true?'won win':row.won===false?'lost loss':'',row.fixture_date,recordDay(row)].some(value=>normalized(value).includes(needle))));
}

return Object.freeze({summarize,groupDays,recordDay,monthDays,shiftMonth,filterRecords});
});
