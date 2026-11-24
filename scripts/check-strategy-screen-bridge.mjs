import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync(new URL('../assets/strategy-screen-bridge.js', import.meta.url), 'utf8');

function load(hidden = true) {
  const view = { hidden }, container = {}, handlers = {}, calls = [];
  let activates = 0, analysis, prices;
  const window = {
    addEventListener(name, handler) { handlers[name] = handler; },
    GerballStrategyScreen: { init(options) { calls.push(options); return { activate() { activates++; } }; } },
    GerballFixtureAnalysis: { open(options) { analysis = options; } },
    GerballCapturedPrices: { open(options) { prices = options; } },
  };
  const document = { getElementById(id) { return id === 'view-screening' ? view : id === 'strategyScreen' ? container : null; } };
  vm.runInNewContext(source, { window, document, CLOUD_URL: 'https://project.test', CLOUD_KEY: 'sb_publishable_existing', tableNames: { E0: 'Premier League' } });
  return { view, container, calls, handlers, activateCount: () => activates, analysis: () => analysis, prices: () => prices };
}

test('screening initializes only on its own view and refreshes through activate on return', () => {
  const app = load();
  assert.equal(app.calls.length, 0);
  app.handlers['gerball:viewchange']({ detail: { view: 'upcoming' } });
  assert.equal(app.calls.length, 0);
  app.handlers['gerball:viewchange']({ detail: { view: 'screening' } });
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0].container, app.container);
  assert.equal(app.calls[0].apiKey, 'sb_publishable_existing');
  assert.equal(app.calls[0].endpoint, 'https://project.test/functions/v1/gerball-strategy-screen');
  assert.equal(app.calls[0].leagues.length, 18);
  assert.equal(app.calls[0].leagues[0][1], 'Premier League');
  app.handlers['gerball:viewchange']({ detail: { view: 'screening' } });
  assert.equal(app.calls.length, 1);
  assert.equal(app.activateCount(), 1);
});

test('a directly opened screen initializes and reuses the historical analysis dialog', () => {
  const app = load(false);
  assert.equal(app.calls.length, 1);
  const fixture = { event_id: 'event-1' }, returnFocus = {};
  app.calls[0].onMatchAnalysis({ fixture, returnFocus });
  assert.equal(app.analysis().fixture, fixture);
  assert.equal(app.analysis().returnFocus, returnFocus);
  assert.equal(app.analysis().endpoint, 'https://project.test/functions/v1/gerball-fixture-analysis');
});

test('screen and analysis price actions preserve the exact fixture, selected market and return focus', () => {
  const app = load(false), fixture = { event_id: 'event-31-days', league_code: 'SP1' };
  const cardTrigger = {}, analysisTrigger = {};
  app.calls[0].onCapturedPrices({ fixture, returnFocus: cardTrigger, market: 'D' });
  assert.equal(app.prices().fixture, fixture);
  assert.equal(app.prices().returnFocus, cardTrigger);
  assert.equal(app.prices().market, 'D');
  assert.equal(app.prices().endpoint, 'https://project.test/functions/v1/gerball-upcoming-fixtures');
  assert.equal(Object.hasOwn(app.prices(), 'apiKey'), false);
  app.calls[0].onMatchAnalysis({ fixture, returnFocus: cardTrigger, market: 'A' });
  app.analysis().onCapturedPrices({ fixture, returnFocus: analysisTrigger });
  assert.equal(app.prices().fixture, fixture);
  assert.equal(app.prices().returnFocus, analysisTrigger);
  assert.equal(app.prices().market, 'A');
  assert.equal(app.analysis().returnFocus, cardTrigger, 'Nested price action must retain the analysis return destination');
});
