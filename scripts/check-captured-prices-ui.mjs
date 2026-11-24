import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createClock, createDocument } from './helpers/captured-prices-dom.mjs';

const source = readFileSync(new URL('../assets/captured-prices.js', import.meta.url), 'utf8');
const instant = Date.parse('2026-11-24T12:30:00Z');
const endpoint = 'https://example.test/functions/v1/gerball-upcoming-fixtures';
const keys = ['H', 'D', 'A', 'O25', 'U25'];
const pure = vm.createContext({ Intl, Date, URL, AbortController });
vm.runInContext(source, pure);
const helpers = pure.GerballCapturedPrices.helpers;
const quote = price => ({ price, source_updated_at: '2026-11-24T11:45:00Z', collected_at: '2026-11-24T12:02:03Z' });

// Mirror gerball_upcoming_data's event-detail projection, including its legacy
// collection envelope and per-bookmaker timestamps. No live database is queried.
function fixture(eventId = 'event-1', overrides = {}) {
  const prices = { H: 1.9, D: 3.4, A: 4.2, O25: 2.1, U25: 1.82 };
  return {
    event_id: eventId, sport_key: 'soccer_epl', league_code: 'E0', league_name: 'Premier League', kickoff_at: '2026-12-20T15:00:00Z',
    home: { provider_name: 'Home <script>alert(1)</script>', canonical_name: 'Home', match_status: 'alias', stats: null },
    away: { provider_name: 'Away', canonical_name: 'Away', match_status: 'exact', stats: null },
    markets: Object.fromEntries(keys.map(key => [key, { ...quote(prices[key]), bookmaker_key: 'alpha', bookmaker_name: 'Alpha <img src=x onerror=alert(1)>' }])),
    bookmaker_count: 2, bookmakers_loaded: true,
    bookmakers: [
      { key: 'alpha', name: 'Alpha <img src=x onerror=alert(1)>', markets: Object.fromEntries(keys.map(key => [key, quote(prices[key])])) },
      { key: 'beta', name: 'Beta Sports', markets: { H: quote(1.83), D: quote(3.2), A: quote(4.1), O25: null, U25: null } },
    ],
    ...overrides,
  };
}
function payload(eventId = 'event-1', overrides = {}) {
  return { collection_date: '2026-11-24', collected_at: '2026-11-24T12:07:00Z', collection_status: 'completed',
    timezone: 'Europe/London', generated_at: new Date(instant).toISOString(), mapping: { matched_teams: 2, total_teams: 2 },
    fixtures: [fixture(eventId)], ...overrides };
}

