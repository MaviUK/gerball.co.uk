(function(root){'use strict';
const doc=root.document,host=doc.getElementById('paperBets'),view=doc.getElementById('view-picks');
if(!host||!view)return;
const create=(tag,content,cls)=>{const e=doc.createElement(tag);if(content!==undefined)e.textContent=String(content);if(cls)e.className=cls;return e};
const div=(cls)=>create('div',undefined,cls);
const num=(n,dp=2)=>n===null||n===undefined||!Number.isFinite(Number(n))?'—':Number(n).toFixed(dp);
const labelMap={form_poisson_venue_v1:'V1 · Form & History',form_poisson_opponent_h2h_v2:'V2 · Opponent-adjusted'};
const panel=create('section',undefined,'card gb-eval-panel');panel.id='gb-evaluation';
const header=div('gb-eval-head'),title=div('gb-eval-title');
title.append(create('span','MODEL COMPARISON / NO ODDS','gb-eval-kicker'),create('h2','PREDICTION PERFORMANCE'));
const refresh=create('button','Refresh results','secondary');refresh.type='button';header.append(title,refresh);
const intro=create('p','Independent historical accuracy testing. Compare reconstructed walk-forward matches with genuinely recorded pre-kickoff forecasts. Neither test uses bookmaker odds.','pb-caption');
const filters=div('gb-eval-filters');
const mode=create('select');mode.setAttribute('aria-label','Testing method');
for(const [value,title] of [['replay','Historical replay'],['live','Recorded forecasts']]){const op=create('option',title);op.value=value;mode.append(op)}
const season=create('select');season.setAttribute('aria-label','Historical season');
for(const [value,title] of [['','All seasons'],['2425','2024/25'],['2526','2025/26'],['2627','2026/27']]){const op=create('option',title);op.value=value;season.append(op)}
const league=create('select');league.setAttribute('aria-label','League');
for(const value of ['ALL','E0','E1','E2','E3','SC0','SC1','SC2','SC3','D1','D2','I1','I2','SP1','SP2','F1','F2','N1','B1','P1','T1','G1']){
 const op=create('option',value==='ALL'?'All leagues':value);op.value=value;league.append(op)
}
for(const [name,select] of [['Method',mode],['Season',season],['League',league]]){
 const wrapper=div('gb-eval-select');wrapper.append(create('label',name),select);filters.append(wrapper)}
const status=create('p','Loading evaluation…','pb-caption');status.setAttribute('role','status');
const progress=div('gb-eval-progress'),metricCards=div('gb-eval-models'),summary=div('gb-eval-summary');
const calibration=div('gb-eval-calibration'),markets=div('gb-eval-markets');
const disclaimer=create('p','Reconstructed backtests cannot verify what the site actually knew years ago. Comparisons become more reliable as the historical sample and future frozen predictions grow. Lower Brier score and log loss are better.','pb-caption');
panel.append(header,intro,filters,status,progress,metricCards,summary,calibration,markets,disclaimer);
const anchor=doc.getElementById('gb-form-v2')||doc.getElementById('gb-form-model')||host.querySelector('.pb-ledger');
if(anchor)anchor.insertAdjacentElement('afterend',panel);else host.append(panel);
function metric(name,value){const cell=div('gb-eval-metric');cell.append(create('small',name),create('strong',value));return cell}
function render(report){
 const models=report.models||[],bins=report.calibration||[],market=report.markets||[];
 metricCards.replaceChildren();progress.replaceChildren();summary.replaceChildren();calibration.replaceChildren();markets.replaceChildren();
 if(report.source==='replay'&&report.backfill){
  const b=report.backfill;const pct=b.total?Math.min(100,100*(b.completed+b.skipped)/b.total):0;
  const text=create('div','Historical replay: '+Number(b.completed||0).toLocaleString('en-GB')+' / '+Number(b.total||0).toLocaleString('en-GB')+' fixtures processed'+(b.skipped?' · '+b.skipped+' skipped':'')+'.','gb-eval-progress-text');
  const track=div('gb-eval-track'),bar=div('gb-eval-bar');bar.style.width=pct+'%';track.append(bar);progress.append(text,track);
 }
 for(const item of models){
  const card=div('gb-eval-model');card.append(create('h3',labelMap[item.model_version]||item.model_version));
  const grid=div('gb-eval-grid');grid.append(
   metric('Evaluated',Number(item.settled||0).toLocaleString('en-GB')),
   metric('All-fixture accuracy',item.all_hit_rate_pct===null?'—':num(item.all_hit_rate_pct,1)+'%'),
   metric('Selected accuracy',item.selected_hit_rate_pct===null?'—':num(item.selected_hit_rate_pct,1)+'%'),
   metric('Brier score',num(item.brier,4)),metric('Log loss',num(item.log_loss,4)),
   metric('Selected matches',Number(item.selected_settled||0).toLocaleString('en-GB')));
  card.append(grid);metricCards.append(card)
 }
 if(!models.length){metricCards.append(create('p',report.source==='live'?'No recorded pre-kickoff forecasts have reached evaluation yet. Daily snapshots begin at 10:05 AM UK time.':'The historical replay has not yet produced data for these filters.','pb-caption'))}
 if(report.paired&&report.paired.fixtures){
  const p=report.paired;const paired=div('gb-eval-paired');
  paired.append(create('strong','Same-fixture comparison · '+p.fixtures+' matches'),
   create('p','V1: '+num(p.v1_hit_rate_pct,1)+'% accuracy · Brier '+num(p.v1_brier,4)+'   |   V2: '+num(p.v2_hit_rate_pct,1)+'% accuracy · Brier '+num(p.v2_brier,4),'pb-caption'));
  summary.append(paired);
 }
 const explain=create('p',report.source_note||'','pb-caption');summary.append(explain);
 const heading=create('h3','PROBABILITY CALIBRATION');
 calibration.append(heading,create('p','For predictions assigned a given probability, this compares average predicted confidence against the frequency of correct outcomes. Small groups are less reliable.','pb-caption'));
 if(!bins.length)calibration.append(create('p','No settled calibration samples yet.','pb-caption'));
 else{
  for(const modelName of ['form_poisson_venue_v1','form_poisson_opponent_h2h_v2']){
   const subset=bins.filter(b=>b.model_version===modelName);if(!subset.length)continue;
   const block=div('gb-eval-cal-model');block.append(create('h4',labelMap[modelName]));
   for(const bin of subset){
    const wrap=div('gb-eval-cal-row');
    const lbl=create('small',bin.bin+'–'+(bin.bin+9)+'% · '+bin.sample+' games');
    const fill=div('gb-eval-bars'),f1=div('gb-eval-bar-item'),f2=div('gb-eval-bar-item');
    f1.style.width=Math.round(100*Number(bin.avg_forecast||0))+'%';
    f2.style.width=Math.round(100*Number(bin.actual_frequency||0))+'%';
    f2.classList.add('gb-eval-actual');
    fill.append(f1,f2);
    wrap.append(lbl,fill,create('span',num(Number(bin.avg_forecast)*100,0)+'% / '+num(Number(bin.actual_frequency)*100,0)+'%'));
    block.append(wrap)
   }
   calibration.append(block)
  }
  calibration.append(create('p','Bars: predicted confidence (light green) / actual success (darker green).','pb-caption'))
 }
 markets.append(create('h3','V2 · ADDITIONAL-MARKET ACCURACY'));
 if(!market.length)markets.append(create('p','No settled V2 market predictions for these filters.','pb-caption'));
 else{
  const table=create('table');const row=create('tr');
  for(const h of ['Market','Sample','Accuracy','Score','Measure'])row.append(create('th',h));const thead=create('thead');thead.append(row);table.append(thead);
  const body=create('tbody');
  for(const m of market){const tr=create('tr');for(const val of [m.market,m.n,m.accuracy===null?'—':num(Number(m.accuracy)*100,1)+'%',num(m.mean_score,4),m.metric==='log_loss'?'Log loss':'Brier'])tr.append(create('td',val));body.append(tr)}
  table.append(body);const scroll=div('pb-table-wrap');scroll.append(table);markets.append(scroll)
 }
}
const archive=div('gb-eval-archive'),archiveTitle=create('h3','Historical results · Betfair 1 unit'),archiveFilters=div('gb-eval-filters'),archiveStatus=create('p','Loading archive…','pb-caption'),archiveBody=div('pb-table-wrap'),archiveDetail=div('pb-table-wrap');
const countryPick=create('select'),leaguePick=create('select'),seasonPick=create('select'),modelPick=create('select');
const leagueNames={E0:'Premier League',E1:'Championship',E2:'League One',E3:'League Two',SC0:'Premiership',SC1:'Championship',SC2:'League One',SC3:'League Two',D1:'Bundesliga',D2:'2. Bundesliga',SP1:'La Liga',SP2:'Segunda División',I1:'Serie A',I2:'Serie B',F1:'Ligue 1',F2:'Ligue 2',N1:'Eredivisie',B1:'First Division A',P1:'Primeira Liga',T1:'Süper Lig',G1:'Super League'};
for(const [label,el] of [['Country',countryPick],['League',leaguePick],['Season',seasonPick],['Model',modelPick]]){el.setAttribute('aria-label',label);const box=div('gb-eval-select');box.append(create('label',label),el);archiveFilters.append(box)}
function options(el,values,all){const old=el.value;el.replaceChildren();for(const [value,label] of [['',all],...values]){const o=create('option',label);o.value=value;el.append(o)}if([...el.options].some(o=>o.value===old))el.value=old}
options(countryPick,[],'All countries');options(leaguePick,[],'All leagues');options(seasonPick,[],'All seasons');options(modelPick,[['form_poisson_venue_v1','Form V1'],['form_poisson_opponent_h2h_v2','Form V2']],'Both models');
const archiveRefresh=create('button','Refresh archive','secondary');archiveRefresh.type='button';
archive.append(archiveTitle,archiveFilters,archiveRefresh,archiveStatus,archiveBody,create('p','One unit per priced prediction, using archived Betfair Exchange prices before commission. Missing prices are excluded from P&L, not accuracy. All-fixture and model-selection rows overlap and must not be added together.','pb-caption'),create('h3','Country / league / season breakdown'),archiveDetail);
panel.insertBefore(archive,filters);
const legacy=create('details');legacy.append(create('summary','Recorded forecasts, calibration and original accuracy report'));for(const child of [intro,filters,status,progress,metricCards,summary,calibration,markets,disclaimer])legacy.append(child);panel.append(legacy);legacy.open=false;
let archiveCtrl=null,catalog=[],archiveData=null;
function syncArchiveFilters(){options(countryPick,[...new Set(catalog.map(x=>x.country))].sort().map(x=>[x,x]),'All countries');const c=catalog.filter(x=>!countryPick.value||x.country===countryPick.value);options(leaguePick,[...new Set(c.map(x=>x.league))].sort().map(x=>[x,leagueNames[x]||x]),'All leagues');const sc=c.filter(x=>!leaguePick.value||x.league===leaguePick.value);const unique=new Map();for(const x of sc)if(!unique.has(x.season)||x.first_date>unique.get(x.season))unique.set(x.season,x.first_date);options(seasonPick,[...unique].sort((a,b)=>b[1].localeCompare(a[1])).map(([s,d])=>[s,d.slice(0,4)+'/'+String(Number(d.slice(0,4))+1).slice(-2)]),'All seasons')}
const signed=n=>n===null||n===undefined?'—':(Number(n)>0?'+':'')+num(n,2);
function archiveTable(target,rows,detail){target.replaceChildren();if(!rows.length){target.append(create('p','No replayed predictions for these filters yet.','pb-caption'));return}const t=create('table'),head=create('thead'),tr=create('tr');const cols=[...(detail?['Country','League','Season']:[]),'Model','Market','Sample','Wins','Losses','Accuracy','BF bets','BF wins','BF losses','Avg BF odds','1u P&L','ROI'];for(const h of cols)tr.append(create('th',h));head.append(tr);t.append(head);const body=create('tbody');for(const r of rows){const row=create('tr');const values=[...(detail?[r.country,leagueNames[r.league]||r.league,r.season]:[]),r.model_version==='form_poisson_venue_v1'?'V1':'V2',r.market,r.sample,r.wins,r.losses,num(r.accuracy_pct,1)+'%',r.bf_bets,r.bf_wins,r.bf_losses,num(r.bf_average_odds),signed(r.bf_net),r.bf_roi_pct==null?'—':num(r.bf_roi_pct,2)+'%'];values.forEach((v,i)=>{const td=create('td',v);td.setAttribute('data-label',cols[i]);if(i===values.length-2&&r.bf_net!=null)td.className=Number(r.bf_net)<0?'pb-negative':'pb-positive';row.append(td)});body.append(row)}t.append(body);target.append(t)}
function drawArchive(){if(!archiveData)return;const model=modelPick.value;archiveTable(archiveBody,archiveData.markets.filter(x=>!model||x.model_version===model),false);archiveTable(archiveDetail,archiveData.breakdown.filter(x=>!model||x.model_version===model),true)}
async function loadArchive(){if(view.hidden||host.dataset.paperTab!=='accuracy')return;archiveCtrl?.abort();const ctrl=new AbortController();archiveCtrl=ctrl;archiveRefresh.disabled=true;archiveStatus.textContent='Loading historical results…';archiveBody.replaceChildren();archiveDetail.replaceChildren();archiveData=null;try{const p=new URLSearchParams({scope:'form_archive'});for(const [k,v] of [['country',countryPick.value],['league',leaguePick.value],['season',seasonPick.value]])if(v)p.set(k,v);const res=await root.fetch(CLOUD_URL+'/functions/v1/gerball-paper-bets?'+p,{headers:{apikey:CLOUD_KEY},signal:AbortSignal.any([ctrl.signal,AbortSignal.timeout(30000)])});if(!res.ok)throw Error('HTTP '+res.status);const data=await res.json();if(archiveCtrl!==ctrl)return;if(data.version!=='gerball_form_archive_v1'||!Array.isArray(data.catalog)||!Array.isArray(data.markets)||!Array.isArray(data.breakdown))throw Error('Invalid archive response');catalog=data.catalog;syncArchiveFilters();archiveData=data;const c=data.coverage;archiveStatus.textContent=Number(c.replayed).toLocaleString('en-GB')+' / '+Number(c.available).toLocaleString('en-GB')+' fixtures replayed · '+c.skipped+' skipped · '+(c.replayed+c.skipped<c.available?'Partial historical results':'Replay complete');drawArchive()}catch(e){if(archiveCtrl===ctrl&&e.name!=='AbortError')archiveStatus.textContent='Archive report unavailable: '+e.message}finally{if(archiveCtrl===ctrl){archiveCtrl=null;archiveRefresh.disabled=false}}}
countryPick.addEventListener('change',()=>{leaguePick.value='';seasonPick.value='';syncArchiveFilters();loadArchive()});leaguePick.addEventListener('change',()=>{seasonPick.value='';syncArchiveFilters();loadArchive()});seasonPick.addEventListener('change',loadArchive);modelPick.addEventListener('change',drawArchive);archiveRefresh.addEventListener('click',loadArchive);
root.addEventListener('gerball:paper-tabchange',e=>{if(e.detail?.tab==='accuracy')loadArchive();else archiveCtrl?.abort()});root.addEventListener('gerball:viewchange',e=>{if(e.detail?.view==='picks')loadArchive();else archiveCtrl?.abort()});if(!view.hidden)loadArchive();
let controller=null;
async function load(){
 if(view.hidden||(host.dataset.paperTab&&host.dataset.paperTab!=='accuracy')){panel.hidden=true;controller?.abort();return}
 panel.hidden=false;controller?.abort();const current=new AbortController();controller=current;refresh.disabled=true;status.textContent='Calculating historical model comparison…';
 try{
  const params=new URLSearchParams({scope:'form_evaluation',mode:mode.value});
  if(mode.value==='replay'&&season.value)params.set('season',season.value);
  if(league.value!=='ALL')params.set('league',league.value);
  const resp=await root.fetch(CLOUD_URL+'/functions/v1/gerball-paper-bets?'+params.toString(),{
   headers:{apikey:CLOUD_KEY},signal:AbortSignal.any([current.signal,AbortSignal.timeout(30000)])});
  if(!resp.ok)throw Error('Evaluation request '+resp.status);
  const data=await resp.json();
  if(current!==controller)return;
  if(data.version!=='gerball_form_evaluation_v1'||data.odds_used!==false||
    !Array.isArray(data.models)||!Array.isArray(data.calibration)||!Array.isArray(data.markets))throw Error('Invalid evaluation data');
  render(data);
  const n=data.models.reduce((a,m)=>a+(Number(m.settled)||0),0);
  status.textContent=(data.source==='replay'?'RECONSTRUCTED HISTORICAL TEST':'RECORDED PRE-KICKOFF TEST')+
   ' · '+n.toLocaleString('en-GB')+' scored model forecasts · bookmaker odds excluded';
 }catch(e){if(current===controller&&e.name!=='AbortError')status.textContent='Performance report unavailable: '+e.message}
 finally{if(current===controller){controller=null;refresh.disabled=false}}
}
mode.addEventListener('change',()=>{season.disabled=mode.value==='live';if(season.disabled)season.value='';load()});
season.addEventListener('change',load);league.addEventListener('change',load);
refresh.addEventListener('click',load);
 root.addEventListener('gerball:paper-tabchange',e=>{if(e.detail?.tab==='accuracy')load();else controller?.abort()});
root.addEventListener('gerball:viewchange',e=>{if(e.detail?.view==='picks')load();else{panel.hidden=true;controller?.abort()}});
if(!view.hidden)load();
})(window);