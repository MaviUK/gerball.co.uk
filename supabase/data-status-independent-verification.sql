-- Independent checks for the read-only Data status projection.
-- Designed to run after the staged schema in BEGIN/ROLLBACK. These assertions
-- modify no source row, scheduler configuration, importer or frozen rule.

DO $clock_and_state_verification$
DECLARE
  v_schedule jsonb;
  v_job jsonb := '{"present":true,"active":true,"configuration_matches":true,"last_run":null}'::jsonb;
  v_evidence jsonb;
  v_state jsonb;
  v_missing jsonb;
  v_disabled jsonb;
  v_mismatch jsonb;
  r record;
  stage_name text;
BEGIN
  -- The expected UTC instants are explicitly specified, independently of the
  -- implementation's timezone arithmetic. UK noon moves on both clock changes.
  FOR r IN SELECT * FROM (VALUES
    ('winter'::text,TIMESTAMPTZ '2026-11-24T11:00:00Z',TIMESTAMPTZ '2026-11-24T12:00:00Z'),
    ('summer',TIMESTAMPTZ '2026-07-14T10:00:00Z',TIMESTAMPTZ '2026-07-14T11:00:00Z'),
    ('day before spring change',TIMESTAMPTZ '2027-03-27T10:00:00Z',TIMESTAMPTZ '2027-03-27T12:00:00Z'),
    ('spring change day',TIMESTAMPTZ '2027-03-28T10:00:00Z',TIMESTAMPTZ '2027-03-28T11:00:00Z'),
    ('day before autumn change',TIMESTAMPTZ '2027-10-30T10:00:00Z',TIMESTAMPTZ '2027-10-30T11:00:00Z'),
    ('autumn change day',TIMESTAMPTZ '2027-10-31T10:00:00Z',TIMESTAMPTZ '2027-10-31T12:00:00Z')
  ) AS expected(label,clock,noon) LOOP
    v_schedule := gerball_status_private.schedule_times(r.clock);
    ASSERT (v_schedule->>'collector_at')::timestamptz=r.noon, format('Wrong UK noon: %s',r.label);
    ASSERT (v_schedule->>'collector_deadline')::timestamptz=r.noon+interval '15 minutes', format('Wrong collection grace: %s',r.label);
    ASSERT (v_schedule->>'recorder_at')::timestamptz=r.noon+interval '15 minutes', format('Wrong capture start: %s',r.label);
    ASSERT (v_schedule->>'recorder_deadline')::timestamptz=r.noon+interval '30 minutes', format('Wrong capture grace: %s',r.label);
  END LOOP;
  v_schedule := gerball_status_private.schedule_times(TIMESTAMPTZ '2027-03-27T12:31:00Z');
  ASSERT (v_schedule->>'collector_next')::timestamptz=TIMESTAMPTZ '2027-03-28T11:00:00Z'
    AND (v_schedule->>'recorder_next')::timestamptz=TIMESTAMPTZ '2027-03-28T11:15:00Z',
    'Next daily run used a fixed 24-hour interval across the spring clock change';
  v_schedule := gerball_status_private.schedule_times(TIMESTAMPTZ '2027-10-30T11:31:00Z');
  ASSERT (v_schedule->>'collector_next')::timestamptz=TIMESTAMPTZ '2027-10-31T12:00:00Z'
    AND (v_schedule->>'recorder_next')::timestamptz=TIMESTAMPTZ '2027-10-31T12:15:00Z',
    'Next daily run used a fixed 24-hour interval across the autumn clock change';
  v_schedule := gerball_status_private.schedule_times(TIMESTAMPTZ '2027-03-26T08:14:59Z');
  ASSERT (v_schedule->>'import_next')::timestamptz=TIMESTAMPTZ '2027-03-26T08:15:00Z', 'Friday import moved away from its existing UTC schedule';
  v_schedule := gerball_status_private.schedule_times(TIMESTAMPTZ '2027-03-26T08:15:01Z');
  ASSERT (v_schedule->>'import_next')::timestamptz=TIMESTAMPTZ '2027-03-29T08:15:00Z', 'Monday import incorrectly shifted its UTC schedule with BST';

  FOR r IN SELECT * FROM (VALUES
    ('collector'::text,TIMESTAMPTZ '2026-11-24T11:59:59Z','not_due'::text),
    ('collector',TIMESTAMPTZ '2026-11-24T12:00:00Z','waiting'),
    ('collector',TIMESTAMPTZ '2026-11-24T12:14:59Z','waiting'),
    ('collector',TIMESTAMPTZ '2026-11-24T12:15:00Z','attention'),
    ('recorder',TIMESTAMPTZ '2026-11-24T12:14:59Z','not_due'),
    ('recorder',TIMESTAMPTZ '2026-11-24T12:15:00Z','waiting'),
    ('recorder',TIMESTAMPTZ '2026-11-24T12:29:59Z','waiting'),
    ('recorder',TIMESTAMPTZ '2026-11-24T12:30:00Z','attention')
  ) AS expected(stage,clock,state) LOOP
    v_schedule := gerball_status_private.schedule_times(r.clock);
    v_evidence := jsonb_build_object('scheduled_at',v_schedule->(r.stage||'_at'),
      'deadline_at',v_schedule->(r.stage||'_deadline'),'last_success_at',NULL,
      'complete',false,'failed',false,'status',NULL,'completed_leagues',0,
      'upstream_ready',true,'implementation_matches',true);
    v_state := gerball_status_private.stage_state(r.stage,r.clock,v_job,v_evidence);
    ASSERT v_state->>'state'=r.state, format('Wrong %s deadline state at %s: %s',r.stage,r.clock,v_state);
  END LOOP;

  FOREACH stage_name IN ARRAY ARRAY['collector','recorder','reconciliation'] LOOP
    v_evidence := '{"scheduled_at":"2026-11-24T12:00:00Z","deadline_at":"2026-11-24T13:30:00Z","last_success_at":"2026-11-24T12:00:00Z","complete":true,"failed":false,"status":"completed","completed_leagues":18,"upstream_ready":true,"implementation_matches":true}'::jsonb;
    v_state := gerball_status_private.stage_state(stage_name,TIMESTAMPTZ '2026-11-24T12:45:00Z',v_job,v_evidence);
    ASSERT v_state->>'state'='complete', format('Healthy evidence was not complete for %s',stage_name);

    v_missing := gerball_status_private.stage_state(stage_name,TIMESTAMPTZ '2026-11-24T12:45:00Z',
      v_job || '{"present":false,"active":null,"configuration_matches":false}'::jsonb,v_evidence);
    v_disabled := gerball_status_private.stage_state(stage_name,TIMESTAMPTZ '2026-11-24T12:45:00Z',
      v_job || '{"active":false}'::jsonb,v_evidence);
    v_mismatch := gerball_status_private.stage_state(stage_name,TIMESTAMPTZ '2026-11-24T12:45:00Z',
      v_job || '{"configuration_matches":false}'::jsonb,v_evidence);
    ASSERT v_missing->>'state'='attention' AND v_disabled->>'state'='attention' AND v_mismatch->>'state'='attention',
      format('A scheduler fault was hidden by successful stored data for %s',stage_name);
    ASSERT v_missing->>'reason_code' IS DISTINCT FROM v_disabled->>'reason_code'
      AND v_disabled->>'reason_code' IS DISTINCT FROM v_mismatch->>'reason_code',
      'Missing, disabled and changed schedules need distinct explanations';
    v_state := gerball_status_private.stage_state(stage_name,TIMESTAMPTZ '2026-11-24T12:45:00Z',
      v_job || '{"present":false,"active":false,"configuration_matches":false}'::jsonb,v_evidence);
    ASSERT v_state=v_missing, 'Missing-job precedence changed';

    v_state := gerball_status_private.stage_state(stage_name,TIMESTAMPTZ '2026-11-24T12:45:00Z',
      v_job || '{"last_run":{"status":"failed","started_at":"2026-11-24T12:15:00Z"}}'::jsonb,v_evidence);
    ASSERT v_state->>'state'='attention', format('Later failed execution hidden for %s',stage_name);
    v_state := gerball_status_private.stage_state(stage_name,TIMESTAMPTZ '2026-11-24T12:45:00Z',
      v_job || '{"last_run":{"status":"failed","started_at":"2026-11-24T11:45:00Z"}}'::jsonb,v_evidence);
    ASSERT v_state->>'state'='complete', format('Old recovered failure still masks success for %s',stage_name);
    v_state := gerball_status_private.stage_state(stage_name,TIMESTAMPTZ '2026-11-24T12:45:00Z',
      v_job || '{"last_run":{"status":"failed","started_at":"2026-11-24T11:45:00Z","finished_at":"2026-11-24T12:15:00Z"}}'::jsonb,v_evidence);
    ASSERT v_state->>'state'='attention' AND v_state->>'reason_code'='job_failed',
      format('A run that failed after success was hidden because it started earlier for %s',stage_name);
    v_state := gerball_status_private.stage_state(stage_name,TIMESTAMPTZ '2026-11-24T12:45:00Z',
      v_job || '{"last_run":{"status":"failed","started_at":"2026-11-24T11:45:00Z","finished_at":"2026-11-24T13:00:00Z"}}'::jsonb,v_evidence);
    ASSERT v_state->>'state'='complete', format('A future failure completion leaked into current status for %s',stage_name);
    v_state := gerball_status_private.stage_state(stage_name,TIMESTAMPTZ '2026-11-24T12:45:00Z',
      v_job || '{"last_run":{"status":"failed","started_at":"2026-11-24T13:00:00Z"}}'::jsonb,v_evidence);
    ASSERT v_state->>'state'='complete', format('A future failure leaked into current status for %s',stage_name);
  END LOOP;

  v_evidence := '{"scheduled_at":"2026-11-24T12:00:00Z","deadline_at":"2026-11-24T12:15:00Z","last_success_at":null,"complete":false,"failed":true,"status":"failed","completed_leagues":0,"upstream_ready":false,"implementation_matches":true}'::jsonb;
  v_state := gerball_status_private.stage_state('collector',TIMESTAMPTZ '2026-11-24T11:45:00Z',v_job,v_evidence);
  ASSERT v_state->>'state'='attention', 'Explicit collection failure disappeared before the normal collection window';
  v_state := gerball_status_private.stage_state('collector',TIMESTAMPTZ '2026-11-24T12:05:00Z',v_job,
    v_evidence || '{"status":"verification_private_error_marker"}'::jsonb);
  ASSERT position('verification_private_error_marker' IN v_state::text)=0, 'State helper echoed raw provider/error text';
  v_state := gerball_status_private.stage_state('collector',TIMESTAMPTZ '2026-11-24T12:20:00Z',v_job,
    v_evidence || '{"evidence_at":"2026-11-24T13:00:00Z","last_success_at":"2026-11-24T13:00:00Z","complete":true,"failed":false}'::jsonb);
  ASSERT v_state->>'state'<>'complete', 'Future completed evidence made an overdue collection green';
  v_state := gerball_status_private.stage_state('recorder',TIMESTAMPTZ '2026-11-24T12:40:00Z',v_job,
    v_evidence || '{"last_success_at":"2026-11-24T12:25:00Z","complete":true,"failed":false,"completed_leagues":18,"implementation_matches":false}'::jsonb);
  ASSERT v_state->>'state'='attention', 'A changed frozen implementation was hidden by a previously saved cohort';

  -- Inactivity and a successful zero-fixture capture are successful work, not
  -- missing coverage. Completeness must not depend on a positive record count.
  FOREACH stage_name IN ARRAY ARRAY['collector','recorder'] LOOP
    v_state := gerball_status_private.stage_state(stage_name,TIMESTAMPTZ '2026-11-24T12:40:00Z',v_job,
      '{"scheduled_at":"2026-11-24T12:00:00Z","deadline_at":"2026-11-24T12:30:00Z","last_success_at":"2026-11-24T12:25:00Z","complete":true,"failed":false,"status":"inactive","completed_leagues":18,"records":0,"upstream_ready":true,"implementation_matches":true}'::jsonb);
    ASSERT v_state->>'state'='complete', format('An inactive or empty successful %s was marked missing',stage_name);
  END LOOP;

  v_evidence := '{"scheduled_at":"2026-11-24T12:30:00Z","deadline_at":"2026-11-24T12:35:00Z","last_success_at":null,"complete":false,"failed":false,"status":null,"completed_leagues":0,"upstream_ready":true,"implementation_matches":true}'::jsonb;
  FOR r IN SELECT * FROM (VALUES
    (TIMESTAMPTZ '2026-11-24T12:29:59Z','not_due'::text),
    (TIMESTAMPTZ '2026-11-24T12:30:00Z','waiting'),
    (TIMESTAMPTZ '2026-11-24T12:34:59Z','waiting'),
    (TIMESTAMPTZ '2026-11-24T12:35:00Z','attention')
  ) AS expected(clock,state) LOOP
    v_state := gerball_status_private.stage_state('reconciliation',r.clock,v_job,v_evidence);
    ASSERT v_state->>'state'=r.state, format('Wrong first reconciliation deadline state at %s: %s',r.clock,v_state);
  END LOOP;
  v_evidence := v_evidence || '{"last_success_at":"2026-11-24T12:30:00Z","deadline_at":"2026-11-24T14:00:00Z","complete":true}'::jsonb;
  v_state := gerball_status_private.stage_state('reconciliation',TIMESTAMPTZ '2026-11-24T13:59:59Z',v_job,v_evidence);
  ASSERT v_state->>'state'='complete', 'Fresh reconciliation evidence marked stale early';
  v_state := gerball_status_private.stage_state('reconciliation',TIMESTAMPTZ '2026-11-24T13:00:00Z',v_job,
    v_evidence || '{"failed":true}'::jsonb);
  ASSERT v_state->>'state'='attention', 'A failed reconciliation was hidden by a still-recent successful check';
  v_state := gerball_status_private.stage_state('reconciliation',TIMESTAMPTZ '2026-11-24T14:00:00Z',v_job,v_evidence);
  ASSERT v_state->>'state'='attention', 'A reconciliation remained green at its 90-minute stale boundary';
  v_state := gerball_status_private.stage_state('reconciliation',TIMESTAMPTZ '2026-11-24T13:00:00Z',v_job,
    v_evidence || '{"last_success_at":"2026-11-24T15:00:00Z"}'::jsonb);
  ASSERT v_state->>'state'<>'complete', 'A future reconciliation success made current status green';
