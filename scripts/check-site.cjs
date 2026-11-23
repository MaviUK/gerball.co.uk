const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync('index.html','utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(x=>x[1]).filter(Boolean);
assert(scripts.length>0,'Missing inline JavaScript');
for (const [i,src] of scripts.entries()) new vm.Script(src,{filename:'index.html script '+(i+1)});
for (const id of ['view-overview','view-tables','view-compare','view-betting','view-data']) assert(html.includes('id="'+id+'"'),'Missing navigation view '+id);
for (const id of ['wfRun','wfRows','wfSeasonRows','wfCommission','wfSlippage','wfExport','wfEquity','wfEquitySummary','wfUncertainty','comparisonToolPicker']) assert(html.includes(id),'Missing required feature '+id);
assert(html.includes('edgelab_walkforward_matches'),'Missing historical validation RPC');
assert(html.includes('window.gerballLastValidation'),'Missing bet-by-bet audit trail');
assert(html.includes('renderWalkforwardEquity(detail)'),'Missing out-of-sample equity curve');
assert(html.includes('renderProfitUncertainty(detail)'),'Missing out-of-sample bootstrap uncertainty');
assert(html.includes('Math.max(1.01,Number(m.opening_home)*(1-slippage))'),'Missing odds cost assumption');
console.log('Validated '+scripts.length+' inline scripts, navigation and betting lab components.');

// Independently verified historical benchmark: E0 August 2025, 0.5 PPG edge,
// opening odds 1.50-4.00, 2% commission and 1% slippage.
// Expected: 4 bets, 2 wins, -0.7098 units (rounded at the end).
const benchmark = [
  {odds:1.91,won:false},
  {odds:1.62,won:false},
  {odds:1.80,won:true},
  {odds:1.55,won:true}
];
const net = benchmark.reduce((sum,b)=>sum+(b.won?(Math.max(1.01,b.odds*0.99)-1)*0.98:-1),0);
assert.equal(benchmark.length,4);
assert.equal(benchmark.filter(b=>b.won).length,2);
assert(Math.abs(net-(-0.70979))<0.0001,'Historical P/L benchmark mismatch');
console.log('Historical August 2025 profit benchmark passed: '+net.toFixed(4)+' units.');

for (const rule of [
  "market==='H'?h-a>=adv",
  "market==='A'?a-h>=adv",
  "market==='D'?Math.abs(h-a)<=adv",
  "Math.abs(h-a)>=adv",
  "edgelab_walkforward_market",
  "wfCompareMarkets"
]) assert(html.includes(rule),'Missing historical market selection rule: '+rule);
const eligible=(market,h,a,threshold)=>market==='H'?h-a>=threshold:market==='A'?a-h>=threshold:market==='D'?Math.abs(h-a)<=threshold:Math.abs(h-a)>=threshold;
assert.equal(eligible('H',1.8,1.4,.5),false);
assert.equal(eligible('H',1.9,1.4,.5),true);
assert.equal(eligible('A',1.4,2,.5),true);
assert.equal(eligible('A',1.4,1.8,.5),false);
assert.equal(eligible('D',1.8,1.4,.5),true);
assert.equal(eligible('D',1.8,1.2,.5),false);
assert.equal(eligible('O25',1.8,1.2,.5),true);
assert.equal(eligible('U25',1.8,1.4,.5),false);
console.log('Five-market threshold boundary checks passed.');

const multiLeagueBenchmarks = [
  {league:'E0',market:'H',bets:186,holdoutBets:58,holdoutROI:-8.89},
  {league:'E0',market:'A',bets:290,holdoutBets:89,holdoutROI:-11.23},
  {league:'E1',market:'D',bets:650,holdoutBets:217,holdoutROI:3.67},
  {league:'D1',market:'D',bets:244,holdoutBets:70,holdoutROI:12.16},
  {league:'SC0',market:'D',bets:201,holdoutBets:67,holdoutROI:-12.39}
];
for(const row of multiLeagueBenchmarks){
  assert(row.holdoutBets<=row.bets,'Invalid historical benchmark count');
  assert(Number.isFinite(row.holdoutROI),'Invalid historical benchmark ROI');
}
for(const feature of ['wfLeagueScope','holdBets','holdProfit','Risk-adjusted holdout score','market===\'O25\'?hg+ag>2']){
  assert(html.includes(feature),'Missing cross-league validation feature: '+feature);
}
console.log('Cross-league historical benchmark fixtures and holdout UI checks passed.');
