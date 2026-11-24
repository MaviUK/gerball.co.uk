import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../assets/strategy-screen.js', import.meta.url), 'utf8');
const pure = vm.createContext({ Intl, Date, URL, AbortController });
vm.runInContext(source, pure);
const helpers = pure.GerballStrategyScreen.helpers;
const instant = Date.parse('2026-11-24T12:00:00Z');

function history(ppg) {
  return { games: 5, date_count: 5, points: ppg * 5, ppg, first_date: '2026-10-20', last_date: '2026-11-20', dates: [
    { date: '2026-11-20', games: 1, points: 3 }, { date: '2026-11-10', games: 1, points: 0 }, { date: '2026-11-01', games: 1, points: 1 }, { date: '2026-10-25', games: 1, points: 3 }, { date: '2026-10-20', games: 1, points: 0 },
  ] };
}
function fixture(id, statuses = { H: 'match', D: 'no_match', A: 'no_match' }, league = 'E0') {
  return { event_id: id, league_code: league, league_name: league === 'E0' ? 'Premier League' : 'Championship', kickoff_at: '2026-11-28T15:00:00Z', cutoff_date: '2026-11-24',
    home: { provider_name: 'Home <script>alert(1)</script>', canonical_name: 'Home club', match_status: 'alias', history: history(1.8) },
    away: { provider_name: 'Away club', canonical_name: 'Away', match_status: 'alias', history: history(1.4) }, ppg_gap: .4,
    markets: Object.fromEntries(Object.entries(statuses).map(([market, status]) => [market, { status, reason: `${market} ${status} explanation` }])) };
}
function fixtures(league = 'E0') {
  return [fixture('home', { H: 'match', D: 'no_match', A: 'no_match' }, league), fixture('draw', { H: 'no_match', D: 'match', A: 'no_match' }, league),
    fixture('insufficient', { H: 'insufficient_history', D: 'insufficient_history', A: 'insufficient_history' }, league), fixture('unlinked', { H: 'unmatched_team', D: 'unmatched_team', A: 'unmatched_team' }, league),
    { ...fixture('started', undefined, league), kickoff_at: '2026-11-24T12:00:00Z' }];
}
function metrics(bets = 20, profit = -2) {
  return { bets, wins: 8, profit_units: profit, roi_pct: 100 * profit / bets, avg_odds: 2, max_drawdown_units: 5, first_date: '2023-08-13', last_date: '2026-05-24' };
}
function payload(league = 'E0', days = 14) {
  return { status: 'ok', version: 'ppg_last5_dates_050_v1', basis: 'stored_match_history', generated_at: new Date(instant).toISOString(), timezone: 'Europe/London', league_code: league, days,
    collection: { status: 'completed', collection_date: '2026-11-24', collected_at: '2026-11-24T11:00:00Z' },
    rules: { prior_match_dates: 5, minimum_prior_games: 5, ppg_threshold: .5, ppg_decimal_places: 3, venue_scope: 'all', season_scope: 'same_league_across_seasons', markets: ['H', 'D', 'A'], qualification_uses_current_odds: false },
    backtest: { from: '2023-08-01', to: '2026-06-30', odds_source: 'B365 archived pre-closing prices', odds_min: 1.5, odds_max: 4, commission_pct: 2, slippage_pct: 1, stake_units: 1, split_date: '2025-08-01',
      markets: Object.fromEntries(['H', 'D', 'A'].map((market, index) => [market, { rule_matches: 30, missing_prices: 2, outside_price_range: 8,
        full: metrics(index === 1 ? 12 : 20, index === 1 ? 3 : -2), holdout: metrics(5, -1), seasons: [{ season: '2526', bets: 20, wins: 8, profit_units: -2, roi_pct: -10 }] }])) },
    fixtures: fixtures(league) };
}

test('zero values remain numbers while missing samples and negative ROI stay distinct', () => {
  assert.equal(helpers.decimal(0, 3), '0.000');
  assert.equal(helpers.decimal(null, 3), '—');
  assert.equal(helpers.signed(0, '%'), '0.00%');
  assert.equal(helpers.signed(-8.8916, '%'), '-8.89%');
  assert.equal(helpers.signed(3, ' units'), '+3.00 units');
  assert.equal(helpers.signed(null, '%'), '—');
  assert.equal(helpers.count(0), '0');
  assert.equal(helpers.count(null), '—');
});

