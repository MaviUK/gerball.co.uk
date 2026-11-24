import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../assets/recorded-screens.js', import.meta.url), 'utf8');
const pure = vm.createContext({ Intl, Date, URL, AbortController });
vm.runInContext(source, pure);
const helpers = pure.GerballRecordedScreens.helpers;
const instant = Date.parse('2026-11-24T18:00:00Z');
const ruleVersion = 'ppg_last5_dates_050_v1';
function history(ppg = 1.8) { return { games: 5, date_count: 5, points: ppg * 5, ppg, first_date: '2026-10-20', last_date: '2026-11-18', dates: [
  { date: '2026-11-18', games: 1, points: 3 }, { date: '2026-11-12', games: 1, points: 0 }, { date: '2026-11-06', games: 1, points: 3 }, { date: '2026-10-28', games: 1, points: 0 }, { date: '2026-10-20', games: 1, points: 3 },
] }; }
function result(status = 'pending', resultCode = null, revision = 0) {
  return { status, reason: status === 'settled' ? 'Matched to an imported full-time result.' : status === 'review' ? 'Two imported matches share this identity.' : 'No complete imported result is available.', revision,
    recorded_at: revision ? '2026-11-24T17:30:00Z' : null, match_id: status === 'settled' ? 400 : null, source: status === 'settled' ? 'football-data.co.uk' : null,
    imported_at: status === 'settled' ? '2026-11-24T16:00:00Z' : null, home_goals: status === 'settled' ? (resultCode === 'H' ? 2 : 1) : null,
    away_goals: status === 'settled' ? (resultCode === 'A' ? 2 : resultCode === 'D' ? 1 : 0) : null, full_time_result: resultCode, correction_reason: null, history: [] };
}
function record(id, overrides = {}) {
  return { id, rule_version: ruleVersion, event_id: `event-${id}`, league_code: 'E0', league_name: 'Premier League', capture_date: '2026-11-20', recorded_at: '2026-11-20T12:15:02Z',
    kickoff_at: '2026-11-23T15:00:00Z', fixture_date: '2026-11-23', season: '2627', phase: 'calibration', cutoff_date: '2026-11-20',
    home: { provider_name: 'Home <script>alert(1)</script>', canonical_name: 'Home club', match_status: 'alias', history: history(1.8) },
    away: { provider_name: 'Away club', canonical_name: 'Away', match_status: 'alias', history: history(.6) }, ppg_gap: 1.2,
    markets: { H: { status: 'match', reason: 'Home prior PPG exceeds away prior PPG by at least 0.50.' }, D: { status: 'no_match', reason: 'The saved PPG gap exceeds 0.50.' }, A: { status: 'no_match', reason: 'Away prior PPG does not exceed home PPG by 0.50.' } },
    input_sha256: 'a'.repeat(64), first_qualifying: { H: { record_id: id, capture_date: '2026-11-20' }, D: null, A: null }, result: result(), ...overrides };
}
function records() {
  const settled = result('settled', 'H', 1); settled.history = [{ ...settled, history: undefined }];
  const corrected = result('settled', 'D', 2); corrected.correction_reason = 'Imported score corrected from 2–0 to 1–1.';
  corrected.history = [{ ...settled, history: undefined }, { ...corrected, history: undefined }];
  return [record(1, { result: settled }), record(2, { result: corrected, first_qualifying: { H: { record_id: 99, capture_date: '2026-11-19' }, D: { record_id: 2, capture_date: '2026-11-20' }, A: null },
    markets: { H: { status: 'match', reason: 'Inclusive threshold matched.' }, D: { status: 'match', reason: 'Inclusive threshold also matched.' }, A: { status: 'no_match', reason: 'Away direction excluded.' } }, ppg_gap: .5 }),
    record(3, { markets: { H: { status: 'no_match', reason: 'Home direction excluded.' }, D: { status: 'match', reason: 'Draw condition matched.' }, A: { status: 'no_match', reason: 'Away direction excluded.' } }, first_qualifying: { H: null, D: { record_id: 3, capture_date: '2026-11-20' }, A: null } }),
    record(4, { home: { provider_name: 'Zero team', canonical_name: 'Zero team', match_status: 'exact', history: history(0) }, markets: Object.fromEntries(['H', 'D', 'A'].map(market => [market, { status: 'insufficient_history', reason: 'Insufficient games at capture.' }])), first_qualifying: { H: null, D: null, A: null } }),
    record(5, { result: result('review', null, 1) }), record(6, { kickoff_at: '2026-12-02T20:00:00Z', fixture_date: '2026-12-02', phase: 'post_boundary' }),
    record(7, { markets: Object.fromEntries(['H', 'D', 'A'].map(market => [market, { status: 'unmatched_team', reason: 'The provider team was not linked at capture.' }])), first_qualifying: { H: null, D: null, A: null } })];
}
function metrics(overrides = {}) { return { fixtures: 0, settled: 0, matched: 0, not_matched: 0, pending: 0, review: 0, match_rate_pct: null, ...overrides }; }
function payload(league = 'E0', captureDate = '2026-11-20') {
  return { status: 'ok', version: 'recorded_screens_v1', rule_version: ruleVersion, generated_at: new Date(instant).toISOString(), timezone: 'Europe/London', league_code: league, evaluation_start: '2026-12-01',
    method: { horizon_days: 14, summary_basis: 'first_qualifying_capture_per_event_market_version', identity_policy: 'first_event_then_canonical_fixture', qualification_uses_current_odds: false, capture_time_uk: '12:15', capture_retries_uk: ['12:20', '12:25'], settlement: 'hourly at :30' },
    coverage: { today: { date: '2026-11-24', status: 'recorded', collection_status: 'completed', captured_at: '2026-11-24T12:15:00Z', reason: 'Daily recording complete.' }, captured_leagues_today: 18, expected_leagues: 18, latest_reconciliation_at: '2026-11-24T17:30:00Z' },
    available_dates: [{ capture_date: captureDate, captured_at: `${captureDate}T12:15:00Z`, fixture_count: 7, mode: 'scheduled' }, { capture_date: '2026-11-19', captured_at: '2026-11-19T12:15:00Z', fixture_count: 8, mode: 'scheduled' }],
    cohort: { id: 1, capture_date: captureDate, captured_at: `${captureDate}T12:15:00Z`, collection_date: captureDate, collection_checked_at: `${captureDate}T12:05:00Z`, collection_status: 'completed', fixture_count: 7, skipped_started: 0, mode: 'scheduled', input_sha256: 'b'.repeat(64) },
    summary: { H: { calibration: metrics({ fixtures: 3, settled: 2, matched: 1, not_matched: 1, review: 1, match_rate_pct: 50 }), post_boundary: metrics({ fixtures: 1, pending: 1 }) },
      D: { calibration: metrics({ fixtures: 2, settled: 1, matched: 1, pending: 1, match_rate_pct: 100 }), post_boundary: metrics() }, A: { calibration: metrics(), post_boundary: metrics() } },
    records: records().map(item => ({ ...item, league_code: league, league_name: league === 'E0' ? 'Premier League' : 'Championship', capture_date: captureDate, recorded_at: `${captureDate}T12:15:02Z` })) };
}

