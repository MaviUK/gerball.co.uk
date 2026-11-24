import assert from 'node:assert/strict';
import fs from 'node:fs';

// Read-only checks against the same public archive configuration as the site.
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const url = html.match(/const CLOUD_URL='([^']+)'/)[1];
const key = html.match(/const CLOUD_KEY='([^']+)'/)[1];
const league = 'E0', season = '2526';
const timings = [];
const numeric = (value, label, nullable = false) => {
  if (nullable && value === null) return null;
  assert((typeof value === 'number' || typeof value === 'string') && String(value).trim() !== '', label + ' must be numeric');
  const number = Number(value);
  assert(Number.isFinite(number), label + ' must be finite');
  return number;
};
const count = (value, label) => {
  const number = numeric(value, label);
  assert(Number.isInteger(number) && number >= 0, label + ' must be a nonnegative count');
  return number;
};
const percent = (value, label) => {
  const number = numeric(value, label);
  assert(number >= 0 && number <= 100, label + ' must be a percentage');
  return number;
};
const text = (value, label) => assert(typeof value === 'string' && value.length > 0, label + ' must be nonempty text');

async function rpc(name, body) {
  const started = performance.now();
  const response = await fetch(url + '/rest/v1/rpc/' + name, {
    method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
  });
  const data = await response.json();
  assert.equal(response.status, 200, name + ' must succeed' + (data?.code ? ' (' + data.code + ': ' + data.message + ')' : ''));
  assert(Array.isArray(data), name + ' must return an array');
  timings.push({ rpc: name, scope: body, rows: data.length, elapsed_ms: Math.round(performance.now() - started) });
  return data;
}

const params = new URLSearchParams({ select: 'id', league: 'eq.' + league, season: 'eq.' + season, limit: '1' });
const countResponse = await fetch(url + '/rest/v1/matches?' + params, { headers: { apikey: key, Prefer: 'count=exact' }, signal: AbortSignal.timeout(15000) });
assert(countResponse.ok, 'The coverage denominator must be readable from the public match archive');
const matchCount = Number((countResponse.headers.get('content-range') || '').split('/')[1]);
assert(Number.isInteger(matchCount) && matchCount > 0, 'The reference league season must contain stored matches');
await countResponse.arrayBuffer();

const coverage = await rpc('edgelab_data_coverage', { p_league: league, p_season: season });
const expectedMetrics = ['Asian handicap line', 'Bet365 closing home odds', 'Bet365 closing over 2.5 odds', 'Bet365 opening home odds', 'Bet365 over 2.5 odds', 'Corners', 'Fouls', 'Half-time scores', 'Red cards', 'Referee', 'Shots', 'Shots on target', 'Yellow cards'];
assert.deepEqual(coverage.map(row => row.metric).sort(), expectedMetrics.sort(), 'Coverage must contain each of the 13 original fields exactly once');
for (const row of coverage) {
  const available = count(row.available, row.metric + ' available'), total = count(row.total, row.metric + ' total');
  assert.equal(total, matchCount, 'Each coverage field must use the same stored-match denominator');
  assert(available <= total, 'Field coverage cannot exceed the stored-match denominator');
  assert.equal(percent(row.coverage_pct, row.metric + ' rate'), Math.round(1000 * available / total) / 10);
}

const movement = await rpc('edgelab_odds_movement', { p_league: league, p_season: season, p_market: 'H', p_team: null });
const movementAll = await rpc('edgelab_odds_movement', { p_league: league, p_season: null, p_market: 'H', p_team: null });
for (const data of [movement, movementAll]) {
  assert(data.length > 0 && data.length <= 3);
  for (const row of data) {
    text(row.movement, 'Movement label');
    const bets = count(row.bets, 'Movement bets');
    assert(bets > 0 && count(row.wins, 'Movement wins') <= bets);
    percent(row.win_pct, 'Movement win percentage');
    assert(numeric(row.avg_open, 'Opening average') > 1.01 && numeric(row.avg_close, 'Closing average') > 1.01);
    for (const field of ['avg_shift_pct', 'flat_profit', 'flat_roi_pct']) numeric(row[field], 'Movement ' + field);
  }
}
for (const row of movement) {
  const all = movementAll.find(item => item.movement === row.movement);
  assert(all && Number(all.bets) >= Number(row.bets), 'All-season movement must include every selected-season bucket');
}

