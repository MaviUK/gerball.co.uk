(function(root){'use strict';
const doc=root.document,host=doc.getElementById('paperBets'),view=doc.getElementById('view-picks');
if(!host||!view)return;
const make=(tag,content,cls)=>{const e=doc.createElement(tag);if(content!==undefined)e.textContent=String(content);if(cls)e.className=cls;return e};
const ukDate=()=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(x=>[x.type,x.value]));return p.year+'-'+p.month+'-'+p.day};
const date=()=>{const s=doc.getElementById('pb-ledger-scope')?.value||'today';return s==='history'?null:s==='today'?ukDate():doc.getElementById('pb-ledger-date')?.value||ukDate()};
const kickoff=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
const pct=n=>n===null||n===undefined||!Number.isFinite(Number(n))?'—':(Number(n)*100).toFixed(1)+'%';
const nfmt=(n,dp=2)=>n===null||n===undefined||!Number.isFinite(Number(n))?'—':Number(n).toFixed(dp);
const results={H:'HOME',D:'DRAW',A:'AWAY'};
const section=make('section',undefined,'card gb-v2-panel');section.id='gb-form-v2';
const header=make('div',undefined,'gb-v2-head');
const heading=make('div',undefined,'gb-v2-heading');heading.append(make('span','MODEL 03 · FORM & HISTORY V2','gb-v2-kicker'),make('h2','OPPONENT-ADJUSTED PREDICTIONS'));
const refresh=make('button','Refresh V2','secondary');refresh.type='button';
header.append(heading,refresh);
const explanation=make('p','Independent odds-free forecasts based on team strength, recent form, venue-adjusted attack and defence, rest days, and lightly weighted overall/home-venue H2H. Separate half-time, HT/FT, goals and yellow-card probabilities. Model 01 and Model 02 remain unchanged.','pb-caption');
const status=make('p','Loading V2 predictions…','pb-caption');status.setAttribute('role','status');
const numbers=make('div',undefined,'gb-v2-numbers'),cards=make('div',undefined,'gb-v2-cards');
section.append(header,explanation,status,numbers,cards);
const existing=doc.getElementById('gb-form-model')||host.querySelector('.gb-extra-market');
if(existing)existing.insertAdjacentElement('afterend',section);else host.append(section);
const stat=(label,value)=>{const e=make('div',undefined,'gb-v2-stat');e.append(make('small',label),make('strong',value));return e};
const pair=(label,value)=>{const e=make('div',undefined,'gb-v2-pair');e.append(make('span',label),make('b',value));return e};
const barRow=(label,value)=>{const row=make('div',undefined,'gb-v2-prob');const name=make('span',label);const width=Math.max(0,Math.min(100,Number(value)*100||0));const bg=make('div',undefined,'gb-v2-track'),fill=make('div',undefined,'gb-v2-fill');fill.style.width=width+'%';bg.append(fill);row.append(name,bg,make('strong',pct(value)));return row};
const group=(title,data,labels)=>{const e=make('div',undefined,'gb-v2-prob-group');e.append(make('h5',title));if(!data){e.append(make('p','Insufficient source data.','pb-caption'));return e}for(const [key,label] of labels){if(data[key]!==undefined&&data[key]!==null)e.append(barRow(label,data[key]))}return e};
function card(b){
 const factors=b.model_factors||{},distribution=b.distributions||{},head=make('article',undefined,'gb-v2-card');
 const top=make('div',undefined,'gb-v2-match');
 const label=make('div');label.append(make('strong',b.home+' v '+b.away),make('small',(b.league||'')+' · '+kickoff.format(new Date(b.kickoff_at))+' UK'));
 const pick=make('div',undefined,'gb-v2-pick');pick.append(make('small','PREDICTION'),make('strong',results[b.pick]||b.pick),make('span',pct(b.pick_probability)));
 top.append(label,pick);head.append(top);
 const quick=make('div',undefined,'gb-v2-quick');
 quick.append(stat('Expected goals',nfmt(b.expected_home_goals)+'–'+nfmt(b.expected_away_goals)),
 stat('1X2 confidence',b.confidence+'/5'),stat('Latest form PPG',nfmt(b.home_form_ppg)+' / '+nfmt(b.away_form_ppg)),
 stat('Result',b.status==='settled'?(b.correct?'Correct':'Incorrect'):'Pending'));
 head.append(quick);
 const details=make('details',undefined,'gb-v2-details'),summary=make('summary','View market probabilities and model factors');details.append(summary);
 const markets=make('div',undefined,'gb-v2-markets');
 markets.append(group('FULL TIME',distribution.full_time,[['H','Home'],['D','Draw'],['A','Away']]));
 markets.append(group('HALF TIME',distribution.half_time,[['H','Home'],['D','Draw'],['A','Away']]));
 markets.append(group('GOALS & BTTS',distribution.goals,[['over_1_5','Over 1.5'],['over_2_5','Over 2.5'],['over_3_5','Over 3.5'],['under_2_5','Under 2.5'],['btts','Both score']]));
 markets.append(group('HT / FT',distribution.halftime_fulltime,[['H/H','H/H'],['H/D','H/D'],['H/A','H/A'],['D/H','D/H'],['D/D','D/D'],['D/A','D/A'],['A/H','A/H'],['A/D','A/D'],['A/A','A/A']]));
 markets.append(group('YELLOW CARDS',distribution.cards,[['over_3_5','4+ yellows'],['over_4_5','5+ yellows'],['over_5_5','6+ yellows'],['under_3_5','Under 4 yellows']]));
 details.append(markets);
 const features=make('div',undefined,'gb-v2-factors');features.append(make('h5','WHY THIS PREDICTION'));
 const opp=factors.opponent_strength||{},venue=factors.venue||{},rest=factors.rest||{},h2h=factors.h2h||{},rates=factors.expected_halftime_goals||{};
 for(const [label,value] of [
 ['Team-strength rating',nfmt(opp.home_rating,1)+' / '+nfmt(opp.away_rating,1)],
 ['Opponent-adjusted goals scored',nfmt(venue.home_opponent_adjusted_scoring)+' / '+nfmt(venue.away_opponent_adjusted_scoring)],
 ['Venue sample',String(venue.home_matches??'—')+' home / '+String(venue.away_matches??'—')+' away'],
 ['Rest before kickoff',String(rest.home_days??'—')+' / '+String(rest.away_days??'—')+' days'],
 ['Overall H2H sample',String(h2h.overall_count??'—')],
 ['H2H at today’s home venue',String(h2h.home_venue_count??'—')],
 ['Projected first-half goals',nfmt(rates.home)+' / '+nfmt(rates.away)],
 ['Card-market source','Historical yellow cards only'],
 ])features.append(pair(label,value));
 details.append(features);head.append(details);return head
}
function render(report){
 const s=report.summary||{},records=report.records||[];
 numbers.replaceChildren();
 for(const [label,value] of [['V2 predictions',s.predictions||0],['Correct',s.correct||0],['Incorrect',s.incorrect||0],['Pending',s.pending||0],['Hit rate',s.hit_rate_pct===null?'—':nfmt(s.hit_rate_pct,1)+'%'],['Odds used','NONE']])numbers.append(stat(label,value));
 cards.replaceChildren();
 if(!records.length){cards.append(make('p','No V2 predictions were frozen for this date. The upgraded model starts its own daily capture at 10:00 AM UK time; previous dates are not backfilled.','pb-caption'));return}
 for(const b of records)cards.append(card(b))
}
let running=null,lastDate='',loadedAt=0;
async function load(force=false){
 if(view.hidden){section.hidden=true;running?.abort();return}
 const chosen=date();section.hidden=false;
 if(!force&&lastDate===(chosen||'all')&&Date.now()-loadedAt<45000)return;
 running?.abort();const ctrl=new AbortController();running=ctrl;refresh.disabled=true;status.textContent='Loading V2 historical predictions…';
 try{
  const url=CLOUD_URL+'/functions/v1/gerball-paper-bets?scope='+(chosen?'form_v2&date='+encodeURIComponent(chosen):'form_v2_history');
  const response=await root.fetch(url,{headers:{apikey:CLOUD_KEY},signal:AbortSignal.any([ctrl.signal,AbortSignal.timeout(30000)])});
  if(!response.ok)throw Error('V2 report '+response.status);
  const result=await response.json();
  if(running!==ctrl||chosen!==date())return;
  if(result.version!=='form_predictions_v2'||result.odds_used!==false||!Array.isArray(result.records)||!result.summary)throw Error('Invalid V2 results');
  status.textContent=(result.summary.predictions||0)+' frozen V2 selections · '+(chosen||'all dates')+' · independent of bookmaker odds';
  render(result);lastDate=chosen||'all';loadedAt=Date.now();
 }catch(e){if(running===ctrl&&e.name!=='AbortError')status.textContent='Unable to load V2: '+e.message}
 finally{if(running===ctrl){running=null;refresh.disabled=false}}
}
refresh.addEventListener('click',()=>load(true));
doc.getElementById('pb-ledger-scope')?.addEventListener('change',()=>root.setTimeout(()=>load(true),0));
doc.getElementById('pb-ledger-date')?.addEventListener('change',()=>root.setTimeout(()=>load(true),0));
root.addEventListener('gerball:viewchange',e=>{if(e.detail?.view==='picks')load(true);else{section.hidden=true;running?.abort()}});
if(!view.hidden)load(true);
})(window);