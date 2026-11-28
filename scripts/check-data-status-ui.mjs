import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../assets/data-status.js', import.meta.url), 'utf8');
const pure = vm.createContext({ Intl, Date, URL, AbortController });
vm.runInContext(source, pure);
const helpers = pure.GerballDataStatus.helpers;
const instant = Date.parse('2026-11-24T22:40:00Z');
const LEAGUES = [
  ['E0', 'Premier League', 'England'], ['E1', 'Championship', 'England'], ['E2', 'League One', 'England'], ['E3', 'League Two', 'England'],
  ['SC0', 'Premiership', 'Scotland'], ['SC1', 'Championship', 'Scotland'], ['SC2', 'League One', 'Scotland'], ['SC3', 'League Two', 'Scotland'],
  ['D1', 'Bundesliga', 'Germany'], ['D2', '2. Bundesliga', 'Germany'], ['I1', 'Serie A', 'Italy'], ['I2', 'Serie B', 'Italy'],
  ['SP1', 'La Liga', 'Spain'], ['SP2', 'Segunda División', 'Spain'], ['F1', 'Ligue 1', 'France'], ['F2', 'Ligue 2', 'France'],
  ['N1', 'Eredivisie', 'Netherlands'], ['B1', 'Pro League', 'Belgium'], ['P1', 'Primeira Liga', 'Portugal'], ['G1', 'Super League', 'Greece'], ['T1', 'Süper Lig', 'Turkey'],
];
function league([code, name, country]) {
  const feed = !['SC1', 'SC2', 'SC3'].includes(code), inactive = code === 'F2';
  return { code, name, country, odds_feed: feed,
    archive: { matches: 100, scored_matches: 100, seasons: 3, current_season_matches: 10, current_season_last_match_date: code === 'P1' ? '2026-11-08' : '2026-11-22', first_match_date: '2023-08-01', last_match_date: '2026-11-22' },
    collection: { state: feed ? 'complete' : 'not_configured', status: !feed ? 'not_supported' : inactive ? 'inactive' : 'completed', collection_date: feed ? '2026-11-24' : null, checked_at: feed ? '2026-11-24T12:00:02Z' : null, fixtures: feed && !inactive ? 10 : 0, records: feed && !inactive ? 100 : 0, manual: false },
    recording: { state: feed ? 'complete' : 'not_configured', status: feed ? 'recorded' : 'not_supported', capture_date: feed ? '2026-11-24' : null, captured_at: feed ? '2026-11-24T12:15:02Z' : null, fixtures: feed && !inactive ? 10 : 0, mode: feed ? 'scheduled' : null },
    results: { basis: 'recorded_observations', observations: feed && !inactive ? 10 : 0, settled: 0, pending: feed && !inactive ? 10 : 0, review: 0, last_result_at: null } };
}
function stage(key) {
  const recorder = key === 'recorder', reconciliation = key === 'reconciliation';
  return { state: 'complete', reason_code: reconciliation ? 'reconciliation_current' : recorder ? 'recording_complete' : 'collection_complete',
    today_scheduled_at: `2026-11-24T${reconciliation ? '00:30' : recorder ? '12:15' : '12:00'}:00Z`, deadline_at: `2026-11-24T${reconciliation ? '00:35' : recorder ? '12:30' : '12:15'}:00Z`,
    next_run_at: reconciliation ? '2026-11-24T23:12:00Z' : `2026-11-25T${recorder ? '12:15' : '12:00'}:00Z`, last_activity_at: reconciliation ? '2026-11-24T22:12:00Z' : recorder ? '2026-11-24T12:15:02Z' : '2026-11-24T12:00:02Z',
    last_success_at: reconciliation ? '2026-11-24T22:12:00Z' : recorder ? '2026-11-24T12:15:02Z' : '2026-11-24T12:00:02Z', today_status: 'completed', completed_leagues: reconciliation ? null : 18,
    expected_leagues: reconciliation ? null : 18, records: reconciliation ? null : recorder ? 170 : 1700, mode: 'scheduled', ...(reconciliation ? { stale_after_minutes: 90, checked: 170, appended: 0 } : {}) };
}
function payload() {
  return { status: 'ok', version: 'data_status_v1', generated_at: new Date(instant).toISOString(), timezone: 'Europe/London', uk_date: '2026-11-24', current_season: '2627',
    archive: { total_matches: 2100, scored_matches: 2100, current_season_matches: 210, current_season_leagues: 21, league_count: 21, first_match_date: '2023-08-01', last_match_date: '2026-11-22',
      import_schedule: { cron: '15 8 * * 1,5', timezone: 'UTC', next_run_at: '2026-11-27T08:15:00Z', source: 'repository_declared', target_season: '2627', matches_current_season: true, run_audit_available: false, last_successful_run_at: null } },
    stages: Object.fromEntries(['collector', 'recorder', 'reconciliation'].map(key => [key, stage(key)])),
    jobs: ['collector', 'recorder', 'reconciliation'].map(key => ({ key, name: key, present: true, active: true, schedule: key === 'reconciliation' ? '12 * * * *' : key === 'recorder' ? '15,20,25 11,12 * * *' : '0,5,10 11,12 * * *', expected_schedule: '', configuration_matches: true, next_run_at: stage(key).next_run_at, last_run: { status: 'succeeded', started_at: stage(key).last_activity_at, finished_at: stage(key).last_activity_at } })),
    leagues: LEAGUES.map(league),
    recent_days: [
      { date: '2026-11-24', collection: { status: 'completed', completed_leagues: 18, expected_leagues: 18, records: 1700, manual: true, last_activity_at: '2026-11-24T12:00:02Z' }, recording: { completed_leagues: 18, fixtures: 170, mode: 'bootstrap', last_activity_at: '2026-11-24T12:15:02Z' } },
      { date: '2026-11-23', collection: { status: 'completed', completed_leagues: 18, expected_leagues: 18, records: 0, manual: false, last_activity_at: '2026-11-23T12:00:02Z' }, recording: { completed_leagues: 18, fixtures: 0, mode: 'scheduled', last_activity_at: '2026-11-23T12:15:02Z' } },
      { date: '2026-11-22', collection: { status: null, completed_leagues: 0, expected_leagues: 18, records: 0, manual: false, last_activity_at: null }, recording: { completed_leagues: 0, fixtures: 0, mode: null, last_activity_at: null } },
    ], attention: [] };
}

