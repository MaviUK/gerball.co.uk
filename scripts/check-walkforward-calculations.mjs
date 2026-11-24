import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const context = vm.createContext({});
vm.runInContext(readFileSync(new URL('../assets/walkforward-calculations.js', import.meta.url), 'utf8'), context);
const calculations = context.GerballWalkforward;
const plain = value => JSON.parse(JSON.stringify(value));
const settings = overrides => ({ league: 'E0', market: 'H', from: '2023-01-01', to: '2025-06-30', adv: 0.5, min: 1.5, max: 4, commission: 0, slippage: 0, ...overrides });
const day = n => `2023-01-${String(n).padStart(2, '0')}`;

function fixture(id, overrides = {}) {
  return { id, match_date: day(22), season: '2223', home_team: `Home ${id}`, away_team: `Away ${id}`, home_prior_games: 5, away_prior_games: 5,
    home_prior_ppg: 2, away_prior_ppg: 1, opening_home: 2, home_goals: 1, away_goals: 0, ...overrides };
}

// These unqualified fixtures provide the existing 30-fixture/10-date minimum.
// They also make the 70% date boundary independently calculable: 22 January.
function history(candidates = []) {
  return [...Array.from({ length: 30 }, (_, n) => fixture(`padding-${n + 1}`, { match_date: day(n + 1), home_prior_games: 0, away_prior_games: 0 })), ...candidates];
}

function run(candidates, overrides = {}) { return calculations.evaluate(history(candidates), settings(overrides)); }
function sample(result, label = 'Out of sample') { return result.samples.find(item => item.label === label); }
function ids(result) { return plain(result.detail.map(item => item.fixture_id)); }
function close(actual, expected, label = '') { assert.ok(Math.abs(actual - expected) < 1e-10, `${label}: expected ${expected}, received ${actual}`); }

// A deliberately small ledger, computed by hand. The same archived odds field
// contains the selected market price, as returned by the existing market RPC.
const MARKET_FIXTURES = [
  fixture('home-win', { match_date: day(22), home_goals: 2, away_goals: 0, opening_home: 2 }),
  fixture('home-loss', { match_date: day(23), home_goals: 0, away_goals: 1, opening_home: 3 }),
  fixture('away-win', { match_date: day(24), home_prior_ppg: 1, away_prior_ppg: 2, home_goals: 0, away_goals: 3, opening_home: 4 }),
  fixture('away-loss', { match_date: day(25), home_prior_ppg: 1, away_prior_ppg: 2, home_goals: 2, away_goals: 1, opening_home: 2 }),
  fixture('level-draw', { match_date: day(26), home_prior_ppg: 1.5, away_prior_ppg: 1.5, home_goals: 0, away_goals: 0, opening_home: 3 }),
  fixture('near-level-loss', { match_date: day(27), home_prior_ppg: 1.5, away_prior_ppg: 1.25, home_goals: 1, away_goals: 0, opening_home: 2 }),
  fixture('home-boundary-draw', { match_date: day(28), home_prior_ppg: 1.5, away_prior_ppg: 1, home_goals: 1, away_goals: 1, opening_home: 1.5 }),
  fixture('away-boundary-draw', { match_date: day(29), home_prior_ppg: 1, away_prior_ppg: 1.5, home_goals: 2, away_goals: 2, opening_home: 4 }),
];

const EXPECTED_MARKETS = [
  ['H', ['home-win', 'home-loss', 'home-boundary-draw'], ['Won', 'Lost', 'Lost'], 1, -1, 2],
  ['A', ['away-win', 'away-loss', 'away-boundary-draw'], ['Won', 'Lost', 'Lost'], 1, 1, 2],
  ['D', ['level-draw', 'near-level-loss', 'home-boundary-draw', 'away-boundary-draw'], ['Won', 'Lost', 'Won', 'Won'], 3, 4.5, 1],
  ['O25', ['home-win', 'home-loss', 'away-win', 'away-loss', 'home-boundary-draw', 'away-boundary-draw'], ['Lost', 'Lost', 'Won', 'Won', 'Lost', 'Won'], 3, 4, 2],
  ['U25', ['home-win', 'home-loss', 'away-win', 'away-loss', 'home-boundary-draw', 'away-boundary-draw'], ['Won', 'Won', 'Lost', 'Lost', 'Won', 'Lost'], 3, 0.5, 2.5],
];

