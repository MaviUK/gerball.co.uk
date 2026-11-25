(()=>{'use strict';
 const view=document.getElementById('view-tracking');if(!view)return;
 const css=document.createElement('style');css.textContent=`#priceReadiness{margin-top:20px}#priceReadiness .pr-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}#priceReadiness .pr-stat{background:#0e2032;border:1px solid #35506a;padding:15px;border-radius:10px}#priceReadiness .pr-stat strong{display:block;font-size:27px;color:#75ddbb}#priceReadiness .pr-top{display:flex;gap:12px;align-items:center;flex-wrap:wrap;justify-content:space-between;margin-bottom:12px}#priceReadiness button{width:auto}#priceReadiness table{min-width:0}#priceReadiness .pr-warning{color:#eec78f}#priceReadiness .pr-note{font-size:12px;color:#a8bacc}@media(max-width:640px){#priceReadiness .pr-grid{grid-template-columns:1fr 1fr}#priceReadiness .pr-stat:last-child{grid-column:span 2}}`;document.head.appendChild(css);
 let mounted=false,loading=false,requestId=0;
 function el(tag,content,cls){const node=document.createElement(tag);if(content!==undefined)node.textContent=String(content);if(cls)node.className=cls;return node}
 function refresh(){if(!mounted||loading)return;loading=true;const ticket=++requestId;status.textContent='Checking recorded quote coverage…';button.disabled=true;
  fetch(CLOUD_URL+'/functions/v1/gerball-price-readiness',{headers:{apikey:CLOUD_KEY}})
   .then(async response=>{if(!response.ok)throw Error('Report unavailable ('+response.status+')');return response.json()})
   .then(d=>{if(ticket!==requestId)return;
     content.replaceChildren();const summary=el('div',undefined,'pr-grid');
     for(const [title,value] of [['Saved fixtures',d.total_observations],['Qualifying markets',d.qualifying_markets],['Priced at recording',d.priced_markets]]){const tile=el('div',undefined,'pr-stat');tile.append(el('small',title),el('strong',value));summary.append(tile)}content.append(summary);
     const info=el('p','Capture '+(d.capture_date||'unavailable')+' · '+d.unpriced_markets+' qualifying markets without a recorded quote. Source quotes are research snapshots, not executable offers.','pr-note');content.append(info);
     const table=el('table');const head=el('thead');const tr=el('tr');for(const label of ['Market','Qualifying','Priced','Coverage'])tr.append(el('th',label));head.append(tr);table.append(head);
     const tbody=el('tbody');for(const row of d.markets||[]){const line=el('tr');for(const value of [row.market,row.qualifying,row.priced,row.qualifying?Math.round(1000*row.priced/row.qualifying)/10+'%':'—'])line.append(el('td',value));tbody.append(line)}table.append(tbody);const scroll=el('div',undefined,'scroll');scroll.append(table);content.append(scroll);
     if(d.missing_quote_examples?.length){const details=el('details');details.append(el('summary','Examples missing a recorded quote'));const list=el('ul');for(const row of d.missing_quote_examples){list.append(el('li',row.league_code+' · '+row.home_team+' v '+row.away_team+' · '+row.market))}details.append(list);content.append(details)}
     status.textContent='Read-only audit • '+new Date(d.generated_at).toLocaleString('en-GB',{timeZone:'Europe/London'})+' UK';
   }).catch(error=>{if(ticket===requestId)status.textContent=error.message}).finally(()=>{if(ticket===requestId){loading=false;button.disabled=false}});
 }
 const section=el('section',undefined,'card');section.id='priceReadiness';const top=el('div',undefined,'pr-top');const title=el('h2','Captured price readiness');const button=el('button','Refresh report','secondary');button.type='button';button.addEventListener('click',refresh);top.append(title,button);const note=el('p','Audit whether each frozen historical rule match had a captured bookmaker quote at or before its recording time. This does not approve, price or place bets.','pr-note');const status=el('p','Not loaded','muted');const content=el('div');section.append(top,note,status,content);
 function mount(){if(!mounted){view.append(section);mounted=true;refresh()}}
 window.addEventListener('gerball:viewchange',e=>{if(e.detail?.view==='tracking')mount()});
 if(!view.hidden)mount();
})();