test('the contract accepts supported gaps and rejects partial or unrelated projections', () => {
  assert.equal(helpers.validPayload(payload()), true);
  const missing = payload(); Object.assign(missing.jobs[0], { present: false, active: null, schedule: null, configuration_matches: false, next_run_at: null, last_run: null }); assert.equal(helpers.validPayload(missing), true);
  const unknown = payload(); unknown.jobs[0].active = null; assert.equal(helpers.validPayload(unknown), false);
  assert.equal(helpers.validPayload({ ...payload(), version: 'something_else' }), false);
  assert.equal(helpers.validPayload({ ...payload(), leagues: payload().leagues.slice(1) }), false);
  const duplicate = payload(); duplicate.leagues[1] = duplicate.leagues[0]; assert.equal(helpers.validPayload(duplicate), false);
  const wrongBasis = payload(); wrongBasis.leagues[0].results.basis = 'bets'; assert.equal(helpers.validPayload(wrongBasis), false);
  const fakeAudit = payload(); fakeAudit.archive.import_schedule.run_audit_available = true; assert.equal(helpers.validPayload(fakeAudit), false);
});

test('attention filtering respects server states without treating old dates or pending outcomes as failure', () => {
  const data = payload();
  assert.equal(helpers.filterLeagues(data.leagues, 'feed', '', data.attention).length, 18);
  assert.equal(helpers.filterLeagues(data.leagues, 'no_feed', '', data.attention).length, 3);
  assert.equal(helpers.filterLeagues(data.leagues, 'attention', '', data.attention).length, 0, 'Older Portuguese stored date and pending future observations are not inferred failures');
  data.leagues[0].results.review = 1; data.leagues[1].collection.state = 'attention';
  assert.equal(helpers.filterLeagues(data.leagues, 'attention', '', data.attention).length, 2);
  assert.equal(helpers.filterLeagues(data.leagues, 'all', 'super turkey', data.attention)[0].code, 'T1');
  assert.equal(data.leagues.length, 21);
});

test('UK timestamps convert the declared UTC import cadence across GMT and BST', () => {
  assert.match(helpers.stampLabel('2026-11-27T08:15:00Z'), /08:15 UK/);
  assert.match(helpers.stampLabel('2027-07-02T08:15:00Z'), /09:15 UK/);
  assert.equal(helpers.londonDay('2027-07-01T23:01:00Z'), '2027-07-02');
  assert.equal(helpers.dateValue('2026-02-31'), false);
  assert.equal(helpers.dateLabel(null), 'No stored date');
  assert.equal(helpers.stateLabel('complete', 'reconciliation'), 'Recent check complete');
  assert.equal(helpers.modeLabel('mixed'), 'Mixed run modes');
});

