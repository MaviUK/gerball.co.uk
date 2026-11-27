(function(root){'use strict';
const doc=root.document,host=doc.getElementById('paperBets'),view=doc.getElementById('view-picks'),dates=root.GerballPaperDates;
if(!host||!view||!dates||!host.querySelector('.gb-paper-tabs')||host.querySelector('.gb-pl-dashboard'))return;
const make=(tag,text,cls)=>{const el=doc.createElement(tag);if(text!==undefined)el.textContent=String(text);if(cls)el.className=cls;return el};
const fmtDay=new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
const fmtMonth=new Intl.DateTimeFormat('en-GB',{month:'long',year:'numeric',timeZone:'UTC'});
const today=()=>dates.day(new Date());
const dayLabel=d=>fmtDay.format(new Date(d+'T12:00:00Z'));
const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
const money=n=>(n>0?'+':'')+Number(n).toFixed(2);
const totals=()=>({bets:0,wins:0,losses:0,pending:0,units:0,settledUnits:0,net:0});
function add(t,b){
 t.bets++;t.units+=Number(b.units);
 if(b.status==='settled'&&finite(b.net_units)&&typeof b.won==='boolean'){
  t.settledUnits+=Number(b.units);t.net+=Number(b.net_units);if(b.won)t.wins++;else t.losses++;
 }else t.pending++;
 return t;
}
function rowsForModel(rows,model){return model==='all'?rows:rows.filter(b=>b.model===model)}
function summarize(rows){return rows.reduce(add,totals())}
function monthShift(value,step){const d=new Date(value+'-01T12:00:00Z');d.setUTCMonth(d.getUTCMonth()+step);return d.toISOString().slice(0,7)}
function daysInMonth(value){const [y,m]=value.split('-').map(Number);return new Date(Date.UTC(y,m,0)).getUTCDate()}
function normalize(rows,model,fallback){
 return rows.filter(b=>b.status!=='odds_unavailable'&&finite(b.odds)&&Number(b.odds)>1&&finite(b.units)&&Number(b.units)>0).map(b=>({
  model,date:dates.validDay(b.fixture_date)?b.fixture_date:dates.day(b.kickoff_at)||fallback,
  units:Number(b.units),status:b.status,won:b.won,net_units:b.net_units
 })).filter(b=>dates.validDay(b.date)&&b.date<=today());
}
const style=make('style');style.textContent=`
body.gb-paper-current #viewHero{display:none!important}
#paperBets .gb-paper-hub-header,#paperBets .gb-paper-tab-caption,#paperBets .gb-paper-tab-hint{display:none!important}
#paperBets .gb-pl-dashboard{margin:0 0 12px!important;padding:14px!important;background:#111e1b!important;border:1px solid #3c5347!important;border-radius:12px!important;min-width:0}
#paperBets .gb-pl-heading,#paperBets .gb-pl-monthnav,#paperBets .gb-pl-charthead{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
#paperBets .gb-pl-heading h2,#paperBets .gb-pl-charthead h3{margin:0!important;font-size:18px!important;line-height:1.2}
#paperBets .gb-pl-heading h2{color:#f2f7ec}
#paperBets .gb-pl-control{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
#paperBets .gb-pl-dashboard button,#paperBets .gb-pl-dashboard select{width:auto!important;min-width:0!important;min-height:36px!important;box-shadow:none!important;text-transform:none!important;letter-spacing:normal!important;font-size:12px!important;border-radius:7px!important;padding:7px 10px!important;background:#20342c!important;color:#ecf5e9!important;border:1px solid #476451!important}
#paperBets .gb-pl-dashboard button:disabled{opacity:.4;cursor:default}
#paperBets .gb-pl-dashboard button:focus-visible,#paperBets .gb-pl-dashboard select:focus-visible{outline:2px solid #cafa5d!important;outline-offset:2px}
#paperBets .gb-pl-period{font-size:12px;color:#a8beb0;margin:5px 0 10px}
#paperBets .gb-pl-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px}
#paperBets .gb-pl-stat{background:#192b25;border:1px solid #314b3d;border-radius:8px;padding:9px 10px;min-width:0}
#paperBets .gb-pl-stat small{display:block;color:#b8cbbd;font-size:11px;line-height:1.3}
#paperBets .gb-pl-stat strong{display:block;font-size:clamp(18px,3vw,27px);font-variant-numeric:tabular-nums;line-height:1.2;margin-top:5px;overflow-wrap:anywhere;color:#eef7ec}
#paperBets .gb-pl-stat.gb-pl-profit strong{color:#8be9ad}
#paperBets .gb-pl-stat.gb-pl-loss strong{color:#ff919b}
#paperBets .gb-pl-note{margin:8px 0 0!important;color:#a8beb0!important;font-size:11px!important;line-height:1.45}
#paperBets .gb-pl-charthead{margin:17px 0 8px}
#paperBets .gb-pl-charthead h3{font-size:15px!important}
#paperBets .gb-pl-monthnav{flex-wrap:nowrap}
#paperBets .gb-pl-monthnav strong{font-size:13px;min-width:104px;text-align:center}
#paperBets .gb-pl-monthnav button{min-width:36px!important}
#paperBets .gb-pl-scroll{overflow-x:auto;max-width:100%;scrollbar-width:thin;padding:3px 0 6px}
#paperBets .gb-pl-bars{display:grid;gap:3px;position:relative;min-width:640px;grid-template-columns:repeat(var(--gb-days),minmax(18px,1fr))}
#paperBets .gb-pl-bars button.gb-pl-day{display:flex!important;flex-direction:column;align-items:center;gap:3px;padding:2px 0 4px!important;min-width:0!important;border:1px solid transparent!important;background:transparent!important;box-shadow:none!important;border-radius:5px!important}
#paperBets .gb-pl-bars button.gb-pl-day[aria-pressed=true]{border-color:#cafa5d!important;background:#29422e!important}
#paperBets .gb-pl-plot{position:relative;width:100%;height:108px;display:block}
#paperBets .gb-pl-plot:after{content:'';position:absolute;left:-2px;right:-2px;top:50%;border-top:1px solid #718377}
#paperBets .gb-pl-bar{position:absolute;width:68%;left:16%;border-radius:3px 3px 0 0;bottom:50%;background:#66d99a;min-height:2px}
#paperBets .gb-pl-bar.negative{top:50%;bottom:auto;border-radius:0 0 3px 3px;background:#ec7786}
#paperBets .gb-pl-bar.neutral{background:#82938a;min-height:2px}
#paperBets .gb-pl-daylabel{font-size:10px;color:#d4e4d7;font-variant-numeric:tabular-nums}
#paperBets .gb-pl-day:disabled .gb-pl-daylabel{color:#67796d}
#paperBets .gb-pl-chartnote{display:flex;justify-content:space-between;gap:8px;margin-top:3px;flex-wrap:wrap;font-size:11px;color:#a8beb0}
#paperBets .gb-pl-chartnote b{color:#edf6e9}
#paperBets .gb-paper-tabs{margin:0 0 10px!important;padding:5px!important}
#paperBets .gb-paper-tablist{display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr));gap:5px;overflow:visible!important}
#paperBets .gb-paper-tablist>button.gb-paper-tab{min-width:0!important;width:100%!important;min-height:41px!important;padding:7px 6px!important;text-align:center!important;align-items:center!important;justify-content:center!important;white-space:normal!important;line-height:1.2}
#paperBets .gb-paper-tab strong{font-size:12px!important}
#paperBets .gb-paper-tab small{display:none!important}
#paperBets .gb-paper-toolbar{padding:8px 12px!important;margin:0 0 10px!important}
#paperBets .gb-paper-toolbar-top,#paperBets .gb-paper-toolbar .pb-caption{display:none!important}
#paperBets .gb-paper-toolbar .pb-ledger-scope{display:flex!important;align-items:center;gap:8px;margin:0!important}
#paperBets .gb-paper-toolbar .pb-ledger-scope label{margin:0!important;white-space:nowrap;font-size:12px}
#paperBets .gb-paper-toolbar .pb-ledger-scope select{min-height:36px!important;max-width:100%;min-width:0;font-size:13px}
#paperBets .gb-paper-toolbar .pb-date-navigation{margin:7px 0 0;gap:7px}
#paperBets .gb-paper-toolbar .pb-date-field input{min-height:36px!important}
#paperBets .gb-paper-toolbar .pb-day-buttons button{min-height:34px!important}
#paperBets .gb-paper-pane{gap:10px!important}
#paperBets .gb-paper-pane>.card{padding:12px!important}
#paperBets .gb-paper-pane .pb-lifetime,#paperBets .gb-paper-pane .pb-day-summary,#paperBets .gb-paper-pane .pb-day-summary-note{display:none!important}
#paperBets .gb-paper-pane .pb-search{margin:8px 0!important}
#paperBets .gb-paper-pane .pb-search label{font-size:12px}
#paperBets .gb-paper-pane .pb-top h2{font-size:18px!important}
@media(max-width:620px){#paperBets .gb-pl-dashboard{padding:11px!important}#paperBets .gb-pl-grid{grid-template-columns:repeat(3,minmax(0,1fr))}#paperBets .gb-pl-stat{padding:8px}#paperBets .gb-pl-stat strong{font-size:19px}#paperBets .gb-pl-heading h2{font-size:17px!important}#paperBets .gb-pl-bars{min-width:720px}#paperBets .gb-paper-tablist{grid-template-columns:repeat(4,minmax(0,1fr))}#paperBets .gb-paper-tab strong{font-size:10px!important}#paperBets .gb-pl-heading{gap:6px}#paperBets .gb-pl-control{width:100%}#paperBets .gb-pl-control select{flex:1}}
`;doc.head.append(style);
const dash=make('section',undefined,'card gb-pl-dashboard');dash.setAttribute('aria-label','Paper betting performance');
const title=make('h2','Overall P&L'),header=make('div',undefined,'gb-pl-heading'),controls=make('div',undefined,'gb-pl-control');
const model=make('select');model.setAttribute('aria-label','Performance model');
for(const [value,label] of [['all','All paper bets'],['odds','Odds model'],['reverse','Reverse bets'],['extra','Extra markets']]){const opt=make('option',label);opt.value=value;model.append(opt)}
const reset=make('button','All time'),refresh=make('button','Refresh');reset.type=refresh.type='button';controls.append(model,reset,refresh);header.append(title,controls);
const period=make('p','All recorded match dates','gb-pl-period'),grid=make('div',undefined,'gb-pl-grid'),note=make('p','Loading recorded paper bets…','gb-pl-note');note.setAttribute('role','status');
const chartHead=make('div',undefined,'gb-pl-charthead'),nav=make('div',undefined,'gb-pl-monthnav'),prev=make('button','‹'),next=make('button','›'),monthLabel=make('strong');prev.type=next.type='button';prev.setAttribute('aria-label','Previous month');next.setAttribute('aria-label','Next month');nav.append(prev,monthLabel,next);chartHead.append(make('h3','Daily P&L'),nav);
const scroll=make('div',undefined,'gb-pl-scroll'),bars=make('div',undefined,'gb-pl-bars'),legend=make('div',undefined,'gb-pl-chartnote'),monthTotal=make('b'),hint=make('span','Tap a day · swipe to see every date');legend.append(monthTotal,hint);scroll.append(bars);dash.append(header,period,grid,note,chartHead,scroll,legend);
host.insertBefore(dash,host.querySelector('.gb-paper-tabs'));
let month=today().slice(0,7),selected=null,rows=[],loadedAt=0,controller=null,complete=false,error='',loading=false;
function render(){
 const chosen=rowsForModel(rows,model.value),byDay=new Map();
 for(const b of chosen){if(!byDay.has(b.date))byDay.set(b.date,totals());add(byDay.get(b.date),b)}
 const total=selected?(byDay.get(selected)||totals()):summarize(chosen),valid=complete;
 title.textContent=selected?'Daily P&L':'Overall P&L';period.textContent=selected?dayLabel(selected)+' · '+model.options[model.selectedIndex].textContent:'All recorded match dates · '+model.options[model.selectedIndex].textContent;
 reset.disabled=!selected;refresh.disabled=loading;
 grid.replaceChildren();
 for(const [label,value,cls] of [
 ['P&L (units)',money(total.net),total.net<0?'gb-pl-loss':'gb-pl-profit'],['Total bets',total.bets],['Units staked',total.units.toFixed(2)],['Wins',total.wins],['Losses',total.losses],['Pending',total.pending],['ROI',total.settledUnits?(100*total.net/total.settledUnits).toFixed(1)+'%':'—'],['Win rate',total.wins+total.losses?(100*total.wins/(total.wins+total.losses)).toFixed(1)+'%':'—']
 ]){const tile=make('div',undefined,'gb-pl-stat'+(valid&&cls?' '+cls:''));tile.append(make('small',label),make('strong',valid?value:'—'));grid.append(tile)}
 note.textContent=loading?'Loading saved model results…':error?'Unable to load complete performance: '+error+' · Refresh to retry.':'Paper bets only. P&L and ROI use verified settled results; pending bets are excluded from returns. Form V1/V2 are odds-free accuracy forecasts.';
 monthLabel.textContent=fmtMonth.format(new Date(month+'-01T12:00:00Z'));next.disabled=month>=today().slice(0,7);prev.disabled=month<='0001-01';
 bars.style.setProperty('--gb-days',daysInMonth(month));bars.replaceChildren();
 const data=Array.from({length:daysInMonth(month)},(_,i)=>{const d=month+'-'+String(i+1).padStart(2,'0');return {d,n:i+1,t:byDay.get(d)||totals()}});
 const max=Math.max(1,...data.map(x=>Math.abs(x.t.net)));
 for(const x of data){
  const btn=make('button',undefined,'gb-pl-day');btn.type='button';btn.disabled=x.d>today();btn.setAttribute('aria-pressed',String(selected===x.d));btn.setAttribute('aria-label',dayLabel(x.d)+(valid?', '+money(x.t.net)+' units, '+x.t.bets+' bets':''));
  const plot=make('span',undefined,'gb-pl-plot');
  if(valid&&x.t.bets){const bar=make('span',undefined,'gb-pl-bar'+(x.t.net<0?' negative':x.t.net===0?' neutral':''));bar.style.height=(Math.abs(x.t.net)/max*48)+'%';plot.append(bar)}
  btn.append(plot,make('span',x.n,'gb-pl-daylabel'));btn.title=btn.getAttribute('aria-label');btn.addEventListener('click',()=>{selected=x.d;const input=doc.getElementById('pb-ledger-date');if(input){input.value=x.d;input.dispatchEvent(new Event('change',{bubbles:true}))}render()});bars.append(btn);
 }
 const monthly=summarize(chosen.filter(b=>b.date.startsWith(month+'-')));monthTotal.textContent=valid?'Month: '+money(monthly.net)+' units · '+monthly.bets+' bets':'Month: —';
}
async function request(query,signal){const res=await root.fetch(CLOUD_URL+'/functions/v1/gerball-paper-bets?'+query,{headers:{apikey:CLOUD_KEY},signal:AbortSignal.any([signal,AbortSignal.timeout(30000)])});if(!res.ok)throw Error('Report '+res.status);return res.json()}
async function originals(signal){
 const all=[];let offset=0,total=0;
 do{const r=await request('q=&limit=1000&offset='+offset,signal);if(r.version!=='paper_search_v1'||!Array.isArray(r.records)||!Number.isInteger(r.total_records)||r.total_records>50000)throw Error('Invalid or oversized odds-model ledger');total=r.total_records;all.push(...r.records);offset+=r.records.length;if(offset<total&&!r.records.length)throw Error('Incomplete odds-model ledger')}while(offset<total);
 return all;
}
async function load(force=false){
 if(view.hidden||loading||(!force&&complete&&Date.now()-loadedAt<300000))return;
 const ctrl=new AbortController();controller=ctrl;loading=true;error='';complete=false;render();
 try{
  const [original,extra]=await Promise.all([originals(ctrl.signal),request('scope=extra_history',ctrl.signal)]);
  if(extra.version!=='extra_paper_report_v1'||!Array.isArray(extra.records)||!extra.summary||Number(extra.summary.bets)!==extra.records.length)throw Error('Incomplete extra-market ledger');
  const days=[...new Set(original.filter(b=>['H','A'].includes(b.market)).map(b=>dates.validDay(b.fixture_date)?b.fixture_date:dates.day(b.kickoff_at)).filter(d=>dates.validDay(d)&&d<=today()))];
  const reversed=[];let i=0;
  await Promise.all(Array.from({length:Math.min(4,days.length)},async()=>{while(i<days.length){const d=days[i++];const r=await request('scope=reverse&date='+encodeURIComponent(d),ctrl.signal);if(r.version!=='reverse_paper_day_v1'||r.date!==d||!Array.isArray(r.records)||!r.summary)throw Error('Incomplete reverse ledger for '+d);const items=normalize(r.records,'reverse',d);if(Number(r.summary.bets)!==items.length)throw Error('Reverse ledger count mismatch for '+d);reversed.push(...items)}}));
  if(controller!==ctrl)return;
  const odds=normalize(original,'odds'),extras=normalize(extra.records,'extra');
  if(odds.length!==original.length||extras.length!==extra.records.length)throw Error('Invalid stake, price or date in saved ledger');
  rows=[...odds,...extras,...reversed];complete=true;loadedAt=Date.now();
 }catch(e){if(controller===ctrl&&e.name!=='AbortError')error=e.message}
 finally{if(controller===ctrl){controller=null;loading=false;render()}}
}
reset.addEventListener('click',()=>{selected=null;render()});
model.addEventListener('change',render);
refresh.addEventListener('click',()=>load(true));
prev.addEventListener('click',()=>{month=monthShift(month,-1);render();scroll.scrollLeft=0});
next.addEventListener('click',()=>{month=monthShift(month,1);render();scroll.scrollLeft=0});
function syncSelection(){const scope=doc.getElementById('pb-ledger-scope')?.value;const d=doc.getElementById('pb-ledger-date')?.value;if(scope==='history'){selected=null}else if(dates.validDay(d)){selected=d;month=d.slice(0,7)}render()}
doc.getElementById('pb-ledger-date')?.addEventListener('change',syncSelection);
doc.getElementById('pb-ledger-scope')?.addEventListener('change',syncSelection);
doc.querySelector('.pb-day-buttons')?.addEventListener('click',()=>root.setTimeout(syncSelection,0));
root.addEventListener('gerball:viewchange',e=>{if(e.detail?.view==='picks'){load();}else if(controller){controller.abort();controller=null;loading=false}});
root.addEventListener('focus',()=>{if(!view.hidden)load()});
render();if(!view.hidden)load();
})(window);
