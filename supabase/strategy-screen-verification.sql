-- Read-only checks for the stored-history strategy screen.
-- Run after its migration in a project containing future collected fixtures.
-- The verification reconstructs prior match-date groups directly from scores;
-- it does not use the screen's own feature or archived-aggregation CTEs.
DO $verification$
DECLARE
  code text;
  doc jsonb;
  fixture jsonb;
  team jsonb;
  observed jsonb;
  expected jsonb;
  expected_dates jsonb;
  side text;
  canonical text;
  market text;
  status text;
  expected_status text;
  home_ppg numeric;
  away_ppg numeric;
  home_games integer;
  away_games integer;
  home_mapped boolean;
  away_mapped boolean;
  n integer;
  games integer;
  points integer;
  first_day date;
  last_day date;
  cutoff date;
  split_day date;
  r record;
  b record;
  sums record;
  invalid boolean;
  checked integer := 0;
BEGIN
  ASSERT NOT has_function_privilege('anon','public.gerball_strategy_screen(text,integer)','EXECUTE'), 'Anonymous screen RPC access';
  ASSERT NOT has_function_privilege('authenticated','public.gerball_strategy_screen(text,integer)','EXECUTE'), 'Authenticated screen RPC access';
  ASSERT has_function_privilege('service_role','public.gerball_strategy_screen(text,integer)','EXECUTE'), 'Service screen RPC access missing';
  ASSERT (SELECT NOT prosecdef AND provolatile='s' FROM pg_proc
    WHERE oid='public.gerball_strategy_screen(text,integer)'::regprocedure), 'Screen RPC must be stable/security invoker';

  FOREACH n IN ARRAY ARRAY[0,32] LOOP
    invalid := false;
    BEGIN PERFORM public.gerball_strategy_screen('E0',n);
    EXCEPTION WHEN invalid_parameter_value THEN invalid := true;
    END;
    ASSERT invalid, 'Invalid horizon accepted';
  END LOOP;
  invalid := false;
  BEGIN PERFORM public.gerball_strategy_screen('INVALID',14);
  EXCEPTION WHEN invalid_parameter_value THEN invalid := true;
  END;
  ASSERT invalid, 'Invalid league accepted';

  FOREACH code IN ARRAY ARRAY['E0','E1','D1'] LOOP
    doc := public.gerball_strategy_screen(code,31);
    ASSERT doc->>'status'='ok' AND doc->>'basis'='stored_match_history', 'Wrong screen basis';
    ASSERT doc->>'version'='ppg_last5_dates_050_v1', 'Wrong rule version';
    ASSERT doc->>'timezone'='Europe/London' AND doc->>'league_code'=code, 'Wrong league/timezone';
    ASSERT (doc->>'days')::integer=31, 'Wrong horizon';
    ASSERT doc->'rules' @> '{"prior_match_dates":5,"minimum_prior_games":5,"ppg_threshold":0.5,"ppg_decimal_places":3,"venue_scope":"all","season_scope":"same_league_across_seasons","markets":["H","D","A"],"qualification_uses_current_odds":false}'::jsonb, 'Qualification rule changed';
    ASSERT doc->'backtest' @> '{"from":"2023-08-01","to":"2026-06-30","odds_min":1.5,"odds_max":4,"commission_pct":2,"slippage_pct":1,"stake_units":1}'::jsonb, 'Archive benchmark assumptions changed';

    -- The date split must include every completed fixture date in the archive,
    -- including dates with no rule match or no usable bookmaker price.
    SELECT dates[1+floor(cardinality(dates)*0.7)::integer] INTO split_day
    FROM (SELECT array_agg(match_date ORDER BY match_date) AS dates FROM (
      SELECT DISTINCT m.match_date FROM public.matches AS m
      WHERE m.league=code AND m.match_date BETWEEN DATE '2023-08-01' AND DATE '2026-06-30'
        AND m.home_goals IS NOT NULL AND m.away_goals IS NOT NULL
    ) AS all_dates) AS ordered_dates;
    ASSERT (doc#>>'{backtest,split_date}')::date IS NOT DISTINCT FROM split_day,
      'Holdout split must use all archived fixture dates';

    -- All projected fixtures: future cutoff, valid state values and no current prices.
    FOR fixture IN SELECT value FROM jsonb_array_elements(doc->'fixtures') LOOP
      ASSERT (fixture->>'kickoff_at')::timestamptz>statement_timestamp(), 'Started fixture leaked into screen';
      cutoff := least((statement_timestamp() AT TIME ZONE 'Europe/London')::date,
        ((fixture->>'kickoff_at')::timestamptz AT TIME ZONE 'Europe/London')::date-1);
      ASSERT (fixture->>'cutoff_date')::date=cutoff, 'Screen historical cutoff mismatch';
      ASSERT NOT jsonb_path_exists(fixture,'$.**.price')
        AND NOT jsonb_path_exists(fixture,'$.**.bookmakers')
        AND NOT jsonb_path_exists(fixture,'$.**.observed_odds')
        AND NOT jsonb_path_exists(fixture,'$.**.probability'), 'Current prices or probabilities in screen';
      FOREACH market IN ARRAY ARRAY['H','D','A'] LOOP
        ASSERT fixture#>>ARRAY['markets',market,'status'] IN ('match','no_match','insufficient_history','unmatched_team'), 'Invalid qualification state';
      END LOOP;
    END LOOP;

    -- Reconstruct two different upcoming fixtures per league, preserving same-day
    -- grouping and carrying across seasons exactly as the archived rule does.
    FOR fixture IN SELECT value FROM jsonb_array_elements(doc->'fixtures') LIMIT 2 LOOP
      cutoff := (fixture->>'cutoff_date')::date;
      FOREACH side IN ARRAY ARRAY['home','away'] LOOP
        team := fixture->side;
        canonical := team->>'canonical_name';
        games := 0; points := 0; n := 0; first_day := NULL; last_day := NULL;
        expected_dates := '[]'::jsonb;
        FOR r IN
          SELECT m.match_date,
            count(*)::integer AS games,
            sum(CASE WHEN m.home_goals=m.away_goals THEN 1
              WHEN (m.home_team=canonical AND m.home_goals>m.away_goals)
                OR (m.away_team=canonical AND m.away_goals>m.home_goals) THEN 3
              ELSE 0 END)::integer AS points
          FROM public.matches AS m
          WHERE m.league=code AND (m.home_team=canonical OR m.away_team=canonical)
            AND m.match_date<=cutoff AND m.home_goals IS NOT NULL AND m.away_goals IS NOT NULL
          GROUP BY m.match_date ORDER BY m.match_date DESC LIMIT 5
        LOOP
          n := n+1; games := games+r.games; points := points+r.points;
          first_day := r.match_date;
          IF n=1 THEN last_day := r.match_date; END IF;
          expected_dates := expected_dates || jsonb_build_array(jsonb_build_object(
            'date',r.match_date,'games',r.games,'points',r.points));
        END LOOP;
        expected := jsonb_build_object('games',games,'date_count',n,'points',points,
          'ppg',round(points::numeric/nullif(games,0),3),'first_date',first_day,'last_date',last_day,'dates',expected_dates);
        ASSERT team->'history'=expected, format('Prior five-date feature mismatch: %s %s %s',code,fixture->>'event_id',side);
        IF side='home' THEN
          home_ppg := (expected->>'ppg')::numeric; home_games := games;
          home_mapped := canonical IS NOT NULL AND team->>'match_status' IN ('exact','alias');
        ELSE
          away_ppg := (expected->>'ppg')::numeric; away_games := games;
          away_mapped := canonical IS NOT NULL AND team->>'match_status' IN ('exact','alias');
        END IF;
      END LOOP;
      ASSERT (fixture->>'ppg_gap')::numeric IS NOT DISTINCT FROM round(home_ppg-away_ppg,3), 'PPG gap mismatch';
      FOREACH market IN ARRAY ARRAY['H','D','A'] LOOP
        expected_status := CASE WHEN NOT home_mapped OR NOT away_mapped THEN 'unmatched_team'
          WHEN home_games<5 OR away_games<5 OR home_ppg IS NULL OR away_ppg IS NULL THEN 'insufficient_history'
          WHEN (market='H' AND home_ppg-away_ppg>=0.5)
            OR (market='A' AND away_ppg-home_ppg>=0.5)
            OR (market='D' AND abs(home_ppg-away_ppg)<=0.5) THEN 'match' ELSE 'no_match' END;
        ASSERT fixture#>>ARRAY['markets',market,'status']=expected_status, format('Historical qualification mismatch: %s %s',fixture->>'event_id',market);
      END LOOP;
      checked := checked+1;
    END LOOP;

    FOR b IN SELECT * FROM (VALUES
      ('E0'::text,'H'::text,186,58,-28.65::numeric,-8.89::numeric),
      ('E0','A',290,89,-18.06,-11.23),
      ('E1','D',650,217,-57.91,3.67),
      ('D1','D',244,70,0.92,12.16)
    ) AS benchmarks(league,market,bets,hold_bets,profit,hold_roi) WHERE league=code LOOP
      observed := doc#>ARRAY['backtest','markets',b.market];
      ASSERT (observed#>>'{full,bets}')::integer=b.bets, format('Archived %s/%s bet count changed',code,b.market);
      ASSERT (observed#>>'{holdout,bets}')::integer=b.hold_bets, format('Archived %s/%s holdout count changed',code,b.market);
      ASSERT abs((observed#>>'{full,profit_units}')::numeric-b.profit)<0.02, format('Archived %s/%s profit changed',code,b.market);
      ASSERT abs((observed#>>'{holdout,roi_pct}')::numeric-b.hold_roi)<0.015, format('Archived %s/%s holdout ROI changed',code,b.market);
      SELECT sum((value->>'bets')::integer) AS bets,sum((value->>'profit_units')::numeric) AS profit
        INTO sums FROM jsonb_array_elements(observed->'seasons');
      ASSERT sums.bets=b.bets AND abs(sums.profit-(observed#>>'{full,profit_units}')::numeric)<0.0001, 'Season totals do not reconcile';
      ASSERT (observed->>'rule_matches')::integer = (observed->>'missing_prices')::integer
        +(observed->>'outside_price_range')::integer+(observed#>>'{full,bets}')::integer, 'Historical price coverage does not reconcile';
    END LOOP;
  END LOOP;
  ASSERT checked>0, 'This verification requires future collected fixtures';
END
$verification$;

SELECT 'Strategy screening: independent prior dates, qualifications, archived benchmarks, coverage, cutoffs and permissions passed' AS verification;