test('coverage CSV retains stored dates, raw statuses and schedule evidence without claiming import success', () => {
  const data = payload(); data.leagues[0].name = '=HYPERLINK("untrusted")';
  const csv = helpers.csvForCoverage(data, [data.leagues[0]], 'all');
  assert.match(csv, /current_season_last_stored_match_date/); assert.match(csv, /import_run_audit_available/); assert.match(csv, /"repository_declared"/);
  assert.match(csv, /"collector_job_cron","recorder_job_cron","reconciliation_job_cron"/); assert.match(csv, /"12 \* \* \* \*"/);
  assert.match(csv, /"'=HYPERLINK\(""untrusted""\)"/); assert.match(csv, /"recorded_observations"/);
  assert.doesNotMatch(csv, /last_successful_import|last_successful_run_at/); assert.equal(csv.split('\r\n').length, 2);
  assert.equal(helpers.csvCell(' +SUM(1,1)'), '"\' +SUM(1,1)"'); assert.equal(helpers.csvCell(0), '"0"');
});

test('all reason codes have plain language descriptions', () => {
  for (const code of ['job_missing', 'job_disabled', 'job_configuration_changed', 'job_failed', 'not_due', 'collection_complete', 'collection_running', 'collection_failed', 'collection_incomplete', 'collection_overdue', 'recording_complete', 'waiting_for_collection', 'recording_pending', 'recording_failed', 'recording_incomplete', 'recording_overdue', 'rule_implementation_changed', 'reconciliation_current', 'reconciliation_pending', 'reconciliation_stale', 'reconciliation_failed', 'archive_current_season_missing', 'import_target_season_mismatch', 'result_review_required']) assert.doesNotMatch(helpers.reasonLabel(code), /_/);
});

class Element {
  constructor(tag, document) { this.tagName = tag.toUpperCase(); this.document = document; this.children = []; this.parentElement = null; this.listeners = new Map(); this.attributes = new Map(); this.dataset = {}; this.style = {}; this.value = ''; this.text = ''; this.hidden = false; this.disabled = false; const classes = new Set(); this.classList = { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) }; }
  set textContent(value) { this.text = String(value); this.replaceChildren(); }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(' '); }
  appendChild(child) { if (child.parentElement) child.parentElement.children = child.parentElement.children.filter(item => item !== child); child.parentElement = this; this.children.push(child); return child; }
  append(...children) { children.forEach(child => this.appendChild(child)); }
  replaceChildren(...children) { this.children.forEach(child => { child.parentElement = null; }); this.children = []; this.append(...children); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(item => item !== this); this.parentElement = null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(name, listener) { if (!this.listeners.has(name)) this.listeners.set(name, []); this.listeners.get(name).push(listener); }
  dispatch(name) { for (const listener of this.listeners.get(name) || []) listener({ target: this, preventDefault() {} }); }
  click() { this.dispatch('click'); }
  focus(options) { this.document.activeElement = this; this.focusOptions = options; }
  scrollIntoView(options) { this.scrollOptions = options; }
}
function dom() { const document = {}; document.createElement = tag => new Element(tag, document); document.body = document.createElement('body'); document.activeElement = document.body; document.all = () => { const output = []; const walk = node => { output.push(node); node.children.forEach(walk); }; walk(document.body); return output; }; document.getElementById = id => document.all().find(node => node.id === id) || null; return document; }
function app(fetchImpl) {
  const document = dom(), clock = { now: instant }; let opens = 0; class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [clock.now])); } static now() { return clock.now; } }
  const context = vm.createContext({ document, Intl, Date: ClockDate, URL, Blob, AbortController, fetch: fetchImpl, location: { href: 'https://gerball.co.uk/#data' }, setTimeout: () => 1, clearTimeout() {} });
  vm.runInContext(source, context); const container = document.createElement('div'), overviewContainer = document.createElement('div'); document.body.append(container, overviewContainer);
  const api = context.GerballDataStatus.init({ container, overviewContainer, endpoint: 'https://example.test/status', apiKey: 'public-browser-key', onOpenData() { opens++; } }); return { api, document, container, overviewContainer, clock, opens: () => opens };
}
const leagueCards = document => document.all().filter(node => node.className === 'card ds-league');
const stageCards = document => document.all().filter(node => node.className === 'card ds-stage');

