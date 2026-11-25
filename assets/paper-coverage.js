(function(root){'use strict';
const marketNames={H:'Home win',D:'Draw',A:'Away win',O25:'Over 2.5 goals',U25:'Under 2.5 goals'};
const groupNames={leagues:'League',markets:'Market',league_markets:'League + market'};
const coverageCounts=['paper_bets','eligible_bets','followed_bets','unfollowed_bets','upcoming_unfollowed_bets','expired_unfollowed_bets','unsupported_bets'];
const collectionCounts=['refresh_runs','completed_runs','failed_runs','in_progress_runs','runs_with_followup','newly_followed_bets','reported_credits','unknown_cost_runs'];
const count=value=>Number.isInteger(value)&&value>=0;
const percent=value=>typeof value==='number'&&Number.isFinite(value)?value.toFixed(1)+'%':'—';
function leagueName(code){
 const name=typeof tableNames!=='undefined'&&tableNames[code];
 return name?name+' ('+code+')':String(code||'Unknown league');
}
function validStats(row){
 return row&&coverageCounts.every(key=>count(row[key]))&&
  (row.coverage_pct===null||typeof row.coverage_pct==='number'&&Number.isFinite(row.coverage_pct));
}
function validReport(report){
 return report?.version==='paper_followup_coverage_v1'&&typeof report.uk_date==='string'&&
  ['today','all'].every(key=>validStats(report[key]?.totals)&&
   Object.keys(groupNames).every(group=>Array.isArray(report[key][group])&&report[key][group].every(validStats)))&&
  report.collection_today&&collectionCounts.every(key=>count(report.collection_today.totals?.[key]))&&
  Array.isArray(report.collection_today.leagues)&&report.collection_today.leagues.every(row=>collectionCounts.every(key=>count(row[key])));
}
function create(host){
 const doc=host.ownerDocument||root.document;
 const el=(tag,text,cls)=>{const node=doc.createElement(tag);if(text!==undefined)node.textContent=String(text);if(cls)node.className=cls;return node};
 const section=el('section',undefined,'pb-coverage');
 section.setAttribute('aria-labelledby','pb-coverage-title');
 const title=el('h3','Follow-up coverage by league and market');title.id='pb-coverage-title';
 section.append(title,el('p','A bet is covered when a completed refresh supplies a fresh, later fixed-odds quote for the same fixture and selection before kickoff. Coverage measures available data, not profitability.','pb-caption'));
 const controls=el('div',undefined,'pb-coverage-controls');
 function chooser(id,labelText,options){
  const label=el('label',labelText),select=el('select');label.htmlFor=id;select.id=id;
  for(const [value,text] of options){const option=el('option',text);option.value=value;select.append(option)}
  const field=el('div',undefined,'pb-coverage-field');field.append(label,select);controls.append(field);return select;
 }
 const scope=chooser('pb-coverage-scope','Matches',[['today','Today’s matches (UK)'],['all','All recorded matches']]);
 const group=chooser('pb-coverage-group','Group by',Object.entries(groupNames));
 const status=el('p','Coverage not loaded.','pb-caption');status.setAttribute('role','status');
 const summary=el('div',undefined,'pb-coverage-summary');
 const tableHost=el('div',undefined,'pb-coverage-results');
 section.append(controls,status,summary,tableHost);
 section.append(el('p','Follow-up collection currently covers full-time Home / Draw / Away. Other recorded markets are shown as “Not collected” and excluded from the coverage percentage. Each grouping is a separate view of the same bets.','pb-caption'));
 const costTitle=el('h4','Today’s collection use');
 const costStatus=el('p',undefined,'pb-caption');
 const costTableHost=el('div',undefined,'pb-coverage-collection');
 section.append(costTitle,costStatus,costTableHost,el('p','Collection use is always for today in UK time, regardless of the match filter. A useful refresh supplied at least one valid follow-up; “Newly covered” counts bets receiving their first one. One refresh can cover several selections, so credits are counted once per request and league. Credits use recorded provider costs; unfinished or unreported usage may not be included. Refreshing this report reads saved data only.','pb-caption'));
 host.append(section);
 let report=null;
 function tile(label,value){const node=el('div',undefined,'pb-coverage-tile');node.append(el('span',label),el('strong',value));return node}
 function table(headers,label,cls){
  const wrap=el('div',undefined,'pb-table-wrap '+(cls||''));wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label',label);
  const table=el('table'),head=el('thead'),row=el('tr'),body=el('tbody');
  for(const title of headers){const cell=el('th',title);cell.setAttribute('scope','col');row.append(cell)}
  head.append(row);table.append(head,body);wrap.append(table);return {wrap,table,body};
 }
 function rowLabel(row){
  if(group.value==='markets')return marketNames[row.market]||String(row.market);
  if(group.value==='league_markets')return leagueName(row.league)+' · '+(marketNames[row.market]||String(row.market));
  return leagueName(row.league);
 }
 function renderGroups(){
  if(!report)return;
  const cohort=report[scope.value],totals=cohort.totals;
  const period=scope.value==='today'?'Matches on '+report.uk_date+' (UK)':'All recorded matches';
  status.textContent=period+' · '+totals.paper_bets+' recorded bets · '+totals.unsupported_bets+' in markets not collected.';
  summary.replaceChildren(
   tile('Eligible bets',totals.eligible_bets),tile('With follow-up',totals.followed_bets),
   tile('Coverage',percent(totals.coverage_pct)),tile('Upcoming without follow-up',totals.upcoming_unfollowed_bets)
  );
  tableHost.replaceChildren();
  if(!totals.paper_bets){
   tableHost.append(el('p',scope.value==='today'?'No paper bets have a kickoff today. Choose “All recorded matches” to inspect the wider archive.':'No paper bets have been recorded yet.','pb-coverage-empty'));return;
  }
  const rows=[...cohort[group.value]].sort((a,b)=>b.upcoming_unfollowed_bets-a.upcoming_unfollowed_bets||b.eligible_bets-a.eligible_bets||rowLabel(a).localeCompare(rowLabel(b)));
  const result=table([groupNames[group.value],'Eligible','With follow-up','Coverage','Upcoming missing','Kickoff passed, missing','Not collected'],period+' coverage by '+groupNames[group.value].toLowerCase());
  result.table.className='pb-coverage-table';
  for(const row of rows){
   const tr=el('tr'),label=el('th',rowLabel(row));label.setAttribute('scope','row');tr.append(label);
   const values=[row.eligible_bets,row.followed_bets,percent(row.coverage_pct),row.upcoming_unfollowed_bets,row.expired_unfollowed_bets,row.unsupported_bets];
   values.forEach((value,index)=>{const cell=el('td',value);if(index===2&&!row.eligible_bets)cell.className='pb-muted';if(index===3&&row.upcoming_unfollowed_bets)cell.className='pb-unavailable';tr.append(cell)});
   result.body.append(tr);
  }
  const foot=el('tfoot'),tr=el('tr'),label=el('th','Total');label.setAttribute('scope','row');tr.append(label);
  for(const value of [totals.eligible_bets,totals.followed_bets,percent(totals.coverage_pct),totals.upcoming_unfollowed_bets,totals.expired_unfollowed_bets,totals.unsupported_bets])tr.append(el('td',value));
  foot.append(tr);result.table.append(foot);tableHost.append(result.wrap);
 }
 function credits(row){return String(row.reported_credits)+(row.unknown_cost_runs?' + unknown for '+row.unknown_cost_runs+' request'+(row.unknown_cost_runs===1?'':'s'):'')}
 function renderCollection(){
  const use=report.collection_today,total=use.totals;
  costStatus.textContent=report.uk_date+' (UK) · '+total.refresh_runs+' refresh attempts · '+total.completed_runs+' completed · '+total.failed_runs+' failed · '+total.in_progress_runs+' in progress. Recorded credits: '+credits(total)+'.';
  costTableHost.replaceChildren();
  if(!total.refresh_runs){costTableHost.append(el('p','No refresh attempts have been recorded today.','pb-coverage-empty'));return}
  const result=table(['League','Attempts','Completed','Useful refreshes','Newly covered bets','Recorded credits'],'Today’s collection use by league','pb-coverage-cost-table');
  result.table.className='pb-collection-table';
  const rows=[...use.leagues].sort((a,b)=>b.newly_followed_bets-a.newly_followed_bets||b.refresh_runs-a.refresh_runs||leagueName(a.league).localeCompare(leagueName(b.league)));
  for(const row of rows){
   const tr=el('tr'),label=el('th',leagueName(row.league));label.setAttribute('scope','row');tr.append(label);
   for(const value of [row.refresh_runs,row.completed_runs,row.runs_with_followup,row.newly_followed_bets,credits(row)])tr.append(el('td',value));
   result.body.append(tr);
  }
  const foot=el('tfoot'),tr=el('tr'),label=el('th','Total');label.setAttribute('scope','row');tr.append(label);
  for(const value of [total.refresh_runs,total.completed_runs,total.runs_with_followup,total.newly_followed_bets,credits(total)])tr.append(el('td',value));
  foot.append(tr);result.table.append(foot);costTableHost.append(result.wrap);
 }
 function clear(message){
  report=null;scope.disabled=true;group.disabled=true;summary.replaceChildren();tableHost.replaceChildren();costTableHost.replaceChildren();
  status.textContent=message||'Coverage unavailable. Refresh the movement report to try again.';costStatus.textContent='Collection use unavailable.';
 }
 scope.addEventListener('change',renderGroups);group.addEventListener('change',renderGroups);
 scope.disabled=true;group.disabled=true;
 return {
  render(next){if(!validReport(next)){clear('Coverage data is not available in this report.');return}report=next;scope.disabled=false;group.disabled=false;renderGroups();renderCollection()},
  clear
 };
}
root.GerballPaperCoverage={create};
})(window);
