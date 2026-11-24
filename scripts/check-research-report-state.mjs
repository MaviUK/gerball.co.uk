import assert from 'node:assert/strict';
import test from 'node:test';
import { createResearchHarness, deferred, parseCSV } from './helpers/research-report-harness.cjs';

const valueAt = (records, key, row = 1) => {
  const index = records[0].indexOf(key);
  assert(index >= 0, 'Missing export context column ' + key);
  return records[row][index];
};
async function downloaded(app, button) {
  const before = app.downloads.length;
  button.click();
  assert.equal(app.downloads.length, before + 1, 'A ready report must download exactly once');
  const bytes = Buffer.from(await app.blobs.at(-1).arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 3)], [239, 187, 191], 'CSV must start with a real UTF-8 BOM');
  const text = bytes.toString('utf8');
  assert(text.includes('\r\n'), 'CSV must contain physical CRLF separators');
  assert(!text.includes('\\uFEFF') && !text.includes('\\r\\n'), 'CSV must not contain escaped row separators');
  const records = parseCSV(text);
  assert(records.length > 1, 'CSV must include actual observations');
  for (const row of records) assert.equal(row.length, records[0].length, 'Every CSV record must have the same columns');
  return records;
}
function assertUnavailable(app, button, body) {
  assert.equal(button.disabled, true, 'Export stays disabled without a completed current report');
  const before = app.downloads.length;
  button.click();
  assert.equal(app.downloads.length, before);
  if (body) assert.equal(app.rows(body).length, 0);
}

test('the CSV utility round-trips commas, quotes, Unicode and multiline fields while preserving numeric losses', () => {
  const app = createResearchHarness({ generic: false, comparison: false, profile: false });
  const rows = [['Name', 'Value'], ['Málaga, "Athletic"\nsecond line', -1.25], ['=SUM(1,2)', '-100.00%'], [' \t\uFEFF+SUM(1,2)', '-1.00'], [' @SUM(1)', '0'], ['-1+2', '—']];
  const text = app.context.GerballCSV.stringify(rows);
  assert.deepEqual([...Buffer.from(text).subarray(0, 3)], [239, 187, 191]);
  const parsed = parseCSV(text);
  assert.equal(parsed[1][0], rows[1][0]);
  assert.equal(parsed[1][1], '-1.25');
  assert.equal(parsed[2][1], '-100.00%');
  assert.equal(parsed[3][1], '-1.00');
  assert.equal(parsed[4][1], '0');
  for (const row of parsed.slice(2)) assert(row[0].startsWith("'"), 'Formula-like text is neutralized before any whitespace');
  assert.throws(() => app.context.GerballCSV.stringify([['A', 'B'], ['one column']]), /column|rectangular|length|width/i);
});