function app(fetchImpl, start = instant) {
  const document = createDocument(), clock = createClock(start), calls = [];
  const context = vm.createContext({ document, Intl, Date: clock.Date, URL, AbortController, DOMException,
    location: { href: 'https://gerball.co.uk/#screening' },
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    fetch: (url, options) => { calls.push({ url, options }); return fetchImpl(url, options, calls.length); } });
  vm.runInContext(source, context);
  const trigger = document.createElement('button'); trigger.textContent = 'Captured prices'; document.body.appendChild(trigger); trigger.focus();
  return { api: context.GerballCapturedPrices, document, clock, calls, trigger,
    open: values => context.GerballCapturedPrices.open({ fixture: fixture(), endpoint, returnFocus: trigger, ...values }),
    cards: () => document.querySelectorAll('.cp-quote'),
    refresh: () => document.querySelector('.cp-refresh').click(),
  };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
const dialog = instance => instance.document.getElementById('capturedPrices');
const visible = instance => dialog(instance).textContent;

test('quote prices require finite numeric decimal odds and keep missing markets distinct', () => {
  for (const price of [1.01, 1.82, 3.4, 10000]) assert.equal(helpers.quotePrice({ price }), price);
  for (const price of [null, undefined, '', '2.1', false, true, 0, 1, -2, NaN, Infinity, 10000.01]) assert.equal(helpers.quotePrice({ price }), null);
  assert.equal(helpers.quotePrice(null), null);
});

test('event detail validates exact identity, one fixture, genuine timestamps and loaded bookmaker data', () => {
  assert.equal(helpers.validPayload(payload(), 'event-1', 'E0', instant), true);
  for (const mutate of [
    data => { data.fixtures[0].event_id = 'other'; },
    data => { data.fixtures[0].league_code = 'E1'; },
    data => { data.fixtures.push(fixture('other')); },
    data => { data.fixtures[0].bookmakers_loaded = false; },
    data => { data.fixtures[0].kickoff_at = 'invalid'; },
    data => { data.fixtures[0].kickoff_at = new Date(instant).toISOString(); },
    data => { data.fixtures[0].markets.H.price = '2.50'; },
    data => { data.fixtures[0].bookmakers[0].markets.D.source_updated_at = 'invalid'; },
    data => { data.fixtures[0].markets.H.bookmaker_key = 'not-in-matrix'; },
    data => { data.fixtures[0].markets.H.price = 2.5; },
    data => { data.fixtures[0].markets.H.source_updated_at = '2026-11-24T11:46:00Z'; },
    data => { data.fixtures[0].markets.H.collected_at = '2026-11-24T12:03:00Z'; },
    data => { data.fixtures[0].bookmakers[1].markets.H.price = 2.5; },
    data => { data.fixtures[0].markets.O25 = null; },
    data => { data.fixtures[0].bookmakers[1].key = 'alpha'; },
  ]) { const data = payload(); mutate(data); assert.equal(helpers.validPayload(data, 'event-1', 'E0', instant), false); }
  assert.equal(helpers.validPayload(payload('event-1', { fixtures: [], mapping: { matched_teams: 0, total_teams: 0 } }), 'event-1', 'E0', instant), true);
  const tied = payload(); tied.fixtures[0].bookmakers[1].markets.H.price = 1.9;
  assert.equal(helpers.validPayload(tied, 'event-1', 'E0', instant), true, 'The server may choose either bookmaker among genuine tied prices');
});

test('timestamp labels use UK winter and summer time without treating null as epoch', () => {
  assert.match(helpers.formatStamp('2027-01-01T12:00:00Z'), /12:00/);
  assert.match(helpers.formatStamp('2027-07-01T12:00:00Z'), /13:00/);
  assert.equal(helpers.londonDay('2027-07-01T23:30:00Z'), '2027-07-02');
  assert.equal(helpers.londonDay('2027-01-01T23:30:00Z'), '2027-01-01');
  assert.doesNotMatch(helpers.formatStamp(null), /1970/);
});

test('cache expires after five minutes, at UK noon/day boundaries, and at kickoff', () => {
  const entry = { savedAt: instant, data: payload() };
  assert.equal(helpers.cacheIsFresh(entry, instant + 1000), true);
  assert.equal(helpers.cacheIsFresh(entry, instant + 5 * 60000), false);
  assert.equal(helpers.cacheIsFresh(entry, instant - 1), false);
  assert.equal(helpers.cacheIsFresh({ ...entry, data: payload('event-1', { generated_at: new Date(instant - 5 * 60000).toISOString() }) }, instant), false);
  assert.equal(helpers.cacheIsFresh({ ...entry, data: payload('event-1', { generated_at: new Date(instant + 61000).toISOString() }) }, instant), false);
  assert.equal(helpers.cacheIsFresh({ ...entry, data: payload('event-1', { fixtures: [] }) }, instant), false);
  for (const before of ['2026-11-24T11:59:00Z', '2027-07-01T10:59:00Z', '2026-11-24T23:59:00Z', '2027-07-01T22:59:00Z']) {
    const savedAt = Date.parse(before), data = payload('event-1', { generated_at: before, fixtures: [fixture('event-1', { kickoff_at: new Date(savedAt + 3 * 86400000).toISOString() })] });
    assert.equal(helpers.cacheIsFresh({ savedAt, data }, savedAt + 1000), true);
    assert.equal(helpers.cacheIsFresh({ savedAt, data }, savedAt + 60000), false, before + ' boundary did not expire');
  }
  assert.equal(helpers.cacheIsFresh({ ...entry, data: payload('event-1', { fixtures: [fixture('event-1', { kickoff_at: new Date(instant + 1000).toISOString() })] }) }, instant + 1000), false);
});

test('open requests the 31-day event detail and renders all markets with their own provenance safely', async () => {
  const instance = app(async () => Response.json(payload()));
  assert.equal(instance.calls.length, 0, 'Opening the feature must be the first read');
  await instance.open({ market: 'D' });
  assert.equal(instance.calls.length, 1);
  const url = new URL(instance.calls[0].url), options = instance.calls[0].options;
  assert.equal(url.searchParams.get('event_id'), 'event-1');
  assert.equal(url.searchParams.get('league'), 'E0');
  assert.equal(url.searchParams.get('days'), '31', 'The default14-day horizon would lose fixtures shown on a31-day screen');
  assert.deepEqual([...url.searchParams.keys()].sort(), ['days', 'event_id', 'league']);
  assert.equal(options.credentials, 'omit');
  assert.equal(new Headers(options.headers).has('authorization'), false);
  assert.equal(new Headers(options.headers).has('apikey'), false);
  assert.equal(dialog(instance).open, true);
  assert.equal(dialog(instance).getAttribute('aria-labelledby'), 'capturedPricesTitle');
  assert.equal(instance.document.querySelector('.cp-status').getAttribute('role'), 'status');
  assert.deepEqual(instance.cards().map(card => card.dataset.market), keys);
  for (const [key, price] of [['H', '1.90'], ['D', '3.40'], ['A', '4.20'], ['O25', '2.10'], ['U25', '1.82']]) {
    const card = instance.cards().find(node => node.dataset.market === key);
    assert.match(card.textContent, new RegExp(price.replace('.', '\\.')));
    assert.match(card.textContent, /11:45/, 'Provider time must come from this quote');
    assert.match(card.textContent, /12:02/, 'Capture time must come from this quote, not the global12:07 collection maximum');
  }
  assert.match(visible(instance), /Home <script>alert\(1\)<\/script>/);
  assert.match(visible(instance), /Alpha <img src=x onerror=alert\(1\)>/);
  assert.equal(instance.document.all().some(element => ['SCRIPT', 'IMG', 'IFRAME'].includes(element.tagName)), false);
  assert.equal(instance.document.querySelectorAll('.cp-comparison tbody tr').length, 2);
  assert.match(instance.document.querySelector('.cp-comparison').textContent, /Beta Sports/);
  instance.api.close();
  assert.equal(dialog(instance).open, false);
  assert.equal(instance.document.activeElement, instance.trigger);
});

test('missing markets stay visible as unavailable rather than zero odds or fabricated prices', async () => {
  const data = payload(); data.fixtures[0].markets.O25 = null; data.fixtures[0].markets.U25 = null;
  for (const bookmaker of data.fixtures[0].bookmakers) { bookmaker.markets.O25 = null; bookmaker.markets.U25 = null; }
  const instance = app(async () => Response.json(data)); await instance.open();
  assert.equal(instance.cards().length, 5);
  for (const key of ['O25', 'U25']) {
    const text = instance.cards().find(card => card.dataset.market === key).textContent;
    assert.match(text, /Not captured|unavailable|—/i); assert.doesNotMatch(text, /0\.00|1\.00/);
  }
});

test('missing source timestamps remain unavailable and do not borrow another capture time', async () => {
  const data = payload();
  for (const value of [data.fixtures[0].markets.H, data.fixtures[0].bookmakers[0].markets.H]) { value.source_updated_at = null; value.collected_at = null; }
  const instance = app(async () => Response.json(data)); await instance.open();
  const card = instance.cards().find(value => value.dataset.market === 'H');
  assert.match(card.textContent, /1\.90/);
  assert.match(card.textContent, /Provider updated Time unavailable/);
  assert.match(card.textContent, /Captured Time unavailable/);
  assert.doesNotMatch(card.textContent, /1970|12:07/);
});

test('fresh data is reused briefly but refresh clears old prices and always performs a new request', async () => {
  let resolveRefresh;
  const instance = app(async (_url, _options, call) => call === 1 ? Response.json(payload()) : new Promise(resolve => { resolveRefresh = resolve; }));
  await instance.open(); instance.api.close(); await instance.open();
  assert.equal(instance.calls.length, 1);
  instance.refresh();
  assert.equal(instance.calls.length, 2);
  assert.equal(instance.cards().length, 0, 'Old quotes remained displayed during forced refresh');
  const updated = payload(); updated.fixtures[0].markets.H.price = 2.45; updated.fixtures[0].bookmakers[0].markets.H.price = 2.45;
  resolveRefresh(Response.json(updated)); await settle();
  assert.match(instance.cards().find(card => card.dataset.market === 'H').textContent, /2\.45/);
});

test('expired cache and a different endpoint both require a fresh read', async () => {
  const instance = app(async () => Response.json(payload('event-1', { generated_at: new Date(instance.clock.now()).toISOString() })));
  await instance.open(); instance.api.close(); instance.clock.advance(5 * 60000); await instance.open();
  assert.equal(instance.calls.length, 2);
  instance.api.close(); await instance.open({ endpoint: 'https://other.test/functions/v1/gerball-upcoming-fixtures' });
  assert.equal(instance.calls.length, 3, 'Cached data from another configured endpoint leaked into this request');
});

test('old and partial collections remain explicitly labelled snapshots', async () => {
  const data = payload('event-1', { collection_date: '2026-11-22', collected_at: '2026-11-22T08:00:00Z', collection_status: 'partial' });
  for (const quote of Object.values(data.fixtures[0].markets)) { quote.source_updated_at = '2026-11-22T07:45:00Z'; quote.collected_at = '2026-11-22T08:00:00Z'; }
  for (const book of data.fixtures[0].bookmakers) for (const quote of Object.values(book.markets).filter(Boolean)) { quote.source_updated_at = '2026-11-22T07:45:00Z'; quote.collected_at = '2026-11-22T08:00:00Z'; }
  const instance = app(async () => Response.json(data)); await instance.open();
  assert.match(visible(instance), /older|earlier collection|26 hours|stale/i);
  assert.match(visible(instance), /22 Nov 2026/);
  assert.match(visible(instance), /partial/i);
  assert.equal(instance.cards().length, 5);
});

test('empty and failed responses clear prices, expose no raw errors and offer recovery', async () => {
  let fail = true;
  const instance = app(async () => fail ? new Response('private database token=secret-marker', { status: 500 }) : Response.json(payload()));
  await instance.open();
  assert.equal(instance.cards().length, 0); assert.match(visible(instance), /could not|unavailable|try again/i);
  assert.doesNotMatch(visible(instance), /secret-marker|private database/);
  fail = false;
  const retry = instance.document.all().find(element => element.tagName === 'BUTTON' && /try again|retry/i.test(element.textContent));
  assert(retry, 'A failed read has no retry action'); retry.click(); await settle(); assert.equal(instance.cards().length, 5);
  const empty = app(async () => Response.json(payload('event-1', { fixtures: [], mapping: { matched_teams: 0, total_teams: 0 } })));
  await empty.open(); assert.equal(empty.cards().length, 0); assert.match(visible(empty), /no .*prices|not.*available|no .*snapshot/i);
  assert.doesNotMatch(visible(empty), /cancelled|postponed/i, 'Absence from collection must not invent a fixture status');
  const missing = app(async () => Response.json(payload('event-1', { collection_date: null, collected_at: null, collection_status: 'no_data', fixtures: [], mapping: { matched_teams: 0, total_teams: 0 } })));
  await missing.open(); assert.equal(missing.cards().length, 0); assert.match(visible(missing), /No stored collection/i);
});

test('a response for another fixture never replaces the requested fixture or shows its prices', async () => {
  const switched = payload('other-event'); switched.fixtures[0].home.provider_name = 'Unrequested club';
  const instance = app(async () => Response.json(switched)); await instance.open();
  assert.equal(instance.cards().length, 0); assert.doesNotMatch(visible(instance), /Unrequested club/);
  assert.match(instance.document.getElementById('capturedPricesTitle').textContent, /Home/);
});

test('a newer open aborts the prior request and ignores a late response even if transport ignores abort', async () => {
  const pending = new Map();
  const instance = app((url, options) => new Promise(resolve => pending.set(new URL(url).searchParams.get('event_id'), { resolve, signal: options.signal })));
  const first = instance.open({ fixture: fixture('first') });
  const secondFixture = fixture('second', { home: { provider_name: 'Second club', canonical_name: 'Second', match_status: 'exact' } });
  const second = instance.open({ fixture: secondFixture });
  assert.equal(pending.get('first').signal.aborted, true);
  pending.get('second').resolve(Response.json(payload('second', { fixtures: [secondFixture] }))); await second;
  const firstData = payload('first'); firstData.fixtures[0].home.provider_name = 'First late club';
  pending.get('first').resolve(Response.json(firstData)); await first;
  assert.match(visible(instance), /Second club/); assert.doesNotMatch(visible(instance), /First late club/);
  assert.equal(instance.cards().length, 5);
});

test('close aborts a pending request and a late completion cannot reopen or repopulate the dialog', async () => {
  let resolve;
  const instance = app(() => new Promise(done => { resolve = done; }));
  const pending = instance.open(); instance.api.close();
  assert.equal(instance.calls[0].options.signal.aborted, true);
  resolve(Response.json(payload())); await pending;
  assert.equal(dialog(instance).open, false); assert.equal(instance.cards().length, 0);
  assert.equal(instance.document.activeElement, instance.trigger);
});

test('known or newly returned started fixtures cannot display pre-match prices', async () => {
  const started = fixture('event-1', { kickoff_at: new Date(instant).toISOString() });
  const instance = app(async () => Response.json(payload('event-1', { fixtures: [], mapping: { matched_teams: 0, total_teams: 0 } }))); await instance.open({ fixture: started });
  assert.equal(instance.cards().length, 0);
  assert.match(visible(instance), /kickoff.*passed|started/i);
  const late = app(async () => Response.json(payload('event-1', { fixtures: [started] }))); await late.open();
  assert.equal(late.cards().length, 0);
  const rescheduled = app(async () => Response.json(payload())); await rescheduled.open({ fixture: started });
  assert.equal(rescheduled.cards().length, 5, 'An exact event with a newly stored future kickoff may be shown after rechecking');
  assert.match(visible(rescheduled), /20 Dec 2026/);
});

test('an open dialog clears prices at recorded kickoff without making provider or refresh requests', async () => {
  const imminent = fixture('event-1', { kickoff_at: new Date(instant + 1500).toISOString() });
  const instance = app(async () => Response.json(payload('event-1', { fixtures: [imminent] }))); await instance.open({ fixture: imminent });
  assert.equal(instance.cards().length, 5); instance.clock.advance(1500); await settle();
  assert.equal(instance.cards().length, 0); assert.match(visible(instance), /kickoff.*passed|started/i);
  assert.equal(instance.calls.length, 1);
});

test('returning to a throttled tab rechecks kickoff locally before retaining prices', async () => {
  const imminent = fixture('event-1', { kickoff_at: new Date(instant + 1500).toISOString() });
  const instance = app(async () => Response.json(payload('event-1', { fixtures: [imminent] }))); await instance.open({ fixture: imminent });
  instance.document.hidden = true; instance.clock.jump(2000);
  instance.document.hidden = false; instance.document.dispatch('visibilitychange');
  assert.equal(instance.cards().length, 0); assert.equal(instance.calls.length, 1);
  assert.match(visible(instance), /kickoff.*passed|started/i);
});

test('a timed-out read aborts and leaves a recoverable error instead of a permanent loading state', async () => {
  const instance = app((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))));
  const pending = instance.open(); instance.clock.advance(20000); await pending;
  assert.equal(instance.calls[0].options.signal.aborted, true);
  assert.equal(instance.cards().length, 0);
  assert.match(visible(instance), /could not be loaded/i);
  assert.equal(instance.document.querySelector('.cp-refresh').disabled, false);
  assert.equal(instance.document.querySelector('.cp-content').hasAttribute('aria-busy'), false);
});