test('saved records remain visible after kickoff and use stored qualification', () => {
  const value = records(); value[0].ppg_gap = -4;
  assert.equal(helpers.qualified(value[0], 'H'), true, 'Qualification must not be recomputed from any present display value');
  assert.equal(helpers.filterRecords(value, { market: 'H', scope: 'qualifying', outcome: 'all', search: '' }).length, 4);
  assert.ok(Date.parse(value[0].kickoff_at) < instant, 'The saved settled example is already past kickoff');
  assert.equal(helpers.filterRecords(value, { market: 'H', scope: 'all', outcome: 'all', search: 'Zero team' }).length, 1);
  assert.equal(helpers.decimal(value[3].home.history.ppg), '0.000');
  assert.equal(helpers.decimal(null), '—');
  assert.equal(value.length, 7, 'Filtering does not mutate saved observations');
});

test('corrected results, pending imports and ambiguous results have separate outcomes', () => {
  const value = records();
  assert.equal(helpers.outcome(value[0], 'H'), 'matched');
  assert.equal(helpers.outcome(value[1], 'H'), 'not_matched', 'Only the current revision drives outcome');
  assert.equal(helpers.outcome(value[1], 'D'), 'matched', 'Inclusive market overlap remains explicit');
  assert.equal(helpers.outcome(value[2], 'H'), 'excluded');
  assert.equal(helpers.outcome(value[4], 'H'), 'review');
  assert.equal(helpers.outcome(value[5], 'H'), 'pending');
  assert.equal(helpers.filterRecords(value, { market: 'H', scope: 'all', outcome: 'review' }).length, 1);
});

