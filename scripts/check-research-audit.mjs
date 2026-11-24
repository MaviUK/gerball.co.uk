import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const context = vm.createContext({});
context.window = context;
for (const name of ['research-csv', 'research-audit']) vm.runInContext(fs.readFileSync(new URL('../assets/' + name + '.js', import.meta.url), 'utf8'), context);
const audit = context.GerballResearchAudit;
const plain = value => JSON.parse(JSON.stringify(value));

function source() {
  const winningNet = (2.5 * 0.99 - 1) * 0.98;
  const wagers = [
    { fixture_id: 101, date: '2025-08-01', season: '2526', league: 'E0', home: '=Club()', away: 'Málaga, "City"', market_code: 'H', market: 'Home win', home_ppg: 2, away_ppg: 1, home_prior_games: 5, away_prior_games: 6, odds: 2.5, effective_odds: 2.475, home_goals: 2, away_goals: 0, won: true, net: winningNet },
    { fixture_id: 102, date: '2025-08-02', season: '2526', league: 'E0', home: 'United', away: 'Town', market_code: 'H', market: 'Home win', home_ppg: 2, away_ppg: 1, home_prior_games: 6, away_prior_games: 6, odds: 3, effective_odds: 2.97, home_goals: 0, away_goals: 1, won: false, net: -1 },
  ];
  return {
    settings: { scope: 'country', country: 'England', league: 'E0', leagues: ['E0', 'E1'], from: '2021-08-01', to: '2026-06-30', adv: 0.5, min: 1.5, max: 4, commission: 0.02, slippage: 0.01 },
    derived: { minimum_training_bets: 30, minimum_profitable_training_season_fraction: 0.5, ranking_basis: 'rolling', ranking_minimum_test_bets: 100, ranking_minimum_assessed_seasons: 3, ranking_positive_season_fraction: 0.67, difference_consistency_fraction: 0.5 },
    completed_at: '2026-11-24T12:35:00.000Z',
    sections: [
      { key: 'forward_selections', headings: ['Season', 'Bets', 'Profit'], rows: [['2526', '2', String(winningNet - 1)]] },
      { key: 'wager_reconciliation', headings: ['Season', 'Count', 'Profit', 'Check'], rows: [['2526', '2', String(winningNet - 1), 'MATCH']] },
    ],
    forwardSelections: [{ season: '2526', league: 'E0', market: 'Home win', reportedBets: 2, reportedProfit: winningNet - 1, wagers }],
    wagerDifferences: wagers.map(wager => ({ ...wager, fraction: 0.5, side: 'Restricted only' })),
    validationSummaries: [
      { threshold: 30, bets: 150, roi: -4, maxDD: 12.5, positive: 1, activeSeasons: 3, bootstrap: { low: -8, high: -1, positive: 0 } },
      { threshold: 200, bets: 0, roi: null, maxDD: 0, positive: 0, activeSeasons: 0, bootstrap: { low: null, high: null, positive: null } },
    ],
  };
}

test('a completed snapshot retains its inputs, dates and records after source objects change', () => {
  const input = source(), run = audit.snapshot(input);
  input.settings.min = 2.5;
  input.settings.leagues.push('E2');
  input.derived.minimum_training_bets = 200;
  input.forwardSelections[0].wagers[0].net = 99;
  input.sections[0].rows[0][2] = '99';
  assert.equal(run.settings.min, 1.5);
  assert.deepEqual(plain(run.settings.leagues), ['E0', 'E1']);
  assert.equal(run.derived.minimum_training_bets, 30);
  assert.equal(run.forwardSelections[0].wagers[0].net, (2.5 * 0.99 - 1) * 0.98);
  assert.equal(run.completed_at, '2026-11-24T12:35:00.000Z');
  assert.equal(run.analysis_basis, 'retrospective_cross_market_comparison');
  assert(Object.isFrozen(run) && Object.isFrozen(run.settings) && Object.isFrozen(run.forwardSelections[0].wagers[0]));
});

