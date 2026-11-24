(function (root) {
  'use strict';

  const MARKET_LABELS = Object.freeze({ H: 'Home', D: 'Draw', A: 'Away', O25: 'Over 2.5', U25: 'Under 2.5' });
  const MARKET_GROUPS = Object.freeze({ all: ['H', 'D', 'A', 'O25', 'U25'], h2h: ['H', 'D', 'A'], totals: ['O25', 'U25'] });
  const PAGE_SIZE = 24;
  const MAX_AGE = 5 * 60 * 1000;
  const MAX_DETAIL_CACHE = 48;
  const instances = new WeakMap();
  const dateParts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' });
  const displayDate = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short' });
  const displayTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const displayTimestamp = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const clockHour = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hourCycle: 'h23' });

  function timestamp(value) {
    const parsed = typeof value === 'string' ? Date.parse(value) : NaN;
    return Number.isFinite(parsed) ? parsed : null;
  }

  function londonDate(value) {
    const time = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : timestamp(value);
    if (time === null || !Number.isFinite(time)) return '';
    const parts = Object.fromEntries(dateParts.formatToParts(new Date(time)).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function formatStamp(value) {
    const time = timestamp(value);
    return time === null ? 'Time unavailable' : `${displayTimestamp.format(new Date(time))} UK`;
  }

  function ageLabel(value, now = Date.now()) {
    const time = timestamp(value);
    if (time === null) return 'Capture time unavailable';
    const minutes = Math.max(0, Math.floor((now - time) / 60000));
    if (minutes < 1) return 'less than a minute ago';
    if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
    const days = Math.floor(hours / 24);
    return `${days} ${days === 1 ? 'day' : 'days'} ago`;
  }

  function quotePrice(quote) {
    return quote && typeof quote.price === 'number' && Number.isFinite(quote.price) && quote.price > 1 && quote.price <= 10000 ? quote.price : null;
  }

  function snapshotRevision(data) {
    return JSON.stringify([data?.collection_date ?? null, data?.collected_at ?? null]);
  }

  function freshPayload(data, fetchedAt, now = Date.now()) {
    if (!data || !Number.isFinite(fetchedAt) || fetchedAt > now || now - fetchedAt >= MAX_AGE) return false;
    const generated = timestamp(data.generated_at);
    if (generated === null || generated > now + 60000 || now - generated >= MAX_AGE) return false;
    const today = londonDate(now);
    if (londonDate(fetchedAt) !== today || londonDate(generated) !== today) return false;
    const hour = Number(clockHour.format(new Date(now)));
    return !(hour >= 12 && (Number(clockHour.format(new Date(fetchedAt))) < 12 || Number(clockHour.format(new Date(generated))) < 12));
  }

  function seasonLabel(value) {
    const season = String(value || '');
    if (!/^\d{4}$/.test(season)) return season;
    const year = Number(season.slice(0, 2));
    return `${year >= 90 ? 1900 + year : 2000 + year}/${season.slice(2)}`;
  }

  function searchText(value) {
    return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('en-GB');
  }

  function filterFixtures(fixtures, filters = {}, now = Date.now()) {
    const words = searchText(filters.search).trim().split(/\s+/).filter(Boolean);
    const keys = MARKET_GROUPS[filters.market] || MARKET_GROUPS.all;
    return (Array.isArray(fixtures) ? fixtures : []).filter(fixture => {
      if (!fixture || typeof fixture !== 'object') return false;
      const kickoff = timestamp(fixture.kickoff_at);
      if (kickoff === null || kickoff <= now) return false;
      if (filters.league && fixture.league_code !== filters.league) return false;
      if (filters.date && londonDate(kickoff) !== filters.date) return false;
      if (filters.market && filters.market !== 'all' && !keys.some(key => quotePrice(fixture.markets && fixture.markets[key]) !== null)) return false;
      const names = searchText([fixture.home && fixture.home.provider_name, fixture.home && fixture.home.canonical_name,
        fixture.away && fixture.away.provider_name, fixture.away && fixture.away.canonical_name].filter(Boolean).join(' '));
      return words.every(word => names.includes(word));
    }).sort((a, b) => timestamp(a.kickoff_at) - timestamp(b.kickoff_at) ||
      String(a.league_name || '').localeCompare(String(b.league_name || '')) ||
      String(a.home && a.home.provider_name || '').localeCompare(String(b.home && b.home.provider_name || '')));
  }

  function init(options) {
    const document = root.document;
    const container = options && options.container || document.getElementById('upcomingFixtures');
    if (!container) return null;
    if (instances.has(container)) return instances.get(container);
    if (!options || typeof options.endpoint !== 'string' || !options.endpoint) throw new Error('Upcoming fixtures endpoint is required');

    const state = { data: null, fetchedAt: null, shown: PAGE_SIZE, loading: false, promise: null, request: 0, controller: null, signature: '', open: new Set(), details: new Map(), detailRequests: new Map(), detailGeneration: 0, destroyed: false };
    const element = (tag, className, value) => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (value !== undefined) node.textContent = String(value);
      return node;
    };
    const button = (label, className, action) => {
      const node = element('button', className, label);
      node.type = 'button';
      node.addEventListener('click', action);
      return node;
    };
    const addOption = (select, value, label) => {
      const option = element('option', '', label);
      option.value = value;
      select.appendChild(option);
    };

    container.classList.add('upcoming-workspace');
    container.replaceChildren();
    const intro = element('section', 'card upcoming-intro');
    const introHeader = element('div', 'upcoming-intro-header');
    const heading = element('div');
    heading.appendChild(element('div', 'upcoming-eyebrow', 'DAILY ODDS SNAPSHOTS'));
    heading.appendChild(element('h2', '', 'The next fixtures, in one place.'));
    heading.appendChild(element('p', 'muted', 'Compare captured UK bookmaker prices and explore the history behind each team.'));
    const refresh = button('Refresh fixtures', 'secondary upcoming-refresh', () => reload());
    introHeader.append(heading, refresh);
    intro.appendChild(introHeader);
    const meta = element('div', 'upcoming-meta');
    const captured = element('p', 'upcoming-captured', 'Loading the latest collection…');
    const collectionState = element('span', 'upcoming-state', 'Checking collection');
    const mappingCoverage = element('span', 'upcoming-mapping-coverage'); mappingCoverage.hidden = true;
    meta.append(captured, collectionState, mappingCoverage);
    intro.appendChild(meta);
    intro.appendChild(element('p', 'upcoming-explanation', 'Collection starts at 12:00 UK time each day. Prices are snapshots and may have changed since capture. All kickoff times below are UK time.'));

    const filtersPanel = element('section', 'card upcoming-filters');
    filtersPanel.setAttribute('aria-label', 'Filter upcoming fixtures');
    const filters = {};
    for (const [key, label] of [['league', 'League'], ['date', 'Match date'], ['market', 'Markets'], ['search', 'Find a team']]) {
      const field = element('div', `upcoming-filter upcoming-filter-${key}`);
      const input = element(key === 'search' ? 'input' : 'select');
      input.id = `upcoming-${key}`;
      input.name = `upcoming-${key}`;
      if (key === 'search') {
        input.type = 'search'; input.placeholder = 'Search either team'; input.autocomplete = 'off';
      }
      const caption = element('label', '', label); caption.htmlFor = input.id;
      field.append(caption, input); filtersPanel.appendChild(field); filters[key] = input;
      input.addEventListener(key === 'search' ? 'input' : 'change', () => { state.shown = PAGE_SIZE; renderResults(true); });
    }
    addOption(filters.league, '', 'All leagues');
    addOption(filters.date, '', 'All upcoming dates');
    addOption(filters.market, 'all', 'All five markets');
    addOption(filters.market, 'h2h', 'Home / draw / away');
    addOption(filters.market, 'totals', 'Over / under 2.5');

    const resultsHeader = element('div', 'upcoming-results-header');
    const resultsStatus = element('p', 'upcoming-results-status', 'Loading upcoming fixtures…');
    resultsStatus.setAttribute('role', 'status'); resultsStatus.setAttribute('aria-live', 'polite');
    const clear = button('Clear filters', 'upcoming-clear', () => {
      filters.league.value = ''; filters.date.value = ''; filters.market.value = 'all'; filters.search.value = '';
      state.shown = PAGE_SIZE; renderResults(true); filters.search.focus();
    });
    resultsHeader.append(resultsStatus, clear);
    const notice = element('div', 'upcoming-notice');
    notice.hidden = true; notice.setAttribute('role', 'status');
    const list = element('div', 'upcoming-list');
    list.setAttribute('aria-label', 'Upcoming football fixtures');
    const more = button('Show more fixtures', 'secondary upcoming-more', () => { state.shown += PAGE_SIZE; renderResults(true); });
    more.hidden = true;
    container.append(intro, filtersPanel, resultsHeader, notice, list, more);

    function updateMetadata() {
      if (!state.data) return;
      const time = timestamp(state.data.collected_at);
      captured.textContent = time === null ? 'A collection is not available yet.' : `Captured ${formatStamp(state.data.collected_at)} · ${ageLabel(state.data.collected_at)}`;
      const stale = time !== null && Date.now() - time > 26 * 60 * 60 * 1000;
      const status = state.data.collection_status;
      collectionState.textContent = stale ? 'Older snapshot' : status === 'completed' ? 'Collection complete' : status === 'partial' ? 'Partial collection' : status === 'running' ? 'Collection in progress' : 'Collection unavailable';
      collectionState.className = `upcoming-state${stale || ['partial', 'failed'].includes(status) ? ' upcoming-state-warning' : ''}`;
      collectionState.title = stale ? 'The latest collection is more than 26 hours old.' : status === 'partial' ? 'Some leagues could not be collected; available fixtures are shown.' : '';
      const mapping = state.data.mapping;
      const hasCoverage = mapping && Number.isInteger(mapping.matched_teams) && Number.isInteger(mapping.total_teams) &&
        mapping.matched_teams >= 0 && mapping.total_teams > 0 && mapping.matched_teams <= mapping.total_teams;
      mappingCoverage.hidden = !hasCoverage;
      if (hasCoverage) mappingCoverage.textContent = `History linked for ${mapping.matched_teams} of ${mapping.total_teams} teams`;
      for (const row of list.querySelectorAll('[data-captured-at]')) {
        row.textContent = `Latest capture ${formatStamp(row.dataset.capturedAt)} · ${ageLabel(row.dataset.capturedAt)}`;
      }
    }

    function updateFilterOptions() {
      const previous = { league: filters.league.value, date: filters.date.value };
      const upcoming = filterFixtures(state.data.fixtures);
      const leagues = new Map(), dates = new Map();
      for (const fixture of upcoming) {
        if (fixture.league_code) leagues.set(fixture.league_code, fixture.league_name || fixture.league_code);
        const day = londonDate(fixture.kickoff_at);
        if (day) dates.set(day, displayDate.format(new Date(timestamp(fixture.kickoff_at))));
      }
      filters.league.replaceChildren(); addOption(filters.league, '', 'All leagues');
      for (const [code, name] of [...leagues].sort((a, b) => a[1].localeCompare(b[1]))) addOption(filters.league, code, name);
      filters.date.replaceChildren(); addOption(filters.date, '', 'All upcoming dates');
      for (const [day, label] of [...dates].sort((a, b) => a[0].localeCompare(b[0]))) addOption(filters.date, day, label);
      if (leagues.has(previous.league)) filters.league.value = previous.league;
      if (dates.has(previous.date)) filters.date.value = previous.date;
    }

    function renderTeam(team, fixture, side) {
      const host = element('div', 'upcoming-team');
      const name = team && (team.provider_name || team.canonical_name) || 'Team unavailable';
      const canOpen = team && typeof team.canonical_name === 'string' && team.canonical_name.trim() &&
        ['exact', 'alias'].includes(team.match_status) && typeof options.onTeamOpen === 'function';
      const nameNode = canOpen ? button(name, 'upcoming-team-link', async () => {
        try {
          await options.onTeamOpen({ canonicalName: team.canonical_name, leagueCode: fixture.league_code, kickoffAt: fixture.kickoff_at, side, fixture });
        } catch {
          notice.replaceChildren(element('p', '', 'The team history could not be opened. Please try again.')); notice.hidden = false;
        }
      }) : element('span', 'upcoming-team-name', name);
      if (canOpen) nameNode.title = `Open ${team.canonical_name} team history`;
      host.appendChild(nameNode);
      host.appendChild(element('span', 'upcoming-team-note', canOpen ? 'View team history' : 'History not linked'));
      const stats = team && team.stats;
      if (stats && Number.isFinite(Number(stats.played)) && Number(stats.played) > 0) {
        const ppg = stats.ppg !== null && Number.isFinite(Number(stats.ppg)) ? Number(stats.ppg).toFixed(2) : '—';
        host.appendChild(element('span', 'upcoming-team-stats', `${stats.played} played · ${ppg} pts/game`));
        if (stats.season) host.appendChild(element('span', 'upcoming-team-season', `${seasonLabel(stats.season)} league results`));
        const form = String(stats.form || '').replace(/[^WDL]/g, '').slice(-5);
        if (form) {
          const formRow = element('span', 'upcoming-form');
          formRow.setAttribute('role', 'img');
          formRow.setAttribute('aria-label', `Last ${form.length} league results, oldest to newest: ${[...form].map(result => ({ W: 'win', D: 'draw', L: 'loss' })[result]).join(', ')}`);
          formRow.title = `Last ${form.length} league results, oldest to newest · ${seasonLabel(stats.season)}`;
          for (const result of form) {
            const pill = element('span', `upcoming-form-result upcoming-form-${result.toLowerCase()}`, result);
            pill.setAttribute('aria-hidden', 'true'); formRow.appendChild(pill);
          }
          host.appendChild(formRow);
        }
      }
      return host;
    }

    function quoteCell(key, quote) {
      const cell = element('div', 'upcoming-quote');
      const price = quotePrice(quote);
      cell.appendChild(element('span', 'upcoming-market-label', MARKET_LABELS[key]));
      cell.appendChild(element('strong', `upcoming-price${price === null ? ' upcoming-price-missing' : ''}`, price === null ? '—' : price.toFixed(2)));
      cell.appendChild(element('span', 'upcoming-bookmaker', price === null ? 'Not captured' : quote.bookmaker_name || 'Bookmaker unavailable'));
      if (price !== null) {
        cell.title = `Provider updated ${formatStamp(quote.source_updated_at)}; captured ${formatStamp(quote.collected_at)}`;
        cell.appendChild(element('span', 'upcoming-quote-time', timestamp(quote.source_updated_at) === null ? 'Update unknown' : displayTimestamp.format(new Date(timestamp(quote.source_updated_at)))));
      }
      return cell;
    }

    function comparisonTable(fixture, keys) {
      const scroller = element('div', 'upcoming-comparison-scroll');
      scroller.tabIndex = 0;
      scroller.setAttribute('role', 'region');
      scroller.setAttribute('aria-label', 'Bookmaker price comparison, scroll horizontally if needed');
      const table = element('table', 'upcoming-comparison');
      const caption = element('caption', 'upcoming-table-caption', 'Captured decimal odds. Each price shows its source update time.');
      table.appendChild(caption);
      const head = element('thead'), header = element('tr');
      for (const label of ['Bookmaker', ...keys.map(key => MARKET_LABELS[key])]) {
        const th = element('th', '', label); th.scope = 'col'; header.appendChild(th);
      }
      head.appendChild(header); table.appendChild(head);
      const body = element('tbody');
      const bookmakers = Array.isArray(fixture.bookmakers) ? [...fixture.bookmakers].filter(Boolean).sort((a, b) => String(a.name || a.key || '').localeCompare(String(b.name || b.key || ''))) : [];
      for (const bookmaker of bookmakers) {
        const row = element('tr'), name = element('th', '', bookmaker.name || bookmaker.key || 'Bookmaker');
        name.scope = 'row'; row.appendChild(name);
        for (const key of keys) {
          const quote = bookmaker.markets && bookmaker.markets[key], price = quotePrice(quote);
          const cell = element('td');
          cell.appendChild(element('strong', price === quotePrice(fixture.markets && fixture.markets[key]) && price !== null ? 'upcoming-best' : '', price === null ? '—' : price.toFixed(2)));
          if (price !== null) {
            cell.appendChild(element('small', '', formatStamp(quote.source_updated_at)));
            cell.title = `Captured ${formatStamp(quote.collected_at)}`;
          } else cell.title = 'This market was not captured from this bookmaker';
          row.appendChild(cell);
        }
        body.appendChild(row);
      }
      if (!bookmakers.length) {
        const row = element('tr'), cell = element('td', '', 'No bookmaker comparison is available for this fixture.');
        cell.colSpan = keys.length + 1; row.appendChild(cell); body.appendChild(row);
      }
      table.appendChild(body); scroller.appendChild(table);
      return scroller;
    }

    function renderFixture(fixture, keys) {
      const card = element('article', 'card upcoming-fixture');
      const kicker = element('div', 'upcoming-fixture-meta');
      kicker.appendChild(element('span', 'upcoming-league', fixture.league_name || fixture.league_code || 'League'));
      const kickoff = element('time', 'upcoming-kickoff'); kickoff.dateTime = fixture.kickoff_at;
      const date = new Date(timestamp(fixture.kickoff_at));
      kickoff.textContent = `${displayDate.format(date)} · ${displayTime.format(date)}`;
      kicker.appendChild(kickoff); card.appendChild(kicker);
      const teams = element('div', 'upcoming-teams');
      teams.append(renderTeam(fixture.home, fixture, 'home'), element('span', 'upcoming-versus', 'v'), renderTeam(fixture.away, fixture, 'away'));
      card.appendChild(teams);
      if (typeof options.onMatchAnalysis === 'function') {
        const analysis = button('Match analysis', 'secondary upcoming-analysis-button', () => {
          options.onMatchAnalysis({ fixture, returnFocus: analysis });
        });
        analysis.dataset.upcomingFocus = `analysis:${fixture.event_id}`;
        analysis.setAttribute('aria-label', `Historical match analysis: ${fixture.home?.provider_name || 'Home team'} versus ${fixture.away?.provider_name || 'Away team'}`);
        card.appendChild(analysis);
      }
      const oddsHeading = element('p', 'upcoming-odds-heading', 'Best captured odds · provider update times shown');
      card.appendChild(oddsHeading);
      const odds = element('div', `upcoming-odds upcoming-odds-${keys.length}`);
      for (const key of keys) odds.appendChild(quoteCell(key, fixture.markets && fixture.markets[key]));
      card.appendChild(odds);
      const quoteTimes = Object.values(fixture.markets || {}).map(quote => quote && timestamp(quote.collected_at)).filter(time => time !== null && Number.isFinite(time));
      if (quoteTimes.length) {
        const captureTime = new Date(Math.max(...quoteTimes)).toISOString();
        const capture = element('p', 'upcoming-fixture-capture', `Latest capture ${formatStamp(captureTime)} · ${ageLabel(captureTime)}`);
        capture.dataset.capturedAt = captureTime; card.appendChild(capture);
      }
      const details = element('details', 'upcoming-details'), summary = element('summary', '', Number.isInteger(fixture.bookmaker_count) && fixture.bookmaker_count > 0 ? `Compare ${fixture.bookmaker_count} ${fixture.bookmaker_count === 1 ? 'bookmaker' : 'bookmakers'}` : 'Compare bookmakers');
      summary.dataset.upcomingFocus = `comparison:${fixture.event_id}`;
      details.appendChild(summary);
      const detailHost = element('div', 'upcoming-detail-content');
      details.appendChild(detailHost);
      let built = false, loading = false;
      const buildComparison = async () => {
        if (built || loading) return;
        loading = true;
        detailHost.replaceChildren(element('p', 'upcoming-detail-status', 'Loading bookmaker prices…'));
        detailHost.setAttribute('aria-busy', 'true');
        try {
          const fullFixture = await loadBookmakers(fixture);
          if (!state.destroyed && detailHost.isConnected) { detailHost.replaceChildren(comparisonTable(fullFixture, keys)); built = true; }
        } catch (error) {
          if (!state.destroyed && detailHost.isConnected) {
            const needsRefresh = ['snapshot_changed', 'fixture_started'].includes(error.message);
            const message = error.message === 'snapshot_changed' ? 'The collection snapshot has changed. Refresh fixtures to compare prices from the same capture.'
              : error.message === 'fixture_started' ? 'This fixture has started or is no longer upcoming. Refresh the fixture list.'
              : error.message === 'list_refreshing' ? 'The fixture list is refreshing. Its bookmaker comparison will use the refreshed snapshot.'
              : error.message === 'comparison_cancelled' ? 'This comparison was cancelled during a fixture-list refresh. Please try again.'
              : 'Bookmaker prices could not be loaded. Please try again.';
            detailHost.replaceChildren(element('p', 'upcoming-detail-status', message));
            detailHost.appendChild(button(needsRefresh ? 'Refresh fixtures' : 'Try again', 'secondary upcoming-retry', needsRefresh ? () => reload() : () => buildComparison()));
          }
        } finally { loading = false; detailHost.removeAttribute('aria-busy'); }
      };
      details.addEventListener('toggle', () => {
        if (details.open) {
          state.open.add(fixture.event_id);
          buildComparison();
        } else state.open.delete(fixture.event_id);
      });
      if (state.open.has(fixture.event_id)) { details.open = true; buildComparison(); }
      card.appendChild(details);
      return card;
    }

    async function loadBookmakers(fixture) {
      if (state.loading) throw new Error('list_refreshing');
      if (!state.data?.fixtures.includes(fixture)) throw new Error('comparison_cancelled');
      if (timestamp(fixture.kickoff_at) <= Date.now()) throw new Error('fixture_started');
      if (fixture.bookmakers_loaded === true && Array.isArray(fixture.bookmakers)) return fixture;
      const revision = snapshotRevision(state.data), generation = state.detailGeneration;
      const cacheKey = JSON.stringify([revision, fixture.event_id]);
      if (state.details.has(cacheKey)) return state.details.get(cacheKey);
      if (state.detailRequests.has(cacheKey)) return state.detailRequests.get(cacheKey).promise;
      const controller = new AbortController();
      const timeout = root.setTimeout(() => controller.abort(), 20000);
      const url = new URL(options.endpoint, root.location && root.location.href);
      url.searchParams.set('event_id', fixture.event_id);
      if (fixture.league_code) url.searchParams.set('league', fixture.league_code);
      url.searchParams.set('days', '31');
      const pending = { controller, promise: null };
      state.detailRequests.set(cacheKey, pending);
      const current = () => !state.destroyed && generation === state.detailGeneration && revision === snapshotRevision(state.data) && !controller.signal.aborted;
      pending.promise = Promise.resolve().then(async () => {
        try {
          if (!current()) throw new Error('comparison_cancelled');
          const response = await root.fetch(url.href, { method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store', signal: controller.signal });
          if (!response.ok) throw new Error('comparison_unavailable');
          const data = await response.json();
          if (!current()) throw new Error('comparison_cancelled');
          if (snapshotRevision(data) !== revision) throw new Error('snapshot_changed');
          if (timestamp(fixture.kickoff_at) <= Date.now()) throw new Error('fixture_started');
          const fullFixture = Array.isArray(data.fixtures) && data.fixtures.find(item => item.event_id === fixture.event_id);
          if (!fullFixture || fullFixture.league_code !== fixture.league_code || fullFixture.kickoff_at !== fixture.kickoff_at || fullFixture.bookmakers_loaded !== true || !Array.isArray(fullFixture.bookmakers)) throw new Error('invalid_comparison_response');
          if (timestamp(fullFixture.kickoff_at) <= Date.now()) throw new Error('fixture_started');
          state.details.set(cacheKey, fullFixture);
          while (state.details.size > MAX_DETAIL_CACHE) state.details.delete(state.details.keys().next().value);
          return fullFixture;
        } finally { root.clearTimeout(timeout); if (state.detailRequests.get(cacheKey) === pending) state.detailRequests.delete(cacheKey); }
      });
      return pending.promise;
    }

    function renderResults(force) {
      if (!state.data) return;
      const activeFilters = Object.fromEntries(Object.entries(filters).map(([key, input]) => [key, input.value]));
      const fixtures = filterFixtures(state.data.fixtures, activeFilters);
      const signature = JSON.stringify([fixtures.map(fixture => fixture.event_id), state.shown, activeFilters]);
      const shown = fixtures.slice(0, state.shown), keys = MARKET_GROUPS[activeFilters.market] || MARKET_GROUPS.all;
      resultsStatus.textContent = fixtures.length ? `${fixtures.length} upcoming ${fixtures.length === 1 ? 'fixture' : 'fixtures'}${fixtures.length > shown.length ? ` · showing ${shown.length}` : ''}` : 'No upcoming fixtures match these filters.';
      more.hidden = fixtures.length <= shown.length;
      more.textContent = `Show ${Math.min(PAGE_SIZE, Math.max(0, fixtures.length - shown.length))} more fixtures`;
      clear.hidden = !(activeFilters.league || activeFilters.date || activeFilters.search || activeFilters.market !== 'all');
      if (!force && state.signature === signature) return;
      state.signature = signature;
      const focused = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.upcomingFocus;
      list.replaceChildren();
      if (!fixtures.length) {
        const empty = element('div', 'card upcoming-empty');
        empty.appendChild(element('h3', '', 'No fixtures to show'));
        empty.appendChild(element('p', 'muted', state.data.fixtures.length ? 'Try another date or league, or clear your filters. Fixtures already under way are excluded.' : 'The next daily collection will appear here when upcoming odds are available.'));
        list.appendChild(empty);
      } else for (const fixture of shown) list.appendChild(renderFixture(fixture, keys));
      if (focused) for (const node of list.querySelectorAll('[data-upcoming-focus]')) {
        if (node.dataset.upcomingFocus === focused) { node.focus({ preventScroll: true }); break; }
      }
    }

    function clearDetails() {
      state.detailGeneration++;
      for (const pending of state.detailRequests.values()) pending.controller.abort();
      state.detailRequests.clear(); state.details.clear();
    }

    function reload() {
      if (state.destroyed) return Promise.resolve();
      const request = ++state.request;
      if (state.controller) state.controller.abort();
      clearDetails();
      const controller = new AbortController(); state.controller = controller;
      const timeout = root.setTimeout(() => controller.abort(), 20000);
      state.loading = true; container.setAttribute('aria-busy', 'true');
      refresh.disabled = true; refresh.textContent = 'Refreshing…'; notice.hidden = true;
      if (!state.data) resultsStatus.textContent = 'Loading upcoming fixtures…';
      else { updateMetadata(); renderResults(false); }
      state.promise = Promise.resolve().then(async () => { try {
        const response = await root.fetch(options.endpoint, { method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('fixture_service_unavailable');
        const data = await response.json();
        if (!data || typeof data !== 'object' || !Array.isArray(data.fixtures)) throw new Error('invalid_fixture_response');
        if (request !== state.request || state.destroyed) return;
        state.data = data; state.fetchedAt = Date.now(); state.loading = false;
        const futureIds = new Set(filterFixtures(data.fixtures).map(fixture => fixture.event_id));
        state.open = new Set([...state.open].filter(id => futureIds.has(id)));
        updateMetadata(); updateFilterOptions(); renderResults(true);
      } catch {
        if (request !== state.request || state.destroyed) return;
        notice.replaceChildren(element('p', '', state.data ? 'The refresh failed. You are viewing the previously loaded snapshot; its capture time is shown above.' : 'Upcoming fixtures could not be loaded. Please try again.'));
        notice.appendChild(button('Try again', 'secondary upcoming-retry', () => reload()));
        notice.hidden = false;
        if (!state.data) {
          resultsStatus.textContent = 'Fixtures are temporarily unavailable.';
          captured.textContent = 'Collection details are temporarily unavailable.';
          collectionState.textContent = 'Connection unavailable'; collectionState.className = 'upcoming-state upcoming-state-warning';
        } else { updateMetadata(); renderResults(false); }
      } finally {
        root.clearTimeout(timeout);
        if (request === state.request) {
          state.loading = false; state.promise = null; container.removeAttribute('aria-busy'); refresh.disabled = false; refresh.textContent = 'Refresh fixtures';
        }
      } });
      return state.promise;
    }

    function activate() {
      if (state.destroyed) return Promise.resolve();
      if (state.data) { updateMetadata(); renderResults(false); }
      if (state.loading) return state.promise;
      if (!freshPayload(state.data, state.fetchedAt)) return reload();
      return Promise.resolve();
    }

    const timer = root.setInterval(() => { if (!state.destroyed && state.data && !document.hidden) { updateMetadata(); renderResults(false); } }, 60000);
    const api = {
      reload, activate,
      destroy() {
        state.destroyed = true; state.request++;
        if (state.controller) state.controller.abort();
        clearDetails();
        root.clearInterval(timer); instances.delete(container);
      },
    };
    instances.set(container, api); reload();
    return api;
  }

  root.GerballUpcoming = Object.freeze({ init, helpers: Object.freeze({ londonDate, ageLabel, quotePrice, filterFixtures, searchText, formatStamp, seasonLabel, freshPayload, snapshotRevision }) });
})(typeof window !== 'undefined' ? window : globalThis);
