import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../assets/upcoming.js', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

class Element {
  constructor(tag, document) {
    this.tagName = tag.toUpperCase(); this.document = document; this.children = []; this.parentElement = null;
    this.listeners = new Map(); this.attributes = new Map(); this.dataset = {}; this.className = ''; this.style = {};
    this._value = ''; this.text = ''; this.hidden = false; this.disabled = false; this.open = false;
    this.classList = { add: name => { this.className += ' ' + name; }, remove: name => { this.className = this.className.split(/\s+/).filter(value => value !== name).join(' '); } };
  }
  set value(value) { this._value = String(value); }
  get value() { return this._value; }
  set textContent(value) { this.replaceChildren(); this.text = String(value); }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(' '); }
  appendChild(child) { child.parentElement = this; this.children.push(child); if (this.tagName === 'SELECT' && this.children.length === 1) this.value = child.value; return child; }
  append(...children) { children.forEach(child => this.appendChild(child)); }
  replaceChildren(...children) { this.children.forEach(child => { child.parentElement = null; }); this.children = []; this.text = ''; if (this.tagName === 'SELECT') this.value = ''; this.append(...children); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(name, listener) { if (!this.listeners.has(name)) this.listeners.set(name, []); this.listeners.get(name).push(listener); }
  dispatch(name) { return Promise.all((this.listeners.get(name) || []).map(listener => listener({ target: this, preventDefault() {} }))); }
  focus() { this.document.activeElement = this; }
  get isConnected() { return this === this.document.documentElement || Boolean(this.parentElement?.isConnected); }
  querySelectorAll(selector) {
    const all = [];
    const walk = node => { for (const child of node.children) { all.push(child); walk(child); } }; walk(this);
    const data = selector.match(/^\[data-([a-z-]+)\]$/);
    if (data) { const key = data[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()); return all.filter(node => node.dataset[key] !== undefined); }
    if (selector.startsWith('.')) return all.filter(node => node.className.split(/\s+/).includes(selector.slice(1)));
    return all.filter(node => node.tagName === selector.toUpperCase());
  }
}

function app(fetchImpl, initial = '2026-11-24T13:00:00Z') {
  let now = Date.parse(initial), timer;
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const document = { hidden: false };
  document.createElement = tag => new Element(tag, document);
  document.documentElement = document.createElement('html'); document.body = document.createElement('body'); document.documentElement.appendChild(document.body);
  const container = document.createElement('div'); container.id = 'upcomingFixtures'; document.body.appendChild(container);
  document.getElementById = id => id === container.id ? container : container.querySelectorAll('select').concat(container.querySelectorAll('input')).find(node => node.id === id);
  document.activeElement = document.body;
  const calls = [];
  const context = vm.createContext({ document, Intl, Date: Clock, URL, AbortController,
    location: { href: 'https://gerball.co.uk/#upcoming' },
    setTimeout: () => 1, clearTimeout() {}, setInterval(fn) { timer = fn; return 1; }, clearInterval() {},
    fetch(url, options) { calls.push({ url: new URL(url), options }); return fetchImpl(url, options); },
  });
  vm.runInContext(source, context);
  const api = context.GerballUpcoming.init({ container, endpoint: 'https://project.test/fixtures' });
  return { api, calls, container, document, now: () => now, advance(ms) { now += ms; }, tick() { timer(); }, find: className => container.querySelectorAll('.' + className), control: name => document.getElementById('upcoming-' + name) };
}

function fixture(id = 'event-1', overrides = {}) {
  return { event_id: id, league_code: 'E0', league_name: 'Premier League', kickoff_at: '2026-11-28T15:00:00Z',
    home: { provider_name: 'Home ' + id, canonical_name: 'Home ' + id, match_status: 'exact' }, away: { provider_name: 'Away ' + id, canonical_name: 'Away ' + id, match_status: 'exact' },
    markets: { H: { price: 2.1, bookmaker_name: 'Stored Bookmaker', source_updated_at: '2026-11-24T11:59:00Z', collected_at: '2026-11-24T12:00:00Z' } },
    bookmaker_count: 1, bookmakers_loaded: false, ...overrides };
}

function payload(now, fixtures = [fixture()], collectedAt = '2026-11-24T12:00:00Z') {
  return { generated_at: new Date(now).toISOString(), collection_date: '2026-11-24', collected_at: collectedAt, collection_status: 'completed', fixtures };
}

