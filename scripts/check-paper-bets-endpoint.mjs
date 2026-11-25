import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source=readFileSync(new URL('../supabase/functions/gerball-paper-bets/index.ts',import.meta.url),'utf8');
const BASE='https://site.test/functions/v1/gerball-paper-bets';
const APP_KEY='sb_publishable_test_app';
const SERVER_KEY='sb_secret_server_only';
const initial='2026-11-25T13:00:00Z';
const emptySummary=()=>({bets:0,settled:0,pending:0,review:0,won:0,lost:0,units_recommended:0,units_settled:0,net_units:0,roi_pct:null});
const dayPayload=(date='2026-11-24',overrides={})=>({
 version:'paper_day_v1',query:'',date,total_records:0,records:[],summary:emptySummary(),
 limit:250,offset:0,...overrides,
});
const record=(overrides={})=>({
 id:1,home:'Home',away:'Away',kickoff_at:'2026-11-24T20:00:00Z',
 market:'H',odds:2.1,units:2,status:'settled',home_goals:2,away_goals:0,
 won:true,net_units:2.2,...overrides,
});
const oneSummary=()=>({bets:1,settled:1,pending:0,review:0,won:1,lost:0,units_recommended:2,units_settled:2,net_units:2.2,roi_pct:110});

function app({fetchImpl=async()=>Response.json(dayPayload()),clock=initial,env:overrides={}}={}){
 let handler;
 let now=Date.parse(clock);
 const calls=[];
 const env={
  SUPABASE_URL:'https://database.test/',
  SUPABASE_PUBLISHABLE_KEYS:JSON.stringify({default:APP_KEY}),
  SUPABASE_SECRET_KEYS:JSON.stringify({default:SERVER_KEY}),
  ...overrides,
 };
 class Clock extends Date{
  constructor(...args){super(...(args.length?args:[now]));}
  static now(){return now;}
 }
 vm.runInNewContext(source,{
  Request,Response,URL,Intl,Date:Clock,AbortSignal,
  console:{error(){}},
  Deno:{env:{get:name=>env[name]},serve:fn=>{handler=fn;}},
  fetch:async(url,options)=>{
   const call={url,options,body:JSON.parse(options.body)};
   calls.push(call);return fetchImpl(call);
  },
 });
 return {
  calls,
  setClock(value){now=Date.parse(value);},
  request:(path='',options={})=>handler(new Request(BASE+path,{headers:{apikey:APP_KEY},...options})),
 };
}

test('auth, preflight and mutation rejection never read the database',async()=>{
 const ui=app();
 assert.equal((await ui.request('?scope=date&date=2026-11-24',{headers:{}})).status,401);
 assert.equal((await ui.request('?scope=date&date=2026-11-24',{headers:{apikey:'sb_publishable_other'}})).status,401);
 const options=await ui.request('',{method:'OPTIONS',headers:{}});
 assert.equal(options.status,204);
 assert.equal(options.headers.get('access-control-allow-methods'),'GET, OPTIONS');
 for(const method of ['POST','PUT','PATCH','DELETE'])assert.equal((await ui.request('',{method})).status,405);
 assert.equal(ui.calls.length,0);
});

test('date scope requires one real calendar day on or before today in London',async()=>{
 const ui=app();
 for(const query of [
  'scope=date','scope=date&date=','date=2026-11-24','scope=today&date=2026-11-24',
  'scope=history&date=2026-11-24','scope=tomorrow','scope=date&scope=today&date=2026-11-24',
  'scope=date&date=2026-11-24&date=2026-11-23',
  'scope=date&date=2026-11-26','scope=date&date=2026-02-29','scope=date&date=2024-02-30',
  'scope=date&date=2026-04-31','scope=date&date=2026-00-01','scope=date&date=2026-13-01',
  'scope=date&date=0000-01-01','scope=date&date=26-11-24','scope=date&date=2026-1-2',
  'scope=date&date=2026-11-24T00%3A00%3A00Z','scope=date&date=%202026-11-24',
  'scope=date&date=2026-11-24&extra=1',
 ]){
  const response=await ui.request('?'+query);
  assert.equal(response.status,400,query);
  assert.equal(response.headers.get('cache-control'),'no-store');
 }
 assert.equal(ui.calls.length,0);
});