test('first qualification uses server identity references without deduplicating daily evidence', () => {
  const value = records();
  assert.equal(helpers.firstQualification(value[0], 'H').first, true);
  assert.equal(helpers.firstQualification(value[1], 'H').first, false);
  assert.equal(helpers.firstQualification(value[1], 'H').capture_date, '2026-11-19');
  assert.equal(helpers.firstQualification(value[2], 'H'), null);
  const duplicate = { ...value[0], id: 77, event_id: 'provider-duplicate', first_qualifying: value[0].first_qualifying };
  assert.equal(helpers.firstQualification(duplicate, 'H').first, false);
  assert.equal(helpers.filterRecords([value[0], duplicate], { market: 'H', scope: 'qualifying', outcome: 'all' }).length, 2, 'Both saved source observations remain inspectable');
});

test('payload validation protects selected cohort, version, phase, result and history-only method', () => {
  assert.equal(helpers.validPayload(payload(), 'E0'), true);
  assert.equal(helpers.validPayload(payload(), 'E0', '2026-11-20'), true);
  assert.equal(helpers.validPayload(payload(), 'E0', '2026-11-19'), false);
  assert.equal(helpers.validPayload(payload(), 'E1'), false);
  assert.equal(helpers.validPayload({ ...payload(), rule_version: 'new-rule' }, 'E0'), false);
  assert.equal(helpers.validPayload({ ...payload(), method: { ...payload().method, qualification_uses_current_odds: true } }, 'E0'), false);
  const corrupt = payload(); corrupt.records[0].result.full_time_result = 'O25'; assert.equal(helpers.validPayload(corrupt, 'E0'), false);
  const phase = payload(); phase.records[0].phase = 'approved'; assert.equal(helpers.validPayload(phase, 'E0'), false);
  const empty = payload(); empty.cohort = null; empty.records = []; assert.equal(helpers.validPayload(empty, 'E0'), true);
  assert.equal(helpers.dateValue('2026-02-31'), false);
});

test('CSV preserves capture time, first reference, revision history and literal formula-like names', () => {
  const value = payload(); value.records[1].home.provider_name = '=HYPERLINK("untrusted")';
  Object.assign(value.method, { rule_frozen_at: '2026-11-19T12:00:00Z', implementation_sha256: 'c'.repeat(64), source_commit: 'd'.repeat(40) });
  const csv = helpers.csvForRecords(value, [value.records[1]], { market: 'H', scope: 'all', outcome: 'all' });
  assert.match(csv, /"rule_frozen_at","implementation_sha256","source_commit","identity_policy"/);
  assert.match(csv, /"2026-11-19T12:00:00Z","c{64}","d{40}","first_event_then_canonical_fixture"/);
  assert.match(csv, /recorded_at.*captured_kickoff_at/);
  assert.match(csv, /first_qualifying_record_id/);
  assert.match(csv, /record_input_sha256/);
  assert.match(csv, /result_revision_history_json/);
  assert.match(csv, /"'=HYPERLINK\(""untrusted""\)"/);
  assert.match(csv, /"not_matched","settled","2"/);
  assert.match(csv, /Imported score corrected/);
  assert.equal(csv.split('\r\n').length, 2);
  assert.equal(helpers.csvCell(' +SUM(1,1)'), '"\' +SUM(1,1)"');
  assert.equal(helpers.csvCell(-1.2), '"-1.2"');
});

test('cache expires after five minutes and at London midnight', () => {
  assert.equal(helpers.freshPayload(payload(), instant + 60000), true);
  assert.equal(helpers.freshPayload(payload(), instant + 300000), false);
  assert.equal(helpers.freshPayload({ generated_at: '2027-07-01T22:59:00Z' }, Date.parse('2027-07-01T23:01:00Z')), false);
  assert.equal(helpers.londonDay('2027-07-01T23:01:00Z'), '2027-07-02');
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
  focus() { this.document.activeElement = this; }
  querySelectorAll(selector) { const all = []; const walk = node => { if (selector === '[data-record-focus]' && node.dataset.recordFocus) all.push(node); node.children.forEach(walk); }; walk(this); return all; }
}
function dom() { const document = {}; document.createElement = tag => new Element(tag, document); document.body = document.createElement('body'); document.activeElement = document.body; document.all = () => { const output = []; const walk = node => { output.push(node); node.children.forEach(walk); }; walk(document.body); return output; }; document.getElementById = id => document.all().find(node => node.id === id) || null; return document; }
function app(fetchImpl) {
  const document = dom(), clock = { now: instant }; class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [clock.now])); } static now() { return clock.now; } }
  const context = vm.createContext({ document, Intl, Date: ClockDate, URL, Blob, AbortController, fetch: fetchImpl, location: { href: 'https://gerball.co.uk/#tracking' }, setTimeout: () => 1, clearTimeout() {} });
  vm.runInContext(source, context); const container = document.createElement('div'); document.body.appendChild(container);
  const api = context.GerballRecordedScreens.init({ container, endpoint: 'https://example.test/records', apiKey: 'public-browser-key', leagues: [['E0', 'Premier League'], ['E1', 'Championship']], initialLeague: 'E0' }); return { api, document, container, clock };
}
const cards = document => document.all().filter(node => node.className === 'card rs-record');

