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
  click() { if (this.tagName === 'A' && this.download) this.document.downloads?.push({ filename: this.download, href: this.href }); return this.dispatch('click'); }
  setCustomValidity(message) { this.validationMessage = message; }
  reportValidity() { return !this.validationMessage; }
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


function dayReport(date, records, { query = '', offset = 0, limit = 250, scope = 'date' } = {}) {
  const settled = records.filter(row => row.status === 'settled');
  const unitsSettled = settled.reduce((sum, row) => sum + row.units, 0);
  const netUnits = Math.round(settled.reduce((sum, row) => sum + Number(row.net_units), 0) * 100) / 100;
  return {
    version: scope === 'today' ? 'paper_today_v1' : 'paper_day_v1', query, date,
    total_records: records.length, records: records.slice(offset, offset + limit), limit, offset,
    summary: {
      bets: records.length, settled: settled.length,
      pending: records.filter(row => row.status === 'pending').length,
      review: records.filter(row => row.status === 'review').length,
      won: settled.filter(row => row.won).length, lost: settled.filter(row => !row.won).length,
      units_recommended: records.reduce((sum, row) => sum + row.units, 0),
      units_settled: unitsSettled, net_units: netUnits,
      roi_pct: unitsSettled ? Math.round(netUnits / unitsSettled * 10000) / 100 : null,
    },
  };
}

function dayResponse(call, state, records) {
  const params = call.url.searchParams, scope = params.get('scope');
  const date = scope === 'today' ? dates.day(state.now()) : params.get('date');
  const query = (params.get('q') || '').trim().toLowerCase();
  const matching = records.filter(row => dates.day(row.kickoff_at) === date).filter(row => !query ||
    [row.home,row.away,row.league,row.market,row.bookmaker,row.status,row.event_id].some(value=>String(value??'').toLowerCase().includes(query)));
  return Response.json(dayReport(date, matching, { query, scope, offset: Number(params.get('offset') || 0), limit: Number(params.get('limit') || 250) }));
}

async function chooseDate(ui, day) {
  ui.scope().value = 'date'; await ui.scope().dispatch('change'); await flush();
  assert(ui.date(), 'History calendar should be available near the top of Paper bets');
  ui.date().value = day; await ui.date().dispatch('change'); await flush();
}

