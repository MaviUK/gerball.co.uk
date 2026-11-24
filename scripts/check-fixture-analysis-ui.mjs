import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../assets/fixture-analysis.js', import.meta.url), 'utf8');
const pure = vm.createContext({ Intl, Date, URL, AbortController });
vm.runInContext(source, pure);
const helpers = pure.GerballFixtureAnalysis.helpers;

test('rates preserve zero outcomes but distinguish missing and empty samples', () => {
  assert.equal(helpers.sampleRate(0, 10, 0), '0/10 · 0.0%');
  assert.equal(helpers.sampleRate(7, 10, 70), '7/10 · 70.0%');
  assert.equal(helpers.sampleRate(3, 7, 42.9), '3/7 · 42.9%');
  for (const values of [[0, 0, null], [null, 10, null], [11, 10, 110], [-1, 10, -10], ['7', 10, 70], [1, 10, Infinity]]) {
    assert.equal(helpers.sampleRate(...values), '—');
  }
  assert.equal(helpers.decimal(0), '0.00');
  assert.equal(helpers.decimal(null), '—');
  assert.equal(helpers.percent(null), '—');
  assert.equal(helpers.percent(0), '0.0%');
  assert.equal(helpers.percent(100.1), '—');
});

test('comparison reads the chosen period and venue without mixing samples', () => {
  const team = { season: { overall: { played: 16 }, venue: { played: 8 } }, recent: { overall: { played: 10 }, venue: { played: 7 } } };
  assert.equal(helpers.selectedStats(team, 'season', 'overall').played, 16);
  assert.equal(helpers.selectedStats(team, 'season', 'venue').played, 8);
  assert.equal(helpers.selectedStats(team, '10', 'overall').played, 10);
  assert.equal(helpers.selectedStats(team, '10', 'venue').played, 7);
  assert.equal(helpers.selectedStats(null, '5', 'venue'), null);
});

test('dates and season labels follow the London calendar', () => {
  assert.equal(helpers.londonDay('2027-07-01T23:30:00Z'), '2027-07-02');
  assert.equal(helpers.londonDay('2027-01-01T23:30:00Z'), '2027-01-01');
  assert.equal(helpers.seasonLabel('2627'), '2026/27');
  assert.equal(helpers.seasonLabel('9394'), '1993/94');
  assert.equal(helpers.formattedDate('2026-11-23'), '23 Nov 2026');
  assert.equal(helpers.formattedDate(null), 'Date unavailable');
});

test('cached analysis expires, respects source age, and stops at kickoff or a new UK day', () => {
  const now = Date.parse('2027-07-01T22:59:00Z');
  const entry = { savedAt: now, data: { generated_at: new Date(now - 1000).toISOString(), fixture: { kickoff_at: '2027-07-03T12:00:00Z' } } };
  assert.equal(helpers.cacheIsFresh(entry, now + 1000), true);
  assert.equal(helpers.cacheIsFresh(entry, now + 5 * 60000), false);
  assert.equal(helpers.cacheIsFresh(entry, now + 2 * 60000), false, 'UK midnight must invalidate cached analysis');
  assert.equal(helpers.cacheIsFresh({ ...entry, data: { ...entry.data, generated_at: new Date(now - 6 * 60000).toISOString() } }, now), false);
  assert.equal(helpers.cacheIsFresh({ ...entry, data: { ...entry.data, fixture: { kickoff_at: new Date(now).toISOString() } } }, now), false);
  assert.equal(helpers.cacheIsFresh({ ...entry, savedAt: now + 1000 }, now), false);
});

