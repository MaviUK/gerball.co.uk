// Read only: this endpoint projects saved research observations. Recording and
// result reconciliation run inside Postgres, outside the public request path.
export const VERSION = 'recorded_screens_v1';
export const RULE_VERSION = 'ppg_last5_dates_050_v1';
export const EVALUATION_START = '2026-12-01';
export const LEAGUES = Object.freeze([
  'E0', 'E1', 'E2', 'E3', 'SC0', 'D1', 'D2', 'I1', 'I2',
  'SP1', 'SP2', 'F1', 'F2', 'N1', 'B1', 'P1', 'G1', 'T1',
]);
const MARKETS = ['H', 'D', 'A'];
const PHASES = ['calibration', 'post_boundary'];
const QUALIFICATIONS = ['match', 'no_match', 'insufficient_history', 'unmatched_team'];
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'apikey, content-type, x-client-info',
  'Access-Control-Max-Age': '86400',
};
const UNAVAILABLE = 'Recorded screens are temporarily unavailable. Please retry shortly.';
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const count = value => Number.isSafeInteger(value) && value >= 0;
const identifier = value => (Number.isSafeInteger(value) && value > 0) || (typeof value === 'string' && /^[1-9][0-9]*$/.test(value));
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

function date(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value + 'T00:00:00Z')) &&
    new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
}

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS,
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': status === 200 ? 'public, max-age=30, s-maxage=30' : 'no-store',
      ...extra,
    },
  });
}

export function parseQuery(url) {
  const params = new URL(url).searchParams;
  for (const key of params.keys()) {
    if (!['league', 'date'].includes(key) || params.getAll(key).length !== 1) {
      throw new Error('Use league and date once each.');
    }
  }
  const league = (params.get('league') ?? 'E0').toUpperCase();
  if (!LEAGUES.includes(league)) throw new Error('Choose a supported league.');
  const captureDate = params.get('date');
  if (captureDate !== null && !date(captureDate)) throw new Error('date must be a valid YYYY-MM-DD date.');
  return { p_league: league, p_capture_date: captureDate };
}

function validMetrics(metrics) {
  return metrics && ['fixtures', 'settled', 'matched', 'not_matched', 'pending', 'review'].every(key => count(metrics[key])) &&
    metrics.fixtures === metrics.settled + metrics.pending + metrics.review &&
    metrics.settled === metrics.matched + metrics.not_matched &&
    (metrics.settled === 0 ? metrics.match_rate_pct === null :
      typeof metrics.match_rate_pct === 'number' && Number.isFinite(metrics.match_rate_pct) &&
      Math.abs(metrics.match_rate_pct - 100 * metrics.matched / metrics.settled) < 0.011);
}

function validResult(result) {
  if (!result || !['pending', 'settled', 'review'].includes(result.status) || !count(result.revision)) return false;
  if (result.revision > 0 && !timestamp(result.recorded_at)) return false;
  if (result.status === 'settled') {
    if (!identifier(result.match_id) || !count(result.home_goals) || !count(result.away_goals) ||
      !MARKETS.includes(result.full_time_result) || !timestamp(result.imported_at) || !result.source) return false;
    const expected = result.home_goals > result.away_goals ? 'H' : result.home_goals < result.away_goals ? 'A' : 'D';
    if (result.full_time_result !== expected) return false;
  }
  return true;
}

