(function(root){'use strict';
const parent=root.document.getElementById('paperBets'),view=root.document.getElementById('view-picks');
if(!parent||!view)return;
const el=(name,value,cls)=>{const n=root.document.createElement(name);if(value!==undefined)n.textContent=String(value);if(cls)n.className=cls;return n};
const kindLabels={market:'Bet type',league:'League',home_team:'Home team',away_team:'Away team',bookmaker:'Bookmaker',season:'Season'};
const marketNames={H:'Home win',D:'Draw',A:'Away win',O25:'Over 2.5 goals',U25:'Under 2.5 goals'};
const section=el('section',undefined,'card pb-breakdown');
const top=el('div',undefined,'pb-top');top.append(el('h2','Paper bet performance breakdown'));
const refresh=el('button','Refresh breakdown','secondary');refresh.type='button';top.append(refresh);
section.append(top,el('p','All saved paper bets, grouped independently by market, league, home or away team, bookmaker and season. Paper returns are hypothetical, not placed bets.','pb-caption'));
const choices=el('div',undefined,'pb-breakdown-controls');
const label=el('label','Break down by');label.htmlFor='pb-breakdown-kind';const select=el('select');select.id='pb-breakdown-kind';
for(const [value,name] of Object.entries(kindLabels)){const option=el('option',name);option.value=value;select.append(option)}
choices.append(label,select);
const limitLabel=el('label','Show');limitLabel.htmlFor='pb-breakdown-limit';
const limit=el('select');limit.id='pb-breakdown-limit';
for(const n of [10,25,50,100]){const option=el('option',String(n));option.value=String(n);limit.append(option)}
choices.append(limitLabel,limit);section.append(choices);
const status=el('p','Report not loaded','pb-caption');status.setAttribute('role','status');section.append(status);
const tableHost=el('div',undefined,'pb-table-wrap');section.append(tableHost);
const note=el('p','Returns are shown only for settled matches. A group with no settled bets has no ROI and no demonstrated track record. Each team grouping is separate, so home-team and away-team totals should not be added together.','pb-caption');section.append(note);
parent.append(section);
let report=null,loading=false,loaded=false;
function formatNumber(value){const n=Number(value);return Number.isFinite(n)?n.toFixed(2):'—'}
function render(){
 if(!report)return;const kind=select.value,rows=report.groups.filter(x=>x.kind===kind).sort((a,b)=>b.bets-a.bets||String(a.label).localeCompare(String(b.label)));
 const count=Number(limit.value);tableHost.replaceChildren();
 const table=el('table'),head=el('thead'),tr=el('tr');
 for(const title of [kindLabels[kind],'Bets','Settled','Won','Lost','Pending','Review','Settled stake','Net units','ROI'])tr.append(el('th',title));
 head.append(tr);table.append(head);const body=el('tbody');
 for(const row of rows.slice(0,count)){
  const tr=el('tr');const cells=[kind==='market'?(marketNames[row.label]||row.label):row.label,row.bets,row.settled,row.won,row.lost,row.pending,row.review,row.settled_units,
   Number(row.net_units)>0?'+'+formatNumber(row.net_units):formatNumber(row.net_units),
   row.roi_pct===null?'—':formatNumber(row.roi_pct)+'%'];
  for(let i=0;i<cells.length;i++){const td=el('td',cells[i]);if(i===8)td.className=Number(row.net_units)>0?'pb-positive':Number(row.net_units)<0?'pb-negative':'';tr.append(td)}body.append(tr);
 }
 if(!rows.length){const tr=el('tr'),td=el('td','No saved bets in this category.');td.colSpan=10;tr.append(td);body.append(tr)}
 table.append(body);tableHost.append(table);
 status.textContent=rows.length+' groups · '+report.total_bets+' paper bets · '+report.settled_bets+' settled · Showing '+Math.min(count,rows.length)+' groups';
}
async function load(){
 if(loading)return;loading=true;refresh.disabled=true;status.textContent='Loading grouped betting results…';
 try{
 const response=await root.fetch(CLOUD_URL+'/functions/v1/gerball-paper-breakdown',{headers:{apikey:CLOUD_KEY},signal:AbortSignal.timeout(25000)});
 if(!response.ok)throw Error('Breakdown unavailable ('+response.status+')');
 const data=await response.json();if(data.version!=='paper_breakdown_v1'||!Array.isArray(data.groups)||!Number.isInteger(data.total_bets))throw Error('Invalid breakdown');
 report=data;render();
 }catch(error){report=null;tableHost.replaceChildren();status.textContent=error.message}
 finally{loading=false;refresh.disabled=false}
}
select.addEventListener('change',render);limit.addEventListener('change',render);refresh.addEventListener('click',load);
root.addEventListener('gerball:viewchange',e=>{if(e.detail?.view==='picks'&&!loaded){loaded=true;load()}});
if(!view.hidden){loaded=true;load()}
})(window);