test('each selected market uses its server result, including overlapping boundaries', () => {
  const item = fixture('both', { H: 'match', D: 'match', A: 'no_match' });
  assert.equal(helpers.marketStatus(item, 'H'), 'match');
  assert.equal(helpers.marketStatus(item, 'D'), 'match');
  assert.equal(helpers.marketStatus(item, 'A'), 'no_match');
  assert.equal(helpers.marketStatus(item, 'O25'), 'unavailable');
  // The helper deliberately does not recompute eligibility from the display gap.
  assert.equal(helpers.marketStatus({ ...item, ppg_gap: -2.5 }, 'H'), 'match');
});

test('filters hide started fixtures, preserve exclusions on All, and recognize aliases', () => {
  const data = fixtures();
  assert.equal(helpers.filterFixtures(data, { market: 'H', results: 'matching' }, instant).map(item => item.event_id).join(','), 'home');
  assert.equal(helpers.filterFixtures(data, { market: 'D', results: 'matching' }, instant).map(item => item.event_id).join(','), 'draw');
  assert.equal(helpers.filterFixtures(data, { market: 'H', results: 'all', search: 'Home club' }, instant).length, 4);
  assert.equal(helpers.filterFixtures(data, { market: 'H', results: 'all', search: 'unknown' }, instant).length, 0);
  assert.equal(JSON.stringify(helpers.statusCounts(data, 'H', instant)), JSON.stringify({ total: 4, match: 1, no_match: 1, inadequate: 2 }));
  assert.equal(data.length, 5, 'Filtering cannot mutate the stored response');
});

test('response validation protects league, horizon, rule version and historical-only basis', () => {
  assert.equal(helpers.validPayload(payload(), 'E0', 14), true);
  assert.equal(helpers.validPayload(payload(), 'E1', 14), false);
  assert.equal(helpers.validPayload(payload(), 'E0', 7), false);
  assert.equal(helpers.validPayload({ ...payload(), version: 'different_rule' }, 'E0', 14), false);
  assert.equal(helpers.validPayload({ ...payload(), rules: { ...payload().rules, qualification_uses_current_odds: true } }, 'E0', 14), false);
  assert.equal(helpers.validPayload({ ...payload(), fixtures: fixtures('E1') }, 'E0', 14), false);
});

test('activation freshness expires after five minutes and at London midnight', () => {
  const value = payload();
  assert.equal(helpers.freshPayload(value, instant + 60000), true);
  assert.equal(helpers.freshPayload(value, instant + 300000), false);
  const summer = { generated_at: '2027-07-01T22:59:00Z' };
  assert.equal(helpers.londonDay(summer.generated_at), '2027-07-01');
  assert.equal(helpers.freshPayload(summer, Date.parse('2027-07-01T23:01:00Z')), false);
  assert.equal(helpers.freshPayload({ generated_at: 'invalid' }, instant), false);
});

test('CSV retains audit inputs, the chosen market and formula-safe text', () => {
  const value = payload(), item = { ...value.fixtures[0], home: { ...value.fixtures[0].home, provider_name: '=HYPERLINK("bad")' }, ppg_gap: -.4 };
  const csv = helpers.csvForScreen(value, [item], { market: 'D', results: 'all' });
  assert.match(csv, /qualification_uses_current_odds/);
  assert.match(csv, /"stored_match_history","false"/);
  assert.match(csv, /"D","all"/);
  assert.match(csv, /"'=HYPERLINK\(""bad""\)"/);
  assert.match(csv, /"-0.4"/);
  assert.doesNotMatch(csv, /"'-0.4"/);
  assert.equal(csv.split('\r\n').length, 2);
  assert.equal(helpers.csvCell('  +SUM(1,1)'), '"\'  +SUM(1,1)"');
  assert.equal(helpers.csvCell(null), '""');
});