const reports = [
  { prefix: 'cov', handler: 'covRun', body: 'covRows', name: 'data-coverage', control: 'covSeason', next: '2425', data: { metric: 'Goals, "full time"', total: 10, available: 0, coverage_pct: 0 } },
  { prefix: 'mov', handler: 'movRun', body: 'movRows', name: 'odds-movement', control: 'movMarket', next: 'A', data: { movement: 'Shortened', bets: 10, wins: 0, win_pct: 0, avg_open: 2, avg_close: 1.8, avg_shift_pct: -10, flat_profit: -10, flat_roi_pct: -100 } },
  { prefix: 'ref', handler: 'runReferee', body: 'refRows', name: 'referee-analysis', control: 'refMin', next: '10', data: { referee: '=NAME()', matches: 10, home_wins: 0, draws: 0, away_wins: 10, home_win_pct: 0, yellows_per_match: null, reds_per_match: 0, fouls_per_match: null, cards_sample: 0 } },
  { prefix: 'fin', handler: 'runFinishing', body: 'finRows', name: 'finishing-analysis', control: 'finVenue', next: 'home', data: { team: 'Málaga', matches: 10, goals_per_match: 0, shots_per_match: null, accuracy_pct: null, conversion_pct: 0, on_target_conversion_pct: null, shot_sample: 0 } },
  { prefix: 'disc', handler: 'runDiscipline', body: 'discRows', name: 'corners-and-cards', control: 'discVenue', next: 'away', data: { team: 'City', matches: 10, corners_for_per_game: 0, corners_against_per_game: 1, corner_diff_per_game: -1, yellows_per_game: null, reds_per_game: 0, fouls_per_game: null, corners_sample: 10, cards_sample: 0 } },
];
for (const report of reports) {
  test(`${report.name}: export uses accepted settings and control changes invalidate results`, async () => {
    const app = createResearchHarness();
    const button = app.exportButton(report.name);
    assertUnavailable(app, button, report.body);
    app.get(report.prefix + 'Season').value = '2526';
    app.setFetch(async () => [report.data]);
    await app.context[report.handler]();
    assert.equal(button.disabled, false);
    const records = await downloaded(app, button);
    assert.equal(records.length, 2);
    assert.equal(valueAt(records, 'league_code'), 'E0');
    assert.equal(valueAt(records, 'season'), '2526');
    assert.equal(valueAt(records, 'data_basis'), 'imported_match_archive');
    assert(!Number.isNaN(Date.parse(valueAt(records, 'report_loaded_at_utc'))));
    if (report.prefix === 'mov') assert(records[1].includes('-100%') || records[1].includes('-100.00%'));
    if (report.prefix === 'ref') assert(records[1].includes("'=NAME()"));
    app.change(report.control, report.next);
    assertUnavailable(app, button, report.body);
  });

  test(`${report.name}: pending, failed and empty reruns cannot export stale observations`, async () => {
    const app = createResearchHarness();
    const button = app.exportButton(report.name);
    app.setFetch(async () => [report.data]); await app.context[report.handler]();
    const pending = deferred(); app.setFetch(() => pending.promise);
    const run = app.context[report.handler]();
    assertUnavailable(app, button, report.body);
    app.change(report.control, report.next, 'input');
    pending.resolve([report.data]); await run;
    assertUnavailable(app, button, report.body);
    app.setFetch(async () => [report.data]); await app.context[report.handler]();
    assert.equal(button.disabled, false);
    app.setFetch(async () => { throw Error('Synthetic read failure'); }); await app.context[report.handler]();
    assertUnavailable(app, button, report.body);
    app.setFetch(async () => []); await app.context[report.handler]();
    assertUnavailable(app, button);
    app.context.exportVisibleTable(report.body, 'empty.csv');
    assert.equal(app.downloads.length, 0, 'A no-results placeholder is not an observation');
  });
}

test('odds-movement exports numeric losses, profits and zero while retaining the displayed currency', async () => {
  const app = createResearchHarness();
  const base = reports.find(report => report.prefix === 'mov').data;
  const profits = [-23.59, 5.25, 0];
  app.setFetch(async () => profits.map((flat_profit, index) => ({ ...base, movement: ['Shortened', 'Drifted', 'Stable'][index], flat_profit })));
  await app.context.movRun();
  assert.deepEqual(app.rows('movRows').map(row => row[7]), ['-£23.59', '£5.25', '£0.00']);
  const records = await downloaded(app, app.exportButton('odds-movement'));
  const exported = records.slice(1).map((_row, index) => valueAt(records, '£1 P/L', index + 1));
  assert.deepEqual(exported, ['-23.59', '5.25', '0.00']);
  assert.deepEqual(exported.map(Number), profits);
  for (const value of exported) assert(!value.includes('£') && !value.startsWith("'"), 'CSV profit must remain numeric');
});