test('invalid event identifiers are rejected before making a network request', async () => {
  const instance = app(async () => Response.json(payload()));
  for (const eventId of ['', 'event?other=1', 'x'.repeat(101)]) await assert.rejects(instance.open({ fixture: fixture(eventId) }));
  assert.equal(instance.calls.length, 0);
});

test('nested dialog close and Escape restore the analysis trigger while leaving its parent open', async () => {
  const instance = app(async () => Response.json(payload()));
  const parent = instance.document.createElement('dialog'); parent.id = 'fixtureAnalysis';
  const trigger = instance.document.createElement('button'); trigger.textContent = 'Captured prices';
  parent.appendChild(trigger); instance.document.body.appendChild(parent); parent.showModal(); trigger.focus();
  instance.document.documentElement.classList.add('fixture-analysis-open');
  await instance.open({ returnFocus: trigger });
  assert.equal(parent.open, true); assert.equal(dialog(instance).open, true);
  const cancel = dialog(instance).dispatch('cancel');
  assert.equal(cancel.defaultPrevented, true); assert.equal(dialog(instance).open, false); assert.equal(parent.open, true);
  assert.equal(instance.document.activeElement, trigger);
  assert.equal(instance.document.documentElement.classList.contains('fixture-analysis-open'), true);
  await instance.open({ returnFocus: trigger }); instance.document.querySelector('.cp-close').click();
  assert.equal(instance.document.activeElement, trigger); assert.equal(parent.open, true);
  const fallback = instance.document.createElement('button'); fallback.className = 'fa-close'; parent.appendChild(fallback);
  await instance.open({ returnFocus: trigger }); trigger.remove(); instance.api.close();
  assert.equal(instance.document.activeElement, fallback, 'A removed trigger must fall back to the still-open analysis dialog');
});
