import assert from 'node:assert/strict';
import test from 'node:test';
import { createHandler, parseQuery, validPayload, environmentKeys, LEAGUES, VERSION, RULE_VERSION } from '../supabase/functions/gerball-recorded-screens/handler.mjs';

const BASE = 'https://example.test/recorded';
const KEY = 'sb_publishable_test_application';
const HASH = 'a'.repeat(64);
const PARAMS = { p_league: 'E0', p_capture_date: null };
const empty = () => ({ fixtures: 0, settled: 0, matched: 0, not_matched: 0, pending: 0, review: 0, match_rate_pct: null });
const history = (points, ppg) => ({ games: 5, date_count: 5, points, ppg, first_date: '2026-11-01', last_date: '2026-11-23',
  dates: ['2026-11-23', '2026-11-21', '2026-11-15', '2026-11-08', '2026-11-01'].map(date => ({ date, games: 1, points: points / 5 })) });

function fixture() {
  return {
    id: 1, rule_version: RULE_VERSION, event_id: 'stored-event', league_code: 'E0', league_name: 'Premier League',
    capture_date: '2026-11-24', recorded_at: '2026-11-24T12:15:02Z', kickoff_at: '2026-12-01T20:00:00Z',
    fixture_date: '2026-12-01', season: '2627', phase: 'post_boundary', cutoff_date: '2026-11-24',
    home: { provider_name: 'Home', canonical_name: 'Home', match_status: 'matched', history: history(10, 2) },
    away: { provider_name: 'Away', canonical_name: 'Away', match_status: 'matched', history: history(5, 1) }, ppg_gap: 1,
    markets: { H: { status: 'match', reason: 'Saved home rule matched.' }, D: { status: 'no_match', reason: 'Saved draw rule did not match.' }, A: { status: 'no_match', reason: 'Saved away rule did not match.' } },
    input_sha256: HASH, first_qualifying: { H: { record_id: 1, capture_date: '2026-11-24' }, D: null, A: null },
    result: { status: 'pending', reason: 'awaiting_result', revision: 0, recorded_at: null, match_id: null, source: null,
      imported_at: null, home_goals: null, away_goals: null, full_time_result: null, correction_reason: null, history: [] },
  };
}

function payload() {
  const summary = Object.fromEntries(['H', 'D', 'A'].map(m => [m, { calibration: empty(), post_boundary: empty() }]));
  summary.H.post_boundary = { ...empty(), fixtures: 1, pending: 1 };
  return {
    status: 'ok', version: VERSION, rule_version: RULE_VERSION, generated_at: '2026-11-24T12:20:00Z',
    timezone: 'Europe/London', league_code: 'E0', evaluation_start: '2026-12-01',
    method: { horizon_days: 14, summary_basis: 'first_qualifying_capture_per_event_market_version', qualification_uses_current_odds: false,
      identity_policy: 'first_event_then_canonical_fixture', rule_frozen_at: '2026-11-24T12:10:00Z', implementation_sha256: HASH, source_commit: 'a'.repeat(40) },
    coverage: { today: { date: '2026-11-24', status: 'captured' }, captured_leagues_today: 18, expected_leagues: 18 },
    available_dates: [{ capture_date: '2026-11-24', captured_at: '2026-11-24T12:15:00Z', fixture_count: 1, mode: 'scheduled' }],
    cohort: { id: 1, capture_date: '2026-11-24', captured_at: '2026-11-24T12:15:00Z', fixture_count: 1, input_sha256: HASH },
    summary, records: [fixture()],
  };
}

const config = { supabaseUrl: 'https://database.test/', serviceRoleKey: 'sb_secret_server_only', publicKeys: [KEY], logger: { error() {} } };
const request = (url = BASE, options = {}) => new Request(url, { ...options, headers: { apikey: KEY, ...options.headers } });

test('bounds reads to one supported league and a real calendar date', () => {
  assert.deepEqual(parseQuery(BASE), PARAMS);
  for (const league of LEAGUES) assert.equal(parseQuery(BASE + '?league=' + league.toLowerCase()).p_league, league);
  assert.equal(parseQuery(BASE + '?date=2028-02-29').p_capture_date, '2028-02-29');
  for (const query of ['league=ALL', 'league=', 'league=E0&league=E1', 'date=', 'date=2026-02-29', 'date=2026-11-31',
    'date=2026-12-01T00:00:00Z', 'date=2026-11-24&date=2026-11-25', 'rpc=record', 'action=capture', 'since=2026-01-01', 'odds=2.5']) {
    assert.throws(() => parseQuery(BASE + '?' + query), query);
  }
});

