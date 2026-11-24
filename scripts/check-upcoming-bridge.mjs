import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../assets/upcoming-bridge.js', import.meta.url), 'utf8');

function harness({ visible = false, today = '2026-11-24T18:00:00Z' } = {}) {
  const nodes = new Map(), events = new Map(), calls = { init: 0, table: [], profile: [], close: 0, navigation: [] };
  let options;
  const node = (id = '') => ({
    id, value: '', hidden: false, options: [], children: [], listeners: {},
    addEventListener(name, listener) { this.listeners[name] = listener; },
    appendChild(child) { child.parentElement = this; this.children.push(child); if (child.id) nodes.set(child.id, child); },
    prepend(child) { this.options.unshift(child); },
    click() { this.listeners.click?.(); },
  });
  for (const id of ['view-upcoming', 'tableCountry', 'tableLeague', 'tableSeason', 'tableDate', 'tableType', 'tableForm', 'teamBack']) nodes.set(id, node(id));
  nodes.get('view-upcoming').hidden = !visible;
  nodes.get('tableSeason').options = [{ value: '2627' }];
  nodes.get('teamBack').parentElement = node('profile-actions');
  const readControls = () => Object.fromEntries(['tableCountry', 'tableLeague', 'tableSeason', 'tableDate', 'tableType', 'tableForm'].map(id => [id, nodes.get(id).value]));
  const navigate = view => {
    calls.navigation.push(view); nodes.get('view-upcoming').hidden = view !== 'upcoming';
    events.get('gerball:viewchange')?.({ detail: { view } });
  };
  const window = {
    addEventListener(name, listener) { events.set(name, listener); },
    GerballUpcoming: { init(config) { options = config; calls.init++; return { retainedFilter: 'Arsenal' }; } },
  };
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [today])); }
    static now() { return Date.parse(today); }
  }
  const context = vm.createContext({
    window, Date: FixedDate, Intl,
    document: {
      getElementById(id) { return nodes.get(id); },
      createElement() { return node(); },
      querySelector(selector) {
        const match = selector.match(/\[data-view="(\w+)"\]/);
        return match ? { click() { navigate(match[1]); } } : null;
      },
    },
    CLOUD_URL: 'https://database.test',
    tableCountries: { England: ['E0', 'E1'], Spain: ['SP1'] },
    tableNames: { E0: 'Premier League', E1: 'Championship', SP1: 'La Liga' },
    tableOptions(id, values) { nodes.get(id).options = values.map(([value, textContent]) => ({ value, textContent })); },
    async renderLeagueTable() { calls.table.push(readControls()); },
    async openTeamProfile(team) { calls.profile.push({ team, ...readControls() }); },
    closeTeamProfile() { calls.close++; },
  });
  vm.runInContext(source, context);
  return { nodes, calls, navigate, config: () => options };
}

test('lazy initialization covers nav activation and a directly opened Upcoming view', () => {
  const lazy = harness();
  assert.equal(lazy.calls.init, 0);
  lazy.navigate('tables'); assert.equal(lazy.calls.init, 0);
  lazy.navigate('upcoming'); lazy.navigate('upcoming'); assert.equal(lazy.calls.init, 1);
  assert.equal(lazy.config().endpoint, 'https://database.test/functions/v1/gerball-upcoming-fixtures');
  const direct = harness({ visible: true });
  assert.equal(direct.calls.init, 1);
});

test('team link selects its league/season, caps history at today, and preserves the workspace on return', async () => {
  const app = harness({ visible: true });
  await app.config().onTeamOpen({ canonicalName: 'Barcelona', leagueCode: 'SP1', kickoffAt: '2026-11-28T20:00:00Z', side: 'away', fixture: { away: { stats: { season: '2627' } } } });
  assert.deepEqual(app.calls.profile[0], { team: 'Barcelona', tableCountry: 'Spain', tableLeague: 'SP1', tableSeason: '2627', tableDate: '2026-11-24', tableType: 'both', tableForm: '5' });
  assert.equal(app.calls.table.length, 1);
  app.nodes.get('teamUpcomingBack').click();
  assert.equal(app.calls.close, 1);
  assert.equal(app.calls.navigation.at(-1), 'upcoming');
  assert.equal(app.calls.init, 1, 'Return must reuse the existing fixture workspace and its filters');
});

test('same-day fixtures exclude that day from historical inputs', async () => {
  const app = harness({ visible: true, today: '2026-11-24T10:00:00Z' });
  await app.config().onTeamOpen({ canonicalName: 'Arsenal', leagueCode: 'E0', kickoffAt: '2026-11-24T20:00:00Z', side: 'home', fixture: {} });
  assert.equal(app.calls.profile[0].tableDate, '2026-11-23');
});

test('BST midnight and July season rollover use the London calendar', async () => {
  const app = harness({ visible: true, today: '2027-07-01T22:00:00Z' });
  await app.config().onTeamOpen({ canonicalName: 'Arsenal', leagueCode: 'E0', kickoffAt: '2027-07-01T23:30:00Z', side: 'home', fixture: {} });
  assert.equal(app.calls.profile[0].tableDate, '2027-07-01');
  assert.equal(app.calls.profile[0].tableSeason, '2728');
  assert.equal(app.nodes.get('tableSeason').options.filter(option => option.value === '2728').length, 1);
  await app.config().onTeamOpen({ canonicalName: 'Arsenal', leagueCode: 'E0', kickoffAt: '2027-07-02T18:00:00Z', side: 'home', fixture: {} });
  assert.equal(app.nodes.get('tableSeason').options.filter(option => option.value === '2728').length, 1);
  assert.equal(app.nodes.get('teamBack').parentElement.children.length, 1, 'The Upcoming return button must not be duplicated');
});

test('invalid team destinations do not navigate or fetch historical data', async () => {
  const app = harness({ visible: true });
  for (const payload of [
    { canonicalName: 'Unknown', leagueCode: 'ZZ', kickoffAt: '2026-11-28T20:00:00Z' },
    { canonicalName: '', leagueCode: 'E0', kickoffAt: '2026-11-28T20:00:00Z' },
    { canonicalName: 'Arsenal', leagueCode: 'E0', kickoffAt: 'invalid' },
  ]) await assert.rejects(app.config().onTeamOpen(payload));
  assert.equal(app.calls.navigation.length, 0);
  assert.equal(app.calls.table.length, 0);
  assert.equal(app.calls.profile.length, 0);
});
