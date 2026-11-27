(function(root){'use strict';
const parent=root.document.getElementById('paperBets'),view=root.document.getElementById('view-picks');if(!parent||!view)return;
const el=(name,value,cls)=>{const n=root.document.createElement(name);if(value!==undefined)n.textContent=String(value);if(cls)n.className=cls;return n};
const stages={
 upcoming:'Awaiting kickoff',
 in_progress:'Match started / grace period',
 awaiting_reconciliation:'Awaiting next hourly check',
 awaiting_import:'Awaiting verified result import',
 review:'Requires result review',
 settled:'Settled'
};
const toDate=value=>{if(!value)return'Not yet recorded';const d=new Date(value);if(!Number.isFinite(d.getTime()))return'Not yet recorded';return d.toLocaleString('en-GB',{timeZone:'Europe/London',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})+' UK'};
const panel=el('section',undefined,'card pb-health');
const header=el('div',undefined,'pb-top');header.append(el('h2','Settlement monitoring'));
const refresh=el('button','Check result status','secondary');refresh.type='button';header.append(refresh);
panel.append(header,el('p','Tracks every saved paper selection through kickoff, the three-hour results grace period, import and settlement. Corrections retain their previous score revisions.','pb-caption'));
const status=el('p','Not loaded','pb-caption');status.setAttribute('role','status');panel.append(status);
const metrics=el('div',undefined,'pb-health-grid');panel.append(metrics);
const importWarning=el('p','','pb-warning');importWarning.setAttribute('role','status');importWarning.hidden=true;panel.append(importWarning);
const detail=el('p','','pb-caption');panel.append(detail);
const heading=el('h3','Past matches still awaiting a result');panel.append(heading);
const tableBox=el('div',undefined,'pb-table-wrap');panel.append(tableBox);
panel.append(el('p','A pending bet is not a loss. Scores are settled only from the imported football-data.co.uk record, after the original match has finished. Imports may lag kickoffs; a correction updates the current displayed units without rewriting the original paper bet.','pb-caption'));
parent.append(panel);
let started=false,loading=false;
function tile(label,value){const box=el('div',undefined,'pb-health-tile');box.append(el('small',label),el('strong',value));return box}
function render(report){
 metrics.replaceChildren();const map=new Map(report.stages.map(x=>[x.stage,x.bets]));
 for(const [stage,label] of Object.entries(stages))metrics.append(tile(label,map.get(stage)||0));
 metrics.append(tile('Over 48 hours without settlement',report.late_over_48_hours));
 metrics.append(tile('Corrected result observations',report.revisions?.corrected_observations??0));
 const importAge=Number(report.import_age_hours);
 importWarning.hidden=!report.import_stale;
 importWarning.textContent=report.import_stale?
   'Result feed is stale'+(Number.isFinite(importAge)?' ('+importAge.toFixed(1)+' hours since the last stored import)':'')+
   '. The hourly settlement checker cannot settle matches until verified results are imported. Check the football-data import workflow.':'';
 detail.textContent='Last hourly reconciliation: '+toDate(report.latest_reconcile_at)
   +' · Latest football-data.co.uk import: '+toDate(report.latest_results_import_at)
   +' · Latest completed match date: '+(report.latest_result_match_date??'Not yet available')
   +' · Revisions stored: '+(report.revisions?.total_revisions??0)+'.';
 tableBox.replaceChildren();
 const table=el('table'),head=el('thead'),tr=el('tr');
 for(const name of ['Fixture','Kickoff','League','Market','Status','Hours since kickoff','Reason'])tr.append(el('th',name));
 head.append(tr);table.append(head);
 const body=el('tbody');for(const item of report.unsettled_examples){
 const row=el('tr');
 for(const value of [item.home+' v '+item.away,toDate(item.kickoff_at),item.league,item.market,
 stages[item.stage]||item.stage,item.hours_since_kickoff,item.reason||'Awaiting scheduled check'])
 row.append(el('td',value));
 body.append(row);
 }
 if(!report.unsettled_examples.length){const row=el('tr'),cell=el('td','No bets currently past the three-hour grace period without settlement.');cell.colSpan=7;row.append(cell);body.append(row)}
 table.append(body);tableBox.append(table);
 status.textContent=report.records_total+' saved paper bets checked · '+report.settled+' settled · '+report.pending_after_grace+' awaiting import or reconciliation · Updated '+toDate(report.generated_at);
}
async function load(){
 if(loading)return;loading=true;refresh.disabled=true;status.textContent='Checking stored result revisions…';
 try{
 const response=await root.fetch(CLOUD_URL+'/functions/v1/gerball-paper-settlement-health',{headers:{apikey:CLOUD_KEY},signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error('Settlement monitoring unavailable ('+response.status+')');
 const result=await response.json();
 if(result.version!=='paper_settlement_health_v1'||!Array.isArray(result.stages)||!Array.isArray(result.unsettled_examples)||!Number.isInteger(result.records_total))throw Error('Invalid settlement report');
 render(result);
 }catch(error){status.textContent=error.message;metrics.replaceChildren();tableBox.replaceChildren()}
 finally{loading=false;refresh.disabled=false}
}
refresh.addEventListener('click',load);
root.addEventListener('gerball:viewchange',e=>{if(e.detail?.view==='picks'&&!started){started=true;load()}});
if(!view.hidden){started=true;load()}
})(window);
