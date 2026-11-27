import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const require=createRequire(import.meta.url);
const math=require('../assets/paper-dashboard-math.js');
const bet=(overrides={})=>({id:'saved-bet',model_version:'odds-v1',home:'Bangor',away:'Ards',league:'E0',
 kickoff_at:'2026-11-27T20:00:00Z',fixture_date:'2026-11-27',market:'H',bookmaker:'Recorded Bookmaker',
 units:2,status:'settled',won:true,net_units:2.5,...overrides});

test('overall totals use settled returns and retain pending/review stakes',()=>{
 const result=math.summarize([
  bet(),bet({id:'loss',units:'3',won:false,net_units:'-3'}),
  bet({id:'pending',status:'pending',units:1,won:true,net_units:99}),
  bet({id:'review',status:'review',units:4,won:false,net_units:-4}),
 ]);
 assert.deepEqual(result,{bets:4,wins:1,losses:1,pending:1,review:1,void:0,settled:2,
  staked:10,settledStaked:5,net:-0.5,roi:-10,winRate:50});
});

test('unavailable odds and explicitly skipped assessments are excluded from all reports',()=>{
 const excluded=['odds_unavailable','skipped','no_bet','excluded','not_selected'].map(status=>bet({status,units:999}));
 excluded.push(bet({skipped:true}),bet({decision:'no_bet'}));
 assert.equal(math.summarize([bet(),...excluded]).bets,1);
 assert.equal(math.summarize([bet(),...excluded]).staked,2);
 assert.equal(math.filterRecords(excluded,null).length,0);
 assert.deepEqual(math.groupDays(excluded),[]);
});

test('void and push are settled neutral outcomes, never wins or losses',()=>{
 const result=math.summarize([bet({status:'void',net_units:null,won:false}),
  bet({status:'push',net_units:0,won:true}),bet({status:'settled',outcome:'Push',net_units:0,won:false})]);
 assert.equal(result.bets,3);assert.equal(result.settled,3);assert.equal(result.void,3);
 assert.equal(result.wins,0);assert.equal(result.losses,0);assert.equal(result.net,0);
 assert.equal(result.staked,6);assert.equal(result.settledStaked,6);assert.equal(result.roi,0);assert.equal(result.winRate,null);
 const corrupt=math.summarize([bet({status:'void',net_units:2})]);
 assert.equal(corrupt.review,1);assert.equal(corrupt.net,null);assert.equal(corrupt.settled,0);
});

test('settled zero is valid while null, blanks, booleans and nonfinite amounts stay unknown',()=>{
 const zero=math.summarize([bet({net_units:0,won:null})]);
 assert.equal(zero.settled,1);assert.equal(zero.net,0);assert.equal(zero.roi,0);assert.equal(zero.wins,0);assert.equal(zero.losses,0);
 for(const invalid of [null,undefined,'',' ',false,true,NaN,Infinity,'Infinity',[],{}]){
  const result=math.summarize([bet(),bet({net_units:invalid})]);
  assert.equal(result.net,null,`Invalid return ${String(invalid)} cannot become zero`);
  assert.equal(result.roi,null);assert.equal(result.review,1);assert.equal(result.settled,1);assert.equal(result.wins,1);
 }
 const missingStake=math.summarize([bet({units:null})]);
 assert.equal(missingStake.staked,null);assert.equal(missingStake.settledStaked,null);assert.equal(missingStake.net,null);
 const missingPendingStake=math.summarize([bet(),bet({status:'pending',units:null,net_units:null})]);
 assert.equal(missingPendingStake.staked,null);assert.equal(missingPendingStake.net,2.5);assert.equal(missingPendingStake.pending,1);
});

test('empty and all-pending reports have no invented win rate or ROI',()=>{
 const empty=math.summarize([]);
 assert.equal(empty.bets,0);assert.equal(empty.net,0);assert.equal(empty.roi,null);assert.equal(empty.winRate,null);
 const pending=math.summarize([bet({status:'pending',net_units:null,won:null})]);
 assert.equal(pending.bets,1);assert.equal(pending.net,0);assert.equal(pending.settled,0);assert.equal(pending.roi,null);
 assert.throws(()=>math.summarize(null),TypeError);assert.throws(()=>math.summarize([null]),TypeError);
});

test('outcomes use strict booleans and rounding happens after aggregation',()=>{
 const records=[bet({units:0.334,net_units:0.004,won:'false'}),bet({units:0.334,net_units:0.004,won:false}),bet({units:0.334,net_units:0.004,won:true})];
 const result=math.summarize(records);
 assert.equal(result.staked,1);assert.equal(result.net,0.01);assert.equal(result.roi,1.2);
 assert.equal(result.wins,1);assert.equal(result.losses,1);assert.equal(result.winRate,50);
 assert.equal(math.summarize([bet({net_units:-0.004})]).net,0);
 assert.equal(Object.is(math.summarize([bet({net_units:-0.004})]).net,-0),false);
 assert.equal(math.summarize([bet({net_units:-1.255})]).net,-1.26);
});

