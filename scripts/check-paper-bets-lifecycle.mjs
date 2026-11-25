import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const dates = require('../assets/paper-dates.js');
const dateSource = readFileSync(new URL('../assets/paper-dates.js', import.meta.url), 'utf8');
const source = readFileSync(new URL('../assets/paper-bets.js', import.meta.url), 'utf8');
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

class Element {
  constructor(tag, document) {
    this.tagName = tag.toUpperCase(); this.document = document; this.children = [];
    this.parentElement = null; this.listeners = new Map(); this.attributes = new Map();
    this.className = ''; this.dataset = {}; this.text = ''; this.value = ''; this.hidden = false; this.disabled = false;
  }
  set textContent(value) { this.replaceChildren(); this.text = String(value); }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(' '); }
  appendChild(child) { child.parentElement = this; this.children.push(child); if (this.tagName === 'SELECT' && this.children.length === 1) this.value = child.value; return child; }
  append(...children) { children.forEach(child => this.appendChild(child)); }
  replaceChildren(...children) { this.children.forEach(child => { child.parentElement = null; }); this.children = []; this.text = ''; this.append(...children); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(name, listener) { if (!this.listeners.has(name)) this.listeners.set(name, []); this.listeners.get(name).push(listener); }
  dispatch(name) { return Promise.all((this.listeners.get(name) || []).map(listener => listener({ target: this, preventDefault() {} }))); }
  focus() { this.document.activeElement = this; }
  click() { return this.dispatch('click'); }
  querySelectorAll(selector) {
    const all = []; const walk = node => { for (const child of node.children) { all.push(child); walk(child); } }; walk(this);
    if (selector.startsWith('.')) return all.filter(node => node.className.split(/\s+/).includes(selector.slice(1)));
    if (selector.startsWith('#')) return all.filter(node => node.id === selector.slice(1));
    return all.filter(node => node.tagName === selector.toUpperCase());
  }
}

function fixture(id = 'later', overrides = {}) {
  return {
    event_id: id, home: 'Home ' + id, away: 'Away ' + id, league: 'E0',
    kickoff_at: '2026-11-25T20:00:00Z', fixture_date: '2026-11-25',
    recorded_at: '2026-11-25T12:15:00Z', quote_collected_at: '2026-11-25T12:00:00Z',
    quote_updated_at: '2026-11-25T11:59:00Z', market: 'H', decision: 'candidate', units: 2,
    quoted_odds: 2.1, bookmaker: 'Stored bookmaker', probability: 0.6, estimated_edge: 0.26,
    home_sample: 20, away_sample: 20, ...overrides,
  };
}

function record(id = 'history', overrides = {}) {
  return { id, home: id, away: 'Recorded opponent', kickoff_at: '2026-11-20T20:00:00Z',
    recorded_at: '2026-11-20T12:35:00Z', market: 'H', odds: 2.1, units: 2,
    bookmaker: 'Stored bookmaker', status: 'settled', home_goals: 2, away_goals: 0,
    won: true, net_units: 2.2, input: {}, ...overrides };
}

function report(now, fixtures = [fixture()], overrides = {}) {
  return { version: 'paper_ledger_v1', model_version: 'frozen_test_model', generated_at: new Date(now).toISOString(),
    summary: [{ market: 'ALL', bets: 1, settled: 1, net_units: 2.2, roi_pct: 110,
      units_recommended: 2, pending: 0, won: 1, lost: 0 }],
    max_drawdown_units: 0, total_records: 1, records: [record()], preview: { fixtures }, ...overrides };
}

