'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createPanelHarness}=require('./helpers/walkforward-panel-harness.cjs');
const html=fs.readFileSync('index.html','utf8');
const url=html.match(/const CLOUD_URL='([^']+)'/)[1];
const key=html.match(/const CLOUD_KEY='([^']+)'/)[1];
const benchmarks=[
  {league:'E0',market:'H',bets:186,holdBets:58,holdROI:-8.89,profit:-28.65,maxDD:31.1839},
  {league:'E0',market:'A',bets:290,holdBets:89,holdROI:-11.23,profit:-18.06},
  {league:'E1',market:'D',bets:650,holdBets:217,holdROI:3.67,profit:-57.91},
  {league:'D1',market:'D',bets:244,holdBets:70,holdROI:12.16,profit:0.92},
  {league:'SC0',market:'D',bets:201,holdBets:67,holdROI:-12.39,profit:27.22},
  {league:'E0',market:'O25',bets:550,holdBets:186,holdROI:-6.20,profit:-38.0874},
  {league:'E0',market:'U25',bets:703,holdBets:199,holdROI:-3.75,profit:-47.1533}
];
async function getGames(league,market){
  const all=[];
  for(const [from,to] of [['2023-08-01','2023-10-31'],['2023-11-01','2024-01-31'],['2024-02-01','2024-04-30'],['2024-05-01','2024-06-30'],['2024-07-01','2024-09-30'],['2024-10-01','2024-12-31'],['2025-01-01','2025-03-31'],['2025-04-01','2025-06-30'],['2025-07-01','2025-09-30'],['2025-10-01','2025-12-31'],['2026-01-01','2026-03-31'],['2026-04-01','2026-06-30']]){
    let batch;
    for(let attempt=0;attempt<4;attempt++){
      const response=await fetch(url+'/rest/v1/rpc/edgelab_walkforward_market',{
        method:'POST',
        headers:{apikey:key,'Content-Type':'application/json'},
        body:JSON.stringify({p_league:league,p_from:from,p_to:to,p_market:market}),
        signal:AbortSignal.timeout(60000)
      });
      if(response.ok){batch=await response.json();break;}
      const error=await response.text();
      if(attempt===3||!error.includes('57014'))throw Error(league+'/'+market+' HTTP '+response.status+' '+error);
      console.warn('Retrying timed-out historical query',league,market,from,'attempt',attempt+2);
      await new Promise(resolve=>setTimeout(resolve,500*(attempt+1)));
    }
    if(batch.length>=1000)throw Error('Quarter exceeded API row limit: '+league+'/'+market+'/'+from);
    all.push(...batch);
  }
  return all;
}
function settle(games,market){
  const dates=[...new Set(games.map(g=>g.match_date))].sort();
  const split=dates[Math.floor(dates.length*.7)]||'9999-12-31';
  let bets=0,wins=0,holdBets=0,holdProfit=0,profit=0;
  const audit=[];
  const seasons=new Map();
  for(const m of games){
    if(m.home_prior_ppg===null||m.away_prior_ppg===null||Number(m.home_prior_games)<5||Number(m.away_prior_games)<5)continue;
    const h=Number(m.home_prior_ppg),a=Number(m.away_prior_ppg),odds=Number(m.opening_home);
    if(!Number.isFinite(odds)||odds<1.5||odds>4)continue;
    const eligible=market==='H'?h-a>=.5:market==='A'?a-h>=.5:market==='D'?Math.abs(h-a)<=.5:Math.abs(h-a)>=.5;
    if(!eligible)continue;
    const hg=Number(m.home_goals),ag=Number(m.away_goals);
    const won=market==='H'?hg>ag:market==='D'?hg===ag:market==='A'?hg<ag:market==='O25'?hg+ag>2:hg+ag<3;
    const net=won?(Math.max(1.01,odds*.99)-1)*.98:-1;
    bets++;
    if(won)wins++;
    profit+=net;
    audit.push({date:m.match_date,home:m.home_team,away:m.away_team,net});
    const season=String(m.season||'unknown');
    const entry=seasons.get(season)||{bets:0,profit:0};
    entry.bets++;entry.profit+=net;seasons.set(season,entry);
    if(m.match_date>=split){holdBets++;holdProfit+=net;}
  }
  audit.sort((a,b)=>a.date.localeCompare(b.date)||a.home.localeCompare(b.home)||a.away.localeCompare(b.away));
  let equity=0,peak=0,maxDD=0;
  for(const bet of audit){equity+=bet.net;peak=Math.max(peak,equity);maxDD=Math.max(maxDD,peak-equity);}
  return {bets,wins,split,holdBets,profit,maxDD,seasons:[...seasons].sort((a,b)=>a[0].localeCompare(b[0])).map(([season,v])=>({season,bets:v.bets,profit:v.profit,roi:100*v.profit/v.bets})),holdROI:holdBets?100*holdProfit/holdBets:0};
}
async function checkClientPanel(games,benchmark,expected){
  const app=createPanelHarness(games);
  const run=await app.run({league:benchmark.league,market:benchmark.market,from:'2023-08-01',to:'2026-06-30',adv:.5,min:1.5,max:4,commission:.02,slippage:.01});
  assert(run,'The actual historical validation panel must complete');
  assert.equal(run.market,benchmark.market);
  assert.equal(run.detail.length,expected.bets,'Panel qualifying records must match independent historical settlement');
  assert(Math.abs(run.detail.reduce((sum,row)=>sum+row.net_profit,0)-expected.profit)<1e-8,'Panel ledger profit must reconcile');
  const rows=app.rows('wfRows');
  assert.equal(rows.length,2,'Both chronological sample rows must be rendered');
  for(const [index,subset] of [games.filter(game=>game.match_date<expected.split),games.filter(game=>game.match_date>=expected.split)].entries()){
    const settled=settle(subset,benchmark.market),row=rows[index];
    assert.equal(Number(row[1]),subset.length,'Displayed sample fixture count');
    assert.equal(Number(row[2]),settled.bets,'Displayed sample qualifying count');
    assert.equal(Number(row[3]),settled.wins,'Displayed sample wins');
    assert(Math.abs(Number(row[5])-settled.profit)<.006,'Displayed sample profit');
    assert.equal(row[6],settled.bets?(100*settled.profit/settled.bets).toFixed(2)+'%':'—','Displayed sample ROI');
    assert(Math.abs(Number(row[7])-settled.maxDD)<.006,'Displayed sample chronological drawdown');
  }
  const seasons=[...new Set(games.map(game=>String(game.season||'Unknown')))].sort();
  const seasonRows=app.rows('wfSeasonRows');
  assert.equal(seasonRows.length,seasons.length-1,'Season table keeps the first season as context');
  for(const row of seasonRows){
    const subset=games.filter(game=>String(game.season||'Unknown')===row[0]),settled=settle(subset,benchmark.market);
    assert.equal(Number(row[2]),subset.length,'Season fixture count');
    assert.equal(Number(row[3]),settled.bets,'Season qualifying count');
    assert.equal(Number(row[4]),settled.wins,'Season wins');
    assert(Math.abs(Number(row[5])-settled.profit)<.006,'Season profit');
    assert.equal(row[6],settled.bets?(100*settled.profit/settled.bets).toFixed(2)+'%':'—','Season ROI');
    assert(Math.abs(Number(row[7])-settled.maxDD)<.006,'Season chronological drawdown');
  }
  const blob=await app.export(),bytes=Buffer.from(await blob.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0,3)],[239,187,191],'Actual CSV download BOM');
  const csv=bytes.toString('utf8').replace(/^\uFEFF/,'').split('\r\n').map(line=>[...line.matchAll(/"((?:[^"]|"")*)"|([^,]+)/g)].map(match=>(match[1]??match[2]).replace(/""/g,'"')));
  const columns=csv[0],marketIndex=columns.indexOf('market'),profitIndex=columns.indexOf('net_profit');
  assert(marketIndex>=0&&profitIndex>=0,'CSV market and profit provenance');
  assert.equal(csv.length-1,expected.bets,'Actual CSV record count');
  assert(csv.slice(1).every(row=>row[marketIndex]===benchmark.market),'Actual CSV selected market');
  assert(Math.abs(csv.slice(1).reduce((sum,row)=>sum+Number(row[profitIndex]),0)-expected.profit)<1e-8,'Actual CSV profit reconciles with independent settlement');
  console.log('CLIENT PASS',benchmark.league,benchmark.market,'summary, seasons, settled records and CSV reconcile');
}
(async()=>{
  for(const b of benchmarks){
    const games=await getGames(b.league,b.market),got=settle(games,b.market);
    assert.equal(got.bets,b.bets,b.league+'/'+b.market+' bet count');
    assert.equal(got.holdBets,b.holdBets,b.league+'/'+b.market+' holdout bet count');
    if(b.maxDD!==undefined)assert(Math.abs(got.maxDD-b.maxDD)<.02,b.league+'/'+b.market+' maximum drawdown expected '+b.maxDD+' got '+got.maxDD);
    assert(Math.abs(got.profit-b.profit)<.02,b.league+'/'+b.market+' full profit expected '+b.profit+' got '+got.profit);
    assert(Math.abs(got.holdROI-b.holdROI)<.015,b.league+'/'+b.market+' holdout ROI expected '+b.holdROI+' got '+got.holdROI);
    assert.equal(got.seasons.reduce((sum,x)=>sum+x.bets,0),got.bets,'Season bet counts reconcile');
    assert(Math.abs(got.seasons.reduce((sum,x)=>sum+x.profit,0)-got.profit)<.0001,'Season profit reconciles');
    await checkClientPanel(games,b,got);
    console.log('PASS',b.league,b.market,got.bets,got.holdBets,got.holdROI.toFixed(2)+'%','maxDD',got.maxDD.toFixed(2));
    console.log('ROLLING SEASONS',b.league,b.market,JSON.stringify(got.seasons.map(x=>({...x,profit:+x.profit.toFixed(2),roi:+x.roi.toFixed(2)}))));
  }
})().catch(err=>{console.error(err);process.exitCode=1;});