for (const [market, expectedIds, outcomes, wins, profit, drawdown] of EXPECTED_MARKETS) {
  test(`${market}: hand-calculated qualification and settlement agree with the displayed samples`, () => {
    const result = run(MARKET_FIXTURES, { market });
    assert.equal(result.market, market);
    assert.equal(result.fixtureCount, 38);
    assert.equal(result.dateCount, 30);
    assert.equal(result.split, day(22));
    assert.deepEqual(ids(result), expectedIds);
    assert.deepEqual(plain(result.detail.map(item => item.result)), outcomes);
    assert.ok(result.detail.every(item => item.sample === 'Out of sample'));
    const tested = sample(result);
    assert.equal(tested.fixtures, 17);
    assert.equal(tested.bets, expectedIds.length);
    assert.equal(tested.wins, wins);
    close(tested.profit, profit, 'profit');
    close(tested.roi, 100 * profit / expectedIds.length, 'ROI');
    close(tested.strikeRate, wins / expectedIds.length, 'strike rate');
    close(tested.maxDrawdown, drawdown, 'drawdown');
    const training = sample(result, 'Training');
    assert.equal(training.fixtures, 21);
    assert.equal(training.bets, 0);
    assert.equal(training.roi, null);
    assert.equal(training.strikeRate, null);
    const seasonRun = run(MARKET_FIXTURES.map(item => ({ ...item, season: '2324', match_date: item.match_date.replace('2023-01-', '2023-08-') })), { market });
    const holdout = seasonRun.seasons[0];
    assert.equal(holdout.season, '2324');
    assert.equal(holdout.training, 30);
    assert.equal(holdout.fixtures, 8);
    assert.equal(holdout.bets, expectedIds.length);
    assert.equal(holdout.wins, wins);
    close(holdout.profit, profit, 'season profit');
    close(holdout.roi, 100 * profit / expectedIds.length, 'season ROI');
    close(holdout.dd, drawdown, 'season drawdown');
  });
}

test('inclusive form and archived-odds boundaries qualify before the assumed odds reduction', () => {
  const result = run([
    fixture('minimum', { home_prior_ppg: 1.5, opening_home: 1.5 }),
    fixture('maximum', { home_prior_ppg: 1.5, opening_home: 4 }),
    fixture('below-odds', { opening_home: 1.4999 }),
    fixture('above-odds', { opening_home: 4.0001 }),
    fixture('below-form', { home_prior_ppg: 1.25 }),
    fixture('too-few-home', { home_prior_games: 4 }),
    fixture('too-few-away', { away_prior_games: 4 }),
  ], { slippage: 0.25, commission: 0.25 });
  assert.deepEqual([...ids(result)].sort(), ['maximum', 'minimum']);
  const low = result.detail.find(item => item.fixture_id === 'minimum');
  close(low.effective_odds, 1.125);
  close(low.net_profit, 0.09375);
  close(sample(result).profit, 1.59375);
});

test('direct PPG comparisons preserve the existing arithmetic without rounding the form gap', () => {
  const candidate = fixture('unrounded', { home_prior_ppg: 1.4, away_prior_ppg: 0.9 });
  assert.deepEqual(ids(run([candidate], { market: 'H' })), []);
  assert.deepEqual(ids(run([candidate], { market: 'D' })), ['unrounded']);
});

test('zero and finite numeric strings are real values, including a 0–0 draw and under win', () => {
  const zero = fixture('zero', { home_prior_games: '5', away_prior_games: '5', home_prior_ppg: '0.5', away_prior_ppg: 0, opening_home: '2', home_goals: '0', away_goals: 0 });
  for (const market of ['D', 'U25']) {
    const result = run([zero], { market });
    assert.deepEqual(ids(result), ['zero']);
    assert.equal(result.detail[0].result, 'Won');
    close(sample(result).profit, 1);
  }
  assert.equal(run([zero], { market: 'H' }).detail[0].result, 'Lost');
});

