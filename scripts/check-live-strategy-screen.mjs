import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validPayload } from '../supabase/functions/gerball-strategy-screen/handler.mjs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const url = html.match(/const CLOUD_URL='([^']+)'/)[1];
const key = html.match(/const CLOUD_KEY='([^']+)'/)[1];
const response = await fetch(url + '/functions/v1/gerball-strategy-screen?league=E0&days=14', {
  headers: { apikey: key }, signal: AbortSignal.timeout(25000),
});
assert.equal(response.status, 200, 'Live historical screen must respond successfully');
const payload = await response.json();
assert(validPayload(payload, { p_league: 'E0', p_days: 14 }), 'Live screen contract and historical basis');

for (const [market, bets, profit, holdBets, holdROI] of [
  ['H', 186, -28.652602, 58, -8.8916], ['A', 290, -18.063970, 89, -11.2298],
]) {
  const evidence = payload.backtest.markets[market];
  assert.equal(evidence.full.bets, bets, market + ' historical bet count');
  assert.equal(evidence.holdout.bets, holdBets, market + ' final-slice bet count');
  assert(Math.abs(evidence.full.profit_units - profit) < 0.00001, market + ' historical net units');
  assert(Math.abs(evidence.holdout.roi_pct - holdROI) < 0.0001, market + ' final-slice ROI');
  assert.equal(evidence.rule_matches, evidence.missing_prices + evidence.outside_price_range + evidence.full.bets);
  assert.equal(evidence.seasons.reduce((sum, season) => sum + season.bets, 0), evidence.full.bets);
}
for (const fixture of payload.fixtures) {
  assert.equal(fixture.league_code, 'E0');
  assert.deepEqual(Object.keys(fixture.markets).sort(), ['A', 'D', 'H']);
  for (const side of ['home', 'away']) {
    const history = fixture[side].history;
    assert(history.date_count <= 5);
    assert(history.dates.every(row => row.date <= fixture.cutoff_date));
  }
}
console.log('Live historical screen: authorized request, fixed rules, benchmark returns and fixture cutoffs passed.');
