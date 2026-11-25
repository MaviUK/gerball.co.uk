(function(){
'use strict';
const root=document.getElementById('view-tracking');if(!root)return;
const style=document.createElement('style');style.textContent=`
#forwardOutcomes{margin-top:20px}
#forwardOutcomes .fo-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
#forwardOutcomes .fo-head button{width:auto}
#forwardOutcomes .fo-filters{display:grid;grid-template-columns:repeat(2,minmax(145px,1fr));gap:12px;margin:16px 0}
#forwardOutcomes .fo-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:15px 0}
#forwardOutcomes .fo-stat{border:1px solid #314c65;border-radius:10px;padding:13px;background:#0c1b2e}
#forwardOutcomes .fo-stat strong{font-size:26px;display:block;color:#70d7ac}
#forwardOutcomes .fo-note{color:#afc0d3;font-size:13px}
#forwardOutcomes .fo-warn{color:#e9bd80}
#forwardOutcomes table{min-width:0}
@media(max-width:600px){#forwardOutcomes .fo-grid{grid-template-columns:repeat(2,minmax(0,1fr))}#forwardOutcomes .fo-stat:last-child{grid-column:span 2}}
`;document.head.appendChild(style);
const el=(tag,content,cls)=>{const node=document.createElement(tag);if(content!==undefined)node.textContent=String(content);if(cls)node.className=cls;return node};
const section=el('section',undefined,'card');section.id='forwardOutcomes';
const bar=el('div',undefined,'fo-head');bar.append(el('h2','Forward results'));
const refresh=el('button','Refresh results','secondary');refresh.type='button';bar.append(refresh);
const note=el('p','Fixed-rule research observations only. A match rate is not a betting return; the priced prospective strategy has not been approved.','fo-note');
const filterWrap=el('div',undefined,'fo-filters');
const phaseField=el('div');const phaseLabel=el('label','Evaluation group');const phase=el('select');phaseLabel.htmlFor='forwardPhase';phase.id='forwardPhase';
for(const [value,label] of [['post_boundary','From 1 December'],['calibration','Before 1 December']]){const opt=el('option',label);opt.value=value;phase.append(opt)}
phaseField.append(phaseLabel,phase);
const marketField=el('div');const marketLabel=el('label','Market');const market=el('select');marketLabel.htmlFor='forwardMarket';market.id='forwardMarket';
for(const [value,label] of [['H','Home win'],['D','Draw'],['A','Away win']]){const opt=el('option',label);opt.value=value;market.append(opt)}
marketField.append(marketLabel,market);filterWrap.append(phaseField,marketField);
const status=el('p','Not loaded','muted');status.setAttribute('role','status');const content=el('div');
section.append(bar,note,filterWrap,status,content);
let loaded=false,loading=false,current=null,reqid=0;
function display(){
 if(!current)return;const item=current.summary.find(x=>x.market===market.value&&x.phase===phase.value);
 content.replaceChildren();if(!item)return;
 const grid=el('div',undefined,'fo-grid');for(const [caption,value] of [
 ['Qualifying observations',item.qualifying],['Settled outcomes',item.settled],
 ['Pending results',item.pending],['Outcome match rate',item.settled?item.match_rate_pct+'%':'Not yet available'],
 ['Winning outcomes',item.matched],['Needs review',item.review]]){
 const tile=el('div',undefined,'fo-stat');tile.append(el('small',caption),el('strong',value));grid.append(tile)}
 content.append(grid);
 const explanation=el('p',phase.value==='post_boundary'?'Post-boundary records are those with an originally captured kickoff date on or after 1 December 2026.':'Calibration records are those with an originally captured kickoff before 1 December 2026.','fo-note');
 content.append(explanation);
 const heading=el('h3','League breakdown');content.append(heading);
 const wrap=el('div',undefined,'scroll'),table=el('table'),thead=el('thead'),head=el('tr');for(const v of ['League','Qualifying','Settled','Matched','Pending','Review'])head.append(el('th',v));thead.append(head);table.append(thead);
 const body=el('tbody');for(const entry of current.leagues.filter(x=>x.market===market.value&&x.phase===phase.value)){
 const tr=el('tr');for(const value of [entry.league,entry.qualifying,entry.settled,entry.matched,entry.pending,entry.review])tr.append(el('td',value));body.append(tr)}
 table.append(body);wrap.append(table);content.append(wrap);
 content.append(el('p','All totals use the first qualifying representative for each fixture and market, preserving historical recording time. No stakes, profit, ROI or estimated edge are calculated.','fo-note'));
}
async function load(){
 if(loading)return;loading=true;const token=++reqid;refresh.disabled=true;status.textContent='Loading saved results…';
 try{
 const response=await fetch(CLOUD_URL+'/functions/v1/gerball-forward-outcomes',{headers:{apikey:CLOUD_KEY}});
 if(!response.ok)throw new Error('Results endpoint unavailable ('+response.status+')');
 const data=await response.json();if(data.version!=='forward_outcomes_v1'||!Array.isArray(data.summary)||data.summary.length!==6||!Array.isArray(data.leagues))throw new Error('Unexpected results data');
 if(token!==reqid)return;current=data;const stamp=new Date(data.generated_at);
 status.textContent='Recorded method: '+data.rule_version+' · Updated '+stamp.toLocaleString('en-GB',{timeZone:'Europe/London'})+' UK';display();
 }catch(error){if(token===reqid){current=null;content.replaceChildren();status.textContent=error.message}}
 finally{if(token===reqid){loading=false;refresh.disabled=false}}
}
phase.addEventListener('change',display);market.addEventListener('change',display);refresh.addEventListener('click',load);
function activate(){if(!loaded){root.append(section);loaded=true;load()}}
window.addEventListener('gerball:viewchange',e=>{if(e.detail?.view==='tracking')activate()});
if(!root.hidden)activate();
})();