test('rendering preserves frozen records, safe text, separate phase totals and public apikey-only auth', async () => {
  const calls = [], data = payload(); data.records.push({ ...data.records[0], id: 77, event_id: 'duplicate-event', first_qualifying: data.records[0].first_qualifying });
  const value = app(async (url, options) => { calls.push({ url, options }); return Response.json(data); }); await value.api.activate();
  assert.equal(calls.length, 1); assert.equal(calls[0].options.headers.apikey, 'public-browser-key'); assert.equal(calls[0].options.headers.Authorization, undefined); assert.equal(new URL(calls[0].url).searchParams.has('date'), false);
  assert.equal(cards(value.document).length, 5); assert.match(value.container.textContent, /Home <script>alert\(1\)<\/script>/); assert.equal(value.document.all().filter(node => node.tagName === 'SCRIPT').length, 0);
  assert.match(value.container.textContent, /1.800/); assert.match(value.container.textContent, /Saved 20 Nov 2026/); assert.match(value.container.textContent, /Full-time score: 1 – 1/);
  const phases = value.document.all().filter(node => node.className === 'rs-phase'); assert.equal(phases.length, 2);
  assert.match(phases[0].textContent, /3 Distinct fixtures/); assert.match(phases[0].textContent, /50.0% of settled/); assert.match(phases[1].textContent, /1 Distinct fixtures/); assert.doesNotMatch(phases[1].textContent, /0.0%/);
  assert.match(cards(value.document).find(node => node.textContent.includes('event-2')).textContent, /Repeated qualifying observation/);
  assert.match(value.container.textContent, /Revision 2/); assert.match(value.container.textContent, /Revision 1/); assert.match(value.container.textContent, /Imported score corrected/);
});

test('recording labels and result reasons stay plain while CSV retains original codes', async () => {
  const codes = ['awaiting_result', 'awaiting_import', 'unmatched_teams', 'ambiguous_result', 'unexpected_source', 'result_predates_capture', 'inconsistent_result', 'invalid_result_payload', 'exact_imported_result'];
  for (const code of codes) { assert.notEqual(helpers.resultReason(code), code); assert.doesNotMatch(helpers.resultReason(code), /_/); }
  const data = payload(); data.cohort.mode = 'bootstrap'; data.records[0].result.reason = 'exact_imported_result'; data.records[0].result.history[0].reason = 'exact_imported_result'; data.records[4].result.reason = 'ambiguous_result';
  Object.assign(data.method, { rule_frozen_at: '2026-11-19T12:00:00Z', implementation_sha256: 'c'.repeat(64), source_commit: 'd'.repeat(40) });
  const value = app(async () => Response.json(data)); await value.api.activate();
  assert.match(value.container.textContent, /View refreshed/); assert.doesNotMatch(value.container.textContent, /Results checked/); assert.match(value.container.textContent, /Initial capture/);
  assert.match(value.container.textContent, /Matched to one imported full-time result/); assert.match(value.container.textContent, /More than one imported match fits this fixture/);
  assert.doesNotMatch(value.container.textContent, /exact_imported_result|ambiguous_result/); assert.match(value.container.textContent, /duplicate provider identities for the same fixture are counted once/);
  const audit = value.document.all().find(node => node.tagName === 'DETAILS' && node.children[0].textContent === 'Recording and result history');
  assert.equal(audit.open, false); assert.match(audit.textContent, /Rule frozen: 19 Nov 2026/); assert.match(audit.textContent, /Implementation SHA-256: c{64}/); assert.match(audit.textContent, /Source commit: d{40}/);
  const csv = helpers.csvForRecords(data, [data.records[0]], { market: 'H', scope: 'all', outcome: 'all' }); assert.match(csv, /exact_imported_result/); assert.match(csv, /"bootstrap"/);
  const scheduled = app(async () => Response.json(payload())); await scheduled.api.activate(); assert.match(scheduled.container.textContent, /Scheduled capture/);
});

