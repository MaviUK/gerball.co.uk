import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import {createDocument} from './helpers/captured-prices-dom.mjs';

const source=readFileSync(new URL('../assets/paper-coverage.js',import.meta.url),'utf8');
const movementSource=readFileSync(new URL('../assets/paper-odds-movement.js',import.meta.url),'utf8');
const flush=async()=>{for(let i=0;i<4;i++)await new Promise(resolve=>setImmediate(resolve));};
const quoteAt='2026-11-25T15:30:00Z';
function stats(eligible=0,followed=0,upcoming=0,expired=0,unsupported=0){
 return {paper_bets:eligible+unsupported,eligible_bets:eligible,followed_bets:followed,
  unfollowed_bets:eligible-followed,coverage_pct:eligible?Math.round(10000*followed/eligible)/100:null,
  upcoming_unfollowed_bets:upcoming,expired_unfollowed_bets:expired,unsupported_bets:unsupported,
  last_followup_at:followed?quoteAt:null};
}
function costs(overrides={}){
 return {refresh_runs:0,completed_runs:0,failed_runs:0,in_progress_runs:0,
  runs_with_followup:0,newly_followed_bets:0,reported_credits:0,unknown_cost_runs:0,...overrides};
}
function cohort(cells){
 const sum=rows=>{
  const total=stats();
  for(const row of rows)for(const key of ['paper_bets','eligible_bets','followed_bets','unfollowed_bets','upcoming_unfollowed_bets','expired_unfollowed_bets','unsupported_bets'])total[key]+=row[key];
  total.coverage_pct=total.eligible_bets?Math.round(10000*total.followed_bets/total.eligible_bets)/100:null;
  total.last_followup_at=total.followed_bets?quoteAt:null;
  return total;
 };
 const groups=key=>[...new Set(cells.map(cell=>cell[key]))].map(value=>({[key]:value,...sum(cells.filter(cell=>cell[key]===value))}));
 return {totals:sum(cells),leagues:groups('league'),markets:groups('market'),league_markets:cells};
}
function payload(){
 const today=[
  {league:'E0',market:'H',...stats(2,1,1,0)},
  {league:'E0',market:'U25',...stats(0,0,0,0,1)},
  {league:'D1',market:'D',...stats(1,0,0,1)},
 ];
 return {
  version:'paper_followup_coverage_v1',uk_date:'2026-11-25',
  today:cohort(today),all:cohort([...today,{league:'F1',market:'A',...stats(4,3,1,0)}]),
  collection_today:{
   totals:costs({refresh_runs:4,completed_runs:2,failed_runs:1,in_progress_runs:1,runs_with_followup:1,newly_followed_bets:1,reported_credits:3,unknown_cost_runs:1}),
   leagues:[
    {league:'E0',...costs({refresh_runs:3,completed_runs:2,failed_runs:1,runs_with_followup:1,newly_followed_bets:1,reported_credits:3})},
    {league:'F1',...costs({refresh_runs:1,in_progress_runs:1,unknown_cost_runs:1})},
   ],
  },
 };
}
function documentWithSelectDefaults(){
 const document=createDocument(),create=document.createElement;
 document.createElement=tag=>{
  const node=create(tag);
  if(tag.toLowerCase()==='select'){
   node.value='';const append=node.appendChild.bind(node);
   node.appendChild=child=>{const result=append(child);if(node.children.length===1)node.value=child.value;return result;};
  }
  return node;
 };
 return document;
}
function app(){
 const document=documentWithSelectDefaults(),host=document.createElement('section');document.body.append(host);
 let requests=0;
 const context=vm.createContext({document,Date,Intl,tableNames:{E0:'Premier League',D1:'Bundesliga',F1:'Ligue 1'},fetch(){requests++;throw Error('Coverage controls must not fetch odds');}});
 context.window=context;vm.runInContext(source,context);
 const api=context.GerballPaperCoverage.create(host);
 return {document,host,context,api,requests:()=>requests,
  scope:document.getElementById('pb-coverage-scope'),group:document.getElementById('pb-coverage-group'),
  rows:()=>host.querySelectorAll('.pb-coverage-results tbody tr'),
  cells:row=>row.children.map(cell=>cell.textContent)};
}