test('coverage accepts the newest league request when responses finish in reverse order', async () => {
  const app = createResearchHarness(), english = deferred(), german = deferred();
  app.setFetch(request => request.body.p_league === 'E0' ? english.promise : german.promise);
  const first = app.context.covRun();
  app.change('covCountry', 'Germany');
  const second = app.context.covRun();
  german.resolve([{ metric: 'German coverage', total: 2, available: 2, coverage_pct: 100 }]); await second;
  english.resolve([{ metric: 'English coverage', total: 1, available: 1, coverage_pct: 100 }]); await first;
  assert.deepEqual(app.rows('covRows'), [['German coverage', '2', '2', '100.0%']]);
  assert.match(app.get('covStatus').textContent, /Bundesliga/);
  assert.equal(valueAt(await downloaded(app, app.exportButton('data-coverage')), 'league_code'), 'D1');
});

const comparisonTeam = name => ({ team: name, played: 5, points: 7, wins: 2, draws: 1, losses: 2, goals_for: 5, goals_against: 5 });
test('main comparison ignores an old league response after a newer report succeeds', async () => {
  const app = createResearchHarness(), english = deferred(), german = deferred();
  app.setFetch(request => request.body.p_league === 'E0' ? english.promise : german.promise);
  const first = app.context.runComparison();
  app.change('cmpCountry', 'Germany');
  const second = app.context.runComparison();
  german.resolve([comparisonTeam('German club')]); await second;
  english.resolve([comparisonTeam('English club')]); await first;
  assert.equal(app.rows('cmpRows')[0][1], 'German club');
  assert.match(app.get('cmpStatus').textContent, /Bundesliga/);
  assert.doesNotMatch(app.get('cmpRows').textContent, /English club/);
});

test('editing comparison controls during a request and failed reruns leave no stale report', async () => {
  const app = createResearchHarness(), waiting = deferred();
  app.setFetch(() => waiting.promise);
  const run = app.context.runComparison();
  app.change('cmpMin', '20', 'input');
  waiting.resolve([comparisonTeam('Old club')]); await run;
  assert.equal(app.rows('cmpRows').length, 0);
  app.change('cmpMin', '1'); app.setFetch(async () => [comparisonTeam('Current club')]); await app.context.runComparison();
  assert.equal(app.rows('cmpRows').length, 1);
  app.setFetch(async () => { throw Error('Synthetic comparison failure'); }); await app.context.runComparison();
  assert.equal(app.rows('cmpRows').length, 0);
  assert.match(app.get('cmpStatus').textContent, /unavailable/i);
});

const teamGame = (team, number = 1) => ({ match_date: '2026-01-' + String(number).padStart(2, '0'), home_team: team, away_team: 'Opponent ' + number, home_goals: 2, away_goals: 1 });
const teamHistory = { season: '2526', league: 'E0', league_rank: 2, team_count: 20, played: 5, wins: 3, draws: 1, losses: 1, goals_for: 10, goals_against: 5, points: 10, points_per_game: 2 };
function profileFetch(team, games = [teamGame(team)]) {
  return async request => request.url.includes('/matches?') ? games : request.url.includes('edgelab_team_history') ? [teamHistory] : [];
}
test('switching team profiles clears the previous fixtures before loading and after failure', async () => {
  const app = createResearchHarness(); app.setFetch(profileFetch('Arsenal'));
  await app.context.openTeamProfile('Arsenal');
  assert.match(app.get('teamProfileFixtures').textContent, /Opponent 1/);
  assert.equal(app.exportButton('team-fixtures').disabled, false);
  const pending = deferred(); app.setFetch(() => pending.promise);
  const next = app.context.openTeamProfile('Liverpool');
  app.change('teamProfileLimit', '10');
  assert.doesNotMatch(app.get('teamProfileFixtures').textContent, /Arsenal|Opponent 1/);
  assertUnavailable(app, app.exportButton('team-fixtures'));
  assertUnavailable(app, app.exportButton('team-history'));
  pending.reject(Error('Synthetic profile failure')); await next;
  app.change('teamProfileLimit', '20');
  assert.doesNotMatch(app.get('teamProfileFixtures').textContent, /Arsenal|Opponent 1/);
  assertUnavailable(app, app.exportButton('team-fixtures'));
});

