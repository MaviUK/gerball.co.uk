-- Read-only integration checks. Combine with the draft schema inside a single
-- BEGIN/ROLLBACK while staging; the same checks are safe after deployment.
DO $data_status_checks$
DECLARE
  v_doc jsonb;
  v_job jsonb;
  v_league jsonb;
  v_before jsonb;
  v_after jsonb;
  v_role text;
  v_denied boolean;
  v_stage text;
BEGIN
  FOREACH v_stage IN ARRAY ARRAY['collector','recorder'] LOOP
    ASSERT gerball_status_private.stage_state(v_stage,TIMESTAMPTZ '2026-11-24T13:00:00Z',
      '{"present":true,"active":true,"configuration_matches":true,"last_run":null}'::jsonb,
      '{"scheduled_at":"2026-11-24T12:00:00Z","deadline_at":"2026-11-24T12:30:00Z","complete":true,"failed":true,"implementation_matches":true}'::jsonb)->>'state'='attention',
      'A later failed operation was hidden by already-recorded coverage';
  END LOOP;
  SELECT jsonb_build_object('matches',(SELECT count(*) FROM public.matches),
    'odds',(SELECT count(*) FROM public.gerball_odds_snapshots),
    'cohorts',(SELECT count(*) FROM gerball_tracking_private.cohorts),
    'observations',(SELECT count(*) FROM gerball_tracking_private.observations),
    'revisions',(SELECT count(*) FROM gerball_tracking_private.result_revisions),
    'operations',(SELECT count(*) FROM gerball_tracking_private.operation_runs),
    'frozen_hash',gerball_tracking_private.implementation_hash(),
    'jobs',(SELECT jsonb_agg(jsonb_build_object('id',jobid,'name',jobname,'active',active,
      'schedule',schedule,'command_sha256',encode(extensions.digest(command,'sha256'),'hex')) ORDER BY jobid)
      FROM cron.job)) INTO v_before;
  v_doc:=public.gerball_data_status();
  ASSERT v_doc->>'status'='ok' AND jsonb_array_length(v_doc->'leagues')=21
    AND jsonb_array_length(v_doc->'jobs')=3 AND jsonb_array_length(v_doc->'recent_days')<=7,
    'Data status shape or bounded coverage mismatch';
  ASSERT (SELECT sum((l#>>'{archive,matches}')::bigint) FROM jsonb_array_elements(v_doc->'leagues') l)
      =(v_doc#>>'{archive,total_matches}')::bigint, 'Archive league totals do not reconcile';
  ASSERT (SELECT sum((l#>>'{archive,current_season_matches}')::bigint) FROM jsonb_array_elements(v_doc->'leagues') l)
      =(v_doc#>>'{archive,current_season_matches}')::bigint, 'Current-season totals do not reconcile';
  ASSERT NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_doc->'recent_days') d
    WHERE (d->>'date')::date NOT BETWEEN (v_doc->>'uk_date')::date-6 AND (v_doc->>'uk_date')::date),
    'Recent activity escaped the last seven UK calendar dates';
  FOR v_job IN SELECT value FROM jsonb_array_elements(v_doc->'jobs') LOOP
    ASSERT v_job->>'key' IN ('collector','recorder','reconciliation'), 'Unexpected scheduler metadata exposed';
    ASSERT NOT v_job ?| ARRAY['command','return_message','username','owner','database','nodename','nodeport','jobid'],
      'Scheduler projection includes privileged internals';
    IF NOT (v_job->>'present')::boolean OR NOT COALESCE((v_job->>'active')::boolean,false)
      OR NOT (v_job->>'configuration_matches')::boolean THEN
      ASSERT v_doc->'stages'->(v_job->>'key')->>'state'='attention', 'Scheduler problem was hidden';
    END IF;
    ASSERT v_job->>'next_run_at' IS NULL OR (v_job->>'next_run_at')::timestamptz>(v_doc->>'generated_at')::timestamptz,
      'Next job execution is not in the future';
  END LOOP;
  FOR v_league IN SELECT value FROM jsonb_array_elements(v_doc->'leagues') LOOP
    ASSERT (v_league#>>'{results,observations}')::bigint=
      (v_league#>>'{results,settled}')::bigint+(v_league#>>'{results,pending}')::bigint+(v_league#>>'{results,review}')::bigint,
      'Result observation totals do not reconcile';
    IF v_league->>'code' IN ('SC1','SC2','SC3') THEN
      ASSERT v_league->>'odds_feed'='false' AND v_league#>>'{collection,status}'='not_supported'
        AND v_league#>>'{recording,status}'='not_supported', 'Historical-only league reported as an outage';
    END IF;
  END LOOP;
  ASSERT v_doc#>>'{archive,import_schedule,source}'='repository_declared'
    AND v_doc#>'{archive,import_schedule,last_successful_run_at}'='null'::jsonb,
    'Import schedule metadata was misrepresented as a successful run';
  ASSERT (SELECT count(*)=1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='gerball_status_private' AND p.prosecdef AND p.proname='scheduler_metadata'),
    'Unexpected privileged status helper';
  ASSERT NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='gerball_status_private' AND p.prosecdef AND p.proname<>'scheduler_metadata'),
    'Read snapshot gained definer privileges';
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    ASSERT NOT has_schema_privilege(v_role,'gerball_status_private','USAGE')
      AND NOT has_function_privilege(v_role,'public.gerball_data_status()','EXECUTE')
      AND NOT has_function_privilege(v_role,'gerball_status_private.scheduler_metadata(timestamptz)','EXECUTE'),
      'Client role gained direct status or scheduler access';
    v_denied:=false;
    BEGIN
      EXECUTE format('SET LOCAL ROLE %I',v_role);
      PERFORM public.gerball_data_status();
    EXCEPTION WHEN insufficient_privilege THEN v_denied:=true;
    END;
    EXECUTE 'RESET ROLE';
    ASSERT v_denied,'Actual client role called service-only status RPC';
  END LOOP;
  SELECT jsonb_build_object('matches',(SELECT count(*) FROM public.matches),
    'odds',(SELECT count(*) FROM public.gerball_odds_snapshots),
    'cohorts',(SELECT count(*) FROM gerball_tracking_private.cohorts),
    'observations',(SELECT count(*) FROM gerball_tracking_private.observations),
    'revisions',(SELECT count(*) FROM gerball_tracking_private.result_revisions),
    'operations',(SELECT count(*) FROM gerball_tracking_private.operation_runs),
    'frozen_hash',gerball_tracking_private.implementation_hash(),
    'jobs',(SELECT jsonb_agg(jsonb_build_object('id',jobid,'name',jobname,'active',active,
      'schedule',schedule,'command_sha256',encode(extensions.digest(command,'sha256'),'hex')) ORDER BY jobid)
      FROM cron.job)) INTO v_after;
  ASSERT v_after=v_before,'Status refresh changed existing data, schedules or frozen definitions';
END
$data_status_checks$;

SELECT 'Data status verification: bounded projection, coverage totals, scheduler visibility, read-only preservation and role isolation passed' AS verification;