function app(fetchImpl, initial = '2026-11-25T13:00:00Z', visible = true) {
  let now = Date.parse(initial), timerId = 0;
  const timers = new Map(), windowEvents = new Map(), documentEvents = new Map(), calls = [], scopedCalls = [];
  let lastReport = null;
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const document = { hidden: false, visibilityState: 'visible', activeElement: null };
  document.createElement = tag => new Element(tag, document);
  document.documentElement = document.createElement('html'); document.body = document.createElement('body'); document.documentElement.append(document.body);
  const view = document.createElement('section'); view.id = 'view-picks'; view.hidden = !visible; document.body.append(view);
  const holder = document.createElement('div'); holder.id = 'paperBets'; view.append(holder);
  document.getElementById = id => document.documentElement.querySelectorAll('#' + id)[0] || null;
  document.addEventListener = (name, fn) => { if (!documentEvents.has(name)) documentEvents.set(name, []); documentEvents.get(name).push(fn); };
  const schedule = (fn, delay = 0, interval = 0) => { const id = ++timerId; timers.set(id, { fn, at: now + Math.max(0, Number(delay) || 0), interval }); return id; };
  const context = vm.createContext({ document, Date: Clock, Intl, URL, Blob, AbortController, AbortSignal,
    CLOUD_URL: 'https://project.test', CLOUD_KEY: 'test-public-key',
    setTimeout: (fn, delay) => schedule(fn, delay), clearTimeout: id => timers.delete(id),
    setInterval: (fn, delay) => schedule(fn, delay, delay), clearInterval: id => timers.delete(id),
    addEventListener(name, fn) { if (!windowEvents.has(name)) windowEvents.set(name, []); windowEvents.get(name).push(fn); },
    fetch(url, options = {}) {
      const call = { url: new URL(url), options };
      if (call.url.searchParams.get('scope') === 'today') {
        scopedCalls.push(call);
        const query = (call.url.searchParams.get('q') || '').trim().toLowerCase();
        const records = (lastReport?.records || []).filter(b => dates.day(b.kickoff_at) === dates.day(now)).filter(b =>
          !query || [b.home,b.away,b.market,b.bookmaker,b.status,b.fixture_date,b.event_id].some(x=>String(x??'').toLowerCase().includes(query)));
        const offset = Number(call.url.searchParams.get('offset') || 0);
        const limit = Number(call.url.searchParams.get('limit') || 250);
        return Promise.resolve(Response.json({ version:'paper_today_v1',query,date:dates.day(now),total_records:records.length,records:records.slice(offset,offset+limit) }));
      }
      calls.push(call);
      return Promise.resolve(fetchImpl(call, api)).then(async response => {
        if (call.url.searchParams.get('q') === null && response?.ok) lastReport = await response.clone().json();
        return response;
      });
    },
  });
  context.window = context;
  const emit = (map, name, detail) => { for (const fn of map.get(name) || []) fn({ detail }); };
  const api = {
    calls, scopedCalls, context, document, view, holder, timers, now: () => now,
    find: className => holder.querySelectorAll('.' + className),
    cards: () => holder.querySelectorAll('.pb-match'),
    button: text => holder.querySelectorAll('button').find(button => button.textContent === text),
    search: () => document.getElementById('pb-search'),
    selector: () => holder.querySelectorAll('select')[0],
    scope: () => document.getElementById('pb-ledger-scope'),
    async activate() { view.hidden = false; emit(windowEvents, 'gerball:viewchange', { view: 'picks' }); await flush(); },
    leave() { view.hidden = true; emit(windowEvents, 'gerball:viewchange', { view: 'overview' }); },
    async visibility(hidden) { document.hidden = hidden; document.visibilityState = hidden ? 'hidden' : 'visible'; emit(documentEvents, 'visibilitychange'); await flush(); },
    async focus() { emit(windowEvents, 'focus'); await flush(); },
    async pageshow() { emit(windowEvents, 'pageshow'); await flush(); },
    jump(ms) { now += ms; },
    async advance(ms) {
      const end = now + ms; let count = 0;
      while (true) {
        const next = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        assert(++count < 2000, 'Clock checks must not enter a zero-delay loop');
        const [id, timer] = next; now = Math.max(now, timer.at); timers.delete(id);
        if (timer.interval) timers.set(id, { ...timer, at: now + timer.interval });
        timer.fn(); await flush();
      }
      now = end; await flush();
    },
  };
  vm.runInContext(dateSource, context); vm.runInContext(source, context);
  return api;
}