class Element {
  constructor(tag, document) {
    this.tagName = tag.toUpperCase(); this.document = document; this.children = []; this.parentElement = null;
    this.listeners = new Map(); this.attributes = new Map(); this.dataset = {}; this.style = {}; this.value = ''; this.text = ''; this.hidden = false; this.disabled = false;
    const classes = new Set(); this.classList = { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) };
  }
  set textContent(value) { this.text = String(value); this.replaceChildren(); }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(' '); }
  appendChild(child) { if (child.parentElement) child.parentElement.children = child.parentElement.children.filter(item => item !== child); child.parentElement = this; this.children.push(child); return child; }
  append(...children) { children.forEach(child => this.appendChild(child)); }
  replaceChildren(...children) { this.children.forEach(child => { child.parentElement = null; }); this.children = []; this.append(...children); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(item => item !== this); this.parentElement = null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(name, listener) { if (!this.listeners.has(name)) this.listeners.set(name, []); this.listeners.get(name).push(listener); }
  dispatch(name) { for (const listener of this.listeners.get(name) || []) listener({ target: this, preventDefault() {} }); }
  click() { this.dispatch('click'); }
  focus() { this.document.activeElement = this; }
  scrollIntoView() {}
  querySelectorAll(selector) { const all = []; const walk = node => { if (selector === '[data-screen-focus]' && node.dataset.screenFocus) all.push(node); node.children.forEach(walk); }; walk(this); return all; }
}
function dom() {
  const document = { hidden: false };
  document.createElement = tag => new Element(tag, document);
  document.body = document.createElement('body'); document.activeElement = document.body;
  document.all = () => { const output = []; const walk = node => { output.push(node); node.children.forEach(walk); }; walk(document.body); return output; };
  document.getElementById = id => document.all().find(element => element.id === id) || null;
  return document;
}
function app(fetchImpl, overrides = {}) {
  const document = dom(), clock = { now: instant }, analyses = [], prices = [];
  class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [clock.now])); } static now() { return clock.now; } }
  const context = vm.createContext({ document, Intl, Date: ClockDate, URL, Blob, AbortController, fetch: fetchImpl, location: { href: 'https://gerball.co.uk/#screening' }, setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {} });
  vm.runInContext(source, context);
  const container = document.createElement('div'); document.body.appendChild(container);
  const api = context.GerballStrategyScreen.init({ container, endpoint: 'https://example.test/screen', apiKey: 'public-browser-key', leagues: [['E0', 'Premier League'], ['E1', 'Championship']], initialLeague: 'E0', onMatchAnalysis: value => analyses.push(value), onCapturedPrices: value => prices.push(value), ...overrides });
  return { api, document, container, clock, analyses, prices };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
const cards = document => document.all().filter(element => element.className === 'card ss-fixture');

test('real rendering uses safe text, exact 3dp inputs, and a public apikey-only request', async () => {
  const calls = [];
  const testApp = app(async (url, options) => { calls.push({ url, options }); return Response.json(payload()); });
  await testApp.api.activate();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers.apikey, 'public-browser-key');
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.equal(new URL(calls[0].url).searchParams.has('apikey'), false);
  assert.equal(cards(testApp.document).length, 1);
  assert.match(testApp.container.textContent, /Home <script>alert\(1\)<\/script>/);
  assert.equal(testApp.document.all().filter(element => element.tagName === 'SCRIPT').length, 0);
  assert.match(testApp.container.textContent, /1.800/);
  assert.match(testApp.container.textContent, /1.400/);
  assert.match(testApp.container.textContent, /Home PPG − away PPG: \+0.400/);
  assert.match(testApp.container.textContent, /5 games · 5 dates/);
  const analysis = testApp.document.all().find(element => element.className === 'ss-analysis-button'); analysis.click(); await settle();
  assert.equal(testApp.analyses[0].fixture.event_id, 'home');
  assert.equal(testApp.analyses[0].returnFocus, analysis);
});

test('market and exclusion controls update evidence/cards locally without another fetch', async () => {
  let calls = 0; const value = app(async () => { calls++; return Response.json(payload()); }); await value.api.activate();
  const market = value.document.getElementById('screenMarket'); market.value = 'D'; market.dispatch('change');
  assert.equal(calls, 1);
  assert.equal(cards(value.document).length, 1);
  assert.match(value.container.textContent, /Draw · historical results/);
  assert.match(value.container.textContent, /\+3.00/);
  assert.match(cards(value.document)[0].textContent, /D match explanation/);
  const results = value.document.getElementById('screenResults'); results.value = 'all'; results.dispatch('change');
  assert.equal(cards(value.document).length, 4);
  assert.match(value.container.textContent, /Insufficient history/);
  assert.match(value.container.textContent, /Team not linked/);
  assert.equal(calls, 1);
});