test('team fixture downloads contain the displayed limit, exact team and loaded league context', async () => {
  const app = createResearchHarness();
  app.setFetch(profileFetch('Arsenal', Array.from({ length: 8 }, (_, index) => teamGame('Arsenal', index + 1))));
  await app.context.openTeamProfile('Arsenal');
  const first = await downloaded(app, app.exportButton('team-fixtures'));
  assert.equal(first.length, 6);
  assert.equal(valueAt(first, 'team'), 'Arsenal');
  assert.equal(valueAt(first, 'league_code'), 'E0');
  assert.equal(valueAt(first, 'season'), '2526');
  assert.equal(valueAt(first, 'displayed_fixture_limit'), '5');
  app.change('teamProfileLimit', '10');
  const second = await downloaded(app, app.exportButton('team-fixtures'));
  assert.equal(second.length, 9);
  assert.equal(valueAt(second, 'displayed_fixture_limit'), '10');
  const history = await downloaded(app, app.exportButton('team-history'));
  assert.equal(valueAt(history, 'team'), 'Arsenal');
  assert(history[1].includes('all_returned_leagues') && history[1].includes('all_returned_seasons'));
});

test('a history failure keeps the current successful fixture report separate from its unavailable history', async () => {
  const app = createResearchHarness();
  app.setFetch(async request => {
    if (request.url.includes('/matches?')) return [teamGame('Arsenal')];
    if (request.url.includes('edgelab_team_history')) throw Error('Synthetic history failure');
    return [];
  });
  await app.context.openTeamProfile('Arsenal');
  assert.equal(app.exportButton('team-fixtures').disabled, false);
  assert.equal(valueAt(await downloaded(app, app.exportButton('team-fixtures')), 'team'), 'Arsenal');
  assertUnavailable(app, app.exportButton('team-history'));
  assert.match(app.get('teamHistoryStatus').textContent, /unavailable/i);
});

test('an old profile response and delayed history cannot overwrite or reopen current team exports', async () => {
  const app = createResearchHarness(), old = deferred(), history = deferred();
  app.setFetch(request => {
    if (request.url.includes('/matches?')) return request.url.includes('Arsenal') ? old.promise : Promise.resolve([teamGame('Liverpool')]);
    if (request.url.includes('edgelab_team_history')) return history.promise;
    return Promise.resolve([]);
  });
  const first = app.context.openTeamProfile('Arsenal');
  const second = app.context.openTeamProfile('Liverpool');
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  old.resolve([teamGame('Arsenal')]); await first;
  assert.equal(app.get('teamProfileTitle').textContent, 'Liverpool');
  assert.doesNotMatch(app.get('teamProfileFixtures').textContent, /Arsenal/);
  app.context.closeTeamProfile();
  history.resolve([teamHistory]); await second;
  assertUnavailable(app, app.exportButton('team-fixtures'));
  assertUnavailable(app, app.exportButton('team-history'));
});