test('UK-day helpers reject started and invalid fixtures without changing calendar-day filtering', () => {
  const now = new Date('2026-11-25T13:00:00Z');
  const rows = [fixture('earlier', { kickoff_at: '2026-11-25T12:00:00Z' }),
    fixture('exact', { kickoff_at: now.toISOString() }), fixture('later'),
    fixture('tomorrow', { kickoff_at: '2026-11-26T12:00:00Z' }), fixture('invalid', { kickoff_at: 'invalid' }), null];
  assert.deepEqual(dates.todayOnly(rows, now).map(row => row.event_id), ['earlier', 'exact', 'later']);
  assert.deepEqual(dates.upcomingToday(rows, now).map(row => row.event_id), ['later']);
  assert.deepEqual(dates.upcomingToday(null, now), []);
  assert.deepEqual(dates.upcomingToday(rows, new Date('invalid')), []);
  assert.equal(dates.nextChangeAt(rows, now), Date.parse('2026-11-25T20:00:00Z'));
});

test('next UK midnight handles GMT, BST and both clock-change days', () => {
  for (const [now, expected] of [
    ['2026-11-25T23:59:59.999Z', '2026-11-26T00:00:00Z'],
    ['2026-07-12T22:59:59.999Z', '2026-07-12T23:00:00Z'],
    ['2026-03-29T00:30:00Z', '2026-03-29T23:00:00Z'],
    ['2026-10-25T00:30:00Z', '2026-10-26T00:00:00Z'],
  ]) assert.equal(dates.nextChangeAt([], new Date(now)), Date.parse(expected), now);
});

test('loads only when activated, coalesces activation, and filters cached started/future fixtures', async () => {
  const pending = deferred();
  const ui = app(() => pending.promise, undefined, false);
  assert.equal(ui.calls.length, 0);
  await ui.activate(); await ui.activate(); await ui.focus();
  assert.equal(ui.calls.length, 1);
  pending.resolve(Response.json(report(ui.now(), [fixture('started', { kickoff_at: '2026-11-25T12:59:00Z' }), fixture('later'), fixture('tomorrow', { kickoff_at: '2026-11-26T12:00:00Z' })])));
  await flush();
  assert.equal(ui.cards().length, 1); assert.match(ui.cards()[0].textContent, /Home later/);
  assert.match(ui.find('pb-ledger')[0].textContent, /today/i);
  assert.equal(ui.scopedCalls.length,1,"Default ledger fetches only today\'s UK fixtures");
  ui.scope().value='history';await ui.scope().dispatch('change');await flush();
  assert.match(ui.find('pb-ledger')[0].textContent, /history/);
});

test('open-page kickoff pruning occurs locally and keeps historical records and totals', async () => {
  const ui = app((call, state) => Promise.resolve(Response.json(report(state.now(), [fixture('starting', { kickoff_at: '2026-11-25T13:00:05Z' }), fixture('later')]))));
  await flush(); const metrics = ui.find('pb-dashboard')[0].textContent; const ledger = ui.find('pb-ledger')[0].textContent;
  await ui.advance(4999); assert.equal(ui.cards().length, 2);
  await ui.advance(1); assert.equal(ui.cards().length, 1); assert.match(ui.cards()[0].textContent, /Home later/);
  assert.equal(ui.calls.length, 1, 'Kickoff pruning must not require another report or odds collection');
  assert.equal(ui.find('pb-dashboard')[0].textContent, metrics);
  assert.equal(ui.find('pb-ledger')[0].textContent, ledger);
});

