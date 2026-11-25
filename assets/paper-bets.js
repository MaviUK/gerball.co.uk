(function(root){'use strict';
const holder=root.document.getElementById('paperBets');
const view=root.document.getElementById('view-picks');
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
let active=false,loading=false,current=null,filter='all';
const intro=$('section',undefined,'card');
const top=$('div',undefined,'pb-top');top.append($('h2','Research bet recommendations & P&L'));
const refresh=$('button','Refresh','secondary');refresh.type='button';top.append(refresh);
intro.append(top,$('p','Paper selections only. No bets are placed by this site. A unit is an abstract stake, not a money amount.','pb-caption'));
intro.append($('p','Candidates require adequate league/home/away samples, captured bookmaker odds no more than 120 minutes old, and an unvalidated estimated edge of at least 8%. These thresholds do not establish a real betting advantage.','pb-warning'));
const status=$('p','Report not loaded','pb-status');status.setAttribute('role','status');intro.append(status);
const summaryBox=$('div',undefined,'pb-dashboard');intro.append(summaryBox);
const candidateSection=$('section',undefined,'card'),candidateTop=$('div',undefined,'pb-top');
candidateTop.append($('h2','Upcoming match assessments'));
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
function matchCard(p){
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
 box.append(dl);
 box.append($('small','Saved form: '+textDate(p.recorded_at)+' · Price captured: '+textDate(p.quote_collected_at)));
 return box;
}
function drawCandidates(){
 cards.replaceChildren();
 let source=(current.preview?.fixtures||[]);
 const total=source.length;
 if(filter==='candidate')source=source.filter(p=>p.decision==='candidate');
 if(filter==='no')source=source.filter(p=>p.decision!=='candidate');
 candidateStatus.textContent=source.length+' of '+total+' fixtures shown. Each fixture has at most one market assessed as its leading option; excluded fixtures still show why.';
 if(!source.length){cards.append($('p',total?'No fixtures meet this filter.':'No recorded fixtures for the latest UK capture date. Fresh assessments will appear after the daily collector and recorder run.','pb-caption'));return}
 for(const p of source.slice(0,72))cards.append(matchCard(p));
 if(source.length>72)cards.append($('p','Showing 72 of '+source.length+' matching fixtures.','pb-caption'));
}
function drawLedger(){
 scroll.replaceChildren();
 const entries=current.records||[];ledgerStatus.textContent=(current.total_records||0)+' total saved paper bets. '+(current.last_capture?'Last capture '+current.last_capture.date+' ('+current.last_capture.saved+' bets).':'First capture scheduled after the daily odds and rule recordings.')+
 ' These are not actual wagers.';
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
 if(!entries.length){const tr=$('tr'),td=$('td','No saved paper bets. Recommendations are recorded only when a qualified opportunity appears before kickoff.');td.colSpan=9;tr.append(td);body.append(tr)}
 table.append(body);scroll.append(table);
 newer.disabled=page===0;older.disabled=(page+1)*PAGE>=current.total_records;
}
async function fetchPage(num){
 const r=await fetch(CLOUD_URL+'/functions/v1/gerball-paper-bets?limit='+PAGE+'&offset='+(num*PAGE),{headers:{apikey:CLOUD_KEY},signal:AbortSignal.timeout(30000)});
 if(!r.ok)throw Error('Paper bets unavailable ('+r.status+')');
 const j=await r.json();if(j?.version!=='paper_ledger_v1'||!Array.isArray(j.summary)||!Array.isArray(j.records)||!Array.isArray(j.preview?.fixtures))throw Error('Invalid report');
 return j;
}
async function load(num=0){
 if(loading)return;loading=true;refresh.disabled=true;downloadButton.disabled=true;status.textContent='Loading paper recommendations and P&L…';
 try{const data=await fetchPage(num);page=num;current=data;drawMetrics();drawCandidates();drawLedger();
 status.textContent='Updated '+textDate(data.generated_at)+' · '+data.model_version+' · '+data.preview.fixtures.length+' upcoming recorded fixtures';}
 catch(error){status.textContent=error.message;if(!current){cards.replaceChildren();scroll.replaceChildren();summaryBox.replaceChildren()}}
 finally{refresh.disabled=false;downloadButton.disabled=false;loading=false}
}
refresh.addEventListener('click',()=>load(0));selector.addEventListener('change',()=>{filter=selector.value;if(current)drawCandidates()});
newer.addEventListener('click',()=>load(page-1));older.addEventListener('click',()=>load(page+1));
downloadButton.addEventListener('click',async()=>{
 if(!current||loading)return;downloadButton.disabled=true;
 try{
 const rows=[];let offset=0;const total=current.total_records;
 while(offset<total){const response=await fetch(CLOUD_URL+'/functions/v1/gerball-paper-bets?limit=1000&offset='+offset,{headers:{apikey:CLOUD_KEY},signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('CSV export request failed');const report=await response.json();if(!Array.isArray(report.records)||!report.records.length)throw Error('Incomplete ledger download');rows.push(...report.records);offset+=report.records.length;if(offset>50000)throw Error('Export exceeded available record window')}
 download(recordsCSV(rows),'gerball-paper-bets-'+new Date().toISOString().slice(0,10)+'.csv');
 }catch(error){status.textContent=error.message}finally{downloadButton.disabled=false}
});
root.addEventListener('gerball:viewchange',e=>{if(e.detail?.view==='picks'){if(!active){active=true;load(0)}}});
if(!view.hidden){active=true;load(0)}
})(window);
