import assert from 'node:assert/strict';
import test from 'node:test';
import { createHandler, environmentKeys, validPayload } from '../supabase/functions/gerball-data-status/handler.mjs';
import { dataStatusFixture } from './fixtures/data-status.mjs';

const APP_KEY = 'sb_publishable_test_application';
const SERVICE_KEY = 'sb_secret_server_only';
const URL = 'https://example.supabase.co/functions/v1/gerball-data-status';
function setup({ payload = dataStatusFixture(), fetchImpl, serviceRoleKey = SERVICE_KEY, publicKeys = [APP_KEY], supabaseUrl = 'https://example.supabase.co/' } = {}) {
  const calls = [], logs = [];
  const handler = createHandler({ supabaseUrl, serviceRoleKey, publicKeys, logger: { error: message => logs.push(message) },
    fetchImpl: fetchImpl || (async (...args) => { calls.push(args); return Response.json(payload); }) });
  return { handler, calls, logs };
}
const request = (path = URL, options = {}) => new Request(path, { headers: { apikey: APP_KEY }, ...options });

test('GET uses one fixed read RPC and keeps the server key out of the response', async () => {
  const { handler, calls } = setup();
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  const [url, init] = calls[0];
  assert.equal(url, 'https://example.supabase.co/rest/v1/rpc/gerball_data_status');
  assert.equal(init.method, 'POST');
  assert.equal(init.body, '{}');
  assert.equal(init.headers.apikey, SERVICE_KEY);
  assert.equal(init.headers.Authorization, undefined);
  assert(init.signal instanceof AbortSignal);
  const body = await response.text();
  assert(!body.includes(SERVICE_KEY));
  assert.deepEqual(JSON.parse(body), dataStatusFixture());
  assert.equal(response.headers.get('vary'), 'apikey');
  assert.match(response.headers.get('cache-control'), /max-age=30/);
});

test('legacy server credentials are supplied only on the upstream request', async () => {
  const { handler, calls } = setup({ serviceRoleKey: 'legacy.server.jwt' });
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.equal(calls[0][1].headers.Authorization, 'Bearer legacy.server.jwt');
  assert(!(await response.text()).includes('legacy.server.jwt'));
});

test('methods, caller parameters and unauthorized requests cannot reach the database', async () => {
  const { handler, calls } = setup();
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']) {
    const response = await handler(request(URL, { method }));
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'GET, OPTIONS');
  }
  for (const suffix of ['?p_now=2020-01-01', '?league=E0', '?retry=true', '?a=1&a=2']) {
    assert.equal((await handler(request(URL + suffix))).status, 400);
  }
  assert.equal((await handler(request(URL, { headers: {} }))).status, 401);
  assert.equal((await handler(request(URL, { headers: { apikey: 'wrong' } }))).status, 401);
  assert.equal((await handler(request(URL, { headers: { Authorization: `Bearer ${APP_KEY}` } }))).status, 401);
  assert.equal(calls.length, 0);
});

test('preflight is read only and permits the application-key header', async () => {
  const { handler, calls } = setup();
  const response = await handler(request(URL, { method: 'OPTIONS', headers: {} }));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-methods'), 'GET, OPTIONS');
  assert.match(response.headers.get('access-control-allow-headers'), /apikey/);
  assert.equal(calls.length, 0);
});

test('missing configuration and malformed environment values fail safely', async () => {
  assert.deepEqual(environmentKeys('bad json'), {});
  assert.deepEqual(environmentKeys('["secret"]'), {});
  assert.deepEqual(environmentKeys('null'), {});
  assert.deepEqual(environmentKeys('{"default":"safe"}'), { default: 'safe' });
  for (const config of [{ serviceRoleKey: '' }, { supabaseUrl: '' }, { publicKeys: [] }, { publicKeys: ['legacy.anon.jwt'] }]) {
    const { handler, calls } = setup(config);
    const response = await handler(request());
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(calls.length, 0);
    assert(!(await response.text()).includes(SERVICE_KEY));
  }
});

