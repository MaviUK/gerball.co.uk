-- Independent verification of the frozen, unpriced research tracker.
-- Run against the staged migration before bootstrap, inside BEGIN/ROLLBACK.
-- Every synthetic-record block also rolls itself back. No test changes a match,
-- odds snapshot, old prediction or old settlement. Result matching tests use
-- the pure result helper rather than weakening the three-hour timing guard.

DO $ledger_verification$
DECLARE
  before_counts jsonb;
  after_counts jsonb;
  v_today date := (clock_timestamp() AT TIME ZONE 'Europe/London')::date;
  v_started timestamptz;
  v_kickoff timestamptz;
  v_early timestamptz;
  v_late timestamptz;
  v_cohort bigint;
  v_other_cohort bigint;
  v_id bigint;
  v_ids bigint[] := ARRAY[]::bigint[];
  v_base jsonb;
  v_fixture jsonb;
  v_cases jsonb;
  v_rows jsonb;
  v_saved jsonb;
  v_doc jsonb;
  v_reply jsonb;
  v_hash text;
  v_original_definition text;
  v_changed_definition text;
  v_original_hash text;
  v_actual_phase text;
  v_early_phase text;
  v_late_phase text;
  v_expected integer;
  rejected boolean;
  r record;
  phase_name text;
  i integer;
