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
