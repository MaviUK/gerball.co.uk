import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {analyse}=require('../assets/paper-movement-math.js');
assert.deepEqual(analyse({original_odds:2,latest_fixed_odds:2.4,model_probability:0.5}),{
 movement:20,oldEdge:0,newEdge:20,preserved:true,direction:'higher'});
assert.deepEqual(analyse({original_odds:2.5,latest_fixed_odds:2,model_probability:0.45}),{
 movement:-20,oldEdge:12.5,newEdge:-10,preserved:false,direction:'lower'});
assert.equal(analyse({original_odds:2,latest_fixed_odds:null,model_probability:0.4}),null);
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const ui=fs.readFileSync(new URL('../assets/paper-odds-movement.js',import.meta.url),'utf8');
const sql=fs.readFileSync(new URL('../supabase/paper-odds-movement-source.sql',import.meta.url),'utf8');
assert(html.includes('/assets/paper-movement-math.js')&&html.includes('/assets/paper-odds-movement.js'));
assert(ui.includes('Cross-bookmaker only')&&ui.includes('Original price')&&ui.includes('later quote'));
assert(sql.includes('q.collected_at<r.kickoff_at')&&sql.includes('r.completed_at>b.recorded_at'));
assert(sql.includes('DISTINCT ON (bet_id,run_id)'),'Per-run best quoted prices required');
const base=html.match(/const CLOUD_URL='([^']+)'/)?.[1],key=html.match(/const CLOUD_KEY='([^']+)'/)?.[1];
assert(base&&key);
const url=base+'/functions/v1/gerball-paper-odds-movement';
let response=await fetch(url,{signal:AbortSignal.timeout(15000)});
assert.equal(response.status,401,'Public endpoint requires publishable application key');
response=await fetch(url,{method:'POST',headers:{apikey:key},signal:AbortSignal.timeout(15000)});
assert.equal(response.status,405,'Report is GET-only');
response=await fetch(url,{headers:{apikey:key},signal:AbortSignal.timeout(25000)});
assert.equal(response.status,200,'Read-only movement report must be operational');
const result=await response.json();
assert.equal(result.version,'paper_odds_movement_v1');
assert.equal(result.total_eligible_bets,result.followed_bets+result.unfollowed_bets);
assert.equal(result.followed_bets,result.positive_model_edge_at_latest+result.nonpositive_model_edge_at_latest);
assert.equal(result.followed_bets,result.higher_fixed_price+result.lower_fixed_price+result.unchanged_fixed_price);
assert(result.same_original_bookmaker_observed<=result.followed_bets);
assert(Number.isInteger(result.upcoming_paper_bets));
assert(Number.isInteger(result.upcoming_unfollowed_bets));
assert(Number.isInteger(result.today_upcoming_unfollowed_bets));
assert(result.today_upcoming_unfollowed_bets<=result.upcoming_unfollowed_bets);
assert(result.upcoming_unfollowed_bets<=result.upcoming_paper_bets);
assert(result.upcoming_paper_bets<=result.total_eligible_bets);

// Each grouping must independently account for every paper bet, including markets
// the 1X2 refresher does not collect. Never derive these counts from capped items.
const coverage=result.coverage;
assert.equal(coverage?.version,'paper_followup_coverage_v1');
assert.match(coverage.uk_date,/^\d{4}-\d{2}-\d{2}$/);
const ukDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'});
assert.equal(coverage.uk_date,ukDate.format(new Date(result.generated_at)));
const countFields=['paper_bets','eligible_bets','followed_bets','unfollowed_bets',
 'upcoming_unfollowed_bets','expired_unfollowed_bets','unsupported_bets'];
const count=(value,label)=>assert(Number.isSafeInteger(value)&&value>=0,label+' must be a nonnegative integer');
function checkStats(row,label){
 for(const field of countFields)count(row[field],label+'.'+field);
 assert.equal(row.paper_bets,row.eligible_bets+row.unsupported_bets,label+' eligibility partitions all paper bets');
 assert.equal(row.eligible_bets,row.followed_bets+row.unfollowed_bets,label+' coverage accounts for every eligible bet');
 assert.equal(row.unfollowed_bets,row.upcoming_unfollowed_bets+row.expired_unfollowed_bets,label+' missing quotes partition at kickoff');
 if(row.eligible_bets===0)assert.equal(row.coverage_pct,null,label+' zero denominator must remain unavailable');
 else{
  assert.equal(typeof row.coverage_pct,'number',label+' coverage rate must be numeric');
  assert(Math.abs(row.coverage_pct-100*row.followed_bets/row.eligible_bets)<=0.00501,label+' rate uses eligible bets only');
 }
 assert.equal(row.last_followup_at===null,row.followed_bets===0,label+' latest quote only exists with observed coverage');
 if(row.last_followup_at!==null)assert(Number.isFinite(Date.parse(row.last_followup_at)),label+' latest quote has a valid time');
}
function uniqueGroups(rows,keys,label){
 const identities=rows.map(row=>JSON.stringify(keys.map(key=>{
  assert.equal(typeof row[key],'string',label+' '+key+' must be present');return row[key];
 })));
 assert.equal(new Set(identities).size,rows.length,label+' groups must be unique');
}
for(const scope of ['all','today']){
 const cohort=coverage[scope];checkStats(cohort.totals,scope+'.totals');
 for(const [group,keys] of [['leagues',['league']],['markets',['market']],['league_markets',['league','market']]]){
  const rows=cohort[group];assert(Array.isArray(rows),scope+'.'+group+' must be an array');
  uniqueGroups(rows,keys,scope+'.'+group);
  rows.forEach((row,i)=>checkStats(row,scope+'.'+group+'['+i+']'));
  for(const field of countFields)assert.equal(rows.reduce((sum,row)=>sum+row[field],0),cohort.totals[field],scope+'.'+group+' reconciles '+field);
  if(cohort.totals.paper_bets===0)assert.equal(rows.length,0,'Empty cohorts have no placeholder groups');
 }
 for(const row of [...cohort.markets,...cohort.league_markets]){
  if(['H','D','A'].includes(row.market))assert.equal(row.unsupported_bets,0,'1X2 selections are eligible');
  else{assert.equal(row.eligible_bets,0,'Other markets must not count as unobserved 1X2 bets');assert.equal(row.coverage_pct,null);}
 }
 for(const league of cohort.leagues)for(const field of countFields)
  assert.equal(cohort.league_markets.filter(row=>row.league===league.league).reduce((sum,row)=>sum+row[field],0),league[field],'League-market cells reconcile league '+league.league+' '+field);
 for(const market of cohort.markets)for(const field of countFields)
  assert.equal(cohort.league_markets.filter(row=>row.market===market.market).reduce((sum,row)=>sum+row[field],0),market[field],'League-market cells reconcile market '+market.market+' '+field);
}
assert.equal(coverage.all.totals.eligible_bets,result.total_eligible_bets);
assert.equal(coverage.all.totals.followed_bets,result.followed_bets);
assert.equal(coverage.all.totals.unfollowed_bets,result.unfollowed_bets);
assert.equal(coverage.all.totals.upcoming_unfollowed_bets,result.upcoming_unfollowed_bets);
assert.equal(coverage.today.totals.upcoming_unfollowed_bets,result.today_upcoming_unfollowed_bets);
for(const field of countFields)assert(coverage.today.totals[field]<=coverage.all.totals[field],'Today is a subset for '+field);

const costFields=['refresh_runs','completed_runs','failed_runs','in_progress_runs','runs_with_followup','newly_followed_bets','reported_credits','unknown_cost_runs'];
function checkCosts(row,label){
 for(const field of costFields)count(row[field],label+'.'+field);
 assert.equal(row.refresh_runs,row.completed_runs+row.failed_runs+row.in_progress_runs,label+' run states reconcile');
 assert(row.runs_with_followup<=row.completed_runs,label+' useful refreshes require a completed run');
 assert(row.unknown_cost_runs<=row.refresh_runs,label+' unknown costs are run-level counts');
 assert(row.newly_followed_bets<=result.followed_bets,label+' new observations count each bet once');
 if(row.runs_with_followup===0)assert.equal(row.newly_followed_bets,0,label+' new coverage needs a valid observation');
}
checkCosts(coverage.collection_today.totals,'collection_today.totals');
assert(Array.isArray(coverage.collection_today.leagues));
uniqueGroups(coverage.collection_today.leagues,['league'],'collection_today.leagues');
coverage.collection_today.leagues.forEach((row,i)=>checkCosts(row,'collection_today.leagues['+i+']'));
for(const field of costFields)assert.equal(coverage.collection_today.leagues.reduce((sum,row)=>sum+row[field],0),coverage.collection_today.totals[field],'Collection league totals reconcile '+field);
const picker=fs.readFileSync(new URL('../supabase/surebet-today-selector.sql',import.meta.url),'utf8');
assert(picker.includes("followed_runs ASC,attempts_today ASC"),'Unfollowed paper bets should get priority');
assert(picker.includes("b.market IN ('H','D','A')"),'Only 1X2 selections can be refreshed and prioritized');
assert(picker.includes("r.status='completed'")||picker.includes("rr.status='completed'"),'Only completed coverage counts');
assert(picker.includes("daily_28_request_cap")&&picker.includes("provider_quota_reserve"),'Provider spend controls must remain');

assert(result.items.length<=100);
for(const row of result.items){
 assert(['H','D','A'].includes(row.market));
 assert(Number(row.original_odds)>1&&Number(row.latest_fixed_odds)>1);
 assert(Date.parse(row.latest_fixed_capture)>Date.parse(row.original_recorded_at));
 assert(Date.parse(row.latest_fixed_capture)<Date.parse(row.kickoff_at));
 const model=analyse(row);assert(model&&model.preserved===(row.edge_status==='positive_model_edge'));
 assert.equal(model.direction,{'higher_fixed_price':'higher','lower_fixed_price':'lower','unchanged':'unchanged'}[row.direction]);
}
console.log('Paper odds movement and coverage verified:',result.followed_bets,'followed of',result.total_eligible_bets,'eligible;',coverage.all.leagues.length,'leagues;',coverage.all.markets.length,'markets;',coverage.collection_today.totals.refresh_runs,'refresh attempts today');
