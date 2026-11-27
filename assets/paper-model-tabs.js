(function(root){'use strict';
const doc=root.document,host=doc.getElementById('paperBets'),view=doc.getElementById('view-picks');
if(!host||!view||host.dataset.paperTabsReady==='true')return;
const make=(tag,text,cls)=>{const n=doc.createElement(tag);if(text!==undefined)n.textContent=String(text);if(cls)n.className=cls;return n};
const intro=host.querySelector('.pb-history-filters')?.closest('section.card');
const ledger=host.querySelector('.pb-ledger');
if(!intro||!ledger)return;
const configs=[
 {id:'odds',label:'Odds model',short:'Original paper bets',caption:'Recorded selections, prices and unit results'},
 {id:'reverse',label:'Reverse bets',short:'Opposite H / A',caption:'Reverse paper bets · same units · no draws'},
 {id:'extra',label:'Extra markets',short:'HT · FT · BTTS',caption:'Additional markets and saved experimental bets'},
 {id:'v1',label:'Form V1',short:'No bookmaker odds',caption:'Historical form and venue-based probabilities'},
 {id:'v2',label:'Form V2',short:'No bookmaker odds',caption:'Opponent strength, H2H and multi-market predictions'},
 {id:'accuracy',label:'Model accuracy',short:'V1 vs V2',caption:'Historical replay, accuracy and calibration'},
 {id:'backtest',label:'Historical P&L',short:'Odds vs Reverse',caption:'Reconstructed selections and daily P&L across historical seasons'},
 {id:'reports',label:'Reports',short:'P&L and diagnostics',caption:'Daily performance, breakdowns and result health'}
];
const select=doc.getElementById('pb-ledger-scope');
const tabs=make('nav',undefined,'gb-paper-tabs');tabs.setAttribute('aria-label','Paper betting models');
const tablist=make('div',undefined,'gb-paper-tablist');tablist.setAttribute('role','tablist');tablist.setAttribute('aria-label','Choose a paper betting model');
const panels=make('div',undefined,'gb-paper-panels');
const buttonMap=new Map(),paneMap=new Map();
for(const c of configs){
 const button=make('button',undefined,'gb-paper-tab');button.type='button';button.id='gb-paper-tab-'+c.id;
 button.setAttribute('role','tab');button.setAttribute('aria-controls','gb-paper-pane-'+c.id);
 button.append(make('strong',c.label));button.title=c.caption;
 tablist.append(button);buttonMap.set(c.id,button);
 const pane=make('section',undefined,'gb-paper-pane');
 pane.id='gb-paper-pane-'+c.id;pane.setAttribute('role','tabpanel');
 pane.setAttribute('aria-labelledby',button.id);pane.setAttribute('tabindex','0');
 pane.hidden=true;panels.append(pane);paneMap.set(c.id,pane);
}
tabs.append(tablist);
const toolbar=make('section',undefined,'gb-paper-toolbar');
const toolbarTop=make('div',undefined,'gb-paper-toolbar-top');
toolbarTop.append(make('strong','Match date'),make('span','Shared across the betting models · UK time'));
toolbar.append(toolbarTop);
const sharedFilters=intro.querySelector('.pb-history-filters');toolbar.append(sharedFilters);
const originalTitle=intro.querySelector('.pb-top h2');if(originalTitle)originalTitle.textContent='Odds-based paper bets';
const criteria=intro.querySelector('.pb-warning');
if(criteria){
 const disclosure=make('details',undefined,'gb-paper-criteria');
 disclosure.append(make('summary','How this model qualifies a paper bet'));
 criteria.replaceWith(disclosure);
 disclosure.append(criteria);
}
const alert=make('p',undefined,'gb-paper-scope-alert');alert.hidden=true;alert.setAttribute('role','status');toolbar.append(alert);
const tabCaption=make('div',undefined,'gb-paper-tab-caption');tabCaption.setAttribute('aria-live','off');
const tabHeading=make('strong',undefined),tabDetail=make('span',undefined);tabCaption.append(tabHeading,tabDetail);
const odds=paneMap.get('odds'),reverse=paneMap.get('reverse'),extra=paneMap.get('extra'),v1=paneMap.get('v1'),v2=paneMap.get('v2'),accuracy=paneMap.get('accuracy'),reports=paneMap.get('reports');
function move(sel,to){const n=host.querySelector(sel);if(n){to.append(n);return n}return null}
moveSection(intro,odds);
function moveSection(n,to){if(n){to.append(n);return n}return null}
move('.pb-ledger',odds);
move('.pb-date-fixtures',odds);
const candidate=host.querySelector('.pb-assessments');
const details=make('details',undefined,'gb-paper-assessments');
details.append(make('summary','Show all match assessments, including no-bet decisions and recorded prices'));
if(candidate)details.append(candidate);odds.append(details);
const reverseSection=move('.gb-reverse',reverse);
const extraSection=move('.gb-extra-market',extra);
const h2h=host.querySelector('.gb-h2h-panel');
if(h2h){
 const wrap=make('details',undefined,'gb-paper-h2h-details');
 const summary=make('summary','Explore full head-to-head fixture analysis (goals, half-time and cards)');
 h2h.replaceWith(wrap);wrap.append(summary,h2h);
}
const v1Section=move('#gb-form-model',v1);
const v2Section=move('#gb-form-v2',v2);
const accuracySection=move('#gb-evaluation',accuracy);
const reverseNote=make('p','Reverse bets are available for an individual match day. Select Today or Choose a date above.','gb-paper-notice');
reverseNote.hidden=true;reverse.prepend(reverseNote);
const formNote=make('p','Detailed head-to-head fixture cards require an individual match day. Choose Today or a date above.','gb-paper-notice');
formNote.hidden=true;v1.prepend(formNote);
function addReport(sel,title,id,open){
 const n=host.querySelector(sel);if(!n)return;
 const d=make('details',undefined,'gb-paper-report');
 d.dataset.report=id;d.open=!!open;
 const summ=make('summary');summ.append(make('strong',title),make('span',open?'Daily totals and unit history':'Expand for details'));d.append(summ,n);
 const h=n.querySelector('h2');if(h)h.classList.add('gb-paper-internal-heading');
 reports.append(d);
 d.addEventListener('toggle',()=>{if(d.open&&host.dataset.paperTab==='reports'&&!view.hidden)
  root.dispatchEvent(new CustomEvent('gerball:paper-reportopen',{detail:{report:id}}))});
}
addReport('.pb-performance','Daily P&L and performance','performance',true);
addReport('.pb-breakdown','Breakdown by market, league and team','breakdown',false);
addReport('.pb-odds-movement','Odds movement and collection coverage','movement',false);
addReport('.pb-health','Settlement status and data freshness','settlement',false);
const reportNote=make('p','This section analyses recorded paper bets and data quality. The Form V1/V2 prediction accuracy comparison is in the Model accuracy tab.','gb-paper-notice');reports.prepend(reportNote);
if(!reverseSection)reverse.append(make('p','Reverse-bet records are currently unavailable.','gb-paper-notice'));
if(!extraSection)extra.append(make('p','Extended-market records are currently unavailable.','gb-paper-notice'));
if(!v1Section)v1.append(make('p','V1 predictions are currently unavailable.','gb-paper-notice'));
if(!v2Section)v2.append(make('p','V2 predictions are currently unavailable.','gb-paper-notice'));
if(!accuracySection)accuracy.append(make('p','The model comparison is currently unavailable.','gb-paper-notice'));
host.prepend(tabs,toolbar,tabCaption,panels);
host.dataset.paperTabsReady='true';
function valid(id){return paneMap.has(id)?id:'odds'}
function initial(){
 try{return valid(new URL(root.location.href).searchParams.get('paperTab')||'odds')}
 catch{return 'odds'}
}
function saveUrl(id){
 try{const url=new URL(root.location.href);url.searchParams.set('paperTab',id);
 root.history.replaceState(root.history.state,'',url.pathname+url.search+url.hash)}
 catch{/* URL state is optional */}
}
function scopeNotice(){
 if(host.dataset.paperTab==='reports'||host.dataset.paperTab==='accuracy')toolbar.hidden=true;
 else toolbar.hidden=false;
 const history=select?.value==='history',tab=host.dataset.paperTab;
 reverseNote.hidden=!(history&&tab==='reverse');
 formNote.hidden=!(history&&tab==='v1');
 const h2hDisclosure=host.querySelector('.gb-paper-h2h-details');
 if(h2hDisclosure)h2hDisclosure.hidden=history;
 alert.hidden=!(history&&['reverse','v1'].includes(tab));
 alert.textContent=history?'Complete history is selected. Some fixture-level views need an individual date.':'';
 details.hidden=select?.value==='history'||doc.getElementById('pb-ledger-date')?.value!==root.GerballPaperDates?.day(new Date());
 toolbar.hidden=['accuracy','reports','backtest'].includes(tab);
}
function activate(next,remember=true,focus=false){
 const id=valid(next),previous=host.dataset.paperTab;
 host.dataset.paperTab=id;
 for(const c of configs){
  const selected=c.id===id,button=buttonMap.get(c.id),pane=paneMap.get(c.id);
  button.classList.toggle('is-active',selected);
  button.setAttribute('aria-selected',selected?'true':'false');
  button.tabIndex=selected?0:-1;
  pane.hidden=!selected;
 }
 const selected=configs.find(c=>c.id===id);
 tabHeading.textContent=selected.label;
 tabDetail.textContent=selected.caption;
 scopeNotice();
 if(remember)saveUrl(id);
 if(focus)buttonMap.get(id)?.focus({preventScroll:true});
 if(previous!==id||!previous){
  root.dispatchEvent(new CustomEvent('gerball:paper-tabchange',{detail:{tab:id,previous}}));
 }
}
for(let i=0;i<configs.length;i++){
 const c=configs[i],btn=buttonMap.get(c.id);
 btn.addEventListener('click',()=>activate(c.id));
 btn.addEventListener('keydown',e=>{
  const prev=e.key==='ArrowLeft'||e.key==='ArrowUp',next=e.key==='ArrowRight'||e.key==='ArrowDown';
  if(!prev&&!next&&e.key!=='Home'&&e.key!=='End')return;
  e.preventDefault();
  let pos=i;if(prev)pos=(i+configs.length-1)%configs.length;
  if(next)pos=(i+1)%configs.length;
  if(e.key==='Home')pos=0;if(e.key==='End')pos=configs.length-1;
  activate(configs[pos].id,true,true);
 });
}
select?.addEventListener('change',()=>root.setTimeout(scopeNotice,0));
doc.getElementById('pb-ledger-date')?.addEventListener('change',()=>root.setTimeout(scopeNotice,0));
doc.querySelector('.pb-day-buttons')?.addEventListener('click',()=>root.setTimeout(scopeNotice,0));
root.addEventListener('gerball:viewchange',e=>{
 doc.body.classList.toggle('gb-paper-current',e.detail?.view==='picks');
 if(e.detail?.view==='picks'){activate(host.dataset.paperTab||initial(),false)}
});
root.addEventListener('popstate',()=>activate(initial(),false));
activate(initial(),false);
doc.body.classList.toggle('gb-paper-current',!view.hidden);
})(window);