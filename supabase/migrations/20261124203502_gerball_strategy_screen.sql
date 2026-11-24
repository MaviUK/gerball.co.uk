-- Read-only fixed-rule screen. Current bookmaker prices never qualify a fixture.
-- Prior form reproduces the existing walkforward definition: the previous five
-- distinct match dates in the same league, all venues, across season boundaries.
CREATE OR REPLACE FUNCTION public.gerball_strategy_screen(
  p_league text DEFAULT 'E0',
  p_days integer DEFAULT 14
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = ''
AS $function$
DECLARE
  v_now timestamptz := statement_timestamp();
  v_today date := (statement_timestamp() AT TIME ZONE 'Europe/London')::date;
  v_upcoming jsonb;
  v_output jsonb;
BEGIN
  IF p_league IS NULL OR p_league NOT IN (
      'E0','E1','E2','E3','SC0','D1','D2','I1','I2','SP1','SP2',
      'F1','F2','N1','B1','P1','G1','T1')
      OR p_days IS NULL OR p_days < 1 OR p_days > 31 THEN
    RAISE EXCEPTION 'invalid_strategy_screen_parameters' USING ERRCODE = '22023';
  END IF;

  v_upcoming := public.gerball_upcoming_data(p_league, p_days, NULL);

  WITH base AS MATERIALIZED (
    SELECT m.id, m.match_date, m.season, m.home_team, m.away_team,
      m.home_goals, m.away_goals,
      CASE WHEN m.match_date BETWEEN DATE '2023-08-01' AND DATE '2026-06-30'
        THEN m.source_data->>'B365H' END AS price_h,
      CASE WHEN m.match_date BETWEEN DATE '2023-08-01' AND DATE '2026-06-30'
        THEN m.source_data->>'B365D' END AS price_d,
      CASE WHEN m.match_date BETWEEN DATE '2023-08-01' AND DATE '2026-06-30'
        THEN m.source_data->>'B365A' END AS price_a
    FROM public.matches AS m
    WHERE m.league = p_league AND m.home_goals IS NOT NULL
      AND m.away_goals IS NOT NULL AND m.match_date <= v_today
  ), sides AS (
    SELECT match_date, home_team AS team,
      3 * (home_goals > away_goals)::integer + (home_goals = away_goals)::integer AS points
    FROM base
    UNION ALL
    SELECT match_date, away_team,
      3 * (away_goals > home_goals)::integer + (home_goals = away_goals)::integer
    FROM base
  ), daily AS MATERIALIZED (
    SELECT team, match_date, sum(points) AS points, count(*) AS games
    FROM sides GROUP BY team, match_date
  ), prior AS MATERIALIZED (
    SELECT team, match_date,
      COALESCE(sum(games) OVER form_window, 0)::bigint AS games,
      round(sum(points) OVER form_window / NULLIF(sum(games) OVER form_window, 0), 3) AS ppg
    FROM daily
    WINDOW form_window AS (PARTITION BY team ORDER BY match_date ROWS BETWEEN 5 PRECEDING AND 1 PRECEDING)
  ), historical_fixtures AS MATERIALIZED (
    SELECT b.*, h.games AS home_prior_games, h.ppg AS home_prior_ppg,
      a.games AS away_prior_games, a.ppg AS away_prior_ppg
    FROM base AS b
    JOIN prior AS h ON h.team = b.home_team AND h.match_date = b.match_date
    JOIN prior AS a ON a.team = b.away_team AND a.match_date = b.match_date
    WHERE b.match_date BETWEEN DATE '2023-08-01' AND DATE '2026-06-30'
  ), history_dates AS (
    SELECT match_date, row_number() OVER (ORDER BY match_date) AS position,
      count(*) OVER () AS date_count
    FROM (SELECT DISTINCT match_date FROM historical_fixtures) AS d
  ), split AS (
    -- JavaScript dates[floor(dates.length * .7)] translated to a one-based row.
    SELECT max(match_date) FILTER (WHERE position = floor(date_count * 0.7) + 1) AS split_date
    FROM history_dates
  ), markets AS (
    SELECT * FROM (VALUES ('H'::text), ('D'::text), ('A'::text)) AS m(market)
  ), rule_matches AS MATERIALIZED (
    SELECT h.*, m.market,
      CASE WHEN m.price ~ '^[0-9]+([.][0-9]+)?$' THEN m.price::numeric END AS odds,
      CASE m.market WHEN 'H' THEN home_goals > away_goals
        WHEN 'D' THEN home_goals = away_goals ELSE away_goals > home_goals END AS won
    FROM historical_fixtures AS h
    CROSS JOIN LATERAL (VALUES ('H'::text, h.price_h), ('D'::text, h.price_d), ('A'::text, h.price_a))
      AS m(market, price)
    WHERE h.home_prior_games >= 5 AND h.away_prior_games >= 5
      AND h.home_prior_ppg IS NOT NULL AND h.away_prior_ppg IS NOT NULL
      AND CASE m.market WHEN 'H' THEN h.home_prior_ppg - h.away_prior_ppg >= 0.50
        WHEN 'A' THEN h.away_prior_ppg - h.home_prior_ppg >= 0.50
        ELSE abs(h.home_prior_ppg - h.away_prior_ppg) <= 0.50 END
  ), settlements AS MATERIALIZED (
    SELECT r.*, CASE WHEN won THEN (greatest(1.01, odds * 0.99) - 1) * 0.98 ELSE -1 END AS net
    FROM rule_matches AS r WHERE odds BETWEEN 1.50 AND 4.00
  ), settlement_samples AS (
    SELECT s.*, 'full'::text AS sample FROM settlements AS s
    UNION ALL
    SELECT s.*, 'holdout' FROM settlements AS s CROSS JOIN split AS d
    WHERE s.match_date >= d.split_date
  ), equities AS (
    SELECT s.*, sum(net) OVER (PARTITION BY market, sample
      ORDER BY match_date, home_team, away_team, id ROWS UNBOUNDED PRECEDING) AS equity
    FROM settlement_samples AS s
  ), drawdowns AS (
    SELECT e.*, greatest(0, max(equity) OVER (PARTITION BY market, sample
      ORDER BY match_date, home_team, away_team, id ROWS UNBOUNDED PRECEDING)) - equity AS drawdown
    FROM equities AS e
  ), sample_groups AS (
    SELECT m.market, s.sample FROM markets AS m
    CROSS JOIN (VALUES ('full'::text), ('holdout'::text)) AS s(sample)
  ), sample_metrics AS (
    SELECT g.market, g.sample, jsonb_build_object(
      'bets', count(s.id), 'wins', count(s.id) FILTER (WHERE s.won),
      'profit_units', round(COALESCE(sum(s.net), 0), 6),
      'roi_pct', round(100 * sum(s.net) / NULLIF(count(s.id), 0), 4),
      'avg_odds', round(avg(s.odds), 3),
      'max_drawdown_units', round(COALESCE(max(s.drawdown), 0), 6),
      'first_date', min(s.match_date), 'last_date', max(s.match_date)
    ) AS metrics
    FROM sample_groups AS g LEFT JOIN drawdowns AS s ON s.market = g.market AND s.sample = g.sample
    GROUP BY g.market, g.sample
  ), combined_metrics AS (
    SELECT market, jsonb_object_agg(sample, metrics) AS metrics FROM sample_metrics GROUP BY market
  ), historical_seasons AS (
    SELECT DISTINCT COALESCE(season, 'Unknown') AS season FROM historical_fixtures
  ), season_metrics AS (
    SELECT m.market, h.season, jsonb_build_object(
      'season', h.season, 'bets', count(s.id), 'wins', count(s.id) FILTER (WHERE s.won),
      'profit_units', round(COALESCE(sum(s.net), 0), 6),
      'roi_pct', round(100 * sum(s.net) / NULLIF(count(s.id), 0), 4)
    ) AS metrics
    FROM markets AS m CROSS JOIN historical_seasons AS h
    LEFT JOIN settlements AS s ON s.market = m.market AND COALESCE(s.season, 'Unknown') = h.season
    GROUP BY m.market, h.season
  ), season_output AS (
    SELECT market, jsonb_agg(metrics ORDER BY season) AS seasons FROM season_metrics GROUP BY market
  ), coverage AS (
    SELECT m.market, count(r.id) AS rule_matches,
      count(r.id) FILTER (WHERE r.odds IS NULL) AS missing_prices,
      count(r.id) FILTER (WHERE r.odds IS NOT NULL AND (r.odds < 1.50 OR r.odds > 4.00)) AS outside_price_range
    FROM markets AS m LEFT JOIN rule_matches AS r USING (market) GROUP BY m.market
  ), backtest_markets AS (
    SELECT jsonb_object_agg(c.market, x.metrics || jsonb_build_object(
      'rule_matches', c.rule_matches, 'missing_prices', c.missing_prices,
      'outside_price_range', c.outside_price_range, 'seasons', COALESCE(s.seasons, '[]'::jsonb)
    )) AS markets
    FROM coverage AS c JOIN combined_metrics AS x USING (market) LEFT JOIN season_output AS s USING (market)
  ), future_fixtures AS MATERIALIZED (
    SELECT f->>'event_id' AS event_id, f->>'league_code' AS league_code,
      f->>'league_name' AS league_name, (f->>'kickoff_at')::timestamptz AS kickoff_at,
      least(v_today, ((f->>'kickoff_at')::timestamptz AT TIME ZONE 'Europe/London')::date - 1) AS cutoff_date,
      f->'home' AS home, f->'away' AS away
    FROM jsonb_array_elements(COALESCE(v_upcoming->'fixtures', '[]'::jsonb)) AS f
  ), future_teams AS MATERIALIZED (
    SELECT f.event_id, f.cutoff_date, t.side, t.team->>'provider_name' AS provider_name,
      t.team->>'canonical_name' AS canonical_name, t.team->>'match_status' AS match_status
    FROM future_fixtures AS f CROSS JOIN LATERAL (VALUES ('home'::text, f.home), ('away'::text, f.away)) AS t(side, team)
  ), future_keys AS (
    SELECT DISTINCT canonical_name, cutoff_date FROM future_teams
  ), future_histories AS MATERIALIZED (
    SELECT k.canonical_name, k.cutoff_date, jsonb_build_object(
      'games', COALESCE(sum(d.games), 0), 'date_count', count(d.match_date),
      'points', COALESCE(sum(d.points), 0),
      'ppg', round(sum(d.points) / NULLIF(sum(d.games), 0), 3),
      'first_date', min(d.match_date), 'last_date', max(d.match_date),
      'dates', COALESCE(jsonb_agg(jsonb_build_object('date', d.match_date,
        'games', d.games, 'points', d.points) ORDER BY d.match_date DESC)
        FILTER (WHERE d.match_date IS NOT NULL), '[]'::jsonb)
    ) AS history
    FROM future_keys AS k LEFT JOIN LATERAL (
      SELECT match_date, games, points FROM daily
      WHERE team = k.canonical_name AND match_date <= k.cutoff_date
      ORDER BY match_date DESC LIMIT 5
    ) AS d ON true
    GROUP BY k.canonical_name, k.cutoff_date
  ), future_team_output AS (
    SELECT t.event_id, jsonb_object_agg(t.side, jsonb_build_object(
      'provider_name', t.provider_name, 'canonical_name', t.canonical_name,
      'match_status', t.match_status, 'history', h.history
    )) AS teams
    FROM future_teams AS t JOIN future_histories AS h
      ON h.canonical_name IS NOT DISTINCT FROM t.canonical_name AND h.cutoff_date = t.cutoff_date
    GROUP BY t.event_id
  ), future_features AS (
    SELECT f.*, t.teams,
      (t.teams#>>'{home,history,ppg}')::numeric AS home_ppg,
      (t.teams#>>'{away,history,ppg}')::numeric AS away_ppg,
      (t.teams#>>'{home,history,games}')::bigint AS home_games,
      (t.teams#>>'{away,history,games}')::bigint AS away_games,
      t.teams#>>'{home,canonical_name}' IS NULL OR t.teams#>>'{away,canonical_name}' IS NULL AS unmatched
    FROM future_fixtures AS f JOIN future_team_output AS t USING (event_id)
  ), future_classifications AS (
    SELECT f.event_id, m.market,
      CASE WHEN f.unmatched THEN 'unmatched_team'
        WHEN f.home_games < 5 OR f.away_games < 5 OR f.home_ppg IS NULL OR f.away_ppg IS NULL THEN 'insufficient_history'
        WHEN CASE m.market WHEN 'H' THEN f.home_ppg - f.away_ppg >= 0.50
          WHEN 'A' THEN f.away_ppg - f.home_ppg >= 0.50
          ELSE abs(f.home_ppg - f.away_ppg) <= 0.50 END THEN 'match'
        ELSE 'no_match' END AS status
    FROM future_features AS f CROSS JOIN markets AS m
  ), future_market_output AS (
    SELECT event_id, jsonb_object_agg(market, jsonb_build_object('status', status,
      'reason', CASE status
        WHEN 'unmatched_team' THEN 'One or both teams are not linked to recorded history.'
        WHEN 'insufficient_history' THEN 'Both teams need at least five prior games within their last five recorded match dates.'
        WHEN 'match' THEN CASE market WHEN 'H' THEN 'Home prior PPG exceeds away prior PPG by at least 0.50.'
          WHEN 'A' THEN 'Away prior PPG exceeds home prior PPG by at least 0.50.'
          ELSE 'The absolute prior PPG difference is at most 0.50.' END
        ELSE CASE market WHEN 'H' THEN 'Home prior PPG advantage is below 0.50.'
          WHEN 'A' THEN 'Away prior PPG advantage is below 0.50.'
          ELSE 'The absolute prior PPG difference is above 0.50.' END END
    )) AS markets
    FROM future_classifications GROUP BY event_id
  ), future_output AS (
    SELECT f.kickoff_at, f.event_id, jsonb_build_object(
      'event_id', f.event_id, 'league_code', f.league_code, 'league_name', f.league_name,
      'kickoff_at', f.kickoff_at, 'cutoff_date', f.cutoff_date,
      'home', f.teams->'home', 'away', f.teams->'away',
      'ppg_gap', round(f.home_ppg - f.away_ppg, 3), 'markets', m.markets
    ) AS fixture
    FROM future_features AS f JOIN future_market_output AS m USING (event_id)
  )
  SELECT jsonb_build_object(
    'status', 'ok', 'version', 'ppg_last5_dates_050_v1', 'basis', 'stored_match_history',
    'generated_at', v_now, 'timezone', 'Europe/London', 'league_code', p_league, 'days', p_days,
    'collection', jsonb_build_object('status', v_upcoming->>'collection_status',
      'collection_date', v_upcoming->'collection_date', 'collected_at', v_upcoming->'collected_at'),
    'rules', jsonb_build_object('prior_match_dates', 5, 'minimum_prior_games', 5,
      'ppg_threshold', 0.50, 'ppg_decimal_places', 3, 'venue_scope', 'all',
      'season_scope', 'same_league_across_seasons', 'markets', jsonb_build_array('H','D','A'),
      'qualification_uses_current_odds', false),
    'backtest', jsonb_build_object('from', DATE '2023-08-01', 'to', DATE '2026-06-30',
      'odds_source', 'B365 archived prices', 'odds_min', 1.50, 'odds_max', 4.00,
      'commission_pct', 2, 'slippage_pct', 1, 'stake_units', 1,
      'split_date', (SELECT split_date FROM split), 'markets', (SELECT markets FROM backtest_markets)),
    'fixtures', (SELECT COALESCE(jsonb_agg(fixture ORDER BY kickoff_at, event_id), '[]'::jsonb) FROM future_output)
  ) INTO v_output;
  RETURN v_output;
END
$function$;

REVOKE ALL ON FUNCTION public.gerball_strategy_screen(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gerball_strategy_screen(text, integer) TO service_role;
NOTIFY pgrst, 'reload schema';
