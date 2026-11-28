// Read-only operational projection. Refreshing this endpoint never starts an
// import, provider request, recording job, or result reconciliation.
export const VERSION = 'data_status_v1';
export const LEAGUES = Object.freeze(['E0', 'E1', 'E2', 'E3', 'SC0', 'SC1', 'SC2', 'SC3', 'D1', 'D2', 'I1', 'I2', 'SP1', 'SP2', 'F1', 'F2', 'N1', 'B1', 'P1', 'G1', 'T1']);
const STAGES = ['collector', 'recorder', 'reconciliation'];
const STATES = ['not_due', 'waiting', 'complete', 'attention'];
const LEAGUE_STATES = [...STATES, 'not_configured'];
const MODES = ['scheduled', 'manual', 'bootstrap', 'mixed'];
const REASONS = ['job_missing', 'job_disabled', 'job_configuration_changed', 'job_failed', 'not_due',
  'collection_complete', 'collection_running', 'collection_failed', 'collection_incomplete', 'collection_overdue',
  'recording_complete', 'waiting_for_collection', 'recording_pending', 'recording_failed', 'recording_incomplete', 'recording_overdue',
  'rule_implementation_changed', 'reconciliation_current', 'reconciliation_pending', 'reconciliation_stale', 'reconciliation_failed'];
const ISSUE_CODES = [...REASONS, 'archive_current_season_missing', 'import_target_season_mismatch', 'result_review_required'];
const JOBS = {
  collector: ['gerball-daily-odds', '0,5,10 11,12 * * *'],
  recorder: ['gerball-recorded-screens', '15,20,25 11,12 * * *'],
  reconciliation: ['gerball-recorded-screen-results', '12 * * * *'],
};
const TODAY_STATUSES = { collector: ['running', 'completed', 'partial', 'failed'], recorder: ['complete', 'partial', 'failed'], reconciliation: ['complete'] };
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'apikey, content-type, x-client-info',
  'Access-Control-Max-Age': '86400',
};
const UNAVAILABLE = 'Data status is temporarily unavailable. Please retry shortly.';
const count = value => Number.isSafeInteger(value) && value >= 0;
const text = (value, limit = 100) => typeof value === 'string' && value.length > 0 && value.length <= limit;
const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const nullable = (value, check) => value === null || check(value);
const mode = value => value === null || MODES.includes(value);

function fields(value, names) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
}

function date(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
}

function londonDay(value) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(value)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function validStage(value, key) {
  const names = ['state', 'reason_code', 'today_scheduled_at', 'deadline_at', 'next_run_at', 'last_activity_at', 'last_success_at', 'today_status', 'completed_leagues', 'expected_leagues', 'records', 'mode'];
  if (key === 'reconciliation') names.push('stale_after_minutes', 'checked', 'appended');
  if (!fields(value, names) || !STATES.includes(value.state) || !REASONS.includes(value.reason_code) ||
    !['today_scheduled_at', 'deadline_at', 'next_run_at', 'last_activity_at', 'last_success_at'].every(name => nullable(value[name], timestamp)) ||
    !nullable(value.today_status, status => TODAY_STATUSES[key].includes(status)) || !mode(value.mode) || !count(value.records)) return false;
  if (key === 'reconciliation') return value.completed_leagues === null && value.expected_leagues === null &&
    value.stale_after_minutes === 90 && nullable(value.checked, count) && nullable(value.appended, count);
  return count(value.completed_leagues) && value.expected_leagues === 18 && value.completed_leagues <= value.expected_leagues;
}

function validJob(value) {
  return fields(value, ['key', 'name', 'present', 'active', 'schedule', 'expected_schedule', 'configuration_matches', 'next_run_at', 'last_run']) &&
    STAGES.includes(value.key) && value.name === JOBS[value.key][0] && value.expected_schedule === JOBS[value.key][1] &&
    typeof value.present === 'boolean' && (value.present ? typeof value.active === 'boolean' : value.active === null) &&
    nullable(value.schedule, item => text(item, 80)) && text(value.expected_schedule, 80) && typeof value.configuration_matches === 'boolean' &&
    nullable(value.next_run_at, timestamp) && (value.last_run === null || (
      fields(value.last_run, ['status', 'started_at', 'finished_at']) && ['starting', 'running', 'succeeded', 'failed', 'unknown'].includes(value.last_run.status) &&
      timestamp(value.last_run.started_at) && nullable(value.last_run.finished_at, timestamp))) &&
    (value.present || (value.schedule === null && value.last_run === null && value.next_run_at === null && value.configuration_matches === false)) &&
    (!value.configuration_matches || value.schedule === value.expected_schedule);
}

