(function(root){'use strict';
const doc=root.document,host=doc.getElementById('paperBets'),view=doc.getElementById('view-picks');
if(!host||!view)return;
const el=(tag,txt,cls)=>{const v=doc.createElement(tag);if(txt!==undefined)v.textContent=String(txt);if(cls)v.className=cls;return v};
const clock=()=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(x=>[x.type,x.value]));return p.year+'-'+p.month+'-'+p.day};
const displayDate=new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'Europe/London'});
const scope=()=>doc.getElementById('pb-ledger-scope')?.value||'today';
const selected=()=>scope()==='history'?null:scope()==='today'?clock():doc.getElementById('pb-ledger-date')?.value||clock();
const val=n=>n===null||n===undefined?'—':String(n);
const ratio=(n,total)=>!total?'—':Math.round(100*n/total)+'%';
const panel=el('section',undefined,'gb-h2h-panel');
const title=el('div',undefined,'gb-h2h-heading');title.append(el('h3','HEAD-TO-HEAD · GOALS · HALF-TIME · CARDS'));
const refresh=el('button','Refresh H2H','secondary');refresh.type='button';title.append(refresh);
const note=el('p','Historical meetings available before the prediction. Overall results are shown from today’s home-team perspective, including meetings at either ground; home-venue results are restricted to this home stadium. Small samples should not dominate the prediction.','pb-caption');
const message=el('p','Loading head-to-head data…','pb-caption');message.setAttribute('role','status');
const cards=el('div',undefined,'gb-h2h-list');panel.append(title,note,message,cards);
const model=doc.getElementById('gb-form-model');if(model)model.append(panel);else host.append(panel);
function metric(label,value){const item=el('div',undefined,'gb-h2h-metric');item.append(el('small',label),el('strong',value));return item}
function makeProfile(label,stat){
 const wrap=el('div',undefined,'gb-h2h-scope');wrap.append(el('h5',label+' · '+(stat?.sample||0)+' meetings'));
 if(!stat){wrap.append(el('p','No historical meetings available at this venue.','pb-caption'));return wrap}
 const grid=el('div',undefined,'gb-h2h-grid');
 for(const [name,value] of [
 ['Home / Draw / Away',stat.home_wins+' / '+stat.draws+' / '+stat.away_wins],
 ['Goals per match',stat.home_goals_avg+'–'+stat.away_goals_avg],
 ['Over 2.5',stat.over25+'/'+stat.sample+' ('+ratio(stat.over25,stat.sample)+')'],
 ['Both score',stat.btts+'/'+stat.sample+' ('+ratio(stat.btts,stat.sample)+')'],
 ['Half-time H / D / A',stat.ht_home+' / '+stat.ht_draw+' / '+stat.ht_away],
 ['1st-half goals avg',val(stat.ht_goals_avg)],
 ['HT over 0.5',stat.ht_over05+'/'+stat.ht_goal_samples],
 ['HT over 1.5',stat.ht_over15+'/'+stat.ht_goal_samples],
 ['Yellow cards avg',val(stat.yellow_avg)],
 ['4+ yellow cards',stat.yellow_over35+'/'+stat.yellow_samples],
 ['5+ yellow cards',stat.yellow_over45+'/'+stat.yellow_samples],
 ['Red cards avg',val(stat.red_avg)]
 ])grid.append(metric(name,value));
 wrap.append(grid);
 const combos=el('div',undefined,'gb-h2h-combos');combos.append(el('h6','Half-time / Full-time combinations'));
 for(const key of ['H/H','H/D','H/A','D/H','D/D','D/A','A/H','A/D','A/A'])combos.append(metric(key,stat.htft?.[key]??'—'));
 wrap.append(combos);
 if(stat.latest?.length){
  const detail=el('details',undefined,'gb-h2h-history');detail.append(el('summary','Previous results ('+stat.latest.length+')'));
  const scroll=el('div',undefined,'pb-table-wrap'),tbl=el('table'),head=el('thead'),tr=el('tr');
  for(const name of ['Date','FT goals','HT goals','HT / FT','Yellow','Red'])tr.append(el('th',name));head.append(tr);tbl.append(head);
  const body=el('tbody');for(const m of stat.latest){
   const row=el('tr');const vals=[m.match_date?displayDate.format(new Date(m.match_date+'T12:00:00Z')):'—',m.hg+'–'+m.ag,m.hthg===null?'—':m.hthg+'–'+m.htag,(m.ht||'—')+'/'+(m.ft||'—'),val(m.yellows),val(m.reds)];
   vals.forEach(x=>row.append(el('td',x)));body.append(row)
  }tbl.append(body);scroll.append(tbl);detail.append(scroll);wrap.append(detail);
 }
 return wrap
}
function render(data){
 cards.replaceChildren();message.textContent=data.fixtures.length+' saved fixtures with historical H2H analysis.';
 if(!data.fixtures.length){cards.append(el('p','No saved Form & History predictions for this date.','pb-caption'));return}
 for(const fixture of data.fixtures){
  const card=el('article',undefined,'gb-h2h-card');
  const head=el('div',undefined,'gb-h2h-match');
  head.append(el('strong',fixture.home+' v '+fixture.away),el('span',fixture.league));
  card.append(head);
  const two=el('div',undefined,'gb-h2h-split');
  two.append(makeProfile('All head-to-head',fixture.overall),makeProfile(fixture.home+' at home',fixture.home_venue));
  card.append(two);cards.append(card);
 }
}
let active=null,last='',lastAt=0;
async function load(force=false){
 if(view.hidden){panel.hidden=true;active?.abort();return}
 const date=selected();panel.hidden=!date;if(!date)return;
 if(!force&&date===last&&Date.now()-lastAt<60000)return;
 active?.abort();const ctrl=new AbortController();active=ctrl;refresh.disabled=true;message.textContent='Loading historical H2H · '+date+'…';
 try{
  const resp=await root.fetch(CLOUD_URL+'/functions/v1/gerball-paper-bets?scope=form_h2h&date='+encodeURIComponent(date),{headers:{apikey:CLOUD_KEY},signal:AbortSignal.any([ctrl.signal,AbortSignal.timeout(30000)])});
  if(!resp.ok)throw Error('H2H report '+resp.status);
  const result=await resp.json();if(ctrl!==active||date!==selected())return;
  if(result.version!=='form_h2h_v1'||!Array.isArray(result.fixtures))throw Error('Unexpected report');
  render(result);last=date;lastAt=Date.now()
 }catch(e){if(ctrl===active&&e.name!=='AbortError')message.textContent='Unable to load H2H history: '+e.message}
 finally{if(ctrl===active){active=null;refresh.disabled=false}}
}
refresh.addEventListener('click',()=>load(true));
doc.getElementById('pb-ledger-scope')?.addEventListener('change',()=>root.setTimeout(()=>load(true),0));
doc.getElementById('pb-ledger-date')?.addEventListener('change',()=>root.setTimeout(()=>load(true),0));
doc.querySelector('.pb-day-buttons')?.addEventListener('click',()=>root.setTimeout(()=>load(true),0));
root.addEventListener('gerball:viewchange',e=>{if(e.detail?.view==='picks')load(true);else{panel.hidden=true;active?.abort()}});
if(!view.hidden)load(true);
})(window);