function detailed(now, item = fixture(), collectedAt = '2026-11-24T12:00:00Z', price = 2.1) {
  return payload(now, [{ ...item, bookmakers_loaded: true, markets: { H: { ...item.markets.H, price } },
    bookmakers: [{ key: 'stored', name: 'Stored Bookmaker', markets: { H: { ...item.markets.H, price } } }] }], collectedAt);
}

async function openDetails(application, index = 0) {
  const details = application.find('upcoming-details')[index]; details.open = true; await details.dispatch('toggle'); await flush(); return details;
}

test('activation coalesces a pending load and refreshes after five minutes without background polling', async () => {
  const first = deferred(); let application, lists = 0;
  application = app(() => ++lists === 1 ? first.promise : Promise.resolve(Response.json(payload(application.now()))));
  const one = application.api.activate(), two = application.api.activate();
  assert.equal(one, two);
  await flush(); assert.equal(application.calls.length, 1);
  first.resolve(Response.json(payload(application.now()))); await one;
  application.advance(299999); await application.api.activate(); assert.equal(application.calls.length, 1);
  application.advance(1); application.tick(); assert.equal(application.calls.length, 1, 'The timer must not fetch');
  await application.api.activate(); assert.equal(application.calls.length, 2);
  await application.api.activate(); assert.equal(application.calls.length, 2, 'A completed refresh must not cause an activation loop');
});

test('a recent pre-noon response refreshes at UK noon in both GMT and BST', async () => {
  for (const before of ['2026-11-24T11:59:00Z', '2027-07-01T10:59:00Z']) {
    let application;
    application = app(() => Promise.resolve(Response.json(payload(application.now(), []))), before);
    await application.api.activate(); application.advance(60000); await application.api.activate();
    assert.equal(application.calls.length, 2, before);
    await application.api.activate(); assert.equal(application.calls.length, 2);
  }
});

test('refresh retains valid filters, expanded fixtures and the displayed page size', async () => {
  let application;
  const fixtures = Array.from({ length: 30 }, (_, index) => fixture('event-' + String(index).padStart(2, '0')));
  fixtures.push(fixture('spanish', { league_code: 'SP1', league_name: 'La Liga' }));
  application = app(url => { const id = new URL(url).searchParams.get('event_id'); return Promise.resolve(Response.json(id ? detailed(application.now(), fixtures.find(row => row.event_id === id)) : payload(application.now(), fixtures))); });
  await application.api.activate();
  for (const [name, value] of [['league', 'E0'], ['date', '2026-11-28'], ['market', 'h2h'], ['search', 'Home']]) { const control = application.control(name); control.value = value; await control.dispatch(name === 'search' ? 'input' : 'change'); }
  await application.find('upcoming-more')[0].dispatch('click'); assert.equal(application.find('upcoming-fixture').length, 30);
  await openDetails(application); assert.equal(application.find('upcoming-comparison').length, 1);
  application.advance(300000); await application.api.activate(); await flush();
  for (const [name, value] of [['league', 'E0'], ['date', '2026-11-28'], ['market', 'h2h'], ['search', 'Home']]) assert.equal(application.control(name).value, value);
  assert.equal(application.find('upcoming-fixture').length, 30);
  assert.equal(application.find('upcoming-details')[0].open, true);
  assert.equal(application.find('upcoming-comparison').length, 1);
  const eventCalls = application.calls.filter(call => call.url.searchParams.has('event_id'));
  assert.equal(eventCalls.length, 2, 'An expanded comparison must reload after a list refresh');
  assert.equal(eventCalls[0].url.searchParams.get('league'), 'E0');
  assert.equal(eventCalls[0].url.searchParams.get('days'), '31');
});

test('returning prunes newly started fixtures immediately, including when refresh fails', async () => {
  let application, lists = 0;
  application = app(() => ++lists === 1 ? Promise.resolve(Response.json(payload(application.now(), [fixture('starting', { kickoff_at: '2026-11-24T13:04:00Z' }), fixture('later')]))) : Promise.reject(new Error('offline')));
  await application.api.activate(); assert.equal(application.find('upcoming-fixture').length, 2);
  application.advance(4 * 60000 + 1); await application.api.activate();
  assert.equal(application.find('upcoming-fixture').length, 1, 'Started cards must be pruned even while the response remains fresh');
  assert.equal(lists, 1);
  application.advance(2 * 60000); const request = application.api.activate();
  assert.equal(application.find('upcoming-fixture').length, 1, 'Started cards must be removed before the network response');
  await request;
  assert.equal(application.find('upcoming-fixture').length, 1);
  assert.match(application.container.textContent, /previously loaded snapshot/);
});