test('query and pagination remain bounded for all scopes',async()=>{
 const ui=app();
 for(const query of [
  'scope=date&date=2026-11-24&q='+('x'.repeat(101)),
  'scope=date&date=2026-11-24&q=a%00b','scope=date&date=2026-11-24&q=a%0Ab',
  'scope=date&date=2026-11-24&q=a&q=b','scope=date&date=2026-11-24&limit=0',
  'scope=date&date=2026-11-24&limit=1001','scope=date&date=2026-11-24&limit=1.5',
  'scope=date&date=2026-11-24&offset=-1','scope=date&date=2026-11-24&offset=50001',
  'scope=date&date=2026-11-24&offset=0&offset=1',
 ]){
  assert.equal((await ui.request('?'+query)).status,400,query);
 }
 assert.equal(ui.calls.length,0);
});

test('selected date, search and pagination use a fixed parameterized read-only RPC',async()=>{
 const payload=dayPayload('2026-11-24',{
  query:'home',total_records:1,records:[record()],summary:oneSummary(),limit:10,
 });
 const ui=app({fetchImpl:async()=>Response.json(payload)});
 const response=await ui.request('?scope=date&date=2026-11-24&q=%20HOME%20&limit=10&offset=0');
 assert.equal(response.status,200);
 assert.deepEqual(await response.json(),payload);
 assert.equal(ui.calls.length,1);
 assert.equal(ui.calls[0].url,'https://database.test/rest/v1/rpc/gerball_paper_day');
 assert.deepEqual(ui.calls[0].body,{p_date:'2026-11-24',p_query:' HOME ',p_limit:10,p_offset:0});
 assert.equal(ui.calls[0].options.method,'POST');
 assert.equal(ui.calls[0].options.headers.apikey,SERVER_KEY);
 assert.equal(ui.calls[0].options.headers.Authorization,undefined);
 assert.match(response.headers.get('cache-control'),/max-age=30/);
 assert.equal(response.headers.get('access-control-allow-origin'),'*');
 assert.equal(response.headers.get('apikey'),null);
});

test('valid leap days and London summer midnight are accepted',async()=>{
 for(const [clock,date,kickoff] of [
  [initial,'2024-02-29','2024-02-29T20:00:00Z'],
  ['2026-07-12T23:30:00Z','2026-07-13','2026-07-12T23:15:00Z'],
  ['2026-03-29T23:30:00Z','2026-03-30','2026-03-29T23:15:00Z'],
  ['2026-10-25T23:30:00Z','2026-10-25','2026-10-25T23:15:00Z'],
 ]){
  const payload=dayPayload(date,{total_records:1,summary:oneSummary(),records:[record({kickoff_at:kickoff})]});
  const ui=app({clock,fetchImpl:async()=>Response.json(payload)});
  assert.equal((await ui.request('?scope=date&date='+date)).status,200,clock+' / '+date);
 }
 const beforeMidnight=app({clock:'2026-07-12T22:59:59Z'});
 assert.equal((await beforeMidnight.request('?scope=date&date=2026-07-13')).status,400);
});

test('today and complete history retain their original versions and RPC routing',async()=>{
 for(const [path,rpc,payload,args] of [
  ['?scope=today','gerball_paper_today',dayPayload('2026-11-25',{version:'paper_today_v1'}),{p_query:'',p_limit:250,p_offset:0}],
  ['?scope=today&q=home','gerball_paper_today',dayPayload('2026-11-25',{version:'paper_today_v1',query:'home'}),{p_query:'home',p_limit:250,p_offset:0}],
  ['','gerball_paper_report',{version:'paper_ledger_v1',summary:[],records:[],preview:{fixtures:[]},total_records:0},{p_limit:250,p_offset:0}],
  ['?scope=history','gerball_paper_report',{version:'paper_ledger_v1',summary:[],records:[],preview:{fixtures:[]},total_records:0},{p_limit:250,p_offset:0}],
  ['?scope=history&q=home','gerball_paper_search',{version:'paper_search_v1',query:'home',records:[],total_records:0},{p_query:'home',p_limit:250,p_offset:0}],
 ]){
  const ui=app({fetchImpl:async()=>Response.json(payload)});
  const response=await ui.request(path);
  assert.equal(response.status,200,path);
  assert.deepEqual(await response.json(),payload);
  assert.equal(ui.calls[0].url,'https://database.test/rest/v1/rpc/'+rpc);
  assert.deepEqual(ui.calls[0].body,args);
 }
});

