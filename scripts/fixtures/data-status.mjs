const CODES = ['E0', 'E1', 'E2', 'E3', 'SC0', 'SC1', 'SC2', 'SC3', 'D1', 'D2', 'I1', 'I2', 'SP1', 'SP2', 'F1', 'F2', 'N1', 'B1', 'P1', 'G1', 'T1'];
const JOBS = {
  collector: ['gerball-daily-odds', '0,5,10 11,12 * * *'],
  recorder: ['gerball-recorded-screens', '15,20,25 11,12 * * *'],
  reconciliation: ['gerball-recorded-screen-results', '12 * * * *'],
};

export function dataStatusFixture() {
  const generated = '2026-11-24T21:15:00+00:00';
  const stage = (key, records) => ({
    state: 'complete', reason_code: key === 'reconciliation' ? 'reconciliation_current' : key === 'collector' ? 'collection_complete' : 'recording_complete',
    today_scheduled_at: key === 'collector' ? '2026-11-24T12:00:00+00:00' : key === 'recorder' ? '2026-11-24T12:15:00+00:00' : '2026-11-24T20:12:00+00:00',
    deadline_at: key === 'collector' ? '2026-11-24T12:15:00+00:00' : key === 'recorder' ? '2026-11-24T12:30:00+00:00' : '2026-11-24T22:31:00+00:00',
    next_run_at: key === 'collector' ? '2026-11-25T12:00:00+00:00' : key === 'recorder' ? '2026-11-25T12:15:00+00:00' : '2026-11-24T22:12:00+00:00',
    last_activity_at: '2026-11-24T21:01:00+00:00', last_success_at: '2026-11-24T21:01:00+00:00', today_status: key === 'collector' ? 'completed' : 'complete',
    completed_leagues: key === 'reconciliation' ? null : 18, expected_leagues: key === 'reconciliation' ? null : 18,
    records, mode: key === 'collector' ? 'manual' : key === 'recorder' ? 'bootstrap' : null,
    ...(key === 'reconciliation' ? { stale_after_minutes: 90, checked: 0, appended: 0 } : {}),
  });
  const leagues = CODES.map(code => {
    const feed = !['SC1', 'SC2', 'SC3'].includes(code), inactive = code === 'F2', fixtures = feed && !inactive ? 2 : 0;
    return {
      code, name: code === 'E0' ? 'Premier League' : `League ${code}`, country: code.startsWith('SC') ? 'Scotland' : 'Test country', odds_feed: feed,
      archive: { matches: 100, scored_matches: 100, seasons: 10, current_season_matches: 10, current_season_last_match_date: '2026-11-22', first_match_date: '2016-08-01', last_match_date: '2026-11-22' },
      collection: { state: feed ? 'complete' : 'not_configured', status: !feed ? 'not_supported' : inactive ? 'inactive' : 'completed', collection_date: feed ? '2026-11-24' : null, checked_at: feed ? '2026-11-24T20:00:00+00:00' : null, fixtures, records: fixtures * 3, manual: feed ? true : null },
      recording: { state: feed ? 'complete' : 'not_configured', status: feed ? 'recorded' : 'not_supported', capture_date: feed ? '2026-11-24' : null, captured_at: feed ? '2026-11-24T21:00:00+00:00' : null, fixtures, mode: feed ? 'bootstrap' : null },
      results: { basis: 'recorded_observations', observations: fixtures, settled: 0, pending: fixtures, review: 0, last_result_at: null },
    };
  });
  const stages = { collector: stage('collector', 102), recorder: stage('recorder', 34), reconciliation: stage('reconciliation', 34) };
  return {
    status: 'ok', version: 'data_status_v1', generated_at: generated, timezone: 'Europe/London', uk_date: '2026-11-24', current_season: '2627',
    archive: { total_matches: 2100, scored_matches: 2100, current_season_matches: 210, current_season_leagues: 21, league_count: 21, first_match_date: '2016-08-01', last_match_date: '2026-11-22',
      import_schedule: { cron: '15 8 * * 1,5', timezone: 'UTC', next_run_at: '2026-11-27T08:15:00+00:00', source: 'repository_declared', run_audit_available: false, last_successful_run_at: null, target_season: '2627', matches_current_season: true } },
    stages,
    jobs: Object.entries(JOBS).map(([key, [name, schedule]]) => ({ key, name, present: true, active: true, schedule, expected_schedule: schedule, configuration_matches: true, next_run_at: stages[key].next_run_at, last_run: null })),
    leagues,
    recent_days: [{ date: '2026-11-24', collection: { status: 'completed', completed_leagues: 18, expected_leagues: 18, records: 102, manual: true, last_activity_at: '2026-11-24T20:00:00+00:00' }, recording: { completed_leagues: 18, fixtures: 34, mode: 'bootstrap', last_activity_at: '2026-11-24T21:00:00+00:00' } }],
    attention: [],
  };
}
