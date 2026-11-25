(function(){'use strict';
 const root=document.getElementById('view-surebets'),mount=document.getElementById('surebetsScreen');
 const engine=window.GerballSurebets;if(!root||!mount||!engine)return;
 const el=(tag,value,cls)=>{const node=document.createElement(tag);if(value!==undefined)node.textContent=String(value);if(cls)node.className=cls;return node};
 const money=(value)=>'£'+Number(value).toFixed(2);
 const date=(value)=>{const d=new Date(value);return Number.isFinite(d.getTime())?d.toLocaleString('en-GB',{timeZone:'Europe/London',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})+' UK':'Unknown'};
 const marketLabel=(candidate)=>candidate.market_name+(candidate.line===null?'':' · '+candidate.line);
 const section=el('section',undefined,'card');const header=el('div',undefined,'sb-header');header.append(el('h2','Surebet / arbitrage scanner'));
 const refresh=el('button','Refresh captured odds','secondary');refresh.type='button';header.append(refresh);
 section.append(header,el('p','Combines the best archived prices at separate bookmakers for every possible outcome of the same event and market. No bets are placed.','sb-subtext'));
 const controls=el('div',undefined,'sb-control');const stakeLabel=el('label','Total stake');const stake=el('input');stake.type='number';stake.min='1';stake.max='1000000';stake.step='0.01';stake.value='100';stake.setAttribute('aria-label','Total stake in pounds');stakeLabel.append(stake);controls.append(stakeLabel);
 const status=el('p','Checking captured prices…','sb-subtext');status.setAttribute('role','status');section.append(controls,status);
 const warning=el('p','A mathematical surebet is only theoretical until every bookmaker accepts its stake at the displayed price. Limits, changed odds, void rules, market settlement differences, and fees can remove the profit. Exchange quotes with unknown commission are excluded.','sb-warning');section.append(warning);
 const stats=el('div',undefined,'sb-stats');section.append(stats);
 const liveTitle=el('h3','Fresh opportunities');const live=el('div');section.append(liveTitle,live);
 const archiveTitle=el('h3','Older theoretical opportunities (not actionable)');const archive=el('div');section.append(archiveTitle,archive);
 mount.append(section);
 let cached=null,loading=false,started=false;
 function stat(label,value){const tile=el('div',undefined,'sb-tile');tile.append(el('small',label),el('strong',value));return tile}
 function renderOne(candidate,fresh){const card=el('article',undefined,'sb-result');
  const heading=el('h3',candidate.home+' v '+candidate.away);card.append(heading);
  const hint=el('p',candidate.league+' · '+marketLabel(candidate)+' · Kickoff '+date(candidate.kickoff_at),'sb-subtext');card.append(hint);
  card.append(el('span',fresh?'Fresh snapshot':'Old snapshot',fresh?'sb-pill':'sb-pill sb-old'));
  card.append(el('p','Price sum '+candidate.implied.toFixed(5)+' · Theoretical gross return '+candidate.roiPct.toFixed(2)+'%','sb-subtext'));
  const scroll=el('div',undefined,'sb-scroll'),table=el('table'),thead=el('thead'),tr=el('tr');
  for(const txt of ['Outcome','Bookmaker','Odds','Stake','Potential payout'])tr.append(el('th',txt));
  thead.append(tr);table.append(thead);const tbody=el('tbody');
  for(const bet of candidate.legs){const line=el('tr');for(const value of [bet.outcome,bet.bookmaker,bet.odds.toFixed(2),money(bet.stake),money(bet.payout)])line.append(el('td',value));tbody.append(line)}
  table.append(tbody);scroll.append(table);card.append(scroll);
  card.append(el('p','Worst-case payout '+money(candidate.guaranteedPayout)+' · Minimum theoretical profit '+money(candidate.profit)+' on '+money(candidate.stake),'sb-return'));
  card.append(el('p','Latest quote captured '+date(candidate.captured_at)+'. Stakes are rounded to pennies; no bookmaker acceptance or execution verified.','sb-note'));
  return card
 }
 function draw(){
  if(!cached)return;const value=Number(stake.value);if(!Number.isFinite(value)||value<1||value>1000000){status.textContent='Choose a total stake from £1 to £1,000,000.';live.replaceChildren();archive.replaceChildren();return}
  const candidates=engine.scan(cached.quotes,{stake:value,now:Date.now(),liveMinutes:15,snapshotMinutes:2});
  const fresher=candidates.filter(x=>x.fresh),older=candidates.filter(x=>!x.fresh);
  stats.replaceChildren(stat('Fresh surebets',fresher.length),stat('Older theoretical',older.length),stat('Fixtures checked',cached.scanned_fixture_count));
  live.replaceChildren();archive.replaceChildren();
  if(!fresher.length)live.append(el('p','No verified fresh arbitrage from captured odds. This is not a recommendation to force a bet.','sb-subtext'));
  for(const item of fresher.slice(0,40))live.append(renderOne(item,true));
  if(!older.length)archive.append(el('p','No complete, mathematically profitable older snapshot was found.','sb-subtext'));
  for(const item of older.slice(0,20))archive.append(renderOne(item,false));
  status.textContent='Evaluated '+cached.complete_market_quote_rows+' best-price outcomes · Feed generated '+date(cached.generated_at)+' · Fresh means quotes captured within 15 minutes and provider updated within 15 minutes.';
 }
 async function load(){
  if(loading)return;loading=true;refresh.disabled=true;status.textContent='Loading bookmaker odds…';
  try{const response=await fetch(CLOUD_URL+'/functions/v1/gerball-surebets',{headers:{apikey:CLOUD_KEY},signal:AbortSignal.timeout(25000)});
   if(!response.ok)throw Error('Surebet prices temporarily unavailable ('+response.status+')');
   const data=await response.json();
   if(data.version!=='surebet_feed_v1'||!Array.isArray(data.quotes))throw Error('Invalid price feed');
   cached=data;draw();
  }catch(err){cached=null;stats.replaceChildren();live.replaceChildren();archive.replaceChildren();status.textContent=err.message}
  finally{loading=false;refresh.disabled=false}
 }
 stake.addEventListener('input',draw);refresh.addEventListener('click',load);
 function activate(){if(!started){started=true;load()}}
 window.addEventListener('gerball:viewchange',e=>{if(e.detail?.view==='surebets')activate()});
 if(!root.hidden)activate();
})();