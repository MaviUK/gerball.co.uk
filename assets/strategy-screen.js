(function (root) {
  'use strict';

  const VERSION = 'ppg_last5_dates_050_v1';
  const MARKETS = Object.freeze({ H: 'Home win', D: 'Draw', A: 'Away win' });
  const STATUSES = Object.freeze({ match: 'Rule matched', no_match: 'Does not match', insufficient_history: 'Insufficient history', unmatched_team: 'Team not linked' });
  const RULE_TEXT = Object.freeze({ H: 'Home PPG must be at least 0.500 above away PPG.', D: 'The absolute PPG difference must be at most 0.500.', A: 'Away PPG must be at least 0.500 above home PPG.' });
  const MAX_AGE = 5 * 60 * 1000;
  const PAGE_SIZE = 24;
  const instances = new WeakMap();
  const partsFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' });
  const dateFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', year: 'numeric' });
  const stampFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const kickoffFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

  function number(value) { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
  function decimal(value, digits = 2) { const parsed = number(value); return parsed === null ? '—' : parsed.toFixed(digits); }
  function signed(value, suffix = '') { const parsed = number(value); return parsed === null ? '—' : `${parsed > 0 ? '+' : ''}${parsed.toFixed(2)}${suffix}`; }
  function count(value) { return Number.isInteger(value) && value >= 0 ? String(value) : '—'; }
  function timestamp(value) { const parsed = typeof value === 'string' ? Date.parse(value) : NaN; return Number.isFinite(parsed) ? parsed : null; }
  function londonDay(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    const parts = Object.fromEntries(partsFormatter.formatToParts(date).map(item => [item.type, item.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }
  function dateLabel(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '—';
    const parsed = timestamp(value + 'T12:00:00Z'); return parsed === null ? '—' : dateFormatter.format(new Date(parsed));
  }
  function stampLabel(value) { const parsed = timestamp(value); return parsed === null ? 'Unavailable' : `${stampFormatter.format(new Date(parsed))} UK`; }
  function ageLabel(value, now = Date.now()) {
    const parsed = timestamp(value); if (parsed === null) return 'age unavailable';
    const minutes = Math.max(0, Math.floor((now - parsed) / 60000));
    if (minutes < 1) return 'less than a minute ago';
    if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
    const hours = Math.floor(minutes / 60); if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
    const days = Math.floor(hours / 24); return `${days} ${days === 1 ? 'day' : 'days'} ago`;
  }
  function searchText(value) { return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('en-GB'); }
  function marketStatus(fixture, market) { const status = fixture?.markets?.[market]?.status; return Object.hasOwn(STATUSES, status) ? status : 'unavailable'; }
  function futureFixtures(fixtures, now = Date.now()) {
    return (Array.isArray(fixtures) ? fixtures : []).filter(fixture => timestamp(fixture?.kickoff_at) !== null && timestamp(fixture.kickoff_at) > now)
      .sort((a, b) => timestamp(a.kickoff_at) - timestamp(b.kickoff_at) || String(a.event_id).localeCompare(String(b.event_id)));
  }
  function filterFixtures(fixtures, filters, now = Date.now()) {
    const words = searchText(filters.search).trim().split(/\s+/).filter(Boolean);
    return futureFixtures(fixtures, now).filter(fixture => {
      if (filters.results !== 'all' && marketStatus(fixture, filters.market) !== 'match') return false;
      const text = searchText([fixture.home?.provider_name, fixture.home?.canonical_name, fixture.away?.provider_name, fixture.away?.canonical_name].join(' '));
      return words.every(word => text.includes(word));
    });
  }
  function statusCounts(fixtures, market, now = Date.now()) {
    const output = { total: 0, match: 0, no_match: 0, inadequate: 0 };
    for (const fixture of futureFixtures(fixtures, now)) {
      output.total++;
      const status = marketStatus(fixture, market);
      if (status === 'match' || status === 'no_match') output[status]++;
      else output.inadequate++;
    }
    return output;
  }
  function validPayload(payload, league, days) {
    const rules = payload?.rules;
    return Boolean(payload?.status === 'ok' && payload.version === VERSION && payload.basis === 'stored_match_history' && payload.league_code === league && payload.days === days &&
      timestamp(payload.generated_at) !== null && payload.collection && Array.isArray(payload.fixtures) && payload.fixtures.every(fixture => fixture.league_code === league) && payload.backtest?.markets &&
      rules?.qualification_uses_current_odds === false && rules.prior_match_dates === 5 && rules.minimum_prior_games === 5 && rules.ppg_threshold === 0.5 && rules.ppg_decimal_places === 3 &&
      rules.venue_scope === 'all' && rules.season_scope === 'same_league_across_seasons');
  }
  function freshPayload(payload, now = Date.now()) {
    const generated = timestamp(payload?.generated_at);
    return generated !== null && generated <= now + 60000 && now - generated < MAX_AGE && londonDay(generated) === londonDay(now);
  }
  function seasonLabel(value) {
    const text = String(value || ''); if (!/^\d{4}$/.test(text)) return text || '—';
    const year = Number(text.slice(0, 2)); return `${year >= 90 ? 1900 + year : 2000 + year}/${text.slice(2)}`;
  }
  function csvCell(value) {
    let text = value === null || value === undefined ? '' : String(value);
    if (typeof value !== 'number' && (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text))) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }
  function csvForScreen(payload, fixtures, filters) {
    const headers = ['screen_generated_at', 'league', 'horizon_days', 'market', 'results_view', 'rule_version', 'basis', 'qualification_uses_current_odds', 'event_id', 'kickoff_at', 'cutoff_date',
      'home_provider', 'home_canonical', 'home_match_status', 'home_ppg', 'home_games', 'home_date_count', 'home_points', 'home_first_date', 'home_last_date',
      'away_provider', 'away_canonical', 'away_match_status', 'away_ppg', 'away_games', 'away_date_count', 'away_points', 'away_first_date', 'away_last_date',
      'home_minus_away_ppg', 'rule_status', 'rule_reason', 'threshold', 'prior_match_dates', 'minimum_prior_games'];
    const rows = fixtures.map(fixture => {
      const team = side => { const value = fixture[side] || {}, history = value.history || {}; return [value.provider_name, value.canonical_name, value.match_status, history.ppg, history.games, history.date_count, history.points, history.first_date, history.last_date]; };
      return [payload.generated_at, payload.league_code, payload.days, filters.market, filters.results, payload.version, payload.basis, false, fixture.event_id, fixture.kickoff_at, fixture.cutoff_date,
        ...team('home'), ...team('away'), fixture.ppg_gap, marketStatus(fixture, filters.market), fixture.markets?.[filters.market]?.reason, payload.rules.ppg_threshold, payload.rules.prior_match_dates, payload.rules.minimum_prior_games];
    });
    return '\uFEFF' + [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
  }

  function init(options) {
    const document = root.document, container = options?.container;
    if (!container) throw new Error('A screening container is required.');
    if (instances.has(container)) return instances.get(container);
    if (!options.endpoint || !Array.isArray(options.leagues) || !options.leagues.length) throw new Error('A screening endpoint and leagues are required.');
    const leagues = new Map(options.leagues);
    const initialLeague = leagues.has(options.initialLeague) ? options.initialLeague : options.leagues[0][0];
    const state = { data: null, loading: false, request: 0, controller: null, promise: null, destroyed: false, shown: PAGE_SIZE, signature: '', openDetails: new Set() };
    const make = (tag, className, text) => { const element = document.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = String(text); return element; };
    const button = (label, className, handler) => { const element = make('button', className, label); element.type = 'button'; element.addEventListener('click', handler); return element; };
    const option = (select, value, label) => { const item = make('option', '', label); item.value = value; select.appendChild(item); };
    const field = (id, label, values, selected) => {
      const host = make('div', 'ss-field'), caption = make('label', '', label), select = make('select'); caption.htmlFor = id; select.id = id;
      values.forEach(([value, title]) => option(select, value, title)); select.value = selected; host.append(caption, select); return { host, input: select };
    };
    container.classList.add('strategy-screen'); container.replaceChildren();
    const intro = make('section', 'card ss-intro'), introHeader = make('div', 'ss-intro-header'), introText = make('div');
    introText.append(make('p', 'ss-eyebrow', 'HISTORICAL STRATEGY RESEARCH'), make('h2', '', 'Screen fixtures against your match history.'), make('p', 'ss-intro-copy', 'Apply the existing five-date points-per-game rule, inspect its historical results, and review every fixture’s underlying inputs.'));
    const refresh = button('Refresh screen', 'secondary ss-refresh', () => reload());
    introHeader.append(introText, refresh); intro.appendChild(introHeader);
    const metadata = make('div', 'ss-metadata'), generated = make('p', '', 'Loading the research screen…'), captured = make('p'), collectionStatus = make('span', 'ss-collection-status');
    metadata.append(generated, captured, collectionStatus); intro.appendChild(metadata);
    const controls = make('section', 'card ss-controls'); controls.setAttribute('aria-label', 'Strategy screen controls');
    const leagueField = field('screenLeague', 'League', options.leagues, initialLeague);
    const marketField = field('screenMarket', 'Market', Object.entries(MARKETS), 'H');
    const daysField = field('screenHorizon', 'Upcoming horizon', [['7', 'Next 7 days'], ['14', 'Next 14 days'], ['31', 'Next 31 days']], '14');
    const resultsField = field('screenResults', 'Show results', [['matching', 'Rule matches'], ['all', 'All fixtures']], 'matching');
    const searchField = make('div', 'ss-field ss-search-field'), searchLabel = make('label', '', 'Find a team'), search = make('input');
    searchLabel.htmlFor = 'screenSearch'; search.id = 'screenSearch'; search.type = 'search'; search.placeholder = 'Either team or historical name'; search.autocomplete = 'off'; searchField.append(searchLabel, search);
    controls.append(leagueField.host, marketField.host, daysField.host, resultsField.host, searchField);
    const rule = make('section', 'ss-rule'); rule.setAttribute('aria-label', 'Screening rule');
    const ruleLine = make('p', 'ss-rule-primary');
    rule.append(ruleLine, make('p', '', 'Each team uses up to its five most recent match dates, with at least five prior games required. Inputs include all venues in the same league across seasons. PPG is shown to three decimals.'),
      make('p', '', 'Current bookmaker prices do not affect qualification. Inclusive boundaries can make the same fixture match more than one market.'),
      make('p', 'ss-goal-note', 'Goal markets stay outside this screen because the existing totals rule does not select a goal direction.'));
    const status = make('p', 'ss-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const notice = make('div', 'ss-notice'); notice.hidden = true;
    const summary = make('section', 'ss-summary'); summary.setAttribute('aria-label', 'League screening counts');
    const evidence = make('section', 'card ss-evidence'); evidence.setAttribute('aria-label', 'Historical strategy evidence'); evidence.hidden = true;
    const resultsSection = make('section', 'ss-results-section'); resultsSection.id = 'screenFixtureResults';
    const resultsHeader = make('div', 'ss-results-header'), resultsTitle = make('div'), resultsCount = make('p', 'ss-results-count');
    resultsTitle.append(make('h2', '', 'Upcoming screen'), resultsCount);
    const actions = make('div', 'ss-result-actions');
    const clear = button('Clear team filter', 'ss-clear', () => { search.value = ''; state.shown = PAGE_SIZE; renderFixtures(true); search.focus(); }); clear.hidden = true;
    const exportButton = button('Export screen CSV', 'secondary ss-export', () => exportScreen()); exportButton.disabled = true;
    actions.append(clear, exportButton); resultsHeader.append(resultsTitle, actions);
    const list = make('div', 'ss-fixture-list'); list.setAttribute('aria-label', 'Screened upcoming fixtures');
    const more = button('Show more fixtures', 'secondary ss-more', () => { state.shown += PAGE_SIZE; renderFixtures(true); }); more.hidden = true;
    resultsSection.append(resultsHeader, list, more);
    container.append(intro, controls, rule, status, notice, summary, evidence, resultsSection);

    function filters() { return { market: marketField.input.value, results: resultsField.input.value, search: search.value }; }
    function updateRule() { ruleLine.textContent = `${MARKETS[marketField.input.value]} rule: ${RULE_TEXT[marketField.input.value]}`; }
    function updateMetadata() {
      if (!state.data) return;
      generated.textContent = `Screen generated ${stampLabel(state.data.generated_at)} · ${ageLabel(state.data.generated_at)}`;
      captured.textContent = `Fixture collection ${stampLabel(state.data.collection.collected_at)} · ${ageLabel(state.data.collection.collected_at)}`;
      const age = timestamp(state.data.collection.collected_at), stale = age !== null && Date.now() - age > 26 * 3600000;
      const collection = state.data.collection.status;
      collectionStatus.textContent = stale ? 'Older fixture collection' : collection === 'completed' ? 'Collection complete' : collection === 'partial' ? 'Partial fixture collection' : 'Collection unavailable';
      collectionStatus.className = `ss-collection-status${stale || collection === 'partial' ? ' ss-collection-warning' : ''}`;
    }
    function renderSummary() {
      summary.replaceChildren(); if (!state.data) return;
      const totals = statusCounts(state.data.fixtures, marketField.input.value);
      const heading = make('div', 'ss-summary-heading'); heading.append(make('p', '', `${leagues.get(state.data.league_code) || state.data.league_code} · ${MARKETS[marketField.input.value]} · ${totals.total} upcoming fixtures`),
        button('View fixtures', 'ss-jump', () => resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' })));
      const cards = make('div', 'ss-count-grid');
      for (const [label, value, type] of [['Rule matches', totals.match, 'match'], ['Does not match', totals.no_match, 'no-match'], ['History unavailable', totals.inadequate, 'inadequate']]) {
        const tile = make('div', `ss-count ss-count-${type}`); tile.append(make('span', '', label), make('strong', '', value)); cards.appendChild(tile);
      }
      summary.append(heading, cards, make('p', 'ss-count-note', 'Counts cover the whole selected league and market before the team filter. Choose All fixtures to inspect exclusions.'));
    }
    function metricTable(columns, rows, className = '') {
      const table = make('table', `ss-table ${className}`), head = make('thead'), header = make('tr'), body = make('tbody');
      for (const label of columns) { const th = make('th', '', label); th.scope = 'col'; header.appendChild(th); } head.appendChild(header);
      for (const rowData of rows) {
        const row = make('tr'); rowData.forEach((value, index) => { const cell = make(index === 0 ? 'th' : 'td', '', value); if (!index) cell.scope = 'row'; row.appendChild(cell); }); body.appendChild(row);
      }
      table.append(head, body); const scroller = make('div', 'ss-table-scroll'); scroller.tabIndex = 0; scroller.setAttribute('role', 'region'); scroller.setAttribute('aria-label', 'Historical result table'); scroller.appendChild(table); return scroller;
    }
    function renderEvidence() {
      evidence.replaceChildren(); evidence.hidden = !state.data; if (!state.data) return;
      const history = state.data.backtest, market = marketField.input.value, result = history.markets[market];
      evidence.append(make('p', 'ss-eyebrow', 'RETROSPECTIVE EVIDENCE'), make('h2', '', `${MARKETS[market]} · historical results`),
        make('p', 'ss-evidence-period', `${dateLabel(history.from)} – ${dateLabel(history.to)} · ${leagues.get(state.data.league_code) || state.data.league_code}`),
        make('p', 'ss-evidence-note', `Both columns are retrospective checks. The final 30% of fixture dates begins ${dateLabel(history.split_date)}; it is not an untouched prospective trial.`));
      if (!result || !result.full || !result.holdout) { evidence.appendChild(make('p', 'ss-empty', 'Historical evidence is unavailable for this market.')); return; }
      const metrics = [
        ['Priced bets', value => count(value.bets)], ['Wins', value => count(value.wins)], ['Net result (units)', value => signed(value.profit_units)],
        ['ROI on stakes', value => signed(value.roi_pct, '%')], ['Maximum drawdown (units)', value => decimal(value.max_drawdown_units)], ['Average recorded odds', value => decimal(value.avg_odds)],
        ['First priced bet', value => dateLabel(value.first_date)], ['Last priced bet', value => dateLabel(value.last_date)],
      ];
      evidence.appendChild(metricTable(['Measure', 'Full period', 'Final 30% by date'], metrics.map(([label, format]) => [label, format(result.full), format(result.holdout)]), 'ss-evidence-table'));
      const coverage = make('div', 'ss-price-coverage');
      for (const [label, value] of [['Historical rule matches', result.rule_matches], ['Missing archived prices', result.missing_prices], [`Outside ${decimal(history.odds_min)}–${decimal(history.odds_max)}`, result.outside_price_range]]) {
        const item = make('p'); item.append(make('strong', '', count(value)), make('span', '', label)); coverage.appendChild(item);
      }
      evidence.append(coverage, make('p', 'ss-price-method', `${history.odds_source || 'B365 archived pre-closing prices'} · odds ${decimal(history.odds_min)}–${decimal(history.odds_max)} · ${decimal(history.commission_pct, 0)}% commission · ${decimal(history.slippage_pct, 0)}% slippage · flat ${decimal(history.stake_units, 0)} unit per priced bet. These historical price filters apply to the evidence table only.`));
      const detail = make('details', 'ss-season-details'), caption = make('summary', '', 'Season-by-season results'); detail.appendChild(caption);
      const seasons = Array.isArray(result.seasons) ? result.seasons : [];
      if (seasons.length) detail.appendChild(metricTable(['Season', 'Priced bets', 'Wins', 'Net units', 'ROI'], seasons.map(season => [seasonLabel(season.season), count(season.bets), count(season.wins), signed(season.profit_units), signed(season.roi_pct, '%')]), 'ss-season-table'));
      else detail.appendChild(make('p', 'ss-empty', 'No priced historical bets are available in this period.'));
      evidence.appendChild(detail);
    }
    function historyTeam(team, side) {
      const host = make('div', `ss-team ss-team-${side}`), history = team?.history || {};
      host.append(make('span', 'ss-team-side', side === 'home' ? 'HOME TEAM' : 'AWAY TEAM'), make('h3', '', team?.provider_name || team?.canonical_name || 'Team unavailable'));
      if (team?.canonical_name && team.canonical_name !== team.provider_name) host.appendChild(make('p', 'ss-canonical', `History: ${team.canonical_name}`));
      const ppg = make('p', 'ss-ppg'); ppg.append(make('strong', '', decimal(history.ppg, 3)), make('span', '', 'points / game')); host.appendChild(ppg);
      host.appendChild(make('p', 'ss-history-counts', `${count(history.games)} games · ${count(history.date_count)} dates · ${count(history.points)} points`));
      host.appendChild(make('p', 'ss-history-range', history.first_date && history.last_date ? `${dateLabel(history.first_date)} – ${dateLabel(history.last_date)}` : 'No prior result dates'));
      return host;
    }
    function dateGroups(team, side) {
      const host = make('div', 'ss-date-team'); host.appendChild(make('h4', '', `${side === 'home' ? 'Home' : 'Away'} · ${team?.canonical_name || team?.provider_name || 'Team unavailable'}`));
      const dates = Array.isArray(team?.history?.dates) ? [...team.history.dates].sort((a, b) => String(b.date).localeCompare(String(a.date))) : [];
      if (!dates.length) { host.appendChild(make('p', 'ss-no-history', 'No stored match dates were linked.')); return host; }
      const rows = make('ol', 'ss-date-list');
      for (const group of dates) {
        const row = make('li'), time = make('time', '', dateLabel(group.date)); time.dateTime = group.date;
        row.append(time, make('span', '', `${count(group.games)} ${group.games === 1 ? 'game' : 'games'} · ${count(group.points)} points`)); rows.appendChild(row);
      }
      host.appendChild(rows); return host;
    }
    function fixtureCard(fixture) {
      const market = marketField.input.value, statusValue = marketStatus(fixture, market), verdict = fixture.markets?.[market];
      const card = make('article', 'card ss-fixture');
      const meta = make('div', 'ss-fixture-meta'), kickoff = make('time', '', `${kickoffFormatter.format(new Date(fixture.kickoff_at))} UK`); kickoff.dateTime = fixture.kickoff_at;
      meta.append(make('span', '', fixture.league_name || leagues.get(fixture.league_code) || fixture.league_code), kickoff); card.appendChild(meta);
      const badge = make('span', `ss-verdict ss-verdict-${statusValue}`, STATUSES[statusValue] || 'Status unavailable'); card.appendChild(badge);
      const teams = make('div', 'ss-teams'); teams.append(historyTeam(fixture.home, 'home'), historyTeam(fixture.away, 'away')); card.appendChild(teams);
      const gap = number(fixture.ppg_gap);
      card.append(make('p', 'ss-gap', `Home PPG − away PPG: ${gap === null ? '—' : (gap > 0 ? '+' : '') + gap.toFixed(3)}`),
        make('p', 'ss-reason', verdict?.reason || (statusValue === 'unavailable' ? 'A rule result is unavailable for this fixture.' : RULE_TEXT[market])),
        make('p', 'ss-cutoff', `Historical cutoff ${dateLabel(fixture.cutoff_date)} · same league, all venues, across seasons`));
      const detail = make('details', 'ss-history-details'), detailTitle = make('summary', '', 'Inspect the five-date inputs'); detailTitle.dataset.screenFocus = `history:${fixture.event_id}`; detail.appendChild(detailTitle);
      const detailKey = fixture.event_id;
      detail.open = state.openDetails.has(detailKey);
      detail.addEventListener('toggle', () => { if (detail.open) state.openDetails.add(detailKey); else state.openDetails.delete(detailKey); });
      const dates = make('div', 'ss-date-grid'); dates.append(dateGroups(fixture.home, 'home'), dateGroups(fixture.away, 'away'));
      detail.append(make('p', 'ss-date-note', 'Newest dates first. Every game on a selected date contributes points and games; PPG is total points divided by total games.'), dates); card.appendChild(detail);
      if (typeof options.onMatchAnalysis === 'function') {
        const analysis = button('Match analysis', 'ss-analysis-button', async () => {
          try { await options.onMatchAnalysis({ fixture, returnFocus: analysis }); }
          catch { error.textContent = 'Match analysis could not be opened. Please try again.'; error.hidden = false; }
        });
        analysis.setAttribute('aria-label', `Historical match analysis for ${fixture.home?.provider_name || 'home team'} and ${fixture.away?.provider_name || 'away team'}`);
        analysis.dataset.screenFocus = `analysis:${fixture.event_id}`;
        const error = make('p', 'ss-analysis-error'); error.hidden = true; error.setAttribute('role', 'status'); card.append(analysis, error);
      }
      return card;
    }
    function renderFixtures(force = false) {
      if (!state.data) return;
      const active = filters(), filtered = filterFixtures(state.data.fixtures, active), signature = JSON.stringify([active, state.shown, filtered.map(fixture => fixture.event_id)]);
      resultsCount.textContent = `${filtered.length} ${active.results === 'all' ? 'fixtures' : 'rule matches'} for ${MARKETS[active.market]}${filtered.length > state.shown ? ` · showing ${state.shown}` : ''}`;
      exportButton.disabled = !filtered.length; clear.hidden = !search.value;
      more.hidden = filtered.length <= state.shown; more.textContent = `Show ${Math.min(PAGE_SIZE, Math.max(0, filtered.length - state.shown))} more fixtures`;
      if (!force && signature === state.signature) return;
      state.signature = signature;
      const focused = document.activeElement?.dataset?.screenFocus;
      list.replaceChildren();
      if (!filtered.length) {
        const empty = make('div', 'card ss-empty'); empty.append(make('h3', '', active.results === 'all' ? 'No upcoming fixtures to show' : 'No fixtures match this rule'),
          make('p', '', search.value ? 'Try another team name or clear the team filter.' : active.results === 'all' ? 'Choose another horizon or league. Fixtures already under way are excluded.' : 'Choose All fixtures to inspect why fixtures are excluded, or compare another market.'));
        list.appendChild(empty);
      } else for (const fixture of filtered.slice(0, state.shown)) list.appendChild(fixtureCard(fixture));
      if (focused) for (const node of list.querySelectorAll('[data-screen-focus]')) if (node.dataset.screenFocus === focused) { node.focus({ preventScroll: true }); break; }
    }
    function render() { updateRule(); updateMetadata(); renderSummary(); renderEvidence(); renderFixtures(true); }
    function clearDataForLoad() {
      state.data = null; state.signature = ''; state.shown = PAGE_SIZE; state.openDetails.clear();
      summary.replaceChildren(); evidence.replaceChildren(); evidence.hidden = true; list.replaceChildren(); more.hidden = true; exportButton.disabled = true;
      generated.textContent = 'Preparing the historical screen…'; captured.textContent = ''; collectionStatus.textContent = '';
      resultsCount.textContent = `Loading ${leagues.get(leagueField.input.value) || leagueField.input.value}…`;
    }
    function exportScreen() {
      if (!state.data) return;
      const active = filters(), fixtures = filterFixtures(state.data.fixtures, active);
      if (!fixtures.length) return;
      const blob = new Blob([csvForScreen(state.data, fixtures, active)], { type: 'text/csv;charset=utf-8' });
      const url = root.URL.createObjectURL(blob), link = make('a'); link.href = url; link.download = `gerball-history-screen-${state.data.league_code}-${active.market}-${londonDay(Date.now())}.csv`;
      document.body.appendChild(link); link.click(); link.remove(); root.setTimeout(() => root.URL.revokeObjectURL(url), 1000);
    }
    function reload() {
      if (state.destroyed) return Promise.resolve();
      const request = ++state.request, league = leagueField.input.value, days = Number(daysField.input.value);
      if (state.controller) state.controller.abort();
      const controller = new AbortController(); state.controller = controller; state.loading = true;
      const timeout = root.setTimeout(() => controller.abort(), 60000);
      refresh.disabled = true; refresh.textContent = 'Refreshing…'; container.setAttribute('aria-busy', 'true'); notice.hidden = true;
      clearDataForLoad(); status.textContent = `Loading historical evidence and upcoming fixtures for ${leagues.get(league) || league}.`;
      state.promise = (async () => {
        try {
          const url = new URL(options.endpoint, root.location?.href); url.searchParams.set('league', league); url.searchParams.set('days', String(days));
          const response = await root.fetch(url.href, { method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store', headers: options.apiKey ? { apikey: options.apiKey } : {}, signal: controller.signal });
          if (!response.ok) throw new Error('screen_unavailable');
          const data = await response.json();
          if (!validPayload(data, league, days)) throw new Error('invalid_screen');
          if (request !== state.request || state.destroyed) return;
          state.data = data; state.shown = PAGE_SIZE;
          status.textContent = `Loaded ${leagues.get(league) || league}. Rule matches describe this historical condition; they are not betting recommendations.`;
          render();
        } catch {
          if (request !== state.request || state.destroyed) return;
          state.data = null;
          status.textContent = `The screen for ${leagues.get(league) || league} could not be loaded.`;
          generated.textContent = 'Screen unavailable'; resultsCount.textContent = 'No results loaded for this selection.';
          notice.replaceChildren(make('p', '', 'Please try again. No results from a previous league are being shown.'), button('Try again', 'secondary ss-retry', () => reload())); notice.hidden = false;
        } finally {
          root.clearTimeout(timeout);
          if (request === state.request) { state.controller = null; state.loading = false; refresh.disabled = false; refresh.textContent = 'Refresh screen'; container.removeAttribute('aria-busy'); }
        }
      })();
      return state.promise;
    }
    function activate() {
      if (state.destroyed) return Promise.resolve();
      if (state.loading) return state.promise;
      if (!state.data || !freshPayload(state.data) || state.data.league_code !== leagueField.input.value || state.data.days !== Number(daysField.input.value)) return reload();
      updateMetadata(); renderSummary(); renderFixtures(false); return Promise.resolve();
    }
    leagueField.input.addEventListener('change', reload); daysField.input.addEventListener('change', reload);
    marketField.input.addEventListener('change', () => { state.shown = PAGE_SIZE; updateRule(); if (state.data) { renderSummary(); renderEvidence(); renderFixtures(true); } });
    resultsField.input.addEventListener('change', () => { state.shown = PAGE_SIZE; renderFixtures(true); });
    search.addEventListener('input', () => { state.shown = PAGE_SIZE; renderFixtures(true); });
    const timer = root.setInterval(() => {
      if (state.destroyed || !state.data || document.hidden) return;
      updateMetadata(); renderSummary(); renderFixtures(false);
    }, 60000);
    const api = { reload, activate, destroy() { state.destroyed = true; state.request++; state.controller?.abort(); root.clearInterval(timer); instances.delete(container); } };
    instances.set(container, api); updateRule(); reload(); return api;
  }

  root.GerballStrategyScreen = Object.freeze({ init, helpers: Object.freeze({ number, decimal, signed, count, timestamp, londonDay, dateLabel, ageLabel, marketStatus, futureFixtures, filterFixtures, statusCounts, validPayload, freshPayload, csvCell, csvForScreen }) });
})(typeof window === 'undefined' ? globalThis : window);
