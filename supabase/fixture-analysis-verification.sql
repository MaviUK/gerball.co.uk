-- Read-only integration verification for a project with future collected fixtures.
-- No test rows, schema changes, predictions or provider requests are created.
-- Independent calculations derive results from goals and iterate raw matches;
-- they do not reuse the RPC's aggregation CTEs.
DO $verification$
DECLARE
  event_id text;
  doc jsonb;
  stats jsonb;
  actual jsonb;
  expected jsonb;
  r record;
  side text;
  period text;
  scope text;
  team text;
  home_name text;
  away_name text;
  league_code text;
  season_code text;
  window_size integer;
  cutoff date;
  first_date date;
  last_date date;
  n integer;
  wins integer;
  draws integer;
  losses integer;
  gf integer;
  ga integer;
  row_gf integer;
  row_ga integer;
  over25 integer;
  btts integer;
  clean_sheets integer;
  no_goal integer;
  result text;
  form text;
  expected_matches jsonb;
  caught boolean;
BEGIN
  ASSERT NOT has_function_privilege('anon', 'public.gerball_fixture_analysis(text,integer)', 'EXECUTE'), 'Anonymous RPC access';
  ASSERT NOT has_function_privilege('authenticated', 'public.gerball_fixture_analysis(text,integer)', 'EXECUTE'), 'Authenticated RPC access';
  ASSERT has_function_privilege('service_role', 'public.gerball_fixture_analysis(text,integer)', 'EXECUTE'), 'Service RPC access missing';
  ASSERT (SELECT NOT p.prosecdef AND p.provolatile = 's' FROM pg_proc AS p
    WHERE p.oid = 'public.gerball_fixture_analysis(text,integer)'::regprocedure), 'RPC must be stable/security invoker';

  FOREACH window_size IN ARRAY ARRAY[0, 6, 21] LOOP
    caught := false;
    BEGIN
      PERFORM public.gerball_fixture_analysis('verification_event', window_size);
    EXCEPTION WHEN invalid_parameter_value THEN caught := true;
    END;
    ASSERT caught, 'Unsupported recent-match window accepted';
  END LOOP;
  caught := false;
  BEGIN
    PERFORM public.gerball_fixture_analysis('invalid/event', 10);
  EXCEPTION WHEN invalid_parameter_value THEN caught := true;
  END;
  ASSERT caught, 'Invalid event identifier accepted';
  ASSERT public.gerball_fixture_analysis('gerball_verification_unknown_event', 10)->>'status' = 'not_found', 'Unknown fixture did not return not_found';

  SELECT s.event_id INTO event_id
  FROM public.gerball_odds_snapshots AS s
  JOIN public.gerball_odds_runs AS collection USING (collection_date)
  WHERE collection.status IN ('completed', 'partial') AND s.kickoff_at > now() + interval '1 day'
  ORDER BY s.collection_date DESC, s.kickoff_at, s.event_id LIMIT 1;
  ASSERT event_id IS NOT NULL, 'This verification requires a collected fixture more than one day ahead';

  FOREACH window_size IN ARRAY ARRAY[5, 10, 20] LOOP
    doc := public.gerball_fixture_analysis(event_id, window_size);
    ASSERT doc->>'status' = 'ok' AND doc->>'basis' = 'stored_match_history', 'Wrong analysis basis';
    ASSERT (doc->>'window')::integer = window_size, 'Wrong window';
    ASSERT doc->>'timezone' = 'Europe/London', 'Wrong timezone';
    ASSERT NOT jsonb_path_exists(doc, '$.**.price') AND NOT jsonb_path_exists(doc, '$.**.markets')
      AND NOT jsonb_path_exists(doc, '$.**.probability'), 'Prices or probabilities entered historical analysis';

    cutoff := least((statement_timestamp() AT TIME ZONE 'Europe/London')::date,
      ((doc#>>'{fixture,kickoff_at}')::timestamptz AT TIME ZONE 'Europe/London')::date - 1);
    ASSERT (doc->>'as_of_date')::date = cutoff, 'Historical cutoff mismatch';
    league_code := doc#>>'{fixture,league_code}';
    season_code := doc#>>'{fixture,season}';
    ASSERT season_code = to_char(((doc#>>'{fixture,kickoff_at}')::timestamptz AT TIME ZONE 'Europe/London') - interval '6 months', 'YY')
      || to_char(((doc#>>'{fixture,kickoff_at}')::timestamptz AT TIME ZONE 'Europe/London') + interval '6 months', 'YY'), 'Season mismatch';
    home_name := doc#>>'{fixture,home,canonical_name}';
    away_name := doc#>>'{fixture,away,canonical_name}';

    FOREACH side IN ARRAY ARRAY['home', 'away'] LOOP
      team := doc#>>ARRAY['fixture',side,'canonical_name'];
      FOREACH period IN ARRAY ARRAY['season', 'recent'] LOOP
        FOREACH scope IN ARRAY ARRAY['overall', 'venue'] LOOP
          stats := doc#>ARRAY[side,period,scope];
          n := 0; wins := 0; draws := 0; losses := 0; gf := 0; ga := 0;
          over25 := 0; btts := 0; clean_sheets := 0; no_goal := 0;
          form := ''; first_date := NULL; last_date := NULL; expected_matches := '[]'::jsonb;
          FOR r IN
            SELECT m.* FROM public.matches AS m
            WHERE m.league = league_code AND m.season = season_code
              AND m.match_date <= cutoff AND m.full_time_result IN ('H', 'D', 'A')
              AND m.home_goals >= 0 AND m.away_goals >= 0
              AND (m.home_team = team OR m.away_team = team)
              AND (scope = 'overall' OR (side = 'home' AND m.home_team = team)
                OR (side = 'away' AND m.away_team = team))
            ORDER BY m.match_date DESC, m.id DESC
            LIMIT CASE WHEN period = 'recent' THEN window_size ELSE NULL END
          LOOP
            row_gf := CASE WHEN r.home_team = team THEN r.home_goals ELSE r.away_goals END;
            row_ga := CASE WHEN r.home_team = team THEN r.away_goals ELSE r.home_goals END;
            result := CASE WHEN row_gf > row_ga THEN 'W' WHEN row_gf < row_ga THEN 'L' ELSE 'D' END;
            n := n + 1; gf := gf + row_gf; ga := ga + row_ga;
            wins := wins + (result = 'W')::integer; draws := draws + (result = 'D')::integer;
            losses := losses + (result = 'L')::integer;
            over25 := over25 + (row_gf + row_ga >= 3)::integer;
            btts := btts + (row_gf >= 1 AND row_ga >= 1)::integer;
            clean_sheets := clean_sheets + (row_ga = 0)::integer;
            no_goal := no_goal + (row_gf = 0)::integer;
            first_date := r.match_date;
            IF n = 1 THEN last_date := r.match_date; END IF;
            IF n <= 5 THEN form := result || form; END IF;
            expected_matches := expected_matches || jsonb_build_array(jsonb_build_object(
              'date', r.match_date, 'season', r.season,
              'venue', CASE WHEN r.home_team = team THEN 'home' ELSE 'away' END,
              'opponent', CASE WHEN r.home_team = team THEN r.away_team ELSE r.home_team END,
              'goals_for', row_gf, 'goals_against', row_ga, 'result', result));
          END LOOP;
          expected := jsonb_build_object('played',n,'wins',wins,'draws',draws,'losses',losses,
            'points',wins*3+draws,'ppg',round((wins*3+draws)::numeric/nullif(n,0),2),
            'goals_for',gf,'goals_against',ga,'avg_goals_for',round(gf::numeric/nullif(n,0),2),
            'avg_goals_against',round(ga::numeric/nullif(n,0),2),
            'win_pct',round(100.0*wins/nullif(n,0),1),'draw_pct',round(100.0*draws/nullif(n,0),1),
            'loss_pct',round(100.0*losses/nullif(n,0),1),'over25_count',over25,
            'over25_pct',round(100.0*over25/nullif(n,0),1),'under25_count',n-over25,
            'under25_pct',round(100.0*(n-over25)/nullif(n,0),1),'btts_count',btts,
            'btts_pct',round(100.0*btts/nullif(n,0),1),'clean_sheet_count',clean_sheets,
            'clean_sheet_pct',round(100.0*clean_sheets/nullif(n,0),1),'failed_to_score_count',no_goal,
            'failed_to_score_pct',round(100.0*no_goal/nullif(n,0),1),'form',form,
            'first_match_date',first_date,'last_match_date',last_date);
          ASSERT stats = expected, format('Independent score-based summary mismatch: %s %s %s window %s',side,period,scope,window_size);
          IF period = 'recent' AND scope = 'overall' THEN
            ASSERT doc#>ARRAY[side,'matches'] = expected_matches, 'Recent result rows/order mismatch';
          END IF;
        END LOOP;
      END LOOP;
    END LOOP;

    n := 0; wins := 0; draws := 0; losses := 0; over25 := 0; btts := 0;
    expected_matches := '[]'::jsonb;
    FOR r IN
      SELECT m.* FROM public.matches AS m
      WHERE m.league = league_code AND m.match_date <= cutoff
        AND m.full_time_result IN ('H', 'D', 'A') AND m.home_goals >= 0 AND m.away_goals >= 0
        AND ((m.home_team = home_name AND m.away_team = away_name)
          OR (m.home_team = away_name AND m.away_team = home_name))
      ORDER BY m.match_date DESC, m.id DESC LIMIT 5
    LOOP
      row_gf := CASE WHEN r.home_team = home_name THEN r.home_goals ELSE r.away_goals END;
      row_ga := CASE WHEN r.home_team = home_name THEN r.away_goals ELSE r.home_goals END;
      n := n + 1; wins := wins + (row_gf > row_ga)::integer;
      draws := draws + (row_gf = row_ga)::integer; losses := losses + (row_gf < row_ga)::integer;
      over25 := over25 + (row_gf + row_ga >= 3)::integer;
      btts := btts + (row_gf >= 1 AND row_ga >= 1)::integer;
      expected_matches := expected_matches || jsonb_build_array(jsonb_build_object(
        'date',r.match_date,'season',r.season,'home_team',r.home_team,'away_team',r.away_team,
        'home_goals',r.home_goals,'away_goals',r.away_goals,
        'result',CASE WHEN r.home_goals>r.away_goals THEN 'H' WHEN r.home_goals<r.away_goals THEN 'A' ELSE 'D' END));
    END LOOP;
    ASSERT doc->'head_to_head' = jsonb_build_object('scope','same_league_last_five','played',n,
      'home_team_wins',wins,'draws',draws,'away_team_wins',losses,
      'over25_pct',round(100.0*over25/nullif(n,0),1),'btts_pct',round(100.0*btts/nullif(n,0),1),
      'matches',expected_matches), 'H2H orientation/latest-five mismatch';

    SELECT jsonb_build_object('season',season_code,'played',count(*),
      'home_wins',count(*) FILTER(WHERE home_goals>away_goals),
      'draws',count(*) FILTER(WHERE home_goals=away_goals),
      'away_wins',count(*) FILTER(WHERE home_goals<away_goals),
      'home_win_pct',round(100.0*count(*) FILTER(WHERE home_goals>away_goals)/nullif(count(*),0),1),
      'draw_pct',round(100.0*count(*) FILTER(WHERE home_goals=away_goals)/nullif(count(*),0),1),
      'away_win_pct',round(100.0*count(*) FILTER(WHERE home_goals<away_goals)/nullif(count(*),0),1),
      'avg_home_goals',round(avg(home_goals),2),'avg_away_goals',round(avg(away_goals),2),
      'over25_pct',round(100.0*count(*) FILTER(WHERE home_goals+away_goals>=3)/nullif(count(*),0),1),
      'under25_pct',round(100.0*count(*) FILTER(WHERE home_goals+away_goals<=2)/nullif(count(*),0),1),
      'btts_pct',round(100.0*count(*) FILTER(WHERE home_goals>=1 AND away_goals>=1)/nullif(count(*),0),1),
      'first_match_date',min(match_date),'last_match_date',max(match_date))
      INTO expected FROM public.matches AS m
      WHERE m.league=league_code AND m.season=season_code AND m.match_date<=cutoff
        AND m.home_goals>=0 AND m.away_goals>=0 AND m.full_time_result IN ('H','D','A');
    ASSERT doc->'league' = expected, 'League baseline mismatch';
  END LOOP;
END
$verification$;

SELECT 'Historical analysis: independent score-based summaries, windows, venues, H2H, dates, validation and role permissions passed' AS verification;