function validRecord(record, payload) {
  if (!record || !identifier(record.id) || record.rule_version !== RULE_VERSION ||
    record.league_code !== payload.league_code || typeof record.event_id !== 'string' || !record.event_id ||
    record.capture_date !== payload.cohort?.capture_date || !timestamp(record.recorded_at) || !timestamp(record.kickoff_at) ||
    Date.parse(record.recorded_at) < Date.parse(payload.method.rule_frozen_at) ||
    Date.parse(record.recorded_at) >= Date.parse(record.kickoff_at) || !date(record.fixture_date) ||
    !date(record.cutoff_date) || record.cutoff_date > record.capture_date || record.cutoff_date >= record.fixture_date ||
    record.phase !== (record.fixture_date < EVALUATION_START ? 'calibration' : 'post_boundary') || !digest(record.input_sha256)) return false;
  for (const side of ['home', 'away']) {
    const team = record[side];
    if (!team || typeof team.provider_name !== 'string' || !team.history || !Array.isArray(team.history.dates) ||
      team.history.dates.length > 5 || team.history.dates.some(group => !date(group.date) || group.date > record.cutoff_date)) return false;
  }
  if (!MARKETS.every(market => QUALIFICATIONS.includes(record.markets?.[market]?.status) &&
    typeof record.markets[market].reason === 'string')) return false;
  if (!validResult(record.result) || !Array.isArray(record.result.history) ||
    !record.result.history.every(validResult)) return false;
  return true;
}

export function validPayload(payload, params) {
  if (!payload || payload.status !== 'ok' || payload.version !== VERSION || payload.rule_version !== RULE_VERSION ||
    payload.league_code !== params.p_league || payload.timezone !== 'Europe/London' ||
    payload.evaluation_start !== EVALUATION_START || !timestamp(payload.generated_at) ||
    payload.method?.horizon_days !== 14 || payload.method?.qualification_uses_current_odds !== false ||
    payload.method?.summary_basis !== 'first_qualifying_capture_per_event_market_version' ||
    payload.method?.identity_policy !== 'first_event_then_canonical_fixture' ||
    !timestamp(payload.method?.rule_frozen_at) || !digest(payload.method?.implementation_sha256) ||
    typeof payload.method?.source_commit !== 'string' || !/^[a-f0-9]{40}$/.test(payload.method.source_commit) ||
    !payload.coverage || !Array.isArray(payload.available_dates) || payload.available_dates.length > 90 ||
    !Array.isArray(payload.records) || payload.records.length > 1000 ||
    !MARKETS.every(market => PHASES.every(phase => validMetrics(payload.summary?.[market]?.[phase])))) return false;
  if (!payload.available_dates.every(cohort => date(cohort.capture_date) && timestamp(cohort.captured_at) && count(cohort.fixture_count))) return false;
  if (payload.cohort === null) return payload.records.length === 0;
  const cohort = payload.cohort;
  if (!cohort || !identifier(cohort.id) || !date(cohort.capture_date) || !timestamp(cohort.captured_at) ||
    !digest(cohort.input_sha256) || cohort.fixture_count !== payload.records.length ||
    (params.p_capture_date !== null && cohort.capture_date !== params.p_capture_date)) return false;
  return payload.records.every(record => validRecord(record, payload));
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
    if (request.method !== 'GET') return json({ error: 'Use GET to read recorded screens.' }, 405, { Allow: 'GET, OPTIONS' });
    let params;
    try { params = parseQuery(request.url); }
    catch (error) { return json({ error: error.message }, 400); }
    if (!supabaseUrl || !serviceRoleKey || !allowedKeys.size) {
      logger.error('Recorded screens: server configuration missing.');
      return json({ error: UNAVAILABLE }, 503);
    }
    if (!allowedKeys.has(request.headers.get('apikey'))) return json({ error: 'A valid application key is required.' }, 401);
    try {
      const headers = { apikey: serviceRoleKey, 'Content-Type': 'application/json' };
      if (!serviceRoleKey.startsWith('sb_secret_')) headers.Authorization = 'Bearer ' + serviceRoleKey;
      const result = await fetchImpl(supabaseUrl.replace(/\/$/, '') + '/rest/v1/rpc/gerball_recorded_screens', {
        method: 'POST', headers, body: JSON.stringify(params), signal: AbortSignal.timeout(15000),
      });
      if (!result.ok) {
        logger.error('Recorded screens: database response ' + result.status + '.');
        return json({ error: UNAVAILABLE }, 502);
      }
      const payload = await result.json();
      if (!validPayload(payload, params)) throw new Error('Unexpected recorded-screen response.');
      return json(payload);
    } catch {
      logger.error('Recorded screens: database request failed.');
      return json({ error: UNAVAILABLE }, 502);
    }
  };
}
