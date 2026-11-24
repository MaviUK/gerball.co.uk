// Public historical comparison. This endpoint never queries an odds provider.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Max-Age': '86400',
};

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS,
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': status === 200 ? 'public, max-age=60, s-maxage=60' : 'no-store',
      ...extra,
    },
  });
}

export function parseQuery(url) {
  const params = new URL(url).searchParams;
  for (const key of params.keys()) {
    if (!['event_id', 'window'].includes(key) || params.getAll(key).length !== 1) {
      throw new Error('Use event_id and window once each.');
    }
  }
  const event = params.get('event_id');
  if (!event || !/^[A-Za-z0-9_-]{1,100}$/.test(event)) throw new Error('A valid event_id is required.');
  const window = params.get('window') ?? '10';
  if (!['5', '10', '20'].includes(window)) throw new Error('window must be 5, 10 or 20.');
  return { p_event_id: event, p_window: Number(window) };
}

export function createHandler({ supabaseUrl, serviceRoleKey, fetchImpl = fetch, logger = console }) {
  return async request => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method !== 'GET') return json({ error: 'Use GET to read historical match analysis.' }, 405, { Allow: 'GET, OPTIONS' });
    let params;
    try { params = parseQuery(request.url); }
    catch (error) { return json({ error: error.message }, 400); }
    if (!supabaseUrl || !serviceRoleKey) {
      logger.error('Fixture analysis: server configuration missing.');
      return json({ error: 'Historical analysis is temporarily unavailable. Please retry shortly.' }, 503);
    }
    try {
      const result = await fetchImpl(supabaseUrl.replace(/\/$/, '') + '/rest/v1/rpc/gerball_fixture_analysis', {
        method: 'POST',
        headers: { apikey: serviceRoleKey, Authorization: 'Bearer ' + serviceRoleKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(15000),
      });
      if (!result.ok) {
        logger.error('Fixture analysis: database response ' + result.status + '.');
        return json({ error: 'Historical analysis is temporarily unavailable. Please retry shortly.' }, 502);
      }
      const payload = await result.json();
      if (payload?.status === 'not_found') {
        return json({ status: 'not_found', error: 'This fixture is no longer available for pre-match analysis. Refresh fixtures to choose another match.' }, 404);
      }
      if (payload?.status !== 'ok' || payload.basis !== 'stored_match_history' ||
          payload.fixture?.event_id !== params.p_event_id || payload.window !== params.p_window ||
          !payload.home || !payload.away || !payload.league || !payload.head_to_head) {
        throw new Error('Unexpected analysis response.');
      }
      return json(payload);
    } catch {
      logger.error('Fixture analysis: database request failed.');
      return json({ error: 'Historical analysis is temporarily unavailable. Please retry shortly.' }, 502);
    }
  };
}