const referees = await rpc('edgelab_referee_analysis', { p_league: league, p_season: season, p_min_matches: 5 });
assert(referees.length > 0);
for (const row of referees) {
  text(row.referee, 'Referee');
  const matches = count(row.matches, 'Referee matches');
  assert(matches >= 5);
  assert(['home_wins', 'draws', 'away_wins'].reduce((sum, field) => sum + count(row[field], 'Referee ' + field), 0) <= matches);
  percent(row.home_win_pct, 'Referee home win percentage');
  for (const field of ['cards_sample', 'fouls_sample']) assert(count(row[field], 'Referee ' + field) <= matches);
  for (const field of ['yellows_per_match', 'reds_per_match', 'fouls_per_match']) numeric(row[field], 'Referee ' + field, true);
}

const finishing = await rpc('edgelab_finishing_analysis', { p_league: league, p_season: season, p_venue: 'both', p_min_matches: 5 });
assert(finishing.length > 0);
for (const row of finishing) {
  text(row.team, 'Finishing team');
  const matches = count(row.matches, 'Finishing matches');
  assert(matches >= 5);
  count(row.goals, 'Finishing goals');
  for (const field of ['shot_sample', 'shots_on_target_sample']) assert(count(row[field], 'Finishing ' + field) <= matches);
  for (const field of ['shots', 'shots_on_target', 'goals_per_match', 'shots_per_match', 'accuracy_pct', 'conversion_pct', 'on_target_conversion_pct']) numeric(row[field], 'Finishing ' + field, true);
}

const discipline = await rpc('edgelab_setpiece_discipline', { p_league: league, p_season: season, p_venue: 'both', p_min_matches: 5 });
assert(discipline.length > 0);
for (const row of discipline) {
  text(row.team, 'Discipline team');
  const matches = count(row.matches, 'Discipline matches');
  assert(matches >= 5);
  for (const field of ['corners_sample', 'cards_sample', 'fouls_sample']) assert(count(row[field], 'Discipline ' + field) <= matches);
  for (const field of ['corners_for_per_game', 'corners_against_per_game', 'corner_diff_per_game', 'yellows_per_game', 'reds_per_game', 'fouls_per_game']) numeric(row[field], 'Discipline ' + field, true);
}

const history = await rpc('edgelab_team_history', { p_team: 'Arsenal', p_league: null });
assert(history.length > 0 && history.some(row => row.league === league && row.season === season), 'Arsenal must retain its reference league-season history');
for (const row of history) {
  text(row.league, 'History league'); text(row.season, 'History season');
  const played = count(row.played, 'History played'), wins = count(row.wins, 'History wins'), draws = count(row.draws, 'History draws'), losses = count(row.losses, 'History losses');
  assert(played > 0 && wins + draws + losses === played);
  const rank = count(row.league_rank, 'History rank'), teams = count(row.team_count, 'History team count');
  assert(rank >= 1 && rank <= teams);
  count(row.goals_for, 'History goals for'); count(row.goals_against, 'History goals against');
  assert.equal(count(row.points, 'History points'), 3 * wins + draws);
  assert.equal(numeric(row.points_per_game, 'History points per game'), Math.round(100 * row.points / played) / 100);
}

console.log('Live research reports passed: 13 coverage metrics with archive denominators, four comparison RPCs and complete known-team history.');
console.log(JSON.stringify({ league, season, stored_matches: matchCount, checks: timings }));
