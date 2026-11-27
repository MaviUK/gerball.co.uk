(function(root){'use strict';
const holder=root.document.getElementById('paperBets');
const view=root.document.getElementById('view-picks');
const dates=root.GerballPaperDates;
if(!dates||typeof dates.upcomingToday!=='function'||typeof dates.priceState!=='function')return;
if(!holder||!view)return;
const marketNames={H:'Home win',D:'Draw',A:'Away win',O25:'Over 2.5 goals',U25:'Under 2.5 goals'};
const reasonNames={candidate:'Model candidate',team_not_linked:'Team names not linked',insufficient_league_history:'Not enough league history',insufficient_venue_history:'Not enough comparable home/away games',no_captured_odds:'No recorded price',price_out_of_scope:'Odds outside selected range',stale_collection:'Captured odds too old',stale_provider_quote:'Bookmaker quote too old',no_estimated_edge:'No sufficient estimated edge'};
const fmtDate=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',day:'numeric',month:'short',year:'numeric'});
const fmtTime=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
const $=(tag,content,cls)=>{const e=root.document.createElement(tag);if(content!==undefined)e.textContent=String(content);if(cls)e.className=cls;return e};
const textDate=t=>t&&Number.isFinite(Date.parse(t))?fmtTime.format(new Date(t))+' UK':'—';
const calendarDate=value=>dates.validDay(value)?fmtDate.format(new Date(value+'T12:00:00Z')):value;
const fnum=(x,n=2)=>x!==null&&x!==undefined&&Number.isFinite(Number(x))?Number(x).toFixed(n):'—';
const cell=(value)=>{const s=value===null||value===undefined?'':String(value);const safe=/^\s*[=+@\-]/.test(s)&&!/^-[0-9]+(\.[0-9]+)?$/.test(s)?"'"+s:s;return '"'+safe.replace(/"/g,'""')+'"'};
const recordsCSV=rows=>{const cols=['id','model_version','league','home','away','kickoff_at','recorded_at','market','odds','bookmaker','quote_collected_at','model_probability','estimated_edge','units','status','revision','home_goals','away_goals','result','won','net_units','input'];return '\uFEFF'+[cols,...rows.map(row=>cols.map(c=>c==='input'?JSON.stringify(row.input):row[c]??''))].map(r=>r.map(cell).join(',')).join('\r\n')};
const download=(content,filename)=>{const b=new Blob([content],{type:'text/csv;charset=utf-8'});const u=URL.createObjectURL(b);const a=$('a');a.href=u;a.download=filename;root.document.body.append(a);a.click();a.remove();root.setTimeout(()=>URL.revokeObjectURL(u),1500)};
let active=false,loading=false,current=null,filter='all',priceFilter='all',exporting=false,ledgerScope='today';
let selectedDate=dates.day(new Date()),ledgerError=null;
let fixturesController=null,fixturesCounter=0,fixturesLastKey='';
let searchQuery='',searchResult=null,searchCounter=0,searchTimer=null,searchController=null;
let reportCounter=0,reportController=null,activityTimer=null,lastLoadedAt=null,lastAttemptAt=null,lastAttemptDay=null;
let reportInterrupted=false,searchInterrupted=false,requestedPage=0,refreshError=null;
let performanceCounter=0,performanceController=null,performanceLastLoaded=0;
const REFRESH_MS=5*60000,CLOCK_MS=30000;
const visible=()=>active&&!view.hidden&&!root.document.hidden;
const normalizeQuery=value=>String(value||'').trim().toLocaleLowerCase('en-GB');
const searchable=value=>String(value??'').toLocaleLowerCase('en-GB');
const matchesQuery=(row,q)=>!q||[row.home,row.away,row.league,row.market,marketNames[row.market],row.bookmaker,row.decision,reasonNames[row.decision],row.status,row.event_id,row.fixture_date].some(v=>searchable(v).includes(q));
const intro=$('section',undefined,'card');
const top=$('div',undefined,'pb-top');top.append($('h2','Research bet recommendations & P&L'));
const refresh=$('button','Refresh','secondary');refresh.type='button';top.append(refresh);
intro.append(top,$('p','Paper selections only. No bets are placed by this site. A unit is an abstract stake, not a money amount.','pb-caption'));
const historyPanel=$('div',undefined,'pb-history-filters');
const scopeLabel=$('label','View bets & results');scopeLabel.htmlFor='pb-ledger-scope';
const scopeSelect=$('select');scopeSelect.id='pb-ledger-scope';scopeSelect.setAttribute('aria-label','Date range for saved paper bets');
for(const [value,name] of [['today',"Today's bets"],['date','Choose a date'],['history','Complete history']]){const option=$('option',name);option.value=value;scopeSelect.append(option)}
const scopePanel=$('div',undefined,'pb-ledger-scope');scopePanel.append(scopeLabel,scopeSelect);
const dateControls=$('div',undefined,'pb-date-navigation');
const dateField=$('div',undefined,'pb-date-field'),dateLabel=$('label','Match date (UK)');dateLabel.htmlFor='pb-ledger-date';
const dateInput=$('input');dateInput.id='pb-ledger-date';dateInput.type='date';dateInput.value=selectedDate;dateInput.min='0001-01-01';dateInput.max=selectedDate;
dateField.append(dateLabel,dateInput);
const dayButtons=$('div',undefined,'pb-day-buttons');
const previousDay=$('button','Previous day','secondary'),nextDay=$('button','Next day','secondary'),todayButton=$('button','Today','secondary');
previousDay.type=nextDay.type=todayButton.type='button';nextDay.disabled=true;
dayButtons.append(previousDay,nextDay,todayButton);dateControls.append(dateField,dayButtons);
const dateMessage=$('p','Dates follow the match kickoff in UK time.','pb-caption');dateMessage.setAttribute('role','status');
historyPanel.append(scopePanel,dateControls,dateMessage);intro.append(historyPanel);
const searchPanel=$('div',undefined,'pb-search');
const searchLabel=$('label','Search fixtures and paper bets');
const searchInput=$('input');searchInput.type='search';searchInput.id='pb-search';
searchInput.maxLength=100;searchInput.placeholder='Team, league, market, bookmaker, status…';
searchLabel.htmlFor='pb-search';
const clearSearch=$('button','Clear','secondary');clearSearch.type='button';clearSearch.disabled=true;
searchPanel.append(searchLabel,searchInput,clearSearch);intro.append(searchPanel);
intro.append($('p','Saved candidates require adequate league/home/away samples, bookmaker odds captured no more than 120 minutes before the saved assessment, and an unvalidated estimated edge of at least 8%. Captured prices are not live quotes. These thresholds do not establish a real betting advantage.','pb-warning'));
const status=$('p','Report not loaded','pb-status');status.setAttribute('role','status');intro.append(status);
const lifetime=$('details',undefined,'pb-lifetime');lifetime.append($('summary','Lifetime P&L'));
const summaryBox=$('div',undefined,'pb-dashboard');lifetime.append($('p','All recorded paper bets. Date and search filters below do not change these lifetime totals.','pb-caption'),summaryBox);intro.append(lifetime);
const performance=$('section',undefined,'card pb-performance');
performance.append($('h2','Daily paper-bet performance'),$('p','Historical selections grouped by UK match date. Only verified settled outcomes affect net units, ROI and the cumulative P&L line. Unsettled bets remain pending.','pb-caption'));
const performanceStatus=$('p','Loading historical performance…','pb-caption');
const performanceMetrics=$('div',undefined,'pb-dashboard');
const performanceChart=$('div',undefined,'pb-performance-chart');
const performanceTable=$('div',undefined,'pb-table-wrap pb-history-table');
performance.append(performanceStatus,performanceMetrics,performanceChart,performanceTable);

const fixturesPanel=$('section',undefined,'card pb-date-fixtures');
const fixturesHeading=$('h2','Matches with paper bets');
const fixturesMode=$('select');fixturesMode.id='pb-fixtures-mode';fixturesMode.setAttribute('aria-label','Choose which matches to display');
for(const [value,label] of [['bets','Only matches with paper bets'],['all','All recorded matches']]){const option=$('option',label);option.value=value;fixturesMode.append(option)}
const fixturesHeader=$('div',undefined,'pb-top');fixturesHeader.append(fixturesHeading,fixturesMode);
const fixturesStatus=$('p','Choose a day to see its recorded paper bets and results.','pb-caption');
const fixturesWrap=$('div',undefined,'pb-table-wrap pb-history-table');
fixturesPanel.append(fixturesHeader,fixturesStatus,fixturesWrap);
const candidateSection=$('section',undefined,'card pb-assessments'),candidateTop=$('div',undefined,'pb-top');
candidateTop.append($('h2',"Today's match assessments"));
const selector=$('select');selector.setAttribute('aria-label','Show assessments');for(const [value,label] of [['all','All matches'],['candidate','Model candidates'],['no','No bet']]){const o=$('option',label);o.value=value;selector.append(o)}
candidateTop.append(selector);
const priceSelector=$('select');priceSelector.setAttribute('aria-label','Show price freshness');
for(const [value,label] of [['all','All price ages'],['recent','Recent quotes (15m)'],['aging','Aging saved prices'],['old','Old / unverified']]){
 const option=$('option',label);option.value=value;priceSelector.append(option);
}
candidateTop.append(priceSelector);candidateSection.append(candidateTop);
const candidateStatus=$('p','','pb-caption');const cards=$('div',undefined,'pb-list');
candidateSection.append(candidateStatus,cards);
const ledger=$('section',undefined,'card pb-ledger');const ledgerTop=$('div',undefined,'pb-top');const ledgerTitle=$('h2',"Today's paper bets");ledgerTop.append(ledgerTitle);
const downloadButton=$('button','Export all paper bets (CSV)','secondary');downloadButton.type='button';ledgerTop.append(downloadButton);
ledger.append(ledgerTop,$('p','Original selections, odds and stakes are saved before kickoff. Results and unit returns update when verified scores are imported. Pending bets do not count as wins or losses.','pb-caption'));
const daySummary=$('div',undefined,'pb-day-summary');ledger.append(daySummary);
const daySummaryNote=$('p','','pb-caption pb-day-summary-note');ledger.append(daySummaryNote);
const ledgerStatus=$('p','','pb-caption');ledgerStatus.setAttribute('role','status');ledger.append(ledgerStatus);
const scroll=$('div',undefined,'pb-table-wrap pb-history-table');ledger.append(scroll);
const pagination=$('div',undefined,'pb-controls');const newer=$('button','Previous page','secondary'),older=$('button','Next page','secondary');newer.type=older.type='button';pagination.append(newer,older);ledger.append(pagination);
holder.append(intro,performance,fixturesPanel,ledger,candidateSection);
let page=0;const PAGE=250;
const filteredLedger=()=>ledgerScope!=='history'||searchQuery!=='';
function ledgerPath(limit,offset,scope=ledgerScope,query=searchQuery,date=selectedDate){
 return '?limit='+limit+'&offset='+offset+(scope==='today'?'&scope=today':scope==='date'?'&scope=date&date='+encodeURIComponent(date):'')+(query?'&q='+encodeURIComponent(query):'');
}
function syncDateControls(now=new Date()){
 const today=dates.day(now);
 if(ledgerScope==='today'&&selectedDate!==today){selectedDate=today;page=0;searchResult=null;ledgerError=null;cancelSearch();searchInterrupted=true;if(current)drawLedger()}
 dateInput.max=today;dateInput.value=selectedDate;scopeSelect.value=ledgerScope;
 dateControls.hidden=ledgerScope==='history';
 fixturesPanel.hidden=ledgerScope==='history';
 previousDay.disabled=selectedDate==='0001-01-01';nextDay.disabled=selectedDate>=today;todayButton.disabled=ledgerScope==='today';
 candidateSection.hidden=ledgerScope==='history'||selectedDate!==today;
}
function drawDaySummary(result){
 daySummary.replaceChildren();daySummaryNote.textContent='';
 daySummary.hidden=daySummaryNote.hidden=ledgerScope==='history';
 if(ledgerScope==='history'||!result?.summary)return;
 const s=result.summary;
 for(const [label,value] of [['Bets',s.bets],['Won',s.won],['Lost',s.lost],['Awaiting result',(s.pending??0)+(s.review??0)],['Net units',(Number(s.net_units)>=0?'+':'')+fnum(s.net_units)],['ROI',s.roi_pct===null?'—':fnum(s.roi_pct)+'%']]){
  const tile=$('div',undefined,'pb-day-metric');tile.append($('span',label),$('strong',value));
  if(label==='Net units')tile.className+=' '+(Number(s.net_units)<0?'pb-negative':'pb-positive');
  daySummary.append(tile);
 }
 daySummaryNote.textContent=(searchQuery?'Matching bets · ':'')+s.units_recommended+' units staked · '+s.settled+' of '+s.bets+' settled'+(s.review?' · '+s.review+' need result review':'')+'. ROI uses settled stakes only.';
}
function drawMetrics(){
 summaryBox.replaceChildren();const total=current.summary.find(x=>x.market==='ALL')||{};
 for(const [name,value] of [['Paper bets',total.bets??0],['Settled',total.settled??0],['Net units',total.net_units===undefined?'—':(Number(total.net_units)>=0?'+':'')+fnum(total.net_units)],['ROI',total.roi_pct===null||total.roi_pct===undefined?'Not available':fnum(total.roi_pct)+'%'],['Recommended units',total.units_recommended??0],['Pending',total.pending??0],['Won / lost',(total.won??0)+' / '+(total.lost??0)],['Max drawdown',current.max_drawdown_units===null?'Not available':fnum(current.max_drawdown_units)+' units']]){
 const tile=$('div',undefined,'pb-metric');tile.append($('small',name),$('strong',value));summaryBox.append(tile);
 }
}

const performanceNumber=n=>(Number(n)>0?'+':'')+fnum(n);
function drawPerformance(rows){
 performanceMetrics.replaceChildren();performanceChart.replaceChildren();performanceTable.replaceChildren();
 const byDay=new Map();
 for(const b of rows){
  const date=b.fixture_date||dates.day(new Date(b.kickoff_at));
  if(!dates.validDay(date))continue;
  let d=byDay.get(date);
  if(!d){d={date,bets:0,settled:0,won:0,lost:0,pending:0,stake:0,net:0};byDay.set(date,d)}
  d.bets++;
  if(b.status==='settled'&&Number.isFinite(Number(b.net_units))&&Number.isFinite(Number(b.units))){
   d.settled++;d.stake+=Number(b.units);d.net+=Number(b.net_units);
   if(b.won===true)d.won++;else if(b.won===false)d.lost++;
  }else d.pending++;
 }
 const days=[...byDay.values()].sort((a,b)=>a.date.localeCompare(b.date));let cumulative=0;
 for(const d of days){d.net=Math.round(d.net*100)/100;cumulative=Math.round((cumulative+d.net)*100)/100;d.cumulative=cumulative;d.roi=d.stake?100*d.net/d.stake:null}
 const all=days.reduce((a,d)=>{a.bets+=d.bets;a.settled+=d.settled;a.won+=d.won;a.lost+=d.lost;a.stake+=d.stake;return a},{bets:0,settled:0,won:0,lost:0,stake:0});
 const stats=[['Recorded bets',all.bets],['Settled bets',all.settled],['Win rate',all.settled?fnum(all.won/all.settled*100,1)+'%':'—'],['Net units',performanceNumber(cumulative)],['ROI',all.stake?fnum(cumulative/all.stake*100)+'%':'—']];
 for(const [name,value] of stats){const tile=$('div',undefined,'pb-metric');tile.append($('small',name),$('strong',value));performanceMetrics.append(tile)}
 if(!days.length){performanceStatus.textContent='No recorded dates yet.';return}
 performanceStatus.textContent=days.length+' recorded match dates · '+all.settled+' settled of '+all.bets+' bets. ROI uses settled stakes only.';
 if(all.settled){
  const width=740,height=210,pad=35,ns='http://www.w3.org/2000/svg',svg=root.document.createElementNS(ns,'svg');
  svg.setAttribute('viewBox','0 0 '+width+' '+height);svg.setAttribute('role','img');svg.setAttribute('aria-label','Cumulative settled paper-bet net units by match date');svg.style.width='100%';svg.style.height='auto';
  const points=[{cumulative:0},...days];let min=Math.min(0,...points.map(p=>p.cumulative)),max=Math.max(0,...points.map(p=>p.cumulative));
  if(max===min){max+=1;min-=1}
  const x=i=>pad+(width-pad*2)*i/Math.max(1,points.length-1),y=v=>height-pad-(height-2*pad)*(v-min)/(max-min);
  const axis=root.document.createElementNS(ns,'line');axis.setAttribute('x1',pad);axis.setAttribute('x2',width-pad);axis.setAttribute('y1',y(0));axis.setAttribute('y2',y(0));axis.setAttribute('stroke','#93a6bd');axis.setAttribute('stroke-dasharray','4 5');svg.append(axis);
  const path=root.document.createElementNS(ns,'polyline');path.setAttribute('points',points.map((d,i)=>x(i)+','+y(d.cumulative)).join(' '));path.setAttribute('fill','none');path.setAttribute('stroke','#70d7ac');path.setAttribute('stroke-width','3');path.setAttribute('stroke-linejoin','round');svg.append(path);
  const title=root.document.createElementNS(ns,'title');title.textContent='Cumulative P&L: '+performanceNumber(cumulative)+' units over '+days.length+' recorded dates';svg.prepend(title);
  performanceChart.append(svg,$('p','Cumulative P&L (units) · '+calendarDate(days[0].date)+' to '+calendarDate(days[days.length-1].date),'pb-caption'));
 }else performanceChart.append($('p','The P&L chart will appear once match results are verified and settled.','pb-caption'));
 const table=$('table'),head=$('thead'),tr=$('tr'),names=['Date','Bets','Won / lost','Pending','Daily units','ROI','Running units'];
 for(const name of names){const th=$('th',name);th.scope='col';tr.append(th)}head.append(tr);table.append(head);
 const body=$('tbody');
 for(const d of days.slice().reverse()){
  const row=$('tr'),values=[calendarDate(d.date),d.bets,d.won+' / '+d.lost,d.pending,performanceNumber(d.net),d.roi===null?'—':fnum(d.roi)+'%',performanceNumber(d.cumulative)];
  values.forEach((value,i)=>{const td=$('td',value);td.setAttribute('data-label',names[i]);if(i===4||i===6)td.className=(i===4?d.net:d.cumulative)<0?'pb-negative':'pb-positive';row.append(td)});
  row.addEventListener('click',()=>chooseScope(d.date===dates.day(new Date())?'today':'date',d.date));
  row.style.cursor='pointer';row.title='View saved bets for '+calendarDate(d.date);body.append(row);
 }
 table.append(body);performanceTable.append(table);
}
async function refreshPerformance(force=false){
 if(!visible()||(!force&&performanceLastLoaded&&Date.now()-performanceLastLoaded<REFRESH_MS))return;
 const token=++performanceCounter;
 if(performanceController)performanceController.abort();
 const controller=new AbortController();performanceController=controller;
 performanceStatus.textContent='Updating daily results…';
 try{
  const rows=[];let offset=0,total=0;
  do{
   const response=await fetch(CLOUD_URL+'/functions/v1/gerball-paper-bets?q=&limit=1000&offset='+offset,{headers:{apikey:CLOUD_KEY},signal:AbortSignal.any([controller.signal,AbortSignal.timeout(30000)])});
   if(!response.ok)throw Error('History unavailable ('+response.status+')');
   const data=await response.json();
   if(data.version!=='paper_search_v1'||!Array.isArray(data.records)||!Number.isInteger(data.total_records)||data.total_records>50000)throw Error('Invalid history response');
   total=data.total_records;rows.push(...data.records);offset+=data.records.length;
   if(offset<total&&!data.records.length)throw Error('Incomplete historical results');
  }while(offset<total);
  if(token!==performanceCounter||!visible())return;
  drawPerformance(rows);performanceLastLoaded=Date.now();
 }catch(error){
  if(token===performanceCounter&&error.name!=='AbortError')performanceStatus.textContent='Could not load daily performance: '+error.message;
 }finally{if(token===performanceCounter)performanceController=null}
}

function quoteAge(p,now){
 const state=dates.priceState(p,now);
 if(state.captureMinutes===null)return state.detail;
 const captured=state.captureMinutes,provider=state.providerMinutes;
 const elapsed=minutes=>minutes>=60?Math.floor(minutes/60)+'h '+(minutes%60)+'m':minutes+'m';
 return 'Captured '+elapsed(captured)+' ago · Bookmaker last updated '+elapsed(provider)+' ago · '+state.detail+
  (state.status==='old'?' Price older than 2 hours; saved assessment.':'');
}
function matchCard(p,now){
 const box=$('article',undefined,'pb-match'),h=$('h3',(p.home||'?')+' v '+(p.away||'?'));box.append(h);
 box.append($('p',p.league+' · '+textDate(p.kickoff_at),'pb-caption'));
 const tags=$('div',undefined,'pb-tags');const yes=p.decision==='candidate';
 const freshness=dates.priceState(p,now);
 tags.append($('span',yes?'PAPER '+p.units+' '+(p.units===1?'unit':'units'):'NO BET',yes?'pb-yes':'pb-no'));
 tags.append($('span',marketNames[p.market]||p.market));
 tags.append($('span',freshness.label,'pb-price-'+freshness.status));
 box.append(tags);
 const dl=$('dl');for(const [name,value] of [
 ['Captured odds',p.quoted_odds?fnum(p.quoted_odds):'Unavailable'],
 ['Bookmaker',p.bookmaker||'—'],
 ['Model estimate',p.probability===null?'Unavailable':fnum(Number(p.probability)*100,1)+'%'],
 ['Exploratory model edge',p.decision==='candidate'||p.decision==='no_estimated_edge'?(p.estimated_edge===null?'Unavailable':fnum(Number(p.estimated_edge)*100,1)+'%'):'Not assessed (excluded)'],
 ['Home / away samples',(p.home_sample??0)+' / '+(p.away_sample??0)],
 ['Decision',reasonNames[p.decision]||p.decision]]){dl.append($('dt',name),$('dd',value))}
 box.append(dl,$('p',quoteAge(p,now),'pb-caption'));
 if(['H','D','A'].includes(p.market)){
  const updated=root.GerballPaperPriceComparison?.get(p.event_id,p.market,p.kickoff_at,now);
  const detail=updated
   ? 'Intraday fixed-odds comparison: '+fnum(updated.odds)+' ('+updated.bookmaker+') · '+
     (updated.fresh?'recent saved quote':'older saved quote')+
     ', captured '+updated.ageMinutes+'m ago. Original '+fnum(p.quoted_odds)+' price and paper units remain unchanged.'
   : 'No matching intraday fixed-odds quote yet; only the original saved assessment is available.';
  box.append($('p',detail,'pb-intraday-note'));
 }else box.append($('p','Intraday refreshed prices currently cover 1X2 only; this market has no updated comparison.','pb-intraday-note'));
 box.append($('small','Saved form: '+textDate(p.recorded_at)+' · Price captured: '+textDate(p.quote_collected_at)));
 return box;
}
function drawCandidates(now=new Date()){
 cards.replaceChildren();
 let source=dates.upcomingToday(current.preview?.fixtures||[],now);
 const total=source.length;
 if(filter==='candidate')source=source.filter(p=>p.decision==='candidate');
 if(filter==='no')source=source.filter(p=>p.decision!=='candidate');
 const counts={recent:0,aging:0,old:0,unverified:0,unavailable:0};
 for(const p of source)counts[dates.priceState(p,now).status]++;
 if(priceFilter!=='all')source=source.filter(p=>{
  const age=dates.priceState(p,now).status;
  return priceFilter==='old'?['old','unverified','unavailable'].includes(age):age===priceFilter;
 });
 if(searchQuery)source=source.filter(p=>matchesQuery(p,searchQuery));
 candidateStatus.textContent=source.length+' of '+total+' fixtures still to kick off today ('+dates.day(now)+' UK)'+
 (searchQuery?' for “'+searchQuery+'”':'')+
 '. Saved quote ages: '+counts.recent+' recent, '+counts.aging+' aging, '+(counts.old+counts.unverified+counts.unavailable)+' old/unverified. Prices are snapshots, not guaranteed executable odds.';
 if(!source.length){cards.append($('p',total?'No remaining matches today meet this filter.':'No fixtures still to kick off today in the latest captured assessments. The saved paper-bet record is available above.','pb-caption'));return}
 for(const p of source.slice(0,72))cards.append(matchCard(p,now));
 if(source.length>72)cards.append($('p','Showing 72 of '+source.length+' matching fixtures.','pb-caption'));
}
function clearFixtureRequest(){
 fixturesCounter++;if(fixturesController)fixturesController.abort();fixturesController=null;
}
async function loadDayFixtures(force=false){
 if(!visible())return;
 if(ledgerScope==='history'){clearFixtureRequest();fixturesPanel.hidden=true;return}
 fixturesPanel.hidden=false;
 const date=ledgerScope==='today'?dates.day(new Date()):selectedDate;
 const key=date;
 if(!force&&fixturesLastKey===key)return;
 const token=++fixturesCounter;
 if(fixturesController)fixturesController.abort();
 const controller=new AbortController();fixturesController=controller;
 fixturesHeading.textContent='Matches · '+calendarDate(date);
 fixturesStatus.textContent='Loading matches for '+calendarDate(date)+'…';
 fixturesWrap.replaceChildren();
 try{
  const response=await fetch(CLOUD_URL+'/functions/v1/gerball-paper-bets?scope=fixtures&date='+encodeURIComponent(date),{headers:{apikey:CLOUD_KEY},signal:AbortSignal.any([controller.signal,AbortSignal.timeout(30000)])});
  if(!response.ok)throw Error('Match history unavailable ('+response.status+')');
  const result=await response.json();
  if(result?.version!=='gerball_day_fixtures_v1'||result.date!==date||!Array.isArray(result.matches))throw Error('Invalid match history');
  if(token!==fixturesCounter||!visible()||ledgerScope==='history')return;
  fixturesLastKey=key;
  const showAll=fixturesMode.value==='all';
  const shown=result.matches.filter(m=>showAll||(Array.isArray(m.paper_bets)&&m.paper_bets.length>0));
  fixturesHeading.textContent=(showAll?'All matches':'Matches with paper bets')+' · '+calendarDate(date);
  fixturesStatus.textContent=showAll
    ?shown.length+' recorded matches · '+shown.filter(m=>m.result!==null&&m.home_goals!==null&&m.away_goals!==null).length+' final results. Scores are shown after verified import.'
    :shown.length+' match'+(shown.length===1?'':'es')+' with recorded paper bets'+(shown.length?'. Results appear after verified import.':'.');
  if(!shown.length){fixturesWrap.append($('p',showAll?'No fixtures have been recorded for this date.':'No paper bets were recorded for this date. Use “All recorded matches” to browse the other fixtures.','pb-caption'));return}
  const table=$('table'),head=$('thead'),headingRow=$('tr');
  const labels=['Kickoff','League','Match','Score','Result','Paper bet'];
  for(const label of labels){const th=$('th',label);th.scope='col';headingRow.append(th)}
  head.append(headingRow);table.append(head);
  const body=$('tbody');
  for(const m of shown){
   const row=$('tr'),hasResult=m.result!==null&&m.home_goals!==null&&m.away_goals!==null;
   const selections=Array.isArray(m.paper_bets)?m.paper_bets:[];
   const values=[m.kickoff_at?textDate(m.kickoff_at):'Time not recorded',m.league||'—',(m.home||'?')+' v '+(m.away||'?'),hasResult?m.home_goals+'–'+m.away_goals:'—',hasResult?(m.result==='H'?'Home win':m.result==='A'?'Away win':'Draw'):'Awaiting imported result',selections.length?selections.map(b=>(marketNames[b.market]||b.market)+' · '+b.units+'u @ '+fnum(b.odds)).join('; '):'None'];
   values.forEach((v,i)=>{const td=$('td',v);td.setAttribute('data-label',labels[i]);if(i===3&&hasResult)td.className='pb-positive';row.append(td)});
   body.append(row);
  }
  table.append(body);fixturesWrap.append(table);
 }catch(e){
  if(token===fixturesCounter&&e.name!=='AbortError')fixturesStatus.textContent='Could not load matches: '+e.message;
 }finally{if(token===fixturesCounter)fixturesController=null}
}

fixturesMode.addEventListener('change',()=>{fixturesLastKey='';loadDayFixtures(true)});
function drawLedger(){
 scroll.replaceChildren();
 const filtered=filteredLedger(),daily=ledgerScope!=='history';
 const result=filtered?searchResult:current;
 ledgerTitle.textContent=ledgerScope==='today'?"Today's paper bets":daily?'Paper bets · '+calendarDate(selectedDate):'Complete paper record';
 const entries=result?.records||[],count=result?.total_records??0;
 downloadButton.textContent=ledgerScope==='today'?'Export today’s bets (CSV)':daily?'Export this date (CSV)':searchQuery?'Export matching bets (CSV)':'Export all paper bets (CSV)';
 drawDaySummary(result);
 const queryText=searchQuery?' matching “'+searchQuery+'”':'';
 const pageText=count?' Showing '+(page*PAGE+1)+'–'+Math.min(page*PAGE+entries.length,count)+' of '+count+'.':'';
 ledgerStatus.textContent=ledgerError?'Could not load these bets: '+ledgerError+'. Use Refresh to try again.':daily
 ? result?count+' paper bets kicking off '+(ledgerScope==='today'?'today':'on '+calendarDate(result.date))+' ('+result.date+' UK)'+queryText+'.'+pageText:'Loading paper bets for '+calendarDate(selectedDate)+'…'
 : searchQuery?result?count+' matching saved paper bets for “'+searchQuery+'”.'+pageText:'Searching the complete saved ledger…'
 : (current?.total_records||0)+' total saved paper bets.'+pageText+' Original selections and the latest imported results.';
 ledger.setAttribute('aria-busy',filtered&&!result&&!ledgerError?'true':'false');
 const table=$('table');const header=$('thead'),row=$('tr');
 const headings=['Fixture','Kickoff','Market','Odds','Units','Bookmaker','Outcome','Score','Net units'];
 for(const name of headings){const th=$('th',name);th.setAttribute('scope','col');row.append(th)}header.append(row);table.append(header);
 const body=$('tbody');
 for(const b of entries){
  const tr=$('tr'),settled=b.status==='settled';
  const outcome=settled?(b.won===true?'Won':b.won===false?'Lost':'Result unavailable'):b.status==='review'?'Needs review':'Pending';
  const outcomeClass=outcome==='Won'?'pb-outcome-won':outcome==='Lost'?'pb-outcome-lost':'pb-outcome-pending';
  const score=settled&&b.home_goals!==null&&b.away_goals!==null&&Number.isFinite(Number(b.home_goals))&&Number.isFinite(Number(b.away_goals))?b.home_goals+'–'+b.away_goals:'Awaiting result';
  const net=settled&&b.net_units!==null&&b.net_units!==undefined?(Number(b.net_units)>0?'+':'')+fnum(b.net_units):'—';
  const values=[b.home+' v '+b.away,textDate(b.kickoff_at),marketNames[b.market]||b.market,fnum(b.odds),b.units,b.bookmaker||'—',outcome,score,net];
  for(let i=0;i<values.length;i++){
   const td=$('td');td.setAttribute('data-label',headings[i]);
   if(i===6)td.append($('span',values[i],'pb-outcome '+outcomeClass));else td.textContent=String(values[i]);
   if(i===0&&b.league)td.append($('small',b.league,'pb-record-league'));
   if(i===8&&net!=='—')td.className=Number(b.net_units)<0?'pb-negative':'pb-positive';
   tr.append(td);
  }
  body.append(tr);
 }
 if(!entries.length){
  const message=ledgerError?'Results could not be loaded.':!result?'Loading saved records…':daily?'No saved paper bets for '+(ledgerScope==='today'?'today':calendarDate(selectedDate))+(searchQuery?' matching this search':'')+'.':searchQuery?'No paper bets match this search.':'No saved paper bets. Recommendations are recorded only before kickoff.';
  const tr=$('tr'),td=$('td',message,'pb-ledger-empty');td.colSpan=headings.length;tr.append(td);body.append(tr);
 }
 table.append(body);scroll.append(table);
 newer.disabled=page===0||filtered&&!result;older.disabled=filtered&&!result||(page+1)*PAGE>=count;
 busyButtons();
}
function busyButtons(){refresh.disabled=loading;downloadButton.disabled=loading||exporting||!current||filteredLedger()&&!searchResult||!!ledgerError}
function drawStatus(now=new Date()){
 if(loading){status.textContent='Refreshing saved paper recommendations and P&L…';return}
 if(refreshError){status.textContent='Could not refresh: '+refreshError+(current?'. Showing cached report from '+textDate(current.generated_at)+'. Started fixtures are hidden using the current UK clock.':'. Please try Refresh.');return}
 if(current)status.textContent='Report updated '+textDate(current.generated_at)+' · '+current.model_version+' · '+dates.upcomingToday(current.preview.fixtures,now).length+' fixtures still to kick off today (UK)';
}
function drawCurrent(now=new Date()){
 syncDateControls(now);
 if(current)drawCandidates(now);
 drawStatus(now);
}
function cancelSearch(){
 if(searchTimer!==null){root.clearTimeout(searchTimer);searchTimer=null}
 searchCounter++;
 if(searchController)searchController.abort();
 searchController=null;
}
function pauseActivity(){
 if(activityTimer!==null){root.clearTimeout(activityTimer);activityTimer=null}
 if(loading)reportInterrupted=true;
 if(searchController||searchTimer!==null)searchInterrupted=filteredLedger();
 reportCounter++;
 if(reportController)reportController.abort();
 reportController=null;loading=false;cancelSearch();busyButtons();
}
function needsRefresh(now){
 return reportInterrupted||!current||refreshError!==null||lastLoadedAt===null||now.getTime()-lastLoadedAt>=REFRESH_MS||dates.day(current.generated_at)!==dates.day(now);
}
function scheduleActivity(){
 if(activityTimer!==null)root.clearTimeout(activityTimer);
 activityTimer=null;if(!visible())return;
 const now=new Date(),timestamp=now.getTime();
 let delay=CLOCK_MS;
 const boundary=dates.nextChangeAt(current?.preview?.fixtures||[],now);
 if(Number.isFinite(boundary)&&boundary>timestamp)delay=Math.min(delay,boundary-timestamp);
 if(!loading){
  const due=needsRefresh(now)?(lastAttemptAt===null?timestamp:lastAttemptAt+CLOCK_MS):lastLoadedAt+REFRESH_MS;
  if(due>timestamp)delay=Math.min(delay,due-timestamp);
 }
 activityTimer=root.setTimeout(()=>{activityTimer=null;checkActivity()},Math.max(1,delay));
}
function checkActivity(){
 if(!visible()){pauseActivity();return}
 const now=new Date();drawCurrent(now);
 const mayAttempt=reportInterrupted||lastAttemptAt===null||lastAttemptDay!==dates.day(now)||now.getTime()-lastAttemptAt>=CLOCK_MS;
 if(!loading&&needsRefresh(now)&&mayAttempt)load(reportInterrupted?requestedPage:page,{automatic:true});
 else if(!loading&&current&&filteredLedger()&&searchInterrupted&&!searchController)searchLedger(page);
 scheduleActivity();
}
async function fetchPage(num,signal){
 const r=await fetch(CLOUD_URL+'/functions/v1/gerball-paper-bets?limit='+PAGE+'&offset='+(num*PAGE),{headers:{apikey:CLOUD_KEY},signal:AbortSignal.any([signal,AbortSignal.timeout(30000)])});
 if(!r.ok)throw Error('Paper bets unavailable ('+r.status+')');
 const j=await r.json();if(j?.version!=='paper_ledger_v1'||!Array.isArray(j.summary)||!Array.isArray(j.records)||!Array.isArray(j.preview?.fixtures))throw Error('Invalid report');
 return j;
}
async function searchLedger(num=0,{keepExisting=false}={}){
 if(!current||!visible()){searchInterrupted=filteredLedger();return}
 if(searchTimer!==null){root.clearTimeout(searchTimer);searchTimer=null}
 const query=searchQuery,scope=ledgerScope,date=selectedDate,token=++searchCounter;
 if(searchController)searchController.abort();
 const controller=new AbortController();searchController=controller;searchInterrupted=false;
 if(query===''&&scope==='history'){page=0;searchResult=null;searchController=null;drawLedger();return}
 if(!keepExisting||page!==num||(scope!=='history'&&searchResult?.date!==date))searchResult=null;
 ledgerError=null;page=num;drawLedger();
 try{
  const path=ledgerPath(PAGE,num*PAGE,scope,query,date);
  const response=await fetch(CLOUD_URL+'/functions/v1/gerball-paper-bets'+path,{headers:{apikey:CLOUD_KEY},signal:AbortSignal.any([controller.signal,AbortSignal.timeout(30000)])});
  if(!response.ok)throw Error('Search unavailable ('+response.status+')');
  const result=await response.json();
  if(result?.version!==(scope==='today'?'paper_today_v1':scope==='date'?'paper_day_v1':'paper_search_v1')||!Array.isArray(result.records)||!Number.isInteger(result.total_records)||result.query!==query||(scope!=='history'&&(result.date!==date||!result.summary)))throw Error('Invalid search results');
  if(token!==searchCounter||searchQuery!==query||ledgerScope!==scope||selectedDate!==date||!visible())return;
  searchResult=result;drawLedger();
 }catch(error){
  if(token!==searchCounter||!visible()||error.name==='AbortError')return;
  ledgerError=error.message;drawLedger();
 }finally{if(token===searchCounter)searchController=null}
}
async function load(num=0,{automatic=false}={}){
 if(!visible())return;
 const token=++reportCounter,queryAtStart=searchQuery,scopeAtStart=ledgerScope,dateAtStart=selectedDate,pageAtStart=page,reportPage=filteredLedger()?0:num;
 if(reportController)reportController.abort();
 const controller=new AbortController();reportController=controller;
 requestedPage=num;reportInterrupted=false;loading=true;lastAttemptAt=Date.now();lastAttemptDay=dates.day(new Date());
 busyButtons();drawCurrent();scheduleActivity();
 try{
  const data=await fetchPage(reportPage,controller.signal);
  if(token!==reportCounter||!visible())return;
  current=data;lastLoadedAt=Date.now();refreshError=null;
  if(!automatic&&page===pageAtStart&&searchQuery===queryAtStart&&ledgerScope===scopeAtStart&&selectedDate===dateAtStart)page=num;
  drawMetrics();drawCandidates(new Date());drawLedger();refreshPerformance(!automatic);loadDayFixtures(!automatic);
  if(filteredLedger())await searchLedger(page,{keepExisting:automatic});
 }catch(error){
  if(token!==reportCounter||!visible()||error.name==='AbortError')return;
  refreshError=error.message;
  if(!current){cards.replaceChildren();scroll.replaceChildren();summaryBox.replaceChildren()}
 }finally{
  if(token===reportCounter){loading=false;reportController=null;busyButtons();drawCurrent(new Date());scheduleActivity()}
 }
}
refresh.addEventListener('click',()=>load(0));
selector.addEventListener('change',()=>{filter=selector.value;if(current)drawCandidates()});
priceSelector.addEventListener('change',()=>{priceFilter=priceSelector.value;if(current)drawCandidates()});
function updateSearch(){
 const next=normalizeQuery(searchInput.value);if(next===searchQuery)return;
 searchQuery=next;searchResult=null;page=0;clearSearch.disabled=!next;
 cancelSearch();ledgerError=null;searchInterrupted=filteredLedger();
 if(current){drawCandidates();drawLedger();if(filteredLedger()&&visible())searchTimer=root.setTimeout(()=>{searchTimer=null;searchLedger(0)},220);else if(!next)load(0)}
 scheduleActivity();
}
searchInput.addEventListener('input',updateSearch);
clearSearch.addEventListener('click',()=>{searchInput.value='';updateSearch();searchInput.focus()});
function chooseScope(scope,date=selectedDate){
 if(!['today','date','history'].includes(scope))return;
 const today=dates.day(new Date());
 if(scope==='today')date=today;
 if(scope!=='history'&&(!dates.validDay(date)||date>today)){
  dateInput.value=selectedDate;dateMessage.textContent='Choose a valid date on or before today (UK).';return;
 }
 ledgerScope=scope;selectedDate=date;page=0;searchResult=null;ledgerError=null;cancelSearch();searchInterrupted=filteredLedger();
 dateMessage.textContent='Dates follow the match kickoff in UK time.';syncDateControls();
 if(current&&visible()){drawLedger();loadDayFixtures(true);if(filteredLedger())searchLedger(0);else load(0)}
 scheduleActivity();
}
function chooseDay(value){chooseScope(value===dates.day(new Date())?'today':'date',value)}
scopeSelect.addEventListener('change',()=>chooseScope(scopeSelect.value));
dateInput.addEventListener('change',()=>chooseDay(dateInput.value));
previousDay.addEventListener('click',()=>chooseDay(dates.shiftDay(selectedDate,-1)));
nextDay.addEventListener('click',()=>{const next=dates.shiftDay(selectedDate,1);if(next&&next<=dates.day(new Date()))chooseDay(next)});
todayButton.addEventListener('click',()=>chooseScope('today'));
newer.addEventListener('click',()=>filteredLedger()?searchLedger(page-1):load(page-1));
older.addEventListener('click',()=>filteredLedger()?searchLedger(page+1):load(page+1));
downloadButton.addEventListener('click',async()=>{
 if(!current||loading||exporting)return;exporting=true;busyButtons();
 try{
 const rows=[];let offset=0;const query=searchQuery,scope=ledgerScope,date=selectedDate;const total=scope!=='history'||query?searchResult?.total_records:current.total_records;
 if(total===undefined)throw Error('Search results are still loading');
 if(total>50000)throw Error('Export exceeds the 50,000-record window');
 while(offset<total){
 const path=ledgerPath(1000,offset,scope==='today'?'date':scope,query,date);
 const response=await fetch(CLOUD_URL+'/functions/v1/gerball-paper-bets'+path,{headers:{apikey:CLOUD_KEY},signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Error('CSV export request failed');
 const report=await response.json();if(!Array.isArray(report.records)||!report.records.length||(scope!=='history'&&report.date!==date))throw Error('Incomplete ledger download');
 rows.push(...report.records);offset+=report.records.length;
 }
 download(recordsCSV(rows),'gerball-paper-bets-'+(scope!=='history'?date+(query?'-search':''):(query?'search-':'history-')+dates.day(new Date()))+'.csv');
 }catch(error){status.textContent=error.message}finally{exporting=false;busyButtons()}
});
root.addEventListener('gerball:paper-refreshed-prices',()=>{if(current&&visible())drawCandidates(new Date())});
root.addEventListener('gerball:viewchange',e=>{active=e.detail?.view==='picks';if(visible()){checkActivity();refreshPerformance();loadDayFixtures()}else{pauseActivity();clearFixtureRequest()}});
root.document.addEventListener('visibilitychange',()=>{if(visible()){checkActivity();refreshPerformance();loadDayFixtures()}else{pauseActivity();clearFixtureRequest()}});
root.addEventListener('focus',()=>{if(visible())checkActivity()});
root.addEventListener('pageshow',()=>{if(visible())checkActivity()});
if(!view.hidden){active=true;checkActivity()}
})(window);