test('coverage opens on today in UK time and prioritizes upcoming gaps',()=>{
 const value=app();value.api.render(payload());
 assert.equal(value.scope.value,'today');assert.equal(value.group.value,'leagues');
 assert.match(value.host.textContent,/Matches on 2026-11-25 \(UK\)/);
 assert.deepEqual(value.rows().map(row=>value.cells(row)),[
  ['Premier League (E0)','2','1','50.0%','1','0','1'],
  ['Bundesliga (D1)','1','0','0.0%','0','1','0'],
 ]);
 assert.doesNotMatch(value.host.querySelector('.pb-coverage-results').textContent,/Ligue 1/);
 assert.equal(value.requests(),0);
});

test('match scope and all three grouping choices use the same saved report',()=>{
 const value=app();value.api.render(payload());
 value.scope.value='all';value.scope.dispatch('change');
 assert.deepEqual(value.rows().map(row=>value.cells(row)[0]),['Ligue 1 (F1)','Premier League (E0)','Bundesliga (D1)']);
 const total=value.host.querySelector('.pb-coverage-results tfoot tr');
 assert.deepEqual(value.cells(total),['Total','7','4','57.1%','2','1','1']);
 value.group.value='markets';value.group.dispatch('change');
 assert.deepEqual(value.rows().map(row=>value.cells(row)[0]),['Away win','Home win','Draw','Under 2.5 goals']);
 value.group.value='league_markets';value.group.dispatch('change');
 assert.equal(value.rows().length,4);
 assert.match(value.rows().map(row=>row.textContent).join(' '),/Premier League \(E0\) · Under 2.5 goals/);
 assert.equal(value.requests(),0,'Changing grouping never consumes provider requests');
});

test('unsupported markets have no coverage rate and stay outside the eligible total',()=>{
 const value=app();value.api.render(payload());value.group.value='markets';value.group.dispatch('change');
 const unsupported=value.rows().find(row=>row.textContent.includes('Under 2.5 goals'));
 assert.deepEqual(value.cells(unsupported),['Under 2.5 goals','0','0','—','0','0','1']);
 assert.deepEqual(value.cells(value.host.querySelector('.pb-coverage-results tfoot tr')),['Total','3','1','33.3%','1','1','1']);
 const data=payload();data.today=cohort([{league:'E0',market:'U25',...stats(0,0,0,0,2)}]);value.api.render(data);
 assert.match(value.host.querySelector('.pb-coverage-summary').textContent,/Coverage —/);
 assert.doesNotMatch(value.host.querySelector('.pb-coverage-results').textContent,/0\.0%/);
});

test('empty today and empty archive are explicit while collection day remains independent',()=>{
 const value=app(),data=payload();data.today=cohort([]);value.api.render(data);
 assert.equal(value.rows().length,0);assert.match(value.host.textContent,/No paper bets have a kickoff today/);
 assert.match(value.host.querySelector('.pb-coverage-collection').textContent,/Premier League/,'Collection activity remains visible without today matches');
 value.scope.value='all';value.scope.dispatch('change');assert.equal(value.rows().length,3);
 data.all=cohort([]);data.collection_today={totals:costs(),leagues:[]};value.api.render(data);
 assert.match(value.host.textContent,/No paper bets have been recorded yet/);
 assert.match(value.host.textContent,/No refresh attempts have been recorded today/);
 assert.equal(value.host.querySelectorAll('tbody tr').length,0);
});

test('collection credits stay at request level and unfinished costs are visibly unknown',()=>{
 const value=app();value.api.render(payload());
 const table=value.host.querySelector('.pb-coverage-collection table');
 assert.deepEqual(value.cells(table.querySelector('tfoot tr')),['Total','4','2','1','1','3 + unknown for 1 request']);
 value.group.value='league_markets';value.group.dispatch('change');
 value.scope.value='all';value.scope.dispatch('change');
 assert.deepEqual(value.cells(table.querySelector('tfoot tr')),['Total','4','2','1','1','3 + unknown for 1 request']);
 assert.match(value.host.textContent,/1 failed · 1 in progress/);
});