test('reads one fixed RPC and keeps backend credentials out of the response', async () => {
  const calls = [];
  const expected = payload();
  const handler = createHandler({ ...config, fetchImpl: async (url, options) => { calls.push({ url, options }); return Response.json(expected); } });
  const response = await handler(request(BASE + '?date=2026-11-24'));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), expected);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://database.test/rest/v1/rpc/gerball_recorded_screens');
  assert.deepEqual(JSON.parse(calls[0].options.body), { p_league: 'E0', p_capture_date: '2026-11-24' });
  assert.equal(calls[0].options.headers.apikey, config.serviceRoleKey);
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.equal(response.headers.get('apikey'), null);
  assert.equal(response.headers.get('authorization'), null);
  assert.match(response.headers.get('cache-control'), /max-age=30/);
});

test('rejects writes, bad keys and invalid parameters before any database work', async () => {
  let calls = 0;
  const handler = createHandler({ ...config, fetchImpl: async () => { calls++; return Response.json(payload()); } });
  assert.equal((await handler(new Request(BASE, { method: 'OPTIONS' }))).status, 204);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal((await handler(request(BASE, { method }))).status, 405);
  for (const key of ['', 'sb_publishable_other_project', 'sb_secret_not_a_client_key']) {
    assert.equal((await handler(request(BASE, { headers: { apikey: key } }))).status, 401);
  }
  assert.equal((await handler(new Request(BASE))).status, 401);
  assert.equal((await handler(request(BASE + '?action=record'))).status, 400);
  assert.equal(calls, 0);
});

test('a saved record remains valid after kickoff and after a later source correction', async () => {
  const data = payload();
  data.generated_at = '2026-12-04T08:30:00Z';
  const revision = { status: 'settled', reason: 'exact_imported_result', revision: 1, recorded_at: '2026-12-04T08:30:00Z',
    match_id: 123, source: 'football-data.co.uk', imported_at: '2026-12-04T08:20:00Z', home_goals: 1, away_goals: 0,
    full_time_result: 'H', correction_reason: null };
  const correction = { ...revision, revision: 2, recorded_at: '2026-12-05T09:30:00Z', imported_at: '2026-12-05T09:20:00Z',
    away_goals: 1, full_time_result: 'D', correction_reason: 'Imported score changed.' };
  data.records[0].result = { ...correction, history: [revision, correction] };
  data.summary.H.post_boundary = { ...empty(), fixtures: 1, settled: 1, not_matched: 1, match_rate_pct: 0 };
  assert(validPayload(data, PARAMS));
  const response = await createHandler({ ...config, fetchImpl: async () => Response.json(data) })(request());
  assert.equal(response.status, 200);
  const saved = (await response.json()).records[0];
  assert.equal(saved.recorded_at, '2026-11-24T12:15:02Z');
  assert.equal(saved.home.history.ppg, 2);
  assert.equal(saved.result.history.length, 2);
  assert.equal(saved.result.history[0].full_time_result, 'H');
  assert.equal(saved.result.full_time_result, 'D');
});

test('rejects backdated observations, leaked future inputs and phase contamination', () => {
  const mutations = [
    d => { d.records[0].recorded_at = d.records[0].kickoff_at; },
    d => { d.records[0].recorded_at = '2026-12-02T00:00:00Z'; },
    d => { d.records[0].home.history.dates[0].date = '2026-11-25'; },
    d => { d.records[0].cutoff_date = '2026-12-01'; },
    d => { d.records[0].phase = 'calibration'; },
    d => { d.records[0].fixture_date = '2026-11-30'; },
    d => { d.records[0].input_sha256 = ''; },
    d => { d.evaluation_start = '2026-11-24'; },
    d => { d.rule_version = 'changed'; },
    d => { d.method.qualification_uses_current_odds = true; },
    d => { d.method.identity_policy = 'count_every_snapshot'; },
    d => { d.method.rule_frozen_at = '2026-11-25T00:00:00Z'; },
    d => { d.method.implementation_sha256 = null; },
    d => { d.method.source_commit = null; },
  ];
  for (const change of mutations) { const data = payload(); change(data); assert.equal(validPayload(data, PARAMS), false); }
  const november = payload();
  november.records[0].fixture_date = '2026-11-30';
  november.records[0].kickoff_at = '2026-11-30T20:00:00Z';
  november.records[0].phase = 'calibration';
  november.summary.H.calibration = november.summary.H.post_boundary;
  november.summary.H.post_boundary = empty();
  assert(validPayload(november, PARAMS));
});