test('missing, blank, boolean, nonfinite, negative and fractional scores cannot become settled bets', () => {
  const invalid = [null, undefined, '', '  ', true, false, NaN, Infinity, -Infinity, -1, 0.5, 'not a score', [], {}];
  const candidates = [fixture('real-zero', { home_prior_ppg: 1, away_prior_ppg: 1, home_goals: 0, away_goals: 0 })];
  invalid.forEach((value, n) => {
    candidates.push(fixture(`invalid-home-${n}`, { home_prior_ppg: 1, away_prior_ppg: 1, home_goals: value, away_goals: 0 }));
    candidates.push(fixture(`invalid-away-${n}`, { home_prior_ppg: 1, away_prior_ppg: 1, home_goals: 0, away_goals: value }));
  });
  const result = run(candidates, { market: 'D' });
  assert.deepEqual(ids(result), ['real-zero']);
  assert.equal(sample(result).bets, 1);
  assert.equal(sample(result).wins, 1);
  assert.equal(result.excludedResults, 28);
});

test('invalid form, prior-game counts and odds are excluded without numeric coercion', () => {
  const candidates = [fixture('valid')];
  const invalid = [null, undefined, '', '  ', true, false, NaN, Infinity, -Infinity, [], {}];
  for (const field of ['home_prior_ppg', 'away_prior_ppg', 'home_prior_games', 'away_prior_games', 'opening_home']) {
    invalid.forEach((value, n) => candidates.push(fixture(`${field}-${n}`, { [field]: value })));
  }
  assert.deepEqual(ids(run(candidates)), ['valid']);
});

test('commission applies only to winnings after slippage while a loss remains one unit', () => {
  const result = run([
    fixture('winner', { match_date: day(22), opening_home: 2 }),
    fixture('loser', { match_date: day(23), opening_home: 2, home_goals: 0, away_goals: 1 }),
  ], { commission: 0.02, slippage: 0.01 });
  close(result.detail[0].effective_odds, 1.98);
  close(result.detail[0].net_profit, 0.9604);
  assert.equal(result.detail[1].net_profit, -1);
  close(sample(result).profit, -0.0396);
  close(sample(result).roi, -1.98);
  close(sample(result).maxDrawdown, 1);
});

test('the effective-price floor is 1.01 without changing raw-price eligibility', () => {
  const result = run([fixture('floor', { opening_home: 1.01 })], { min: 1.01, commission: 0.25, slippage: 0.25 });
  assert.deepEqual(ids(result), ['floor']);
  close(result.detail[0].effective_odds, 1.01);
  close(result.detail[0].net_profit, 0.0075);
});

test('all fixtures on the date boundary stay in the test sample, without mutating inputs', () => {
  const input = history([
    fixture('training', { match_date: day(21) }),
    fixture('boundary-a', { match_date: day(22) }),
    fixture('boundary-b', { match_date: day(22), home_goals: 0, away_goals: 1 }),
  ]).reverse();
  const before = structuredClone(input);
  const configuration = settings();
  const result = calculations.evaluate(input, configuration);
  assert.deepEqual(input, before);
  assert.equal(result.split, day(22));
  assert.deepEqual(plain(result.detail.map(item => [item.fixture_id, item.sample])), [
    ['training', 'Training'], ['boundary-a', 'Out of sample'], ['boundary-b', 'Out of sample'],
  ]);
  assert.equal(sample(result, 'Training').fixtures, 22);
  assert.equal(sample(result).fixtures, 11);
  close(sample(result, 'Training').profit, 1);
  close(sample(result).profit, 0);
  configuration.market = 'A';
  configuration.commission = 0.25;
  assert.equal(result.market, 'H');
  assert.equal(result.commission, 0);
});

test('date, home, away and identity tie breakers produce a stable ledger and initial-zero drawdown', () => {
  const candidates = [
    fixture('4', { home_team: 'Alpha', away_team: 'Bravo', home_goals: 0, away_goals: 1 }),
    fixture('1', { home_team: 'Beta', away_team: 'Alpha', home_goals: 0, away_goals: 1 }),
    fixture('3', { home_team: 'Alpha', away_team: 'Alpha', home_goals: 0, away_goals: 1 }),
    fixture('2', { home_team: 'Alpha', away_team: 'Alpha', home_goals: 0, away_goals: 1 }),
  ];
  const ordered = run(candidates), reversed = run([...candidates].reverse());
  assert.deepEqual(ids(ordered), ['2', '3', '4', '1']);
  assert.deepEqual(plain(ordered), plain(reversed));
  close(sample(ordered).profit, -4);
  close(sample(ordered).maxDrawdown, 4, 'drawdown includes losses from the starting zero balance');
});