function marketGames(market) {
  return Array.from({ length: 6 * 48 }, (_, index) => {
    const seasonIndex = Math.floor(index / 48), fixture = index % 48, year = 2021 + seasonIndex;
    const won = market === 'H' ? seasonIndex === 0 || (seasonIndex !== 1 && fixture % 3 !== 0) : fixture % 2 === 0;
    const scores = market === 'H' ? (won ? [2, 0] : [0, 1]) : market === 'A' ? (won ? [0, 2] : [1, 0]) : market === 'D' ? (won ? [1, 1] : [2, 0]) : market === 'O25' ? (won ? [2, 1] : [1, 1]) : (won ? [1, 1] : [2, 1]);
    return { id: index + 1, season: String(year % 100) + String((year + 1) % 100), match_date: new Date(Date.UTC(year, 7, fixture + 1)).toISOString().slice(0, 10),
      home_team: 'Home ' + index, away_team: 'Away ' + index, home_goals: scores[0], away_goals: scores[1],
      home_prior_ppg: market === 'A' ? 1 : 2, away_prior_ppg: market === 'H' || market === 'O25' || market === 'U25' ? 1 : 2,
      home_prior_games: 5, away_prior_games: 5, opening_home: market === 'H' ? 4 : 3 };
  });
}
function crossMarketApp() {
  const app = createResearchHarness({ generic: false, comparison: false, profile: false, crossMarket: true });
  app.get('wfFrom').value = '2021-08-01'; app.get('wfTo').value = '2027-06-30';
  app.get('wfForwardMinTraining').value = '30'; app.get('wfWagerDetailThreshold').value = '1';
  app.setHistory((_league, market) => Promise.resolve(marketGames(market)));
  return app;
}
const crossExportIDs = ['wfExportForwardAudit', 'wfExportWagerDifferences', 'wfExportValidation'];
function assertCrossUnavailable(app) {
  assert.equal(app.context.gerballMarketComparison, null);
  for (const id of crossExportIDs) assertUnavailable(app, app.get(id));
  for (const id of ['wfMarketRows', 'wfForwardRows', 'wfValidationRows', 'wfWagerDetailRows']) assert.equal(app.rows(id).length, 0, id + ' must not retain a previous or partial result');
  assert.equal(app.context.gerballForwardAuditOK, false);
  assert.equal(app.context.gerballWagerDifferences.length, 0);
  assert.equal(app.context.gerballValidationSummaries.length, 0);
}
test('completed cross-market exports reconcile exact wagers and retain all differences beyond the display cap', async () => {
  const app = crossMarketApp();
  await app.get('wfCompareMarkets').onclick();
  const report = app.context.gerballMarketComparison;
  assert(report, 'Only a completed comparison should publish an exportable snapshot');
  assert.equal(report.reconciled, true);
  assert.equal(app.context.gerballForwardAuditOK, true);
  const wagers = report.forwardSelections.flatMap(selection => selection.wagers);
  assert.equal(wagers.length, 192);
  assert.equal(wagers.filter(wager => wager.won).length, 128);
  const independentlySettled = 128 * ((4 * 0.99 - 1) * 0.98) - 64;
  assert(Math.abs(wagers.reduce((sum, wager) => sum + wager.net, 0) - independentlySettled) < 1e-8);
  for (const selection of report.forwardSelections) {
    assert.equal(selection.reportedBets, selection.wagers.length);
    assert(Math.abs(selection.reportedProfit - selection.wagers.reduce((sum, wager) => sum + wager.net, 0)) < 1e-8);
  }
  const audit = await downloaded(app, app.get('wfExportForwardAudit'));
  assert(audit.some(row => row.includes('underlying_wagers') || row.includes('settled_wagers')), 'The complete audit must contain individual settled wager identities');
  const differences = await downloaded(app, app.get('wfExportWagerDifferences'));
  assert.equal(app.rows('wfWagerDetailRows').length, 100, 'The on-screen difference table keeps its readability cap');
  assert(differences.length > 101, 'The download includes every selected difference');
  assert(differences.some(row => row.includes('-1')), 'Losing wager returns remain numeric');
  await downloaded(app, app.get('wfExportValidation'));
});

test('changing shared assumptions invalidates all cross-market reports and exports', async () => {
  const app = crossMarketApp(); await app.get('wfCompareMarkets').onclick();
  app.change('wfOddsMin', '2.5', 'input');
  assertCrossUnavailable(app);
  app.context.exportForwardAudit(); app.context.exportWagerDifferences(); app.context.exportValidationDashboard();
  assert.equal(app.downloads.length, 0, 'Calling export functions directly also respects current-report readiness');
});