test('the rectangular complete audit includes captured assumptions and independently settleable wager identities', () => {
  const run = audit.snapshot(source()), rows = plain(audit.forwardRows(run));
  assert(rows.every(row => row.length === rows[0].length));
  const metadata = Object.fromEntries(rows.filter(row => row[0] === 'metadata').map(row => [row[2], row[3]]));
  assert.deepEqual(Object.fromEntries(['league_scope', 'country', 'selected_league', 'leagues', 'from', 'to', 'form_threshold', 'odds_min', 'odds_max', 'commission_pct', 'odds_reduction_pct', 'minimum_training_bets', 'minimum_profitable_training_season_fraction', 'ranking_basis', 'difference_consistency_fraction'].map(key => [key, metadata[key]])), {
    league_scope: 'country', country: 'England', selected_league: 'E0', leagues: 'E0|E1', from: '2021-08-01', to: '2026-06-30', form_threshold: 0.5, odds_min: 1.5, odds_max: 4, commission_pct: 2, odds_reduction_pct: 1, minimum_training_bets: 30, minimum_profitable_training_season_fraction: 0.5, ranking_basis: 'rolling', difference_consistency_fraction: 0.5,
  });
  assert(rows.some(row => row[0] === 'forward_selections' && row[1] === 'data'));
  assert(rows.some(row => row[0] === 'wager_reconciliation' && row.includes('MATCH')));
  const heading = rows.find(row => row[0] === 'settled_wagers' && row[1] === 'header');
  const wagers = rows.filter(row => row[0] === 'settled_wagers' && row[1] === 'data').map(row => Object.fromEntries(heading.slice(2).map((key, index) => [key, row[index + 2]])));
  assert.deepEqual(wagers.map(wager => wager.fixture_id), [101, 102]);
  assert.equal(wagers[0].market_code, 'H');
  assert.equal(wagers[0].home_prior_games, 5);
  assert.equal(wagers[0].away_prior_games, 6);
  assert.equal(wagers[0].home_ppg, 2);
  assert.equal(wagers[0].away_ppg, 1);
  for (const wager of wagers) {
    const won = wager.home_goals > wager.away_goals;
    const net = won ? (Math.max(1.01, wager.opening_odds * 0.99) - 1) * 0.98 : -1;
    assert.equal(wager.result, won ? 'Won' : 'Lost');
    assert(Math.abs(wager.net_units - net) < 1e-12);
  }
  assert.equal(wagers[1].net_units, -1);
});

test('audit export rejects mismatched counts or profits, invalid net values, and no settled wagers', () => {
  const valid = source();
  assert.equal(audit.reconcile(valid.forwardSelections).ok, true);
  for (const change of [input => input.forwardSelections[0].reportedBets++, input => input.forwardSelections[0].reportedProfit += 0.01]) {
    const input = source(); change(input); const run = audit.snapshot(input);
    assert.equal(run.reconciled, false);
    assert.throws(() => audit.forwardRows(run), /reconcile/);
  }
  const invalid = source(); invalid.forwardSelections[0].wagers[1].net = null;
  assert.equal(audit.reconcile(invalid.forwardSelections).ok, false);
  invalid.forwardSelections[0].wagers[1].net = Infinity;
  assert.throws(() => audit.snapshot(invalid), /invalid number/);
  const empty = source(); empty.forwardSelections = [];
  assert.throws(() => audit.forwardRows(audit.snapshot(empty)), /reconcile/);
  const malformed = source(); malformed.sections[0].rows[0].pop();
  assert.throws(() => audit.snapshot(malformed), /inconsistent columns/);
});

