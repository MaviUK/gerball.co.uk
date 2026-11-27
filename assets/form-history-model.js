(function(root){'use strict';
const doc=root.document, host=doc.getElementById('paperBets'), view=doc.getElementById('view-picks');
if(!host||!view)return;
const node=(tag,content,cls)=>{const el=doc.createElement(tag);if(content!==undefined)el.textContent=String(content);if(cls)el.className=cls;return el};
const ukDate=()=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(x=>[x.type,x.value]));return p.year+'-'+p.month+'-'+p.day};
const when=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
const chosen=()=>{const scope=doc.getElementById('pb-ledger-scope')?.value||'today';return scope==='history'?null:scope==='today'?ukDate():doc.getElementById('pb-ledger-date')?.value||ukDate()};
const decimal=(x,n=1)=>x===null||x===undefined||!Number.isFinite(Number(x))?'—':Number(x).toFixed(n);
const name={H:'Home',D:'Draw',A:'Away'};
const section=node('section',undefined,'card gb-form-model');section.id='gb-form-model';
const top=node('div',undefined,'gb-form-top');
const head=node('div',undefined,'gb-form-title');
head.append(node('span','MODEL 02 / NO ODDS','gb-form-kicker'),node('h2','FORM & HISTORY PREDICTIONS'));
const refresh=node('button','Refresh model','secondary');refresh.type='button';top.append(head,refresh);
const explain=node('p','Independent historical model using the last 12 home/away matches, each team’s recent six-match form, league scoring averages and goal probabilities. No bookmaker prices are used. Confidence indicates model certainty, not a recommended money stake.','pb-caption');
const progress=node('p','Loading form predictions…','pb-caption');progress.setAttribute('role','status');
const cards=node('div',undefined,'gb-form-metrics'),table=node('div',undefined,'pb-table-wrap gb-form-table');
const note=node('p','Forecasts are saved before kickoff and never adjusted after a match. Results update when verified football-data imports arrive.','pb-caption');
section.append(top,explain,progress,cards,table,note);
const preceding=host.querySelector('.gb-extra-market')||host.querySelector('.gb-reverse')||host.querySelector('.pb-ledger');
if(preceding)preceding.insertAdjacentElement('afterend',section);else host.append(section);
let ctrl=null,lastKey='',lastAt=0;
function render(data){
 const s=data.summary||{},bets=data.records||[];
 cards.replaceChildren();
 for(const [label,datum] of [['Predictions',s.predictions||0],['Correct',s.correct||0],['Incorrect',s.incorrect||0],['Pending',s.pending||0],['Hit rate',s.hit_rate_pct===null?'—':decimal(s.hit_rate_pct)+'%'],['Brier score',s.brier_score===null?'—':decimal(s.brier_score,3)]]){
  const box=node('div',undefined,'gb-form-metric');box.append(node('small',label),node('strong',datum));cards.append(box)
 }
 table.replaceChildren();
 if(!bets.length){table.append(node('p','No form-model selections saved for this date. Predictions are shown only when historical sample and confidence requirements are met.','pb-caption'));return}
 const t=node('table'),th=node('thead'),tr=node('tr'),labels=['Match','Kickoff','Prediction','Probability','Home / Draw / Away','Expected goals','Form PPG','Confidence','Result'];
 for(const label of labels){const cell=node('th',label);cell.scope='col';tr.append(cell)}th.append(tr);t.append(th);
 const body=node('tbody');
 for(const b of bets){
  const result=b.status==='settled'?(b.correct?'Correct':'Incorrect')+(b.home_goals!==null&&b.away_goals!==null?' · '+b.home_goals+'–'+b.away_goals:''):'Pending import';
  const values=[b.home+' v '+b.away,b.kickoff_at?when.format(new Date(b.kickoff_at))+' UK':'—',
   name[b.pick]||b.pick,decimal(Number(b.pick_probability)*100,1)+'%',
   [b.prob_home,b.prob_draw,b.prob_away].map(x=>decimal(Number(x)*100,1)+'%').join(' / '),
   decimal(b.expected_home_goals,2)+'–'+decimal(b.expected_away_goals,2),
   decimal(b.home_form_ppg,2)+' / '+decimal(b.away_form_ppg,2),
   b.confidence+'/5',result];
  const row=node('tr');
  values.forEach((v,i)=>{const td=node('td',v);td.setAttribute('data-label',labels[i]);if(i===8&&b.status==='settled')td.className=b.correct?'pb-positive':'pb-negative';row.append(td)});
  body.append(row)
 }
 t.append(body);table.append(t)
}
async function load(force=false){
 if(view.hidden||(host.dataset.paperTab&&host.dataset.paperTab!=='v1')){section.hidden=true;ctrl?.abort();return}
 const date=chosen(),key=date||'all';section.hidden=false;
 if(!force&&lastKey===key&&Date.now()-lastAt<45000)return;
 if(ctrl)ctrl.abort();const own=new AbortController();ctrl=own;refresh.disabled=true;
 progress.textContent='Loading '+(date?date:'all saved dates')+'…';
 try{
  const resp=await root.fetch(CLOUD_URL+'/functions/v1/gerball-paper-bets?scope='+ (date?'form&date='+encodeURIComponent(date):'form_history'),{headers:{apikey:CLOUD_KEY},signal:AbortSignal.any([own.signal,AbortSignal.timeout(30000)])});
  if(!resp.ok)throw Error('Form report unavailable ('+resp.status+')');
  const data=await resp.json();
  if(own!==ctrl||date!==chosen())return;
  if(data.version!=='form_predictions_v1'||data.odds_used!==false||!Array.isArray(data.records)||!data.summary)throw Error('Invalid form model report');
  progress.textContent=(data.summary.predictions||0)+' stored historical predictions · '+(data.summary.settled||0)+' settled · '+(date||'all dates')+' · no odds used';
  render(data);lastKey=key;lastAt=Date.now();
 }catch(e){if(own===ctrl&&e.name!=='AbortError')progress.textContent='Could not load form model: '+e.message}
 finally{if(own===ctrl){ctrl=null;refresh.disabled=false}}
}
refresh.addEventListener('click',()=>load(true));
 root.addEventListener('gerball:paper-tabchange',e=>{if(e.detail?.tab==='v1')load(true);else ctrl?.abort()});
doc.getElementById('pb-ledger-scope')?.addEventListener('change',()=>root.setTimeout(()=>load(true),0));
doc.getElementById('pb-ledger-date')?.addEventListener('change',()=>root.setTimeout(()=>load(true),0));
doc.querySelector('.pb-day-buttons')?.addEventListener('click',()=>root.setTimeout(()=>load(true),0));
root.addEventListener('gerball:viewchange',e=>{if(e.detail?.view==='picks')load(true);else{section.hidden=true;ctrl?.abort()}});
if(!view.hidden)load(true);
})(window);
