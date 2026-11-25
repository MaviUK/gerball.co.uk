(function(root){'use strict';
const parent=root.document.getElementById('paperBets'),view=root.document.getElementById('view-picks'),helper=root.GerballOddsMovement;
if(!parent||!view||!helper)return;
const el=(tag,value,cls)=>{const n=root.document.createElement(tag);if(value!==undefined)n.textContent=String(value);if(cls)n.className=cls;return n};
const section=el('section',undefined,'card pb-odds-movement');
const top=el('div',undefined,'pb-top');top.append(el('h2','Paper bet odds movement'));
const button=el('button','Refresh movement report','secondary');button.type='button';top.append(button);section.append(top);
section.append(el('p','Compares the frozen paper price with a later sampled fixed-odds quote for the same fixture and full-time result. Movement between different bookmakers is not same-bookmaker closing-line value (CLV).','pb-caption'));
const status=el('p','Not loaded','pb-caption');status.setAttribute('role','status');section.append(status);
const summary=el('div',undefined,'pb-movement-summary');section.append(summary);
const controls=el('div',undefined,'pb-breakdown-controls');const label=el('label','Show comparisons');label.htmlFor='pb-movement-filter';
const select=el('select');select.id='pb-movement-filter';
for(const [val,title] of [['all','All sampled comparisons'],['positive','Model edge still positive'],['nonpositive','Model edge no longer positive'],['same','Same original bookmaker']]){const option=el('option',title);option.value=val;select.append(option)}
controls.append(label,select);section.append(controls);
const tableHost=el('div');section.append(tableHost);
section.append(el('p','The model probability is kept fixed when estimating the later edge. No updated match prediction, executed price, fee calculation or realized profit is implied. Results are a biased sample: only fixtures selected by the quota-limited refresh appear.','pb-caption'));
const ledger=parent.querySelector('.pb-ledger');
if(ledger)parent.insertBefore(section,ledger);else parent.append(section);
let data=null,loading=false,loaded=false;
const date=x=>{const t=new Date(x);return Number.isFinite(t.getTime())?t.toLocaleString('en-GB',{timeZone:'Europe/London',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})+' UK':'—'};
const pct=x=>Number.isFinite(Number(x))?Number(x).toFixed(2)+'%':'—';
function tile(title,value){const n=el('div',undefined,'pb-movement-tile');n.append(el('small',title),el('strong',value));return n}
function render(){
 if(!data)return;
 summary.replaceChildren(
  tile('Eligible 1X2 paper bets',data.total_eligible_bets),
  tile('Later odds sampled',data.followed_bets),
  tile('Without follow-up',data.unfollowed_bets),
  tile('Positive modeled edge at later quote',data.positive_model_edge_at_latest),
  tile('Nonpositive modeled edge',data.nonpositive_model_edge_at_latest),
  tile('Same original bookmaker',data.same_original_bookmaker_observed),
  tile('Upcoming paper 1X2 bets',data.upcoming_paper_bets),
  tile('Upcoming without follow-up',data.upcoming_unfollowed_bets),
  tile('Today awaiting follow-up',data.today_upcoming_unfollowed_bets)
 );
 const all=data.items,filter=select.value;
 const rows=all.filter(x=>filter==='all'||filter==='positive'&&x.edge_status==='positive_model_edge'||filter==='nonpositive'&&x.edge_status==='nonpositive_model_edge'||filter==='same'&&x.same_book_odds!==null);
 status.textContent='Showing '+rows.length+' of '+data.followed_bets+' sampled comparisons · Today awaiting later quotes: '+data.today_upcoming_unfollowed_bets+' · Latest report '+date(data.generated_at)+'. '+data.unfollowed_bets+' eligible bets have no later quote.';
 tableHost.replaceChildren();
 if(!rows.length){tableHost.append(el('p','No comparisons match this filter. The collector only samples selected fixtures, so missing data must not be treated as evidence of a losing or profitable edge.','pb-caption'));return}
 const scroll=el('div',undefined,'pb-table-wrap'),table=el('table'),head=el('thead'),tr=el('tr');
 for(const name of ['Fixture / market','Original price','Later best fixed price','Change','Original estimated edge','Edge at later price','Bookmaker comparison','Quote captured'])tr.append(el('th',name));
 head.append(tr);table.append(head);const body=el('tbody');
 for(const row of rows){
  const v=helper.analyse(row);if(!v)continue;
  const tr=el('tr'),same=row.same_book_odds!==null;
  const cells=[
   row.home+' v '+row.away+' · '+({H:'Home',D:'Draw',A:'Away'}[row.market]||row.market),
   Number(row.original_odds).toFixed(2)+' · '+row.original_bookmaker,
   Number(row.latest_fixed_odds).toFixed(2)+' · '+row.latest_fixed_bookmaker,
   (v.movement>0?'+':'')+pct(v.movement),
   pct(v.oldEdge),
   (v.newEdge>0?'+':'')+pct(v.newEdge),
   same?'Original bookmaker also observed @ '+Number(row.same_book_odds).toFixed(2):'Cross-bookmaker only',
   date(row.latest_fixed_capture)
  ];
  for(const val of cells)tr.append(el('td',val));body.append(tr)
 }
 table.append(body);scroll.append(table);tableHost.append(scroll);
}
async function load(){
 if(loading)return;loading=true;button.disabled=true;status.textContent='Checking archived bookmaker quote movements…';
 try{
  const r=await root.fetch(CLOUD_URL+'/functions/v1/gerball-paper-odds-movement',{headers:{apikey:CLOUD_KEY},signal:AbortSignal.timeout(25000)});
  if(!r.ok)throw Error('Movement report unavailable ('+r.status+')');
  const report=await r.json();
  if(report.version!=='paper_odds_movement_v1'||!Array.isArray(report.items)||!Number.isInteger(report.followed_bets))throw Error('Unexpected movement report');
  data=report;render();
 }catch(e){status.textContent='Could not load movement report: '+e.message;tableHost.replaceChildren()}
 finally{loading=false;button.disabled=false}
}
button.addEventListener('click',load);select.addEventListener('change',render);
root.addEventListener('gerball:viewchange',e=>{if(e.detail?.view==='picks'&&!loaded){loaded=true;load()}});
if(!view.hidden){loaded=true;load()}
})(window);