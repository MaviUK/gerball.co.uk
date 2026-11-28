import test from 'node:test';
import assert from 'node:assert/strict';
import mod from '../assets/historical-request-cache.js';
const {createHistoricalRequestCache}=mod;
const baseUrl='https://test.example', endpoint=baseUrl+'/rest/v1/rpc/edgelab_walkforward_market';
const options=(body,headers={})=>({method:'POST',headers:{apikey:'public-test','Content-Type':'application/json',...headers},body:JSON.stringify(body)});
function fixture(){
 let now=Date.UTC(2026,10,28),calls=0,status=200,invalid=false;
 const cache=createHistoricalRequestCache({baseUrl,now:()=>now,maxEntries:2,fetchImpl:async()=>{calls++;return new Response(invalid?'not json':JSON.stringify([{call:calls}]),{status,headers:{'Content-Type':'application/json'}})}});
 return {cache,count:()=>calls,advance:ms=>now+=ms,status:s=>status=s,invalid:v=>invalid=v};
}
test('coalesces equal parameters and gives each caller an independent JSON response',async()=>{
 const f=fixture();
 const [a,b]=await Promise.all([f.cache.fetch(endpoint,options({p_market:'H',p_league:'E0'})),f.cache.fetch(endpoint,options({p_league:'E0',p_market:'H'}))]);
 assert.equal(f.count(),1);const av=await a.json();av[0].call=99;assert.deepEqual(await b.json(),[{call:1}]);
 assert.deepEqual(await (await f.cache.fetch(endpoint,options({p_league:'E0',p_market:'H'}))).json(),[{call:1}]);
});
test('keeps old date windows for five minutes and recent results for thirty seconds',async()=>{
 const f=fixture(),old=options({p_to:'2025-01-01'}),recent=options({p_to:'2026-11-27'});
 await f.cache.fetch(endpoint,old);await f.cache.fetch(endpoint,recent);f.advance(31000);
 await f.cache.fetch(endpoint,old);await f.cache.fetch(endpoint,recent);assert.equal(f.count(),3);
 f.advance(300000);await f.cache.fetch(endpoint,old);assert.equal(f.count(),4);
});
test('separates filters, bounds entries and clears explicitly',async()=>{
 const f=fixture();
 for(const p_league of ['E0','E1','D1','E0'])await f.cache.fetch(endpoint,options({p_league}));
 assert.equal(f.count(),4);f.cache.clear();await f.cache.fetch(endpoint,options({p_league:'E0'}));assert.equal(f.count(),5);
});
test('failed and malformed responses are not cached',async()=>{
 const f=fixture();f.status(503);for(let i=0;i<2;i++)assert.equal((await f.cache.fetch(endpoint,options({}))).status,503);
 f.status(200);f.invalid(true);for(let i=0;i<2;i++)await f.cache.fetch(endpoint,options({}));
 assert.equal(f.count(),4);
});
test('bypasses nonhistorical, authenticated and abortable requests',async()=>{
 const f=fixture();
 for(const u of ['/rest/v1/rpc/gerball_paper_dashboard','/rest/v1/rpc/gerball_surebets','/rest/v1/matches'])for(let i=0;i<2;i++)await f.cache.fetch(baseUrl+u,options({}));
 for(let i=0;i<2;i++){await f.cache.fetch(endpoint,options({},{Authorization:'Bearer private'}));await f.cache.fetch(endpoint,{...options({}),signal:new AbortController().signal});}
 assert.equal(f.count(),10);
});
test('clear does not allow a pending request to repopulate cache',async()=>{
 let release,calls=0;
 const cache=createHistoricalRequestCache({baseUrl,fetchImpl:async()=>{calls++;if(calls===1)await new Promise(r=>release=r);return new Response('[]');}});
 const old=cache.fetch(endpoint,options({}));cache.clear();release();await old;await cache.fetch(endpoint,options({}));assert.equal(calls,2);
});
