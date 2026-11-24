import assert from 'node:assert/strict';
import test from 'node:test';
import { createHandler, parseQuery } from '../supabase/functions/gerball-upcoming-fixtures/handler.mjs';

const BASE = 'https://example.test/upcoming';
const fixturePayload = { collection_status: 'completed', fixtures: [{ event_id: 'abc' }] };
const silent = { error() {} };

test('validates bounded, parameterized list and detail queries', () => {
  assert.deepEqual(parseQuery(BASE), { p_days: 14, p_league: null, p_event_id: null });
  assert.deepEqual(parseQuery(BASE + '?days=31&league=e0&event_id=event-1'), {
    p_days: 31, p_league: 'E0', p_event_id: 'event-1',
  });
  for (const query of ['days=0', 'days=32', 'days=1.5', 'days=-1', 'days=14&days=14',
    'league=unknown', 'event_id=a%22%29', 'secret=true']) {
    assert.throws(() => parseQuery(BASE + '?' + query), query);
  }
});

test('public GET exposes only the RPC projection and uses server credentials upstream', async () => {
  let call;
  const handler = createHandler({
    supabaseUrl: 'https://database.test/', serviceRoleKey: 'server-secret', logger: silent,
    fetchImpl: async (url, options) => { call = { url, options }; return Response.json(fixturePayload); },
  });
  const result = await handler(new Request(BASE + '?event_id=abc'));
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('access-control-allow-origin'), '*');
  assert.match(result.headers.get('cache-control'), /max-age=60/);
  assert.deepEqual(await result.json(), fixturePayload);
  assert.equal(call.url, 'https://database.test/rest/v1/rpc/gerball_upcoming_data');
  assert.equal(call.options.headers.Authorization, 'Bearer server-secret');
  assert.equal(JSON.parse(call.options.body).p_event_id, 'abc');
  assert.equal(result.headers.get('apikey'), null);
});

test('preflight, unsupported methods and malformed queries never query the database', async () => {
  let calls = 0;
  const handler = createHandler({ supabaseUrl: 'https://database.test', serviceRoleKey: 'key',
    logger: silent, fetchImpl: async () => { calls++; throw new Error('unexpected'); } });
  assert.equal((await handler(new Request(BASE, { method: 'OPTIONS' }))).status, 204);
  assert.equal((await handler(new Request(BASE, { method: 'POST' }))).status, 405);
  assert.equal((await handler(new Request(BASE + '?days=100'))).status, 400);
  assert.equal(calls, 0);
});

test('missing configuration and database failures produce safe, uncached errors', async () => {
  const missing = createHandler({ logger: silent });
  assert.equal((await missing(new Request(BASE))).status, 503);
  for (const fetchImpl of [
    async () => new Response('private database detail', { status: 500 }),
    async () => Response.json({ secret: 'private database detail' }),
    async () => { throw new Error('private database detail'); },
  ]) {
    const handler = createHandler({ supabaseUrl: 'https://database.test', serviceRoleKey: 'key', logger: silent, fetchImpl });
    const result = await handler(new Request(BASE));
    assert.equal(result.status, 502);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.doesNotMatch(await result.text(), /private|secret|key/);
  }
});
