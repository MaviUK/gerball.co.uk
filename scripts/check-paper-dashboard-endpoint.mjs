import assert from 'node:assert/strict';
import {createHandler,ukDay,validDay,validReport} from '../supabase/functions/gerball-paper-dashboard/handler.mjs';

const today='2026-11-27',clock=()=>Date.parse(today+'T16:00:00Z');
const key='sb_publishable_dashboard_test',secret='sb_secret_dashboard_test';
const vars={SUPABASE_PUBLISHABLE_KEYS:JSON.stringify({default:key}),SUPABASE_SECRET_KEYS:JSON.stringify({default:secret}),SUPABASE_URL:'https://dashboard.example'};
const zero=()=>({bets:0,settled:0,won:0,lost:0,pending:0,review:0,missing_odds:0,units:0,units_settled:0,net_units:0,roi_pct:null});
const summary={bets:3,settled:2,won:1,lost:1,pending:1,review:0,missing_odds:0,units:6,units_settled:4,net_units:1,roi_pct:25};
function report(overrides={}){
 return {version:'paper_dashboard_v1',model:'odds',month:'2026-11',date:null,query:'',through_date:today,
  generated_at:today+'T16:00:00Z',earliest_date:'2026-11-25',summary:{...summary},month_summary:{...summary},day_summary:null,
  daily:Array.from({length:30},(_,i)=>({...(i===24?summary:zero()),date:'2026-11-'+String(i+1).padStart(2,'0'),is_future:i>=27})),
  records:[{id:1,home:'Home',away:'Away',date:'2026-11-25',kickoff_at:'2026-11-25T20:00:00Z',market:'H',units:2,odds:2.5,status:'settled',won:true,net_units:3}],
  total_records:3,limit:100,offset:0,...overrides};
}
const expected={model:'odds',month:'2026-11',date:null,query:'',limit:100,offset:0,today};
assert.equal(validReport(report(),expected),true,'Aggregate totals may exceed the displayed page');
assert.equal(validDay('2024-02-29'),true);
assert.equal(validDay('2026-02-29'),false);
assert.equal(ukDay('2026-07-01T23:30:00Z'),'2026-07-02','UK midnight must respect BST');
assert.equal(ukDay('2026-10-25T23:30:00Z'),'2026-10-25','GMT resumes after clock change');
let calls=[];
let result=report(),fail=false;
const handler=createHandler({env:name=>vars[name],now:clock,fetchImpl:async(url,options)=>{
 calls.push({url,options});if(fail)throw new Error('Private service detail');
 return new Response(JSON.stringify(result),{status:200});
}});
const request=(query='',method='GET',apikey=key)=>new Request('https://public.example/functions/v1/gerball-paper-dashboard'+query,{method,headers:{apikey}});
let response=await handler(request());
assert.equal(response.status,200);
assert.equal((await response.json()).summary.bets,3);
assert.equal(calls[0].url,'https://dashboard.example/rest/v1/rpc/gerball_paper_dashboard');
assert.equal(calls[0].options.headers.apikey,secret);
assert.equal(calls[0].options.headers.Authorization,undefined,'Modern secret keys must not be wrapped in a JWT');
assert.deepEqual(JSON.parse(calls[0].options.body),{p_model:'odds',p_month:'2026-11-01',p_date:null,p_query:'',p_limit:100,p_offset:0});
const before=calls.length;
assert.equal((await handler(request('', 'GET','wrong'))).status,401);
assert.equal((await handler(request('', 'POST'))).status,405);
assert.equal((await handler(request('', 'OPTIONS'))).status,204);
for(const query of [
 '?model=all','?month=2026-13','?month=2026-12','?month=2026-11&date=2026-10-31',
 '?date=2026-11-28','?date=2026-02-29','?limit=251','?limit=0','?offset=1000001',
 '?model=odds&model=reverse','?unknown=x','?q=%00', '?q='+'a'.repeat(101)
])assert.equal((await handler(request(query))).status,400,query);
assert.equal(calls.length,before,'Invalid requests must not reach the privileged RPC');
result=report({date:'2026-11-25',query:'home',day_summary:{...summary},limit:25});
response=await handler(request('?date=2026-11-25&q=%20Home%20&limit=25'));
assert.equal(response.status,200);
assert.equal(JSON.parse(calls.at(-1).options.body).p_query,'home');
assert.equal((await response.json()).summary.bets,3,'List searches do not rewrite performance totals');
for(const mutate of [
 x=>x.daily.pop(),x=>x.month_summary.bets++,x=>x.month_summary.net_units++,
 x=>x.records[0].date='2026-11-26',x=>x.records[0].status='pending',
 x=>x.records.push({...x.records[0]}),x=>x.records[0].net_units=null,
 x=>x.through_date='2026-11-28',x=>x.day_summary=zero()
]){
 result=report();mutate(result);
 assert.equal((await handler(request())).status,502,'Invalid upstream data must fail closed');
}
result=report();fail=true;
response=await handler(request());
assert.equal(response.status,502);
assert.equal(response.headers.get('cache-control'),'no-store');
assert.equal((await response.text()).includes('Private'),false,'Service errors must not reveal internal details');
console.log('Paper dashboard endpoint: date boundaries, pagination, totals, input validation and auth checks passed.');
