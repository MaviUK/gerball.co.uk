import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validPayload } from '../supabase/functions/gerball-recorded-screens/handler.mjs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const url = html.match(/const CLOUD_URL='([^']+)'/)[1];
const key = html.match(/const CLOUD_KEY='([^']+)'/)[1];
const endpoint = url + '/functions/v1/gerball-recorded-screens?league=E0';

async function read(suffix = '') {
  const response = await fetch(endpoint + suffix, { headers: { apikey: key }, signal: AbortSignal.timeout(25000) });
  assert.equal(response.status, 200, 'Live recorded screens must respond successfully');
  return response.json();
}

const payload = await read();
assert(validPayload(payload, { p_league: 'E0', p_capture_date: null }), 'Live recorded screen contract, phase separation and outcome totals');
assert(payload.cohort, 'Production must have an initial recorded cohort for E0');
assert.equal(payload.coverage.expected_leagues, 18);

const fixed = await read('&date=' + payload.cohort.capture_date);
assert(validPayload(fixed, { p_league: 'E0', p_capture_date: payload.cohort.capture_date }));
assert.equal(fixed.cohort.input_sha256, payload.cohort.input_sha256, 'Recorded cohort must retain its hash');
const frozen = record => ({
  id: record.id, event_id: record.event_id, rule_version: record.rule_version, recorded_at: record.recorded_at,
  kickoff_at: record.kickoff_at, fixture_date: record.fixture_date, phase: record.phase, cutoff_date: record.cutoff_date,
  home: record.home, away: record.away, ppg_gap: record.ppg_gap, markets: record.markets, input_sha256: record.input_sha256,
});
assert.deepEqual(fixed.records.map(frozen), payload.records.map(frozen), 'An explicit date read must preserve the saved observations');

for (const record of payload.records) {
  assert.deepEqual(Object.keys(record.markets).sort(), ['A', 'D', 'H']);
  for (const market of ['H', 'D', 'A']) {
    if (record.markets[market].status === 'match' && record.first_qualifying?.[market]) {
      assert(record.first_qualifying[market].capture_date <= record.capture_date, 'First qualification cannot follow this qualifying observation');
    }
  }
  if (record.result.status === 'settled') assert.equal(record.result.source, 'football-data.co.uk');
}
console.log('Live recorded screens: authorized read, immutable cohort replay, frozen phases, provenance and unique-outcome totals passed.');
