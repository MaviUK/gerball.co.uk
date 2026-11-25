import assert from 'node:assert/strict';
import fs from 'node:fs';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const url=html.match(/const CLOUD_URL='([^']+)'/)?.[1];
const key=html.match(/const CLOUD_KEY='([^']+)'/)?.[1];
assert(url&&key,'Site must configure a public connection');
assert(html.includes('data-view="picks"')&&html.includes('id="view-picks"'),'Paper bets navigation must be registered');
assert(html.includes('/assets/paper-bets.js'),'Paper bet UI must be loaded');
const js=fs.readFileSync(new URL('../assets/paper-bets.js',import.meta.url),'utf8');
assert(js.includes("root.addEventListener('gerball:viewchange'"),'Paper bets initialize on page activation');
assert(js.includes('recordsCSV'),'Paper bets must export frozen records');
const endpoint=url+'/functions/v1/gerball-paper-bets';
const get=async (path='',options={})=>fetch(endpoint+path,{signal:AbortSignal.timeout(30000),...options});
const unauthenticated=await get();assert.equal(unauthenticated.status,401,'Public requests without the site key must fail');
const invalid=await get('?limit=9999',{headers:{apikey:key}});assert.equal(invalid.status,400,'Unbounded pages must be rejected');
const post=await get('',{method:'POST',headers:{apikey:key}});assert.equal(post.status,405,'Paper ledger must expose no write endpoint');
const response=await get('?limit=250&offset=0',{headers:{apikey:key}});assert.equal(response.status,200,'Paper report must load');
const data=await response.json();
assert.equal(data.version,'paper_ledger_v1');assert.equal(data.model_version,'venue20_league20_shrink_v1');
assert.equal(data.same_match_combinations_available,false);assert.equal(data.cards_markets_available,false);
assert(Array.isArray(data.summary)&&data.summary.length===6);
assert(Array.isArray(data.records)&&Array.isArray(data.preview?.fixtures));
const summary=data.summary.find(row=>row.market==='ALL');
assert(summary);assert.equal(summary.bets,data.total_records);
assert.equal(summary.bets,summary.settled+summary.pending+summary.review);
assert.equal(summary.settled,summary.won+summary.lost);
assert(summary.net_units!==null&&Number.isFinite(Number(summary.net_units)));
assert.equal(summary.roi_pct===null,summary.units_settled===0,'ROI requires settled units');
const markets=['H','D','A','O25','U25'];
const rowIds=new Set();
for(const row of data.records){
  assert(markets.includes(row.market));
  assert(Number.isInteger(row.units)&&row.units>=1&&row.units<=5);
  assert(Number(row.odds)>1);
  assert(!rowIds.has(row.id),'Saved records must be unique');rowIds.add(row.id);
  assert(Date.parse(row.recorded_at)<Date.parse(row.kickoff_at),'Paper prediction must predate kickoff');
  assert(Date.parse(row.quote_collected_at)<=Date.parse(row.recorded_at));
  assert(Date.parse(row.quote_updated_at)<=Date.parse(row.recorded_at));
  assert(Date.parse(row.quote_collected_at)<=Date.parse(row.input.recorded_at));
  assert.equal(row.input.event_id,row.event_id);
  if(row.status==='settled'){
    assert.equal(typeof row.won,'boolean');
    const expected=row.won?Math.round(100*row.units*(Number(row.odds)-1))/100:-row.units;
    assert(Math.abs(Number(row.net_units)-expected)<0.011,'Paper P&L must match saved odds and stake');
  }else{
    assert.equal(row.net_units,null,'Unsettled records cannot add profit or loss');
  }
}
const fixtureIds=new Set();
for(const item of data.preview.fixtures){
  assert(!fixtureIds.has(item.event_id),'One leading recommendation per fixture');
  fixtureIds.add(item.event_id);
  assert(markets.includes(item.market));
  assert(item.decision==='candidate'?(Number.isInteger(item.units)&&item.units>=1&&item.units<=5):item.units===0,
  'No bet must never carry a stake');
  if(item.decision==='candidate'){
    assert(Number(item.estimated_edge)>=0.08,'Candidate requires a modelled edge');
    assert(Date.parse(item.quote_collected_at)<=Date.parse(item.recorded_at));
    assert(Date.parse(item.recorded_at)-Date.parse(item.quote_collected_at)<=120*60*1000);
  }
}
console.log('Paper recommendations verified:',data.preview.fixtures.length,'fixtures;',data.total_records,'recorded paper bets;',summary.net_units,'net units');


