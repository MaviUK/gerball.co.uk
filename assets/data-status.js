(function (root) {
  'use strict';

  const VERSION = 'data_status_v1', MAX_AGE = 5 * 60 * 1000;
  const STAGES = Object.freeze({ collector: 'Daily odds', recorder: 'Recorded screens', reconciliation: 'Result reconciliation' });
  const STATES = Object.freeze({ not_due: 'Not due yet', waiting: 'Waiting', complete: 'Complete', attention: 'Needs attention', not_configured: 'No configured feed' });
  const instances = new WeakMap();
  const dayParts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' });
  const dayFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', year: 'numeric' });
  const stampFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const REASONS = Object.freeze({
    job_missing: 'The scheduled job is not configured.',
    job_disabled: 'The scheduled job is inactive.',
    job_configuration_changed: 'The scheduled job configuration differs from the expected setup.',
    job_failed: 'The scheduled job’s latest recorded execution failed.',
    not_due: 'The scheduled check is not due yet.',
    collection_complete: 'Today’s daily odds collection covers the configured leagues.',
    collection_running: 'Today’s odds collection is awaiting completion within its scheduled window.',
    collection_failed: 'The latest daily odds collection reported a failure.',
    collection_incomplete: 'Today’s odds collection has not covered every configured league.',
    collection_overdue: 'Today’s odds collection is past its scheduled completion window.',
    recording_complete: 'Today’s configured leagues have saved screen captures.',
    waiting_for_collection: 'Screen capture is waiting for the daily odds collection.',
    recording_pending: 'Today’s screen capture is still pending.',
    recording_failed: 'The latest screen capture reported a failure.',
    recording_incomplete: 'Today’s screen capture has not covered every configured league.',
    recording_overdue: 'Today’s screen capture is past its scheduled completion window.',
    rule_implementation_changed: 'The deployed rule differs from the frozen recording version. Capture needs review.',
    reconciliation_current: 'A recent reconciliation checked saved observations against imported results.',
    reconciliation_pending: 'Result reconciliation is awaiting its next recorded check.',
    reconciliation_stale: 'A successful reconciliation is not recorded within the expected check interval.',
    reconciliation_failed: 'The latest result check failed.',
    archive_current_season_missing: 'No matches for the current season are stored for this league.',
    import_target_season_mismatch: 'The configured import target differs from the current season.',
    result_review_required: 'Recorded observations have results that need review.',
  });

  function nonnegative(value) { return Number.isInteger(value) && value >= 0; }
  function count(value) { return nonnegative(value) ? value.toLocaleString('en-GB') : '—'; }
  function timestamp(value) { const parsed = typeof value === 'string' ? Date.parse(value) : NaN; return Number.isFinite(parsed) ? parsed : null; }
  function dateValue(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && timestamp(value + 'T12:00:00Z') !== null && new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) === value; }
  function dateLabel(value) { return dateValue(value) ? dayFormat.format(new Date(value + 'T12:00:00Z')) : 'No stored date'; }
  function stampLabel(value) { return timestamp(value) === null ? 'No recorded time' : `${stampFormat.format(new Date(value))} UK`; }
  function londonDay(value) { const parts = Object.fromEntries(dayParts.formatToParts(new Date(value)).map(item => [item.type, item.value])); return `${parts.year}-${parts.month}-${parts.day}`; }
  function seasonLabel(value) { const text = String(value || ''); if (!/^\d{4}$/.test(text)) return text || 'Current season'; const year = Number(text.slice(0, 2)); return `${year >= 90 ? 1900 + year : 2000 + year}/${text.slice(2)}`; }
  function searchText(value) { return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('en-GB'); }
  function stateLabel(state, stage = '') { if (stage === 'reconciliation' && state === 'complete') return 'Recent check complete'; return Object.hasOwn(STATES, state) ? STATES[state] : 'Status unavailable'; }
  function stateStyle(state) { return state === 'complete' ? 'good' : state === 'attention' ? 'attention' : state === 'not_configured' ? 'neutral' : ''; }
  function modeLabel(mode) { return mode === 'bootstrap' ? 'Initial capture' : mode === 'manual' ? 'Manual run' : mode === 'mixed' ? 'Mixed run modes' : mode === 'scheduled' ? 'Scheduled run' : ''; }
  function reasonLabel(code, stage) {
    if (Object.hasOwn(REASONS, code)) return REASONS[code];
    return stage === 'collector' ? 'Review the daily collection coverage below.' : stage === 'recorder' ? 'Review the saved-screen coverage below.' : stage === 'reconciliation' ? 'Review the recorded reconciliation activity below.' : 'Review the data coverage below.';
  }
  function leagueNeedsAttention(league, issues = []) { return league.collection.state === 'attention' || league.recording.state === 'attention' || league.results.review > 0 || issues.some(issue => issue.league_code === league.code); }
  function filterLeagues(leagues, filter, search, issues = []) {
    const words = searchText(search).trim().split(/\s+/).filter(Boolean);
    return leagues.filter(league => (filter !== 'attention' || leagueNeedsAttention(league, issues)) && (filter !== 'feed' || league.odds_feed) && (filter !== 'no_feed' || !league.odds_feed) && words.every(word => searchText([league.code, league.name, league.country].join(' ')).includes(word)));
  }
  function validPayload(value) {
    if (value?.status !== 'ok' || value.version !== VERSION || value.timezone !== 'Europe/London' || timestamp(value.generated_at) === null || !dateValue(value.uk_date) || !/^\d{4}$/.test(value.current_season || '')) return false;
    const archive = value.archive, schedule = archive?.import_schedule;
    if (!archive || !['total_matches', 'scored_matches', 'current_season_matches', 'current_season_leagues', 'league_count'].every(key => nonnegative(archive[key])) || archive.league_count !== 21 || schedule?.cron !== '15 8 * * 1,5' || schedule.timezone !== 'UTC' || schedule.source !== 'repository_declared' || schedule.run_audit_available !== false || schedule.last_successful_run_at !== null || timestamp(schedule.next_run_at) === null || !/^\d{4}$/.test(schedule.target_season || '') || typeof schedule.matches_current_season !== 'boolean') return false;
    if (!Object.keys(STAGES).every(key => value.stages?.[key] && ['not_due', 'waiting', 'complete', 'attention'].includes(value.stages[key].state))) return false;
    if (!Array.isArray(value.jobs) || value.jobs.length !== 3 || new Set(value.jobs.map(job => job.key)).size !== 3 || !value.jobs.every(job => Object.hasOwn(STAGES, job.key) && ['present', 'configuration_matches'].every(key => typeof job[key] === 'boolean') && (job.present ? typeof job.active === 'boolean' : job.active === null))) return false;
    if (!Array.isArray(value.leagues) || value.leagues.length !== 21 || new Set(value.leagues.map(league => league.code)).size !== 21 || !value.leagues.every(league => typeof league.code === 'string' && typeof league.name === 'string' && typeof league.country === 'string' && typeof league.odds_feed === 'boolean' &&
      league.archive && ['matches', 'scored_matches', 'current_season_matches'].every(key => nonnegative(league.archive[key])) &&
      league.collection && league.recording && Object.hasOwn(STATES, league.collection.state) && Object.hasOwn(STATES, league.recording.state) &&
      league.results?.basis === 'recorded_observations' && ['observations', 'settled', 'pending', 'review'].every(key => nonnegative(league.results[key])))) return false;
    if (!Array.isArray(value.recent_days) || value.recent_days.length > 7 || !value.recent_days.every(day => dateValue(day.date) && day.collection && day.recording && nonnegative(day.collection.completed_leagues) && nonnegative(day.recording.completed_leagues))) return false;
    return Array.isArray(value.attention) && value.attention.every(issue => typeof issue.code === 'string' && ['warning', 'error'].includes(issue.severity) && (issue.league_code === null || value.leagues.some(league => league.code === issue.league_code)));
  }
  function freshPayload(value, now = Date.now()) { const generated = timestamp(value?.generated_at); return generated !== null && generated <= now + 60000 && now - generated < MAX_AGE && londonDay(generated) === londonDay(now); }
  function csvCell(value) { let text = value === null || value === undefined ? '' : String(value); if (typeof value !== 'number' && (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text))) text = "'" + text; return '"' + text.replace(/"/g, '""') + '"'; }
  function csvForCoverage(payload, leagues, filter) {
    const headers = ['view_generated_at', 'uk_date', 'current_season', 'coverage_filter', 'league', 'league_name', 'country', 'odds_feed_configured', 'needs_attention',
      'archive_matches', 'archive_scored_matches', 'archive_seasons', 'current_season_matches', 'current_season_last_stored_match_date', 'first_stored_match_date', 'last_stored_match_date',
      'import_schedule_cron', 'import_schedule_timezone', 'import_schedule_source', 'next_scheduled_import_at', 'import_target_season', 'import_target_matches_current_season', 'import_run_audit_available', 'collector_job_cron', 'recorder_job_cron', 'reconciliation_job_cron',
      'collection_state', 'collection_status', 'collection_date', 'collection_checked_at', 'collection_fixtures', 'collection_odds_records', 'collection_manual',
      'recording_state', 'recording_status', 'capture_date', 'captured_at', 'captured_fixtures', 'capture_mode',
      'result_count_basis', 'stored_observations', 'settled_observations', 'pending_observations', 'review_observations', 'last_result_revision_at', 'attention_codes_json'];
    const rows = leagues.map(league => [payload.generated_at, payload.uk_date, payload.current_season, filter, league.code, league.name, league.country, league.odds_feed, leagueNeedsAttention(league, payload.attention),
      league.archive.matches, league.archive.scored_matches, Array.isArray(league.archive.seasons) ? league.archive.seasons.join('|') : league.archive.seasons, league.archive.current_season_matches, league.archive.current_season_last_match_date, league.archive.first_match_date, league.archive.last_match_date,
      payload.archive.import_schedule.cron, payload.archive.import_schedule.timezone, payload.archive.import_schedule.source, payload.archive.import_schedule.next_run_at, payload.archive.import_schedule.target_season, payload.archive.import_schedule.matches_current_season, false,
      ...['collector', 'recorder', 'reconciliation'].map(key => payload.jobs.find(job => job.key === key)?.schedule),
      league.collection.state, league.collection.status, league.collection.collection_date, league.collection.checked_at, league.collection.fixtures, league.collection.records, league.collection.manual,
      league.recording.state, league.recording.status, league.recording.capture_date, league.recording.captured_at, league.recording.fixtures, league.recording.mode,
      league.results.basis, league.results.observations, league.results.settled, league.results.pending, league.results.review, league.results.last_result_at, JSON.stringify(payload.attention.filter(issue => issue.league_code === league.code).map(issue => issue.code))]);
    return '\uFEFF' + [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
  }

  function init(options) {
    const document = root.document, container = options?.container, overviewContainer = options?.overviewContainer;
    if (!container || !overviewContainer || !options.endpoint) throw new Error('Data status needs both containers and its endpoint.');
    if (instances.has(container)) return instances.get(container);
    const state = { data: null, request: 0, controller: null, loading: false, promise: null, destroyed: false };
    const make = (tag, className, text) => { const element = document.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = String(text); return element; };
    const button = (label, className, handler) => { const element = make('button', className, label); element.type = 'button'; element.addEventListener('click', handler); return element; };
    const badge = (label, stateValue) => make('span', `ds-badge${stateStyle(stateValue) ? ` ds-badge-${stateStyle(stateValue)}` : ''}`, label);
    container.classList.add('data-status'); overviewContainer.classList.add('overview-data-status'); container.replaceChildren(); overviewContainer.replaceChildren();
    const intro = make('section', 'card ds-intro'), header = make('div', 'ds-header'), introText = make('div');
    introText.append(make('p', 'ds-eyebrow', 'DATA STATUS'), make('h2', '', 'See what is stored and what ran.'), make('p', 'ds-intro-copy', 'Review historical coverage, daily odds, saved screens and result reconciliation in one place. Refresh reads the latest stored status.'));
    const refresh = button('Refresh status', 'secondary ds-refresh', reload), updated = make('p', 'ds-updated', 'Loading data status…');
    const jump = button('View league coverage', 'secondary ds-jump', () => {
      leagueSection.scrollIntoView({ behavior: root.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ? 'auto' : 'smooth', block: 'start' });
      filter.focus({ preventScroll: true });
    });
    jump.setAttribute('aria-controls', 'dataStatusCoverage'); const headerActions = make('div', 'ds-header-actions'); headerActions.append(refresh, jump); header.append(introText, headerActions); intro.append(header, updated);
    const status = make('p', 'ds-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const notice = make('div', 'ds-notice'); notice.hidden = true;
    const stages = make('section', 'ds-stages'); stages.setAttribute('aria-label', 'Data processing stages');
    const schedule = make('section', 'ds-schedule'); schedule.hidden = true; schedule.setAttribute('aria-label', 'Historical import schedule');
    const attention = make('section', 'ds-attention'); attention.hidden = true; attention.setAttribute('aria-label', 'Data requiring attention');
    const leagueSection = make('section', 'ds-league-section'), leagueHeading = make('div', 'ds-section-heading'), leagueTitle = make('div'); leagueSection.id = 'dataStatusCoverage'; leagueTitle.append(make('h2', '', 'League coverage'), make('p', '', 'Historical coverage and configured odds feeds are shown separately.'));
    const exportButton = button('Export coverage CSV', 'secondary ds-export', exportCoverage); exportButton.disabled = true; leagueHeading.append(leagueTitle, exportButton);
    const controls = make('div', 'ds-controls'), filterHost = make('div', 'ds-field'), filterLabel = make('label', '', 'Show leagues'), filter = make('select'); filter.id = 'dataStatusFilter'; filterLabel.htmlFor = filter.id;
    for (const [value, title] of [['all', 'All leagues'], ['attention', 'Needs attention'], ['feed', 'Configured odds feed'], ['no_feed', 'No configured odds feed']]) { const choice = make('option', '', title); choice.value = value; filter.appendChild(choice); } filter.value = 'all'; filterHost.append(filterLabel, filter);
    const searchHost = make('div', 'ds-field'), searchLabel = make('label', '', 'Find a league'), search = make('input'); search.id = 'dataStatusSearch'; search.type = 'search'; search.placeholder = 'League, country or code'; search.autocomplete = 'off'; searchLabel.htmlFor = search.id; searchHost.append(searchLabel, search); controls.append(filterHost, searchHost);
    const leagueCount = make('p', 'ds-league-count'), leagueList = make('div', 'ds-leagues'); leagueList.setAttribute('aria-label', 'League coverage records'); leagueSection.append(leagueHeading, controls, leagueCount, leagueList);
    const recent = make('section'); recent.hidden = true; recent.setAttribute('aria-label', 'Recent stored activity');
    const jobs = make('details', 'card ds-jobs'); jobs.hidden = true;
    container.append(intro, status, notice, stages, schedule, attention, leagueSection, recent, jobs);

    const overviewCard = make('section', 'card ds-overview-card'), overviewHeader = make('div', 'ds-overview-header'), overviewText = make('div'), overviewCopy = make('p', 'ds-overview-copy', 'Loading the latest stored status…');
    overviewText.append(make('h2', '', 'Data status'), overviewCopy);
    const open = button('Open data status', 'secondary ds-open', () => options.onOpenData?.()); overviewHeader.append(overviewText, open);
    const overviewStages = make('div', 'ds-overview-stages'), overviewUpdated = make('p', 'ds-updated'); overviewCard.append(overviewHeader, overviewStages, overviewUpdated); overviewContainer.appendChild(overviewCard);

    function paragraph(host, text, className = '') { if (text) host.appendChild(make('p', className, text)); }
    function renderOverview() {
      const data = state.data; overviewStages.replaceChildren(); overviewCopy.textContent = data.attention.length ? `${count(data.attention.length)} ${data.attention.length === 1 ? 'item needs' : 'items need'} attention. Open the full status view for details.` : 'No attention items are recorded in this status view.';
      const archive = make('div', 'ds-overview-stage'); archive.append(make('strong', '', 'Historical archive'), badge(`${count(data.archive.scored_matches)} results stored`, data.archive.scored_matches ? 'complete' : 'waiting')); overviewStages.appendChild(archive);
      for (const key of Object.keys(STAGES)) { const item = make('div', 'ds-overview-stage'); item.append(make('strong', '', STAGES[key]), badge(stateLabel(data.stages[key].state, key), data.stages[key].state)); overviewStages.appendChild(item); }
      overviewUpdated.textContent = `View refreshed ${stampLabel(data.generated_at)}`;
    }
    function renderStages() {
      const data = state.data; stages.replaceChildren();
      const archive = make('article', 'card ds-stage'), archiveHeading = make('div', 'ds-stage-heading'); archiveHeading.append(make('h3', '', 'Historical archive'), badge(data.archive.scored_matches ? 'Stored results available' : 'No scored results stored', data.archive.scored_matches ? 'complete' : 'waiting'));
      archive.append(archiveHeading, make('p', 'ds-stage-metric', `${count(data.archive.scored_matches)} stored results`));
      paragraph(archive, `${count(data.archive.total_matches)} match rows across ${count(data.archive.league_count)} historical leagues.`);
      paragraph(archive, `${seasonLabel(data.current_season)}: ${count(data.archive.current_season_matches)} stored matches in ${count(data.archive.current_season_leagues)} leagues.`);
      paragraph(archive, `Stored match dates: ${dateLabel(data.archive.first_match_date)} – ${dateLabel(data.archive.last_match_date)}.`, 'ds-stage-detail'); stages.appendChild(archive);
      for (const key of Object.keys(STAGES)) {
        const value = data.stages[key], card = make('article', 'card ds-stage'), heading = make('div', 'ds-stage-heading'); heading.append(make('h3', '', STAGES[key]), badge(stateLabel(value.state, key), value.state)); card.appendChild(heading);
        paragraph(card, key === 'collector' ? `${count(value.completed_leagues)} of ${count(value.expected_leagues)} leagues collected` : key === 'recorder' ? `${count(value.completed_leagues)} of ${count(value.expected_leagues)} leagues recorded` : nonnegative(value.checked) ? `${count(value.checked)} observations checked` : 'Awaiting a recorded check', 'ds-stage-metric');
        paragraph(card, key === 'collector' ? `${count(value.records)} odds records in the daily collection.` : key === 'recorder' ? `${count(value.records)} fixture observations saved.` : nonnegative(value.appended) ? `${count(value.appended)} result revisions added by the latest recorded check.` : 'No completed check count is available.');
        if (value.mode) paragraph(card, modeLabel(value.mode));
        if (value.last_activity_at) paragraph(card, `Latest activity ${stampLabel(value.last_activity_at)}.`);
        if (value.last_success_at) paragraph(card, `${key === 'collector' ? 'Last successful collection' : key === 'recorder' ? 'Last successful capture' : 'Last successful reconciliation'} ${stampLabel(value.last_success_at)}.`);
        paragraph(card, value.next_run_at ? `Next scheduled check ${stampLabel(value.next_run_at)}.` : 'Next scheduled check is unavailable.');
        if (value.state === 'not_due' && value.today_scheduled_at) paragraph(card, `Today's start: ${stampLabel(value.today_scheduled_at)}.`);
        if (value.reason_code) paragraph(card, reasonLabel(value.reason_code, key), 'ds-stage-detail');
        if (key === 'reconciliation') paragraph(card, 'A completed check can leave observations awaiting an imported result. Stored observations include daily repeats.'); stages.appendChild(card);
      }
    }
    function renderSchedule() {
      const value = state.data.archive.import_schedule; schedule.replaceChildren(); schedule.hidden = false;
      schedule.append(make('h3', '', 'Historical results import schedule'), make('p', '', 'Monday and Friday at 08:15 UTC.'), make('p', '', `Next scheduled import: ${stampLabel(value.next_run_at)}.`), make('p', '', `Configured season: ${seasonLabel(value.target_season)}${value.matches_current_season ? '.' : ' · this differs from the current season and needs review.'}`),
        make('p', '', 'The schedule comes from the repository configuration. Stored coverage dates show the archive contents; a successful import-run history is not recorded.'));
    }
    function renderAttention() {
      attention.replaceChildren(); attention.hidden = !state.data.attention.length; if (attention.hidden) return;
      attention.appendChild(make('h3', '', `${count(state.data.attention.length)} ${state.data.attention.length === 1 ? 'item needs' : 'items need'} attention`)); const list = make('ul');
      for (const issue of state.data.attention) { const league = state.data.leagues.find(value => value.code === issue.league_code); list.appendChild(make('li', '', `${league ? `${league.name}: ` : STAGES[issue.stage] ? `${STAGES[issue.stage]}: ` : ''}${reasonLabel(issue.code, issue.stage)}`)); } attention.appendChild(list);
    }
    function collectionLabel(value, feed) {
      if (!feed || value.state === 'not_configured') return 'No configured odds feed';
      if (value.status === 'inactive') return 'Inactive feed';
      if (value.status === 'failed') return 'Collection failed';
      if (value.state === 'complete' && value.fixtures === 0) return 'Complete · no fixtures';
      return stateLabel(value.state);
    }
    function recordingLabel(value, feed) {
      if (!feed || value.state === 'not_configured') return 'No scheduled capture';
      if (value.state === 'complete' && value.fixtures === 0) return 'Saved empty capture';
      if (value.status === 'implementation_changed') return 'Frozen rule changed';
      if (value.status === 'error') return 'Capture failed';
      if (value.status === 'waiting_for_collection' && value.state !== 'not_due') return 'Waiting for collection';
      return stateLabel(value.state);
    }
    function leagueCard(league) {
      const card = make('article', 'card ds-league'), heading = make('div', 'ds-league-header'), title = make('div'); title.append(make('h3', '', league.name), make('span', 'ds-league-code', `${league.country} · ${league.code}`)); heading.append(title);
      if (leagueNeedsAttention(league, state.data.attention)) heading.appendChild(badge('Needs attention', 'attention')); card.appendChild(heading);
      const archive = make('div', 'ds-league-block'); archive.appendChild(make('h4', '', 'Stored history'));
      paragraph(archive, `${count(league.archive.scored_matches)} results · ${count(Array.isArray(league.archive.seasons) ? league.archive.seasons.length : league.archive.seasons)} seasons.`);
      paragraph(archive, `${seasonLabel(state.data.current_season)}: ${count(league.archive.current_season_matches)} stored matches.`);
      paragraph(archive, `Latest stored current-season match date: ${dateLabel(league.archive.current_season_last_match_date)}.`); card.appendChild(archive);
      const collection = make('div', 'ds-league-block'); collection.append(make('h4', '', 'Daily odds'), badge(collectionLabel(league.collection, league.odds_feed), league.collection.status === 'inactive' ? 'not_configured' : league.collection.state));
      if (league.odds_feed) { paragraph(collection, `${count(league.collection.fixtures)} fixtures · ${count(league.collection.records)} odds records.`); if (league.collection.checked_at) paragraph(collection, `Checked ${stampLabel(league.collection.checked_at)}.`); if (league.collection.manual) paragraph(collection, 'Manual collection activity.'); } card.appendChild(collection);
      const recording = make('div', 'ds-league-block'); recording.append(make('h4', '', 'Recorded screens'), badge(recordingLabel(league.recording, league.odds_feed), league.recording.state));
      if (league.odds_feed) { paragraph(recording, `${count(league.recording.fixtures)} saved fixture observations.`); if (league.recording.captured_at) paragraph(recording, `${modeLabel(league.recording.mode) || 'Capture'} ${stampLabel(league.recording.captured_at)}.`); } card.appendChild(recording);
      const results = make('div', 'ds-league-block'); results.appendChild(make('h4', '', 'Recorded observation results'));
      paragraph(results, `${count(league.results.settled)} settled · ${count(league.results.pending)} awaiting results · ${count(league.results.review)} need review.`);
      paragraph(results, `${count(league.results.observations)} stored observations, including daily repeats.`); card.appendChild(results); return card;
    }
    function renderLeagues() {
      if (!state.data) return; const selected = filterLeagues(state.data.leagues, filter.value, search.value, state.data.attention); leagueList.replaceChildren();
      leagueCount.textContent = `${count(selected.length)} of ${count(state.data.leagues.length)} historical leagues shown · ${count(state.data.leagues.filter(league => league.odds_feed).length)} configured odds feeds`; exportButton.disabled = !selected.length;
      if (!selected.length) leagueList.appendChild(make('div', 'ds-empty', 'No leagues match these filters. Choose All leagues or change the search.')); else for (const league of selected) leagueList.appendChild(leagueCard(league));
    }
    function recentCollectionLabel(value) { if (value.status === 'completed' || value.status === 'complete') return 'Completed'; if (value.status === 'partial') return 'Partial collection'; if (value.status === 'failed' || value.status === 'error') return 'Collection failed'; if (value.status === 'running') return 'In progress'; if (value.status === 'not_due') return 'Not due yet'; return value.last_activity_at ? 'Recorded activity' : 'No collection recorded'; }
    function renderRecent() {
      recent.replaceChildren(); recent.hidden = false; recent.append(make('h2', '', 'Recent stored activity'), make('p', 'ds-recent-intro', 'Stored collection and capture activity from the last seven UK dates.'));
      if (!state.data.recent_days.length) { recent.appendChild(make('p', 'ds-empty', 'No recent collection or capture activity is recorded.')); return; }
      const scroller = make('div', 'ds-table-scroll'); scroller.tabIndex = 0; scroller.setAttribute('role', 'region'); scroller.setAttribute('aria-label', 'Seven-day activity table');
      const table = make('table', 'ds-recent-table'), head = make('thead'), header = make('tr'), body = make('tbody');
      for (const label of ['UK date', 'Daily odds', 'Recorded screens', 'Last stored activity']) { const cell = make('th', '', label); cell.scope = 'col'; header.appendChild(cell); } head.appendChild(header);
      for (const day of state.data.recent_days) {
        const row = make('tr'), date = make('th', '', dateLabel(day.date)); date.scope = 'row';
        const collection = make('td', '', recentCollectionLabel(day.collection)); collection.appendChild(make('span', 'ds-cell-note', `${count(day.collection.completed_leagues)} of ${count(day.collection.expected_leagues)} leagues · ${count(day.collection.records)} odds records`)); if (day.collection.manual) collection.appendChild(make('span', 'ds-cell-note', 'Includes manual activity'));
        const recording = make('td', '', day.recording.last_activity_at ? `${count(day.recording.completed_leagues)} leagues captured` : 'No capture recorded'); if (day.recording.last_activity_at) recording.appendChild(make('span', 'ds-cell-note', `${count(day.recording.fixtures)} observations · ${modeLabel(day.recording.mode) || 'Capture activity'}`));
        const activity = make('td'); if (day.collection.last_activity_at) activity.appendChild(make('span', 'ds-cell-note', `Odds: ${stampLabel(day.collection.last_activity_at)}`)); if (day.recording.last_activity_at) activity.appendChild(make('span', 'ds-cell-note', `Screens: ${stampLabel(day.recording.last_activity_at)}`)); if (!activity.children.length) activity.textContent = 'No activity recorded';
        row.append(date, collection, recording, activity); body.appendChild(row);
      }
      table.append(head, body); scroller.appendChild(table); recent.appendChild(scroller);
    }
    function renderJobs() {
      jobs.replaceChildren(); jobs.hidden = false; jobs.appendChild(make('summary', '', 'Scheduled job details'));
      for (const job of state.data.jobs) {
        const section = make('div', 'ds-league-block'); section.appendChild(make('h4', '', STAGES[job.key]));
        paragraph(section, !job.present ? 'Scheduled job is not configured.' : !job.active ? 'Scheduled job is inactive.' : job.configuration_matches ? 'Scheduled job is active and matches its expected schedule.' : 'Scheduled job is active; its schedule differs from the expected configuration.');
        paragraph(section, job.next_run_at ? `Next scheduled check: ${stampLabel(job.next_run_at)}.` : 'Next scheduled check is unavailable.');
        if (job.last_run) paragraph(section, `Last recorded execution: ${job.last_run.status === 'succeeded' ? 'Succeeded' : job.last_run.status === 'failed' ? 'Failed' : 'Execution recorded'} · ${stampLabel(job.last_run.finished_at || job.last_run.started_at)}.`); jobs.appendChild(section);
      }
    }
    function render() { updated.textContent = `View refreshed ${stampLabel(state.data.generated_at)}`; renderOverview(); renderStages(); renderSchedule(); renderAttention(); renderLeagues(); renderRecent(); renderJobs(); }
    function clearForLoad() {
      state.data = null; stages.replaceChildren(); leagueList.replaceChildren(); overviewStages.replaceChildren(); schedule.hidden = true; attention.hidden = true; recent.hidden = true; jobs.hidden = true; exportButton.disabled = true;
      updated.textContent = 'Loading data status…'; leagueCount.textContent = 'Loading league coverage…'; overviewCopy.textContent = 'Loading the latest stored status…'; overviewUpdated.textContent = '';
    }
    function exportCoverage() {
      if (!state.data) return; const selected = filterLeagues(state.data.leagues, filter.value, search.value, state.data.attention); if (!selected.length) return;
      const blob = new Blob([csvForCoverage(state.data, selected, filter.value)], { type: 'text/csv;charset=utf-8' }), url = root.URL.createObjectURL(blob), link = make('a'); link.href = url; link.download = `gerball-data-coverage-${state.data.uk_date}.csv`;
      document.body.appendChild(link); link.click(); link.remove(); root.setTimeout(() => root.URL.revokeObjectURL(url), 1000);
    }
    function reload() {
      if (state.destroyed) return Promise.resolve(); const request = ++state.request; state.controller?.abort(); const controller = new AbortController(); state.controller = controller; state.loading = true;
      const timeout = root.setTimeout(() => controller.abort(), 30000); refresh.disabled = true; refresh.textContent = 'Refreshing…'; container.setAttribute('aria-busy', 'true'); overviewContainer.setAttribute('aria-busy', 'true'); notice.hidden = true; clearForLoad(); status.textContent = 'Reading the current stored data status.';
      state.promise = (async () => {
        try {
          const response = await root.fetch(new URL(options.endpoint, root.location?.href).href, { method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store', headers: options.apiKey ? { apikey: options.apiKey } : {}, signal: controller.signal });
          if (!response.ok) throw new Error('status_unavailable'); const data = await response.json(); if (!validPayload(data)) throw new Error('invalid_status'); if (request !== state.request || state.destroyed) return;
          state.data = data; render(); status.textContent = 'Stored data status loaded. Refreshing this view does not run imports or change records.';
        } catch {
          if (request !== state.request || state.destroyed) return; state.data = null; updated.textContent = 'Data status unavailable'; status.textContent = 'The current data status could not be loaded.'; leagueCount.textContent = 'No coverage loaded.'; overviewCopy.textContent = 'Current status is unavailable. Open the data page to retry.';
          notice.replaceChildren(make('p', '', 'Please try refreshing the stored status again.'), button('Try again', 'secondary ds-retry', reload)); notice.hidden = false;
        } finally { root.clearTimeout(timeout); if (request === state.request) { state.loading = false; state.controller = null; refresh.disabled = false; refresh.textContent = 'Refresh status'; container.removeAttribute('aria-busy'); overviewContainer.removeAttribute('aria-busy'); } }
      })(); return state.promise;
    }
    function activate() { if (state.destroyed) return Promise.resolve(); if (state.loading) return state.promise; if (!state.data || !freshPayload(state.data)) return reload(); return Promise.resolve(); }
    filter.addEventListener('change', renderLeagues); search.addEventListener('input', renderLeagues);
    const api = { activate, reload, destroy() { state.destroyed = true; state.request++; state.controller?.abort(); instances.delete(container); } }; instances.set(container, api); reload(); return api;
  }
  root.GerballDataStatus = Object.freeze({ init, helpers: Object.freeze({ nonnegative, count, timestamp, dateValue, dateLabel, stampLabel, londonDay, seasonLabel, stateLabel, modeLabel, reasonLabel, leagueNeedsAttention, filterLeagues, validPayload, freshPayload, csvCell, csvForCoverage }) });
})(typeof window === 'undefined' ? globalThis : window);