function app(fetchImpl, initial = '2026-11-25T13:00:00Z', visible = true, { scopedFetch } = {}) {
  let now = Date.parse(initial), timerId = 0;
  const timers = new Map(), windowEvents = new Map(), documentEvents = new Map(), calls = [], scopedCalls = [], downloads = [], blobs = new Map();
  let lastReport = null;
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const document = { hidden: false, visibilityState: 'visible', activeElement: null, downloads };
  class ObjectURL extends URL {
    static createObjectURL(blob) { const url = 'blob:test-' + blobs.size; blobs.set(url, blob); return url; }
    static revokeObjectURL(url) { blobs.delete(url); }
  }
  document.createElement = tag => new Element(tag, document);
  document.documentElement = document.createElement('html'); document.body = document.createElement('body'); document.documentElement.append(document.body);
  const view = document.createElement('section'); view.id = 'view-picks'; view.hidden = !visible; document.body.append(view);
  const holder = document.createElement('div'); holder.id = 'paperBets'; view.append(holder);
  document.getElementById = id => document.documentElement.querySelectorAll('#' + id)[0] || null;
  document.addEventListener = (name, fn) => { if (!documentEvents.has(name)) documentEvents.set(name, []); documentEvents.get(name).push(fn); };
  const schedule = (fn, delay = 0, interval = 0) => { const id = ++timerId; timers.set(id, { fn, at: now + Math.max(0, Number(delay) || 0), interval }); return id; };
  const context = vm.createContext({ document, Date: Clock, Intl, URL: ObjectURL, Blob, AbortController, AbortSignal,
    CLOUD_URL: 'https://project.test', CLOUD_KEY: 'test-public-key',
    setTimeout: (fn, delay) => schedule(fn, delay), clearTimeout: id => timers.delete(id),
    setInterval: (fn, delay) => schedule(fn, delay, delay), clearInterval: id => timers.delete(id),
    addEventListener(name, fn) { if (!windowEvents.has(name)) windowEvents.set(name, []); windowEvents.get(name).push(fn); },
    fetch(url, options = {}) {
      const call = { url: new URL(url), options };
      if (['today', 'date'].includes(call.url.searchParams.get('scope'))) {
        scopedCalls.push(call);
        if (scopedFetch) return Promise.resolve(scopedFetch(call, api));
        const selectedDay = call.url.searchParams.get('scope') === 'today' ? dates.day(now) : call.url.searchParams.get('date');
        const query = (call.url.searchParams.get('q') || '').trim().toLowerCase();
        const records = (lastReport?.records || []).filter(b => dates.day(b.kickoff_at) === selectedDay).filter(b =>
          !query || [b.home,b.away,b.market,b.bookmaker,b.status,b.fixture_date,b.event_id].some(x=>String(x??'').toLowerCase().includes(query)));
        const offset = Number(call.url.searchParams.get('offset') || 0);
        const limit = Number(call.url.searchParams.get('limit') || 250);
        return Promise.resolve(Response.json(dayReport(selectedDay, records, { query, offset, limit, scope: call.url.searchParams.get('scope') })));
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
    calls, scopedCalls, context, document, view, holder, timers, downloads, blobs, now: () => now,
    find: className => holder.querySelectorAll('.' + className),
    cards: () => holder.querySelectorAll('.pb-match'),
    button: text => holder.querySelectorAll('button').find(button => button.textContent === text),
    search: () => document.getElementById('pb-search'),
    selector: () => holder.querySelectorAll('select').find(node => node.attributes.get('aria-label') === 'Show assessments'),
    date: () => document.getElementById('pb-ledger-date'),
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
 const control=ui.holder.querySelectorAll('select').find(node=>node.attributes.get('aria-label')==='Show price freshness');
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

test('history calendar selects UK kickoff dates, exposes outcomes, and preserves lifetime totals', async () => {
  const oldDay = '2026-11-24', kickoff_at = oldDay + 'T20:00:00Z';
  const records = [
    record('Won recorded bet', { kickoff_at, units: 3, odds: 2.5, net_units: 4.5 }),
    record('Lost recorded bet', { kickoff_at, units: 1, won: false, net_units: -1, home_goals: 0, away_goals: 2 }),
    record('Pending recorded bet', { kickoff_at, status: 'pending', won: null, net_units: null, home_goals: null, away_goals: null }),
    record('Review recorded bet', { kickoff_at, status: 'review', won: null, net_units: null, home_goals: null, away_goals: null }),
    record('Today recorded bet', { kickoff_at: '2026-11-25T20:00:00Z' }),
  ];
  const ui = app((call, state) => Response.json(report(state.now(), [fixture()], { records, total_records: records.length })), undefined, true, {
    scopedFetch: (call, state) => dayResponse(call, state, records),
  });
  await flush();
  assert.equal(ui.scope().value, 'today'); assert.equal(ui.date().max, '2026-11-25');
  const lifetime = ui.find('pb-dashboard')[0].textContent;
  await chooseDate(ui, oldDay);
  assert.equal(ui.find('pb-assessments')[0].hidden, true, 'Historical viewing must not present today’s recommendations as historical bets');
  const request = ui.scopedCalls.at(-1).url.searchParams;
  assert.equal(request.get('scope'), 'date'); assert.equal(request.get('date'), oldDay);
  const ledger = ui.find('pb-ledger')[0];
  assert.match(ledger.textContent, /Won recorded bet/); assert.match(ledger.textContent, /Lost recorded bet/);
  assert.doesNotMatch(ledger.textContent, /Today recorded bet/);
  const rows = ledger.querySelectorAll('tr');
  const won = rows.find(row => row.textContent.includes('Won recorded bet'));
  const lost = rows.find(row => row.textContent.includes('Lost recorded bet'));
  const pending = rows.find(row => row.textContent.includes('Pending recorded bet'));
  const review = rows.find(row => row.textContent.includes('Review recorded bet'));
  assert.match(won.textContent, /Won/); assert.match(won.textContent, /2\s*[-–]\s*0/); assert.match(won.textContent, /\+4\.50/);
  assert.match(lost.textContent, /Lost/); assert.match(lost.textContent, /0\s*[-–]\s*2/); assert.match(lost.textContent, /-1\.00/);
  assert.match(pending.textContent, /Pending/); assert.doesNotMatch(pending.textContent, /null|\+0\.00|-0\.00/);
  assert.match(review.textContent, /Needs review/); assert.doesNotMatch(review.textContent, /null|\+0\.00|-0\.00/);
  assert.equal(ui.find('pb-dashboard')[0].textContent, lifetime, 'Daily browsing must preserve lifetime P&L');
  const daySummary = ui.find('pb-day-summary')[0];
  assert(daySummary, 'Date-scoped performance is labeled separately from lifetime totals');
  assert.match(daySummary.textContent, /3\.50/);
  assert.match(daySummary.textContent, /87\.50%|87\.5%/);
});

test('date paging, search and refresh retain the selected day and whole-day summary', async () => {
  const records = Array.from({ length: 501 }, (_, index) => record('Arsenal saved ' + index, {
    kickoff_at: '2026-11-24T20:00:00Z', units: 1, odds: 2, net_units: 1,
  }));
  const ui = app((call, state) => Response.json(report(state.now(), [], { records: records.slice(0, 250), total_records: 501 })), undefined, true, {
    scopedFetch: (call, state) => dayResponse(call, state, records),
  });
  await flush(); await chooseDate(ui, '2026-11-24');
  const fullSummary = ui.find('pb-day-summary')[0].textContent;
  assert.match(fullSummary, /501/); assert.match(fullSummary, /501\.00/);
  assert.doesNotMatch(fullSummary, /250\.00/, 'Summary must include the full day, not the first table page');
  ui.search().value = 'Arsenal'; await ui.search().dispatch('input'); await ui.advance(250);
  await ui.button('Next page').dispatch('click'); await flush();
  assert.match(ui.find('pb-ledger')[0].textContent, /Arsenal saved 250/);
  assert.doesNotMatch(ui.find('pb-ledger')[0].textContent, /Arsenal saved 0\b/);
  const pageRequest = ui.scopedCalls.at(-1).url.searchParams;
  assert.equal(pageRequest.get('date'), '2026-11-24'); assert.equal(pageRequest.get('q'), 'arsenal');
  assert.equal(pageRequest.get('offset'), '250');
  await ui.advance(5 * 60000 + 30000);
  const refresh = ui.scopedCalls.at(-1).url.searchParams;
  assert.equal(refresh.get('date'), '2026-11-24'); assert.equal(refresh.get('q'), 'arsenal');
  assert.equal(refresh.get('offset'), '250'); assert.equal(ui.date().value, '2026-11-24');
  assert.match(ui.find('pb-day-summary')[0].textContent, /501\.00/);
  await ui.button('Clear').dispatch('click'); await flush(); await ui.advance(250);
  assert.equal(ui.date().value, '2026-11-24'); assert.equal(ui.scopedCalls.at(-1).url.searchParams.get('offset'), '0');
  assert.match(ui.find('pb-ledger')[0].textContent, /Arsenal saved 0\b/);
});

test('a late request for another history date cannot replace the selected date', async () => {
  const old = deferred();
  const records = [record('Current selected day', { kickoff_at: '2026-11-24T20:00:00Z' })];
  const ui = app((call, state) => Response.json(report(state.now(), [])), undefined, true, {
    scopedFetch: (call, state) => call.url.searchParams.get('date') === '2026-11-23' ? old.promise : dayResponse(call, state, records),
  });
  await flush(); await chooseDate(ui, '2026-11-24');
  ui.date().value = '2026-11-23'; ui.date().dispatch('change'); await flush();
  const obsolete = ui.scopedCalls.at(-1); assert.equal(obsolete.url.searchParams.get('date'), '2026-11-23');
  ui.date().value = '2026-11-24'; await ui.date().dispatch('change'); await flush();
  assert.equal(obsolete.options.signal.aborted, true);
  assert.match(ui.find('pb-ledger')[0].textContent, /Current selected day/);
  old.resolve(Response.json(dayReport('2026-11-23', [record('Obsolete old date', { kickoff_at: '2026-11-23T20:00:00Z' })]))); await flush();
  assert.equal(ui.date().value, '2026-11-24');
  assert.match(ui.find('pb-ledger')[0].textContent, /Current selected day/);
  assert.doesNotMatch(ui.find('pb-ledger')[0].textContent, /Obsolete old date/);
});

test('a selected historical date stays fixed across GMT and BST midnight, while Today rolls forward', async () => {
  for (const [initial, historicalDay, nextDay] of [
    ['2026-11-25T23:59:40Z', '2026-11-24', '2026-11-26'],
    ['2026-07-12T22:59:40Z', '2026-07-11', '2026-07-13'],
  ]) {
    const records = [record('Earlier recorded bet', { kickoff_at: historicalDay + 'T20:00:00Z' })];
    const ui = app((call, state) => Response.json(report(state.now(), [])), initial, true, {
      scopedFetch: (call, state) => dayResponse(call, state, records),
    });
    await flush(); await chooseDate(ui, historicalDay); await ui.advance(20000);
    assert.equal(ui.date().value, historicalDay, 'Midnight must not change an explicitly chosen history date');
    assert.equal(ui.scopedCalls.at(-1).url.searchParams.get('date'), historicalDay);
    assert.match(ui.find('pb-ledger')[0].textContent, /Earlier recorded bet/);
    assert.equal(ui.date().max, nextDay);
    await ui.button('Today').dispatch('click'); await flush();
    assert.equal(ui.scope().value, 'today'); assert.equal(ui.date().value, nextDay);
    assert.equal(ui.find('pb-assessments')[0].hidden, false);
    assert.equal(ui.scopedCalls.at(-1).url.searchParams.get('scope'), 'today');
  }
});

test('day navigation cannot move into the future and valid days can be reached across month changes', async () => {
  const ui = app((call, state) => Response.json(report(state.now(), [])), '2026-03-01T13:00:00Z');
  await flush(); assert.equal(ui.button('Next day').disabled, true);
  await ui.button('Previous day').dispatch('click'); await flush();
  assert.equal(ui.date().value, '2026-02-28');
  assert.equal(ui.scopedCalls.at(-1).url.searchParams.get('date'), '2026-02-28');
  assert.equal(ui.button('Next day').disabled, false);
  await ui.button('Next day').dispatch('click'); await flush();
  assert.equal(ui.date().value, '2026-03-01'); assert.equal(ui.button('Next day').disabled, true);
  const before = ui.scopedCalls.length;
  ui.date().value = '2026-03-02'; await ui.date().dispatch('change'); await flush();
  assert(!ui.scopedCalls.slice(before).some(call => call.url.searchParams.get('date') === '2026-03-02'), 'Future dates must not be requested');
});

test('date CSV export keeps its selected date and search even if the view changes mid-download', async () => {
  const records = Array.from({ length: 1001 }, (_, index) => record('Export old-day Arsenal ' + index, {
    kickoff_at: '2026-11-24T20:00:00Z', units: 1, odds: 2, net_units: 1,
  }));
  const laterPage = deferred(); let laterCall = null;
  const ui = app((call, state) => Response.json(report(state.now(), [], { records: records.slice(0, 250), total_records: records.length })), undefined, true, {
    scopedFetch: (call, state) => {
      if (call.url.searchParams.get('limit') === '1000' && call.url.searchParams.get('offset') === '1000') {
        laterCall = call; return laterPage.promise;
      }
      return dayResponse(call, state, records);
    },
  });
  await flush(); await chooseDate(ui, '2026-11-24');
  ui.search().value = 'arsenal'; await ui.search().dispatch('input'); await ui.advance(250);
  const button = ui.holder.querySelectorAll('button').find(node => /^Export/.test(node.textContent));
  const exporting = button.dispatch('click'); await flush();
  assert(laterCall, 'Export should fetch the second page of the selected day');
  ui.date().value = '2026-11-23'; await ui.date().dispatch('change'); await flush();
  laterPage.resolve(dayResponse(laterCall, ui, records)); await exporting; await flush();
  const exportRequests = ui.scopedCalls.filter(call => call.url.searchParams.get('limit') === '1000');
  assert.equal(exportRequests.length, 2);
  for (const call of exportRequests) {
    assert.equal(call.url.searchParams.get('date'), '2026-11-24');
    assert.equal(call.url.searchParams.get('q'), 'arsenal');
  }
  assert.equal(ui.downloads.length, 1);
  assert.match(ui.downloads[0].filename, /2026-11-24/);
  const csv = await ui.blobs.get(ui.downloads[0].href).text();
  assert.match(csv, /Export old-day Arsenal 0/); assert.match(csv, /Export old-day Arsenal 1000/);
  assert.equal(csv.split('\r\n').length, 1002, 'All saved bets and one header are exported exactly once');
});

test('Today CSV pins the kickoff date when UK midnight occurs during a multi-page download', async () => {
  const records = Array.from({ length: 1001 }, (_, index) => record('Today export ' + index, {
    kickoff_at: '2026-11-25T20:00:00Z', units: 1, odds: 2, net_units: 1,
  }));
  const laterPage = deferred(); let laterCall = null;
  const ui = app((call, state) => Response.json(report(state.now(), [], { records: records.slice(0, 250), total_records: records.length })), '2026-11-25T23:59:40Z', true, {
    scopedFetch: (call, state) => {
      if (call.url.searchParams.get('limit') === '1000' && call.url.searchParams.get('offset') === '1000') {
        laterCall = call; return laterPage.promise;
      }
      return dayResponse(call, state, records);
    },
  });
  await flush();
  const button = ui.holder.querySelectorAll('button').find(node => /^Export/.test(node.textContent));
  const exporting = button.dispatch('click'); await flush();
  assert(laterCall); await ui.advance(20000);
  assert.equal(ui.date().value, '2026-11-26', 'The Today view may roll forward during export');
  laterPage.resolve(dayResponse(laterCall, ui, records)); await exporting; await flush();
  for (const call of ui.scopedCalls.filter(call => call.url.searchParams.get('limit') === '1000')) {
    assert.equal(call.url.searchParams.get('scope'), 'date');
    assert.equal(call.url.searchParams.get('date'), '2026-11-25', 'Every export page uses the original day');
  }
  assert.equal(ui.downloads.length, 1); assert.match(ui.downloads[0].filename, /2026-11-25/);
  const csv = await ui.blobs.get(ui.downloads[0].href).text();
  assert.equal(csv.split('\r\n').length, 1002); assert.match(csv, /Today export 1000/);
});

test('a delayed automatic report refresh cannot undo date-ledger pagination chosen while it was loading', async () => {
  const records = Array.from({ length: 501 }, (_, index) => record('History page bet ' + index, {
    kickoff_at: '2026-11-24T20:00:00Z', units: 1, odds: 2, net_units: 1,
  }));
  const refreshedReport = deferred(); let reports = 0;
  const ui = app((call, state) => ++reports === 1
    ? Response.json(report(state.now(), [], { records: records.slice(0, 250), total_records: records.length }))
    : refreshedReport.promise, undefined, true, {
    scopedFetch: (call, state) => dayResponse(call, state, records),
  });
  await flush(); await chooseDate(ui, '2026-11-24');
  assert.equal(ui.button('Previous page').disabled, true);
  await ui.advance(5 * 60000);
  assert.equal(reports, 2, 'The full report is refreshing in the background');
  await ui.button('Next page').dispatch('click'); await flush();
  assert.match(ui.find('pb-ledger')[0].textContent, /History page bet 250/);
  assert.equal(ui.scopedCalls.at(-1).url.searchParams.get('offset'), '250');
  refreshedReport.resolve(Response.json(report(ui.now(), [], { records: records.slice(0, 250), total_records: records.length })));
  await flush();
  assert.equal(ui.date().value, '2026-11-24');
  assert.equal(ui.scopedCalls.at(-1).url.searchParams.get('offset'), '250', 'The late report must refresh the user’s current page');
  assert.equal(ui.button('Previous page').disabled, false);
  assert.match(ui.find('pb-ledger')[0].textContent, /History page bet 250/);
  assert.doesNotMatch(ui.find('pb-ledger')[0].textContent, /History page bet 0\b/);
});