function validLeague(value) {
  if (!fields(value, ['code', 'name', 'country', 'odds_feed', 'archive', 'collection', 'recording', 'results']) || !LEAGUES.includes(value.code) ||
    !text(value.name) || !text(value.country) || typeof value.odds_feed !== 'boolean' ||
    value.odds_feed === ['SC1', 'SC2', 'SC3'].includes(value.code)) return false;
  const a = value.archive, c = value.collection, r = value.recording, results = value.results;
  if (!fields(a, ['matches', 'scored_matches', 'seasons', 'current_season_matches', 'current_season_last_match_date', 'first_match_date', 'last_match_date']) ||
    !['matches', 'scored_matches', 'seasons', 'current_season_matches'].every(key => count(a[key])) ||
    a.scored_matches > a.matches || a.current_season_matches > a.matches ||
    !['current_season_last_match_date', 'first_match_date', 'last_match_date'].every(key => nullable(a[key], date))) return false;
  if (!fields(c, ['state', 'status', 'collection_date', 'checked_at', 'fixtures', 'records', 'manual']) ||
    !LEAGUE_STATES.includes(c.state) || !nullable(c.status, status => ['completed', 'inactive', 'failed', 'not_supported'].includes(status)) || !nullable(c.collection_date, date) ||
    !nullable(c.checked_at, timestamp) || !nullable(c.fixtures, count) || !nullable(c.records, count) || !nullable(c.manual, item => typeof item === 'boolean')) return false;
  if (!fields(r, ['state', 'status', 'capture_date', 'captured_at', 'fixtures', 'mode']) ||
    !LEAGUE_STATES.includes(r.state) || !nullable(r.status, status => ['recorded', 'waiting_for_collection', 'pending_capture', 'error', 'implementation_changed', 'not_supported'].includes(status)) || !nullable(r.capture_date, date) ||
    !nullable(r.captured_at, timestamp) || !nullable(r.fixtures, count) || !mode(r.mode)) return false;
  if (!value.odds_feed && (c.state !== 'not_configured' || r.state !== 'not_configured')) return false;
  return fields(results, ['basis', 'observations', 'settled', 'pending', 'review', 'last_result_at']) && results.basis === 'recorded_observations' &&
    ['observations', 'settled', 'pending', 'review'].every(key => count(results[key])) &&
    results.observations === results.settled + results.pending + results.review && nullable(results.last_result_at, timestamp);
}

function validDay(value) {
  if (!fields(value, ['date', 'collection', 'recording']) || !date(value.date)) return false;
  const c = value.collection, r = value.recording;
  return fields(c, ['status', 'completed_leagues', 'expected_leagues', 'records', 'manual', 'last_activity_at']) && nullable(c.status, status => ['running', 'completed', 'partial', 'failed'].includes(status)) &&
    count(c.completed_leagues) && count(c.expected_leagues) && c.completed_leagues <= c.expected_leagues && c.expected_leagues <= 18 &&
    count(c.records) && nullable(c.manual, item => typeof item === 'boolean') && nullable(c.last_activity_at, timestamp) &&
    fields(r, ['completed_leagues', 'fixtures', 'mode', 'last_activity_at']) && count(r.completed_leagues) && r.completed_leagues <= 18 &&
    count(r.fixtures) && mode(r.mode) && nullable(r.last_activity_at, timestamp);
}

