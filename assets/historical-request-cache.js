'use strict';
// In-memory, public historical RPCs only. No persistent storage, live feeds or private data.
function createHistoricalRequestCache({fetchImpl, ResponseImpl=Response, now=()=>Date.now(), baseUrl, recentMs=30000, historicalMs=300000, maxEntries=96, maxBytes=6*1024*1024}){
  const allowed=new Set(["edgelab_team_comparison","edgelab_recent_team_matches","edgelab_head_to_head","edgelab_match_patterns","edgelab_league_season_trends","edgelab_odds_bands","edgelab_rest_analysis","edgelab_opponent_strength","edgelab_data_coverage","edgelab_odds_movement","edgelab_referee_analysis","edgelab_finishing_analysis","edgelab_setpiece_discipline","edgelab_walkforward_market","edgelab_team_history"]);
  const prefix=baseUrl+"/rest/v1/rpc/";
  const cache=new Map(), pending=new Map();
  let size=0, generation=0;
  const remove=key=>{const value=cache.get(key);if(value){size-=value.bytes;cache.delete(key);}};
  const clear=()=>{generation++;cache.clear();pending.clear();size=0;};
  function info(url,opts){
    if(typeof url!=="string"||!url.startsWith(prefix)||!allowed.has(url.slice(prefix.length))||opts?.method!=="POST"||typeof opts.body!=="string"||Object.keys(opts).some(k=>!["method","headers","body"].includes(k)))return null;
    const headers=opts.headers;
    if(!headers||Object.keys(headers).some(k=>!["apikey","content-type"].includes(k.toLowerCase())))return null;
    const normalized=Object.fromEntries(Object.entries(headers).map(([k,v])=>[k.toLowerCase(),v]).sort(([a],[b])=>a.localeCompare(b)));
    if(typeof normalized.apikey!=="string"||normalized["content-type"]!=="application/json")return null;
    let body;try{body=JSON.parse(opts.body);}catch{return null;}
    if(!body||Array.isArray(body)||typeof body!=="object")return null;
    const params=Object.fromEntries(Object.keys(body).sort().map(k=>[k,body[k]]));
    // Completed date windows and past seasons change less often, but corrections
    // are still possible. Never cache across a page reload or for more than 5m.
    const t=now(), cutoff=new Date(t-14*86400000).toISOString().slice(0,10);
    const year=new Date(t).getUTCFullYear(), month=new Date(t).getUTCMonth();
    const seasonStart=month>=6?year:year-1;
    const current=String(seasonStart%100).padStart(2,"0")+String((seasonStart+1)%100).padStart(2,"0");
    const pastDate=typeof params.p_to==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(params.p_to)&&params.p_to<cutoff;
    const pastSeason=typeof params.p_season==="string"&&/^\d{4}$/.test(params.p_season)&&params.p_season<current;
    return {key:JSON.stringify([url,normalized,params]),ttl:pastDate||pastSeason?historicalMs:recentMs};
  }
  function response(s){return new ResponseImpl([204,205,304].includes(s.status)?null:s.body,{status:s.status,statusText:s.statusText,headers:s.headers});}
  async function request(url,opts){
    const spec=info(url,opts);
    if(!spec)return fetchImpl(url,opts);
    const {key,ttl}=spec;
    const hit=cache.get(key);
    if(hit){if(hit.expires>now()){cache.delete(key);cache.set(key,hit);return response(hit);}remove(key);}
    let work=pending.get(key);
    if(!work){
      if(pending.size>=maxEntries)return fetchImpl(url,opts);
      const version=generation;
      work=(async()=>{
        const raw=await fetchImpl(url,opts);
        const body=await raw.text();
        const snapshot={body,status:raw.status,statusText:raw.statusText,headers:raw.headers,bytes:body.length*2,expires:now()+ttl};
        let valid=false;
        if(raw.ok&&raw.status===200&&snapshot.bytes<=maxBytes/4){try{valid=Array.isArray(JSON.parse(body));}catch{}}
        if(valid&&version===generation){
          remove(key);
          for(const [k,v] of cache)if(v.expires<=now())remove(k);
          while(cache.size&&(cache.size>=maxEntries||size+snapshot.bytes>maxBytes))remove(cache.keys().next().value);
          cache.set(key,snapshot);size+=snapshot.bytes;
        }
        return snapshot;
      })();
      pending.set(key,work);
    }
    try{return response(await work);}finally{if(pending.get(key)===work)pending.delete(key);}
  }
  return {fetch:request,clear};
}
if(typeof module==='object'&&module.exports){module.exports={createHistoricalRequestCache};}
else {window.GerballHistoricalRequests=createHistoricalRequestCache({baseUrl:'https://hdueztssmsvvxkwqgcnm.supabase.co',fetchImpl:window.fetch.bind(window)});}