END
$clock_and_state_verification$;

DO $projection_verification$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_doc jsonb;
  v_past jsonb;
  v_before jsonb;
  v_after jsonb;
  v_rule_hash text;
  v_first_import timestamptz;
  v_first_capture timestamptz;
  v_first_operation timestamptz;
  v_row record;
  v_stage jsonb;
  v_league jsonb;
  v_time text;
  rejected boolean;
BEGIN
  v_rule_hash := gerball_tracking_private.implementation_hash();
  SELECT jsonb_build_object('matches',(SELECT count(*) FROM public.matches),
    'odds',(SELECT count(*) FROM public.gerball_odds_snapshots),
    'cohorts',(SELECT count(*) FROM gerball_tracking_private.cohorts),
    'observations',(SELECT count(*) FROM gerball_tracking_private.observations),
    'revisions',(SELECT count(*) FROM gerball_tracking_private.result_revisions),
    'operations',(SELECT count(*) FROM gerball_tracking_private.operation_runs),
    'odds_runs',(SELECT count(*) FROM public.gerball_odds_runs),
    'league_runs',(SELECT count(*) FROM public.gerball_odds_league_runs),
    'import_logs',(SELECT count(*) FROM public.data_imports),
    'old_approvals',(SELECT count(*) FROM gerball_private.prospective_ingestion_approvals),
    'old_predictions',(SELECT count(*) FROM gerball_private.prospective_predictions),
    'old_settlements',(SELECT count(*) FROM gerball_private.prospective_settlements)) INTO v_before;

  v_doc := gerball_status_private.build_snapshot(v_now);
  ASSERT v_doc->>'status'='ok' AND v_doc->>'version'='data_status_v1'
    AND (v_doc->>'generated_at')::timestamptz=v_now, 'Projection contract or clock mismatch';
  ASSERT jsonb_array_length(v_doc->'leagues')=21 AND jsonb_array_length(v_doc->'jobs')=3,
    'Wrong archive/job coverage';
  ASSERT (SELECT count(*)=18 FROM jsonb_array_elements(v_doc->'leagues') AS l WHERE (l->>'odds_feed')::boolean),
    'The 18 configured feeds were confused with 21 historical leagues';
  FOR v_league IN SELECT value FROM jsonb_array_elements(v_doc->'leagues') LOOP
    IF v_league->>'code' IN ('SC1','SC2','SC3') THEN
      ASSERT v_league#>>'{collection,state}'='not_configured'
        AND v_league#>>'{recording,state}'='not_configured', 'Unsupported Scottish feed was labelled failed';
    END IF;
    ASSERT v_league#>>'{results,basis}'='recorded_observations', 'Result counts lost their observation basis';
    ASSERT (v_league#>>'{results,observations}')::integer=
      (v_league#>>'{results,settled}')::integer+(v_league#>>'{results,pending}')::integer+(v_league#>>'{results,review}')::integer,
      'Observation result counts do not reconcile';
    FOREACH v_time IN ARRAY ARRAY[v_league#>>'{collection,checked_at}',v_league#>>'{recording,captured_at}',v_league#>>'{results,last_result_at}'] LOOP
      ASSERT v_time IS NULL OR v_time::timestamptz<=v_now, 'A future league timestamp leaked into current status';
    END LOOP;
  END LOOP;
  FOR v_stage IN SELECT value FROM jsonb_each(v_doc->'stages') LOOP
    FOREACH v_time IN ARRAY ARRAY[v_stage->>'last_activity_at',v_stage->>'last_success_at'] LOOP
      ASSERT v_time IS NULL OR v_time::timestamptz<=v_now, 'A future stage timestamp leaked into current status';
    END LOOP;
  END LOOP;
  ASSERT v_doc#>'{archive,import_schedule,run_audit_available}'='false'::jsonb
    AND v_doc#>'{archive,import_schedule,last_successful_run_at}'='null'::jsonb
    AND v_doc#>>'{archive,import_schedule,source}'='repository_declared'
    AND v_doc#>>'{archive,import_schedule,cron}'='15 8 * * 1,5',
    'Stored match metadata was presented as verified importer success';
  ASSERT NOT jsonb_path_exists(v_doc,'$.**.command') AND NOT jsonb_path_exists(v_doc,'$.**.return_message')
    AND NOT jsonb_path_exists(v_doc,'$.**.error_message') AND NOT jsonb_path_exists(v_doc,'$.**.credential_slot')
    AND NOT jsonb_path_exists(v_doc,'$.**.api_key') AND NOT jsonb_path_exists(v_doc,'$.**.token')
    AND position('vault.decrypted_secrets' IN v_doc::text)=0
    AND position('x-gerball-token' IN v_doc::text)=0,
    'Read projection exposed privileged commands, credentials or raw error text';

  -- Past-clock projections must not pull future immutable cohorts or operations
  -- into a latest-row aggregate. The data remain untouched throughout this test.
  SELECT min(imported_at) INTO v_first_import FROM public.matches;
  IF v_first_import IS NOT NULL THEN
    v_past := gerball_status_private.build_snapshot(v_first_import-interval '1 second');
    ASSERT (v_past#>>'{archive,total_matches}')::bigint=0, 'Archive included rows recorded after its as-of clock';
  END IF;
  SELECT min(captured_at) INTO v_first_capture FROM gerball_tracking_private.cohorts;
  IF v_first_capture IS NOT NULL THEN
    v_past := gerball_status_private.build_snapshot(v_first_capture-interval '1 second');
    ASSERT (v_past#>>'{stages,recorder,completed_leagues}')::integer=0,
      'Unsealed-at-clock cohorts were counted as completed';
    ASSERT (SELECT sum((l#>>'{results,observations}')::bigint)=0 FROM jsonb_array_elements(v_past->'leagues') AS l),
      'Children of future cohorts were exposed before the cohort was sealed';
  END IF;
  SELECT min(recorded_at) INTO v_first_operation FROM gerball_tracking_private.operation_runs WHERE operation='reconcile';
  IF v_first_operation IS NOT NULL THEN
    v_past := gerball_status_private.build_snapshot(v_first_operation-interval '1 second');
    ASSERT v_past#>'{stages,reconciliation,last_success_at}'='null'::jsonb,
      'A future reconciliation operation was selected as a prior success';
  END IF;

  ASSERT NOT has_function_privilege('anon','public.gerball_data_status()','EXECUTE')
    AND NOT has_function_privilege('authenticated','public.gerball_data_status()','EXECUTE')
    AND has_function_privilege('service_role','public.gerball_data_status()','EXECUTE'),
    'Public read RPC role grants differ from the intended contract';
  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    v_doc := public.gerball_data_status();
    ASSERT v_doc->>'status'='ok', 'Actual server role cannot read Data status';
    EXECUTE 'RESET ROLE';
  END;
  rejected := false;
  BEGIN
    EXECUTE 'SET LOCAL ROLE anon';
    PERFORM public.gerball_data_status();
  EXCEPTION WHEN insufficient_privilege THEN rejected := true;
  END;
  EXECUTE 'RESET ROLE';
  ASSERT rejected, 'Anonymous role called the internal status RPC';

  SELECT jsonb_build_object('matches',(SELECT count(*) FROM public.matches),
    'odds',(SELECT count(*) FROM public.gerball_odds_snapshots),
    'cohorts',(SELECT count(*) FROM gerball_tracking_private.cohorts),
    'observations',(SELECT count(*) FROM gerball_tracking_private.observations),
    'revisions',(SELECT count(*) FROM gerball_tracking_private.result_revisions),
    'operations',(SELECT count(*) FROM gerball_tracking_private.operation_runs),
    'odds_runs',(SELECT count(*) FROM public.gerball_odds_runs),
    'league_runs',(SELECT count(*) FROM public.gerball_odds_league_runs),
    'import_logs',(SELECT count(*) FROM public.data_imports),
    'old_approvals',(SELECT count(*) FROM gerball_private.prospective_ingestion_approvals),
    'old_predictions',(SELECT count(*) FROM gerball_private.prospective_predictions),
    'old_settlements',(SELECT count(*) FROM gerball_private.prospective_settlements)) INTO v_after;
  ASSERT v_after=v_before AND gerball_tracking_private.implementation_hash()=v_rule_hash,
    'A status read changed source data, ledgers or a frozen implementation';
END
$projection_verification$;

SELECT 'Independent Data status verification: UK deadlines and clock changes, scheduler faults, reconciliation freshness, safe read-only projection, future-evidence filtering and role isolation passed' AS verification;