// Minimal browser primitives exercise the real rendering/request lifecycle without
// introducing a package dependency or using a second browser automation runtime.
class Element {
  constructor(tag, document) {
    this.tagName = tag.toUpperCase(); this.document = document; this.children = [];
    this.parentElement = null; this.listeners = new Map(); this.attributes = new Map();
    this.style = {}; this.value = ''; this.open = false; this.disabled = false; this.text = '';
    const classes = new Set(); this.classList = { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) };
  }
  set textContent(value) { this.text = String(value); this.replaceChildren(); }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(' '); }
  appendChild(child) { if (child.parentElement) child.parentElement.children = child.parentElement.children.filter(item => item !== child); child.parentElement = this; this.children.push(child); return child; }
  append(...children) { children.forEach(child => this.appendChild(child)); }
  replaceChildren(...children) { this.children.forEach(child => { child.parentElement = null; }); this.children = []; this.append(...children); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(name, listener) { if (!this.listeners.has(name)) this.listeners.set(name, []); this.listeners.get(name).push(listener); }
  dispatch(name) { for (const listener of this.listeners.get(name) || []) listener({ target: this, preventDefault() {} }); }
  focus() { this.document.activeElement = this; }
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatch('close'); }
  get isConnected() { return this === this.document.documentElement || Boolean(this.parentElement?.isConnected); }
  getBoundingClientRect() { return { left: 0, right: 1000, top: 0, bottom: 800 }; }
}

function dom() {
  const document = {};
  document.createElement = tag => new Element(tag, document);
  document.documentElement = document.createElement('html');
  document.body = document.createElement('body'); document.documentElement.appendChild(document.body);
  document.activeElement = document.body;
  document.all = () => { const elements = []; const walk = node => { elements.push(node); node.children.forEach(walk); }; walk(document.documentElement); return elements; };
  document.getElementById = id => document.all().find(element => element.id === id) || null;
  document.querySelector = () => null;
  return document;
}

const instant = Date.parse('2026-11-24T12:00:00Z');
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [instant])); }
  static now() { return instant; }
}

function stats(played = 10) {
  return { played, wins: 7, draws: 2, losses: 1, points: 23, ppg: 2.3, goals_for: 20, goals_against: 8, avg_goals_for: 2, avg_goals_against: .8,
    win_pct: 70, draw_pct: 20, loss_pct: 10, over25_count: 6, over25_pct: 60, under25_count: 4, under25_pct: 40, btts_count: 5, btts_pct: 50,
    clean_sheet_count: 5, clean_sheet_pct: 50, failed_to_score_count: 0, failed_to_score_pct: 0, form: 'WWDLW', first_match_date: '2026-08-10', last_match_date: '2026-11-20' };
}
function fixture(id = 'event-1') {
  return { event_id: id, kickoff_at: '2026-11-28T15:00:00Z', season: '2627', league_code: 'E0', league_name: 'Premier League',
    home: { provider_name: 'Home <script>alert(1)</script>', canonical_name: 'Home', match_status: 'alias' },
    away: { provider_name: 'Away', canonical_name: 'Away', match_status: 'exact' } };
}
function payload(id = 'event-1', windowSize = 10) {
  const team = { season: { overall: stats(), venue: stats() }, recent: { overall: stats(), venue: stats() }, matches: [] };
  return { status: 'ok', version: 'historical_comparison_v1', basis: 'stored_match_history', generated_at: new Date(instant).toISOString(),
    as_of_date: '2026-11-24', timezone: 'Europe/London', window: windowSize, fixture: fixture(id), home: team, away: team,
    league: { season: '2627', played: 160, home_wins: 70, draws: 40, away_wins: 50, home_win_pct: 43.8, draw_pct: 25, away_win_pct: 31.3,
      avg_home_goals: 1.5, avg_away_goals: 1.2, over25_pct: 52, under25_pct: 48, btts_pct: 50, first_match_date: '2026-08-10', last_match_date: '2026-11-20' },
    head_to_head: { played: 0, home_team_wins: 0, draws: 0, away_team_wins: 0, matches: [] } };
}