// Search is performed on the server over the full saved ledger, not merely the displayed page.
const searchResponse=await get('?q=chelsea&limit=25&offset=0',{headers:{apikey:key}});
assert.equal(searchResponse.status,200,'Searching paper bets should be available');
const searched=await searchResponse.json();
assert.equal(searched.version,'paper_search_v1');
assert.equal(searched.query,'chelsea');
assert(Number.isInteger(searched.total_records)&&Array.isArray(searched.records));
assert(searched.records.every(b=>[b.home,b.away,b.league,b.bookmaker,b.event_id,b.market,b.status,b.fixture_date]
 .some(x=>String(x??'').toLowerCase().includes('chelsea'))),'All search results must match');
const empty=await get('?q=__no_such_team_987654321__&limit=25&offset=0',{headers:{apikey:key}});
assert.equal(empty.status,200);
const noMatches=await empty.json();
assert.equal(noMatches.total_records,0);
assert.deepEqual(noMatches.records,[]);
const excessive=await get('?q='+encodeURIComponent('x'.repeat(101)),{headers:{apikey:key}});
assert.equal(excessive.status,400,'Search input length must be limited');
assert(js.includes('searchInput.type=\'search\''),'Search input must exist');
assert(js.includes('searchLedger(page+1)'),'Filtered searches must keep paging server-side');
assert(js.includes('searchResult?.total_records'),'CSV export must use filtered total');
console.log('Paper bet search verified:',searched.total_records,'matching recorded bets');

const breakdownEndpoint=url+'/functions/v1/gerball-paper-breakdown';
const breakdownDenied=await fetch(breakdownEndpoint,{signal:AbortSignal.timeout(15000)});
assert.equal(breakdownDenied.status,401,'Private grouped results require application key');
const breakdownPost=await fetch(breakdownEndpoint,{method:'POST',headers:{apikey:key},signal:AbortSignal.timeout(15000)});
assert.equal(breakdownPost.status,405,'Grouped report must be read-only');
const breakdownResponse=await fetch(breakdownEndpoint,{headers:{apikey:key},signal:AbortSignal.timeout(30000)});
assert.equal(breakdownResponse.status,200,'Grouped paper reports must be available');
const breakdown=await breakdownResponse.json();
assert.equal(breakdown.version,'paper_breakdown_v1');
assert.equal(breakdown.total_bets,data.total_records);
assert.equal(breakdown.total_net_units,summary.net_units);
for(const kind of ['market','league','home_team','away_team','bookmaker','season']){
 const group=breakdown.groups.filter(x=>x.kind===kind);
 assert.equal(group.reduce((n,x)=>n+x.bets,0),breakdown.total_bets,kind+' bets reconcile');
 assert.equal(group.reduce((n,x)=>n+x.settled,0),breakdown.settled_bets,kind+' settlements reconcile');
 assert.equal(group.reduce((n,x)=>n+Number(x.net_units),0),Number(breakdown.total_net_units),kind+' profit reconciles');
 for(const row of group){
  assert.equal(row.bets,row.settled+row.pending+row.review);
  assert.equal(row.settled,row.won+row.lost);
  assert.equal(row.roi_pct===null,row.settled_units===0,'ROI requires settled bets');
 }
}
const groupedUi=fs.readFileSync(new URL('../assets/paper-breakdown.js',import.meta.url),'utf8');
assert(html.includes('assets/paper-breakdown.js'));
assert(groupedUi.includes('gerball:viewchange')&&groupedUi.includes('pb-breakdown-kind'));
console.log('Paper betting performance groups verified:',breakdown.groups.length,'categories and',breakdown.total_bets,'bets');

const healthEndpoint=url+'/functions/v1/gerball-paper-settlement-health';
const healthNoKey=await fetch(healthEndpoint,{signal:AbortSignal.timeout(18000)});
assert.equal(healthNoKey.status,401,'Settlement health must require application key');
const healthNoWrite=await fetch(healthEndpoint,{method:'POST',headers:{apikey:key},signal:AbortSignal.timeout(18000)});
assert.equal(healthNoWrite.status,405,'Settlement monitor has no public write endpoint');
const healthResponse=await fetch(healthEndpoint,{headers:{apikey:key},signal:AbortSignal.timeout(30000)});
assert.equal(healthResponse.status,200,'Settlement health must be accessible');
const health=await healthResponse.json();
assert.equal(health.version,'paper_settlement_health_v1');
assert.equal(health.records_total,data.total_records);
assert.equal(health.settled,summary.settled);
assert(health.stages.reduce((n,row)=>n+row.bets,0)===health.records_total);
assert(health.pending_after_grace>=0&&health.late_over_48_hours>=0);
assert(health.late_over_48_hours<=health.pending_after_grace+health.review);
assert(health.revisions&&Number.isInteger(health.revisions.total_revisions));
assert(Array.isArray(health.unsettled_examples)&&health.unsettled_examples.length<=40);
for(const row of health.unsettled_examples){
 assert(row.stage!=='settled');
 assert(Number(row.hours_since_kickoff)>=3);
 assert(row.paper_id&&row.observation_id);
}
const settlementUi=fs.readFileSync(new URL('../assets/paper-settlement-health.js',import.meta.url),'utf8');
assert(html.includes('/assets/paper-settlement-health.js'));
assert(settlementUi.includes('paper_settlement_health_v1'));
console.log('Paper settlement health verified:',health.records_total,'tracked,',health.settled,'settled,',health.pending_after_grace,'past grace');