test('market, scope, outcomes and team search filter locally without altering unique totals', async () => {
  let requests = 0; const value = app(async () => { requests++; return Response.json(payload()); }); await value.api.activate();
  const market = value.document.getElementById('recordedMarket'); market.value = 'D'; market.dispatch('change'); assert.equal(cards(value.document).length, 2); assert.match(value.container.textContent, /Draw · unique recorded outcomes/);
  const outcome = value.document.getElementById('recordedOutcome'); outcome.value = 'matched'; outcome.dispatch('change'); assert.equal(cards(value.document).length, 1);
  outcome.value = 'all'; outcome.dispatch('change'); const scope = value.document.getElementById('recordedScope'); scope.value = 'all'; scope.dispatch('change'); assert.equal(cards(value.document).length, 7);
  const search = value.document.getElementById('recordedSearch'); search.value = 'Zero team'; search.dispatch('input'); assert.equal(cards(value.document).length, 1); assert.match(cards(value.document)[0].textContent, /Insufficient history/); assert.match(cards(value.document)[0].textContent, /0.000/);
  assert.match(value.container.textContent, /2 Distinct fixtures/); assert.equal(requests, 1);
});

test('date selection fetches the selected capture and a league change resets it', async () => {
  const calls = []; const value = app(async url => { const parsed = new URL(url), league = parsed.searchParams.get('league'), day = parsed.searchParams.get('date'); calls.push([league, day]); return Response.json(payload(league, day || '2026-11-20')); }); await value.api.activate();
  const date = value.document.getElementById('recordedDate'); date.value = '2026-11-19'; date.dispatch('change'); assert.equal(cards(value.document).length, 0); await value.api.activate(); assert.match(value.container.textContent, /Selected capture 19 Nov 2026/);
  const league = value.document.getElementById('recordedLeague'); league.value = 'E1'; league.dispatch('change'); await value.api.activate(); assert.equal(date.value, ''); assert.deepEqual(calls, [['E0', null], ['E0', '2026-11-19'], ['E1', null]]);
});

test('failed requests clear old records and never print database response details', async () => {
  const value = app(async url => new URL(url).searchParams.get('league') === 'E0' ? Response.json(payload()) : new Response('private database error detail', { status: 500 })); await value.api.activate();
  const league = value.document.getElementById('recordedLeague'); league.value = 'E1'; league.dispatch('change'); assert.equal(cards(value.document).length, 0); await value.api.activate();
  assert.match(value.container.textContent, /Saved records for Championship could not be loaded/); assert.doesNotMatch(value.container.textContent, /private database error detail/); assert.doesNotMatch(value.container.textContent, /Home <script>/);
});

test('late responses cannot overwrite a newer cohort and previous requests are aborted', async () => {
  const pending = new Map(), signals = new Map(); const value = app((url, options) => { const league = new URL(url).searchParams.get('league'); signals.set(league, options.signal); return new Promise(resolve => pending.set(league, resolve)); });
  const first = value.api.activate(); const league = value.document.getElementById('recordedLeague'); league.value = 'E1'; league.dispatch('change'); const second = value.api.activate(); assert.equal(signals.get('E0').aborted, true);
  pending.get('E1')(Response.json(payload('E1'))); await second; pending.get('E0')(Response.json(payload('E0'))); await first;
  assert.match(value.container.textContent, /Loaded saved Championship records/); assert.match(cards(value.document)[0].textContent, /Championship/);
});

test('zero captures differ from zero qualifying fixtures and incomplete daily coverage stays visible', async () => {
  const empty = payload(); empty.cohort = null; empty.records = []; empty.available_dates = []; empty.coverage.today.status = 'waiting_for_collection'; empty.coverage.today.reason = 'The daily fixture collection is not complete.';
  const value = app(async () => Response.json(empty)); await value.api.activate(); assert.match(value.container.textContent, /No capture for this selection/); assert.match(value.container.textContent, /Waiting for daily collection/);
  assert.equal(value.document.all().find(node => node.className === 'secondary rs-export').disabled, true);
  const zero = payload(); zero.records = []; zero.cohort.fixture_count = 0;
  const second = app(async () => Response.json(zero)); await second.api.activate(); assert.match(second.container.textContent, /This capture contains no fixtures/);
});

test('fresh activation reuses saved data, expiry reloads, retry recovers and destroy aborts', async () => {
  let calls = 0, fail = false; const value = app(async () => { calls++; return fail ? new Response('', { status: 503 }) : Response.json(payload()); }); await value.api.activate(); await value.api.activate(); assert.equal(calls, 1);
  value.clock.now += 301000; fail = true; await value.api.activate(); assert.equal(calls, 2); assert.equal(cards(value.document).length, 0);
  fail = false; value.document.all().find(node => node.className === 'secondary rs-retry').click(); await value.api.activate(); assert.equal(cards(value.document).length, 4);
  let signal; const pending = app((_url, options) => { signal = options.signal; return new Promise(() => {}); }); pending.api.destroy(); assert.equal(signal.aborted, true);
});
