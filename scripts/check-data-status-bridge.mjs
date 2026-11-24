import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync(new URL('../assets/data-status-bridge.js', import.meta.url), 'utf8');
function load(view = 'screening') {
  const dataView = { hidden: view !== 'data' }, overviewView = { hidden: view !== 'overview' }, container = {}, overviewContainer = {}, handlers = {}, calls = [];
  let activates = 0, navigationClicks = 0;
  const window = { addEventListener(name, handler) { handlers[name] = handler; }, GerballDataStatus: { init(options) { calls.push(options); return { activate() { activates++; } }; } } };
  const document = { getElementById(id) { return { 'view-data': dataView, 'view-overview': overviewView, dataStatus: container, overviewDataStatus: overviewContainer }[id]; }, querySelector(selector) { assert.equal(selector, 'button.nav-item[data-view="data"]'); return { click() { navigationClicks++; } }; } };
  vm.runInNewContext(source, { window, document, CLOUD_URL: 'https://project.test', CLOUD_KEY: 'sb_publishable_existing' });
  return { calls, handlers, container, overviewContainer, activateCount: () => activates, navigationCount: () => navigationClicks };
}

test('data status initializes only on overview or data and both share one controller', () => {
  const app = load();
  app.handlers['gerball:viewchange']({ detail: { view: 'tracking' } }); assert.equal(app.calls.length, 0);
  app.handlers['gerball:viewchange']({ detail: { view: 'overview' } }); assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0].container, app.container); assert.equal(app.calls[0].overviewContainer, app.overviewContainer);
  assert.equal(app.calls[0].endpoint, 'https://project.test/functions/v1/gerball-data-status'); assert.equal(app.calls[0].apiKey, 'sb_publishable_existing');
  app.handlers['gerball:viewchange']({ detail: { view: 'data' } }); app.handlers['gerball:viewchange']({ detail: { view: 'overview' } });
  assert.equal(app.calls.length, 1); assert.equal(app.activateCount(), 2);
  app.calls[0].onOpenData(); assert.equal(app.navigationCount(), 1);
});

test('overview and direct data routes each initialize immediately', () => {
  assert.equal(load('overview').calls.length, 1);
  assert.equal(load('data').calls.length, 1);
});