test('same-day collection revision changes cannot mix newer bookmaker prices with older cards', async () => {
  let application;
  application = app(url => Promise.resolve(Response.json(new URL(url).searchParams.has('event_id') ? detailed(application.now(), fixture(), '2026-11-24T12:05:00Z', 9.9) : payload(application.now()))));
  await application.api.activate(); await openDetails(application);
  assert.equal(application.find('upcoming-comparison').length, 0);
  assert.match(application.container.textContent, /snapshot has changed/);
  assert.equal(application.find('upcoming-price')[0].textContent, '2.10');
  assert.doesNotMatch(application.container.textContent, /9\.90/);
  assert.ok(application.find('upcoming-retry').some(button => button.textContent === 'Refresh fixtures'));
});

test('an ignored-abort response cannot repopulate cache or delete a newer same-key request', async () => {
  let application, details = 0; const old = deferred(), current = deferred();
  application = app(url => new URL(url).searchParams.has('event_id') ? (++details === 1 ? old.promise : current.promise) : Promise.resolve(Response.json(payload(application.now()))));
  await application.api.activate(); await openDetails(application);
  const oldCall = application.calls.find(call => call.url.searchParams.has('event_id'));
  await application.api.reload(); await flush();
  assert.equal(oldCall.options.signal.aborted, true);
  assert.equal(details, 2);
  old.resolve(Response.json(detailed(application.now(), fixture(), undefined, 9.9))); await flush();
  const market = application.control('market'); market.value = 'h2h'; await market.dispatch('change'); await flush();
  assert.equal(details, 2, 'A late old cleanup must not remove the current pending request');
  current.resolve(Response.json(detailed(application.now(), fixture(), undefined, 2.1))); await flush();
  assert.equal(application.find('upcoming-comparison').length, 1);
  assert.match(application.find('upcoming-comparison')[0].textContent, /2\.10/);
  assert.doesNotMatch(application.container.textContent, /9\.90/);
  market.value = 'all'; await market.dispatch('change'); await flush(); assert.equal(details, 2, 'The accepted current response can be reused');
});

test('a cancelled comparison remains retryable when the list refresh fails', async () => {
  let application, lists = 0, details = 0; const old = deferred();
  application = app(url => {
    if (new URL(url).searchParams.has('event_id')) return ++details === 1 ? old.promise : Promise.resolve(Response.json(detailed(application.now())));
    return ++lists === 1 ? Promise.resolve(Response.json(payload(application.now()))) : Promise.reject(new Error('offline'));
  });
  await application.api.activate(); await openDetails(application); await application.api.reload();
  old.resolve(Response.json(detailed(application.now(), fixture(), undefined, 9.9))); await flush();
  assert.equal(application.find('upcoming-comparison').length, 0);
  const host = application.find('upcoming-detail-content')[0];
  assert.match(host.textContent, /cancelled/);
  assert.doesNotMatch(host.textContent, /Loading bookmaker/);
  await host.querySelectorAll('button')[0].dispatch('click'); await flush();
  assert.equal(application.find('upcoming-comparison').length, 1);
  assert.doesNotMatch(application.container.textContent, /9\.90/);
});

test('bookmaker cache remains bounded as more fixture comparisons are opened', async () => {
  let application, details = 0;
  const fixtures = Array.from({ length: 49 }, (_, index) => fixture('event-' + String(index).padStart(2, '0')));
  application = app(url => { const id = new URL(url).searchParams.get('event_id'); if (id) details++; return Promise.resolve(Response.json(id ? detailed(application.now(), fixtures.find(row => row.event_id === id)) : payload(application.now(), fixtures))); });
  await application.api.activate(); await application.find('upcoming-more')[0].dispatch('click'); await application.find('upcoming-more')[0].dispatch('click');
  for (let index = 0; index < 49; index++) await openDetails(application, index);
  assert.equal(details, 49);
  const market = application.control('market'); market.value = 'h2h'; await market.dispatch('change'); await flush();
  assert.equal(details, 50, 'The oldest of 49 comparisons must have been evicted from the 48-entry cache');
});
