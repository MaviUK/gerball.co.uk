(function(root){'use strict';
const doc=root.document,host=doc.getElementById('paperBets'),view=doc.getElementById('view-picks');
if(!host||!view)return;
const p=doc.getElementById('gb-paper-pane-backtest');
if(!p)return;
const node=(tag,content,cls)=>{const x=doc.createElement(tag);if(content!==undefined)x.textContent=String(content);if(cls)x.className=cls;return x};
const money=n=>n===null||n===undefined||!Number.isFinite(Number(n))?'—':(Number(n)>0?'+':'')+Number(n).toFixed(2)+'u';
const pct=n=>n===null||n===undefined||!Number.isFinite(Number(n))?'—':Number(n).toFixed(2)+'%';
const labels={H:'Home',D:'Draw',A:'Away',O25:'Over 2.5',U25:'Under 2.5'};
const lead=node('div',undefined,'gb-backtest-lead');
lead.append(node('span','HISTORICAL RECONSTRUCTION · NOT LIVE BETS','gb-backtest-label'),
 node('h2','Historical paper-bet simulation'),
 node('p','Replays the original model using only earlier match results. The original and reverse selections use archived pre-match prices from football-data.co.uk. These are reconstructed, not predictions saved on those days. Exact midday bookmaker prices cannot be verified.','pb-caption'));
const flags=node('div',undefined,'gb-backtest-flags');
for(const val of ['No results used as inputs','Betfair Exchange CSV → bet365 fallback','No commission included'])flags.append(node('span',val));
lead.append(flags);p.append(lead);
const control=node('div',undefined,'gb-backtest-controls');
function selector(title,options){
 const box=node('label',undefined,'gb-backtest-filter');
 box.append(node('span',title));
 const sel=node('select');for(const [value,label] of options){const op=node('option',label);op.value=value;sel.append(op)}box.append(sel);control.append(box);return sel;
}
const season=selector('Season',[['','All seasons'],['2324','2023/24'],['2425','2024/25'],['2526','2025/26'],['2627','2026/27']]);
const league=selector('League',[['','All leagues'],...['B1','D1','D2','E0','E1','E2','E3','F1','F2','G1','I1','I2','N1','P1','SC0','SC1','SC2','SC3','SP1','SP2','T1'].map(l=>[l,l])]);
const refresh=node('button','Refresh backtest','secondary');refresh.type='button';control.append(refresh);
p.append(control);
const status=node('p','Loading historical backtest…','pb-caption');status.setAttribute('role','status');p.append(status);
const progress=node('div',undefined,'gb-backtest-progress'),summary=node('div',undefined,'gb-backtest-summary'),
seasons=node('div',undefined,'gb-backtest-seasons'),daily=node('div',undefined,'gb-backtest-daily'),bets=node('div',undefined,'gb-backtest-bets');
p.append(progress,summary,seasons,daily,bets);
let request=null,offset=0,cache=null;
function metric(label,value){const m=node('div',undefined,'gb-backtest-metric');m.append(node('small',label),node('strong',value));return m}
function wrapTable(columns,rows){
 const scroll=node('div',undefined,'pb-table-wrap gb-backtest-scroll');const table=node('table');const head=node('thead');const tr=node('tr');
 for(const c of columns){const th=node('th',c);th.scope='col';tr.append(th)}head.append(tr);table.append(head);
 const body=node('tbody');for(const vals of rows){const row=node('tr');vals.forEach((v,i)=>{const td=node('td',v);td.setAttribute('data-label',columns[i]);if(typeof v==='string'&&/^[+-]\d+\.\d+u$/.test(v))td.className=v.startsWith('-')?'pb-negative':'pb-positive';row.append(td)});body.append(row)}table.append(body);scroll.append(table);return scroll;
}
function show(data,append=false){
 const t=data.summary||{},coverage=data.progress||{},rows=data.bets||[];
 if(!append){
  progress.replaceChildren();summary.replaceChildren();seasons.replaceChildren();daily.replaceChildren();bets.replaceChildren();
  const completed=Number(coverage.assessed||0),available=Number(coverage.available||0);
  const progressLabel=node('p',completed.toLocaleString('en-GB')+' of '+available.toLocaleString('en-GB')+
   ' historical fixtures replayed'+(coverage.skipped?' · '+coverage.skipped+' skipped':'')+
   '. Results remain incomplete until the replay reaches 100%.','pb-caption');
  const bar=node('div',undefined,'gb-backtest-track'),fill=node('div',undefined,'gb-backtest-fill');
  fill.style.width=(available?Math.min(100,100*completed/available):0)+'%';bar.append(fill);progress.append(progressLabel,bar);
  const cards=[
   {name:'Original odds model',bets:t.original_bets,won:t.original_won,lost:t.original_lost,stake:t.original_staked,net:t.original_net,roi:t.original_roi_pct},
   {name:'Reverse paper bets',bets:t.reverse_bets,won:t.reverse_won,lost:t.reverse_lost,stake:t.reverse_staked,net:t.reverse_net,roi:t.reverse_roi_pct}
  ];
  for(const b of cards){
   const card=node('section',undefined,'gb-backtest-card');card.append(node('h3',b.name));
   const grid=node('div',undefined,'gb-backtest-stats');
   for(const [label,value] of [['Bets',b.bets||0],['Won / Lost',(b.won||0)+' / '+(b.lost||0)],['Staked',(b.stake||0)+'u'],['Net P&L',money(b.net)],['ROI',pct(b.roi)]]){
    const cell=metric(label,value);if(label==='Net P&L')cell.classList.add(Number(b.net)<0?'gb-bt-negative':'gb-bt-positive');grid.append(cell);
   }
   card.append(grid);summary.append(card)
  }
  seasons.append(node('h3','P&L by season'));
  seasons.append(wrapTable(['Season','Analysed','Odds bets','Odds P&L','Reverse bets','Reverse P&L'],(data.seasons||[]).map(x=>[
   x.season.slice(0,2)+'/20'+x.season.slice(2),x.assessed,x.original_bets,money(x.original_net),x.reverse_bets,money(x.reverse_net)
  ])));
  daily.append(node('h3','Daily P&L and running totals'));
  daily.append(node('p','Dates are match dates. Both strategies are calculated separately, with zero-bet matchdays included.','pb-caption'));
  if(!(data.daily||[]).length)daily.append(node('p','No historical dates have been replayed for this filter.','pb-caption'));
  else daily.append(wrapTable(['Date','Odds bets','Daily odds P&L','Odds total','Reverse bets','Daily reverse P&L','Reverse total'],data.daily.map(x=>[
   x.match_date,x.original_bets,money(x.original_net),money(x.original_cumulative),
   x.reverse_bets,money(x.reverse_net),money(x.reverse_cumulative)
  ])));
  bets.append(node('h3','Reconstructed selections'));
  bets.append(node('p','The odds field identifies the archived price source. A reverse bet exists only when the original market is Home or Away and its opposite price is available.','pb-caption'));
 }else{
  const old=bets.querySelector('.gb-backtest-scroll');if(old)old.remove();
 }
 if(!rows.length&&offset===0){bets.append(node('p','No selections in this replay sample.','pb-caption'));return}
 if(append){cache=[...(cache||[]),...rows]}else cache=rows.slice();
 const cols=['Date','Fixture','Result','Original selection','Odds / Source','Stake','Original P&L','Reverse selection','Reverse odds','Reverse P&L'];
 const body=cache.map(x=>[x.date,x.home+' v '+x.away,x.score+' ('+x.actual+')',labels[x.market]||x.market,
  Number(x.odds).toFixed(2)+' · '+(x.bookmaker==='Betfair Exchange'?'Betfair':x.bookmaker||'—'),
  x.units+'u',money(x.net_units),labels[x.reverse_market]||'No reverse',x.reverse_odds?Number(x.reverse_odds).toFixed(2):'—',
  x.reverse_net_units===null?'—':money(x.reverse_net_units)]);
 bets.append(wrapTable(cols,body));
 const previous=bets.querySelector('.gb-backtest-more');if(previous)previous.remove();
 if(rows.length===100){
  const more=node('button','Load more historical bets','secondary gb-backtest-more');more.type='button';more.addEventListener('click',()=>{offset+=100;load(true)});bets.append(more)
 }
}
async function load(more=false){
 if(view.hidden||host.dataset.paperTab!=='backtest')return;
 request?.abort();const ctrl=new AbortController();request=ctrl;refresh.disabled=true;
 if(!more){offset=0;cache=null;}
 status.textContent='Retrieving retrospective model simulation…';
 try{
  const params=new URLSearchParams({scope:'csv_backtest',limit:'100',offset:String(offset)});
  if(season.value)params.set('season',season.value);
  if(league.value)params.set('league',league.value);
  const res=await root.fetch(CLOUD_URL+'/functions/v1/gerball-paper-bets?'+params.toString(),
   {headers:{apikey:CLOUD_KEY},signal:AbortSignal.any([ctrl.signal,AbortSignal.timeout(25000)])});
  if(!res.ok)throw Error('Backtest request '+res.status);
  const data=await res.json();if(request!==ctrl||host.dataset.paperTab!=='backtest')return;
  if(data.version!=='gerball_csv_backtest_v1'||data.source_mode!=='retrospective_date_cutoff'||
    !Array.isArray(data.bets)||!Array.isArray(data.daily))throw Error('Invalid historical results');
  show(data,more);
  status.textContent=(data.progress?.assessed||0).toLocaleString('en-GB')+' fixtures tested · '+
   (data.summary?.original_bets||0)+' original selections · '+
   (data.summary?.reverse_bets||0)+' reverse selections · RETROSPECTIVE, NOT LIVE';
 }catch(e){if(request===ctrl&&e.name!=='AbortError')status.textContent='Unable to load historical backtest: '+e.message}
 finally{if(request===ctrl){request=null;refresh.disabled=false}}
}
season.addEventListener('change',()=>load());league.addEventListener('change',()=>load());refresh.addEventListener('click',()=>load());
root.addEventListener('gerball:paper-tabchange',e=>{if(e.detail?.tab==='backtest')load();else request?.abort()});
root.addEventListener('gerball:viewchange',e=>{if(e.detail?.view==='picks'&&host.dataset.paperTab==='backtest')load();else request?.abort()});
if(!view.hidden&&host.dataset.paperTab==='backtest')load();
})(window);