test('UK midnight prunes yesterday even offline and retains the saved ledger in GMT and BST', async () => {
  for (const [initial, kickoff] of [['2026-11-25T23:59:40Z', '2026-11-25T23:59:50Z'], ['2026-07-12T22:59:40Z', '2026-07-12T22:59:50Z']]) {
    let count = 0;
    const ui = app((call, state) => ++count === 1 ? Promise.resolve(Response.json(report(state.now(), [fixture('last-today', { kickoff_at: kickoff })]))) : Promise.reject(new Error('offline')), initial);
    await flush(); assert.equal(ui.cards().length, 1);
    await ui.advance(20000);
    assert.equal(ui.cards().length, 0); assert.equal(ui.calls.length, 2, 'New UK day should request its stored report');
    assert.match(ui.find('pb-status')[0].textContent, /offline|unavailable|failed/i);
    assert.match(ui.find('pb-status')[0].textContent, /previous|saved|cached|last/i);
    assert.match(ui.find('pb-ledger')[0].textContent, /today/i);
  }
});

test('refreshes after five minutes only while visible, preserving filters, search and ledger page', async () => {
  const ui = app((call, state) => {
    const query = call.url.searchParams.get('q'), offset = Number(call.url.searchParams.get('offset') || 0);
    if (query !== null) return Promise.resolve(Response.json({ version: 'paper_search_v1', query, total_records: 501, records: [record('search-page-' + offset)] }));
    return Promise.resolve(Response.json(report(state.now(), [fixture('later'), fixture('excluded', { decision: 'no_estimated_edge', units: 0 })], { total_records: 501, records: [record('full-page-' + offset)] })));
  });
  await flush();
  ui.scope().value='history'; await ui.scope().dispatch('change'); await flush();
  ui.selector().value = 'candidate'; await ui.selector().dispatch('change');
  ui.search().value = 'home'; await ui.search().dispatch('input'); await ui.advance(250);
  await ui.button('Next page').dispatch('click'); await flush();
  assert.match(ui.find('pb-ledger')[0].textContent, /search-page-250/);
  const before = ui.calls.length; await ui.advance(5 * 60000 + 30000);
  assert(ui.calls.length > before, 'An open report should refresh from stored data after five minutes');
  assert.equal(ui.search().value, 'home'); assert.equal(ui.selector().value, 'candidate');
  assert.equal(ui.cards().length, 1); assert.match(ui.find('pb-ledger')[0].textContent, /search-page-250/);
  const after = ui.calls.length; ui.leave(); await ui.advance(10 * 60000); assert.equal(ui.calls.length, after);
  await ui.activate(); assert(ui.calls.length > after); assert.match(ui.find('pb-ledger')[0].textContent, /search-page-250/);
  await ui.visibility(true); const hiddenCalls = ui.calls.length; await ui.advance(10 * 60000); assert.equal(ui.calls.length, hiddenCalls);
  await ui.visibility(false); assert(ui.calls.length > hiddenCalls);
  assert.match(ui.find('pb-ledger')[0].textContent, /search-page-250/);
});

test('automatic refresh preserves unfiltered ledger pagination and Clear returns to page one', async () => {
  const ui = app((call, state) => {
    const query = call.url.searchParams.get('q'), offset = Number(call.url.searchParams.get('offset') || 0);
    if (query !== null) return Promise.resolve(Response.json({ version: 'paper_search_v1', query, total_records: 501, records: [record('search-page-' + offset)] }));
    return Promise.resolve(Response.json(report(state.now(), [fixture()], { total_records: 501, records: [record('full-page-' + offset)] })));
  });
  await flush(); ui.scope().value='history'; await ui.scope().dispatch('change'); await flush(); await ui.button('Next page').dispatch('click'); await flush();
  assert.match(ui.find('pb-ledger')[0].textContent, /full-page-250/);
  await ui.advance(5 * 60000 + 30000); assert.match(ui.find('pb-ledger')[0].textContent, /full-page-250/);
  ui.search().value = 'home'; await ui.search().dispatch('input'); await ui.advance(250);
  await ui.button('Next page').dispatch('click'); await flush();
  await ui.button('Clear').dispatch('click'); await flush();
  assert.match(ui.find('pb-ledger')[0].textContent, /full-page-0/);
  assert.equal(ui.button('Previous page').disabled, true);
});

