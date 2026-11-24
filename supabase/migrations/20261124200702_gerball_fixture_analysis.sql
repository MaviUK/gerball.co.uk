-- Historical comparison for one upcoming fixture. All calculations use stored
-- completed results; collected prices are used only to locate the fixture.
CREATE OR REPLACE FUNCTION public.gerball_fixture_analysis(
  p_event_id text,
  p_window integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = ''
AS $function$
DECLARE
  v_now timestamptz := statement_timestamp();
  v_fixture jsonb;
  v_league text;
  v_season text;
  v_home text;
  v_away text;
  v_cutoff date;
  v_output jsonb;
BEGIN
  IF p_event_id IS NULL OR p_event_id !~ '^[A-Za-z0-9_-]{1,100}$'
      OR p_window IS NULL OR p_window NOT IN (5, 10, 20) THEN
    RAISE EXCEPTION 'invalid_fixture_analysis_parameters' USING ERRCODE = '22023';
  END IF;

  -- Keep club identity consistent with the Upcoming page. This existing RPC
  -- verifies exact/alias targets against same-league historical names.
  v_fixture := public.gerball_upcoming_data(NULL, 31, p_event_id)->'fixtures'->0;
  IF v_fixture IS NULL THEN
    RETURN jsonb_build_object('status', 'not_found',
      'version', 'historical_comparison_v1', 'basis', 'stored_match_history',
      'generated_at', v_now, 'timezone', 'Europe/London');
  END IF;

  v_league := v_fixture->>'league_code';
  v_home := v_fixture#>>'{home,canonical_name}';
  v_away := v_fixture#>>'{away,canonical_name}';
  v_cutoff := least((v_now AT TIME ZONE 'Europe/London')::date,
    ((v_fixture->>'kickoff_at')::timestamptz AT TIME ZONE 'Europe/London')::date - 1);
  v_season := to_char(((v_fixture->>'kickoff_at')::timestamptz AT TIME ZONE 'Europe/London')
      - interval '6 months', 'YY')
    || to_char(((v_fixture->>'kickoff_at')::timestamptz AT TIME ZONE 'Europe/London')
      + interval '6 months', 'YY');

  WITH season_matches AS MATERIALIZED (
    SELECT m.id, m.match_date, m.season, m.home_team, m.away_team,
      m.home_goals, m.away_goals, m.full_time_result
    FROM public.matches AS m
    WHERE m.league = v_league AND m.season = v_season
      AND m.match_date <= v_cutoff
      AND m.full_time_result IN ('H', 'D', 'A')
      AND m.home_goals >= 0 AND m.away_goals >= 0
  ), teams AS (
    SELECT * FROM (VALUES ('home'::text, v_home), ('away'::text, v_away))
      AS t(side, name)
  ), team_results AS MATERIALIZED (
    SELECT t.side, m.id, m.match_date, m.season,
      CASE WHEN m.home_team = t.name THEN 'home' ELSE 'away' END AS venue,
      CASE WHEN m.home_team = t.name THEN m.away_team ELSE m.home_team END AS opponent,
      CASE WHEN m.home_team = t.name THEN m.home_goals ELSE m.away_goals END AS goals_for,
      CASE WHEN m.home_team = t.name THEN m.away_goals ELSE m.home_goals END AS goals_against,
      CASE WHEN m.full_time_result = 'D' THEN 'D'
        WHEN (m.home_team = t.name AND m.full_time_result = 'H')
          OR (m.away_team = t.name AND m.full_time_result = 'A') THEN 'W'
        ELSE 'L' END AS result
    FROM teams AS t JOIN season_matches AS m
      ON m.home_team = t.name OR m.away_team = t.name
    WHERE t.name IS NOT NULL
  ), ranked_team_results AS MATERIALIZED (
    SELECT t.*,
      row_number() OVER (PARTITION BY side ORDER BY match_date DESC, id DESC) AS overall_rank,
      row_number() OVER (PARTITION BY side, venue ORDER BY match_date DESC, id DESC) AS venue_rank
    FROM team_results AS t
  ), samples AS MATERIALIZED (
    SELECT r.*, 'season'::text AS period, 'overall'::text AS scope, overall_rank AS sample_rank
    FROM ranked_team_results AS r
    UNION ALL
    SELECT r.*, 'season', 'venue', venue_rank FROM ranked_team_results AS r WHERE venue = side
    UNION ALL
    SELECT r.*, 'recent', 'overall', overall_rank FROM ranked_team_results AS r WHERE overall_rank <= p_window
    UNION ALL
    SELECT r.*, 'recent', 'venue', venue_rank FROM ranked_team_results AS r
    WHERE venue = side AND venue_rank <= p_window
  ), sample_groups AS (
    SELECT t.side, p.period, s.scope FROM teams AS t
    CROSS JOIN (VALUES ('season'::text), ('recent'::text)) AS p(period)
    CROSS JOIN (VALUES ('overall'::text), ('venue'::text)) AS s(scope)
  ), summaries AS MATERIALIZED (
    SELECT g.side, g.period, g.scope, jsonb_build_object(
      'played', count(r.id),
      'wins', count(r.id) FILTER (WHERE r.result = 'W'),
      'draws', count(r.id) FILTER (WHERE r.result = 'D'),
      'losses', count(r.id) FILTER (WHERE r.result = 'L'),
      'points', COALESCE(sum(CASE r.result WHEN 'W' THEN 3 WHEN 'D' THEN 1 ELSE 0 END), 0),
      'ppg', round(sum(CASE r.result WHEN 'W' THEN 3 WHEN 'D' THEN 1 ELSE 0 END)::numeric
        / NULLIF(count(r.id), 0), 2),
      'goals_for', COALESCE(sum(r.goals_for), 0),
      'goals_against', COALESCE(sum(r.goals_against), 0),
      'avg_goals_for', round(avg(r.goals_for), 2),
      'avg_goals_against', round(avg(r.goals_against), 2),
      'win_pct', round(100.0 * count(r.id) FILTER (WHERE r.result = 'W') / NULLIF(count(r.id), 0), 1),
      'draw_pct', round(100.0 * count(r.id) FILTER (WHERE r.result = 'D') / NULLIF(count(r.id), 0), 1),
      'loss_pct', round(100.0 * count(r.id) FILTER (WHERE r.result = 'L') / NULLIF(count(r.id), 0), 1),
      'over25_count', count(r.id) FILTER (WHERE r.goals_for + r.goals_against > 2),
      'over25_pct', round(100.0 * count(r.id) FILTER (WHERE r.goals_for + r.goals_against > 2)
        / NULLIF(count(r.id), 0), 1),
      'under25_count', count(r.id) FILTER (WHERE r.goals_for + r.goals_against < 3),
      'under25_pct', round(100.0 * count(r.id) FILTER (WHERE r.goals_for + r.goals_against < 3)
        / NULLIF(count(r.id), 0), 1),
      'btts_count', count(r.id) FILTER (WHERE r.goals_for > 0 AND r.goals_against > 0),
      'btts_pct', round(100.0 * count(r.id) FILTER (WHERE r.goals_for > 0 AND r.goals_against > 0)
        / NULLIF(count(r.id), 0), 1),
      'clean_sheet_count', count(r.id) FILTER (WHERE r.goals_against = 0),
      'clean_sheet_pct', round(100.0 * count(r.id) FILTER (WHERE r.goals_against = 0)
        / NULLIF(count(r.id), 0), 1),
      'failed_to_score_count', count(r.id) FILTER (WHERE r.goals_for = 0),
      'failed_to_score_pct', round(100.0 * count(r.id) FILTER (WHERE r.goals_for = 0)
        / NULLIF(count(r.id), 0), 1),
      'form', COALESCE(string_agg(r.result, '' ORDER BY r.match_date, r.id)
        FILTER (WHERE r.sample_rank <= 5), ''),
      'first_match_date', min(r.match_date), 'last_match_date', max(r.match_date)
    ) AS stats
    FROM sample_groups AS g LEFT JOIN samples AS r
      ON r.side = g.side AND r.period = g.period AND r.scope = g.scope
    GROUP BY g.side, g.period, g.scope
  ), team_periods AS (
    SELECT side, period, jsonb_object_agg(scope, stats) AS stats
    FROM summaries GROUP BY side, period
  ), team_summaries AS (
    SELECT side, jsonb_object_agg(period, stats) AS stats FROM team_periods GROUP BY side
  ), team_matches AS (
    SELECT side, jsonb_agg(jsonb_build_object(
      'date', match_date, 'season', season, 'venue', venue, 'opponent', opponent,
      'goals_for', goals_for, 'goals_against', goals_against, 'result', result
    ) ORDER BY match_date DESC, id DESC) AS matches
    FROM ranked_team_results WHERE overall_rank <= p_window GROUP BY side
  ), league_summary AS (
    SELECT jsonb_build_object(
      'season', v_season, 'played', count(*),
      'home_wins', count(*) FILTER (WHERE full_time_result = 'H'),
      'draws', count(*) FILTER (WHERE full_time_result = 'D'),
      'away_wins', count(*) FILTER (WHERE full_time_result = 'A'),
      'home_win_pct', round(100.0 * count(*) FILTER (WHERE full_time_result = 'H') / NULLIF(count(*), 0), 1),
      'draw_pct', round(100.0 * count(*) FILTER (WHERE full_time_result = 'D') / NULLIF(count(*), 0), 1),
      'away_win_pct', round(100.0 * count(*) FILTER (WHERE full_time_result = 'A') / NULLIF(count(*), 0), 1),
      'avg_home_goals', round(avg(home_goals), 2),
      'avg_away_goals', round(avg(away_goals), 2),
      'over25_pct', round(100.0 * count(*) FILTER (WHERE home_goals + away_goals > 2) / NULLIF(count(*), 0), 1),
      'under25_pct', round(100.0 * count(*) FILTER (WHERE home_goals + away_goals < 3) / NULLIF(count(*), 0), 1),
      'btts_pct', round(100.0 * count(*) FILTER (WHERE home_goals > 0 AND away_goals > 0) / NULLIF(count(*), 0), 1),
      'first_match_date', min(match_date), 'last_match_date', max(match_date)
    ) AS stats FROM season_matches
  ), h2h_matches AS MATERIALIZED (
    SELECT m.id, m.match_date, m.season, m.home_team, m.away_team,
      m.home_goals, m.away_goals, m.full_time_result
    FROM public.matches AS m
    WHERE v_home IS NOT NULL AND v_away IS NOT NULL AND m.league = v_league
      AND ((m.home_team = v_home AND m.away_team = v_away)
        OR (m.home_team = v_away AND m.away_team = v_home))
      AND m.match_date <= v_cutoff
      AND m.full_time_result IN ('H', 'D', 'A')
      AND m.home_goals >= 0 AND m.away_goals >= 0
    ORDER BY m.match_date DESC, m.id DESC LIMIT 5
  ), h2h_summary AS (
    SELECT jsonb_build_object(
      'scope', 'same_league_last_five', 'played', count(*),
      'home_team_wins', count(*) FILTER (WHERE
        (home_team = v_home AND full_time_result = 'H') OR (away_team = v_home AND full_time_result = 'A')),
      'draws', count(*) FILTER (WHERE full_time_result = 'D'),
      'away_team_wins', count(*) FILTER (WHERE
        (home_team = v_away AND full_time_result = 'H') OR (away_team = v_away AND full_time_result = 'A')),
      'over25_pct', round(100.0 * count(*) FILTER (WHERE home_goals + away_goals > 2) / NULLIF(count(*), 0), 1),
      'btts_pct', round(100.0 * count(*) FILTER (WHERE home_goals > 0 AND away_goals > 0) / NULLIF(count(*), 0), 1),
      'matches', COALESCE(jsonb_agg(jsonb_build_object(
        'date', match_date, 'season', season, 'home_team', home_team, 'away_team', away_team,
        'home_goals', home_goals, 'away_goals', away_goals, 'result', full_time_result
      ) ORDER BY match_date DESC, id DESC), '[]'::jsonb)
    ) AS stats FROM h2h_matches
  )
  SELECT jsonb_build_object(
    'status', 'ok', 'version', 'historical_comparison_v1', 'basis', 'stored_match_history',
    'generated_at', v_now, 'as_of_date', v_cutoff, 'timezone', 'Europe/London', 'window', p_window,
    'fixture', jsonb_build_object(
      'event_id', p_event_id, 'league_code', v_league, 'league_name', v_fixture->>'league_name',
      'kickoff_at', v_fixture->>'kickoff_at', 'season', v_season,
      'home', (v_fixture->'home') - 'stats', 'away', (v_fixture->'away') - 'stats'
    ),
    'home', (SELECT s.stats || jsonb_build_object('matches', COALESCE(m.matches, '[]'::jsonb))
      FROM team_summaries AS s LEFT JOIN team_matches AS m USING (side) WHERE s.side = 'home'),
    'away', (SELECT s.stats || jsonb_build_object('matches', COALESCE(m.matches, '[]'::jsonb))
      FROM team_summaries AS s LEFT JOIN team_matches AS m USING (side) WHERE s.side = 'away'),
    'league', (SELECT stats FROM league_summary),
    'head_to_head', (SELECT stats FROM h2h_summary),
    'scope', jsonb_build_object('team_history', 'current_season',
      'recent_overall', 'last_n_all_venues', 'recent_venue', 'last_n_home_or_away',
      'head_to_head', 'last_five_same_league')
  ) INTO v_output;
  RETURN v_output;
END
$function$;

REVOKE ALL ON FUNCTION public.gerball_fixture_analysis(text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gerball_fixture_analysis(text, integer) TO service_role;
NOTIFY pgrst, 'reload schema';
