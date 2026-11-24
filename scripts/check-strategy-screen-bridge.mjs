import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync(new URL('../assets/strategy-screen-bridge.js', import.meta.url), 'utf8');

function load(hidden = true) {
  const view = { hidden }, container = {}, handlers = {}, calls = [];
  let activates = 0, analysis;
  const window = {
    addEventListener(name, handler) { handlers[name] = handler; },
    GerballStrategyScreen: { init(options) { calls.push(options); return { activate() { activates++; } }; } },
    GerballFixtureAnalysis: { open(options) { analysis = options; } },
  };
  const document = { getElementById(id) { return id === 'view-screening' ? view : id === 'strategyScreen' ? container : null; } };
  vm.runInNewContext(source, { window, document, CLOUD_URL: 'https://project.test', CLOUD_KEY: 'sb_publishable_existing', tableNames: { E0: 'Premier League' } });
  return { view, container, calls, handlers, activateCount: () => activates, analysis: () => analysis };
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
