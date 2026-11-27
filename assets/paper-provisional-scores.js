(function(root){'use strict';
const doc=root.document,host=doc.getElementById('paperBets'),view=doc.getElementById('view-picks');
if(!host||!view)return;
const make=(tag,txt,cls)=>{const n=doc.createElement(tag);if(txt!==undefined)n.textContent=String(txt);if(cls)n.className=cls;return n};
const fmt=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
const today=()=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(x=>[x.type,x.value]));return p.year+'-'+p.month+'-'+p.day};
const scope=()=>doc.getElementById('pb-ledger-scope')?.value||'today';
const selected=()=>scope()==='history'?null:scope()==='today'?today():doc.getElementById('pb-ledger-date')?.value||today();
const fmtUnits=n=>(Number(n)>0?'+':'')+Number(n||0).toFixed(2)+'u';
const marketNames={H:'Home',D:'Draw',A:'Away',O25:'Over 2.5',U25:'Under 2.5'};
const panels={};
for(const [key,subtitle] of [['odds','Original model'],['reverse','Reverse bets']]){
 const section=make('section',undefined,'gb-temp-scores card');section.dataset.temporaryType=key;
 const top=make('div',undefined,'gb-temp-head');top.append(make('span','EARLY RESULTS · '+subtitle.toUpperCase(),'gb-temp-kicker'));
 const reload=make('button','Refresh scores','secondary');reload.type='button';
 const h=make('h3','Provisional results');
 const status=make('p','Checking completed fixtures…','pb-caption');status.setAttribute('role','status');
 const stats=make('div',undefined,'gb-temp-stats');
 const details=make('details',undefined,'gb-temp-details');
 const summary=make('summary','See completed matches');
 const table=make('div',undefined,'gb-temp-table pb-table-wrap');
 details.append(summary,table);section.append(top,h,status,stats,details);
 top.append(reload);
 const parent=doc.getElementById('gb-paper-pane-'+key);
 const target=parent||host;
 target.prepend(section);
 panels[key]={section,status,stats,summary,details,table,reload};
 reload.addEventListener('click',()=>load(true));
}
let active=null,last='',stamp=0,controller=null;
function show(data){
 const key=host.dataset.paperTab==='reverse'?'reverse':'odds',ui=panels[key];
 const entries=key==='reverse'?data.reverse_records:data.records;
 const summary=data.summary.find(x=>x.kind===(key==='reverse'?'reverse':'original'))||{};
 ui.section.hidden=false;ui.stats.replaceChildren();ui.table.replaceChildren();
 const metrics=[
 ['Provisional',summary.provisional||0],
 ['Won / Lost',(summary.provisional_won||0)+' / '+(summary.provisional_lost||0)],
 ['Temporary P&L',fmtUnits(summary.provisional_net_units)],
 ['Officially verified',summary.official||0],
 ['Verified P&L',fmtUnits(summary.official_net_units)]
 ];
 for(const [name,val] of metrics){
  const cell=make('div',undefined,'gb-temp-stat');
  cell.append(make('small',name),make('strong',val));ui.stats.append(cell)
 }
 const provisional=entries.filter(x=>x.status==='provisional').length;
 ui.status.textContent=provisional+' results awaiting official football-data.co.uk verification · '+(data.date||'complete history')+
  '. Temporary units are excluded from verified P&L.';
 ui.summary.textContent='Show '+entries.length+' completed paper bet'+(entries.length===1?'':'s')+' and scores';
 if(!entries.length){
  ui.table.append(make('p','No completed matched results are available for this selection. New results appear after the score feed confirms full time.','pb-caption'));
  return;
 }
 const table=make('table'),head=make('thead'),hrow=make('tr'),titles=['Match','Kickoff','Score','Pick','Odds','Result','Net units','Verification'];
 for(const label of titles){const th=make('th',label);th.scope='col';hrow.append(th)}head.append(hrow);table.append(head);
 const body=make('tbody');
 for(const rec of entries){
  const row=make('tr'),values=[
   rec.home+' v '+rec.away,
   rec.kickoff_at?fmt.format(new Date(rec.kickoff_at)):'—',
   rec.home_goals+'–'+rec.away_goals,
   marketNames[rec.market]||rec.market,
   Number(rec.odds).toFixed(2),
   rec.won?'Won':'Lost',
   fmtUnits(rec.net_units),
   rec.status==='official'?'Official':rec.discrepancy?'Review discrepancy':'Provisional'
  ];
  for(let i=0;i<values.length;i++){
   const td=make('td',values[i]);td.setAttribute('data-label',titles[i]);
   if(i===6)td.className=Number(rec.net_units)<0?'pb-negative':'pb-positive';
   if(i===7)td.className=rec.status==='official'?'gb-temp-official':'gb-temp-provisional';
   row.append(td)
  }body.append(row)
 }
 table.append(body);ui.table.append(table);
}
async function load(force=false){
 if(view.hidden)return;
 const key=host.dataset.paperTab||'odds';if(!panels[key])return;
 const date=selected(),id=key+'|'+(date||'history');
 if(!force&&last===id&&Date.now()-stamp<40000)return;
 if(controller)controller.abort();const ctrl=new AbortController();controller=ctrl;
 const ui=panels[key];ui.reload.disabled=true;ui.status.textContent='Retrieving provisional match results…';
 try{
  const path=CLOUD_URL+'/functions/v1/gerball-paper-bets?scope='+(date?'provisional&date='+encodeURIComponent(date):'provisional_history');
  const response=await root.fetch(path,{headers:{apikey:CLOUD_KEY},
   signal:AbortSignal.any([ctrl.signal,AbortSignal.timeout(25000)])});
  if(!response.ok)throw Error('Results request '+response.status);
  const data=await response.json();
  if(controller!==ctrl||selected()!==date||host.dataset.paperTab!==key)return;
  if(data.version!=='gerball_provisional_report_v1'||data.official_priority!==true||
   !Array.isArray(data.summary)||!Array.isArray(data.records)||!Array.isArray(data.reverse_records))throw Error('Unexpected results');
  show(data);last=id;stamp=Date.now();
 }catch(e){if(controller===ctrl&&e.name!=='AbortError')ui.status.textContent='Provisional results unavailable: '+e.message}
 finally{if(controller===ctrl){controller=null;ui.reload.disabled=false}}
}
root.addEventListener('gerball:paper-tabchange',e=>{
 if(['odds','reverse'].includes(e.detail?.tab)){load(true)}
 else{controller?.abort()}
});
doc.getElementById('pb-ledger-scope')?.addEventListener('change',()=>root.setTimeout(()=>load(true),0));
doc.getElementById('pb-ledger-date')?.addEventListener('change',()=>root.setTimeout(()=>load(true),0));
doc.querySelector('.pb-day-buttons')?.addEventListener('click',()=>root.setTimeout(()=>load(true),0));
root.addEventListener('gerball:viewchange',e=>{if(e.detail?.view==='picks')load(true);else controller?.abort()});
if(!view.hidden)load(true);
})(window);
