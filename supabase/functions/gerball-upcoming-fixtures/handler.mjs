// Public, read-only projection of already collected odds. No provider requests.
const LEAGUES = new Set([
  'E0', 'E1', 'E2', 'E3', 'SC0', 'D1', 'D2', 'I1', 'I2',
  'SP1', 'SP2', 'F1', 'F2', 'N1', 'B1', 'P1', 'G1', 'T1',
]);
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Max-Age': '86400',
};

function response(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS,
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': status === 200
        ? 'public, max-age=60, s-maxage=60, stale-while-revalidate=30'
        : 'no-store',
      ...extra,
    },
  });
}

export function parseQuery(url) {
  const params = new URL(url).searchParams;
  for (const key of params.keys()) {
    if (!['days', 'league', 'event_id'].includes(key) || params.getAll(key).length !== 1) {
      throw new Error('Use only days, league and event_id once each.');
    }
  }
  const rawDays = params.get('days') ?? '14';
  if (!/^\d{1,2}$/.test(rawDays) || Number(rawDays) < 1 || Number(rawDays) > 31) {
    throw new Error('days must be a whole number from 1 to 31.');
  }
  const league = params.get('league')?.toUpperCase() || null;
  if (league && !LEAGUES.has(league)) throw new Error('Choose a supported league.');
  const eventId = params.get('event_id') || null;
  if (eventId && !/^[A-Za-z0-9_-]{1,100}$/.test(eventId)) {
    throw new Error('event_id is invalid.');
  }
  return { p_days: Number(rawDays), p_league: league, p_event_id: eventId };
}

export function createHandler({ supabaseUrl, serviceRoleKey, fetchImpl = fetch, logger = console }) {
  return async function handler(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (request.method !== 'GET') {
      return response({ error: 'Use GET to read upcoming fixtures.' }, 405, { Allow: 'GET, OPTIONS' });
    }
    let query;
    try {
      query = parseQuery(request.url);
    } catch (error) {
      return response({ error: error.message }, 400);
    }
    if (!supabaseUrl || !serviceRoleKey) {
      logger.error('Upcoming fixtures: server configuration missing.');
      return response({ error: 'Fixture data is temporarily unavailable. Please retry shortly.' }, 503);
    }
    try {
      const upstream = await fetchImpl(
        supabaseUrl.replace(/\/$/, '') + '/rest/v1/rpc/gerball_upcoming_data',
        {
          method: 'POST',
          headers: {
            apikey: serviceRoleKey,
            Authorization: 'Bearer ' + serviceRoleKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(query),
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!upstream.ok) {
        logger.error('Upcoming fixtures: database response ' + upstream.status + '.');
        return response({ error: 'Fixture data is temporarily unavailable. Please retry shortly.' }, 502);
      }
      const payload = await upstream.json();
      if (!payload || typeof payload !== 'object' || !Array.isArray(payload.fixtures)) {
        throw new Error('Invalid database response.');
      }
      return response(payload);
    } catch {
      logger.error('Upcoming fixtures: database request failed.');
      return response({ error: 'Fixture data is temporarily unavailable. Please retry shortly.' }, 502);
    }
  };
}
