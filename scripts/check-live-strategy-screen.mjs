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

// Follow a real screened fixture to its stored prices. All qualification checks
// above remain historical-only; prices are a separate, exact-event read.
const screenedFixture = payload.fixtures.find(fixture => Date.parse(fixture.kickoff_at) > Date.now() + 5 * 60000);
if (screenedFixture) {
  const priceURL = new URL(url + '/functions/v1/gerball-upcoming-fixtures');
  priceURL.searchParams.set('event_id', screenedFixture.event_id);
  priceURL.searchParams.set('league', screenedFixture.league_code);
  priceURL.searchParams.set('days', '31');
  const priceResponse = await fetch(priceURL, { signal: AbortSignal.timeout(25000) });
  assert.equal(priceResponse.status, 200, 'Exact-event stored prices must respond successfully');
  const prices = await priceResponse.json();
  assert.equal(prices.fixtures.length, 1, 'The requested event must resolve without another fixture');
  const event = prices.fixtures[0];
  assert.equal(event.event_id, screenedFixture.event_id);
  assert.equal(event.league_code, screenedFixture.league_code);
  assert.equal(event.bookmakers_loaded, true);
  assert.equal(event.bookmaker_count, event.bookmakers.length);
  assert(['completed', 'partial'].includes(prices.collection_status));
  let capturedMarkets = 0;
  for (const market of ['H', 'D', 'A', 'O25', 'U25']) {
    const quotes = event.bookmakers.map(bookmaker => ({ bookmaker, quote: bookmaker.markets[market] })).filter(item => item.quote !== null);
    const best = event.markets[market];
    if (!quotes.length) { assert.equal(best, null, market + ' missing market must stay missing'); continue; }
    capturedMarkets++;
    for (const { quote } of quotes) {
      assert(typeof quote.price === 'number' && Number.isFinite(quote.price) && quote.price > 1 && quote.price <= 10000);
      assert(Number.isFinite(Date.parse(quote.collected_at)), 'Each quote retains its own capture time');
    }
    assert.equal(best.price, Math.max(...quotes.map(item => item.quote.price)), market + ' highest captured price');
    const selected = quotes.find(item => item.bookmaker.key === best.bookmaker_key);
    assert(selected, market + ' displayed bookmaker must exist in the same comparison');
    assert.equal(selected.quote.price, best.price);
    assert.equal(selected.quote.source_updated_at, best.source_updated_at);
    assert.equal(selected.quote.collected_at, best.collected_at);
  }
  assert(capturedMarkets > 0, 'A stored fixture must retain at least one captured market');
  console.log(`Live price handoff: exact event and league, ${capturedMarkets} captured markets, ${event.bookmakers.length} bookmakers, highest prices and quote timestamps reconciled.`);
} else console.log('Live price handoff: no screened fixture beyond the kickoff buffer; empty and started states are covered by the UI suite.');