test('untrusted league and market labels are rendered as text',()=>{
 const value=app(),data=payload(),hostile='<img src=x onerror=alert(1)>';
 const cell={league:hostile,market:'<script>alert(2)</script>',...stats(0,0,0,0,1)};
 data.today=cohort([cell]);value.api.render(data);value.group.value='league_markets';value.group.dispatch('change');
 assert.match(value.rows()[0].textContent,/<img src=x onerror=alert\(1\)>/);
 assert.match(value.rows()[0].textContent,/<script>alert\(2\)<\/script>/);
 assert.equal(value.document.querySelectorAll('img,script').length,0);
});

test('clearing a failed or invalid report removes previous counts and disables controls',()=>{
 const value=app();value.api.render(payload());assert.equal(value.rows().length,2);
 value.api.clear('Coverage unavailable after refresh.');
 assert.equal(value.rows().length,0);assert.equal(value.host.querySelectorAll('table').length,0);
 assert.equal(value.scope.disabled,true);assert.equal(value.group.disabled,true);
 assert.match(value.host.textContent,/Coverage unavailable after refresh/);
 value.scope.value='all';value.scope.dispatch('change');assert.equal(value.rows().length,0,'A stale control cannot resurrect the old report');
 value.api.render(payload());assert.equal(value.scope.disabled,false);assert.equal(value.rows().length,3);
 const invalid=payload();invalid.today.totals.eligible_bets=-1;value.api.render(invalid);
 assert.equal(value.rows().length,0);assert.match(value.host.textContent,/Coverage data is not available/);
 value.api.render(null);assert.equal(value.host.querySelectorAll('table').length,0);
});

function movementReport(){
 const coverage=payload(),all=coverage.all.totals;
 return {version:'paper_odds_movement_v1',generated_at:'2026-11-25T16:00:00Z',
  total_eligible_bets:all.eligible_bets,followed_bets:all.followed_bets,unfollowed_bets:all.unfollowed_bets,
  positive_model_edge_at_latest:4,nonpositive_model_edge_at_latest:0,same_original_bookmaker_observed:1,
  upcoming_paper_bets:5,upcoming_unfollowed_bets:2,today_upcoming_unfollowed_bets:1,
  coverage,items:[]};
}
test('the movement report renders coverage even without sampled items and clears it after a failed refresh',async()=>{
 const document=documentWithSelectDefaults(),view=document.createElement('section'),host=document.createElement('div');
 view.id='view-picks';host.id='paperBets';view.append(host);document.body.append(view);
 let fail=false,requests=0;
 const context=vm.createContext({document,Date,Intl,AbortSignal,CLOUD_URL:'https://project.test',CLOUD_KEY:'publishable-test',
  GerballOddsMovement:{analyse(){throw Error('No comparison rows expected');}},addEventListener(){},
  fetch(){requests++;return Promise.resolve(fail?new Response('private error token',{status:502}):Response.json(movementReport()));}});
 context.window=context;vm.runInContext(source,context);vm.runInContext(movementSource,context);await flush();
 assert.equal(requests,1);assert.equal(host.querySelectorAll('.pb-coverage-results tbody tr').length,2);
 assert.match(host.textContent,/No comparisons match this filter/);
 fail=true;host.querySelector('button').click();await flush();
 assert.equal(requests,2);assert.equal(host.querySelectorAll('.pb-coverage-results tbody tr').length,0);
 assert.equal(host.querySelectorAll('.pb-movement-tile').length,0);
 assert.equal(document.getElementById('pb-movement-filter').disabled,true);
 assert.match(host.textContent,/Coverage unavailable because the movement report could not be refreshed/);
 assert.doesNotMatch(host.textContent,/private error token/);
 document.getElementById('pb-movement-filter').dispatch('change');
 assert.equal(host.querySelectorAll('.pb-movement-tile').length,0,'Changing a filter cannot resurrect failed report data');
 fail=false;host.querySelector('button').click();await flush();
 assert.equal(host.querySelectorAll('.pb-coverage-results tbody tr').length,2);
 assert.equal(document.getElementById('pb-movement-filter').disabled,false);
});