test('a partial cross-market request failure clears previous and partial reports atomically', async () => {
  const app = crossMarketApp(); await app.get('wfCompareMarkets').onclick();
  let count = 0;
  app.setHistory(async (_league, market) => { if (++count === 3) throw Error('Synthetic third-market failure'); return marketGames(market); });
  await app.get('wfCompareMarkets').onclick();
  assert.equal(count, 3);
  assertCrossUnavailable(app);
  assert.match(app.get('wfMarketStatus').textContent, /failure|unavailable|incomplete/i);
  assert.equal(app.get('wfCompareMarkets').disabled, false);
});

test('edited inputs prevent an in-flight cross-market run from publishing stale results', async () => {
  const app = crossMarketApp(), pending = deferred(); let calls = 0;
  app.setHistory(() => { calls++; return pending.promise; });
  const run = app.get('wfCompareMarkets').onclick();
  assertCrossUnavailable(app);
  app.change('wfCommission', '3', 'input');
  pending.resolve(marketGames('H')); await run;
  assert.equal(calls, 1, 'An invalidated run stops further market retrieval');
  assertCrossUnavailable(app);
});

test('a completed newer cross-market run survives an older league response', async () => {
  const app = crossMarketApp(), firstResponse = deferred();
  app.setHistory((league, market) => league === 'E0' ? firstResponse.promise : Promise.resolve(marketGames(market)));
  const first = app.get('wfCompareMarkets').onclick();
  app.change('wfCountry', 'Germany');
  const second = app.get('wfCompareMarkets').onclick();
  await second;
  const accepted = app.context.gerballMarketComparison;
  assert(accepted);
  firstResponse.resolve(marketGames('H')); await first;
  assert.equal(app.context.gerballMarketComparison, accepted);
  assert(app.rows('wfMarketRows').every(row => row[0] === 'D1'));
  assert.equal(app.get('wfCompareMarkets').disabled, false);
});

test('derived comparison controls refresh captured settings and export readiness without fetching history again', async () => {
  const app = crossMarketApp(); let calls = 0;
  app.setHistory(async (_league, market) => { calls++; return marketGames(market); });
  await app.get('wfCompareMarkets').onclick();
  assert.equal(calls, 5);
  const initial = app.context.gerballMarketComparison;
  app.change('wfForwardMinTraining', '50');
  assert.notEqual(app.context.gerballMarketComparison, initial);
  assert.equal(app.context.gerballMarketComparison.derived.minimum_training_bets, 50);
  assert.equal(app.context.gerballMarketComparison.reconciled, true);
  app.change('wfWagerDetailThreshold', '0.5');
  assert.equal(app.context.gerballMarketComparison.derived.difference_consistency_fraction, 0.5);
  assertUnavailable(app, app.get('wfExportWagerDifferences'));
  app.change('wfWagerDetailThreshold', '1');
  const differences = await downloaded(app, app.get('wfExportWagerDifferences'));
  assert.equal(valueAt(differences, 'minimum_training_bets'), '50');
  assert.equal(valueAt(differences, 'difference_consistency_fraction'), '1');
  assert.equal(valueAt(differences, 'commission_pct'), '2');
  assert.equal(valueAt(differences, 'odds_reduction_pct'), '1');
  assert.equal(calls, 5, 'Changing local report filters must reuse the completed history');
});

test('a completed empty cross-market comparison does not export placeholder or zero-wager reports', async () => {
  const app = crossMarketApp(); app.setHistory([]);
  await app.get('wfCompareMarkets').onclick();
  for (const id of crossExportIDs) assertUnavailable(app, app.get(id));
  app.context.exportForwardAudit(); app.context.exportWagerDifferences(); app.context.exportValidationDashboard();
  assert.equal(app.downloads.length, 0);
  assert.equal(app.context.gerballForwardAuditOK, false);
});