test('resume immediately prunes expired cards before a delayed refresh, even when that refresh fails', async () => {
  const next = deferred(); let count = 0;
  const ui = app((call, state) => ++count === 1 ? Promise.resolve(Response.json(report(state.now(), [fixture('starting', { kickoff_at: '2026-11-25T13:01:00Z' }), fixture()]))) : next.promise);
  await flush(); await ui.visibility(true); ui.jump(6 * 60000); await ui.visibility(false);
  assert.equal(ui.cards().length, 1); assert.equal(ui.calls.length, 2);
  next.reject(new Error('offline')); await flush(); assert.equal(ui.cards().length, 1);
  assert.match(ui.find('pb-status')[0].textContent, /offline|unavailable|failed/i);
});

test('a delayed response uses the current clock and an aborted obsolete response cannot overwrite newer data', async () => {
  const old = deferred(), latest = deferred(); let count = 0;
  const ui = app(() => ++count === 1 ? old.promise : latest.promise);
  ui.leave(); assert.equal(ui.calls[0].options.signal.aborted, true);
  await ui.activate(); assert.equal(ui.calls.length, 2);
  ui.jump(60000);
  latest.resolve(Response.json(report(ui.now(), [fixture('new'), fixture('started', { kickoff_at: '2026-11-25T13:00:30Z' })]))); await flush();
  assert.equal(ui.cards().length, 1); assert.match(ui.cards()[0].textContent, /Home new/);
  old.resolve(Response.json(report(ui.now(), [fixture('obsolete')]))); await flush();
  assert.equal(ui.cards().length, 1); assert.match(ui.cards()[0].textContent, /Home new/);
});

test('an ignored aborted search cannot replace the current query or restart hidden work', async () => {
  const old = deferred();
  const ui = app((call, state) => {
    const query = call.url.searchParams.get('q');
    if (query === 'first') return old.promise;
    if (query !== null) return Promise.resolve(Response.json({ version: 'paper_search_v1', query, total_records: 1, records: [record('second-match')] }));
    return Promise.resolve(Response.json(report(state.now())));
  });
  await flush(); ui.scope().value='history'; await ui.scope().dispatch('change'); await flush(); ui.search().value = 'first'; await ui.search().dispatch('input'); await ui.advance(250);
  const searchCall = ui.calls.find(call => call.url.searchParams.get('q') === 'first');
  ui.leave(); assert.equal(searchCall.options.signal.aborted, true);
  await ui.activate(); ui.search().value = 'second'; await ui.search().dispatch('input'); await ui.advance(250);
  assert.match(ui.find('pb-ledger')[0].textContent, /second-match/);
  old.resolve(Response.json({ version: 'paper_search_v1', query: 'first', total_records: 1, records: [record('obsolete-first')] })); await flush();
  assert.match(ui.find('pb-ledger')[0].textContent, /second-match/);
  assert.doesNotMatch(ui.find('pb-ledger')[0].textContent, /obsolete-first/);
});

test('quote-age messaging changes independently of frozen decisions, units and P&L', async () => {
  const saved = fixture('saved', { units: 3, quote_collected_at: '2026-11-25T11:00:00Z', quote_updated_at: '2026-11-25T10:59:00Z', recorded_at: '2026-11-25T11:15:00Z' });
  const ui = app((call, state) => Promise.resolve(Response.json(report(state.now(), [saved]))), '2026-11-25T12:59:50Z');
  await flush(); const metrics = ui.find('pb-dashboard')[0].textContent;
  assert.match(ui.cards()[0].textContent, /PAPER 3 units/);
  await ui.advance(30000);
  assert.match(ui.cards()[0].textContent, /older than 2 hours|older than two hours/i);
  assert.match(ui.cards()[0].textContent, /saved assessment/i);
  assert.match(ui.cards()[0].textContent, /PAPER 3 units/);
  assert.equal(saved.decision, 'candidate'); assert.equal(saved.units, 3);
  assert.equal(ui.find('pb-dashboard')[0].textContent, metrics);
});