test('database failures, malformed JSON and exceptions never return private details', async () => {
  for (const fetchImpl of [
    async () => new Response('private_token=secret', { status: 500 }),
    async () => new Response('private_token=secret', { status: 200 }),
    async () => { throw new Error('private_token=secret'); },
  ]) {
    const { handler, logs } = setup({ fetchImpl });
    const response = await handler(request());
    assert.equal(response.status, 502);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert(!(await response.text()).includes('secret'));
    assert(!logs.join(' ').includes('secret'));
  }
});

test('closed payload validation rejects hidden fields and inconsistent evidence', async () => {
  const mutations = [
    p => { p.secret = 'private'; },
    p => { p.jobs[0].command = 'select secret'; },
    p => { p.leagues[0].collection.error_message = 'private'; },
    p => { p.archive.import_schedule.last_successful_run_at = p.generated_at; },
    p => { p.archive.import_schedule.run_audit_available = true; },
    p => { p.leagues[0].results.pending += 1; },
    p => { p.archive.total_matches += 1; },
    p => { p.leagues[0].code = p.leagues[1].code; },
    p => { p.jobs[0].key = p.jobs[1].key; },
    p => { p.leagues.find(l => l.code === 'SC1').odds_feed = true; },
    p => { p.leagues[0].archive.current_season_last_match_date = '2026-02-30'; },
    p => { p.leagues[0].collection.checked_at = '2026-11-25T20:00:00Z'; },
    p => { p.jobs[0].last_run = { status: 'succeeded', started_at: '2026-11-25T20:00:00Z', finished_at: null }; },
    p => { p.stages.recorder.last_success_at = '2026-11-25T20:00:00Z'; },
    p => { p.jobs[0].active = false; },
    p => { p.attention = [{ code: 'raw secret details', stage: 'collector', league_code: null, severity: 'warning' }]; },
  ];
  for (const mutate of mutations) {
    const payload = dataStatusFixture(); mutate(payload);
    assert.equal(validPayload(payload), false);
    const { handler } = setup({ payload });
    assert.equal((await handler(request())).status, 502);
  }
});

test('inactive feeds, empty captures, missing jobs and pending checks remain valid evidence', async () => {
  const payload = dataStatusFixture();
  assert.equal(validPayload(payload), true);
  const inactive = payload.leagues.find(l => l.code === 'F2');
  assert.equal(inactive.collection.status, 'inactive');
  assert.equal(inactive.recording.fixtures, 0);
  payload.jobs[1] = { ...payload.jobs[1], present: false, active: null, schedule: null, configuration_matches: false, next_run_at: null };
  payload.stages.recorder.state = 'attention';
  payload.stages.recorder.next_run_at = null;
  payload.stages.recorder.reason_code = 'job_missing';
  payload.stages.reconciliation.checked = null;
  payload.stages.reconciliation.appended = null;
  payload.attention.push({ code: 'job_missing', stage: 'recorder', league_code: null, severity: 'error' });
  const { handler } = setup({ payload });
  const response = await handler(request());
  assert.equal(response.status, 200);
  const returned = await response.json();
  assert.equal(returned.stages.recorder.state, 'attention');
  assert.equal(returned.stages.recorder.records, 34);
});

test('the reported date follows London midnight and never fabricates import success', () => {
  const payload = JSON.parse(JSON.stringify(dataStatusFixture()).replaceAll('2026-11-24', '2026-07-14').replaceAll('2026-11-25', '2026-07-16'));
  payload.generated_at = '2026-07-14T23:30:00Z';
  payload.uk_date = '2026-07-15';
  payload.recent_days = [];
  payload.jobs.find(job => job.key === 'reconciliation').next_run_at = '2026-07-15T00:12:00Z';
  payload.stages.reconciliation.next_run_at = '2026-07-15T00:12:00Z';
  assert.equal(validPayload(payload), true);
  payload.uk_date = '2026-07-14';
  assert.equal(validPayload(payload), false);
  payload.generated_at = '2027-07-15T12:00:00Z';
  payload.uk_date = '2027-07-15';
  payload.current_season = '2728';
  payload.archive.import_schedule.matches_current_season = false;
  payload.archive.import_schedule.next_run_at = '2027-07-16T08:15:00Z';
  for (const job of payload.jobs) { job.next_run_at = '2027-07-16T12:00:00Z'; payload.stages[job.key].next_run_at = job.next_run_at; }
  assert.equal(validPayload(payload), true);
});
