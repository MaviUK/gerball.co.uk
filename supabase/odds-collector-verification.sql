-- Transactional integration checks: run before today's first genuine collection.
-- Only the new collector tables are used. All fixture data is rolled back.
BEGIN;
SET LOCAL ROLE service_role;

DO $tests$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_uk timestamp := v_now AT TIME ZONE 'Europe/London';
  v_date date := v_uk::date;
  v_slot text := (ARRAY['ODDS_API_KEY_MON', 'ODDS_API_KEY_TUE', 'ODDS_API_KEY_WED',
    'ODDS_API_KEY_THU', 'ODDS_API_KEY_FRI', 'ODDS_API_KEY_SAT', 'ODDS_API_KEY_SUN'])
    [extract(isodow FROM v_uk)::integer];
  v_first uuid := gen_random_uuid();
  v_second uuid := gen_random_uuid();
  v_third uuid := gen_random_uuid();
  v_leagues text[] := ARRAY['soccer_epl', 'soccer_efl_champ'];
  v_result jsonb;
  v_row jsonb;
  v_imminent jsonb;
  v_count integer;
  v_digest text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.gerball_odds_runs WHERE collection_date = v_date) THEN
    RAISE EXCEPTION 'Verification requires an unused current collection date';
  END IF;

  SELECT token_sha256 INTO v_digest FROM gerball_odds_private.settings WHERE name = 'cron_token';
  IF NOT public.gerball_odds_authorized(v_digest)
     OR public.gerball_odds_authorized('invalid') THEN
    RAISE EXCEPTION 'Scheduler digest verification failed';
  END IF;
  IF has_function_privilege('anon', 'public.gerball_odds_authorized(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.gerball_odds_claim_run(date,text,uuid,boolean,text[])', 'EXECUTE')
     OR has_table_privilege('anon', 'public.gerball_odds_snapshots', 'SELECT')
     OR has_table_privilege('authenticated', 'public.gerball_odds_snapshots', 'INSERT')
     OR has_table_privilege('service_role', 'public.gerball_odds_snapshots', 'UPDATE')
     OR has_table_privilege('service_role', 'public.gerball_odds_snapshots', 'DELETE') THEN
    RAISE EXCEPTION 'Collector access control check failed';
  END IF;

  BEGIN
    PERFORM public.gerball_odds_claim_run(v_date - 1, v_slot, v_first, true, v_leagues);
    RAISE EXCEPTION 'Old collection date was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'invalid_collection_identity' THEN RAISE; END IF;
  END;

  IF NOT (v_uk::time >= time '12:00' AND v_uk::time < time '12:15') THEN
    v_result := public.gerball_odds_claim_run(v_date, v_slot, v_first, false, v_leagues);
    IF (v_result->>'claimed')::boolean OR v_result->>'reason' <> 'outside_collection_window' THEN
      RAISE EXCEPTION 'Scheduled collection escaped the UK-noon window';
    END IF;
  END IF;

  v_result := public.gerball_odds_claim_run(v_date, v_slot, v_first, true, v_leagues);
  IF NOT (v_result->>'claimed')::boolean OR (v_result->>'attempt')::integer <> 1 THEN
    RAISE EXCEPTION 'Initial run claim failed';
  END IF;
  v_result := public.gerball_odds_claim_run(v_date, v_slot, v_second, true, v_leagues);
  IF (v_result->>'claimed')::boolean OR v_result->>'reason' <> 'daily_run_in_progress' THEN
    RAISE EXCEPTION 'A second owner acquired an active run';
  END IF;

  v_row := jsonb_build_object(
    'provider', 'the_odds_api', 'event_id', 'gerball-transaction-test',
    'sport_key', 'soccer_epl', 'football_data_league', 'E0', 'league', 'Test league',
    'home_team', 'Transaction Home', 'away_team', 'Transaction Away',
    'kickoff_at', v_now + interval '1 hour',
    'bookmaker_key', 'transaction_test', 'bookmaker_name', 'Transaction test',
    'market', 'h2h', 'selection', 'H', 'line', 0, 'decimal_odds', 2.25,
    'source_updated_at', v_now - interval '1 minute', 'collected_at', v_now,
    'collection_date', v_date, 'response_sha256', repeat('a', 64),
    'recorded_at', '1999-01-01T00:00:00Z'
  );

  BEGIN
    PERFORM public.gerball_odds_store_league(v_date, v_second, 'soccer_epl',
      'completed', jsonb_build_array(v_row), '{}'::jsonb);
    RAISE EXCEPTION 'Wrong owner stored a league';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'collection_lease_lost' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.gerball_odds_finish_run(v_date, v_second);
    RAISE EXCEPTION 'Wrong owner finalized a run';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'collection_lease_lost' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.gerball_odds_store_league(v_date, v_first, 'soccer_epl', 'completed',
      jsonb_build_array(v_row || jsonb_build_object('source_updated_at', v_now + interval '5 minutes')),
      '{}'::jsonb);
    RAISE EXCEPTION 'Future provider timestamp was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM public.gerball_odds_snapshots WHERE collection_date = v_date)
      OR EXISTS (SELECT 1 FROM public.gerball_odds_league_runs WHERE collection_date = v_date) THEN
    RAISE EXCEPTION 'Invalid batch left partial rows or a completed league';
  END IF;

  v_imminent := v_row || jsonb_build_object('event_id', 'gerball-imminent-test',
    'kickoff_at', clock_timestamp() + interval '5 seconds');
  v_result := public.gerball_odds_store_league(v_date, v_first, 'soccer_epl', 'completed',
    jsonb_build_array(v_row, v_row, v_imminent),
    '{"event_count":999,"bookmaker_count":999,"h2h_records":999,"totals_records":999,
      "requests_remaining":498,"requests_used":2,"requests_last":2}'::jsonb);
  IF (v_result->>'inserted')::integer <> 1 OR (v_result->>'total')::integer <> 1 THEN
    RAISE EXCEPTION 'Snapshot deduplication or imminent-kickoff filtering failed';
  END IF;
  SELECT count(*) INTO v_count FROM public.gerball_odds_snapshots
    WHERE collection_date = v_date AND recorded_at >= v_now AND decimal_odds = 2.25;
  IF v_count <> 1 THEN RAISE EXCEPTION 'Server timestamp or stored odds mismatch'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.gerball_odds_league_runs
    WHERE collection_date = v_date AND sport_key = 'soccer_epl'
      AND event_count = 1 AND bookmaker_count = 1 AND h2h_records = 1 AND totals_records = 0) THEN
    RAISE EXCEPTION 'Coverage trusted supplied counts instead of stored rows';
  END IF;

  v_result := public.gerball_odds_store_league(v_date, v_first, 'soccer_epl', 'completed',
    jsonb_build_array(v_row || '{"decimal_odds":9.99}'::jsonb), '{}'::jsonb);
  IF (v_result->>'inserted')::integer <> 0 OR (v_result->>'total')::integer <> 1 THEN
    RAISE EXCEPTION 'Repeated completed league was not a no-op';
  END IF;
  IF EXISTS (SELECT 1 FROM public.gerball_odds_snapshots WHERE collection_date = v_date
    AND decimal_odds <> 2.25) THEN RAISE EXCEPTION 'Repeat replaced stored odds'; END IF;

  UPDATE public.gerball_odds_runs SET lease_expires_at = clock_timestamp() - interval '1 second'
    WHERE collection_date = v_date;
  v_result := public.gerball_odds_claim_run(v_date, v_slot, v_second, true, v_leagues);
  IF NOT (v_result->>'claimed')::boolean OR v_result->>'reason' <> 'retry'
      OR (v_result->>'attempt')::integer <> 2
      OR NOT (v_result->'completed_leagues' @> '["soccer_epl"]'::jsonb) THEN
    RAISE EXCEPTION 'Expired-lease recovery lost completed work';
  END IF;
  BEGIN
    PERFORM public.gerball_odds_store_league(v_date, v_first, 'soccer_efl_champ',
      'inactive', '[]'::jsonb, '{}'::jsonb);
    RAISE EXCEPTION 'Expired worker stored rows after takeover';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'collection_lease_lost' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.gerball_odds_finish_run(v_date, v_first);
    RAISE EXCEPTION 'Expired worker finalized the replacement run';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'collection_lease_lost' THEN RAISE; END IF;
  END;

  PERFORM public.gerball_odds_store_league(v_date, v_second, 'soccer_efl_champ',
    'failed', '[]'::jsonb, '{"error_message":"test_http_502"}'::jsonb);
  v_result := public.gerball_odds_finish_run(v_date, v_second);
  IF v_result->>'status' <> 'partial' OR (v_result->>'records_collected')::integer <> 1 THEN
    RAISE EXCEPTION 'Partial collection did not retain successful league';
  END IF;
  v_result := public.gerball_odds_claim_run(v_date, v_slot, v_third, true, v_leagues);
  IF NOT (v_result->>'claimed')::boolean OR (v_result->>'attempt')::integer <> 3
      OR NOT (v_result->'completed_leagues' @> '["soccer_epl"]'::jsonb) THEN
    RAISE EXCEPTION 'Partial-run retry failed';
  END IF;
  PERFORM public.gerball_odds_store_league(v_date, v_third, 'soccer_efl_champ',
    'inactive', '[]'::jsonb, '{}'::jsonb);
  v_result := public.gerball_odds_finish_run(v_date, v_third);
  IF v_result->>'status' <> 'completed' OR (v_result->>'records_collected')::integer <> 1
      OR jsonb_array_length(v_result->'failures') <> 0 THEN
    RAISE EXCEPTION 'Recovered run did not finish successfully';
  END IF;
  v_result := public.gerball_odds_claim_run(v_date, v_slot, v_first, true, v_leagues);
  IF (v_result->>'claimed')::boolean OR v_result->>'reason' <> 'daily_run_completed' THEN
    RAISE EXCEPTION 'Completed collection was acquired again';
  END IF;

  IF (timestamptz '2026-03-28 12:00:00+00' AT TIME ZONE 'Europe/London')::time <> time '12:00'
     OR (timestamptz '2026-03-29 11:00:00+00' AT TIME ZONE 'Europe/London')::time <> time '12:00'
     OR (timestamptz '2026-10-24 11:00:00+00' AT TIME ZONE 'Europe/London')::time <> time '12:00'
     OR (timestamptz '2026-10-25 12:00:00+00' AT TIME ZONE 'Europe/London')::time <> time '12:00'
     OR extract(hour FROM timestamptz '2026-03-29 12:00:00+00' AT TIME ZONE 'Europe/London') = 12
     OR extract(hour FROM timestamptz '2026-10-25 11:00:00+00' AT TIME ZONE 'Europe/London') = 12 THEN
    RAISE EXCEPTION 'BST/GMT UK-noon schedule mapping failed';
  END IF;
END
$tests$;

ROLLBACK;
SELECT 'Collector transaction checks passed; test records rolled back' AS verification;
