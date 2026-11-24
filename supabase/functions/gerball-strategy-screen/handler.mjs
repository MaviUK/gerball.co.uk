// A bounded, read-only research projection. Provider APIs and the prediction
// ledger are not part of this request path. The handler verifies the public
// application's key; this is not individual user authentication.
export const VERSION = 'ppg_last5_dates_050_v1';
export const LEAGUES = Object.freeze([
  'E0', 'E1', 'E2', 'E3', 'SC0', 'D1', 'D2', 'I1', 'I2',
  'SP1', 'SP2', 'F1', 'F2', 'N1', 'B1', 'P1', 'G1', 'T1',
]);
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Max-Age': '86400',
};
const UNAVAILABLE = 'Historical screening is temporarily unavailable. Please retry shortly.';

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
    if (!['league', 'days'].includes(key) || params.getAll(key).length !== 1) {
      throw new Error('Use league and days once each.');
    }
  }
  const league = (params.get('league') ?? 'E0').toUpperCase();
  if (!LEAGUES.includes(league)) throw new Error('Choose a supported league.');
  const days = params.get('days') ?? '14';
  if (!/^(?:[1-9]|[12][0-9]|3[01])$/.test(days)) {
    throw new Error('days must be a whole number from 1 to 31.');
  }
  return { p_league: league, p_days: Number(days) };
}

export function validPayload(payload, params) {
  return Boolean(payload && payload.status === 'ok' && payload.version === VERSION &&
    payload.basis === 'stored_match_history' && payload.league_code === params.p_league &&
    payload.days === params.p_days && payload.timezone === 'Europe/London' &&
    typeof payload.generated_at === 'string' && Number.isFinite(Date.parse(payload.generated_at)) &&
    Array.isArray(payload.fixtures) && payload.rules?.qualification_uses_current_odds === false &&
    payload.rules?.prior_match_dates === 5 && payload.rules?.minimum_prior_games === 5 &&
    payload.rules?.ppg_threshold === 0.5 && payload.rules?.ppg_decimal_places === 3 &&
    payload.rules?.venue_scope === 'all' && payload.rules?.season_scope === 'same_league_across_seasons' &&
    Array.isArray(payload.rules?.markets) && payload.rules.markets.join(',') === 'H,D,A' &&
    payload.backtest?.from === '2023-08-01' && payload.backtest?.to === '2026-06-30' &&
    ['H', 'D', 'A'].every(market => payload.backtest?.markets?.[market]?.full &&
      payload.backtest.markets[market].holdout && Array.isArray(payload.backtest.markets[market].seasons)));
}

export function environmentKeys(raw) {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

export function createHandler({ supabaseUrl, serviceRoleKey, publicKeys = [], fetchImpl = fetch, logger = console }) {
  const allowedKeys = new Set(publicKeys.filter(key => typeof key === 'string' && key.startsWith('sb_publishable_')));
  return async request => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method !== 'GET') return json({ error: 'Use GET to read historical strategy screening.' }, 405, { Allow: 'GET, OPTIONS' });
    let params;
    try { params = parseQuery(request.url); }
    catch (error) { return json({ error: error.message }, 400); }
    if (!supabaseUrl || !serviceRoleKey || !allowedKeys.size) {
      logger.error('Strategy screen: server configuration missing.');
      return json({ error: UNAVAILABLE }, 503);
    }
    if (!allowedKeys.has(request.headers.get('apikey'))) {
      return json({ error: 'A valid application key is required.' }, 401);
    }
    try {
      const headers = { apikey: serviceRoleKey, 'Content-Type': 'application/json' };
      if (!serviceRoleKey.startsWith('sb_secret_')) headers.Authorization = 'Bearer ' + serviceRoleKey;
      const result = await fetchImpl(supabaseUrl.replace(/\/$/, '') + '/rest/v1/rpc/gerball_strategy_screen', {
        method: 'POST',
        headers,
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(15000),
      });
      if (!result.ok) {
        logger.error('Strategy screen: database response ' + result.status + '.');
        return json({ error: UNAVAILABLE }, 502);
      }
      const payload = await result.json();
      if (!validPayload(payload, params)) throw new Error('Unexpected screening response.');
      return json(payload);
    } catch {
      logger.error('Strategy screen: database request failed.');
      return json({ error: UNAVAILABLE }, 502);
    }
  };
}
