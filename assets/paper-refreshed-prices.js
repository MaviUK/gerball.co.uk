(function(root){'use strict';
const view=root.document.getElementById('view-picks'),holder=root.document.getElementById('paperBets');
const helper=root.GerballPaperPriceHelpers;
if(!view||!holder||!helper)return;
const list=holder.querySelector('.pb-list');if(!list||!list.parentElement)return;
const el=(tag,content,cls)=>{const node=root.document.createElement(tag);if(content!==undefined)node.textContent=String(content);if(cls)node.className=cls;return node};
const panel=el('div',undefined,'pb-live-prices');
const top=el('div',undefined,'pb-price-head');top.append(el('strong','Intraday bookmaker price comparisons'));
const refresh=el('button','Update captured comparisons','secondary');refresh.type='button';top.append(refresh);panel.append(top);
const status=el('p','No refreshed prices loaded yet.','pb-caption');status.setAttribute('role','status');panel.append(status);
const tableHost=el('div');panel.append(tableHost);
const note=el('p','Uses archived 15-minute collector results for selected fixtures, not live bookmaker access. Fixed-odds Home/Draw/Away only; bookmaker limits, odds changes and fees can apply. Original paper-bet prices and units are never replaced.','pb-caption');panel.append(note);
list.parentElement.insertBefore(panel,list);
let report=null,loading=false,lastLoaded=0,controller=null;
const millis=t=>Date.parse(t);
const showDate=t=>{const d=new Date(t);return Number.isFinite(d.getTime())?d.toLocaleString('en-GB',{timeZone:'Europe/London',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})+' UK':'Unavailable'};
root.GerballPaperPriceComparison={get:(eventId,market,kickoff,now)=>helper.currentQuote(report,eventId,market,kickoff,now)};
function active(){return !view.hidden&&!root.document.hidden&&(!holder.dataset.paperTab||holder.dataset.paperTab==='odds')}
function render(){
 tableHost.replaceChildren();
 if(!report)return;
 const rows=report.prices.filter(q=>millis(q.kickoff_at)>Date.now());
 const byEvent=new Map();
 for(const quote of rows){
  if(!byEvent.has(quote.event_id))byEvent.set(quote.event_id,[]);
  byEvent.get(quote.event_id).push(quote)
 }
 status.textContent='Today: '+report.total_eligible_events+' remaining fixture(s) · '+
  report.events_with_refresh+' sampled · '+report.total_prices+' fixed-odds market prices · '+
  'Latest saved check: '+showDate(report.last_refresh_at)+'.';
 if(!rows.length){tableHost.append(el('p','No intraday comparison is stored for today’s remaining matches yet. The 15-minute collector checks one selected match per run; midday prices remain research-only.','pb-caption'));return}
 const scroll=el('div',undefined,'pb-table-wrap'),table=el('table'),header=el('thead'),tr=el('tr');
 for(const text of ['Fixture','Selection','Quoted odds','Bookmaker','Captured','Quote age'])tr.append(el('th',text));
 header.append(tr);table.append(header);
 const tbody=el('tbody');
 for(const quotes of byEvent.values()){
  for(const q of quotes){
   const row=el('tr'),age=Math.max(0,Math.floor((Date.now()-millis(q.quote_collected_at))/60000));
   const refreshed=helper.currentQuote(report,q.event_id,q.selection,q.kickoff_at,new Date());
   const labels=['H','D','A'];
   const cells=[q.home+' v '+q.away,labels.includes(q.selection)?({H:'Home',D:'Draw',A:'Away'}[q.selection]):q.selection,
    Number(q.odds).toFixed(2),q.bookmaker,showDate(q.quote_collected_at),
    refreshed?.fresh?'Recent ('+age+'m)':'Older snapshot ('+age+'m)'];
   for(const cell of cells)row.append(el('td',cell));
   tbody.append(row);
  }
 }
 table.append(tbody);scroll.append(table);tableHost.append(scroll);
}
function publish(){if(typeof root.CustomEvent==='function')root.dispatchEvent(new root.CustomEvent('gerball:paper-refreshed-prices'))}
async function load(force=false){
 if(!active()||loading||(!force&&lastLoaded&&Date.now()-lastLoaded<5*60000))return;
 loading=true;refresh.disabled=true;status.textContent='Loading stored intraday bookmaker comparisons…';
 controller=new AbortController();
 try{
  const r=await root.fetch(CLOUD_URL+'/functions/v1/gerball-paper-refreshed-prices',{headers:{apikey:CLOUD_KEY},signal:AbortSignal.any([controller.signal,AbortSignal.timeout(18000)])});
  if(!r.ok)throw Error('Comparison feed unavailable ('+r.status+')');
  const data=await r.json();
  if(data.version!=='paper_price_refresh_v1'||!Array.isArray(data.prices)||!Number.isInteger(data.total_prices)||data.prices.length!==data.total_prices)throw Error('Invalid comparison feed');
  if(!active())return;
  report=data;lastLoaded=Date.now();render();publish();
 }catch(e){if(e?.name==='AbortError')return;status.textContent='Could not refresh stored comparisons: '+e.message; if(report)render()}
 finally{loading=false;refresh.disabled=false;controller=null}
}
function tick(){
 if(!active()){if(controller)controller.abort();return}
 if(report)render();
 if(!lastLoaded||Date.now()-lastLoaded>=5*60000)load();
}
refresh.addEventListener('click',()=>load(true));
 root.addEventListener('gerball:paper-tabchange',e=>{if(e.detail?.tab==='odds')load();else controller?.abort()});
root.addEventListener('gerball:viewchange',e=>{if(e.detail?.view==='picks')load();else if(controller)controller.abort()});
root.document.addEventListener('visibilitychange',tick);
root.setInterval(tick,60000);
if(!view.hidden)load();
})(window);