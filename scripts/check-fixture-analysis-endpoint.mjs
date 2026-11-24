import assert from 'node:assert/strict';
import test from 'node:test';
import { createHandler, parseQuery } from '../supabase/functions/gerball-fixture-analysis/handler.mjs';

const BASE = 'https://example.test/analysis';
const payload = { status: 'ok', basis: 'stored_match_history', window: 10,
  fixture: { event_id: 'event-1' }, home: {}, away: {}, league: {}, head_to_head: {} };
const config = { supabaseUrl: 'https://database.test/', serviceRoleKey: 'server-only-secret', logger: { error() {} } };

test('requires one event and bounds recent windows to the supported choices', () => {
  assert.deepEqual(parseQuery(BASE + '?event_id=event-1'), { p_event_id: 'event-1', p_window: 10 });
  for (const window of [5, 10, 20]) assert.equal(parseQuery(BASE + '?event_id=a&window=' + window).p_window, window);
  for (const query of ['', 'event_id=', 'event_id=a&event_id=b', 'event_id=a&window=5&window=10',
    'event_id=a&window=1000', 'event_id=a&window=10.5', 'event_id=a&window=05',
    'event_id=a%22%29', 'event_id=' + 'x'.repeat(101), 'event_id=a&odds=true']) {
    assert.throws(() => parseQuery(BASE + '?' + query), query);
  }
});

test('serves only the historical projection through a fixed parameterized RPC', async () => {
  let call;
  const handler = createHandler({ ...config, fetchImpl: async (url, options) => {
    call = { url, options }; return Response.json(payload);
  } });
  const result = await handler(new Request(BASE + '?event_id=event-1'));
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), payload);
  assert.equal(call.url, 'https://database.test/rest/v1/rpc/gerball_fixture_analysis');
  assert.deepEqual(JSON.parse(call.options.body), { p_event_id: 'event-1', p_window: 10 });
  assert.equal(call.options.headers.Authorization, 'Bearer server-only-secret');
  assert.equal(result.headers.get('apikey'), null);
  assert.equal(result.headers.get('access-control-allow-origin'), '*');
  assert.match(result.headers.get('cache-control'), /max-age=60/);
});

test('preflight, invalid inputs and write methods make zero database requests', async () => {
  let calls = 0;
  const handler = createHandler({ ...config, fetchImpl: async () => { calls++; throw new Error('Unexpected'); } });
  assert.equal((await handler(new Request(BASE, { method: 'OPTIONS' }))).status, 204);
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    assert.equal((await handler(new Request(BASE + '?event_id=event-1', { method }))).status, 405);
  }
  assert.equal((await handler(new Request(BASE))).status, 400);
  assert.equal(calls, 0);
});

test('started or missing fixtures return a distinct uncached not-found response', async () => {
  const handler = createHandler({ ...config, fetchImpl: async () => Response.json({ status: 'not_found' }) });
  const result = await handler(new Request(BASE + '?event_id=event-1'));
  assert.equal(result.status, 404);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal((await result.json()).status, 'not_found');
});

test('configuration, database and mismatched-response errors never expose internals', async () => {
  assert.equal((await createHandler({ logger: config.logger })(new Request(BASE + '?event_id=event-1'))).status, 503);
  for (const fetchImpl of [
    async () => new Response('private detail server-only-secret', { status: 500 }),
    async () => { throw new Error('private detail server-only-secret'); },
    async () => Response.json({ ...payload, basis: 'odds_prediction' }),
    async () => Response.json({ ...payload, fixture: { event_id: 'another-event' } }),
    async () => Response.json({ ...payload, window: 20 }),
  ]) {
    const result = await createHandler({ ...config, fetchImpl })(new Request(BASE + '?event_id=event-1'));
    assert.equal(result.status, 502);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.doesNotMatch(await result.text(), /private|secret|another-event|odds_prediction/);
  }
});