test('price handoff uses the displayed fixture and market without changing historical qualification', async () => {
  let calls = 0; const value = app(async () => { calls++; return Response.json(payload()); });
  await value.api.activate();
  const market = value.document.getElementById('screenMarket'); market.value = 'D'; market.dispatch('change');
  const before = cards(value.document).map(card => card.textContent);
  const prices = value.document.all().find(element => element.className === 'ss-prices-button');
  prices.click(); await settle();
  assert.equal(value.prices.length, 1);
  assert.equal(value.prices[0].fixture.event_id, 'draw');
  assert.equal(value.prices[0].market, 'D');
  assert.equal(value.prices[0].returnFocus, prices);
  assert.deepEqual(cards(value.document).map(card => card.textContent), before);
  assert.equal(market.value, 'D');
  assert.equal(calls, 1, 'Opening prices must not rerun or alter the historical rule');
});

test('a price handoff error stays local to its card and leaves the screen usable', async () => {
  const value = app(async () => Response.json(payload()), { onCapturedPrices() { throw Error('private diagnostic'); } });
  await value.api.activate();
  value.document.all().find(element => element.className === 'ss-prices-button').click(); await settle();
  assert.match(cards(value.document)[0].textContent, /Captured prices could not be opened/);
  assert.doesNotMatch(value.container.textContent, /private diagnostic/);
  value.document.all().find(element => element.className === 'ss-analysis-button').click(); await settle();
  assert.equal(value.analyses[0].fixture.event_id, 'home');
  assert.equal(value.analyses[0].market, 'H');
});

test('failed league switch clears the former league instead of relabelling its data', async () => {
  const value = app(async url => new URL(url).searchParams.get('league') === 'E0' ? Response.json(payload()) : new Response('internal database detail', { status: 500 }));
  await value.api.activate(); assert.equal(cards(value.document).length, 1);
  const league = value.document.getElementById('screenLeague'); league.value = 'E1'; league.dispatch('change');
  assert.equal(cards(value.document).length, 0, 'Previous league cards must disappear as soon as the request changes');
  await value.api.activate();
  assert.equal(cards(value.document).length, 0);
  assert.match(value.container.textContent, /The screen for Championship could not be loaded/);
  assert.doesNotMatch(value.container.textContent, /internal database detail/);
  assert.doesNotMatch(value.container.textContent, /Home <script>/);
});

test('superseded requests are aborted and cannot replace the newer league', async () => {
  const pending = new Map(), signals = new Map();
  const value = app((url, options) => { const league = new URL(url).searchParams.get('league'); signals.set(league, options.signal); return new Promise(resolve => pending.set(league, resolve)); });
  const first = value.api.activate();
  const league = value.document.getElementById('screenLeague'); league.value = 'E1'; league.dispatch('change');
  const second = value.api.activate(); assert.equal(signals.get('E0').aborted, true);
  pending.get('E1')(Response.json(payload('E1'))); await second;
  pending.get('E0')(Response.json(payload('E0'))); await first;
  assert.match(value.container.textContent, /Loaded Championship/);
  assert.equal(cards(value.document).length, 1);
  assert.match(cards(value.document)[0].textContent, /Championship/);
});

test('activate reuses a fresh screen then reloads expired data and the selected horizon', async () => {
  const calls = [];
  const value = app(async url => { const parsed = new URL(url), days = Number(parsed.searchParams.get('days')); calls.push(days); return Response.json(payload('E0', days)); });
  await value.api.activate(); await value.api.activate(); assert.deepEqual(calls, [14]);
  value.clock.now += 301000; await value.api.activate(); assert.deepEqual(calls, [14, 14]);
  const days = value.document.getElementById('screenHorizon'); days.value = '31'; days.dispatch('change'); await value.api.activate();
  assert.deepEqual(calls, [14, 14, 31]);
});

test('retry recovers from a failed response and destroy cancels pending work', async () => {
  let fail = true;
  const value = app(async () => fail ? new Response('', { status: 503 }) : Response.json(payload()));
  await value.api.activate(); assert.match(value.container.textContent, /could not be loaded/);
  fail = false;
  value.document.all().find(element => element.tagName === 'BUTTON' && element.textContent === 'Try again').click(); await value.api.activate();
  assert.equal(cards(value.document).length, 1);
  let signal; const pending = app((_url, options) => { signal = options.signal; return new Promise(() => {}); });
  pending.api.destroy(); assert.equal(signal.aborted, true);
});