test('season summaries use the selected market and preceding fixture counts, including the first season only as context', () => {
  const result = run([
    fixture('first-season', { match_date: day(5), home_prior_ppg: 1, away_prior_ppg: 2, home_goals: 0, away_goals: 1 }),
    fixture('second-loss', { season: '2324', match_date: '2023-08-01', home_prior_ppg: 1, away_prior_ppg: 2, home_goals: 1, away_goals: 0 }),
    fixture('second-win', { season: '2324', match_date: '2023-08-02', home_prior_ppg: 1, away_prior_ppg: 2, home_goals: 0, away_goals: 1, opening_home: 3 }),
    fixture('third-loss-a', { season: '2425', match_date: '2024-08-01', home_prior_ppg: 1, away_prior_ppg: 2, home_goals: 1, away_goals: 0 }),
    fixture('third-loss-b', { season: '2425', match_date: '2024-08-02', home_prior_ppg: 1, away_prior_ppg: 2, home_goals: 1, away_goals: 0 }),
  ], { market: 'A' });
  assert.equal(result.split, day(24));
  assert.deepEqual(plain(result.seasons), [
    { season: '2324', training: 31, fixtures: 2, bets: 2, wins: 1, profit: 1, roi: 50, dd: 1 },
    { season: '2425', training: 33, fixtures: 2, bets: 2, wins: 0, profit: -2, roi: -100, dd: 2 },
  ]);
  assert.equal(sample(result, 'Training').bets, 1);
  close(sample(result, 'Training').profit, 1);
  assert.equal(sample(result).bets, 4);
  close(sample(result).profit, -1);
});

test('a valid history with no qualifying bets returns unavailable rates and zero totals', () => {
  const result = calculations.evaluate(history(), settings());
  assert.deepEqual(ids(result), []);
  for (const summary of result.samples) {
    assert.equal(summary.bets, 0);
    assert.equal(summary.wins, 0);
    assert.equal(summary.profit, 0);
    assert.equal(summary.maxDrawdown, 0);
    assert.equal(summary.roi, null);
    assert.equal(summary.strikeRate, null);
  }
});

test('settings reject invalid dates, market, thresholds, price bounds and costs', () => {
  const invalid = [
    { market: 'X' }, { market: '' }, { from: '' }, { from: '2023-02-30' }, { to: 'not-a-date' }, { from: '2025-06-30' }, { from: '2025-07-01' },
    { adv: null }, { adv: '' }, { adv: NaN }, { adv: Infinity }, { adv: -0.5 },
    { min: 1 }, { min: '' }, { min: null }, { max: 1.4 }, { max: Infinity }, { max: NaN },
    { commission: -0.01 }, { commission: 0.251 }, { commission: null }, { commission: '' }, { commission: true }, { commission: NaN },
    { slippage: -0.01 }, { slippage: 0.251 }, { slippage: null }, { slippage: '' }, { slippage: true }, { slippage: Infinity },
  ];
  for (const override of invalid) assert.throws(() => calculations.evaluate(history(), settings(override)), `Invalid settings: ${JSON.stringify(override)}`);
});

test('the existing fixture/date minimums and 10,000-row safety limit remain enforced', () => {
  assert.throws(() => calculations.evaluate(history().slice(0, 29), settings()));
  assert.throws(() => calculations.evaluate(history().map((item, n) => ({ ...item, match_date: day(n % 9 + 1) })), settings()));
  const capped = Array.from({ length: 10_000 }, (_, n) => fixture(`cap-${n}`, { match_date: day(n % 30 + 1), home_prior_games: 0 }));
  assert.throws(() => calculations.evaluate(capped, settings()));
});