export function validPayload(value) {
  if (!fields(value, ['status', 'version', 'generated_at', 'timezone', 'uk_date', 'current_season', 'archive', 'stages', 'jobs', 'leagues', 'recent_days', 'attention']) ||
    value.status !== 'ok' || value.version !== VERSION || value.timezone !== 'Europe/London' || !timestamp(value.generated_at) ||
    !date(value.uk_date) || value.uk_date !== londonDay(value.generated_at) || !/^\d{4}$/.test(value.current_season)) return false;
  const a = value.archive, schedule = a?.import_schedule;
  if (!fields(a, ['total_matches', 'scored_matches', 'current_season_matches', 'current_season_leagues', 'league_count', 'first_match_date', 'last_match_date', 'import_schedule']) ||
    !['total_matches', 'scored_matches', 'current_season_matches', 'current_season_leagues'].every(key => count(a[key])) || a.league_count !== 21 ||
    a.scored_matches > a.total_matches || a.current_season_matches > a.total_matches || a.current_season_leagues > 21 ||
    !nullable(a.first_match_date, date) || !nullable(a.last_match_date, date) ||
    !fields(schedule, ['cron', 'timezone', 'next_run_at', 'source', 'run_audit_available', 'last_successful_run_at', 'target_season', 'matches_current_season']) ||
    schedule.cron !== '15 8 * * 1,5' || schedule.timezone !== 'UTC' || !timestamp(schedule.next_run_at) ||
    schedule.source !== 'repository_declared' || schedule.run_audit_available !== false || schedule.last_successful_run_at !== null ||
    schedule.target_season !== '2627' || typeof schedule.matches_current_season !== 'boolean' ||
    schedule.matches_current_season !== (schedule.target_season === value.current_season)) return false;
  if (!fields(value.stages, STAGES) || !STAGES.every(key => validStage(value.stages[key], key)) ||
    !Array.isArray(value.jobs) || value.jobs.length !== 3 || !value.jobs.every(validJob) || new Set(value.jobs.map(job => job.key)).size !== 3 ||
    !Array.isArray(value.leagues) || value.leagues.length !== 21 || !value.leagues.every(validLeague) || new Set(value.leagues.map(league => league.code)).size !== 21 ||
    !Array.isArray(value.recent_days) || value.recent_days.length > 7 || !value.recent_days.every(validDay) ||
    new Set(value.recent_days.map(day => day.date)).size !== value.recent_days.length || value.recent_days.some(day => day.date > value.uk_date) ||
    !Array.isArray(value.attention) || value.attention.length > 100 || !value.attention.every(issue =>
      fields(issue, ['code', 'stage', 'league_code', 'severity']) && ISSUE_CODES.includes(issue.code) && ['archive', ...STAGES].includes(issue.stage) &&
      (issue.league_code === null || LEAGUES.includes(issue.league_code)) && ['warning', 'error'].includes(issue.severity))) return false;
  const asOf = Date.parse(value.generated_at);
  const recentStart = new Date(value.uk_date + 'T12:00:00Z');
  recentStart.setUTCDate(recentStart.getUTCDate() - 6);
  const historicalTimes = [
    ...Object.values(value.stages).flatMap(stage => [stage.last_activity_at, stage.last_success_at]),
    ...value.jobs.flatMap(job => job.last_run ? [job.last_run.started_at, job.last_run.finished_at] : []),
    ...value.leagues.flatMap(league => [league.collection.checked_at, league.recording.captured_at, league.results.last_result_at]),
    ...value.recent_days.flatMap(day => [day.collection.last_activity_at, day.recording.last_activity_at]),
  ];
  if (historicalTimes.some(time => time !== null && Date.parse(time) > asOf) || Date.parse(schedule.next_run_at) <= asOf ||
    value.jobs.some(job => job.next_run_at !== null && Date.parse(job.next_run_at) <= asOf) ||
    value.jobs.some(job => (!job.present || !job.active || !job.configuration_matches) && value.stages[job.key].state !== 'attention') ||
    value.jobs.some(job => job.next_run_at !== value.stages[job.key].next_run_at) ||
    value.recent_days.some(day => day.date < recentStart.toISOString().slice(0, 10))) return false;
  return value.leagues.reduce((total, league) => total + league.archive.matches, 0) === a.total_matches &&
    value.leagues.reduce((total, league) => total + league.archive.scored_matches, 0) === a.scored_matches &&
    value.leagues.reduce((total, league) => total + league.archive.current_season_matches, 0) === a.current_season_matches &&
    value.leagues.filter(league => league.archive.current_season_matches > 0).length === a.current_season_leagues &&
    value.leagues.filter(league => league.collection.state === 'complete').length === value.stages.collector.completed_leagues &&
    value.leagues.filter(league => league.recording.status === 'recorded').length === value.stages.recorder.completed_leagues &&
    value.leagues.reduce((total, league) => total + (league.collection.records || 0), 0) === value.stages.collector.records &&
    value.leagues.reduce((total, league) => total + (league.recording.fixtures || 0), 0) === value.stages.recorder.records &&
    value.leagues.reduce((total, league) => total + league.results.observations, 0) === value.stages.reconciliation.records;
}

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: {
    ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff',
    'Cache-Control': status === 200 ? 'public, max-age=30, s-maxage=30' : 'no-store', Vary: 'apikey', ...extra,
  } });
}

export function environmentKeys(raw) {
  try { const value = JSON.parse(raw || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
  catch { return {}; }
}

export function createHandler({ supabaseUrl, serviceRoleKey, publicKeys = [], fetchImpl = fetch, logger = console }) {
  const allowedKeys = new Set(publicKeys.filter(key => typeof key === 'string' && key.startsWith('sb_publishable_')));
  return async request => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method !== 'GET') return json({ error: 'Use GET to read data status.' }, 405, { Allow: 'GET, OPTIONS' });
    if ([...new URL(request.url).searchParams].length) return json({ error: 'Data status does not accept query parameters.' }, 400);
    if (!supabaseUrl || !serviceRoleKey || !allowedKeys.size) {
      logger.error('Data status: server configuration missing.'); return json({ error: UNAVAILABLE }, 503);
    }
    if (!allowedKeys.has(request.headers.get('apikey'))) return json({ error: 'A valid application key is required.' }, 401);
    try {
      const headers = { apikey: serviceRoleKey, 'Content-Type': 'application/json' };
      if (!serviceRoleKey.startsWith('sb_secret_')) headers.Authorization = 'Bearer ' + serviceRoleKey;
      const result = await fetchImpl(supabaseUrl.replace(/\/$/, '') + '/rest/v1/rpc/gerball_data_status', {
        method: 'POST', headers, body: '{}', signal: AbortSignal.timeout(15000),
      });
      if (!result.ok) { logger.error('Data status: database response ' + result.status + '.'); return json({ error: UNAVAILABLE }, 502); }
      const payload = await result.json();
      if (!validPayload(payload)) throw new Error('Unexpected data status response.');
      return json(payload);
    } catch {
      logger.error('Data status: database request failed.'); return json({ error: UNAVAILABLE }, 502);
    }
  };
}
