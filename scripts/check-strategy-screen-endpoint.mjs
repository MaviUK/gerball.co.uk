import assert from 'node:assert/strict';
import test from 'node:test';
import { createHandler, parseQuery, LEAGUES, VERSION, environmentKeys } from '../supabase/functions/gerball-strategy-screen/handler.mjs';

const BASE = 'https://example.test/screen';
const metric = { bets: 0, wins: 0, profit_units: 0, roi_pct: null, avg_odds: null, max_drawdown_units: 0, first_date: null, last_date: null };
const payload = {
  status: 'ok', version: VERSION, basis: 'stored_match_history',
  generated_at: '2026-11-24T20:00:00Z', timezone: 'Europe/London', league_code: 'E0', days: 14,
  collection: {}, fixtures: [],
  rules: { prior_match_dates: 5, minimum_prior_games: 5, ppg_threshold: 0.5, ppg_decimal_places: 3,
    venue_scope: 'all', season_scope: 'same_league_across_seasons', markets: ['H', 'D', 'A'], qualification_uses_current_odds: false },
  backtest: { from: '2023-08-01', to: '2026-06-30', markets: Object.fromEntries(['H', 'D', 'A'].map(market =>
    [market, { rule_matches: 0, missing_prices: 0, outside_price_range: 0, full: metric, holdout: metric, seasons: [] }])) },
};
const PUBLIC_KEY = 'sb_publishable_test_application';
const config = { supabaseUrl: 'https://database.test/', serviceRoleKey: 'server-only-secret', publicKeys: [PUBLIC_KEY], logger: { error() {} } };
const request = (url = BASE, options = {}) => new Request(url, { ...options, headers: { apikey: PUBLIC_KEY, ...options.headers } });

test('bounds each request to one supported league and a finite fixture horizon', () => {
  assert.deepEqual(parseQuery(BASE), { p_league: 'E0', p_days: 14 });
  for (const league of LEAGUES) assert.equal(parseQuery(BASE + '?league=' + league.toLowerCase()).p_league, league);
  for (const days of [1, 7, 14, 31]) assert.equal(parseQuery(BASE + '?days=' + days).p_days, days);
  for (const query of ['league=', 'league=ALL', 'league=E0&league=E1', 'league=E0%27', 'days=0', 'days=32',
    'days=01', 'days=1.5', 'days=14&days=7', 'rpc=private_function', 'odds=2.5', 'threshold=0.25']) {
    assert.throws(() => parseQuery(BASE + '?' + query), query);
  }
});

test('calls one fixed historical read RPC and keeps credentials server-side', async () => {
  const calls = [];
  const handler = createHandler({ ...config, fetchImpl: async (url, options) => {
    calls.push({ url, options }); return Response.json(payload);
  } });
  const result = await handler(request());
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), payload);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://database.test/rest/v1/rpc/gerball_strategy_screen');
  assert.deepEqual(JSON.parse(calls[0].options.body), { p_league: 'E0', p_days: 14 });
  assert.equal(calls[0].options.headers.Authorization, 'Bearer server-only-secret');
  assert.equal(result.headers.get('apikey'), null);
  assert.equal(result.headers.get('authorization'), null);
  assert.match(result.headers.get('cache-control'), /max-age=60/);
});

test('preflight and rejected parameters or methods never query history or providers', async () => {
  let calls = 0;
  const handler = createHandler({ ...config, fetchImpl: async () => { calls++; throw new Error('Unexpected'); } });
  const preflight = await handler(new Request(BASE, { method: 'OPTIONS' }));
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get('access-control-allow-headers'), /authorization/);
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    assert.equal((await handler(new Request(BASE, { method }))).status, 405);
  }
  assert.equal((await handler(new Request(BASE + '?league=unknown'))).status, 400);
  assert.equal(calls, 0);
});

test('rejects mismatched leagues, rule versions, cutoffs and price-driven qualification', async () => {
  for (const invalid of [
    { ...payload, league_code: 'E1' }, { ...payload, days: 31 }, { ...payload, version: 'different_rule' },
    { ...payload, rules: { ...payload.rules, qualification_uses_current_odds: true } },
    { ...payload, rules: { ...payload.rules, prior_match_dates: 10 } },
    { ...payload, rules: { ...payload.rules, venue_scope: 'home_away' } },
    { ...payload, rules: { ...payload.rules, markets: ['H', 'D', 'A', 'O25', 'U25'] } },
    { ...payload, backtest: { ...payload.backtest, to: '2026-11-24' } },
    { ...payload, fixtures: null }, { ...payload, generated_at: 'invalid' },
  ]) {
    const result = await createHandler({ ...config, fetchImpl: async () => Response.json(invalid) })(request());
    assert.equal(result.status, 502);
    assert.equal(result.headers.get('cache-control'), 'no-store');
  }
});

test('zero samples are valid while failures return safe uncached messages', async () => {
  assert.equal((await createHandler({ ...config, fetchImpl: async () => Response.json(payload) })(request())).status, 200);
  assert.equal((await createHandler({ logger: config.logger })(new Request(BASE))).status, 503);
  for (const fetchImpl of [
    async () => new Response('private data server-only-secret', { status: 500 }),
    async () => { throw new Error('private data server-only-secret'); },
    async () => new Response('invalid json'),
  ]) {
    const result = await createHandler({ ...config, fetchImpl })(request());
    assert.equal(result.status, 502);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.doesNotMatch(await result.text(), /private data|server-only-secret/);
  }
});

test('verifies the public application key before database work and fails closed without configured keys', async () => {
  let calls = 0;
  const handler = createHandler({ ...config, fetchImpl: async () => { calls++; return Response.json(payload); } });
  for (const key of ['', 'sb_publishable_another_project', 'sb_secret_not_a_client_key']) {
    const result = await handler(request(BASE, { headers: { apikey: key } }));
    assert.equal(result.status, 401);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.doesNotMatch(await result.text(), /another_project|not_a_client_key/);
  }
  assert.equal((await handler(new Request(BASE))).status, 401);
  assert.equal(calls, 0);
  assert.equal((await handler(request())).status, 200);
  assert.equal(calls, 1);
  assert.equal((await createHandler({ ...config, publicKeys: [] })(request())).status, 503);
  assert.deepEqual(environmentKeys('invalid'), {});
  assert.deepEqual(environmentKeys('["invalid"]'), {});
  assert.deepEqual(environmentKeys('{"default":"sb_publishable_test_application"}'), { default: PUBLIC_KEY });
});

test('modern server keys use apikey without an invalid bearer token', async () => {
  let headers;
  const result = await createHandler({ ...config, serviceRoleKey: 'sb_secret_backend_only', fetchImpl: async (_url, options) => {
    headers = options.headers; return Response.json(payload);
  } })(request());
  assert.equal(result.status, 200);
  assert.equal(headers.apikey, 'sb_secret_backend_only');
  assert.equal(headers.Authorization, undefined);
  assert.doesNotMatch(await result.text(), /sb_secret_backend_only/);
});
