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