// A small independent RFC 4180 reader verifies the output as spreadsheet cells,
// including quoted embedded line breaks; it does not share exporter code.
function parseCsv(csv) {
  const rows = [], row = [];
  let cell = '', quoted = false;
  for (let n = csv.charCodeAt(0) === 0xFEFF ? 1 : 0; n < csv.length; n++) {
    const character = csv[n];
    if (quoted) {
      if (character === '"' && csv[n + 1] === '"') { cell += '"'; n++; }
      else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') { row.push(cell); cell = ''; }
    else if (character === '\r' && csv[n + 1] === '\n') { row.push(cell); rows.push([...row]); row.length = 0; cell = ''; n++; }
    else cell += character;
  }
  assert.equal(quoted, false, 'CSV must close quoted fields');
  if (cell.length || row.length) { row.push(cell); rows.push([...row]); }
  return rows;
}

test('CSV uses actual UTF-8 BOM/CRLF and repeats the captured run provenance on every result', () => {
  const result = run(MARKET_FIXTURES, { market: 'A', commission: 0.02, slippage: 0.01 });
  const csv = calculations.csvForRun(result), bytes = Buffer.from(csv, 'utf8');
  assert.deepEqual([...bytes.subarray(0, 3)], [0xEF, 0xBB, 0xBF]);
  assert.equal(csv.charCodeAt(0), 0xFEFF);
  assert.ok(csv.includes('\r\n'));
  assert.equal(csv.includes('\\r\\n'), false);
  assert.equal(csv.includes('\\uFEFF'), false);
  const [headers, ...rows] = parseCsv(csv);
  assert.equal(rows.length, 3);
  const required = ['league', 'market', 'market_name', 'from', 'to', 'form_threshold', 'odds_min', 'odds_max', 'commission_pct', 'odds_reduction_pct', 'split_date', 'analysis_basis', 'fixture_id', 'date', 'season', 'home', 'away', 'home_ppg', 'away_ppg', 'opening_odds', 'effective_odds', 'result', 'net_profit', 'sample'];
  assert.deepEqual(headers, required);
  for (const row of rows) {
    assert.equal(row.length, headers.length);
    const record = Object.fromEntries(headers.map((header, n) => [header, row[n]]));
    assert.equal(record.league, 'E0');
    assert.equal(record.market, 'A');
    assert.equal(record.market_name, result.marketLabel);
    assert.equal(record.from, '2023-01-01');
    assert.equal(record.to, '2025-06-30');
    assert.equal(record.split_date, day(22));
    assert.equal(Number(record.form_threshold), 0.5);
    assert.equal(Number(record.odds_min), 1.5);
    assert.equal(Number(record.odds_max), 4);
    assert.equal(Number(record.commission_pct), 2);
    assert.equal(Number(record.odds_reduction_pct), 1);
    assert.equal(record.analysis_basis, 'retrospective_chronological_split');
    assert.equal(record.sample, 'Out of sample');
  }
  const records = rows.map(row => Object.fromEntries(headers.map((header, n) => [header, row[n]])));
  assert.deepEqual(records.map(item => item.fixture_id), ['away-win', 'away-loss', 'away-boundary-draw']);
  close(Number(records[0].net_profit), 2.9008);
  assert.equal(records[1].net_profit, '-1', 'numeric losses remain numeric CSV cells');
});

test('CSV escapes commas, quotes and embedded lines, and neutralizes formula-like team names', () => {
  const names = ['=1+1', '+SUM(1,2)', '-2+3', '@SUM(A1)', '  =HYPERLINK("x")', '\t=1+1', '\r=1+1'];
  const candidates = names.map((home, n) => fixture(`formula-${n}`, { home_team: home, away_team: 'Club, "Quoted"\r\nSecond line' }));
  const [headers, ...rows] = parseCsv(calculations.csvForRun(run(candidates)));
  const homeColumn = headers.indexOf('home'), awayColumn = headers.indexOf('away');
  assert.equal(rows.length, names.length);
  for (const row of rows) {
    assert.ok(row[homeColumn].startsWith("'"), `Unprotected spreadsheet value ${JSON.stringify(row[homeColumn])}`);
    assert.ok(names.includes(row[homeColumn].slice(1)));
    assert.equal(row[awayColumn], 'Club, "Quoted"\r\nSecond line');
    assert.equal(row.length, headers.length);
  }
});

test('fixture_id fallback is retained in the ledger and export', () => {
  const candidate = fixture(undefined, { fixture_id: 90210 });
  const result = run([candidate]);
  assert.equal(String(result.detail[0].fixture_id), '90210');
  const [headers, row] = parseCsv(calculations.csvForRun(result));
  assert.equal(row[headers.indexOf('fixture_id')], '90210');
});