test('absent native IDs remain blank while composite keys identify fixtures and distinct markets', () => {
  const input = source(), home = { ...input.forwardSelections[0].wagers[0], fixture_id: null };
  const away = { ...home, market_code: 'A', market: 'Away win', won: false, net: -1 };
  const fallback = { ...away, market_code: null, market: 'Under 2.5' };
  input.forwardSelections = [{ season: '2526', league: 'E0', market: 'Mixed test markets', reportedBets: 3, reportedProfit: home.net - 2, wagers: [home, away, fallback] }];
  input.wagerDifferences = [home, away, fallback].map(wager => ({ ...wager, fraction: 0.5, side: 'Restricted only' }));
  const run = audit.snapshot(input), forward = plain(audit.forwardRows(run));
  assert(forward.every(row => row.length === forward[0].length));
  const heading = forward.find(row => row[0] === 'settled_wagers' && row[1] === 'header');
  const records = forward.filter(row => row[0] === 'settled_wagers' && row[1] === 'data').map(row => Object.fromEntries(heading.slice(2).map((key, index) => [key, row[index + 2]])));
  const fixtureKey = JSON.stringify(['E0', '2025-08-01', '=Club()', 'Málaga, "City"']);
  assert(records.every(row => row.fixture_id === null && row.fixture_key === fixtureKey));
  assert.deepEqual(records.map(row => JSON.parse(row.wager_key).at(-1)), ['H', 'A', 'Under 2.5']);
  assert.equal(new Set(records.map(row => row.wager_key)).size, 3);
  const metadata = Object.fromEntries(forward.filter(row => row[0] === 'metadata').map(row => [row[2], row[3]]));
  assert.match(metadata.fixture_id_basis, /blank when unavailable/);
  assert.match(metadata.fixture_key_basis, /JSON tuple \[league,date,home,away\]/);
  const differences = plain(audit.differenceRows(run)), fields = differences[0];
  assert(differences.every(row => row.length === fields.length));
  assert(differences.slice(1).every(row => row[fields.indexOf('fixture_id')] === null && row[fields.indexOf('fixture_key')] === fixtureKey));
  assert.equal(new Set(differences.slice(1).map(row => row[fields.indexOf('wager_key')])).size, 3);
});

test('the difference export preserves every selected record beyond the display cap and separates markets', () => {
  const input = source();
  input.wagerDifferences = Array.from({ length: 130 }, (_, index) => ({ ...input.wagerDifferences[index % 2], fixture_id: index + 500, home: 'Home ' + index, fraction: index < 125 ? 0.5 : 1, side: index % 2 ? 'Unrestricted only' : 'Restricted only', market: index % 2 ? 'Away win' : 'Home win', market_code: index % 2 ? 'A' : 'H' }));
  const rows = plain(audit.differenceRows(audit.snapshot(input))), headers = rows[0];
  assert.equal(rows.length, 126);
  assert(rows.every(row => row.length === headers.length));
  assert.equal(new Set(rows.slice(1).map(row => row[headers.indexOf('fixture_id')])).size, 125);
  assert(rows.slice(1).some(row => row[headers.indexOf('market_code')] === 'A'));
  assert(rows.slice(1).some(row => row[headers.indexOf('market_code')] === 'H'));
  assert(rows.slice(1).every(row => row[headers.indexOf('difference_consistency_fraction')] === 0.5));
  assert(rows.slice(1).some(row => row[headers.indexOf('net_units')] === -1));
});

test('validation exports preserve negative numeric returns, missing intervals and evidence labels', () => {
  const run = audit.snapshot(source()), rows = plain(audit.validationRows(run)), headings = rows[0];
  const value = (row, key) => row[headings.indexOf(key)];
  assert.equal(value(rows[1], 'forward_roi_pct'), -4);
  assert.equal(value(rows[1], 'bootstrap_positive_draw_pct'), 0);
  assert.equal(value(rows[1], 'assessment'), 'Negative historical interval');
  assert.equal(value(rows[2], 'forward_roi_pct'), null);
  assert.equal(value(rows[2], 'bootstrap_low_roi_pct'), null);
  assert.equal(value(rows[2], 'assessment'), 'Insufficient evidence');
  const empty = source(); empty.validationSummaries = [empty.validationSummaries[1]];
  assert.deepEqual(plain(audit.validationRows(audit.snapshot(empty))), []);
});

test('shared CSV output has real BOM and CRLF, neutralized names and numeric negative profit', () => {
  const rows = audit.differenceRows(audit.snapshot(source())), text = context.GerballCSV.stringify(rows);
  assert.deepEqual([...Buffer.from(text).subarray(0, 3)], [239, 187, 191]);
  assert(text.includes('\r\n'));
  assert(!text.includes('\\uFEFF') && !text.includes('\\r\\n'));
  assert(text.includes('"\'=Club()"'));
  assert(text.includes('"Málaga, ""City"""'));
  assert(text.includes('"-1"'));
  assert(!text.includes('"\'-1"'));
});