test('rejects inconsistent scores and inflated or invented outcome rates', () => {
  const mutations = [
    d => { d.summary.H.post_boundary.fixtures = 2; },
    d => { d.summary.H.post_boundary.match_rate_pct = 0; },
    d => { d.summary.H.post_boundary = { ...empty(), fixtures: 1, settled: 1, matched: 1, match_rate_pct: 50 }; },
    d => { d.records[0].result = { status: 'settled', revision: 1, recorded_at: '2026-12-04T08:30:00Z', match_id: 1,
      source: 'football-data.co.uk', imported_at: '2026-12-04T08:20:00Z', home_goals: 1, away_goals: 2, full_time_result: 'H', history: [] }; },
    d => { d.records[0].result = { status: 'settled', revision: 1, recorded_at: '2026-12-04T08:30:00Z', match_id: 1,
      source: 'football-data.co.uk', imported_at: '2026-12-04T08:20:00Z', home_goals: -1, away_goals: 0, full_time_result: 'A', history: [] }; },
  ];
  for (const change of mutations) { const data = payload(); change(data); assert.equal(validPayload(data, PARAMS), false); }
});

test('allows empty captures and missing dates without inventing zero-percent performance', () => {
  const data = payload();
  data.records = []; data.cohort.fixture_count = 0; data.available_dates[0].fixture_count = 0;
  data.summary.H.post_boundary = empty();
  assert(validPayload(data, PARAMS));
  data.cohort = null; data.available_dates = [];
  assert(validPayload(data, { p_league: 'E0', p_capture_date: '2026-11-25' }));
  data.records = [fixture()];
  assert.equal(validPayload(data, PARAMS), false);
});

test('fails closed on wrong cohorts, response shape, runtime configuration and backend errors', async () => {
  const wrong = payload(); wrong.league_code = 'D1';
  const truncated = payload(); truncated.cohort.fixture_count = 2;
  const badDate = payload(); badDate.cohort.capture_date = '2026-11-25';
  const tooManyDates = payload(); tooManyDates.available_dates = Array(91).fill(tooManyDates.available_dates[0]);
  for (const data of [wrong, truncated, tooManyDates]) {
    const response = await createHandler({ ...config, fetchImpl: async () => Response.json(data) })(request());
    assert.equal(response.status, 502);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal(validPayload(badDate, { p_league: 'E0', p_capture_date: '2026-11-24' }), false);
  assert.equal((await createHandler({ ...config, publicKeys: [] })(request())).status, 503);
  assert.equal((await createHandler({ logger: config.logger })(request())).status, 503);
  for (const fetchImpl of [
    async () => new Response('private payload sb_secret_server_only', { status: 500 }),
    async () => { throw new Error('private payload sb_secret_server_only'); },
    async () => new Response('not json'),
  ]) {
    const response = await createHandler({ ...config, fetchImpl })(request());
    assert.equal(response.status, 502);
    assert.doesNotMatch(await response.text(), /private payload|sb_secret/);
  }
  assert.deepEqual(environmentKeys('not json'), {});
  assert.deepEqual(environmentKeys('[]'), {});
});

test('supports the legacy server key fallback without sending it to a client', async () => {
  let headers;
  const response = await createHandler({ ...config, serviceRoleKey: 'legacy_server_jwt', fetchImpl: async (_url, options) => {
    headers = options.headers; return Response.json(payload());
  } })(request());
  assert.equal(response.status, 200);
  assert.equal(headers.Authorization, 'Bearer legacy_server_jwt');
  assert.doesNotMatch(await response.text(), /legacy_server_jwt/);
});