test('overview and full status render from one read-only request with safe text', async () => {
  const calls = [], data = payload(); data.leagues[0].name = 'Premier <script>alert(1)</script>';
  const value = app(async (url, options) => { calls.push({ url, options }); return Response.json(data); }); await value.api.activate();
  assert.equal(calls.length, 1); assert.equal(calls[0].options.method, 'GET'); assert.equal(calls[0].options.headers.apikey, 'public-browser-key'); assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.equal(stageCards(value.document).length, 4); assert.equal(leagueCards(value.document).length, 21); assert.match(value.container.textContent, /Premier <script>alert\(1\)<\/script>/); assert.equal(value.document.all().filter(node => node.tagName === 'SCRIPT').length, 0);
  assert.match(value.overviewContainer.textContent, /Recent check complete/); assert.match(value.overviewContainer.textContent, /2,100 results stored/);
  assert.match(value.container.textContent, /successful import-run history is not recorded/); assert.match(value.container.textContent, /Monday and Friday at 08:15 UTC/);
  assert.match(value.container.textContent, /including daily repeats/); assert.match(value.container.textContent, /Last successful collection/); assert.doesNotMatch(value.container.textContent, /Last successful import/);
  assert.doesNotMatch(value.container.textContent, /Configured cron|12 \* \* \* \*/);
  value.document.all().find(node => node.className === 'secondary ds-jump').click();
  assert.equal(value.document.activeElement.id, 'dataStatusFilter'); assert.equal(value.document.activeElement.focusOptions.preventScroll, true);
  assert.equal(value.document.getElementById('dataStatusCoverage').scrollOptions.block, 'start');
  value.document.all().find(node => node.className === 'secondary ds-open').click(); assert.equal(value.opens(), 1);
});

test('inactive feeds, saved empty captures and unsupported leagues remain distinct', async () => {
  const value = app(async () => Response.json(payload())); await value.api.activate();
  const inactive = leagueCards(value.document).find(node => node.textContent.includes('France · F2')); assert.match(inactive.textContent, /Inactive feed/); assert.match(inactive.textContent, /Saved empty capture/); assert.doesNotMatch(inactive.textContent, /Needs attention|failed/);
  const noFeed = leagueCards(value.document).find(node => node.textContent.includes('Scotland · SC1')); assert.match(noFeed.textContent, /No configured odds feed/); assert.match(noFeed.textContent, /No scheduled capture/); assert.match(noFeed.textContent, /100 results/); assert.doesNotMatch(noFeed.textContent, /Needs attention|failed/);
});

test('expected-before-deadline data stays not due rather than becoming an error', async () => {
  const data = payload(); for (const key of ['collector', 'recorder']) Object.assign(data.stages[key], { state: 'not_due', reason_code: 'not_due', completed_leagues: 0, records: 0, last_activity_at: null, last_success_at: null });
  for (const league of data.leagues.filter(league => league.odds_feed)) { Object.assign(league.collection, { state: 'not_due', status: null, checked_at: null, fixtures: 0, records: 0 }); Object.assign(league.recording, { state: 'not_due', status: null, captured_at: null, fixtures: 0 }); }
  const value = app(async () => Response.json(data)); await value.api.activate(); assert.match(value.container.textContent, /Not due yet/); assert.match(value.overviewContainer.textContent, /No attention items/);
  const filter = value.document.getElementById('dataStatusFilter'); filter.value = 'attention'; filter.dispatch('change'); assert.equal(leagueCards(value.document).length, 0);
});

test('a missing scheduled job renders attention while preserving real stored coverage', async () => {
  const data = payload(); Object.assign(data.jobs[0], { present: false, active: null, schedule: null, configuration_matches: false, next_run_at: null, last_run: null }); Object.assign(data.stages.collector, { state: 'attention', reason_code: 'job_missing', next_run_at: null }); data.attention = [{ code: 'job_missing', stage: 'collector', league_code: null, severity: 'error' }];
  Object.assign(data.stages.reconciliation, { state: 'waiting', reason_code: 'reconciliation_pending', checked: null, appended: null, last_success_at: null, last_activity_at: null });
  const value = app(async () => Response.json(data)); await value.api.activate(); assert.equal(stageCards(value.document).length, 4); assert.match(value.overviewContainer.textContent, /1 item needs attention/); assert.match(value.container.textContent, /scheduled job is not configured/i);
  assert.match(value.container.textContent, /18 of 18 leagues collected/); assert.match(value.container.textContent, /Awaiting a recorded check/); assert.doesNotMatch(value.container.textContent, /— observations checked/);
});

