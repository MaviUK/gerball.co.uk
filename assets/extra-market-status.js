(function(){'use strict';
 const view=document.getElementById('view-data');if(!view)return;
 const css=document.createElement('style');css.textContent=`
 #extraMarketStatus{margin-top:20px}
 #extraMarketStatus .em-header{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px}
 #extraMarketStatus .em-header button{width:auto}
 #extraMarketStatus .em-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:15px 0}
 #extraMarketStatus .em-stat{border:1px solid #2b536c;border-radius:10px;background:#0c1e31;padding:14px}
 #extraMarketStatus .em-stat strong{display:block;font-size:25px;color:#70d7ac}
 #extraMarketStatus .em-note{font-size:13px;color:#b1c2d5}
 #extraMarketStatus .em-table{overflow:auto;border:1px solid #314660;border-radius:10px}
 #extraMarketStatus table{min-width:660px}
 #extraMarketStatus .em-warning{color:#e4bc7f}
 @media(max-width:640px){#extraMarketStatus .em-stats{grid-template-columns:repeat(2,minmax(0,1fr))}#extraMarketStatus .em-stat:last-child{grid-column:span 2}}
 `;document.head.append(css);
 const el=(tag,content,cls)=>{const n=document.createElement(tag);if(content!==undefined)n.textContent=String(content);if(cls)n.className=cls;return n};
 const names={halftime_fulltime:'Half-time/full-time',h2h_3_way_h1:'Half-time result',alternate_totals_cards:'Total cards',alternate_totals_corners:'Total corners',alternate_team_totals_corners:'Team corners',btts:'Both teams to score',player_to_receive_card:'Player card'};
 const section=el('section',undefined,'card');section.id='extraMarketStatus';
 const top=el('div',undefined,'em-header');top.append(el('h2','Extended bookmaker markets'));
 const button=el('button','Refresh market coverage','secondary');button.type='button';top.append(button);
 const notice=el('p','Captured prices are research snapshots only. This separate collector samples up to two fixtures per day, with a strict provider-credit limit. Missing cards markets are not treated as zero odds.','em-note');
 const status=el('p','Not loaded','muted');status.setAttribute('role','status');
 const body=el('div');section.append(top,notice,status,body);
 let started=false,loading=false;
 const localTime=t=>{const d=new Date(t);return !Number.isFinite(d.getTime())?'—':d.toLocaleString('en-GB',{timeZone:'Europe/London',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})+' UK'};
 const makeTable=(head,rows)=>{const host=el('div',undefined,'em-table'),table=el('table'),thead=el('thead'),tr=el('tr');for(const h of head)tr.append(el('th',h));thead.append(tr);table.append(thead);const tbody=el('tbody');for(const row of rows){const t=el('tr');for(const v of row)t.append(el('td',v??'—'));tbody.append(t)}table.append(tbody);host.append(table);return host};
 async function load(){
  if(loading)return;loading=true;button.disabled=true;status.textContent='Checking stored bookmaker markets…';
  try{const response=await fetch(CLOUD_URL+'/functions/v1/gerball-extra-market-status',{headers:{apikey:CLOUD_KEY},signal:AbortSignal.timeout(20000)});
   if(!response.ok)throw Error('Market report unavailable ('+response.status+')');
   const data=await response.json();if(data.version!=='extra_markets_v1'||!Array.isArray(data.runs)||!Array.isArray(data.markets)||!Array.isArray(data.latest_quotes))throw Error('Unexpected market report');
   body.replaceChildren();
   const latest=data.runs[0],total=data.markets.reduce((n,m)=>n+Number(m.prices||0),0);
   const stats=el('div',undefined,'em-stats');
   for(const [label,value] of [['Stored market quotes',total],['Markets with prices',data.markets.length],['Latest usage',latest?latest.credits_reported+' API credits':'Not recorded']]){
    const tile=el('div',undefined,'em-stat');tile.append(el('small',label),el('strong',value));stats.append(tile)
   }body.append(stats);
   if(latest)body.append(el('p','Latest '+latest.mode+' · '+latest.collection_date+' · '+latest.status+' · '+latest.fixture_count+' fixture(s) checked · '+(latest.requests_remaining??'Unknown')+' credits remaining at capture.','em-note'));
   body.append(el('h3','Market availability and prices'));
   const byMarket=new Map(data.markets.map(m=>[m.market_key,m]));
   const found=new Map(data.availability.map(m=>[m.market_key,m]));
   const keys=['halftime_fulltime','h2h_3_way_h1','alternate_totals_cards','alternate_totals_corners','alternate_team_totals_corners','btts','player_to_receive_card'];
   body.append(makeTable(['Market','Fixtures available','Quotes stored','Bookmakers'],keys.map(k=>[
    names[k],found.get(k)?.events??0,byMarket.get(k)?.prices??0,byMarket.get(k)?.bookmakers??0
   ])));
   if(data.latest_quotes.length){
    body.append(el('h3','Recently captured prices'));
    body.append(makeTable(['Fixture','Market','Selection','Price','Bookmaker','Captured'],data.latest_quotes.slice(0,25).map(q=>[
     q.home_team+' v '+q.away_team,names[q.market_key]||q.market_key,
     q.outcome_name+(q.outcome_description?' · '+q.outcome_description:'')+(q.line!==null?' '+q.line:''),
     Number(q.decimal_odds).toFixed(2),q.bookmaker_name,localTime(q.collected_at)
    ])));
   }else body.append(el('p','No additional-market prices stored yet.','em-note'));
   status.textContent='Updated '+localTime(data.generated_at);
  }catch(error){status.textContent=error.message;body.replaceChildren()}
  finally{loading=false;button.disabled=false}
 }
 button.addEventListener('click',load);
 function activate(){if(!started){started=true;view.append(section);load()}}
 window.addEventListener('gerball:viewchange',e=>{if(e.detail?.view==='data')activate()});
 if(!view.hidden)activate();
})();