import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const paperDates=require('../assets/paper-dates.js');
assert.equal(paperDates.day('2026-11-25T23:59:59Z'),'2026-11-25','GMT late night');
assert.equal(paperDates.day('2026-11-26T00:00:00Z'),'2026-11-26','GMT next day');
assert.equal(paperDates.day('2026-07-12T22:59:59Z'),'2026-07-12','BST before midnight');
assert.equal(paperDates.day('2026-07-12T23:00:00Z'),'2026-07-13','BST midnight is UTC 23:00');
const fixed=new Date('2026-11-25T18:20:00Z');
const fixtures=[
 {kickoff_at:'2026-11-25T09:00:00Z',event_id:'morning'},
 {kickoff_at:'2026-11-25T20:00:00Z',event_id:'evening'},
 {kickoff_at:'2026-11-26T11:00:00Z',event_id:'tomorrow'},
 {kickoff_at:'2026-11-27T11:00:00Z',event_id:'future'},
 {kickoff_at:'broken',event_id:'invalid'}
];
assert.deepEqual(paperDates.todayOnly(fixtures,fixed).map(x=>x.event_id),['morning','evening'],'only same UK day');
assert.deepEqual(paperDates.upcomingToday(fixtures,fixed).map(x=>x.event_id),['evening'],'assessments exclude started fixtures');
assert.deepEqual(paperDates.todayOnly([],fixed),[],'empty preview');
assert(html.includes('/assets/paper-dates.js'),'London date helper must load before paper bets');
assert(js.includes('dates.upcomingToday('),'Paper bet recommendations must filter by UK day and future kickoff');
assert(js.includes("Today's match assessments"),'Recommendations heading must explain date restriction');
assert(js.includes('Complete paper record'),'Historical ledger is preserved');
console.log('Paper bets UK-day fixtures verified, GMT/BST and historical ledger unchanged.');

const ukDay=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'});
const todayParts=Object.fromEntries(ukDay.formatToParts(new Date()).map(p=>[p.type,p.value]));
const todayUK=todayParts.year+'-'+todayParts.month+'-'+todayParts.day;
const todayResp=await get('?scope=today&limit=250&offset=0',{headers:{apikey:key}});
assert.equal(todayResp.status,200,'Today ledger must be available');
const today=await todayResp.json();
assert.equal(today.version,'paper_today_v1');
assert.equal(today.date,todayUK);
assert(Array.isArray(today.records)&&Number.isInteger(today.total_records));
for(const bet of today.records){
 const parts=Object.fromEntries(ukDay.formatToParts(new Date(bet.kickoff_at)).map(p=>[p.type,p.value]));
 assert.equal(parts.year+'-'+parts.month+'-'+parts.day,todayUK,'Only today UK kickoff is visible');
}
const todaySearch=await get('?scope=today&q=chelsea&limit=250&offset=0',{headers:{apikey:key}});
assert.equal(todaySearch.status,200);
const todayFiltered=await todaySearch.json();
assert.equal(todayFiltered.version,'paper_today_v1');
assert(todayFiltered.total_records<=today.total_records);
assert(todayFiltered.records.every(bet=>[bet.home,bet.away,bet.league,bet.bookmaker,bet.event_id,bet.market,bet.status,bet.fixture_date].some(v=>String(v??'').toLowerCase().includes('chelsea'))));
const invalidScope=await get('?scope=tomorrow',{headers:{apikey:key}});
assert.equal(invalidScope.status,400,'Tomorrow or future bets must not be exposed as Today');
assert(js.includes("ledgerScope='today'"),'Default page should show today');
assert(js.includes("scopeSelect.addEventListener('change'"),'Complete history must remain accessible');
assert(js.includes("scope==='today'?'&scope=today'"),'Date-scoped server paging must be used');
console.log('Today-only paper bets verified:',today.total_records,'UK-day records; historical ledger intact');
