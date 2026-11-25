import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {analyse}=require('../assets/paper-movement-math.js');
assert.deepEqual(analyse({original_odds:2,latest_fixed_odds:2.4,model_probability:0.5}),{
 movement:20,oldEdge:0,newEdge:20,preserved:true,direction:'higher'});
assert.deepEqual(analyse({original_odds:2.5,latest_fixed_odds:2,model_probability:0.45}),{
 movement:-20,oldEdge:12.5,newEdge:-10,preserved:false,direction:'lower'});
assert.equal(analyse({original_odds:2,latest_fixed_odds:null,model_probability:0.4}),null);
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const ui=fs.readFileSync(new URL('../assets/paper-odds-movement.js',import.meta.url),'utf8');
const sql=fs.readFileSync(new URL('../supabase/paper-odds-movement-source.sql',import.meta.url),'utf8');
assert(html.includes('/assets/paper-movement-math.js')&&html.includes('/assets/paper-odds-movement.js'));
assert(ui.includes('Cross-bookmaker only')&&ui.includes('Original price')&&ui.includes('later quote'));
assert(sql.includes('q.collected_at<r.kickoff_at')&&sql.includes('r.completed_at>b.recorded_at'));
assert(sql.includes('DISTINCT ON (bet_id,run_id)'),'Per-run best quoted prices required');
const base=html.match(/const CLOUD_URL='([^']+)'/)?.[1],key=html.match(/const CLOUD_KEY='([^']+)'/)?.[1];
assert(base&&key);
const url=base+'/functions/v1/gerball-paper-odds-movement';
let response=await fetch(url,{signal:AbortSignal.timeout(15000)});
assert.equal(response.status,401,'Public endpoint requires publishable application key');
response=await fetch(url,{method:'POST',headers:{apikey:key},signal:AbortSignal.timeout(15000)});
assert.equal(response.status,405,'Report is GET-only');
response=await fetch(url,{headers:{apikey:key},signal:AbortSignal.timeout(25000)});
assert.equal(response.status,200,'Read-only movement report must be operational');
const result=await response.json();
assert.equal(result.version,'paper_odds_movement_v1');
assert.equal(result.total_eligible_bets,result.followed_bets+result.unfollowed_bets);
assert.equal(result.followed_bets,result.positive_model_edge_at_latest+result.nonpositive_model_edge_at_latest);
assert.equal(result.followed_bets,result.higher_fixed_price+result.lower_fixed_price+result.unchanged_fixed_price);
assert(result.same_original_bookmaker_observed<=result.followed_bets);
assert(result.items.length<=100);
for(const row of result.items){
 assert(['H','D','A'].includes(row.market));
 assert(Number(row.original_odds)>1&&Number(row.latest_fixed_odds)>1);
 assert(Date.parse(row.latest_fixed_capture)>=Date.parse(row.original_recorded_at));
 assert(Date.parse(row.latest_fixed_capture)<Date.parse(row.kickoff_at));
 const model=analyse(row);assert(model&&model.preserved===(row.edge_status==='positive_model_edge'));
 assert.equal(model.direction,{'higher_fixed_price':'higher','lower_fixed_price':'lower','unchanged':'unchanged'}[row.direction]);
}
console.log('Paper odds movement verified:',result.followed_bets,'followed of',result.total_eligible_bets,'eligible; edge positive',result.positive_model_edge_at_latest);