function app(fetchImpl) {
  const document = dom();
  const context = vm.createContext({ document, Intl, Date: FixedDate, URL, AbortController, fetch: fetchImpl, location: { href: 'https://gerball.co.uk/#upcoming' }, setTimeout: () => 1, clearTimeout() {} });
  vm.runInContext(source, context);
  return { api: context.GerballFixtureAnalysis, document };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('payload identity, historical basis and sample window must match the request', () => {
  assert.equal(helpers.validPayload(payload(), 'event-1', 10), true);
  assert.equal(helpers.validPayload(payload(), 'different-event', 10), false);
  assert.equal(helpers.validPayload(payload(), 'event-1', 5), false);
  assert.equal(helpers.validPayload({ ...payload(), basis: 'current_odds' }, 'event-1', 10), false);
});

test('dialog renders safe historical content, restores focus, and caches only on open', async () => {
  let calls = 0;
  const { api, document } = app(async () => { calls++; return Response.json(payload()); });
  const trigger = document.createElement('button'); document.body.appendChild(trigger); trigger.focus();
  assert.equal(calls, 0);
  await api.open({ fixture: fixture(), endpoint: 'https://example.test/analysis', returnFocus: trigger });
  assert.equal(calls, 1);
  assert.equal(document.getElementById('fixtureAnalysis').open, true);
  assert.match(document.body.textContent, /Home <script>alert\(1\)<\/script>/);
  assert.equal(document.all().filter(element => element.tagName === 'SCRIPT').length, 0);
  assert.match(document.body.textContent, /0\/10 · 0.0%/);
  assert.match(document.body.textContent, /160 completed league matches/);
  assert.match(document.body.textContent, /Home side at home; away side away/);
  api.close();
  assert.equal(document.activeElement, trigger);
  assert.equal(document.documentElement.classList.contains('fixture-analysis-open'), false);
  await api.open({ fixture: fixture(), endpoint: 'https://example.test/analysis', returnFocus: trigger });
  assert.equal(calls, 1, 'Reopening a fresh cached fixture must not refetch');
});

test('changing recent window requests its own sample, while venue and season switches stay local', async () => {
  const windows = [];
  const { api, document } = app(async url => { const windowSize = Number(new URL(url).searchParams.get('window')); windows.push(windowSize); return Response.json(payload('event-1', windowSize)); });
  await api.open({ fixture: fixture(), endpoint: 'https://example.test/analysis' });
  const sample = document.getElementById('fixtureAnalysisSample'); sample.value = '5'; sample.dispatch('change'); await settle();
  assert.deepEqual(windows, [10, 5]);
  assert.match(document.body.textContent, /Last 5 current-season matches/);
  const venue = document.getElementById('fixtureAnalysisVenue'); venue.value = 'overall'; venue.dispatch('change');
  assert.match(document.body.textContent, /Both teams at all venues/);
  sample.value = 'season'; sample.dispatch('change');
  assert.deepEqual(windows, [10, 5]);
});

test('opening captured prices preserves the historical dialog, chosen sample, venue and return destination', async () => {
  const requests = [], destinations = [];
  const { api, document } = app(async url => {
    const size = Number(new URL(url).searchParams.get('window')); requests.push(size);
    return Response.json(payload('event-1', size));
  });
  const original = fixture(), trigger = document.createElement('button'); document.body.appendChild(trigger);
  await api.open({ fixture: original, endpoint: 'https://example.test/analysis', returnFocus: trigger, onCapturedPrices: value => destinations.push(value) });
  const sample = document.getElementById('fixtureAnalysisSample'); sample.value = '5'; sample.dispatch('change'); await settle();
  const venue = document.getElementById('fixtureAnalysisVenue'); venue.value = 'overall'; venue.dispatch('change');
  const button = document.all().find(element => element.className === 'fa-prices');
  assert.equal(button.hidden, false);
  button.dispatch('click'); await settle();
  assert.equal(destinations.length, 1);
  assert.equal(destinations[0].fixture.event_id, original.event_id);
  assert.equal(destinations[0].returnFocus, button);
  assert.equal(document.getElementById('fixtureAnalysis').open, true);
  assert.equal(document.documentElement.classList.contains('fixture-analysis-open'), true);
  assert.equal(sample.value, '5'); assert.equal(venue.value, 'overall');
  assert.deepEqual(requests, [10, 5], 'Price handoff must not change the historical sample');
  api.close(); assert.equal(document.activeElement, trigger);
  await api.open({ fixture: fixture('other'), endpoint: 'https://example.test/analysis' });
  assert.equal(button.hidden, true, 'A later caller without a price action must not reuse an earlier callback');
});

test('price handoff failure preserves the loaded history and permits retry', async () => {
  let fail = true, calls = 0;
  const { api, document } = app(async () => Response.json(payload()));
  await api.open({ fixture: fixture(), endpoint: 'https://example.test/analysis', onCapturedPrices() { calls++; if (fail) throw Error('private diagnostic'); } });
  const button = document.all().find(element => element.className === 'fa-prices');
  button.dispatch('click'); await settle();
  const status = document.all().find(element => element.className === 'fa-price-status');
  assert.equal(status.hidden, false);
  assert.match(status.textContent, /Captured prices could not be opened/);
  assert.doesNotMatch(document.body.textContent, /private diagnostic/);
  assert.match(document.body.textContent, /Team comparison/);
  fail = false; button.dispatch('click'); await settle();
  assert.equal(calls, 2); assert.equal(status.hidden, true);
});

test('accepted fixture updates keep the analysis heading and captured-price destination aligned', async () => {
  const updated = payload();
  updated.fixture.kickoff_at = '2026-12-04T20:00:00Z';
  updated.fixture.home.provider_name = 'Updated home name';
  const destinations = [], { api, document } = app(async () => Response.json(updated));
  await api.open({ fixture: fixture(), endpoint: 'https://example.test/analysis', onCapturedPrices: value => destinations.push(value) });
  assert.match(document.getElementById('fixtureAnalysisTitle').textContent, /Updated home name/);
  assert.match(document.all().find(element => element.className === 'fa-prices').getAttribute('aria-label'), /Updated home name/);
  assert.match(document.all().find(element => element.className === 'fa-fixture-meta').textContent, /4 Dec, 20:00 UK/);
  document.all().find(element => element.className === 'fa-prices').dispatch('click'); await settle();
  assert.equal(destinations[0].fixture.event_id, 'event-1');
  assert.equal(destinations[0].fixture.kickoff_at, updated.fixture.kickoff_at);
  assert.equal(destinations[0].fixture.home.provider_name, 'Updated home name');
});

test('a stale response cannot replace a newly opened fixture', async () => {
  const pending = new Map();
  const { api, document } = app(url => new Promise(resolve => pending.set(new URL(url).searchParams.get('event_id'), resolve)));
  const first = api.open({ fixture: fixture('first'), endpoint: 'https://example.test/analysis' });
  const second = api.open({ fixture: fixture('second'), endpoint: 'https://example.test/analysis' });
  pending.get('second')(Response.json({ ...payload('second'), fixture: { ...fixture('second'), home: { ...fixture('second').home, provider_name: 'Second club' } } }));
  await second;
  pending.get('first')(Response.json({ ...payload('first'), fixture: { ...fixture('first'), home: { ...fixture('first').home, provider_name: 'First club' } } }));
  await first;
  assert.match(document.body.textContent, /Second club/);
  assert.doesNotMatch(document.body.textContent, /First club/);
});

test('missing data and API errors have explicit recoverable display states', async () => {
  let fail = true;
  const { api, document } = app(async () => fail ? new Response('private database details', { status: 500 }) : Response.json(payload()));
  await api.open({ fixture: fixture(), endpoint: 'https://example.test/analysis' });
  assert.match(document.body.textContent, /Match history could not be loaded/);
  assert.doesNotMatch(document.body.textContent, /private database details/);
  fail = false;
  document.all().find(element => element.tagName === 'BUTTON' && element.textContent === 'Try again').dispatch('click'); await settle();
  assert.match(document.body.textContent, /Team comparison/);
  const unavailable = app(async () => new Response('', { status: 404 }));
  await unavailable.api.open({ fixture: fixture(), endpoint: 'https://example.test/analysis' });
  assert.match(unavailable.document.body.textContent, /no longer available in the upcoming collection/);
});
