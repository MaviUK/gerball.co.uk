(function (root) {
  'use strict';

  const CACHE_MS = 5 * 60 * 1000;
  const MAX_CACHE_ENTRIES = 24;
  const cache = new Map();
  const dateDisplay = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' });
  const kickoffDisplay = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/London' });
  const dayParts = new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/London' });
  let ui = null;
  const state = { fixture: null, endpoint: '', data: null, sample: 'season', venue: 'venue', window: 10, request: 0, controller: null, returnFocus: null };

  function numeric(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  function decimal(value, places = 2) {
    const number = numeric(value);
    return number === null ? '—' : number.toFixed(places);
  }

  function percent(value) {
    const number = numeric(value);
    return number === null || number < 0 || number > 100 ? '—' : `${number.toFixed(1)}%`;
  }

  function sampleRate(count, played, rate) {
    const n = numeric(played), events = numeric(count), frequency = numeric(rate);
    if (n === null || n <= 0 || !Number.isInteger(n) || events === null || !Number.isInteger(events) || events < 0 || events > n || frequency === null || frequency < 0 || frequency > 100) return '—';
    return `${events}/${n} · ${percent(frequency)}`;
  }

  function formattedDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'Date unavailable';
    const date = new Date(value + 'T12:00:00Z');
    return Number.isFinite(date.getTime()) ? dateDisplay.format(date) : 'Date unavailable';
  }

  function londonDay(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    const parts = Object.fromEntries(dayParts.formatToParts(date).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function seasonLabel(value) {
    const text = String(value || '');
    if (!/^\d{4}$/.test(text)) return text || 'Season unavailable';
    const year = Number(text.slice(0, 2));
    return `${year >= 90 ? 1900 + year : 2000 + year}/${text.slice(2)}`;
  }

  function selectedStats(team, sample, venue) {
    return team?.[sample === 'season' ? 'season' : 'recent']?.[venue === 'venue' ? 'venue' : 'overall'] || null;
  }

  function validPayload(data, eventId, windowSize) {
    return Boolean(data && data.status === 'ok' && data.basis === 'stored_match_history' && data.fixture?.event_id === eventId && data.window === windowSize && data.home && data.away && data.league && data.head_to_head && typeof data.as_of_date === 'string');
  }

  function cacheIsFresh(entry, now = Date.now()) {
    if (!entry || !Number.isFinite(entry.savedAt) || now < entry.savedAt || now - entry.savedAt >= CACHE_MS) return false;
    const generated = Date.parse(entry.data?.generated_at), kickoff = Date.parse(entry.data?.fixture?.kickoff_at);
    return Number.isFinite(generated) && now - generated < CACHE_MS && generated <= now + 60000 && Number.isFinite(kickoff) && kickoff > now && londonDay(entry.savedAt) === londonDay(now);
  }

  function teamName(fixture, side) {
    return fixture?.[side]?.provider_name || fixture?.[side]?.canonical_name || (side === 'home' ? 'Home team' : 'Away team');
  }

  function make(tag, className, value) {
    const element = root.document.createElement(tag);
    if (className) element.className = className;
    if (value !== undefined) element.textContent = String(value);
    return element;
  }

  function button(text, className, action) {
    const element = make('button', className, text);
    element.type = 'button';
    element.addEventListener('click', action);
    return element;
  }

  function selectField(id, label, options, value) {
    const field = make('div', 'fa-control');
    const caption = make('label', '', label); caption.htmlFor = id;
    const select = make('select'); select.id = id;
    for (const [key, title] of options) {
      const option = make('option', '', title); option.value = key; select.appendChild(option);
    }
    select.value = value;
    field.append(caption, select);
    return { field, select };
  }

  function ensureDialog() {
    if (ui) return ui;
    const dialog = make('dialog', 'fixture-analysis'); dialog.id = 'fixtureAnalysis';
    dialog.setAttribute('aria-labelledby', 'fixtureAnalysisTitle');
    dialog.setAttribute('aria-describedby', 'fixtureAnalysisDescription');
    const header = make('div', 'fa-header');
    const titleArea = make('div', 'fa-title-area');
    titleArea.appendChild(make('p', 'fa-eyebrow', 'HISTORICAL MATCH ANALYSIS'));
    const title = make('h2'); title.id = 'fixtureAnalysisTitle';
    const meta = make('p', 'fa-fixture-meta');
    titleArea.append(title, meta);
    const closeButton = button('Close', 'fa-close', close);
    closeButton.setAttribute('aria-label', 'Close match analysis'); closeButton.autofocus = true;
    header.append(titleArea, closeButton);

    const toolbar = make('div', 'fa-toolbar');
    const sampleControl = selectField('fixtureAnalysisSample', 'Comparison sample', [['season', 'Current season'], ['5', 'Last 5'], ['10', 'Last 10'], ['20', 'Last 20']], state.sample);
    const venueControl = selectField('fixtureAnalysisVenue', 'Venues', [['venue', 'Home vs away'], ['overall', 'All venues']], state.venue);
    const refresh = button('Refresh analysis', 'fa-refresh', () => load(state.sample === 'season' ? state.window : Number(state.sample), true));
    toolbar.append(sampleControl.field, venueControl.field, refresh);
    const body = make('div', 'fa-body');
    const description = make('p', 'fa-description', 'Observed results from your stored history. Rates describe this sample.');
    description.id = 'fixtureAnalysisDescription';
    const status = make('p', 'fa-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const content = make('div', 'fa-content');
    body.append(description, status, content);
    dialog.append(header, toolbar, body);
    root.document.body.appendChild(dialog);
    ui = { dialog, title, meta, closeButton, sample: sampleControl.select, venue: venueControl.select, refresh, body, status, content };

    sampleControl.select.addEventListener('change', () => {
      state.sample = sampleControl.select.value;
      const wanted = state.sample === 'season' ? state.window : Number(state.sample);
      if (state.data && (state.sample === 'season' || state.data.window === wanted)) {
        cancelRequest(); render();
      } else load(wanted);
    });
    venueControl.select.addEventListener('change', () => {
      state.venue = venueControl.select.value;
      if (state.data && (state.sample === 'season' || state.data.window === Number(state.sample))) render();
    });
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const box = dialog.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close();
    });
    dialog.addEventListener('close', () => {
      cancelRequest();
      root.document.documentElement.classList.remove('fixture-analysis-open');
      const focus = state.returnFocus;
      state.returnFocus = null;
      if (focus?.isConnected && typeof focus.focus === 'function') focus.focus({ preventScroll: true });
      else root.document.querySelector('[data-view="upcoming"]')?.focus({ preventScroll: true });
    });
    return ui;
  }

  function cancelRequest() {
    state.request++;
    if (state.controller) state.controller.abort();
    state.controller = null;
    if (ui) {
      ui.refresh.disabled = false;
      ui.refresh.textContent = 'Refresh analysis';
      ui.content.removeAttribute('aria-busy');
    }
  }

  function close() {
    if (ui?.dialog.open) ui.dialog.close();
  }

  function section(title, note) {
    const host = make('section', 'fa-section');
    host.appendChild(make('h3', '', title));
    if (note) host.appendChild(make('p', 'fa-section-note', note));
    return host;
  }

  function formPills(value) {
    const form = String(value || '').replace(/[^WDL]/g, '').slice(-5);
    if (!form) return make('span', 'fa-missing', 'No results');
    const row = make('div', 'fa-form');
    row.setAttribute('role', 'img');
    row.setAttribute('aria-label', `Last ${form.length} results, oldest to newest: ${[...form].map(value => ({ W: 'win', D: 'draw', L: 'loss' })[value]).join(', ')}`);
    for (const value of form) {
      const pill = make('span', `fa-form-${value.toLowerCase()}`, value); pill.setAttribute('aria-hidden', 'true'); row.appendChild(pill);
    }
    return row;
  }

  function comparison(data) {
    const homeStats = selectedStats(data.home, state.sample, state.venue), awayStats = selectedStats(data.away, state.sample, state.venue);
    const season = seasonLabel(data.fixture.season);
    const scope = state.sample === 'season' ? `${season} season` : `Last ${state.sample} current-season matches`;
    const venueNote = state.venue === 'venue' ? 'Home side at home; away side away.' : 'Both teams at all venues.';
    const host = section('Team comparison', `${scope}. ${venueNote} Each percentage uses the sample shown for that team.`);
    const context = make('div', 'fa-team-context');
    for (const [side, stats] of [['home', homeStats], ['away', awayStats]]) {
      const card = make('div', `fa-team-summary fa-team-${side}`);
      card.appendChild(make('span', 'fa-team-label', side === 'home' ? 'HOME TEAM' : 'AWAY TEAM'));
      card.appendChild(make('h4', '', teamName(data.fixture, side)));
      const identity = data.fixture[side];
      if (identity.match_status === 'unmatched' || !identity.canonical_name) {
        card.appendChild(make('p', 'fa-coverage-warning', 'Historical records are not linked for this team.'));
      } else if (!stats || stats.played === 0) {
        card.appendChild(make('p', 'fa-coverage-warning', 'No recorded matches in this sample.'));
      } else {
        card.appendChild(make('p', 'fa-sample-size', `${stats.played} ${stats.played === 1 ? 'match' : 'matches'} in this sample`));
        card.appendChild(make('p', 'fa-date-range', `${formattedDate(stats.first_match_date)} – ${formattedDate(stats.last_match_date)}`));
        card.appendChild(formPills(stats.form));
        card.appendChild(make('p', 'fa-form-caption', 'Latest results · oldest to newest'));
        if (stats.played < 5) card.appendChild(make('p', 'fa-coverage-warning', 'Small sample: fewer than five matches.'));
        else if (state.sample !== 'season' && stats.played < Number(state.sample)) card.appendChild(make('p', 'fa-coverage-warning', `Only ${stats.played} of ${state.sample} requested matches are available this season.`));
      }
      context.appendChild(card);
    }
    host.appendChild(context);

    const table = make('table', 'fa-comparison-table');
    const caption = make('caption', 'fa-visually-hidden', `${teamName(data.fixture, 'home')} and ${teamName(data.fixture, 'away')} historical comparison`);
    const thead = make('thead'), header = make('tr');
    for (const label of ['Metric', teamName(data.fixture, 'home'), teamName(data.fixture, 'away')]) {
      const th = make('th', '', label); th.scope = 'col'; header.appendChild(th);
    }
    thead.appendChild(header); table.append(caption, thead);
    const tbody = make('tbody');
    const counts = stats => stats?.played > 0 ? `${stats.wins} / ${stats.draws} / ${stats.losses}` : '—';
    const metricRows = [
      ['Wins / draws / losses', counts],
      ['Points per game', stats => decimal(stats?.ppg)],
      ['Goals scored per game', stats => decimal(stats?.avg_goals_for)],
      ['Goals conceded per game', stats => decimal(stats?.avg_goals_against)],
      ['Wins', stats => sampleRate(stats?.wins, stats?.played, stats?.win_pct)],
      ['Draws', stats => sampleRate(stats?.draws, stats?.played, stats?.draw_pct)],
      ['Losses', stats => sampleRate(stats?.losses, stats?.played, stats?.loss_pct)],
      ['Over 2.5 total goals', stats => sampleRate(stats?.over25_count, stats?.played, stats?.over25_pct)],
      ['Under 2.5 total goals', stats => sampleRate(stats?.under25_count, stats?.played, stats?.under25_pct)],
      ['Both teams scored', stats => sampleRate(stats?.btts_count, stats?.played, stats?.btts_pct)],
      ['Clean sheets', stats => sampleRate(stats?.clean_sheet_count, stats?.played, stats?.clean_sheet_pct)],
      ['Failed to score', stats => sampleRate(stats?.failed_to_score_count, stats?.played, stats?.failed_to_score_pct)],
    ];
    for (const [label, format] of metricRows) {
      const row = make('tr'), th = make('th', '', label); th.scope = 'row';
      row.append(th, make('td', '', format(homeStats)), make('td', '', format(awayStats))); tbody.appendChild(row);
    }
    table.appendChild(tbody);
    const tableHost = make('div', 'fa-table-frame'); tableHost.appendChild(table); host.appendChild(tableHost);
    return host;
  }

  function leagueContext(data) {
    const baseline = data.league;
    const count = numeric(baseline.played) ?? 0;
    const host = section('League context', `${seasonLabel(baseline.season || data.fixture.season)} · ${count} completed league matches through ${formattedDate(data.as_of_date)}. This full-season reference stays the same when team filters change.`);
    if (!count) {
      host.appendChild(make('p', 'fa-empty', 'No completed league matches are available for this season.')); return host;
    }
    const grid = make('dl', 'fa-league-grid');
    const values = [
      ['Home wins', sampleRate(baseline.home_wins, count, baseline.home_win_pct)],
      ['Draws', sampleRate(baseline.draws, count, baseline.draw_pct)],
      ['Away wins', sampleRate(baseline.away_wins, count, baseline.away_win_pct)],
      ['Over 2.5 goals', percent(baseline.over25_pct)],
      ['Under 2.5 goals', percent(baseline.under25_pct)],
      ['Both teams scored', percent(baseline.btts_pct)],
      ['Home goals / game', decimal(baseline.avg_home_goals)],
      ['Away goals / game', decimal(baseline.avg_away_goals)],
    ];
    for (const [label, value] of values) { const cell = make('div'); cell.append(make('dt', '', label), make('dd', '', value)); grid.appendChild(cell); }
    host.appendChild(grid);
    host.appendChild(make('p', 'fa-section-note', `Recorded dates: ${formattedDate(baseline.first_match_date)} – ${formattedDate(baseline.last_match_date)}.`));
    return host;
  }

  function fixtureResultRow(match, homeName, awayName) {
    const row = make('li', 'fa-meeting');
    const date = make('time', 'fa-result-date', formattedDate(match.date)); date.dateTime = match.date;
    const season = make('span', 'fa-result-season', seasonLabel(match.season));
    const matchLine = make('div', 'fa-meeting-score');
    matchLine.append(make('span', '', homeName), make('strong', '', `${numeric(match.home_goals) ?? '—'}–${numeric(match.away_goals) ?? '—'}`), make('span', '', awayName));
    row.append(date, season, matchLine);
    return row;
  }

  function headToHead(data) {
    const history = data.head_to_head;
    const host = section('Recorded meetings', 'Latest five completed meetings in this league, across stored seasons and using the matched team names. Older meetings can reflect different squads.');
    const matches = Array.isArray(history.matches) ? history.matches : [];
    if (!matches.length) {
      host.appendChild(make('p', 'fa-empty', 'No recorded meetings are available for these matched names in this league.')); return host;
    }
    const summary = make('p', 'fa-h2h-summary', `${matches.length} recorded ${matches.length === 1 ? 'meeting' : 'meetings'}: ${teamName(data.fixture, 'home')} ${history.home_team_wins} wins · ${history.draws} draws · ${teamName(data.fixture, 'away')} ${history.away_team_wins} wins.`);
    host.appendChild(summary);
    const list = make('ol', 'fa-meetings');
    for (const match of matches) list.appendChild(fixtureResultRow(match, match.home_team, match.away_team));
    host.appendChild(list);
    return host;
  }

  function recentMatches(data) {
    const limit = data.window;
    const host = section('Recent results', `Latest ${limit} available current-season matches for each team, at all venues, newest first. Scores show this team’s goals first. This list includes both home and away games even when the comparison above uses Home vs away.`);
    const grid = make('div', 'fa-results-grid');
    for (const side of ['home', 'away']) {
      const column = make('div', 'fa-results-team');
      column.appendChild(make('h4', '', teamName(data.fixture, side)));
      const matches = Array.isArray(data[side]?.matches) ? data[side].matches : [];
      if (!matches.length) column.appendChild(make('p', 'fa-empty', 'No completed current-season results are available.'));
      else {
        const list = make('ol', 'fa-recent-list');
        for (const match of matches) {
          const row = make('li', 'fa-recent-result');
          const date = make('time', 'fa-result-date', formattedDate(match.date)); date.dateTime = match.date;
          const opponent = make('span', 'fa-result-opponent', match.opponent || 'Opponent unavailable');
          const venue = make('span', 'fa-result-venue', match.venue === 'home' ? 'Home' : 'Away');
          const score = make('strong', 'fa-result-score', `${numeric(match.goals_for) ?? '—'}–${numeric(match.goals_against) ?? '—'}`);
          score.title = 'Team goals – opponent goals';
          const result = ['W', 'D', 'L'].includes(match.result) ? match.result : '—';
          const badge = make('span', `fa-result-badge fa-form-${result.toLowerCase()}`, result);
          badge.setAttribute('aria-label', ({ W: 'Won', D: 'Drew', L: 'Lost' })[result] || 'Result unavailable');
          row.append(date, venue, opponent, score, badge); list.appendChild(row);
        }
        column.appendChild(list);
      }
      grid.appendChild(column);
    }
    host.appendChild(grid); return host;
  }

  function render() {
    if (!ui || !state.data || !ui.dialog.open) return;
    const data = state.data;
    ui.refresh.disabled = false; ui.refresh.textContent = 'Refresh analysis'; ui.content.removeAttribute('aria-busy');
    ui.status.textContent = `Results through ${formattedDate(data.as_of_date)} · ${seasonLabel(data.fixture.season)} · UK calendar dates. Results on this fixture’s date are excluded.`;
    ui.content.replaceChildren(comparison(data), leagueContext(data), headToHead(data), recentMatches(data));
  }

  async function load(windowSize, force = false) {
    if (!ui || !state.fixture) return;
    cancelRequest();
    state.window = windowSize;
    const request = state.request, eventId = state.fixture.event_id;
    const key = `${state.endpoint}|${eventId}|${windowSize}`;
    const cached = cache.get(key);
    if (!force && cacheIsFresh(cached)) {
      state.data = cached.data; render(); return;
    }
    cache.delete(key);
    const controller = new AbortController(); state.controller = controller;
    const timeout = root.setTimeout(() => controller.abort(), 20000);
    ui.refresh.disabled = true; ui.refresh.textContent = 'Refreshing…';
    ui.status.textContent = 'Loading recorded match history…';
    ui.content.setAttribute('aria-busy', 'true');
    ui.content.replaceChildren(make('p', 'fa-loading', 'Preparing the historical comparison…'));
    try {
      const url = new URL(state.endpoint, root.location?.href);
      url.searchParams.set('event_id', eventId); url.searchParams.set('window', String(windowSize));
      const response = await root.fetch(url.href, { method: 'GET', signal: controller.signal, cache: force ? 'no-cache' : 'default' });
      if (response.status === 404) throw new Error('fixture_unavailable');
      if (!response.ok) throw new Error('analysis_unavailable');
      const payload = await response.json();
      if (!validPayload(payload, eventId, windowSize)) throw new Error('invalid_analysis');
      if (request !== state.request || !ui.dialog.open) return;
      state.data = payload;
      cache.set(key, { savedAt: Date.now(), data: payload });
      while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
      render();
    } catch (error) {
      if (request !== state.request || !ui.dialog.open) return;
      state.data = null;
      const unavailable = error.message === 'fixture_unavailable';
      ui.status.textContent = unavailable ? 'This fixture is no longer available in the upcoming collection.' : 'Match history could not be loaded.';
      const failure = make('div', 'fa-error');
      failure.appendChild(make('p', '', unavailable ? 'Close this panel and refresh the fixture list to see the latest upcoming matches.' : 'Please try again. Your fixture list is still available behind this panel.'));
      if (!unavailable) failure.appendChild(button('Try again', 'fa-retry', () => load(windowSize, true)));
      ui.content.replaceChildren(failure);
    } finally {
      root.clearTimeout(timeout);
      if (request === state.request) {
        state.controller = null; ui.refresh.disabled = false; ui.refresh.textContent = 'Refresh analysis'; ui.content.removeAttribute('aria-busy');
      }
    }
  }

  async function open(options) {
    if (!options?.fixture?.event_id || typeof options.endpoint !== 'string' || !options.endpoint) throw new Error('A fixture and analysis endpoint are required.');
    const dialogUI = ensureDialog();
    cancelRequest();
    state.fixture = options.fixture; state.endpoint = options.endpoint; state.data = null;
    state.sample = 'season'; state.venue = 'venue'; state.window = 10;
    state.returnFocus = options.returnFocus || root.document.activeElement;
    dialogUI.sample.value = state.sample; dialogUI.venue.value = state.venue;
    dialogUI.title.textContent = `${teamName(options.fixture, 'home')} v ${teamName(options.fixture, 'away')}`;
    const kickoff = new Date(options.fixture.kickoff_at);
    dialogUI.meta.textContent = `${options.fixture.league_name || options.fixture.league_code || 'League'}${Number.isFinite(kickoff.getTime()) ? ' · ' + kickoffDisplay.format(kickoff) + ' UK' : ''}`;
    if (!dialogUI.dialog.open) dialogUI.dialog.showModal();
    root.document.documentElement.classList.add('fixture-analysis-open');
    dialogUI.body.scrollTop = 0;
    dialogUI.closeButton.focus({ preventScroll: true });
    await load(10);
  }

  root.GerballFixtureAnalysis = Object.freeze({
    open, close,
    helpers: Object.freeze({ numeric, decimal, percent, sampleRate, formattedDate, londonDay, seasonLabel, selectedStats, validPayload, cacheIsFresh }),
  });
})(typeof window === 'undefined' ? globalThis : window);