test('UK kickoff dates override stale fixture dates and handle BST and GMT midnight',()=>{
 assert.equal(math.recordDay(bet({kickoff_at:'2026-06-30T23:30:00Z',fixture_date:'2026-06-30'})),'2026-07-01');
 assert.equal(math.recordDay(bet({kickoff_at:'2026-12-31T23:30:00Z'})),'2026-12-31');
 assert.equal(math.recordDay(bet({kickoff_at:'2026-03-29T23:30:00Z'})),'2026-03-30');
 assert.equal(math.recordDay(bet({kickoff_at:'2026-10-25T23:30:00Z'})),'2026-10-25');
 assert.equal(math.recordDay(bet({kickoff_at:null,fixture_date:'2024-02-29'})),'2024-02-29');
 assert.equal(math.recordDay(bet({kickoff_at:'not a date',fixture_date:'2026-11-28'})),'2026-11-28');
 assert.equal(math.recordDay({kickoff_at:null}),null);
 assert.equal(math.recordDay({kickoff_at:'2026-02-30T20:00:00Z',fixture_date:'2026-02-30'}),null);
});

test('calendar helpers handle leap years, century rules and year boundaries',()=>{
 assert.equal(math.monthDays('2024-02').length,29);assert.equal(math.monthDays('2026-02').length,28);
 assert.equal(math.monthDays('2000-02').length,29);assert.equal(math.monthDays('2100-02').length,28);
 assert.equal(math.monthDays('2026-04').length,30);
 assert.deepEqual(math.monthDays('2026-13'),[]);assert.deepEqual(math.monthDays('0000-01'),[]);
 assert.equal(math.shiftMonth('2026-12',1),'2027-01');assert.equal(math.shiftMonth('2026-01',-1),'2025-12');
 assert.equal(math.shiftMonth('2026-11',-24),'2024-11');assert.equal(math.shiftMonth('2026-11',0),'2026-11');
 assert.equal(math.shiftMonth('0001-01',-1),null);assert.equal(math.shiftMonth('9999-12',1),null);
 assert.equal(math.shiftMonth('2026-11',0.5),null);assert.equal(math.shiftMonth('2026-99',1),null);
});

test('daily sums reconcile with overall and retain undated bets explicitly',()=>{
 const records=[bet({id:'one',kickoff_at:'2026-11-26T19:00:00Z',units:3,net_units:4.5}),
  bet({id:'two',won:false,units:1,net_units:-1}),bet({id:'three',status:'pending',units:2,net_units:null}),
  bet({id:'four',status:'void',units:1,net_units:null}),bet({id:'undated',kickoff_at:null,fixture_date:null,units:2,net_units:1.25})];
 const overall=math.summarize(records),days=math.groupDays(records);
 assert.deepEqual(days.map(day=>day.date),['2026-11-26','2026-11-27',null]);
 for(const field of ['bets','wins','losses','pending','review','void','settled','staked','settledStaked','net'])
  assert.equal(days.reduce((sum,day)=>sum+day[field],0),overall[field],field);
 assert.equal(days.at(-1).bets,1);assert.equal(days.at(-1).net,1.25);
 assert.deepEqual(math.groupDays([bet({net_units:null})]).map(day=>day.net),[null]);
});

test('date and text filtering use the same eligible records without collapsing distinct bets',()=>{
 const records=[bet({id:'first',kickoff_at:'2026-06-30T23:30:00Z',fixture_date:'2026-06-30'}),
  bet({id:'second',kickoff_at:'2026-07-01T20:00:00Z',market:'U25',outcome:'Under 2.5 goals'}),
  bet({id:'third',status:'odds_unavailable'}),bet({id:'fourth',status:'review'})];
 assert.equal(math.filterRecords(records,'2026-07-01').length,2);
 assert.equal(math.filterRecords(records,null,'  bAnGoR ').length,3);
 assert.equal(math.filterRecords(records,null,'UNDER 2.5').length,1);
 assert.equal(math.filterRecords(records,null,'recorded bookmaker').length,3);
 assert.equal(math.filterRecords(records,null,'review').length,1);
 assert.equal(math.filterRecords(records,'2026-06-30').length,0);
 assert.equal(math.summarize(records).bets,3);
 assert.throws(()=>math.filterRecords(records,'2026-02-30'),RangeError);
});

test('browser UMD exposes the same API using the existing date helper',()=>{
 const context=vm.createContext({Intl,Date});
 vm.runInContext(readFileSync(new URL('../assets/paper-dates.js',import.meta.url),'utf8'),context);
 vm.runInContext(readFileSync(new URL('../assets/paper-dashboard-math.js',import.meta.url),'utf8'),context);
 assert.equal(typeof context.GerballPaperDashboardMath.summarize,'function');
 assert.equal(context.GerballPaperDashboardMath.recordDay(bet({kickoff_at:'2026-06-30T23:30:00Z'})),'2026-07-01');
 assert.equal(context.GerballPaperDashboardMath.summarize([bet()]).net,2.5);
});