test('saved odds freshness distinguishes recent, aging, stale and invalid provider timestamps',()=>{
 const now=new Date('2026-11-25T13:00:00Z'),f=fixture('price');
 const recent=dates.priceState(fixture('new',{recorded_at:'2026-11-25T12:57:00Z',quote_collected_at:'2026-11-25T12:55:00Z',quote_updated_at:'2026-11-25T12:54:00Z'}),now);
 assert.equal(recent.status,'recent');
 assert.match(recent.detail,/verify/i);
 assert.equal(dates.priceState(f,now).status,'aging');
 assert.equal(dates.priceState(fixture('old',{recorded_at:'2026-11-25T12:00:00Z',quote_collected_at:'2026-11-25T10:00:00Z',quote_updated_at:'2026-11-25T09:59:00Z'}),now).status,'old');
 assert.equal(dates.priceState(fixture('inconsistent',{quote_updated_at:'2026-11-25T12:10:00Z'}),now).status,'unverified');
 assert.equal(dates.priceState(fixture('missing',{quoted_odds:null}),now).status,'unavailable');
 assert.equal(dates.priceState(fixture('providerStale',{recorded_at:'2026-11-25T12:58:00Z',quote_collected_at:'2026-11-25T12:57:00Z',quote_updated_at:'2026-11-25T10:57:00Z'}),now).status,'old');
 assert.equal(dates.priceState(fixture('exact15',{recorded_at:'2026-11-25T12:46:00Z',quote_collected_at:'2026-11-25T12:45:00Z',quote_updated_at:'2026-11-25T12:45:00Z'}),now).status,'recent');
 assert.equal(dates.priceState(fixture('after15',{recorded_at:'2026-11-25T12:46:00Z',quote_collected_at:'2026-11-25T12:44:59Z',quote_updated_at:'2026-11-25T12:44:59Z'}),now).status,'aging');
});

test('freshness filter never changes saved recommendations, P&L or paper ledger',async()=>{
 const recent=fixture('recent',{recorded_at:'2026-11-25T12:56:00Z',quote_collected_at:'2026-11-25T12:55:00Z',quote_updated_at:'2026-11-25T12:54:00Z'});
 const aging=fixture('aging');
 const old=fixture('old',{recorded_at:'2026-11-25T11:45:00Z',quote_collected_at:'2026-11-25T10:30:00Z',quote_updated_at:'2026-11-25T10:29:00Z'});
 const ui=app((call,state)=>Promise.resolve(Response.json(report(state.now(),[recent,aging,old]))));
 await flush();
 const score=ui.find('pb-dashboard')[0].textContent, ledger=ui.find('pb-ledger')[0].textContent;
 assert.equal(ui.cards().length,3);
 assert.match(ui.find('pb-match')[0].textContent,/Recent saved quote/);
 const control=ui.holder.querySelectorAll('select')[1];
 assert(control&&control.attributes.get('aria-label')==='Show price freshness');
 control.value='recent';await control.dispatch('change');
 assert.equal(ui.cards().length,1);assert.match(ui.cards()[0].textContent,/Home recent/);
 control.value='aging';await control.dispatch('change');
 assert.equal(ui.cards().length,1);assert.match(ui.cards()[0].textContent,/Home aging/);
 control.value='old';await control.dispatch('change');
 assert.equal(ui.cards().length,1);assert.match(ui.cards()[0].textContent,/Home old/);
 control.value='all';await control.dispatch('change');
 assert.equal(ui.cards().length,3);
 assert.equal(ui.find('pb-dashboard')[0].textContent,score);
 assert.equal(ui.find('pb-ledger')[0].textContent,ledger);
});
