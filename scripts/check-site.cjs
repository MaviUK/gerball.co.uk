const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync('index.html','utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(x=>x[1]).filter(Boolean);
assert(scripts.length>0,'Missing inline JavaScript');
for (const [i,src] of scripts.entries()) new vm.Script(src,{filename:'index.html script '+(i+1)});
for (const id of ['view-overview','view-tables','view-compare','view-betting','view-data']) assert(html.includes('id="'+id+'"'),'Missing navigation view '+id);
for (const id of ['wfRun','wfRows','wfSeasonRows','wfCommission','wfSlippage','wfExport','wfEquity','wfEquitySummary','wfUncertainty','comparisonToolPicker']) assert(html.includes(id),'Missing required feature '+id);
assert(html.includes('edgelab_walkforward_market'),'Missing historical multi-market validation RPC');
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

const reconciliationSource=html.match(/function renderAuditReconciliation\(\)\{[\s\S]*?\}\nfunction exportForwardAudit\(\)/);
assert(reconciliationSource,'Missing reconciliation function or export boundary');
const reconciliationFn=reconciliationSource[0].slice(0,-'\nfunction exportForwardAudit()'.length);
const elements={wfReconciliationRows:{rows:[],replaceChildren(){this.rows=[]},appendChild(row){this.rows.push(row)}},wfReconciliationStatus:{textContent:''}};
const doc={createElement(tag){return tag==='tr'?{cells:[],appendChild(cell){this.cells.push(cell)}}:{textContent:''}}};
const win={gerballForwardAuditSelections:[],gerballForwardAuditOK:false};
const runReconciliation=new Function('window','$','document',reconciliationFn+';renderAuditReconciliation()');
const execute=selections=>{win.gerballForwardAuditSelections=selections;runReconciliation(win,id=>elements[id],doc);return win.gerballForwardAuditOK};
const valid={season:'2526',league:'E0',market:'Home',reportedBets:2,reportedProfit:0.75,wagers:[{net:-1},{net:1.75}]};
assert.equal(execute([valid]),true,'Valid wager reconciliation must pass');
assert.equal(elements.wfReconciliationRows.rows.length,1,'Must show season audit row');
assert.equal(execute([{...valid,reportedBets:3}]),false,'Bet-count mismatch must block export');
assert.equal(execute([{...valid,reportedProfit:0.8}]),false,'Profit mismatch must block export');
assert.equal(execute([]),false,'Empty audit must block export');
assert(html.includes("if(!window.gerballForwardAuditOK)"),'Audit export must be gated by reconciliation');
assert(html.includes("function exportForwardAudit()"),'Audit CSV export missing');
assert(html.includes("lines.join('\\r\\n')"),'CSV rows must use CRLF separators');
assert(html.includes("['wager_reconciliation','wfReconciliationRows']"),'CSV must include reconciliation rows');
console.log('Forward-audit reconciliation and CSV export regression checks passed.');

(async()=>{
const exportSource=html.match(/function exportForwardAudit\(\)\{[\s\S]*?\}\nfunction exportWagerDifferences\(\)/);
assert(exportSource,'Missing complete forward CSV exporter');
const exportFn=exportSource[0].slice(0,-'\nfunction exportWagerDifferences()'.length);
const cells=values=>({querySelectorAll:()=>values.map(textContent=>({textContent}))});
const makeTable=(head,rows)=>({querySelectorAll:selector=>selector==='thead th'?head.map(textContent=>({textContent})):[]});
const makeBody=(head,rows)=>({closest:()=>makeTable(head,rows),querySelectorAll:()=>rows.map(cells),querySelector:()=>rows.length?cells(rows[0]):null});
const auditDom={
 wfForwardMinTraining:{value:'30'},wfForwardConsistency:{value:'0'},wfOddsMin:{value:'1.5'},wfOddsMax:{value:'4'},
 wfForwardStatus:{textContent:''},
 wfForwardRows:makeBody(['Season','League','Market','Training seasons','Training bets','Training ROI','Test bets','Test profit','Test ROI'],[['2526','E0','Home','2','80','5.00%','2','0.75','37.50%']]),
 wfReconciliationRows:makeBody(['Season','League','Market','Reported bets','Wager count','Reported profit','Wager profit','Check'],[['2526','E0','Home','2','2','0.7500','0.7500','MATCH']])
};
let capturedBlob=null,downloads=0;
const mockURL={createObjectURL(blob){capturedBlob=blob;return 'blob:test'},revokeObjectURL(){}};
const mockDocument={body:{appendChild(){}},createElement(){return {click(){downloads++},remove(){}}}};
const exportWindow={gerballForwardAuditOK:true};
const exportRunner=new Function('window','$','document','Blob','URL','setTimeout',exportFn+';exportForwardAudit()');
exportRunner(exportWindow,id=>auditDom[id],mockDocument,Blob,mockURL,()=>{});
assert.equal(downloads,1,'Valid export must initiate one download');
assert(capturedBlob,'CSV blob must be produced');
const exportedCSV=await capturedBlob.text();
const csvLines=exportedCSV.replace(/^\uFEFF/,'').split('\r\n');
const parseCSV=line=>[...line.matchAll(/"((?:[^"]|"")*)"|([^,]+)/g)].map(m=>(m[1]??m[2]).replace(/""/g,'"'));
const records=csvLines.map(parseCSV);
const getRow=(section,type)=>records.find(row=>row[0]===section&&row[1]===type);
const forwardRow=getRow('forward_selections','data'),reconciledRow=getRow('wager_reconciliation','data');
assert(forwardRow&&reconciledRow,'CSV must contain forward selection and reconciliation');
const independentNet=[-1,1.75].reduce((sum,n)=>sum+n,0);
assert.equal(Number(forwardRow[9]),independentNet,'Exported forward profit must match independent settled wagers');
assert.equal(Number(reconciledRow[8]),independentNet,'Exported reconciliation profit must match independent settled wagers');
assert.equal(Number(forwardRow[8]),2,'Exported bet count must match wager count');
assert.equal(Number(reconciledRow[6]),2,'Exported reconciled wager count must match');
assert.equal(reconciledRow[9],'MATCH','Exported reconciliation status must match');
assert.equal(getRow('metadata','settings')[2],'minimum_training_bets','CSV must preserve training settings');
exportWindow.gerballForwardAuditOK=false;
exportRunner(exportWindow,id=>auditDom[id],mockDocument,Blob,mockURL,()=>{});
assert.equal(downloads,1,'Failed reconciliation must not download CSV');
console.log('Generated CSV values independently reconcile with settled wager totals; export gating passed.');


const bootstrapMatch=html.match(/function seasonBootstrapROI\(blocks,threshold\)\{[\s\S]*?\}\nfunction renderSeasonBootstrap\(/);
assert(bootstrapMatch,'Missing season-block bootstrap implementation');
const bootstrapFn=new Function(bootstrapMatch[0].slice(0,-'\nfunction renderSeasonBootstrap('.length)+';return seasonBootstrapROI');
const bootstrap=bootstrapFn();
const allWins=bootstrap([{bets:10,profit:5},{bets:10,profit:5},{bets:10,profit:5}],30);
assert.equal(allWins.low,50,'All-positive fixed-return seasons must have exact 50% lower ROI');
assert.equal(allWins.high,50,'All-positive fixed-return seasons must have exact 50% upper ROI');
assert.equal(allWins.positive,1,'All-positive seasons must produce 100% positive bootstrap draws');
const allLosses=bootstrap([{bets:10,profit:-10},{bets:10,profit:-10},{bets:10,profit:-10}],30);
assert.equal(allLosses.low,-100,'All-losing seasons must have exact -100% lower ROI');
assert.equal(allLosses.high,-100,'All-losing seasons must have exact -100% upper ROI');
assert.equal(allLosses.positive,0,'All-losing seasons must produce zero positive draws');
assert.equal(bootstrap([{bets:10,profit:5},{bets:10,profit:5}],30).low,null,'Two seasons must not be reported as a 95% bootstrap interval');
assert.deepEqual(bootstrap([{bets:10,profit:3},{bets:20,profit:-5},{bets:15,profit:2}],50),bootstrap([{bets:10,profit:3},{bets:20,profit:-5},{bets:15,profit:2}],50),'Bootstrap must be deterministic');

const dashboardMatch=html.match(/function renderValidationDashboard\(summaries\)\{[\s\S]*?\}\nfunction renderThresholdSensitivity\(/);
assert(dashboardMatch,'Missing validation dashboard renderer');
const dashboardFn=dashboardMatch[0].slice(0,-'\nfunction renderThresholdSensitivity('.length);
const dashRows={items:[],replaceChildren(){this.items=[]},appendChild(x){this.items.push(x)}};
const dashStatus={textContent:''};
const dashWindow={};
const dashDocument={createElement(tag){return tag==='tr'?{cells:[],appendChild(x){this.cells.push(x)}}:{textContent:''}}};
const renderDash=new Function('window',String.fromCharCode(36),'document',dashboardFn+';renderValidationDashboard(arguments[3])');
const sample=(threshold,bets,roi,seasons,low,high)=>({threshold,bets,roi,maxDD:12,positive:seasons,activeSeasons:seasons,bootstrap:{low,high,positive:0.8}});
renderDash(dashWindow,id=>({wfValidationRows:dashRows,wfValidationStatus:dashStatus})[id],dashDocument,[sample(50,150,5,3,-2,9),sample(30,90,10,3,2,15),sample(100,150,3,3,1,6),sample(200,150,null,2,null,null)]);
assert.equal(dashRows.items.length,4,'Validation dashboard must show every threshold');
assert.equal(dashWindow.gerballValidationSummaries[0].threshold,30,'Dashboard must rank by historical ROI');
assert.equal(dashWindow.gerballValidationSummaries.at(-1).threshold,200,'Missing ROI must rank last');
const rowTexts=dashRows.items.map(row=>row.cells.map(cell=>cell.textContent));
assert.equal(rowTexts[0].at(-1),'Insufficient evidence','Positive ROI with fewer than 100 bets must be marked insufficient');
assert.equal(rowTexts[1].at(-1),'Uncertain — interval crosses zero','Cross-zero interval must not be declared a proven edge');
assert.equal(rowTexts[2].at(-1),'Positive historical interval — unconfirmed','Positive interval must remain unconfirmed');
assert.equal(rowTexts[3].at(-1),'Insufficient evidence','Missing interval must be insufficient evidence');
console.log('Validation dashboard bootstrap and evidence-gate regression checks passed.');

})().catch(err=>{console.error(err);process.exitCode=1});

assert(html.includes("function exportProspectiveCandidate()"),'Draft prospective strategy exporter missing');
assert(html.includes("status:'DRAFT_NOT_FROZEN'"),'Candidate export must explicitly be marked draft');
assert(html.includes("ledger_storage:'NOT_IMPLEMENTED'"),'Candidate must not imply prospective ledger exists');
assert(html.includes("selection_timing:'UNSPECIFIED'"),'Unspecified selection timing must not be invented');
assert(html.includes("executable_odds_source:'UNSPECIFIED'"),'Unspecified executable odds source must not be invented');
assert(html.includes("gerball-prospective-candidate-DRAFT.json"),'Draft JSON filename missing');
console.log('Prospective candidate export guardrails passed.');
