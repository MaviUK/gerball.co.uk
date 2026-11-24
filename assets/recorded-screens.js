(function (root) {
  'use strict';

  const VERSION = 'recorded_screens_v1';
  const RULE_VERSION = 'ppg_last5_dates_050_v1';
  const EVALUATION_START = '2026-12-01';
  const MARKETS = Object.freeze({ H: 'Home win', D: 'Draw', A: 'Away win' });
  const QUALIFICATIONS = Object.freeze({ match: 'Rule matched', no_match: 'Does not match', insufficient_history: 'Insufficient history', unmatched_team: 'Team not linked' });
  const OUTCOMES = Object.freeze({ pending: 'Awaiting result', matched: 'Outcome matched', not_matched: 'Outcome not matched', review: 'Needs review', excluded: 'Excluded from this rule' });
  const COVERAGE = Object.freeze({ recorded: 'Recorded today', waiting_for_collection: 'Waiting for daily collection', pending_capture: 'Daily capture pending', error: 'Capture needs attention', implementation_changed: 'Rule version changed' });
  const RESULT_REASONS = Object.freeze({
    awaiting_result: 'Waiting for the fixture result to enter your match archive.',
    awaiting_import: 'No matching result has been imported yet.',
    unmatched_teams: 'The saved team names need to be linked before this result can be reconciled.',
    ambiguous_result: 'More than one imported match fits this fixture. The result needs review.',
    unexpected_source: 'The matching result uses an unexpected import source.',
    result_predates_capture: 'The imported result cannot be verified as arriving after this record was saved.',
    inconsistent_result: 'The imported score or full-time outcome needs review.',
    invalid_result_payload: 'The imported result could not be read reliably.',
    exact_imported_result: 'Matched to one imported full-time result.',
  });
  const MAX_AGE = 5 * 60 * 1000, PAGE_SIZE = 24;
  const instances = new WeakMap();
  const dayParts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' });
  const dayFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', year: 'numeric' });
  const stampFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

  function number(value) { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
  function count(value) { return Number.isInteger(value) && value >= 0 ? String(value) : '—'; }
  function decimal(value, digits = 3) { return number(value) === null ? '—' : value.toFixed(digits); }
  function timestamp(value) { const stamp = typeof value === 'string' ? Date.parse(value) : NaN; return Number.isFinite(stamp) ? stamp : null; }
  function dateValue(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && timestamp(value + 'T12:00:00Z') !== null && new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) === value; }
  function dateLabel(value) { return dateValue(value) ? dayFormat.format(new Date(value + 'T12:00:00Z')) : 'Unavailable'; }
  function stampLabel(value) { return timestamp(value) === null ? 'Unavailable' : `${stampFormat.format(new Date(value))} UK`; }
  function resultReason(value) { return RESULT_REASONS[value] || value || ''; }
  function londonDay(value) { const parts = Object.fromEntries(dayParts.formatToParts(new Date(value)).map(part => [part.type, part.value])); return `${parts.year}-${parts.month}-${parts.day}`; }
  function searchText(value) { return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('en-GB'); }
  function qualified(record, market) { return record?.markets?.[market]?.status === 'match'; }
  function outcome(record, market) {
    if (!qualified(record, market)) return 'excluded';
    if (record?.result?.status === 'review') return 'review';
    if (record?.result?.status !== 'settled' || !Object.hasOwn(MARKETS, record.result.full_time_result)) return 'pending';
    return record.result.full_time_result === market ? 'matched' : 'not_matched';
  }
  function firstQualification(record, market) {
    const first = record?.first_qualifying?.[market];
    if (!qualified(record, market) || !first) return null;
    return { first: String(first.record_id) === String(record.id), record_id: first.record_id, capture_date: first.capture_date };
  }
  function filterRecords(records, filters) {
    const words = searchText(filters.search).trim().split(/\s+/).filter(Boolean);
    return (Array.isArray(records) ? records : []).filter(record => {
      if (filters.scope !== 'all' && !qualified(record, filters.market)) return false;
      if (filters.outcome !== 'all' && outcome(record, filters.market) !== filters.outcome) return false;
      const text = searchText([record.home?.provider_name, record.home?.canonical_name, record.away?.provider_name, record.away?.canonical_name].join(' '));
      return words.every(word => text.includes(word));
    }).sort((a, b) => (timestamp(a.kickoff_at) || 0) - (timestamp(b.kickoff_at) || 0) || String(a.id).localeCompare(String(b.id)));
  }
  function validMetrics(value) { return value && ['fixtures', 'settled', 'matched', 'not_matched', 'pending', 'review'].every(key => Number.isInteger(value[key]) && value[key] >= 0) && (value.match_rate_pct === null || number(value.match_rate_pct) !== null); }
  function validPayload(value, league, requestedDate = '') {
    if (value?.status !== 'ok' || value.version !== VERSION || value.rule_version !== RULE_VERSION || value.timezone !== 'Europe/London' || value.league_code !== league || value.evaluation_start !== EVALUATION_START || timestamp(value.generated_at) === null) return false;
    if (value.method?.qualification_uses_current_odds !== false || value.method.summary_basis !== 'first_qualifying_capture_per_event_market_version' || value.method.identity_policy !== 'first_event_then_canonical_fixture' || !value.coverage?.today) return false;
    if (!Array.isArray(value.available_dates) || !value.available_dates.every(item => dateValue(item.capture_date)) || !Array.isArray(value.records)) return false;
    if (!Object.keys(MARKETS).every(market => validMetrics(value.summary?.[market]?.calibration) && validMetrics(value.summary?.[market]?.post_boundary))) return false;
    if (value.cohort !== null && (!value.cohort || !dateValue(value.cohort.capture_date) || timestamp(value.cohort.captured_at) === null || (requestedDate && value.cohort.capture_date !== requestedDate))) return false;
    if (!value.cohort && value.records.length) return false;
    return value.records.every(record => record && record.id !== undefined && record.league_code === league && record.rule_version === RULE_VERSION &&
      record.capture_date === value.cohort?.capture_date && timestamp(record.recorded_at) !== null && timestamp(record.kickoff_at) !== null &&
      ['calibration', 'post_boundary'].includes(record.phase) && record.home && record.away && Object.keys(MARKETS).every(market => Object.hasOwn(QUALIFICATIONS, record.markets?.[market]?.status)) &&
      ['pending', 'settled', 'review'].includes(record.result?.status) && Array.isArray(record.result.history) &&
      (record.result.status !== 'settled' || (Object.hasOwn(MARKETS, record.result.full_time_result) && Number.isInteger(record.result.home_goals) && Number.isInteger(record.result.away_goals))));
  }
  function freshPayload(value, now = Date.now()) { const generated = timestamp(value?.generated_at); return generated !== null && generated <= now + 60000 && now - generated < MAX_AGE && londonDay(generated) === londonDay(now); }
  function csvCell(value) { let text = value === null || value === undefined ? '' : String(value); if (typeof value !== 'number' && (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text))) text = "'" + text; return '"' + text.replace(/"/g, '""') + '"'; }
  function csvForRecords(payload, records, filters) {
    const headers = ['export_generated_at', 'rule_version', 'rule_frozen_at', 'implementation_sha256', 'source_commit', 'identity_policy', 'summary_basis', 'qualification_uses_current_odds', 'evaluation_start', 'market', 'record_scope', 'outcome_filter', 'cohort_id', 'cohort_mode', 'cohort_collection_date', 'cohort_collection_checked_at', 'cohort_input_sha256',
      'record_id', 'event_id', 'league', 'capture_date', 'recorded_at', 'captured_kickoff_at', 'fixture_date', 'season', 'phase', 'history_cutoff_date',
      'home_provider', 'home_canonical', 'home_match_status', 'home_ppg', 'home_games', 'home_date_count', 'home_points', 'home_first_date', 'home_last_date', 'home_date_inputs_json',
      'away_provider', 'away_canonical', 'away_match_status', 'away_ppg', 'away_games', 'away_date_count', 'away_points', 'away_first_date', 'away_last_date', 'away_date_inputs_json',
      'home_minus_away_ppg', 'qualification_status', 'qualification_reason', 'first_qualifying_record_id', 'first_qualifying_capture_date', 'is_first_qualifying_record', 'record_input_sha256',
      'outcome', 'result_status', 'result_revision', 'result_recorded_at', 'result_match_id', 'result_source', 'result_imported_at', 'home_goals', 'away_goals', 'full_time_result', 'result_reason', 'correction_reason', 'result_revision_history_json'];
    const rows = records.map(record => {
      const team = side => { const value = record[side] || {}, history = value.history || {}; return [value.provider_name, value.canonical_name, value.match_status, history.ppg, history.games, history.date_count, history.points, history.first_date, history.last_date, JSON.stringify(history.dates || [])]; };
      const first = firstQualification(record, filters.market), result = record.result || {};
      return [payload.generated_at, record.rule_version, payload.method.rule_frozen_at, payload.method.implementation_sha256, payload.method.source_commit, payload.method.identity_policy, payload.method.summary_basis, false, payload.evaluation_start, filters.market, filters.scope, filters.outcome, payload.cohort?.id, payload.cohort?.mode, payload.cohort?.collection_date, payload.cohort?.collection_checked_at, payload.cohort?.input_sha256,
        record.id, record.event_id, record.league_code, record.capture_date, record.recorded_at, record.kickoff_at, record.fixture_date, record.season, record.phase, record.cutoff_date,
        ...team('home'), ...team('away'), record.ppg_gap, record.markets?.[filters.market]?.status, record.markets?.[filters.market]?.reason, first?.record_id, first?.capture_date, first?.first ?? '', record.input_sha256,
        outcome(record, filters.market), result.status, result.revision, result.recorded_at, result.match_id, result.source, result.imported_at, result.home_goals, result.away_goals, result.full_time_result, result.reason, result.correction_reason, JSON.stringify(result.history || [])];
    });
    return '\uFEFF' + [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
  }

  function init(options) {
    const document = root.document, container = options?.container;
    if (!container || !options.endpoint || !Array.isArray(options.leagues) || !options.leagues.length) throw new Error('A records container, endpoint and leagues are required.');
    if (instances.has(container)) return instances.get(container);
    const leagues = new Map(options.leagues), initialLeague = leagues.has(options.initialLeague) ? options.initialLeague : options.leagues[0][0];
    const state = { data: null, loading: false, request: 0, controller: null, promise: null, destroyed: false, shown: PAGE_SIZE, requestedDate: '', openDetails: new Set() };
    const make = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = String(text); return node; };
    const button = (label, className, handler) => { const node = make('button', className, label); node.type = 'button'; node.addEventListener('click', handler); return node; };
    const addOption = (select, value, label) => { const node = make('option', '', label); node.value = value; select.appendChild(node); };
    const field = (id, label, choices, selected) => { const host = make('div', 'rs-field'), caption = make('label', '', label), input = make('select'); caption.htmlFor = id; input.id = id; choices.forEach(([value, title]) => addOption(input, value, title)); input.value = selected; host.append(caption, input); return { host, input }; };
    container.classList.add('recorded-screens'); container.replaceChildren();
    const intro = make('section', 'card rs-intro'), introHeader = make('div', 'rs-intro-header'), introText = make('div');
    introText.append(make('p', 'rs-eyebrow', 'RECORDED RESEARCH'), make('h2', '', 'Follow the screens saved before kickoff.'), make('p', 'rs-intro-copy', 'Inspect the original form inputs, see which fixtures qualified, and follow their results as they enter your match archive.'));
    const refresh = button('Refresh records', 'secondary rs-refresh', () => reload()); introHeader.append(introText, refresh); intro.appendChild(introHeader);
    const metadata = make('div', 'rs-metadata'), generated = make('p', '', 'Loading recorded screens…'), captured = make('p'), reconciled = make('p'); metadata.append(generated, captured, reconciled); intro.appendChild(metadata);
    const controls = make('section', 'card rs-controls'); controls.setAttribute('aria-label', 'Recorded screen controls');
    const leagueField = field('recordedLeague', 'League', options.leagues, initialLeague), marketField = field('recordedMarket', 'Market', Object.entries(MARKETS), 'H');
    const dateField = field('recordedDate', 'Recorded date', [['', 'Latest available']], '');
    const scopeField = field('recordedScope', 'Show records', [['qualifying', 'Qualifying records'], ['all', 'All records and exclusions']], 'qualifying');
    const outcomeField = field('recordedOutcome', 'Outcome', [['all', 'All outcomes'], ['pending', 'Awaiting result'], ['matched', 'Outcome matched'], ['not_matched', 'Outcome not matched'], ['review', 'Needs review']], 'all');
    const searchHost = make('div', 'rs-field'), searchCaption = make('label', '', 'Find a team'), search = make('input'); search.id = 'recordedSearch'; search.type = 'search'; search.placeholder = 'Either team or historical name'; search.autocomplete = 'off'; searchCaption.htmlFor = search.id; searchHost.append(searchCaption, search);
    controls.append(leagueField.host, marketField.host, dateField.host, scopeField.host, outcomeField.host, searchHost);
    const rule = make('section', 'rs-rule'); rule.setAttribute('aria-label', 'Recorded research method');
    rule.append(make('p', '', 'Qualification is saved from the existing five-date PPG rule, using stored match results. Each saved record keeps its original inputs and kickoff time.'),
      make('p', '', 'Fixtures with a captured kickoff before 1 December 2026 form the calibration group. Later kickoffs form recorded observations. Outcome rates measure this fixed condition; priced strategy approval remains a separate step.'),
      make('p', 'rs-rule-version', `Rule version ${RULE_VERSION} · Current odds do not affect qualification.`));
    const status = make('p', 'rs-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const notice = make('div', 'rs-notice'); notice.hidden = true;
    const coverage = make('section', 'card rs-coverage'); coverage.setAttribute('aria-label', 'Daily recording coverage'); coverage.hidden = true;
    const summary = make('section', 'rs-summary'); summary.setAttribute('aria-label', 'Unique recorded outcomes'); summary.hidden = true;
    const resultsSection = make('section', 'rs-results'), resultsHeader = make('div', 'rs-results-header'), resultsTitle = make('div'), resultsCount = make('p');
    resultsTitle.append(make('h2', '', 'Saved fixture records'), resultsCount);
    const actions = make('div', 'rs-result-actions'), clear = button('Clear team filter', 'rs-clear', () => { search.value = ''; state.shown = PAGE_SIZE; renderRecords(); search.focus(); }); clear.hidden = true;
    const exportButton = button('Export records CSV', 'secondary rs-export', exportRecords); exportButton.disabled = true; actions.append(clear, exportButton); resultsHeader.append(resultsTitle, actions);
    const list = make('div', 'rs-record-list'); list.setAttribute('aria-label', 'Saved fixture records');
    const more = button('Show more records', 'secondary rs-more', () => { state.shown += PAGE_SIZE; renderRecords(); }); more.hidden = true; resultsSection.append(resultsHeader, list, more);
    container.append(intro, controls, rule, status, notice, coverage, summary, resultsSection);

    function filters() { return { market: marketField.input.value, scope: scopeField.input.value, outcome: outcomeField.input.value, search: search.value }; }
    function renderDates(requestedDate) {
      dateField.input.replaceChildren(); const dates = state.data.available_dates;
      addOption(dateField.input, '', dates.length ? `Latest available · ${dateLabel(dates[0].capture_date)}` : 'Latest available');
      for (const entry of dates) addOption(dateField.input, entry.capture_date, `${dateLabel(entry.capture_date)} · ${count(entry.fixture_count)} fixtures`);
      if (requestedDate && !dates.some(entry => entry.capture_date === requestedDate)) addOption(dateField.input, requestedDate, `${dateLabel(requestedDate)} · no capture`);
      dateField.input.value = requestedDate; dateField.input.disabled = !dates.length && !requestedDate;
    }
    function renderMetadata() {
      const data = state.data, cohort = data.cohort;
      generated.textContent = `View refreshed ${stampLabel(data.generated_at)}`;
      captured.textContent = cohort ? `Selected capture ${stampLabel(cohort.captured_at)} · ${cohort.mode === 'bootstrap' ? 'Initial capture' : cohort.mode === 'scheduled' ? 'Scheduled capture' : 'Saved capture'}` : 'No capture for this selection';
      reconciled.textContent = data.coverage.latest_reconciliation_at ? `Archive reconciliation ${stampLabel(data.coverage.latest_reconciliation_at)}` : 'Archive reconciliation awaiting its first run';
    }
    function renderCoverage() {
      const data = state.data, today = data.coverage.today, cohort = data.cohort; coverage.replaceChildren(); coverage.hidden = false;
      coverage.appendChild(make('h2', '', 'Recording coverage'));
      const line = make('div', 'rs-coverage-line');
      line.append(make('span', `rs-badge${today.status === 'recorded' ? ' rs-badge-success' : ' rs-badge-warning'}`, COVERAGE[today.status] || 'Recording status unavailable'),
        make('p', '', `${count(data.coverage.captured_leagues_today)} of ${count(data.coverage.expected_leagues)} leagues captured on ${dateLabel(today.date)}`)); coverage.appendChild(line);
      if (today.reason) coverage.appendChild(make('p', 'rs-coverage-detail', today.reason));
      const times = Array.isArray(data.method.capture_retries_uk) ? data.method.capture_retries_uk.join(' and ') : '';
      coverage.appendChild(make('p', 'rs-coverage-detail', `Daily capture ${data.method.capture_time_uk || '12:15'} UK${times ? `, with retries at ${times}` : ''}. Result reconciliation ${data.method.settlement || 'hourly'}.`));
      if (cohort) coverage.appendChild(make('p', 'rs-coverage-detail', `This capture saved ${count(cohort.fixture_count)} fixtures; ${count(cohort.skipped_started)} fixtures crossed kickoff during capture and were skipped. Source collection: ${dateLabel(cohort.collection_date)} · ${cohort.collection_status || 'status unavailable'}.`));
    }
    function renderSummary() {
      summary.replaceChildren(); summary.hidden = false;
      const market = marketField.input.value, selected = state.data.summary[market];
      summary.append(make('h2', '', `${MARKETS[market]} · unique recorded outcomes`), make('p', 'rs-summary-note', 'These totals use each fixture’s first qualifying record for this market and rule version across all recorded dates. Repeated daily observations and duplicate provider identities for the same fixture are counted once. The date and team filters below affect the saved records only.'));
      const phases = make('div', 'rs-phase-grid');
      for (const [key, title, description] of [['calibration', 'Calibration', 'Captured kickoffs before 1 December 2026'], ['post_boundary', 'Recorded observations', 'Captured kickoffs from 1 December 2026']]) {
        const metrics = selected[key], panel = make('div', 'rs-phase'); panel.append(make('h3', '', title), make('p', '', description));
        const stats = make('div', 'rs-phase-stats');
        for (const [label, value] of [['Distinct fixtures', metrics.fixtures], ['Settled', metrics.settled], ['Outcome matched', metrics.matched], ['Outcome not matched', metrics.not_matched], ['Awaiting result', metrics.pending], ['Needs review', metrics.review]]) {
          const stat = make('div', 'rs-stat'); stat.append(make('strong', '', count(value)), make('span', '', label)); stats.appendChild(stat);
        }
        panel.append(stats, make('p', 'rs-rate', metrics.settled > 0 && number(metrics.match_rate_pct) !== null ? `${decimal(metrics.match_rate_pct, 1)}% of settled fixtures matched the selected outcome.` : 'Outcome rate will appear after results are settled.')); phases.appendChild(panel);
      }
      summary.appendChild(phases);
    }
    function teamCard(team, side) {
      const host = make('div', `rs-team rs-team-${side}`), history = team.history || {};
      host.append(make('span', 'rs-team-side', side === 'home' ? 'HOME TEAM' : 'AWAY TEAM'), make('h3', '', team.provider_name || team.canonical_name || 'Team unavailable'));
      if (team.canonical_name && team.canonical_name !== team.provider_name) host.appendChild(make('p', 'rs-canonical', `History: ${team.canonical_name}`));
      const ppg = make('p', 'rs-ppg'); ppg.append(make('strong', '', decimal(history.ppg)), make('span', '', 'saved points / game')); host.appendChild(ppg);
      host.append(make('p', 'rs-history-counts', `${count(history.games)} games · ${count(history.date_count)} dates · ${count(history.points)} points`),
        make('p', 'rs-history-range', history.first_date && history.last_date ? `${dateLabel(history.first_date)} – ${dateLabel(history.last_date)}` : 'No linked historical dates')); return host;
    }
    function dateGroups(team, side) {
      const host = make('div', 'rs-date-team'); host.appendChild(make('h4', '', `${side === 'home' ? 'Home' : 'Away'} · ${team.canonical_name || team.provider_name || 'Team unavailable'}`));
      const dates = Array.isArray(team.history?.dates) ? [...team.history.dates].sort((a, b) => String(b.date).localeCompare(String(a.date))) : [];
      if (!dates.length) { host.appendChild(make('p', 'rs-detail-note', 'No historical dates were linked at capture.')); return host; }
      const rows = make('ol', 'rs-date-list'); for (const entry of dates) { const row = make('li'), time = make('time', '', dateLabel(entry.date)); time.dateTime = entry.date; row.append(time, make('span', '', `${count(entry.games)} ${entry.games === 1 ? 'game' : 'games'} · ${count(entry.points)} ${entry.points === 1 ? 'point' : 'points'}`)); rows.appendChild(row); } host.appendChild(rows); return host;
    }
    function detail(record, suffix, title) {
      const host = make('details', 'rs-detail'), caption = make('summary', '', title), key = `${record.id}:${suffix}`; caption.dataset.recordFocus = key; host.appendChild(caption); host.open = state.openDetails.has(key);
      host.addEventListener('toggle', () => { if (host.open) state.openDetails.add(key); else state.openDetails.delete(key); }); return host;
    }
    function resultPanel(record, market) {
      const result = record.result, panel = make('div', 'rs-result');
      panel.appendChild(make('h4', '', result.status === 'settled' ? (qualified(record, market) ? OUTCOMES[outcome(record, market)] : 'Imported result') : result.status === 'review' ? 'Result needs review' : 'Awaiting an imported result'));
      if (result.status === 'settled') panel.appendChild(make('p', 'rs-score', `Full-time score: ${count(result.home_goals)} – ${count(result.away_goals)}`));
      if (result.reason) panel.appendChild(make('p', '', resultReason(result.reason)));
      if (result.source) panel.appendChild(make('p', '', `Source: ${result.source}${result.imported_at ? ` · imported ${stampLabel(result.imported_at)}` : ''}`));
      if (result.recorded_at) panel.appendChild(make('p', '', `Reconciled ${stampLabel(result.recorded_at)} · revision ${count(result.revision)}`));
      if (result.correction_reason) panel.appendChild(make('p', '', `Correction: ${result.correction_reason}`));
      return panel;
    }
    function recordCard(record) {
      const market = marketField.input.value, verdict = record.markets[market], result = record.result, outcomeCode = outcome(record, market), first = firstQualification(record, market);
      const card = make('article', 'card rs-record'), header = make('div', 'rs-record-header'), kickoff = make('time', '', `Captured kickoff ${stampLabel(record.kickoff_at)}`); kickoff.dateTime = record.kickoff_at;
      header.append(make('span', '', record.league_name || leagues.get(record.league_code) || record.league_code), kickoff); card.appendChild(header);
      const badges = make('div', 'rs-record-badges'); badges.append(make('span', `rs-badge${qualified(record, market) ? ' rs-badge-success' : ''}`, QUALIFICATIONS[verdict.status]),
        make('span', `rs-badge${record.phase === 'calibration' ? ' rs-badge-calibration' : ''}`, record.phase === 'calibration' ? 'Calibration' : 'Recorded observation'));
      if (qualified(record, market)) badges.appendChild(make('span', `rs-badge${outcomeCode === 'matched' ? ' rs-badge-success' : outcomeCode === 'review' ? ' rs-badge-warning' : ''}`, OUTCOMES[outcomeCode]));
      card.append(badges, make('p', 'rs-capture-line', `Saved ${stampLabel(record.recorded_at)} · capture date ${dateLabel(record.capture_date)}`));
      if (first) card.appendChild(make('p', 'rs-first', first.first ? 'First qualifying record · counted once in the outcome totals.' : `Repeated qualifying observation · first qualified on ${dateLabel(first.capture_date)}. Counted once in the outcome totals.`));
      const teams = make('div', 'rs-teams'); teams.append(teamCard(record.home, 'home'), teamCard(record.away, 'away')); card.appendChild(teams);
      const gap = number(record.ppg_gap); card.append(make('p', 'rs-gap', `Saved home PPG − away PPG: ${gap === null ? '—' : (gap > 0 ? '+' : '') + gap.toFixed(3)}`), make('p', 'rs-reason', verdict.reason || QUALIFICATIONS[verdict.status]));
      card.appendChild(resultPanel(record, market));
      const inputs = detail(record, 'inputs', 'Inspect the saved five-date inputs'), dates = make('div', 'rs-date-grid');
      inputs.appendChild(make('p', 'rs-detail-note', `Historical cutoff ${dateLabel(record.cutoff_date)}. Same league, all venues, across seasons. Every game on each stored date contributes to the saved PPG.`)); dates.append(dateGroups(record.home, 'home'), dateGroups(record.away, 'away')); inputs.appendChild(dates); card.appendChild(inputs);
      const audit = detail(record, 'audit', 'Recording and result history'), revisions = make('ol', 'rs-revision-list');
      for (const revision of [...result.history].sort((a, b) => (b.revision || 0) - (a.revision || 0))) {
        const item = make('li'); item.append(make('strong', '', `Revision ${count(revision.revision)} · ${revision.status === 'settled' ? 'Settled' : revision.status === 'review' ? 'Needs review' : 'Awaiting result'}`), make('p', '', stampLabel(revision.recorded_at)));
        if (revision.status === 'settled') item.appendChild(make('p', '', `Full-time score: ${count(revision.home_goals)} – ${count(revision.away_goals)}`));
        if (revision.reason) item.appendChild(make('p', '', resultReason(revision.reason)));
        if (revision.correction_reason) item.appendChild(make('p', '', `Correction: ${revision.correction_reason}`));
        if (revision.source) item.appendChild(make('p', '', `${revision.source}${revision.imported_at ? ` · imported ${stampLabel(revision.imported_at)}` : ''}`)); revisions.appendChild(item);
      }
      if (!result.history.length) audit.appendChild(make('p', 'rs-detail-note', 'No result revision has been recorded yet.')); else audit.appendChild(revisions);
      const provenance = make('div', 'rs-provenance'); provenance.append(make('p', '', `Record ${record.id} · event ${record.event_id}`), make('p', '', `Rule version: ${record.rule_version}`), make('p', '', `Input SHA-256: ${record.input_sha256 || 'Unavailable'}`));
      if (state.data.method.rule_frozen_at) provenance.appendChild(make('p', '', `Rule frozen: ${stampLabel(state.data.method.rule_frozen_at)}`));
      if (state.data.method.implementation_sha256) provenance.appendChild(make('p', '', `Implementation SHA-256: ${state.data.method.implementation_sha256}`));
      if (state.data.method.source_commit) provenance.appendChild(make('p', '', `Source commit: ${state.data.method.source_commit}`));
      if (result.match_id !== null && result.match_id !== undefined) provenance.appendChild(make('p', '', `Imported match ID: ${result.match_id}`)); audit.appendChild(provenance); card.appendChild(audit); return card;
    }
    function renderRecords() {
      if (!state.data) return;
      const active = filters(), records = filterRecords(state.data.records, active); resultsCount.textContent = `${records.length} ${active.scope === 'all' ? 'saved' : 'qualifying'} ${records.length === 1 ? 'record' : 'records'} for ${MARKETS[active.market]}${state.data.cohort ? ` · ${dateLabel(state.data.cohort.capture_date)}` : ''}${records.length > state.shown ? ` · showing ${state.shown}` : ''}`;
      exportButton.disabled = !records.length; clear.hidden = !search.value; more.hidden = records.length <= state.shown; more.textContent = `Show ${Math.min(PAGE_SIZE, Math.max(0, records.length - state.shown))} more records`;
      const focused = document.activeElement?.dataset?.recordFocus; list.replaceChildren();
      if (!records.length) {
        const empty = make('div', 'card rs-empty'); empty.append(make('h3', '', !state.data.cohort ? 'No capture for this selection' : !state.data.records.length ? 'This capture contains no fixtures' : 'No records match these filters'),
          make('p', '', !state.data.cohort ? 'Choose another recorded date or check the recording coverage above.' : !state.data.records.length ? 'The daily capture is retained even when it contains no eligible future fixtures.' : 'Choose All records and exclusions, change the outcome filter, or clear the team search.')); list.appendChild(empty);
      } else for (const record of records.slice(0, state.shown)) list.appendChild(recordCard(record));
      if (focused) for (const node of list.querySelectorAll('[data-record-focus]')) if (node.dataset.recordFocus === focused) { node.focus({ preventScroll: true }); break; }
    }
    function clearForLoad() {
      state.data = null; state.shown = PAGE_SIZE; state.openDetails.clear(); coverage.replaceChildren(); summary.replaceChildren(); coverage.hidden = true; summary.hidden = true; list.replaceChildren(); more.hidden = true; exportButton.disabled = true;
      generated.textContent = 'Loading recorded screens…'; captured.textContent = ''; reconciled.textContent = ''; resultsCount.textContent = 'Loading saved records…';
    }
    function exportRecords() {
      if (!state.data) return; const active = filters(), records = filterRecords(state.data.records, active); if (!records.length) return;
      const blob = new Blob([csvForRecords(state.data, records, active)], { type: 'text/csv;charset=utf-8' }), url = root.URL.createObjectURL(blob), link = make('a'); link.href = url;
      link.download = `gerball-recorded-screens-${state.data.league_code}-${active.market}-${state.data.cohort?.capture_date || londonDay(Date.now())}.csv`; document.body.appendChild(link); link.click(); link.remove(); root.setTimeout(() => root.URL.revokeObjectURL(url), 1000);
    }
    function reload() {
      if (state.destroyed) return Promise.resolve();
      const request = ++state.request, league = leagueField.input.value, requestedDate = dateField.input.value; state.requestedDate = requestedDate;
      state.controller?.abort(); const controller = new AbortController(); state.controller = controller; state.loading = true;
      const timeout = root.setTimeout(() => controller.abort(), 30000); refresh.disabled = true; refresh.textContent = 'Refreshing…'; dateField.input.disabled = true; container.setAttribute('aria-busy', 'true'); notice.hidden = true; clearForLoad();
      status.textContent = `Loading recorded ${leagues.get(league) || league} fixtures${requestedDate ? ` from ${dateLabel(requestedDate)}` : ''}.`;
      state.promise = (async () => {
        try {
          const url = new URL(options.endpoint, root.location?.href); url.searchParams.set('league', league); if (requestedDate) url.searchParams.set('date', requestedDate);
          const response = await root.fetch(url.href, { method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store', headers: options.apiKey ? { apikey: options.apiKey } : {}, signal: controller.signal });
          if (!response.ok) throw new Error('records_unavailable'); const data = await response.json(); if (!validPayload(data, league, requestedDate)) throw new Error('invalid_records');
          if (request !== state.request || state.destroyed) return;
          state.data = data; renderDates(requestedDate); renderMetadata(); renderCoverage(); renderSummary(); renderRecords();
          status.textContent = `Loaded saved ${leagues.get(league) || league} records. Inputs remain as recorded; outcomes use your imported match results.`;
        } catch {
          if (request !== state.request || state.destroyed) return;
          state.data = null; generated.textContent = 'Recorded screens unavailable'; status.textContent = `Saved records for ${leagues.get(league) || league} could not be loaded.`; resultsCount.textContent = 'No records loaded for this selection.';
          notice.replaceChildren(make('p', '', 'Please try again. The previous selection has been cleared.'), button('Try again', 'secondary rs-retry', () => reload())); notice.hidden = false;
        } finally { root.clearTimeout(timeout); if (request === state.request) { state.loading = false; state.controller = null; refresh.disabled = false; refresh.textContent = 'Refresh records'; dateField.input.disabled = !state.data?.available_dates.length && !requestedDate; container.removeAttribute('aria-busy'); } }
      })(); return state.promise;
    }
    function activate() { if (state.destroyed) return Promise.resolve(); if (state.loading) return state.promise; if (!state.data || !freshPayload(state.data) || state.data.league_code !== leagueField.input.value || state.requestedDate !== dateField.input.value) return reload(); return Promise.resolve(); }
    leagueField.input.addEventListener('change', () => { dateField.input.replaceChildren(); addOption(dateField.input, '', 'Latest available'); dateField.input.value = ''; reload(); });
    dateField.input.addEventListener('change', reload);
    marketField.input.addEventListener('change', () => { state.shown = PAGE_SIZE; if (state.data) { renderSummary(); renderRecords(); } });
    for (const field of [scopeField, outcomeField]) field.input.addEventListener('change', () => { state.shown = PAGE_SIZE; renderRecords(); });
    search.addEventListener('input', () => { state.shown = PAGE_SIZE; renderRecords(); });
    const api = { reload, activate, destroy() { state.destroyed = true; state.request++; state.controller?.abort(); instances.delete(container); } }; instances.set(container, api); reload(); return api;
  }
  root.GerballRecordedScreens = Object.freeze({ init, helpers: Object.freeze({ number, count, decimal, timestamp, dateValue, dateLabel, stampLabel, resultReason, londonDay, qualified, outcome, firstQualification, filterRecords, validPayload, freshPayload, csvCell, csvForRecords }) });
})(typeof window === 'undefined' ? globalThis : window);
