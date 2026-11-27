(function(root){'use strict';
const host=root.document.getElementById('paperBets'),view=root.document.getElementById('view-picks');
if(!host||!view)return;
const make=(tag,text,cls)=>{const x=root.document.createElement(tag);if(text!==undefined)x.textContent=String(text);if(cls)x.className=cls;return x};
const ukDate=()=>{const d=new Date(),parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d).map(p=>[p.type,p.value]));return parts.year+'-'+parts.month+'-'+parts.day};
const stamp=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
const dateLabel=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',day:'numeric',month:'short',year:'numeric'});
const section=make('section',undefined,'card gb-reverse');
const heading=make('div',undefined,'pb-top'),title=make('h2','Reverse paper bets');
const refresh=make('button','Refresh reverse bets','secondary');refresh.type='button';
heading.append(title,refresh);
const info=make('p','Opposite of each original home/away bet at the same unit stake. Original draw bets are skipped. Reverse prices are the best bookmaker odds stored before the original bet was recorded.','pb-caption');
const status=make('p','Loading reverse paper bets…','pb-caption');status.setAttribute('role','status');
const metrics=make('div',undefined,'gb-reverse-metrics');
const tableHost=make('div',undefined,'pb-table-wrap gb-reverse-table');
section.append(heading,info,status,metrics,tableHost);
const original=host.querySelector('.pb-ledger');if(original)original.insertAdjacentElement('afterend',section);else host.append(section);
const names={H:'Home win',A:'Away win'};let controller=null,key='',lastLoad=0;
function selected(){const scope=root.document.getElementById('pb-ledger-scope')?.value||'today',input=root.document.getElementById('pb-ledger-date')?.value;if(scope==='history')return null;return scope==='today'?ukDate():input}
const value=(n)=>Number.isFinite(Number(n))?Number(n).toFixed(2):'—';
function render(data){
 const rows=data.records||[],summary=data.summary||{};
 status.textContent=rows.length+' original home/away selections eligible · '+(summary.bets||0)+' reverse bets with recorded prices · '+(summary.missing_odds||0)+' without available reverse odds.';
 metrics.replaceChildren();
 for(const [label,result] of [['Reverse bets',summary.bets??0],['Wins',summary.won??0],['Losses',summary.lost??0],['Pending',summary.pending??0],['Net units',(Number(summary.net_units)>0?'+':'')+value(summary.net_units)],['ROI',summary.roi_pct===null?'—':value(summary.roi_pct)+'%']]){
  const box=make('div',undefined,'gb-reverse-metric');box.append(make('small',label),make('strong',result));metrics.append(box);
 }
 tableHost.replaceChildren();
 if(!rows.length){tableHost.append(make('p','No reverse bets for this date. Draw selections are intentionally excluded.','pb-caption'));return}
 const table=make('table'),thead=make('thead'),header=make('tr');
 const heads=['Match','Kickoff','Original bet','Reverse bet','Odds','Units','Bookmaker','Result','Net units'];
 for(const label of heads){const th=make('th',label);th.scope='col';header.append(th)}thead.append(header);table.append(thead);
 const tbody=make('tbody');
 for(const b of rows){
  const isSettled=b.status==='settled',result=isSettled?(b.won?'Won':'Lost'):b.status==='review'?'Review':b.status==='odds_unavailable'?'No recorded odds':'Pending';
  const score=isSettled&&b.home_goals!==null&&b.away_goals!==null?' ('+b.home_goals+'–'+b.away_goals+')':'';
  const fields=[b.home+' v '+b.away,b.kickoff_at?stamp.format(new Date(b.kickoff_at))+' UK':'—',names[b.original_market]||b.original_market,names[b.market]||b.market,b.odds===null?'—':value(b.odds),b.units,b.bookmaker||'—',result+score,isSettled?(Number(b.net_units)>0?'+':'')+value(b.net_units):'—'];
  const tr=make('tr');fields.forEach((str,i)=>{const td=make('td',str);td.setAttribute('data-label',heads[i]);if(i===8&&isSettled)td.className=Number(b.net_units)<0?'pb-negative':'pb-positive';tr.append(td)});tbody.append(tr)
 }
 table.append(tbody);tableHost.append(table);
}
async function load(force=false){
 const date=selected();section.hidden=!date||view.hidden;if(!date)return;
 if(!force&&key===date&&Date.now()-lastLoad<30000)return;
 if(controller)controller.abort();controller=new AbortController();const pending=controller;
 status.textContent='Loading reverse bets for '+date+'…';refresh.disabled=true;
 try{
  const response=await root.fetch(CLOUD_URL+'/functions/v1/gerball-paper-bets?scope=reverse&date='+encodeURIComponent(date),{headers:{apikey:CLOUD_KEY},signal:AbortSignal.any([pending.signal,AbortSignal.timeout(30000)])});
  if(!response.ok)throw Error('Reverse bet report unavailable ('+response.status+')');
  const result=await response.json();
  if(result.version!=='reverse_paper_day_v1'||result.date!==date||!Array.isArray(result.records))throw Error('Invalid reverse bet data');
  if(pending!==controller||selected()!==date)return;
  title.textContent='Reverse paper bets · '+dateLabel.format(new Date(date+'T12:00:00Z'));
  render(result);key=date;lastLoad=Date.now();
 }catch(e){if(e.name!=='AbortError'&&pending===controller)status.textContent='Unable to load reverse bets: '+e.message}
 finally{if(pending===controller){controller=null;refresh.disabled=false}}
}
refresh.addEventListener('click',()=>load(true));
root.addEventListener('gerball:viewchange',e=>{if(e.detail?.view==='picks')load(true);else section.hidden=true});
root.document.getElementById('pb-ledger-scope')?.addEventListener('change',()=>load(true));
root.document.getElementById('pb-ledger-date')?.addEventListener('change',()=>load(true));
for(const id of ['pb-day-buttons'])root.document.querySelector('.'+id)?.addEventListener('click',()=>root.setTimeout(()=>load(true),0));
if(!view.hidden)load(true);
})(window);
