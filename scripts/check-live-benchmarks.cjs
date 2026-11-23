'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const html=fs.readFileSync('index.html','utf8');
const url=html.match(/const CLOUD_URL='([^']+)'/)[1];
const key=html.match(/const CLOUD_KEY='([^']+)'/)[1];
const benchmarks=[
  {league:'E0',market:'H',bets:186,holdBets:58,holdROI:-8.89},
  {league:'E0',market:'A',bets:290,holdBets:89,holdROI:-11.23},
  {league:'E1',market:'D',bets:650,holdBets:217,holdROI:3.67},
  {league:'D1',market:'D',bets:244,holdBets:70,holdROI:12.16},
  {league:'SC0',market:'D',bets:201,holdBets:67,holdROI:-12.39}
];
async function getGames(league,market){
  const all=[];
  for(const [from,to] of [['2023-08-01','2024-06-30'],['2024-07-01','2025-06-30'],['2025-07-01','2026-06-30']]){
    const response=await fetch(url+'/rest/v1/rpc/edgelab_walkforward_market',{
      method:'POST',
      headers:{apikey:key,'Content-Type':'application/json'},
      body:JSON.stringify({p_league:league,p_from:from,p_to:to,p_market:market}),
      signal:AbortSignal.timeout(60000)
    });
    if(!response.ok)throw Error(league+'/'+market+' HTTP '+response.status+' '+await response.text());
    const batch=await response.json();
    if(batch.length>=1000)throw Error('Season exceeded API row limit: '+league+'/'+market+'/'+from);
    all.push(...batch);
  }
  return all;
}
function settle(games,market){
  const dates=[...new Set(games.map(g=>g.match_date))].sort();
  const split=dates[Math.floor(dates.length*.7)]||'9999-12-31';
  let bets=0,holdBets=0,holdProfit=0;
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
    if(m.match_date>=split){holdBets++;holdProfit+=net;}
  }
  return {bets,holdBets,holdROI:holdBets?100*holdProfit/holdBets:0};
}
(async()=>{
  for(const b of benchmarks){
    const got=settle(await getGames(b.league,b.market),b.market);
    assert.equal(got.bets,b.bets,b.league+'/'+b.market+' bet count');
    assert.equal(got.holdBets,b.holdBets,b.league+'/'+b.market+' holdout bet count');
    assert(Math.abs(got.holdROI-b.holdROI)<.015,b.league+'/'+b.market+' holdout ROI expected '+b.holdROI+' got '+got.holdROI);
    console.log('PASS',b.league,b.market,got.bets,got.holdBets,got.holdROI.toFixed(2)+'%');
  }
})().catch(err=>{console.error(err);process.exitCode=1;});
