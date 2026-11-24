import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync(new URL('../assets/recorded-screens-bridge.js', import.meta.url), 'utf8');
function load(hidden = true) {
  const view = { hidden }, container = {}, handlers = {}, calls = [];
  let activates = 0;
  const window = {
    addEventListener(name, handler) { handlers[name] = handler; },
    GerballRecordedScreens: { init(options) { calls.push(options); return { activate() { activates++; } }; } },
  };
  const document = { getElementById(id) { return id === 'view-tracking' ? view : id === 'recordedScreens' ? container : null; } };
  vm.runInNewContext(source, { window, document, CLOUD_URL: 'https://project.test', CLOUD_KEY: 'sb_publishable_existing', tableNames: { E0: 'Premier League' } });
  return { container, calls, handlers, activateCount: () => activates };
}

test('recorded screens load on their own view and refresh on returning', () => {
  const app = load();
  app.handlers['gerball:viewchange']({ detail: { view: 'screening' } });
  assert.equal(app.calls.length, 0);
  app.handlers['gerball:viewchange']({ detail: { view: 'tracking' } });
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0].container, app.container);
  assert.equal(app.calls[0].apiKey, 'sb_publishable_existing');
  assert.equal(app.calls[0].endpoint, 'https://project.test/functions/v1/gerball-recorded-screens');
  assert.equal(app.calls[0].leagues.length, 18);
  app.handlers['gerball:viewchange']({ detail: { view: 'tracking' } });
  assert.equal(app.calls.length, 1);
  assert.equal(app.activateCount(), 1);
});

test('a directly opened recorded-screen route initializes immediately', () => {
  const app = load(false);
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0].leagues[0][1], 'Premier League');
});
