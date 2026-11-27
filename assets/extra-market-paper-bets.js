(function(root){'use strict';
const document=root.document,host=document.getElementById('paperBets'),view=document.getElementById('view-picks');
if(!host||!view)return;
const make=(tag,txt,cls)=>{const e=document.createElement(tag);if(txt!==undefined)e.textContent=String(txt);if(cls)e.className=cls;return e};
const dFmt=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',day:'numeric',month:'short',year:'numeric'});
const tFmt=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
const day=()=>{const o=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(p=>[p.type,p.value]));return o.year+'-'+o.month+'-'+o.day};
const marketNames={h2h_3_way_h1:'Half-time result',halftime_fulltime:'Half-time / Full-time',btts:'Both teams to score',alternate_totals_cards:'Cards'};
const num=(v,n=2)=>v===null||v===undefined||!Number.isFinite(Number(v))?'—':Number(v).toFixed(n);
const formatDate=d=>d?dFmt.format(new Date(d+'T12:00:00Z')):'All dates';
const main=make('section',undefined,'card gb-extra-market');
const header=make('div',undefined,'gb-extra-header');header.append(make('h2','MORE MARKETS · PAPER BETS'));
const reload=make('button','Refresh markets','secondary');reload.type='button';header.append(reload);
const explain=make('p','Experimental historical model. Recorded selections are frozen before kickoff, use 1–5 abstract units and settle only against verified source results. These estimates are not proven betting edges.','pb-caption');
const status=make('p','Loading multi-market paper bets…','pb-caption');status.setAttribute('role','status');
const tiles=make('div',undefined,'gb-extra-stats');
const tableWrap=make('div',undefined,'pb-table-wrap gb-extra-table');
const screen=make('div',undefined,'gb-extra-screen');
const screenTitle=make('h3','Today’s additional-market screening');
const screenInfo=make('p','Card totals are researched, but not automatically recommended or settled until the provider’s definition of a card matches our historical counts.','pb-caption');
const breakdown=make('div',undefined,'gb-extra-screen-counters');
const screenDetails=make('details',undefined,'gb-extra-screen-details');screenDetails.append(make('summary','Show screened market coverage'),breakdown);
screen.append(screenTitle,screenInfo,screenDetails);
main.append(header,explain,status,tiles,tableWrap,screen);
const anchor=host.querySelector('.gb-reverse')||host.querySelector('.pb-ledger');
if(anchor)anchor.insertAdjacentElement('afterend',main);else host.append(main);
let ctrl=null,screenCtrl=null,last='',lastAt=0,hasViewed=false;
const scope=()=>document.getElementById('pb-ledger-scope')?.value||'today';
const chosenDate=()=>scope()==='history'?null:scope()==='today'?day():document.getElementById('pb-ledger-date')?.value||day();
const endpoint=(kind,date)=>CLOUD_URL+'/functions/v1/gerball-paper-bets?scope='+kind+(date?'&date='+encodeURIComponent(date):'');
async function fetchData(url,signal){const response=await root.fetch(url,{headers:{apikey:CLOUD_KEY},signal:AbortSignal.any([signal,AbortSignal.timeout(30000)])});if(!response.ok)throw Error('Report unavailable ('+response.status+')');return response.json()}
function show(report){
 const s=report.summary||{},rows=report.records||[];
 const values=[['Recorded',s.bets??0],['Won',s.won??0],['Lost',s.lost??0],['Pending',(s.pending||0)+(s.review||0)],['Net units',(Number(s.net_units)>0?'+':'')+num(s.net_units)],['ROI',s.roi_pct===null?'—':num(s.roi_pct)+'%']];
 tiles.replaceChildren();
 for(const [name,value] of values){const tile=make('div',undefined,'gb-extra-stat');tile.append(make('small',name),make('strong',value));tiles.append(tile)}
 tableWrap.replaceChildren();
 if(!rows.length){tableWrap.append(make('p','No extra-market paper bets recorded for this period. Historical screening will only save a selection when the pre-match odds and eligibility rules qualify.','pb-caption'));return}
 const table=make('table'),thead=make('thead'),trh=make('tr'),labels=['Match','Kickoff','Market','Selection','Odds','Units','Bookmaker','Result','Net units'];
 labels.forEach(label=>{const th=make('th',label);th.scope='col';trh.append(th)});thead.append(trh);table.append(thead);
 const tbody=make('tbody');
 for(const b of rows){
  const final=b.status==='settled';const label=final?b.won?'Won':'Lost':b.status==='review'?'Needs review':'Pending';
  const values=[b.home+' v '+b.away,b.kickoff_at?tFmt.format(new Date(b.kickoff_at))+' UK':'—',marketNames[b.market]||b.market,b.outcome,num(b.odds),b.units,b.bookmaker||'—',label+(b.score?' · '+b.score:''),final?(Number(b.net_units)>0?'+':'')+num(b.net_units):'—'];
  const row=make('tr');values.forEach((v,i)=>{const td=make('td',v);td.setAttribute('data-label',labels[i]);if(i===8&&final)td.className=Number(b.net_units)<0?'pb-negative':'pb-positive';row.append(td)});tbody.append(row);
 }
 table.append(tbody);tableWrap.append(table);
}
async function load(force=false){
 if(view.hidden||(host.dataset.paperTab&&host.dataset.paperTab!=='extra'))return;
 const date=chosenDate(),key=date||'all';
 main.hidden=false;screen.hidden=date!==day();
 if(!force&&last===key&&Date.now()-lastAt<45000)return;
 if(ctrl)ctrl.abort();const pending=new AbortController();ctrl=pending;
 status.textContent='Loading '+(date?formatDate(date):'complete history')+'…';reload.disabled=true;
 try{
  const result=await fetchData(endpoint(date?'extra':'extra_history',date),pending.signal);
  if(pending!==ctrl||chosenDate()!==date)return;
  if(result.version!=='extra_paper_report_v1'||!Array.isArray(result.records)||!result.summary)throw Error('Invalid multi-market report');
  status.textContent=result.records.length+' saved extra-market paper bet'+(result.records.length===1?'':'s')+' · '+(date?formatDate(date):'complete history')+' · 1–5 units';
  show(result);last=key;lastAt=Date.now();
 }catch(e){if(pending===ctrl&&e.name!=='AbortError')status.textContent='Unable to load extra-market bets: '+e.message}
 finally{if(pending===ctrl){ctrl=null;reload.disabled=false}}
 if(date===day())loadScreen(force);
}
async function loadScreen(force){
 if(view.hidden||screen.hidden||(host.dataset.paperTab&&host.dataset.paperTab!=='extra'))return;
 if(screenCtrl)screenCtrl.abort();const pending=new AbortController();screenCtrl=pending;
 try{
  const result=await fetchData(endpoint('extra_screen'),pending.signal);
  if(pending!==screenCtrl||result.version!=='extra_market_research_v1')return;
  const counts=result.screened||[],qualified=result.candidates||[];
  screenTitle.textContent='Today’s multi-market screen · '+qualified.length+' qualifying selections';
  breakdown.replaceChildren();
  if(!counts.length)breakdown.append(make('p','No eligible market quotes available to screen today.','pb-caption'));
  for(const c of counts){const tile=make('div',undefined,'gb-extra-screen-line');tile.append(make('strong',c.group),make('span',c.decision.replaceAll('_',' ')),make('b',c.count));breakdown.append(tile)}
 }catch(e){if(e.name!=='AbortError'&&pending===screenCtrl)screenTitle.textContent='Multi-market screening unavailable'}
 finally{if(pending===screenCtrl)screenCtrl=null}
}
function update(){if(view.hidden||(host.dataset.paperTab&&host.dataset.paperTab!=='extra')){main.hidden=true;ctrl?.abort();screenCtrl?.abort();return}load(true)}
reload.addEventListener('click',()=>load(true));
 root.addEventListener('gerball:paper-tabchange',e=>{if(e.detail?.tab==='extra')load(true);else{ctrl?.abort();screenCtrl?.abort()}});
document.getElementById('pb-ledger-scope')?.addEventListener('change',()=>root.setTimeout(update,0));
document.getElementById('pb-ledger-date')?.addEventListener('change',()=>root.setTimeout(update,0));
document.querySelector('.pb-day-buttons')?.addEventListener('click',()=>root.setTimeout(update,0));
root.addEventListener('gerball:viewchange',e=>{if(e.detail?.view==='picks'){hasViewed=true;load(true)}else{main.hidden=true;ctrl?.abort();screenCtrl?.abort()}});
if(!view.hidden){hasViewed=true;load(true)}
})(window);