test('league filters and search stay local and do not infer missing matches from old dates', async () => {
  let requests = 0; const data = payload(); data.leagues[1].collection.state = 'attention'; data.leagues[1].collection.status = 'failed'; data.attention = [{ code: 'collection_failed', stage: 'collector', league_code: 'E1', severity: 'warning' }];
  const value = app(async () => { requests++; return Response.json(data); }); await value.api.activate();
  const filter = value.document.getElementById('dataStatusFilter'); filter.value = 'attention'; filter.dispatch('change'); assert.equal(leagueCards(value.document).length, 1); assert.match(leagueCards(value.document)[0].textContent, /Collection failed/);
  filter.value = 'no_feed'; filter.dispatch('change'); assert.equal(leagueCards(value.document).length, 3);
  filter.value = 'all'; filter.dispatch('change'); const search = value.document.getElementById('dataStatusSearch'); search.value = 'Portugal'; search.dispatch('input'); assert.equal(leagueCards(value.document).length, 1); assert.match(leagueCards(value.document)[0].textContent, /8 Nov 2026/); assert.doesNotMatch(leagueCards(value.document)[0].textContent, /Needs attention/); assert.equal(requests, 1);
});

test('recent rows distinguish actual empty successful runs from dates with no activity', async () => {
  const value = app(async () => Response.json(payload())); await value.api.activate();
  const table = value.document.all().find(node => node.className === 'ds-recent-table'); assert.ok(table); assert.match(table.textContent, /Includes manual activity/); assert.match(table.textContent, /Initial capture/);
  assert.match(table.textContent, /18 leagues captured\s*0 observations/); assert.match(table.textContent, /No collection recorded/); assert.match(table.textContent, /No capture recorded/); assert.match(table.textContent, /No activity recorded/);
});

test('an import season mismatch is explicit without inventing an import outcome', async () => {
  const data = payload(); data.archive.import_schedule.target_season = '2526'; data.archive.import_schedule.matches_current_season = false; data.attention = [{ code: 'import_target_season_mismatch', stage: 'archive', league_code: null, severity: 'warning' }];
  const value = app(async () => Response.json(data)); await value.api.activate(); assert.match(value.container.textContent, /Configured season: 2025\/26 · this differs from the current season and needs review/); assert.match(value.container.textContent, /configured import target differs from the current season/); assert.doesNotMatch(value.container.textContent, /Import failed|Last successful import/);
});

test('a failed refresh clears both views and avoids leaking response details', async () => {
  let fail = false; const value = app(async () => fail ? new Response('private diagnostic token=secret', { status: 500 }) : Response.json(payload())); await value.api.activate(); assert.equal(stageCards(value.document).length, 4);
  fail = true; const request = value.api.reload(); assert.equal(stageCards(value.document).length, 0); assert.equal(leagueCards(value.document).length, 0); await request;
  assert.match(value.overviewContainer.textContent, /Current status is unavailable/); assert.match(value.container.textContent, /could not be loaded/); assert.doesNotMatch(value.container.textContent, /private diagnostic|token=secret/); assert.doesNotMatch(value.overviewContainer.textContent, /Recent check complete/);
});

test('superseded requests are aborted and cannot replace a newer status', async () => {
  const pending = [], signals = []; const value = app((_url, options) => { signals.push(options.signal); return new Promise(resolve => pending.push(resolve)); }); const first = value.api.activate(), second = value.api.reload(); assert.equal(signals[0].aborted, true);
  const newer = payload(); newer.generated_at = '2026-11-24T22:41:00Z'; pending[1](Response.json(newer)); await second; pending[0](Response.json(payload())); await first;
  assert.match(value.overviewContainer.textContent, /22:41 UK/); assert.doesNotMatch(value.overviewContainer.textContent, /22:40 UK/);
});

test('one cache serves repeated activation, expires at five minutes and cancels on destroy', async () => {
  let calls = 0; const value = app(async () => { calls++; return Response.json(payload()); }); await value.api.activate(); await value.api.activate(); assert.equal(calls, 1); value.clock.now += 300000; await value.api.activate(); assert.equal(calls, 2);
  assert.equal(helpers.freshPayload({ generated_at: '2027-07-01T22:59:00Z' }, Date.parse('2027-07-01T23:01:00Z')), false);
  let signal; const pending = app((_url, options) => { signal = options.signal; return new Promise(() => {}); }); pending.api.destroy(); assert.equal(signal.aborted, true);
});