test('date totals may describe more records than the page and unresolved records stay unresolved',async()=>{
 const summary={bets:503,settled:300,pending:200,review:3,won:150,lost:150,units_recommended:1006,units_settled:600,net_units:30,roi_pct:5};
 const payload=dayPayload('2026-11-24',{total_records:503,summary,offset:500,limit:2,records:[
  record({id:501,status:'pending',won:null,net_units:null,home_goals:null,away_goals:null}),
  record({id:502,status:'review',won:null,net_units:null,home_goals:null,away_goals:null}),
 ]});
 const ui=app({fetchImpl:async()=>Response.json(payload)});
 const response=await ui.request('?scope=date&date=2026-11-24&limit=2&offset=500');
 assert.equal(response.status,200);
 const actual=await response.json();
 assert.deepEqual(actual.summary,summary);
 assert.equal(actual.records.length,2);
 assert(actual.records.every(row=>row.net_units===null&&row.won===null));
});

test('wrong dates, malformed payloads and inconsistent day totals fail closed',async()=>{
 const base=dayPayload('2026-11-24',{total_records:1,records:[record()],summary:oneSummary()});
 const invalid=[
  {...base,version:'paper_today_v1'},
  {...base,date:'2026-11-23'},
  {...base,query:'another search'},
  {...base,total_records:-1},
  {...base,total_records:0},
  {...base,records:null},
  {...base,records:[record({kickoff_at:'invalid'})]},
  {...base,records:[record({kickoff_at:'2026-11-25T00:00:00Z'})]},
  {...base,summary:null},
  {...base,summary:{...base.summary,bets:2}},
  {...base,summary:{...base.summary,won:2}},
  {...base,summary:{...base.summary,pending:1}},
  {...base,summary:{...base.summary,units_settled:3}},
  {...base,summary:{...base.summary,net_units:'unknown'}},
  {...base,summary:{...base.summary,roi_pct:null}},
  dayPayload('2026-11-24',{summary:{...emptySummary(),roi_pct:0}}),
 ];
 for(const payload of invalid){
  const ui=app({fetchImpl:async()=>Response.json(payload)});
  const response=await ui.request('?scope=date&date=2026-11-24');
  assert.equal(response.status,502,JSON.stringify(payload));
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.doesNotMatch(await response.text(),/sb_secret|another search/);
 }
});

test('configuration and upstream failures do not expose service details',async()=>{
 for(const fetchImpl of [
  async()=>new Response('database secret '+SERVER_KEY,{status:500}),
  async()=>{throw new Error('database secret '+SERVER_KEY);},
  async()=>new Response('invalid JSON'),
 ]){
  const ui=app({fetchImpl});
  const response=await ui.request('?scope=date&date=2026-11-24');
  assert.equal(response.status,502);
  assert.doesNotMatch(await response.text(),/database|secret|sb_secret/);
 }
 const missing=app({env:{SUPABASE_SECRET_KEYS:'{}',SUPABASE_SERVICE_ROLE_KEY:undefined}});
 assert.equal((await missing.request('?scope=date&date=2026-11-24')).status,503);
 assert.equal(missing.calls.length,0);
 const legacy=app({env:{SUPABASE_SECRET_KEYS:'{}',SUPABASE_SERVICE_ROLE_KEY:'legacy-server-key'}});
 assert.equal((await legacy.request('?scope=date&date=2026-11-24')).status,200);
 assert.equal(legacy.calls[0].options.headers.Authorization,'Bearer legacy-server-key');
});

test('a Today query spanning UK midnight accepts only the request day or the new current day',async()=>{
 const ui=app({clock:'2026-11-25T23:59:59Z',fetchImpl:async()=>{
  ui.setClock('2026-11-26T00:00:00Z');
  return Response.json(dayPayload('2026-11-26',{version:'paper_today_v1'}));
 }});
 assert.equal((await ui.request('?scope=today')).status,200);
 const stale=app({fetchImpl:async()=>Response.json(dayPayload('2026-11-24',{version:'paper_today_v1'}))});
 assert.equal((await stale.request('?scope=today')).status,502);
});

