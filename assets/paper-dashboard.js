(function(root){'use strict';
const doc=root.document,host=doc.getElementById('paperBets'),view=doc.getElementById('view-picks');
const dates=root.GerballPaperDates,math=root.GerballPaperDashboardMath;
if(!host||!view||!dates||!math||!host.querySelector('.gb-paper-tabs'))return;
const models={odds:'Odds model',reverse:'Reverse bets',extra:'Extra markets'};
const make=(tag,text,cls)=>{const n=doc.createElement(tag);if(text!==undefined)n.textContent=String(text);if(cls)n.className=cls;return n};
const button=(text,cls='secondary')=>{const n=make('button',text,cls);n.type='button';return n};
const fullDate=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',day:'numeric',month:'long',year:'numeric'});
const shortDate=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
const monthDate=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',month:'long',year:'numeric'});
const number=new Intl.NumberFormat('en-GB',{maximumFractionDigits:2});
const decimal=new Intl.NumberFormat('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2});
const finite=n=>n!==null&&n!==undefined&&n!==''&&Number.isFinite(Number(n));
const units=n=>finite(n)?(Number(n)>0?'+':Number(n)<0?'−':'')+decimal.format(Math.abs(Number(n)))+' u':'—';
const count=n=>Number.isInteger(Number(n))?number.format(Number(n)):'—';
const dateLabel=day=>dates.validDay(day)?fullDate.format(new Date(day+'T12:00:00Z')):'Overall';
const currentDay=()=>dates.day(new Date());
const periodKey=()=>state.model+'|'+state.month;
const marketNames={H:'Home win',D:'Draw',A:'Away win',O25:'Over 2.5 goals',U25:'Under 2.5 goals',h2h_3_way_h1:'Half-time result',halftime_fulltime:'Half-time / full-time',btts:'Both teams to score',alternate_totals_cards:'Cards'};
const state={model:models[host.dataset.paperTab]?host.dataset.paperTab:'odds',month:currentDay().slice(0,7),date:null,query:'',offset:0};
const cache=new Map();let controller=null,requestId=0,searchTimer=null,records=[],recordTotal=0,lastMonth='',lastLoaded=0;
const PAGE=50;

const dashboard=make('section',undefined,'gb-pnl-dashboard');dashboard.id='gb-paper-dashboard';
dashboard.setAttribute('aria-label','Paper betting results');
const summaryCard=make('section',undefined,'gb-pnl-summary-card');
const heading=make('div',undefined,'gb-pnl-heading'),headingText=make('div');
const scopeTitle=make('h2','Overall','gb-pnl-scope'),subtitle=make('p',models[state.model]+' · All recorded dates','gb-pnl-subtitle');
headingText.append(scopeTitle,subtitle);
const actions=make('div',undefined,'gb-pnl-actions'),overall=button('Show overall'),today=button('Today'),refresh=button('Refresh');
overall.setAttribute('aria-label','Show overall results');today.setAttribute('aria-label','Show today’s results');refresh.setAttribute('aria-label','Refresh P&L results');
actions.append(overall,today,refresh);heading.append(headingText,actions);
const overview=make('div',undefined,'gb-pnl-overview'),netBox=make('div',undefined,'gb-pnl-net');
const netValue=make('strong','—');netBox.append(make('span','Net P&L'),netValue);
const statGrid=make('div',undefined,'gb-pnl-stats'),statValues={};
for(const [id,label]of[['bets','Bets'],['won','Wins'],['lost','Losses'],['units','Units staked']]){
 const stat=make('div',undefined,'gb-pnl-stat'),value=make('strong','—');stat.append(make('span',label),value);statGrid.append(stat);statValues[id]=value;
}
overview.append(netBox,statGrid);
const summaryMeta=make('p','Loading saved results…','gb-pnl-summary-meta');
const status=make('p','','gb-pnl-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
summaryCard.append(heading,overview,summaryMeta,status);

const chartCard=make('section',undefined,'gb-pnl-chart-card'),chartHead=make('div',undefined,'gb-pnl-chart-head'),chartTitle=make('div');
const chartSummary=make('p','Loading month…','gb-pnl-chart-summary');
chartTitle.append(make('h3','Daily P&L'),chartSummary);
const monthNav=make('div',undefined,'gb-pnl-month-nav'),previous=button('Previous'),next=button('Next');
previous.setAttribute('aria-label','Previous month');next.setAttribute('aria-label','Next month');
const monthLabel=make('label',undefined,'gb-pnl-month-label'),monthInput=make('input',undefined,'gb-pnl-month-picker');
monthInput.type='month';monthInput.id='gb-pnl-month';monthInput.value=state.month;monthInput.min='0001-01';monthInput.max=currentDay().slice(0,7);
monthLabel.htmlFor=monthInput.id;monthLabel.append(make('span','Chart month','gb-pnl-sr-only'),monthInput);
monthNav.append(previous,monthLabel,next);chartHead.append(chartTitle,monthNav);
const legend=make('div',undefined,'gb-pnl-chart-legend');
for(const [name,cls]of[['Profit','is-profit'],['Loss','is-loss'],['Pending','is-pending']])legend.append(make('span',name,cls));
const chartArea=make('div',undefined,'gb-pnl-chart-area'),axis=make('div',undefined,'gb-pnl-axis');axis.setAttribute('aria-hidden','true');
const axisTop=make('span','—'),axisZero=make('span','0'),axisBottom=make('span','—');axis.append(axisTop,axisZero,axisBottom);
const chartScroll=make('div',undefined,'gb-pnl-chart-scroll');chartScroll.setAttribute('aria-label','Daily profit and loss, scroll for all dates');
const plot=make('div',undefined,'gb-pnl-plot'),zeroLine=make('div',undefined,'gb-pnl-zero-line'),bars=make('div',undefined,'gb-pnl-bars');
zeroLine.setAttribute('aria-hidden','true');bars.setAttribute('role','group');bars.setAttribute('aria-label','Select a match date');
plot.append(zeroLine,bars);chartScroll.append(plot);chartArea.append(axis,chartScroll);
const chartNote=make('p','Tap a day to see its results and bets. Swipe the chart to see every day.','gb-pnl-chart-note');
const selection=make('p','','gb-pnl-selection');selection.setAttribute('aria-live','polite');
chartCard.append(chartHead,legend,chartArea,chartNote,selection);

const ledger=make('section',undefined,'gb-pnl-ledger'),ledgerHead=make('div',undefined,'gb-pnl-ledger-head');
const betsTitle=make('h3','All recorded bets','gb-pnl-bets-heading');
const searchLabel=make('label',undefined,'gb-pnl-search'),search=make('input');
search.id='gb-pnl-search';search.type='search';search.placeholder='Search team, league or market';search.maxLength=100;
searchLabel.htmlFor=search.id;searchLabel.append(make('span','Search bets','gb-pnl-sr-only'),search);ledgerHead.append(betsTitle,searchLabel);
const listMeta=make('p','','gb-pnl-list-meta'),list=make('div',undefined,'gb-pnl-bet-list'),more=button('Load more bets','secondary gb-pnl-more');
more.hidden=true;const empty=make('p','','gb-pnl-empty');empty.hidden=true;
ledger.append(ledgerHead,listMeta,empty,list,more);dashboard.append(summaryCard,chartCard,ledger);
host.querySelector('.gb-paper-tabs').insertAdjacentElement('afterend',dashboard);
host.dataset.paperDashboard='true';

// Keep detailed existing tools available below the main report, without repeating it.
function disclosure(parent,node,label){if(!parent||!node)return;const d=make('details',undefined,'gb-pnl-secondary');d.append(make('summary',label),node);parent.append(d);return d}
for(const model of ['odds','reverse']){
 const pane=doc.getElementById('gb-paper-pane-'+model),temp=pane?.querySelector('.gb-temp-scores');
 if(temp)disclosure(pane,temp,'Provisional scores & results');
}
const oddsPane=doc.getElementById('gb-paper-pane-odds');
const originalIntro=host.querySelector('#pb-search')?.closest('section.card');
if(originalIntro){
 const criteria=originalIntro.querySelector('.gb-paper-criteria');if(criteria)oddsPane?.append(criteria);
 originalIntro.classList.add('gb-dashboard-legacy');
}
for(const selector of ['.pb-ledger','.pb-date-fixtures','.gb-paper-fixtures','.gb-reverse'])host.querySelector(selector)?.classList.add('gb-dashboard-legacy');
doc.getElementById('gb-paper-pane-reverse')?.querySelector('.gb-paper-notice')?.classList.add('gb-dashboard-legacy');
const extra=host.querySelector('.gb-extra-market'),extraPane=doc.getElementById('gb-paper-pane-extra');
if(extra){const screen=extra.querySelector('.gb-extra-screen');if(screen)disclosure(extraPane,screen,'Extra-market screening');extra.classList.add('gb-dashboard-legacy')}
const exportButton=host.querySelector('.pb-ledger .pb-top button');
if(exportButton){
 const wrap=make('details',undefined,'gb-pnl-secondary gb-pnl-export');wrap.append(make('summary','Export paper bets (CSV)'),exportButton);
 const exportStatus=originalIntro?.querySelector('.pb-status')||host.querySelector('.pb-ledger .pb-status');if(exportStatus)wrap.append(exportStatus);
 oddsPane?.append(wrap);
}
function syncLegacySearch(){
 const input=doc.getElementById('pb-search');if(state.model==='odds'&&input&&input.value!==state.query){input.value=state.query;input.dispatchEvent(new Event('input',{bubbles:true}))}
}

function syncLegacyScope(){
 const input=doc.getElementById('pb-ledger-date'),scope=doc.getElementById('pb-ledger-scope');
 if(!input||!scope)return;
 input.value=state.date||currentDay();
 scope.value=state.date?(state.date===currentDay()?'today':'date'):'history';
 scope.dispatchEvent(new Event('change',{bubbles:true}));
 // Choosing a date in the existing controller updates all its downstream tools.
 if(state.date){input.value=state.date;input.dispatchEvent(new Event('change',{bubbles:true}))}
}
function saveState(){
 try{const url=new URL(root.location.href);url.searchParams.set('paperMonth',state.month);if(state.date)url.searchParams.set('paperDay',state.date);else url.searchParams.delete('paperDay');root.history.replaceState(root.history.state,'',url.pathname+url.search+url.hash)}catch{/* Optional shareable state. */}
}
function initialState(){
 state.month=currentDay().slice(0,7);state.date=null;
 try{const params=new URL(root.location.href).searchParams,month=params.get('paperMonth'),date=params.get('paperDay');
  if(month&&math.monthDays(month).length&&month<=currentDay().slice(0,7))state.month=month;
  if(date&&dates.validDay(date)&&date<=currentDay()){state.date=date;state.month=date.slice(0,7)}
 }catch{/* Defaults use the current UK month. */}
}
function active(){return !view.hidden&&!!models[host.dataset.paperTab]}
function clearSummary(){netValue.textContent='—';netValue.className='';for(const value of Object.values(statValues))value.textContent='—';summaryMeta.textContent='Loading saved results…'}
function styleNet(node,value){node.classList.toggle('gb-pnl-positive',finite(value)&&Number(value)>0);node.classList.toggle('gb-pnl-negative',finite(value)&&Number(value)<0)}
function showSummary(report){
 scopeTitle.textContent=state.date?dateLabel(state.date):'Overall';
 subtitle.textContent=models[state.model]+' · '+(state.date?'Daily results':'All recorded dates');
 overall.setAttribute('aria-pressed',state.date?'false':'true');today.setAttribute('aria-pressed',state.date===currentDay()?'true':'false');
 betsTitle.textContent=state.date?'Bets · '+dateLabel(state.date):'All recorded bets';
 if(!report){clearSummary();return}
 const s=state.date?(report.date===state.date?report.day_summary:report.daily.find(d=>d.date===state.date)):report.summary;
 if(!s){clearSummary();return}
 netValue.textContent=units(s.net_units);styleNet(netValue,s.net_units);
 for(const id of ['bets','won','lost'])statValues[id].textContent=count(s[id]);
 statValues.units.textContent=finite(s.units)?number.format(Number(s.units))+' u':'—';
 const pending=Number(s.pending||0),review=Number(s.review||0);
 const bits=[count(s.settled)+' settled',pending+' pending'];
 if(review)bits.push(review+' awaiting review');
 if(Number(s.missing_odds)>0)bits.push(count(s.missing_odds)+' without recorded odds');
 if(finite(s.roi_pct))bits.push('ROI '+decimal.format(Number(s.roi_pct))+'%');
 summaryMeta.textContent=bits.join(' · ')+'. P&L uses verified results; stakes include pending bets.';
}
function showChart(report){
 monthInput.value=state.month;monthInput.max=currentDay().slice(0,7);previous.disabled=state.month==='0001-01';next.disabled=state.month>=currentDay().slice(0,7);
 const oldFocus=doc.activeElement?.dataset?.date;
 bars.replaceChildren();
 const days=math.monthDays(state.month),byDay=new Map((report?.daily||[]).map(d=>[d.date,d]));
 bars.style.setProperty('--days',String(days.length));plot.style.minWidth=(days.length*30)+'px';
 const peak=Math.max(1,...(report?.daily||[]).map(d=>Math.abs(Number(d.net_units)||0)));
 const step=peak>50?10:peak>10?5:1,max=Math.ceil(peak/step)*step;
 axisTop.textContent=report?'+'+number.format(max):'—';axisBottom.textContent=report?'−'+number.format(max):'—';
 const month=report?.month_summary;
 chartSummary.textContent=report?monthDate.format(new Date(state.month+'-01T12:00:00Z'))+' · '+units(month?.net_units??report.daily.reduce((n,d)=>n+Number(d.net_units),0))+' · '+count(month?.bets??report.daily.reduce((n,d)=>n+Number(d.bets),0))+' bets':'Loading monthly results…';
 for(const day of days){
  const d=byDay.get(day),future=day>currentDay(),chosen=day===state.date;
  const btn=button(undefined,'gb-pnl-day');btn.dataset.date=day;btn.disabled=future||!report;
  btn.setAttribute('aria-pressed',chosen?'true':'false');btn.classList.toggle('is-selected',chosen);btn.classList.toggle('is-today',day===currentDay());
  const net=Number(d?.net_units||0),pending=Number(d?.pending||0)+Number(d?.review||0);
  btn.setAttribute('aria-label',dateLabel(day)+', '+(future?'future date':d?units(net)+', '+count(d.bets)+' bets'+(pending?', '+pending+' pending':''):'loading'));
  btn.title=dateLabel(day)+(d?' · '+units(net)+' · '+count(d.bets)+' bets':'');
  const track=make('span',undefined,'gb-pnl-track'),bar=make('span',undefined,'gb-pnl-bar');
  track.setAttribute('aria-hidden','true');bar.classList.toggle('is-negative',net<0);bar.classList.toggle('is-zero',net===0);bar.classList.toggle('is-pending',net===0&&pending>0);
  bar.style.setProperty('--bar-height',(Math.abs(net)/max*85)+'px');track.append(bar);
  btn.append(track,make('span',String(Number(day.slice(-2))),'gb-pnl-day-label'));
  btn.addEventListener('click',()=>selectDay(chosen?null:day));
  btn.addEventListener('keydown',event=>{
   if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();
   const options=[...bars.querySelectorAll('button:not(:disabled)')],index=options.indexOf(btn);
   const position=event.key==='Home'?0:event.key==='End'?options.length-1:Math.max(0,Math.min(options.length-1,index+(event.key==='ArrowLeft'?-1:1)));
   options[position]?.focus({preventScroll:true});ensureVisible(options[position]);
  });bars.append(btn);
 }
 selection.textContent=state.date?dateLabel(state.date)+' selected. The figures above and bets below show this day.':'Showing overall results. Choose a day to view its breakdown.';
 if(oldFocus)bars.querySelector('[data-date="'+oldFocus+'"]')?.focus({preventScroll:true});
 const chartKey=periodKey();if(chartKey!==lastMonth){lastMonth=chartKey;const target=state.date||(state.month===currentDay().slice(0,7)?currentDay():report?.daily.find(d=>d.bets>0)?.date||days[0]);ensureVisible(bars.querySelector('[data-date="'+target+'"]'))}
}
function ensureVisible(el){if(!el)return;const left=el.offsetLeft;if(left<chartScroll.scrollLeft||left+el.offsetWidth>chartScroll.scrollLeft+chartScroll.clientWidth)chartScroll.scrollLeft=Math.max(0,left-chartScroll.clientWidth/2+el.offsetWidth/2)}
function betCard(row){
 const card=make('article',undefined,'gb-pnl-bet'),fixture=make('div',undefined,'gb-pnl-bet-fixture');
 const stamp=Number.isFinite(Date.parse(row.kickoff_at))?shortDate.format(new Date(row.kickoff_at))+' UK':dateLabel(row.fixture_date);
 fixture.append(make('h4',(row.home||'Unknown team')+' v '+(row.away||'Unknown team')),make('small',[row.league,stamp].filter(Boolean).join(' · ')));
 const pick=make('div',undefined,'gb-pnl-bet-selection');
 let pickText=marketNames[row.market]||row.market||'Selection';if(row.outcome)pickText+=' · '+row.outcome;
 pick.append(make('strong',pickText),make('small',row.bookmaker||'Bookmaker unavailable'));
 const stake=make('div',undefined,'gb-pnl-bet-stake');stake.append(make('strong',finite(row.units)?number.format(Number(row.units))+' u':'—'),make('small',finite(row.odds)?'Odds '+decimal.format(Number(row.odds)):'No recorded odds'));
 const result=make('div',undefined,'gb-pnl-bet-result'),settled=row.status==='settled';
 const label=row.status==='odds_unavailable'?'No bet · no odds':row.status==='review'?'Needs review':row.status==='void'||row.status==='push'?'Void':settled&&row.won===true?'Won':settled&&row.won===false?'Lost':settled?'Settled':'Pending';
 const resultValue=make('strong',settled&&finite(row.net_units)?units(row.net_units):row.status==='void'||row.status==='push'?'0.00 u':'—');
 if(settled)styleNet(resultValue,row.net_units);
 const badge=make('span',label,'gb-pnl-outcome '+(label==='Won'?'is-won':label==='Lost'?'is-lost':label==='Needs review'?'is-review':'is-pending'));
 if(settled&&finite(row.home_goals)&&finite(row.away_goals))badge.append(make('span',' · '+row.home_goals+'–'+row.away_goals));
 else if(settled&&row.score)badge.append(make('span',' · '+row.score));
 result.append(resultValue,badge);card.append(fixture,pick,stake,result);return card;
}
function showList(report,append){
 if(append){
  if(recordTotal!==report.total_records){state.offset=0;load();return false}
  const ids=new Set(records.map(r=>String(r.id??r.original_id)));
  if(report.records.some(r=>ids.has(String(r.id??r.original_id)))){state.offset=0;load();return false}
  records.push(...report.records);
 }else records=report.records.slice();
 recordTotal=report.total_records;
 list.replaceChildren();for(const row of records)list.append(betCard(row));
 empty.hidden=records.length>0;
 empty.textContent=state.query?'No bets match this search.':state.date?'No paper bets recorded on '+dateLabel(state.date)+'.':'No paper bets recorded for this model yet.';
 listMeta.textContent=(state.query?'Search results · ':'')+(recordTotal?number.format(records.length)+' of '+number.format(recordTotal)+' recorded selections':'0 recorded selections')+(state.query?' · P&L figures show the full selected period.':'');
 more.hidden=records.length>=recordTotal;more.disabled=false;
 return true;
}
function validateSummary(s){
 if(!s||!['bets','won','lost','pending','review','settled'].every(k=>Number.isInteger(Number(s[k]))&&Number(s[k])>=0)||!['units','units_settled','net_units'].every(k=>finite(s[k])))throw Error('The saved result totals are incomplete.');
}
function validate(data,key){
 if(data?.version!=='paper_dashboard_v1'||data.model!==key.model||data.month!==key.month||(data.date||null)!==key.date||data.query!==key.query||!Array.isArray(data.daily)||!Array.isArray(data.records)||!Number.isInteger(data.total_records)||data.total_records<0||Number(data.offset)!==key.offset)throw Error('The result report did not match the selected period.');
 validateSummary(data.summary);if(key.date)validateSummary(data.day_summary);
 const expected=math.monthDays(key.month);if(data.daily.length!==expected.length||new Set(data.daily.map(d=>d.date)).size!==expected.length||data.daily.some(d=>!expected.includes(d.date)))throw Error('Monthly history is incomplete.');
 data.daily.forEach(validateSummary);
 if(data.records.length>PAGE||data.total_records>key.offset&&!data.records.length)throw Error('The bet list is incomplete.');
 return data;
}
async function load({append=false}={}){
 if(!active())return;
 if(!append)state.offset=0;
 const key={...state},token=++requestId;controller?.abort();const ctrl=new AbortController();controller=ctrl;
 const cached=cache.get(periodKey());showSummary(cached);if(!append)showChart(cached);
 dashboard.setAttribute('aria-busy','true');refresh.disabled=true;more.disabled=true;
 status.classList.remove('gb-pnl-error');status.textContent='Updating saved results…';
 if(!append){records=[];list.replaceChildren();more.hidden=true;empty.hidden=false;empty.textContent='Loading bets…';listMeta.textContent=''}
 try{
  const params=new URLSearchParams({model:key.model,month:key.month,limit:String(PAGE),offset:String(key.offset),q:key.query});if(key.date)params.set('date',key.date);
  const response=await root.fetch(CLOUD_URL+'/functions/v1/gerball-paper-dashboard?'+params,{headers:{apikey:CLOUD_KEY},signal:AbortSignal.any([ctrl.signal,AbortSignal.timeout(30000)])});
  if(!response.ok)throw Error('Saved results unavailable ('+response.status+').');
  const result=validate(await response.json(),key);
  if(token!==requestId||!active())return;
  cache.set(periodKey(),result);showSummary(result);showChart(result);if(!showList(result,append))return;lastLoaded=Date.now();
  status.textContent='';
 }catch(error){
  if(token!==requestId||error.name==='AbortError')return;
  status.classList.add('gb-pnl-error');status.textContent='Could not update results. '+error.message+' Use Refresh to try again.';
  if(!cached){clearSummary();summaryMeta.textContent='Results unavailable. No totals have been assumed.';chartSummary.textContent='Monthly results unavailable.'}
  else summaryMeta.textContent+=' Showing the last successfully loaded report.';
  if(!append){empty.hidden=false;empty.textContent='The bet list could not be loaded.'}
 }finally{
  if(token===requestId){controller=null;refresh.disabled=false;more.disabled=false;dashboard.setAttribute('aria-busy','false')}
 }
}
function selectDay(day){
 if(day!==null&&(!dates.validDay(day)||day>currentDay()))return;
 state.date=day;if(day)state.month=day.slice(0,7);state.offset=0;
 syncLegacyScope();saveState();load();
}
function selectMonth(month){
 if(!math.monthDays(month).length||month>currentDay().slice(0,7)){monthInput.value=state.month;return}
 state.month=month;state.date=null;state.offset=0;syncLegacyScope();saveState();load();
}
overall.addEventListener('click',()=>selectDay(null));today.addEventListener('click',()=>selectDay(currentDay()));refresh.addEventListener('click',()=>load());
previous.addEventListener('click',()=>selectMonth(math.shiftMonth(state.month,-1)));next.addEventListener('click',()=>selectMonth(math.shiftMonth(state.month,1)));
monthInput.addEventListener('change',()=>selectMonth(monthInput.value));
search.addEventListener('input',()=>{root.clearTimeout(searchTimer);searchTimer=root.setTimeout(()=>{state.query=search.value.trim().toLocaleLowerCase('en-GB');state.offset=0;syncLegacySearch();load()},220)});
more.addEventListener('click',()=>{state.offset=records.length;load({append:true})});
function activate(){
 dashboard.hidden=!active();
 if(!active()){controller?.abort();requestId++;return}
 state.model=host.dataset.paperTab;dashboard.setAttribute('aria-labelledby','gb-paper-tab-'+state.model);syncLegacyScope();syncLegacySearch();load();
}
root.addEventListener('gerball:paper-tabchange',activate);
root.addEventListener('gerball:viewchange',()=>{if(active())activate();else{dashboard.hidden=true;controller?.abort();requestId++}});
doc.addEventListener('visibilitychange',()=>{if(!doc.hidden&&active()&&Date.now()-lastLoaded>60000)load()});
root.addEventListener('popstate',()=>{initialState();if(active())activate()});
initialState();dashboard.hidden=!active();if(active())activate();
})(window);
