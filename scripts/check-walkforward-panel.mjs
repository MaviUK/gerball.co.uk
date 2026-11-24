import assert from 'node:assert/strict';
import test from 'node:test';
import { createPanelHarness } from './helpers/walkforward-panel-harness.cjs';

const settings = { league: 'E0', from: '2024-08-01', to: '2025-08-16', adv: 0.5, min: 1.5, max: 4, commission: 0.02, slippage: 0.01 };
function fixtures(market) {
  const scores = {
    H: [[2, 0], [0, 1]], A: [[0, 2], [1, 0]], D: [[1, 1], [2, 0]],
    O25: [[2, 1], [1, 1]], U25: [[1, 1], [2, 1]],
  };
  return Array.from({ length: 32 }, (_, index) => {
    const [home_goals, away_goals] = scores[market][index % 2];
    return { id: index + 1, match_date: `${index < 16 ? 2024 : 2025}-08-${String(index % 16 + 1).padStart(2, '0')}`,
      season: index < 16 ? '2425' : '2526', home_team: `Home ${index}`, away_team: `Away ${index}`,
      home_prior_ppg: market === 'H' ? 2 : 1,
      away_prior_ppg: market === 'H' || market === 'D' ? 1 : 2, home_prior_games: 5, away_prior_games: 5,
      home_goals, away_goals, opening_home: 2 };
  });
}

for (const market of ['H', 'D', 'A', 'O25', 'U25']) {
  test(`${market}: actual panel tables, seasons and equity agree with independently settled records`, async () => {
    const app = createPanelHarness(fixtures(market));
    const run = await app.run({ ...settings, market });
    assert.equal(run.market, market);
    assert.equal(run.detail.length, 32);
    assert.equal(run.detail.filter(row => row.result === 'Won').length, 16);
    assert(Math.abs(run.detail.reduce((sum, row) => sum + row.net_profit, 0) - (-0.6336)) < 1e-9);
    const rows = app.rows('wfRows');
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0].slice(1), ['22', '22', '11', '50.0%', '-0.44', '-1.98%', '1.40']);
    assert.deepEqual(rows[1].slice(1), ['10', '10', '5', '50.0%', '-0.20', '-1.98%', '1.16']);
    assert.deepEqual(app.rows('wfSeasonRows')[0], ['2526', '16', '16', '16', '8', '-0.32', '-1.98%', '1.28']);
    assert.match(app.get('wfEquitySummary').textContent, /\b10 (?:settled )?bets\b/);
    assert.match(app.get('wfEquitySummary').textContent, /-0\.20/);
    const svg = app.get('wfEquity').children.find(child => child.tagName === 'SVG');
    assert(svg, 'The real equity renderer must produce a chart');
    assert.match(svg.getAttribute('aria-label'), /\b10 (?:settled )?bets\b/);
    assert.match(svg.getAttribute('aria-label'), /-0\.20/);
    assert.equal(app.get('wfExport').disabled, false);
  });
}

test('zero qualifying records have absent rates and no fabricated uncertainty interval', async () => {
  const app = createPanelHarness(fixtures('D'));
  const run = await app.run({ ...settings, market: 'D', min: 3 });
  assert.equal(run.detail.length, 0);
  for (const row of app.rows('wfRows')) {
    assert.equal(row[2], '0'); assert.equal(row[4], '—'); assert.equal(row[6], '—');
  }
  assert.doesNotMatch(app.get('wfDetail').textContent, /Observed win rate 0|Wilson interval|95%.*interval/i);
  assert.equal(app.get('wfEquity').children.length, 0);
  assert.equal(app.get('wfExport').disabled, true);
});

test('the real download handler writes CSV bytes and captured market assumptions', async () => {
  const games = fixtures('A'); games[0].home_team = '=SAMPLE()';
  const app = createPanelHarness(games);
  await app.run({ ...settings, market: 'A' });
  const blob = await app.export();
  assert(blob, 'Export must create a downloadable Blob');
  const bytes = Buffer.from(await blob.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 3)], [239, 187, 191]);
  const text = bytes.toString('utf8').replace(/^\uFEFF/, '');
  assert(!text.includes('\\uFEFF') && !text.includes('\\r\\n'));
  const records = text.split('\r\n').map(line => [...line.matchAll(/"((?:[^"]|"")*)"|([^,]+)/g)].map(match => (match[1] ?? match[2]).replace(/""/g, '"')));
  assert.equal(records.length, 33);
  const headers = records[0], position = key => { const index = headers.indexOf(key); assert(index >= 0, `Missing CSV field ${key}`); return index; };
  for (const row of records.slice(1)) {
    assert.equal(row[position('market')], 'A');
    assert.equal(row[position('league')], 'E0');
    assert.equal(row[position('commission_pct')], '2');
    assert.equal(row[position('odds_reduction_pct')], '1');
    assert.equal(row[position('analysis_basis')], 'retrospective_chronological_split');
  }
  assert.equal(records[1][position('home')], "'=SAMPLE()");
  assert(Math.abs(records.slice(1).reduce((sum, row) => sum + Number(row[position('net_profit')]), 0) - (-0.6336)) < 1e-9);
  assert.match(app.downloads[0].filename, /A/);
});

test('changing a calculation control clears results and prevents stale exports', async () => {
  const app = createPanelHarness(fixtures('H'));
  await app.run({ ...settings, market: 'H' });
  app.change('wfMarket', 'A');
  assert.equal(app.context.gerballLastValidation, null);
  assert.equal(app.rows('wfRows').length, 0);
  assert.equal(app.rows('wfSeasonRows').length, 0);
  assert.equal(app.get('wfEquity').children.length, 0);
  assert.equal(app.get('wfExport').disabled, true);
  await app.export(); assert.equal(app.downloads.length, 0);
});

test('an in-flight response cannot restore results after the controls changed', async () => {
  let resolve;
  const app = createPanelHarness(() => new Promise(done => { resolve = done; }));
  const pending = app.run({ ...settings, market: 'H' });
  app.change('wfMarket', 'A');
  resolve(fixtures('H')); await pending;
  assert.equal(app.context.gerballLastValidation, null);
  assert.equal(app.rows('wfRows').length, 0);
  assert.equal(app.get('wfExport').disabled, true);
});

test('a newer completed run survives an older response arriving later', async () => {
  const pending = new Map();
  const app = createPanelHarness((_league, market) => new Promise(resolve => pending.set(market, resolve)));
  const first = app.run({ ...settings, market: 'H' });
  const second = app.run({ ...settings, market: 'A' });
  pending.get('A')(fixtures('A')); await second;
  pending.get('H')(fixtures('H')); await first;
  assert.equal(app.context.gerballLastValidation.market, 'A');
  assert.equal(app.rows('wfRows')[1][2], '10');
  assert.equal(app.get('wfExport').disabled, false);
});

test('failed and invalid reruns clear the earlier report and keep export disabled', async () => {
  const app = createPanelHarness(fixtures('H'));
  await app.run({ ...settings, market: 'H' });
  app.setHistory(async () => { throw new Error('Test read failure'); });
  await app.run();
  assert.equal(app.context.gerballLastValidation, null);
  assert.equal(app.rows('wfRows').length, 0);
  assert.equal(app.get('wfExport').disabled, true);
  await app.run({ min: 5, max: 2 });
  assert.equal(app.context.gerballLastValidation, null);
  assert.equal(app.rows('wfRows').length, 0);
  assert.equal(app.get('wfExport').disabled, true);
});
