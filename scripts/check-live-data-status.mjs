import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validPayload } from '../supabase/functions/gerball-data-status/handler.mjs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const url = html.match(/const CLOUD_URL='([^']+)'/)[1];
const key = html.match(/const CLOUD_KEY='([^']+)'/)[1];
const endpoint = url + '/functions/v1/gerball-data-status';
const response = await fetch(endpoint, { headers: { apikey: key }, signal: AbortSignal.timeout(25000) });
assert.equal(response.status, 200, 'Live data status endpoint must respond successfully');
const payload = await response.json();
assert(validPayload(payload), 'Live status must satisfy the closed safe projection and balanced counts');
assert.equal(payload.archive.league_count, 21);
assert.equal(payload.leagues.filter(league => league.odds_feed).length, 18);
assert.deepEqual(payload.leagues.filter(league => !league.odds_feed).map(league => league.code).sort(), ['SC1', 'SC2', 'SC3']);
assert.equal(payload.archive.import_schedule.run_audit_available, false);
assert.equal(payload.archive.import_schedule.last_successful_run_at, null);

const raw = await fetch(url + '/rest/v1/rpc/gerball_data_status', {
  method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(15000),
});
assert([401, 403, 404].includes(raw.status), 'The public client must not call the server-only RPC directly');

const post = await fetch(endpoint, { method: 'POST', headers: { apikey: key }, signal: AbortSignal.timeout(15000) });
assert.equal(post.status, 405, 'The public endpoint must reject writes');

console.log('Live data status: 21 archive leagues, 18 feeds, balanced observation totals, schedule provenance, private RPC and read-only methods passed.');
console.log(JSON.stringify({ generated_at: payload.generated_at, matches: payload.archive.total_matches, current_season: payload.current_season,
  stages: Object.fromEntries(Object.entries(payload.stages).map(([name, stage]) => [name, { state: stage.state, reason: stage.reason_code }])),
  attention: payload.attention.length }));