BEGIN
  SELECT jsonb_build_object(
    'matches',(SELECT count(*) FROM public.matches),
    'odds',(SELECT count(*) FROM public.gerball_odds_snapshots),
    'predictions',(SELECT count(*) FROM gerball_private.prospective_predictions),
    'settlements',(SELECT count(*) FROM gerball_private.prospective_settlements),
    'approvals',(SELECT count(*) FROM gerball_private.prospective_ingestion_approvals)
  ) INTO before_counts;

  ASSERT NOT EXISTS (SELECT 1 FROM gerball_tracking_private.cohorts WHERE league_code='E1'),
    'Run staged-schema verification before bootstrap';
  ASSERT NOT has_schema_privilege('anon','gerball_tracking_private','USAGE')
    AND NOT has_schema_privilege('authenticated','gerball_tracking_private','USAGE'),
    'Client role can access the private tracking schema';
  FOR r IN SELECT c.oid,c.relname,c.relrowsecurity FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid=c.relnamespace
    WHERE n.nspname='gerball_tracking_private' AND c.relkind='r'
  LOOP
    ASSERT r.relrowsecurity, format('RLS disabled for %s',r.relname);
    ASSERT has_table_privilege('service_role',r.oid,'SELECT'), format('Projection cannot read %s',r.relname);
    ASSERT NOT has_table_privilege('service_role',r.oid,'INSERT')
      AND NOT has_table_privilege('service_role',r.oid,'UPDATE')
      AND NOT has_table_privilege('service_role',r.oid,'DELETE')
      AND NOT has_table_privilege('service_role',r.oid,'TRUNCATE'),
      format('Public endpoint server role can mutate %s',r.relname);
    ASSERT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid=r.oid
      AND tgname='recorded_screen_immutable' AND NOT tgisinternal),
      format('Append-only trigger missing from %s',r.relname);
  END LOOP;
  FOR r IN SELECT p.oid,p.proname,p.prosecdef FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid=p.pronamespace WHERE n.nspname='gerball_tracking_private'
  LOOP
    ASSERT NOT r.prosecdef, format('Unexpected definer privileges in %s',r.proname);
    ASSERT NOT has_function_privilege('anon',r.oid,'EXECUTE')
      AND NOT has_function_privilege('authenticated',r.oid,'EXECUTE')
      AND NOT has_function_privilege('service_role',r.oid,'EXECUTE'),
      format('Tracking mutation/helper callable from client role: %s',r.proname);
  END LOOP;
  ASSERT has_function_privilege('service_role','public.gerball_recorded_screens(text,date)','EXECUTE')
    AND NOT has_function_privilege('anon','public.gerball_recorded_screens(text,date)','EXECUTE')
    AND NOT has_function_privilege('authenticated','public.gerball_recorded_screens(text,date)','EXECUTE'),
    'Read projection privileges differ from the intended contract';

  -- Exercise the actual roles, not merely catalogue declarations.
  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    v_doc := public.gerball_recorded_screens('E1',NULL);
    ASSERT v_doc->>'status'='ok' AND v_doc->'cohort'='null'::jsonb
      AND v_doc->'records'='[]'::jsonb, 'Service role cannot read an empty tracker';
    EXECUTE 'RESET ROLE';
  END;
  rejected := false;
  BEGIN
    EXECUTE 'SET LOCAL ROLE anon';
    PERFORM public.gerball_recorded_screens('E1',NULL);
  EXCEPTION WHEN insufficient_privilege THEN rejected := true;
  END;
  EXECUTE 'RESET ROLE';
  ASSERT rejected, 'Anonymous role executed the read RPC directly';

  v_base := jsonb_build_object(
    'event_id','verification-clock','league_code','E1','league_name','Verification league',
    'kickoff_at',clock_timestamp()+interval '1 day','cutoff_date',v_today,'ppg_gap',1.0,
    'home',jsonb_build_object('provider_name','Verification Home','canonical_name','Verification Home',
      'match_status','exact','history',jsonb_build_object('games',5,'date_count',5,'points',10,'ppg',2.0,
        'first_date',v_today-5,'last_date',v_today-1,'dates',jsonb_build_array(
          jsonb_build_object('date',v_today-1,'games',1,'points',3),
          jsonb_build_object('date',v_today-2,'games',1,'points',3),
          jsonb_build_object('date',v_today-3,'games',1,'points',1),
          jsonb_build_object('date',v_today-4,'games',1,'points',3),
          jsonb_build_object('date',v_today-5,'games',1,'points',0)))),
    'away',jsonb_build_object('provider_name','Verification Away','canonical_name','Verification Away',
      'match_status','exact','history',jsonb_build_object('games',5,'date_count',5,'points',5,'ppg',1.0,
        'first_date',v_today-5,'last_date',v_today-1,'dates',jsonb_build_array(
          jsonb_build_object('date',v_today-1,'games',1,'points',1),
          jsonb_build_object('date',v_today-2,'games',1,'points',1),
          jsonb_build_object('date',v_today-3,'games',1,'points',1),
          jsonb_build_object('date',v_today-4,'games',1,'points',1),
          jsonb_build_object('date',v_today-5,'games',1,'points',1)))),
    'markets','{"H":{"status":"match","reason":"Synthetic historical condition met"},"D":{"status":"no_match","reason":"Synthetic condition excluded"},"A":{"status":"no_match","reason":"Synthetic condition excluded"}}'::jsonb
  );

  -- Genuine server time crosses a near-future kickoff; no trigger is disabled,
  -- clock moved or recorded_at backdated to manufacture a settled prediction.
  BEGIN
    v_started := clock_timestamp();
    v_kickoff := v_started+interval '2 seconds';
    v_fixture := v_base || jsonb_build_object('kickoff_at',v_kickoff,'cutoff_date',v_today-1);
    v_cohort := nextval(pg_get_serial_sequence('gerball_tracking_private.cohorts','id'));
    INSERT INTO gerball_tracking_private.observations
      (cohort_id,rule_version,league_code,event_id,recorded_at,kickoff_at,fixture_date,season,phase,fixture,input_sha256)
    VALUES (v_cohort,'ppg_last5_dates_050_v1','E0','spoofed-event',TIMESTAMPTZ '2000-01-01T00:00:00Z',
      TIMESTAMPTZ '2000-01-01T00:00:00Z',DATE '2000-01-01','0000','post_boundary',v_fixture,repeat('0',64))
    RETURNING id,to_jsonb(observations),input_sha256 INTO v_id,v_saved,v_hash;
    ASSERT (v_saved->>'recorded_at')::timestamptz>=v_started
      AND (v_saved->>'recorded_at')::timestamptz<v_kickoff, 'Caller spoofed recording time';
    ASSERT v_saved->>'event_id'='verification-clock' AND v_saved->>'league_code'='E1'
      AND (v_saved->>'kickoff_at')::timestamptz=v_kickoff, 'Metadata diverged from the frozen fixture';
    ASSERT (v_saved->>'fixture_date')::date=(v_kickoff AT TIME ZONE 'Europe/London')::date,
      'Fixture day did not use London time';
    v_actual_phase := CASE WHEN (v_kickoff AT TIME ZONE 'Europe/London')::date<DATE '2026-12-01'
      THEN 'calibration' ELSE 'post_boundary' END;
    ASSERT v_saved->>'phase'=v_actual_phase, 'Caller changed the evaluation phase';
    ASSERT v_hash=encode(extensions.digest(jsonb_build_object(
      'rule_version','ppg_last5_dates_050_v1','fixture',v_fixture)::text,'sha256'),'hex'),
      'Input hash did not bind the saved fixture and rule';

    rejected := false;
    BEGIN
      INSERT INTO gerball_tracking_private.observations
        (cohort_id,rule_version,league_code,event_id,kickoff_at,fixture_date,season,phase,fixture,input_sha256)
      VALUES (v_cohort,'ppg_last5_dates_050_v1','E1','verification-clock',v_kickoff,v_today,'0000','calibration',v_fixture,repeat('0',64));
    EXCEPTION WHEN unique_violation THEN rejected := true;
    END;
    ASSERT rejected, 'Duplicate event inserted in the same cohort';

    INSERT INTO gerball_tracking_private.cohorts
      (id,rule_version,league_code,capture_date,captured_at,collection_date,collection_checked_at,
        collection_status,source_fixture_count,fixture_count,skipped_started,mode,input_sha256)
    VALUES (v_cohort,'ppg_last5_dates_050_v1','E1',DATE '2000-01-01',TIMESTAMPTZ '2000-01-01T00:00:00Z',
      v_today,clock_timestamp(),'completed',1,999,999,'bootstrap',repeat('0',64));
    ASSERT (SELECT capture_date=v_today AND captured_at>=v_started AND fixture_count=1 AND skipped_started=0
      AND input_sha256<>repeat('0',64) FROM gerball_tracking_private.cohorts WHERE id=v_cohort),
      'Sealed cohort accepted caller counts or timestamps';

    rejected := false;
    BEGIN
      UPDATE gerball_tracking_private.observations SET fixture='{}'::jsonb WHERE id=v_id;
    EXCEPTION WHEN object_not_in_prerequisite_state THEN rejected := true;
    END;
    ASSERT rejected, 'Saved inputs were mutable';
    rejected := false;
    BEGIN DELETE FROM gerball_tracking_private.observations WHERE id=v_id;
    EXCEPTION WHEN object_not_in_prerequisite_state THEN rejected := true;
    END;
    ASSERT rejected, 'Saved observation could be removed';
    rejected := false;
    BEGIN UPDATE gerball_tracking_private.cohorts SET fixture_count=0 WHERE id=v_cohort;
    EXCEPTION WHEN object_not_in_prerequisite_state THEN rejected := true;
    END;
    ASSERT rejected, 'A sealed cohort was mutable';
    rejected := false;
    BEGIN UPDATE gerball_tracking_private.rule_versions SET evaluation_start=DATE '2026-11-24'
      WHERE version='ppg_last5_dates_050_v1';
    EXCEPTION WHEN object_not_in_prerequisite_state THEN rejected := true;
    END;
    ASSERT rejected, 'Frozen evaluation boundary was mutable';

    rejected := false;
    BEGIN
      INSERT INTO gerball_tracking_private.observations
        (cohort_id,rule_version,league_code,event_id,kickoff_at,fixture_date,season,phase,fixture,input_sha256)
      VALUES (v_cohort,'ppg_last5_dates_050_v1','E1','verification-added',v_kickoff,v_today,'0000','calibration',
        v_base || '{"event_id":"verification-added"}'::jsonb,repeat('0',64));
    EXCEPTION WHEN object_not_in_prerequisite_state THEN rejected := true;
    END;
    ASSERT rejected, 'An observation was appended after the cohort was sealed';

    rejected := false;
    BEGIN
      INSERT INTO gerball_tracking_private.result_revisions
        (observation_id,revision,recorded_at,status,reason,result_sha256)
      VALUES (v_id,1,TIMESTAMPTZ '2000-01-01T00:00:00Z','pending','awaiting_import',repeat('0',64));
    EXCEPTION WHEN invalid_parameter_value THEN rejected := true;
    END;
    ASSERT rejected, 'A result revision bypassed the three-hour guard';

    PERFORM pg_sleep(greatest(0,extract(epoch FROM (v_kickoff-clock_timestamp())))+0.05);
    v_reply := gerball_tracking_private.capture_league('E1','bootstrap');
    ASSERT v_reply->>'status'='already_recorded' AND (v_reply->>'cohort_id')::bigint=v_cohort,
      'Replay after kickoff changed or replaced the saved cohort';
    ASSERT (SELECT to_jsonb(o)=v_saved AND o.input_sha256=v_hash
      FROM gerball_tracking_private.observations AS o WHERE o.id=v_id),
      'Replay rewrote saved inputs or timestamps';

    rejected := false;
    v_other_cohort := nextval(pg_get_serial_sequence('gerball_tracking_private.cohorts','id'));
    BEGIN
      INSERT INTO gerball_tracking_private.observations
        (cohort_id,rule_version,league_code,event_id,kickoff_at,fixture_date,season,phase,fixture,input_sha256)
      VALUES (v_other_cohort,'ppg_last5_dates_050_v1','E1','verification-clock',v_kickoff,v_today,'0000','calibration',v_fixture,repeat('0',64));
    EXCEPTION WHEN invalid_parameter_value THEN rejected := true;
    END;
    ASSERT rejected, 'A new observation was accepted after kickoff';
    RAISE EXCEPTION USING ERRCODE='ZR001',MESSAGE='Rollback clock and immutability fixtures';
  EXCEPTION WHEN SQLSTATE 'ZR001' THEN NULL;
  END;

  -- Unsealed cohort IDs allow ranking fixtures to be tested in one transaction.
  -- All rows pass the actual insert guards. They are rolled back before deferred
  -- foreign keys are checked; no capture dates or server timestamps are altered.
  BEGIN
    v_early := clock_timestamp()+interval '1 day';
    v_late := clock_timestamp()+interval '2 days';
    IF v_today<=DATE '2026-11-29' AND v_today+13>=DATE '2026-12-01' THEN
      v_early := TIMESTAMP '2026-11-30 18:00:00' AT TIME ZONE 'Europe/London';
      v_late := TIMESTAMP '2026-12-01 18:00:00' AT TIME ZONE 'Europe/London';
    END IF;
    v_early_phase := CASE WHEN (v_early AT TIME ZONE 'Europe/London')::date<DATE '2026-12-01' THEN 'calibration' ELSE 'post_boundary' END;
    v_late_phase := CASE WHEN (v_late AT TIME ZONE 'Europe/London')::date<DATE '2026-12-01' THEN 'calibration' ELSE 'post_boundary' END;
    v_rows := jsonb_set(v_base,'{home,history}',v_base#>'{away,history}')
      || '{"ppg_gap":0,"markets":{"H":{"status":"no_match","reason":"Synthetic historical condition excluded"},"D":{"status":"match","reason":"Synthetic historical condition met"},"A":{"status":"no_match","reason":"Synthetic historical condition excluded"}}}'::jsonb;
    v_cases := jsonb_build_array(
      v_rows || jsonb_build_object('event_id','verification-repeat','kickoff_at',v_early),
      v_base || jsonb_build_object('event_id','verification-repeat','kickoff_at',v_early),
      v_base || jsonb_build_object('event_id','verification-repeat','kickoff_at',v_late),
      v_base || jsonb_build_object('event_id','verification-alternate-id','kickoff_at',v_early),
      jsonb_set(v_base || jsonb_build_object('event_id','verification-unique','kickoff_at',v_late),'{home,canonical_name}','"Another Verification Home"'),
      v_rows || jsonb_build_object('event_id','verification-excluded','kickoff_at',v_late)
    );
    FOR v_fixture IN SELECT value FROM jsonb_array_elements(v_cases) LOOP
      v_other_cohort := nextval(pg_get_serial_sequence('gerball_tracking_private.cohorts','id'));
      INSERT INTO gerball_tracking_private.observations
        (cohort_id,rule_version,league_code,event_id,kickoff_at,fixture_date,season,phase,fixture,input_sha256)
      VALUES (v_other_cohort,'ppg_last5_dates_050_v1','E1',v_fixture->>'event_id',
        (v_fixture->>'kickoff_at')::timestamptz,v_today,'0000','calibration',v_fixture,repeat('0',64))
      RETURNING id INTO v_id;
      v_ids := array_append(v_ids,v_id);
    END LOOP;
    ASSERT (SELECT event_first_id=v_ids[2] AND representative_id=v_ids[2]
      FROM gerball_tracking_private.qualified_representatives
      WHERE league_code='E1' AND event_id='verification-repeat' AND market='H'),
      'First qualifying capture incorrectly used an earlier exclusion or a later changed fixture';
    ASSERT (SELECT event_first_id=v_ids[4] AND representative_id=v_ids[2]
      FROM gerball_tracking_private.qualified_representatives
      WHERE league_code='E1' AND event_id='verification-alternate-id' AND market='H'),
      'Duplicate provider IDs counted the same canonical fixture twice';
    ASSERT NOT EXISTS (SELECT 1 FROM gerball_tracking_private.qualified_representatives
      WHERE league_code='E1' AND event_id='verification-excluded' AND market='H'),
      'An exclusion entered the qualifying denominator';
    ASSERT (SELECT count(DISTINCT representative_id)=2
      FROM gerball_tracking_private.qualified_representatives WHERE league_code='E1' AND market='H'),
      'Daily repeats or provider duplicates inflated distinct qualifying fixtures';

    v_doc := public.gerball_recorded_screens('E1',NULL);
    FOREACH phase_name IN ARRAY ARRAY['calibration','post_boundary'] LOOP
      v_expected := (v_early_phase=phase_name)::integer+(v_late_phase=phase_name)::integer;
      ASSERT (v_doc#>>ARRAY['summary','H',phase_name,'fixtures'])::integer=v_expected,
        'First qualifying representatives were selected after the phase filter';
      ASSERT (v_doc#>>ARRAY['summary','H',phase_name,'pending'])::integer=v_expected
        AND (v_doc#>>ARRAY['summary','H',phase_name,'settled'])::integer=0
        AND v_doc#>ARRAY['summary','H',phase_name,'match_rate_pct']='null'::jsonb,
        'Pending observations produced settled outcomes or an invented rate';
    END LOOP;
    ASSERT (SELECT phase=v_early_phase FROM gerball_tracking_private.observations WHERE id=v_ids[2]),
      'Postponement moved the original representative into a later phase';
    RAISE EXCEPTION USING ERRCODE='ZR002',MESSAGE='Rollback ranking fixtures';
  EXCEPTION WHEN SQLSTATE 'ZR002' THEN NULL;
  END;

  -- A harmless comment changes the real stored function definition inside this
  -- subtransaction. The capture must reject drift, then the definition rolls
  -- back immediately. No live request observes an uncommitted definition.
  v_original_definition := pg_get_functiondef('public.gerball_strategy_screen(text,integer)'::regprocedure);
  v_original_hash := gerball_tracking_private.implementation_hash();
  BEGIN
    v_changed_definition := replace(v_original_definition,
      'v_now timestamptz := statement_timestamp();',
      'v_now timestamptz := statement_timestamp(); -- verification-only implementation change');
    ASSERT v_changed_definition<>v_original_definition, 'Cannot exercise implementation drift on this function definition';
    EXECUTE v_changed_definition;
    ASSERT gerball_tracking_private.implementation_hash()<>v_original_hash, 'Implementation hash ignored a stored definition change';
    v_reply := gerball_tracking_private.capture_league('E1','bootstrap');
    ASSERT v_reply->>'status'='implementation_changed', 'New capture accepted a changed frozen implementation';
    ASSERT NOT EXISTS (SELECT 1 FROM gerball_tracking_private.cohorts WHERE league_code='E1'),
      'Drift rejection left a cohort behind';
    RAISE EXCEPTION USING ERRCODE='ZR003',MESSAGE='Restore verified function definition';
  EXCEPTION WHEN SQLSTATE 'ZR003' THEN NULL;
  END;
  ASSERT pg_get_functiondef('public.gerball_strategy_screen(text,integer)'::regprocedure)=v_original_definition
    AND gerball_tracking_private.implementation_hash()=v_original_hash,
    'Drift verification did not restore the function definition';

  SELECT jsonb_build_object(
    'matches',(SELECT count(*) FROM public.matches),
    'odds',(SELECT count(*) FROM public.gerball_odds_snapshots),
    'predictions',(SELECT count(*) FROM gerball_private.prospective_predictions),
    'settlements',(SELECT count(*) FROM gerball_private.prospective_settlements),
    'approvals',(SELECT count(*) FROM gerball_private.prospective_ingestion_approvals)
  ) INTO after_counts;
  ASSERT after_counts=before_counts, 'Verification changed existing history, odds or priced ledgers';
  ASSERT NOT EXISTS (SELECT 1 FROM gerball_tracking_private.observations WHERE league_code='E1')
    AND NOT EXISTS (SELECT 1 FROM gerball_tracking_private.cohorts WHERE league_code='E1'),
    'Synthetic verification records survived rollback';
END
$ledger_verification$;

DO $result_verification$
DECLARE
  fixture jsonb := '{"league_code":"E0","season":"2627","fixture_date":"2026-11-30","recorded_at":"2026-11-24T12:15:00Z","home":{"canonical_name":"Verification Home"},"away":{"canonical_name":"Verification Away"}}'::jsonb;
  candidate jsonb := '{"id":91001,"league":"E0","season":"2627","match_date":"2026-11-30","home_team":"Verification Home","away_team":"Verification Away","home_goals":2,"away_goals":1,"full_time_result":"H","source":"football-data.co.uk","imported_at":"2026-12-01T08:00:00Z"}'::jsonb;
  observed jsonb;
  cases record;
BEGIN
  -- Independently specified outcomes, including the valid zero-goal draw.
  FOR cases IN SELECT * FROM (VALUES
    (2,1,'H'::text), (0,0,'D'), (1,2,'A')
  ) AS expected(home_goals,away_goals,full_time_result) LOOP
    observed := gerball_tracking_private.evaluate_result(fixture,jsonb_build_array(
      candidate || jsonb_build_object('home_goals',cases.home_goals,
        'away_goals',cases.away_goals,'full_time_result',cases.full_time_result)));
    ASSERT observed->>'status'='settled', 'Valid final result was not reconciled';
    ASSERT (observed->>'match_id')::bigint=91001, 'Result source identity lost';
    ASSERT (observed->>'home_goals')::integer=cases.home_goals
      AND (observed->>'away_goals')::integer=cases.away_goals
      AND observed->>'full_time_result'=cases.full_time_result,
      'Result helper altered the imported outcome';
  END LOOP;

  observed := gerball_tracking_private.evaluate_result(fixture,'[]'::jsonb);
  ASSERT observed->>'status'='pending' AND observed->>'reason'='awaiting_import',
    'Absent result must remain pending';
  ASSERT observed->>'match_id' IS NULL AND observed->>'full_time_result' IS NULL,
    'Pending result contains a fabricated settlement';

  -- Neighbouring fixtures, another season, and a postponed fixture must not be
  -- silently selected merely because the teams look similar.
  FOR cases IN SELECT * FROM (VALUES
    ('different date'::text,'{"match_date":"2026-12-01"}'::jsonb),
    ('different season','{"season":"2526"}'::jsonb),
    ('different league','{"league":"E1"}'::jsonb),
    ('different team','{"away_team":"Another Away"}'::jsonb),
    ('swapped venues','{"home_team":"Verification Away","away_team":"Verification Home"}'::jsonb)
  ) AS example(label,patch) LOOP
    observed := gerball_tracking_private.evaluate_result(fixture,jsonb_build_array(candidate || cases.patch));
    ASSERT observed->>'status'<>'settled', format('Unexpected match to %s',cases.label);
  END LOOP;

  -- An unrelated row cannot make the exact candidate ambiguous or replace it.
  observed := gerball_tracking_private.evaluate_result(fixture,jsonb_build_array(
    candidate, candidate || '{"id":91002,"away_team":"Another Away"}'::jsonb));
  ASSERT observed->>'status'='settled' AND (observed->>'match_id')::bigint=91001,
    'Exact identity did not distinguish an unrelated candidate';

  observed := gerball_tracking_private.evaluate_result(fixture,jsonb_build_array(
    candidate,candidate || '{"id":91002}'::jsonb));
  ASSERT observed->>'status'='review' AND observed->>'reason'='ambiguous_result',
    'More than one exact source result must require review';

  FOR cases IN SELECT * FROM (VALUES
    ('negative goals'::text,'{"home_goals":-1}'::jsonb,'inconsistent_result'::text),
    ('missing home score','{"home_goals":null}'::jsonb,'inconsistent_result'),
    ('missing away score','{"away_goals":null}'::jsonb,'inconsistent_result'),
    ('inconsistent FTR','{"full_time_result":"A"}'::jsonb,'inconsistent_result'),
    ('missing FTR','{"full_time_result":null}'::jsonb,'inconsistent_result'),
    ('unknown FTR','{"full_time_result":"P"}'::jsonb,'inconsistent_result'),
    ('another source','{"source":"unverified-source"}'::jsonb,'unexpected_source'),
    ('old imported result','{"imported_at":"2026-11-24T11:00:00Z"}'::jsonb,'result_predates_capture')
  ) AS example(label,patch,reason) LOOP
    observed := gerball_tracking_private.evaluate_result(fixture,jsonb_build_array(candidate || cases.patch));
    ASSERT observed->>'status'='review' AND observed->>'reason'=cases.reason,
      format('Invalid result was not explained: %s; got %s',cases.label,observed);
  END LOOP;
END
$result_verification$;

SELECT 'Recorded screens: server clocks, immutable captures, kickoff replay, phase and identity deduplication, implementation freeze, role permissions and exact result verification passed' AS verification;
