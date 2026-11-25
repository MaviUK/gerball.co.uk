(function(root){'use strict';
const holder=root.document.getElementById('paperBets');
const view=root.document.getElementById('view-picks');
const dates=root.GerballPaperDates;
if(!dates||typeof dates.upcomingToday!=='function')return;
if(!holder||!view)return;
const marketNames={H:'Home win',D:'Draw',A:'Away win',O25:'Over 2.5 goals',U25:'Under 2.5 goals'};
const reasonNames={candidate:'Model candidate',team_not_linked:'Team names not linked',insufficient_league_history:'Not enough league history',insufficient_venue_history:'Not enough comparable home/away games',no_captured_odds:'No recorded price',price_out_of_scope:'Odds outside selected range',stale_collection:'Captured odds too old',stale_provider_quote:'Bookmaker quote too old',no_estimated_edge:'No sufficient estimated edge'};
const fmtDate=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',day:'numeric',month:'short',year:'numeric'});
const fmtTime=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
const $=(tag,content,cls)=>{const e=root.document.createElement(tag);if(content!==undefined)e.textContent=String(content);if(cls)e.className=cls;return e};
const textDate=t=>t&&Number.isFinite(Date.parse(t))?fmtTime.format(new Date(t))+' UK':'—';
const fnum=(x,n=2)=>x!==null&&x!==undefined&&Number.isFinite(Number(x))?Number(x).toFixed(n):'—';
const cell=(value)=>{const s=value===null||value===undefined?'':String(value);const safe=/^\s*[=+@\-]/.test(s)&&!/^-[0-9]+(\.[0-9]+)?$/.test(s)?"'"+s:s;return '"'+safe.replace(/"/g,'""')+'"'};
const recordsCSV=rows=>{const cols=['id','model_version','league','home','away','kickoff_at','recorded_at','market','odds','bookmaker','quote_collected_at','model_probability','estimated_edge','units','status','revision','home_goals','away_goals','result','won','net_units','input'];return '\uFEFF'+[cols,...rows.map(row=>cols.map(c=>c==='input'?JSON.stringify(row.input):row[c]??''))].map(r=>r.map(cell).join(',')).join('\r\n')};
const download=(content,filename)=>{const b=new Blob([content],{type:'text/csv;charset=utf-8'});const u=URL.createObjectURL(b);const a=$('a');a.href=u;a.download=filename;root.document.body.append(a);a.click();a.remove();root.setTimeout(()=>URL.revokeObjectURL(u),1500)};
let active=false,loading=false,current=null,filter='all',exporting=false;
let searchQuery='',searchResult=null,searchCounter=0,searchTimer=null,searchController=null;
let reportCounter=0,reportController=null,activityTimer=null,lastLoadedAt=null,lastAttemptAt=null,lastAttemptDay=null;
let reportInterrupted=false,searchInterrupted=false,requestedPage=0,refreshError=null;
const REFRESH_MS=5*60000,CLOCK_MS=30000;
const visible=()=>active&&!view.hidden&&!root.document.hidden;
const normalizeQuery=value=>String(value||'').trim().toLocaleLowerCase('en-GB');
const searchable=value=>String(value??'').toLocaleLowerCase('en-GB');
const matchesQuery=(row,q)=>!q||[row.home,row.away,row.league,row.market,marketNames[row.market],row.bookmaker,row.decision,reasonNames[row.decision],row.status,row.event_id,row.fixture_date].some(v=>searchable(v).includes(q));
const intro=$('section',undefined,'card');
const top=$('div',undefined,'pb-top');top.append($('h2','Research bet recommendations & P&L'));
const refresh=$('button','Refresh','secondary');refresh.type='button';top.append(refresh);
intro.append(top,$('p','Paper selections only. No bets are placed by this site. A unit is an abstract stake, not a money amount.','pb-caption'));
const searchPanel=$('div',undefined,'pb-search');
const searchLabel=$('label','Search fixtures and paper bets');
const searchInput=$('input');searchInput.type='search';searchInput.id='pb-search';
searchInput.maxLength=100;searchInput.placeholder='Team, league, market, bookmaker, status…';
searchLabel.htmlFor='pb-search';
const clearSearch=$('button','Clear','secondary');clearSearch.type='button';clearSearch.disabled=true;
searchPanel.append(searchLabel,searchInput,clearSearch);intro.append(searchPanel);
intro.append($('p','Saved candidates require adequate league/home/away samples, bookmaker odds captured no more than 120 minutes before the saved assessment, and an unvalidated estimated edge of at least 8%. Captured prices are not live quotes. These thresholds do not establish a real betting advantage.','pb-warning'));
const status=$('p','Report not loaded','pb-status');status.setAttribute('role','status');intro.append(status);
const summaryBox=$('div',undefined,'pb-dashboard');intro.append(summaryBox);
const candidateSection=$('section',undefined,'card'),candidateTop=$('div',undefined,'pb-top');
candidateTop.append($('h2',"Today's match assessments"));
const selector=$('select');selector.setAttribute('aria-label','Show assessments');for(const [value,label] of [['all','All matches'],['candidate','Model candidates'],['no','No bet']]){const o=$('option',label);o.value=value;selector.append(o)}
candidateTop.append(selector);candidateSection.append(candidateTop);
const candidateStatus=$('p','','pb-caption');const cards=$('div',undefined,'pb-list');
candidateSection.append(candidateStatus,cards);
const ledger=$('section',undefined,'card pb-ledger');const ledgerTop=$('div',undefined,'pb-top');ledgerTop.append($('h2','Complete paper record'));
const downloadButton=$('button','Export all paper bets (CSV)','secondary');downloadButton.type='button';ledgerTop.append(downloadButton);
ledger.append(ledgerTop,$('p','Each record saves the original odds, recommended units, model estimate and input snapshot. Imported score revisions update the displayed return without changing the original bet.','pb-caption'));
const ledgerStatus=$('p','','pb-caption');ledger.append(ledgerStatus);
const scroll=$('div',undefined,'pb-table-wrap');ledger.append(scroll);
const pagination=$('div',undefined,'pb-controls');const newer=$('button','Previous page','secondary'),older=$('button','Next page','secondary');newer.type=older.type='button';pagination.append(newer,older);ledger.append(pagination);
holder.append(intro,candidateSection,ledger);
let page=0;const PAGE=250;
function drawMetrics(){
 summaryBox.replaceChildren();const total=current.summary.find(x=>x.market==='ALL')||{};
 for(const [name,value] of [['Paper bets',total.bets??0],['Settled',total.settled??0],['Net units',total.net_units===undefined?'—':(Number(total.net_units)>=0?'+':'')+fnum(total.net_units)],['ROI',total.roi_pct===null||total.roi_pct===undefined?'Not available':fnum(total.roi_pct)+'%'],['Recommended units',total.units_recommended??0],['Pending',total.pending??0],['Won / lost',(total.won??0)+' / '+(total.lost??0)],['Max drawdown',current.max_drawdown_units===null?'Not available':fnum(current.max_drawdown_units)+' units']]){
 const tile=$('div',undefined,'pb-metric');tile.append($('small',name),$('strong',value));summaryBox.append(tile);
 }
}
function quoteAge(p,now){
 const captured=Date.parse(p.quote_collected_at),age=now.getTime()-captured;
 if(!Number.isFinite(captured))return 'Capture time unavailable';
 if(age<0)return 'Capture time is ahead of this device’s clock';
 const minutes=Math.floor(age/60000),hours=Math.floor(minutes/60);
 return 'Captured '+(hours?hours+'h ':'')+(minutes%60)+'m ago'+(age>120*60000?' · older than 2 hours; saved assessment':' · saved assessment');
}
function matchCard(p,now){
 const box=$('article',undefined,'pb-match'),h=$('h3',(p.home||'?')+' v '+(p.away||'?'));box.append(h);
 box.append($('p',p.league+' · '+textDate(p.kickoff_at),'pb-caption'));
 const tags=$('div',undefined,'pb-tags');const yes=p.decision==='candidate';
 tags.append($('span',yes?'PAPER '+p.units+' '+(p.units===1?'unit':'units'):'NO BET',yes?'pb-yes':'pb-no'));tags.append($('span',marketNames[p.market]||p.market));
 box.append(tags);
 const dl=$('dl');for(const [name,value] of [
 ['Captured odds',p.quoted_odds?fnum(p.quoted_odds):'Unavailable'],
 ['Bookmaker',p.bookmaker||'—'],
 ['Model estimate',p.probability===null?'Unavailable':fnum(Number(p.probability)*100,1)+'%'],
 ['Exploratory model edge',p.decision==='candidate'||p.decision==='no_estimated_edge'?(p.estimated_edge===null?'Unavailable':fnum(Number(p.estimated_edge)*100,1)+'%'):'Not assessed (excluded)'],
 ['Home / away samples',(p.home_sample??0)+' / '+(p.away_sample??0)],
 ['Decision',reasonNames[p.decision]||p.decision]]){dl.append($('dt',name),$('dd',value))}
 box.append(dl,$('p',quoteAge(p,now),'pb-caption'));
 box.append($('small','Saved form: '+textDate(p.recorded_at)+' · Price captured: '+textDate(p.quote_collected_at)));
 return box;
}
function drawCandidates(now=new Date()){
 cards.replaceChildren();
 let source=dates.upcomingToday(current.preview?.fixtures||[],now);
 const total=source.length;
 if(filter==='candidate')source=source.filter(p=>p.decision==='candidate');
 if(filter==='no')source=source.filter(p=>p.decision!=='candidate');
 if(searchQuery)source=source.filter(p=>matchesQuery(p,searchQuery));
 candidateStatus.textContent=source.length+' of '+total+' fixtures still to kick off today ('+dates.day(now)+' UK)'+(searchQuery?' for “'+searchQuery+'”':'')+'. Each fixture has at most one saved market assessment; excluded fixtures still show why.';
 if(!source.length){cards.append($('p',total?'No remaining matches today meet this filter.':'No fixtures still to kick off today in the latest captured assessments. The full paper-bet record remains available below.','pb-caption'));return}
 for(const p of source.slice(0,72))cards.append(matchCard(p,now));
 if(source.length>72)cards.append($('p','Showing 72 of '+source.length+' matching fixtures.','pb-caption'));
}
function drawLedger(){
 scroll.replaceChildren();
 const filtered=searchQuery!=='';
 const result=filtered?searchResult:current;
 const entries=result?.records||[];
 const count=result?.total_records??0;
 downloadButton.textContent=filtered?'Export matching bets (CSV)':'Export all paper bets (CSV)';
 ledgerStatus.textContent=filtered
 ? searchResult?count+' matching saved paper bets for “'+searchQuery+'”. Complete ledger: '+current.total_records+' records.':'Searching the complete saved ledger…'
 : (current.total_records||0)+' total saved paper bets. '+(current.last_capture?'Last capture '+current.last_capture.date+' ('+current.last_capture.saved+' bets).':'First capture scheduled after the daily odds and rule recordings.')+' These are not actual wagers.';
 const table=$('table');const header=$('thead'),row=$('tr');for(const name of ['Fixture','Kickoff','Market','Odds','Units','Bookmaker','Status','Result','Net units'])row.append($('th',name));header.append(row);table.append(header);
 const body=$('tbody');
 for(const b of entries){
 const tr=$('tr');const elements=[
 b.home+' v '+b.away,textDate(b.kickoff_at),marketNames[b.market]||b.market,
 fnum(b.odds),b.units,b.bookmaker||'—',b.status||'pending',
 b.status==='settled'?b.home_goals+'-'+b.away_goals:'—',
 b.net_units===null?'—':(Number(b.net_units)>0?'+':'')+fnum(b.net_units)];
 for(const value of elements)tr.append($('td',value));
 body.append(tr);
 }
 if(!entries.length){const tr=$('tr'),td=$('td',filtered?(searchResult?'No paper bets match this search.':'Searching saved records…'):'No saved paper bets. Recommendations are recorded only when a qualified opportunity appears before kickoff.');td.colSpan=9;tr.append(td);body.append(tr)}
 table.append(body);scroll.append(table);
 newer.disabled=page===0||filtered&&!searchResult;older.disabled=filtered&&!searchResult||(page+1)*PAGE>=count;
}
function busyButtons(){refresh.disabled=loading;downloadButton.disabled=loading||exporting||!current}
function drawStatus(now=new Date()){
 if(loading){status.textContent='Refreshing saved paper recommendations and P&L…';return}
 if(refreshError){status.textContent='Could not refresh: '+refreshError+(current?'. Showing cached report from '+textDate(current.generated_at)+'. Started fixtures are hidden using the current UK clock.':'. Please try Refresh.');return}
 if(current)status.textContent='Report updated '+textDate(current.generated_at)+' · '+current.model_version+' · '+dates.upcomingToday(current.preview.fixtures,now).length+' fixtures still to kick off today (UK)';
}
function drawCurrent(now=new Date()){
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
 if(searchController||searchTimer!==null)searchInterrupted=!!searchQuery;
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
 else if(!loading&&current&&searchQuery&&searchInterrupted&&!searchController)searchLedger(page);
 scheduleActivity();
}
async function fetchPage(num,signal){
 const r=await fetch(CLOUD_URL+'/functions/v1/gerball-paper-bets?limit='+PAGE+'&offset='+(num*PAGE),{headers:{apikey:CLOUD_KEY},signal:AbortSignal.any([signal,AbortSignal.timeout(30000)])});
 if(!r.ok)throw Error('Paper bets unavailable ('+r.status+')');
 const j=await r.json();if(j?.version!=='paper_ledger_v1'||!Array.isArray(j.summary)||!Array.isArray(j.records)||!Array.isArray(j.preview?.fixtures))throw Error('Invalid report');
 return j;
}
async function searchLedger(num=0,{keepExisting=false}={}){
 if(!current||!visible()){searchInterrupted=!!searchQuery;return}
 if(searchTimer!==null){root.clearTimeout(searchTimer);searchTimer=null}
 const query=searchQuery,token=++searchCounter;
 if(searchController)searchController.abort();
 const controller=new AbortController();searchController=controller;searchInterrupted=false;
 if(query===''){page=0;searchResult=null;searchController=null;drawLedger();return}
 if(!keepExisting||page!==num)searchResult=null;
 page=num;drawLedger();
 try{
  const path='?limit='+PAGE+'&offset='+(num*PAGE)+'&q='+encodeURIComponent(query);
  const response=await fetch(CLOUD_URL+'/functions/v1/gerball-paper-bets'+path,{headers:{apikey:CLOUD_KEY},signal:AbortSignal.any([controller.signal,AbortSignal.timeout(30000)])});
  if(!response.ok)throw Error('Search unavailable ('+response.status+')');
  const result=await response.json();
  if(result?.version!=='paper_search_v1'||!Array.isArray(result.records)||!Number.isInteger(result.total_records)||result.query!==query)throw Error('Invalid search results');
  if(token!==searchCounter||searchQuery!==query||!visible())return;
  searchResult=result;drawLedger();
 }catch(error){
  if(token!==searchCounter||!visible()||error.name==='AbortError')return;
  ledgerStatus.textContent='Search unavailable: '+error.message+(searchResult?'. Showing previously loaded matching records.':'');
 }finally{if(token===searchCounter)searchController=null}
}
async function load(num=0,{automatic=false}={}){
 if(!visible())return;
 const token=++reportCounter,queryAtStart=searchQuery,reportPage=queryAtStart?0:num;
 if(reportController)reportController.abort();
 const controller=new AbortController();reportController=controller;
 requestedPage=num;reportInterrupted=false;loading=true;lastAttemptAt=Date.now();lastAttemptDay=dates.day(new Date());
 busyButtons();drawCurrent();scheduleActivity();
 try{
  const data=await fetchPage(reportPage,controller.signal);
  if(token!==reportCounter||!visible())return;
  current=data;lastLoadedAt=Date.now();refreshError=null;
  if(searchQuery===queryAtStart&&(!searchQuery||!automatic))page=num;
  drawMetrics();drawCandidates(new Date());drawLedger();
  if(searchQuery)await searchLedger(page,{keepExisting:automatic});
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
function updateSearch(){
 const next=normalizeQuery(searchInput.value);if(next===searchQuery)return;
 searchQuery=next;searchResult=null;page=0;clearSearch.disabled=!next;
 cancelSearch();searchInterrupted=!!next;
 if(current){drawCandidates();drawLedger();if(next&&visible())searchTimer=root.setTimeout(()=>{searchTimer=null;searchLedger(0)},220);else if(!next)load(0)}
 scheduleActivity();
}
searchInput.addEventListener('input',updateSearch);
clearSearch.addEventListener('click',()=>{searchInput.value='';updateSearch();searchInput.focus()});
newer.addEventListener('click',()=>searchQuery?searchLedger(page-1):load(page-1));
older.addEventListener('click',()=>searchQuery?searchLedger(page+1):load(page+1));
downloadButton.addEventListener('click',async()=>{
 if(!current||loading||exporting)return;exporting=true;busyButtons();
 try{
 const rows=[];let offset=0;const query=searchQuery;const total=query?searchResult?.total_records:current.total_records;
 if(total===undefined)throw Error('Search results are still loading');
 if(total>50000)throw Error('Export exceeds the 50,000-record window');
 while(offset<total){
 const path='?limit=1000&offset='+offset+(query?'&q='+encodeURIComponent(query):'');
 const response=await fetch(CLOUD_URL+'/functions/v1/gerball-paper-bets'+path,{headers:{apikey:CLOUD_KEY},signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Error('CSV export request failed');
 const report=await response.json();if(!Array.isArray(report.records)||!report.records.length)throw Error('Incomplete ledger download');
 rows.push(...report.records);offset+=report.records.length;
 }
 download(recordsCSV(rows),'gerball-paper-bets-'+(query?'search-':'')+new Date().toISOString().slice(0,10)+'.csv');
 }catch(error){status.textContent=error.message}finally{exporting=false;busyButtons()}
});
root.addEventListener('gerball:viewchange',e=>{active=e.detail?.view==='picks';if(visible())checkActivity();else pauseActivity()});
root.document.addEventListener('visibilitychange',()=>{if(visible())checkActivity();else pauseActivity()});
root.addEventListener('focus',()=>{if(visible())checkActivity()});
root.addEventListener('pageshow',()=>{if(visible())checkActivity()});
if(!view.hidden){active=true;checkActivity()}
})(window);
