import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const context = vm.createContext({ Intl, Date, URL, AbortController });
vm.runInContext(readFileSync(new URL('../assets/upcoming.js', import.meta.url), 'utf8'), context);
const { londonDate, ageLabel, quotePrice, filterFixtures, searchText, seasonLabel, freshPayload, snapshotRevision } = context.GerballUpcoming.helpers;
let checks = 0;
function check(label, verify) { verify(); checks++; console.log(`PASS ${label}`); }

check('London dates follow GMT, BST and both clock changes', () => {
  assert.equal(londonDate('2027-01-01T23:30:00Z'), '2027-01-01');
  assert.equal(londonDate('2027-07-01T23:30:00Z'), '2027-07-02');
  assert.equal(londonDate('2027-03-27T23:30:00Z'), '2027-03-27');
  assert.equal(londonDate('2027-03-28T23:30:00Z'), '2027-03-29');
  assert.equal(londonDate('2027-10-30T23:30:00Z'), '2027-10-31');
  assert.equal(londonDate('2027-10-31T23:30:00Z'), '2027-10-31');
  assert.equal(londonDate('invalid'), '');
});

check('Capture age preserves useful units and handles invalid timestamps', () => {
  const stamp = '2027-01-01T12:00:00Z', base = Date.parse(stamp);
  assert.equal(ageLabel(stamp, base + 30_000), 'less than a minute ago');
  assert.equal(ageLabel(stamp, base + 60_000), '1 minute ago');
  assert.equal(ageLabel(stamp, base + 3_600_000), '1 hour ago');
  assert.equal(ageLabel(stamp, base + 49 * 3_600_000), '2 days ago');
  assert.equal(ageLabel('invalid', base), 'Capture time unavailable');
});

check('Only valid decimal prices become displayed odds', () => {
  assert.equal(quotePrice({ price: 2.25 }), 2.25);
  for (const quote of [null, {}, { price: '2.25' }, { price: 0 }, { price: 1 }, { price: NaN }, { price: Infinity }, { price: 10001 }]) {
    assert.equal(quotePrice(quote), null);
  }
});

const now = Date.parse('2027-07-01T12:00:00Z');
const fixtures = [
  { event_id: 'later', league_code: 'E0', league_name: 'Premier League', kickoff_at: '2027-07-01T23:30:00Z', home: { provider_name: 'Manchester United', canonical_name: 'Man United' }, away: { provider_name: 'Liverpool' }, markets: { H: { price: 2.1 }, D: { price: 3.4 } } },
  { event_id: 'earlier', league_code: 'SP1', league_name: 'La Liga', kickoff_at: '2027-07-01T18:00:00Z', home: { provider_name: 'Atlético Madrid', canonical_name: 'Ath Madrid' }, away: { provider_name: 'Barcelona' }, markets: { A: { price: 2.5 }, O25: { price: 1.9 } } },
  { event_id: 'started', league_code: 'E0', kickoff_at: '2027-07-01T12:00:00Z', home: { provider_name: 'Arsenal' }, markets: { H: { price: 2 } } },
  { event_id: 'invalid', kickoff_at: 'invalid', home: { provider_name: 'Invalid' } },
];

check('Upcoming list excludes started fixtures and sorts by actual kickoff', () => {
  assert.equal(filterFixtures(fixtures, {}, now).map(fixture => fixture.event_id).join(','), 'earlier,later');
  assert.equal(fixtures[0].event_id, 'later', 'Filtering must not mutate API ordering');
});

check('Date filter uses London day and league filter uses exact league code', () => {
  assert.equal(filterFixtures(fixtures, { date: '2027-07-02' }, now).map(fixture => fixture.event_id).join(','), 'later');
  assert.equal(filterFixtures(fixtures, { league: 'SP1' }, now).map(fixture => fixture.event_id).join(','), 'earlier');
  assert.equal(filterFixtures(fixtures, { league: 'E0', date: '2027-07-01' }, now).length, 0);
});

check('Team search matches both provider names and historical aliases', () => {
  assert.equal(filterFixtures(fixtures, { search: 'MAN united' }, now)[0].event_id, 'later');
  assert.equal(filterFixtures(fixtures, { search: 'atletico barcelona' }, now)[0].event_id, 'earlier');
  assert.equal(filterFixtures(fixtures, { search: 'Ath Madrid' }, now)[0].event_id, 'earlier');
  assert.equal(searchText('Atlético'), 'atletico');
});

check('Market filtering requires a captured price in the chosen group', () => {
  assert.equal(filterFixtures(fixtures, { market: 'totals' }, now).map(fixture => fixture.event_id).join(','), 'earlier');
  assert.equal(filterFixtures(fixtures, { market: 'h2h' }, now).length, 2);
  assert.equal(filterFixtures([{ ...fixtures[0], markets: { O25: { price: null } } }], { market: 'totals' }, now).length, 0);
});

check('Historical season codes remain readable in form labels', () => {
  assert.equal(seasonLabel('2627'), '2026/27');
  assert.equal(seasonLabel('9394'), '1993/94');
  assert.equal(seasonLabel('2026/27'), '2026/27');
});

check('Workspace freshness uses both fetched and generated time with an exact five-minute boundary', () => {
  const now = Date.parse('2026-11-24T13:00:00Z'), data = { generated_at: new Date(now).toISOString() };
  assert.equal(freshPayload(data, now, now + 299999), true);
  assert.equal(freshPayload(data, now, now + 300000), false);
  assert.equal(freshPayload({ generated_at: new Date(now - 300000).toISOString() }, now, now), false);
  assert.equal(freshPayload(data, now + 1, now), false);
  assert.equal(freshPayload({ generated_at: new Date(now + 60001).toISOString() }, now, now), false);
  assert.equal(freshPayload({}, now, now), false);
});

check('Returning across UK noon or midnight expires a recently fetched workspace in GMT and BST', () => {
  for (const [before, after] of [
    ['2026-11-24T11:59:00Z', '2026-11-24T12:00:00Z'],
    ['2027-07-01T10:59:00Z', '2027-07-01T11:00:00Z'],
    ['2026-11-24T23:59:00Z', '2026-11-25T00:00:00Z'],
    ['2027-07-01T22:59:00Z', '2027-07-01T23:00:00Z'],
  ]) {
    assert.equal(freshPayload({ generated_at: before }, Date.parse(before), Date.parse(after)), false, `${before} to ${after}`);
    assert.equal(freshPayload({ generated_at: after }, Date.parse(after), Date.parse(after) + 1000), true);
  }
});

check('Collection revisions retain same-day capture changes, including timestamp precision', () => {
  const data = { collection_date: '2026-11-24', collected_at: '2026-11-24T12:00:00.000001+00:00' };
  assert.equal(snapshotRevision(data), snapshotRevision({ ...data, generated_at: 'later' }));
  assert.notEqual(snapshotRevision(data), snapshotRevision({ ...data, collected_at: '2026-11-24T12:00:00.000002+00:00' }));
  assert.notEqual(snapshotRevision(data), snapshotRevision({ ...data, collection_date: '2026-11-25' }));
});

console.log(`Upcoming fixtures UI: ${checks} checks passed.`);
