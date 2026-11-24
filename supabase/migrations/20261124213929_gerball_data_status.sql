-- Bounded, read-only operational status. No data, schedules, frozen rules,
-- importer or collector definitions are changed by this migration.
CREATE SCHEMA gerball_status_private;
REVOKE ALL ON SCHEMA gerball_status_private FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA gerball_status_private TO service_role;

CREATE FUNCTION gerball_status_private.leagues()
RETURNS TABLE(code text,name text,country text,sport_key text)
LANGUAGE sql IMMUTABLE SECURITY INVOKER ROWS 21 COST 1 SET search_path = ''
AS $function$
  VALUES
    ('E0','Premier League','England','soccer_epl'),
    ('E1','Championship','England','soccer_efl_champ'),
    ('E2','League One','England','soccer_england_league1'),
    ('E3','League Two','England','soccer_england_league2'),
    ('SC0','Premiership','Scotland','soccer_spl'),
    ('SC1','Championship','Scotland',NULL),
    ('SC2','League One','Scotland',NULL),
    ('SC3','League Two','Scotland',NULL),
    ('D1','Bundesliga','Germany','soccer_germany_bundesliga'),
    ('D2','2. Bundesliga','Germany','soccer_germany_bundesliga2'),
    ('I1','Serie A','Italy','soccer_italy_serie_a'),
    ('I2','Serie B','Italy','soccer_italy_serie_b'),
    ('SP1','La Liga','Spain','soccer_spain_la_liga'),
    ('SP2','Segunda División','Spain','soccer_spain_segunda_division'),
    ('F1','Ligue 1','France','soccer_france_ligue_one'),
    ('F2','Ligue 2','France','soccer_france_ligue_two'),
    ('N1','Eredivisie','Netherlands','soccer_netherlands_eredivisie'),
    ('B1','Pro League','Belgium','soccer_belgium_first_div'),
    ('P1','Primeira Liga','Portugal','soccer_portugal_primeira_liga'),
    ('G1','Super League','Greece','soccer_greece_super_league'),
    ('T1','Süper Lig','Turkey','soccer_turkey_super_league');
$function$;

CREATE FUNCTION gerball_status_private.schedule_times(p_now timestamptz)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $function$
WITH dates AS (
  SELECT (p_now AT TIME ZONE 'Europe/London')::date AS uk_date,
    (p_now AT TIME ZONE 'UTC')::date AS utc_date
), daily_candidates AS (
  SELECT ((d.uk_date + n.day)::timestamp + t.clock) AT TIME ZONE 'Europe/London' AS at_time,t.stage
  FROM dates d CROSS JOIN (VALUES (0),(1)) n(day)
  CROSS JOIN (VALUES
    ('collector'::text,interval '12 hours'),('collector',interval '12 hours 5 minutes'),('collector',interval '12 hours 10 minutes'),
    ('recorder',interval '12 hours 15 minutes'),('recorder',interval '12 hours 20 minutes'),('recorder',interval '12 hours 25 minutes')
  ) t(stage,clock)
), imports AS (
  SELECT ((d.utc_date + n.day)::timestamp + interval '8 hours 15 minutes') AT TIME ZONE 'UTC' AS at_time
  FROM dates d CROSS JOIN generate_series(0,7) AS n(day)
  WHERE extract(isodow FROM d.utc_date + n.day) IN (1,5)
), hourly AS (
  SELECT (date_trunc('hour',p_now AT TIME ZONE 'UTC') + interval '30 minutes') AT TIME ZONE 'UTC' AS at_time
)
SELECT jsonb_build_object('uk_date',d.uk_date,
  'collector_at',(d.uk_date + time '12:00') AT TIME ZONE 'Europe/London',
  'collector_deadline',(d.uk_date + time '12:15') AT TIME ZONE 'Europe/London',
  'collector_next',(SELECT min(at_time) FROM daily_candidates WHERE stage='collector' AND at_time>p_now),
  'recorder_at',(d.uk_date + time '12:15') AT TIME ZONE 'Europe/London',
  'recorder_deadline',(d.uk_date + time '12:30') AT TIME ZONE 'Europe/London',
  'recorder_next',(SELECT min(at_time) FROM daily_candidates WHERE stage='recorder' AND at_time>p_now),
  'reconciliation_next',(SELECT CASE WHEN at_time>p_now THEN at_time ELSE at_time+interval '1 hour' END FROM hourly),
  'import_next',(SELECT min(at_time) FROM imports WHERE at_time>p_now))
FROM dates d;
$function$;

-- The only definer helper is a fixed projection of three known scheduler jobs.
-- Raw commands, return messages, database names, hostnames and owners never leave
-- this function. Exact command hashes also detect changes inside quoted strings.
CREATE FUNCTION gerball_status_private.scheduler_metadata(p_now timestamptz)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
WITH expected AS (
  SELECT * FROM (VALUES
    ('collector'::text,'gerball-daily-odds'::text,'0,5,10 11,12 * * *'::text,
      '4b9fa26b31c8838daf94a789c906b1377155b56c4d0573f9b3f733fc73880b5e'::text),
    ('recorder','gerball-recorded-screens','15,20,25 11,12 * * *',
      '43fb60fe150643255dc5ffcd0b43fd56f10edd3667dbeba75039f71572632da5'),
    ('reconciliation','gerball-recorded-screen-results','30 * * * *',
      '3531a01087122cdc293edcf47145433a0332e42dd5adb0d4390cef33801d7911')
  ) e(key,name,schedule,command_sha256)
), projected AS (
  SELECT e.*,j.job_count,j.active,j.actual_schedule,j.config_matches,d.last_run
  FROM expected e
  LEFT JOIN LATERAL (
    SELECT count(*) AS job_count,bool_and(j.active) AS active,
      CASE WHEN min(j.schedule) IS NULL THEN NULL
        WHEN min(j.schedule) ~ '^[0-9*,/ -]{1,80}$' THEN min(j.schedule) ELSE 'custom' END AS actual_schedule,
      count(*)=1 AND bool_and(j.schedule=e.schedule AND j.database=current_database()
        AND j.username='postgres' AND j.nodename='localhost' AND j.nodeport=5432
        AND encode(extensions.digest(j.command,'sha256'),'hex')=e.command_sha256) AS config_matches
    FROM cron.job j WHERE j.jobname=e.name
  ) j ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_build_object('status',CASE WHEN r.end_time>p_now THEN 'running'
        WHEN r.status IN ('starting','running','succeeded','failed') THEN r.status ELSE 'unknown' END,
      'started_at',r.start_time,'finished_at',CASE WHEN r.end_time<=p_now THEN r.end_time END) AS last_run
    FROM cron.job_run_details r JOIN cron.job c ON c.jobid=r.jobid
    WHERE c.jobname=e.name AND r.start_time<=p_now
    ORDER BY r.start_time DESC,r.runid DESC LIMIT 1
  ) d ON true
)
SELECT jsonb_agg(jsonb_build_object('key',p.key,'name',p.name,'present',p.job_count>0,
  'active',p.active,'schedule',p.actual_schedule,'expected_schedule',p.schedule,
  'configuration_matches',COALESCE(p.config_matches,false),
  'next_run_at',CASE WHEN p.active AND p.config_matches THEN
    gerball_status_private.schedule_times(p_now)->(p.key||'_next') ELSE 'null'::jsonb END,
  'last_run',p.last_run) ORDER BY p.key)
FROM projected p;
$function$;

CREATE FUNCTION gerball_status_private.stage_state(p_stage text,p_now timestamptz,p_job jsonb,p_evidence jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = ''
AS $function$
DECLARE
  v_state text;
  v_reason text;
  v_success timestamptz := (p_evidence->>'last_success_at')::timestamptz;
  v_at timestamptz := (p_evidence->>'scheduled_at')::timestamptz;
  v_deadline timestamptz := (p_evidence->>'deadline_at')::timestamptz;
  v_complete boolean := COALESCE((p_evidence->>'complete')::boolean,false);
  v_failed boolean := COALESCE((p_evidence->>'failed')::boolean,false);
  v_job_failure_at timestamptz := COALESCE((p_job#>>'{last_run,finished_at}')::timestamptz,
    (p_job#>>'{last_run,started_at}')::timestamptz);
BEGIN
  IF p_now IS NULL OR p_stage NOT IN ('collector','recorder','reconciliation') THEN
    RAISE EXCEPTION 'invalid_status_parameters' USING ERRCODE='22023';
  END IF;
  IF v_success>p_now THEN v_success:=NULL;v_complete:=false; END IF;
  IF (p_evidence->>'evidence_at')::timestamptz>p_now THEN v_complete:=false;v_failed:=false; END IF;
  IF NOT COALESCE((p_job->>'present')::boolean,false) THEN v_reason:='job_missing';
  ELSIF NOT COALESCE((p_job->>'active')::boolean,false) THEN v_reason:='job_disabled';
  ELSIF NOT COALESCE((p_job->>'configuration_matches')::boolean,false) THEN v_reason:='job_configuration_changed';
  ELSIF p_job#>>'{last_run,status}'='failed' AND (p_job#>>'{last_run,started_at}')::timestamptz<=p_now
    AND v_job_failure_at<=p_now AND (v_success IS NULL OR v_job_failure_at>v_success) THEN v_reason:='job_failed';
  ELSIF p_stage='recorder' AND p_evidence->>'implementation_matches'='false' THEN v_reason:='rule_implementation_changed';
  ELSIF p_stage='reconciliation' AND v_failed THEN v_reason:='reconciliation_failed';
  ELSIF p_stage='reconciliation' THEN
    IF v_success IS NOT NULL AND p_now<v_success+interval '90 minutes' THEN
      v_state:='complete';v_reason:='reconciliation_current';
    ELSIF v_success IS NOT NULL OR (v_deadline IS NOT NULL AND p_now>=v_deadline) THEN
      v_state:='attention';v_reason:='reconciliation_stale';
    ELSIF v_at IS NULL OR p_now<v_at THEN v_state:='not_due';v_reason:='not_due';
    ELSE v_state:='waiting';v_reason:='reconciliation_pending'; END IF;
  ELSIF v_failed THEN v_state:='attention';v_reason:=CASE p_stage WHEN 'collector' THEN 'collection_failed' ELSE 'recording_failed' END;
  ELSIF v_complete THEN v_state:='complete';v_reason:=CASE p_stage WHEN 'collector' THEN 'collection_complete' ELSE 'recording_complete' END;
  ELSIF p_now<v_at THEN v_state:='not_due';v_reason:='not_due';
  ELSIF p_now>=v_deadline THEN
    v_state:='attention';v_reason:=CASE p_stage WHEN 'collector' THEN
      CASE WHEN COALESCE((p_evidence->>'completed_leagues')::integer,0)>0 THEN 'collection_incomplete' ELSE 'collection_overdue' END
      ELSE CASE WHEN COALESCE((p_evidence->>'completed_leagues')::integer,0)>0 THEN 'recording_incomplete' ELSE 'recording_overdue' END END;
  ELSE
    v_state:='waiting';v_reason:=CASE p_stage WHEN 'collector' THEN 'collection_running'
      ELSE CASE WHEN p_evidence->>'upstream_ready'='true' THEN 'recording_pending' ELSE 'waiting_for_collection' END END;
  END IF;
  RETURN jsonb_build_object('state',COALESCE(v_state,'attention'),'reason_code',v_reason);
END
$function$;

CREATE FUNCTION gerball_status_private.build_snapshot(p_now timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = ''
AS $function$
DECLARE
  v_times jsonb;
  v_jobs jsonb;
  v_collector_job jsonb;
  v_recorder_job jsonb;
  v_reconcile_job jsonb;
  v_healthy_job jsonb := '{"present":true,"active":true,"configuration_matches":true,"last_run":null}'::jsonb;
  v_day date;
  v_season text;
  v_parent record;
  v_capture record;
  v_reconcile record;
  v_collection_last_activity timestamptz;
  v_collection_last_success timestamptz;
  v_capture_last_activity timestamptz;
  v_capture_last_success timestamptz;
  v_reconcile_last_activity timestamptz;
  v_reconcile_failure_at timestamptz;
  v_frozen_at timestamptz;
  v_first_reconcile_at timestamptz;
  v_reconcile_deadline timestamptz;
  v_implementation_matches boolean;
  v_leagues jsonb;
  v_archive jsonb;
  v_recent jsonb;
  v_collector_state jsonb;
  v_recorder_state jsonb;
  v_reconcile_state jsonb;
  v_stages jsonb;
  v_attention jsonb := '[]'::jsonb;
  v_collector_complete integer;
  v_collector_records bigint;
  v_collector_failed boolean;
  v_recorder_complete integer;
  v_recorder_records bigint;
  v_recorder_failed boolean;
  v_recorder_mode text;
  v_observations bigint;
  v_entry jsonb;
  v_stage record;
  v_reason text;
BEGIN
  IF p_now IS NULL THEN RAISE EXCEPTION 'invalid_status_clock' USING ERRCODE='22023'; END IF;
  v_times:=gerball_status_private.schedule_times(p_now);
  v_day:=(v_times->>'uk_date')::date;
  v_season:=to_char(v_day-interval '6 months','YY')||to_char(v_day+interval '6 months','YY');
  v_jobs:=gerball_status_private.scheduler_metadata(p_now);
  SELECT value INTO v_collector_job FROM jsonb_array_elements(v_jobs) WHERE value->>'key'='collector';
  SELECT value INTO v_recorder_job FROM jsonb_array_elements(v_jobs) WHERE value->>'key'='recorder';
  SELECT value INTO v_reconcile_job FROM jsonb_array_elements(v_jobs) WHERE value->>'key'='reconciliation';

  -- A mutable run that was updated after the requested clock cannot be used as
  -- evidence of an earlier completion. The last known start is still visible.
  SELECT CASE WHEN r.updated_at>p_now OR r.completed_at>p_now THEN 'running' ELSE r.status END AS status,
    CASE WHEN r.updated_at<=p_now THEN r.manual END AS manual,
    CASE WHEN r.updated_at<=p_now THEN r.updated_at ELSE r.started_at END AS activity_at
  INTO v_parent FROM public.gerball_odds_runs r WHERE r.collection_date=v_day AND r.started_at<=p_now;
  SELECT max(CASE WHEN updated_at<=p_now THEN updated_at ELSE started_at END),
    max(completed_at) FILTER (WHERE status='completed' AND completed_at<=p_now AND updated_at<=p_now)
  INTO v_collection_last_activity,v_collection_last_success FROM public.gerball_odds_runs WHERE started_at<=p_now;

  SELECT r.recorded_at,r.details INTO v_capture FROM gerball_tracking_private.operation_runs r
    WHERE r.operation='capture' AND r.operation_date=v_day AND r.recorded_at<=p_now
    ORDER BY r.recorded_at DESC,r.id DESC LIMIT 1;
  SELECT max(recorded_at),max(recorded_at) FILTER (WHERE details->>'status'='complete')
    INTO v_capture_last_activity,v_capture_last_success FROM gerball_tracking_private.operation_runs
    WHERE operation='capture' AND recorded_at<=p_now;
  SELECT r.recorded_at,
    CASE WHEN r.details->>'checked' ~ '^[0-9]{1,9}$' THEN (r.details->>'checked')::integer END AS checked,
    CASE WHEN r.details->>'appended' ~ '^[0-9]{1,9}$' THEN (r.details->>'appended')::integer END AS appended
  INTO v_reconcile FROM gerball_tracking_private.operation_runs r
    WHERE r.operation='reconcile' AND r.details->>'status'='complete' AND r.recorded_at<=p_now
    ORDER BY r.recorded_at DESC,r.id DESC LIMIT 1;
  SELECT max(recorded_at),max(recorded_at) FILTER (WHERE details->>'status' IN ('failed','error','partial'))
    INTO v_reconcile_last_activity,v_reconcile_failure_at FROM gerball_tracking_private.operation_runs
    WHERE operation='reconcile' AND recorded_at<=p_now;
  SELECT r.frozen_at,r.implementation_sha256=encode(extensions.digest(
    pg_get_functiondef('public.gerball_strategy_screen(text,integer)'::regprocedure)||E'\n'||
      pg_get_functiondef('public.gerball_upcoming_data(text,integer,text)'::regprocedure),'sha256'),'hex')
  INTO v_frozen_at,v_implementation_matches FROM gerball_tracking_private.rule_versions r
    WHERE r.version='ppg_last5_dates_050_v1';
  v_first_reconcile_at:=(date_trunc('hour',v_frozen_at AT TIME ZONE 'UTC')+interval '30 minutes') AT TIME ZONE 'UTC';
  IF v_first_reconcile_at<=v_frozen_at THEN v_first_reconcile_at:=v_first_reconcile_at+interval '1 hour'; END IF;
  v_reconcile_deadline:=COALESCE(v_reconcile.recorded_at+interval '90 minutes',v_first_reconcile_at+interval '5 minutes');

  -- Aggregate each season first, so exact season counts do not require a large
  -- DISTINCT aggregate. The final config join keeps public coverage at 21 leagues.
  WITH config AS MATERIALIZED (SELECT * FROM gerball_status_private.leagues()),
  archive_seasons AS MATERIALIZED (
    SELECT m.league,m.season,count(*) AS matches,
      count(*) FILTER (WHERE m.home_goals>=0 AND m.away_goals>=0 AND m.full_time_result=
        CASE WHEN m.home_goals>m.away_goals THEN 'H' WHEN m.home_goals<m.away_goals THEN 'A' ELSE 'D' END) AS scored_matches,
      min(m.match_date) AS first_match_date,max(m.match_date) AS last_match_date
    FROM public.matches m
    WHERE m.match_date<=v_day AND m.imported_at<=p_now GROUP BY m.league,m.season
  ), archive AS MATERIALIZED (
    SELECT league,sum(matches)::bigint AS matches,sum(scored_matches)::bigint AS scored_matches,
      count(*) FILTER (WHERE season IS NOT NULL) AS seasons,
      COALESCE(sum(matches) FILTER (WHERE season=v_season),0)::bigint AS current_season_matches,
      min(first_match_date) AS first_match_date,max(last_match_date) AS last_match_date,
      max(last_match_date) FILTER (WHERE season=v_season) AS current_season_last_match_date
    FROM archive_seasons GROUP BY league
  ), counts AS MATERIALIZED (
    SELECT o.league_code,count(*) AS observations,
      count(*) FILTER (WHERE r.status='settled') AS settled,
      count(*) FILTER (WHERE r.status IS NULL OR r.status='pending') AS pending,
      count(*) FILTER (WHERE r.status='review') AS review,max(r.recorded_at) AS last_result_at
    FROM gerball_tracking_private.observations o
    JOIN gerball_tracking_private.cohorts c ON c.id=o.cohort_id
    LEFT JOIN LATERAL (
      SELECT status,recorded_at FROM gerball_tracking_private.result_revisions
      WHERE observation_id=o.id AND recorded_at<=p_now ORDER BY revision DESC LIMIT 1
    ) r ON true
    WHERE o.rule_version='ppg_last5_dates_050_v1' AND c.captured_at<=p_now AND o.recorded_at<=p_now
    GROUP BY o.league_code
  ), rows AS (
    SELECT cfg.*,a.matches,a.scored_matches,a.seasons,a.current_season_matches,a.first_match_date,a.last_match_date,a.current_season_last_match_date,
      l.status AS collection_status,l.collection_date,l.checked_at,l.event_count,l.records_collected,
      c.id AS cohort_id,c.capture_date,c.captured_at,c.fixture_count,c.mode,
      r.observations,r.settled,r.pending,r.review,r.last_result_at,
      CASE WHEN c.id IS NOT NULL THEN 'recorded'
        WHEN e.entry->>'status' IN ('error','implementation_changed') THEN e.entry->>'status'
        WHEN l.status IN ('completed','inactive') THEN 'pending_capture' ELSE 'waiting_for_collection' END AS recording_status
    FROM config cfg LEFT JOIN archive a ON a.league=cfg.code
    LEFT JOIN public.gerball_odds_league_runs l ON l.sport_key=cfg.sport_key AND l.collection_date=v_day AND l.checked_at<=p_now
    LEFT JOIN gerball_tracking_private.cohorts c ON c.rule_version='ppg_last5_dates_050_v1'
      AND c.league_code=cfg.code AND c.capture_date=v_day AND c.captured_at<=p_now
    LEFT JOIN counts r ON r.league_code=cfg.code
    LEFT JOIN LATERAL (SELECT value AS entry FROM jsonb_array_elements(v_capture.details->'leagues')
      WHERE value->>'league_code'=cfg.code LIMIT 1) e ON true
  )
  SELECT jsonb_agg(jsonb_build_object('code',r.code,'name',r.name,'country',r.country,'odds_feed',r.sport_key IS NOT NULL,
    'archive',jsonb_build_object('matches',COALESCE(r.matches,0),'scored_matches',COALESCE(r.scored_matches,0),
      'seasons',COALESCE(r.seasons,0),'current_season_matches',COALESCE(r.current_season_matches,0),
      'first_match_date',r.first_match_date,'last_match_date',r.last_match_date,'current_season_last_match_date',r.current_season_last_match_date),
    'collection',jsonb_build_object('state',CASE WHEN r.sport_key IS NULL THEN 'not_configured' ELSE
      gerball_status_private.stage_state('collector',p_now,v_healthy_job,jsonb_build_object(
        'scheduled_at',v_times->'collector_at','deadline_at',v_times->'collector_deadline',
        'complete',r.collection_status IN ('completed','inactive'),'failed',r.collection_status='failed',
        'completed_leagues',CASE WHEN r.collection_status IN ('completed','inactive') THEN 1 ELSE 0 END,
        'evidence_at',r.checked_at))->>'state' END,
      'status',CASE WHEN r.sport_key IS NULL THEN 'not_supported' ELSE r.collection_status END,
      'collection_date',r.collection_date,'checked_at',r.checked_at,'fixtures',COALESCE(r.event_count,0),
      'records',COALESCE(r.records_collected,0),'manual',CASE WHEN r.sport_key IS NOT NULL AND r.collection_date IS NOT NULL THEN v_parent.manual END),
    'recording',jsonb_build_object('state',CASE WHEN r.sport_key IS NULL THEN 'not_configured' ELSE
      gerball_status_private.stage_state('recorder',p_now,v_healthy_job,jsonb_build_object(
        'scheduled_at',v_times->'recorder_at','deadline_at',v_times->'recorder_deadline','complete',r.cohort_id IS NOT NULL,
        'failed',r.recording_status='error','completed_leagues',CASE WHEN r.cohort_id IS NOT NULL THEN 1 ELSE 0 END,
        'upstream_ready',r.collection_status IN ('completed','inactive'),
        'implementation_matches',CASE WHEN r.recording_status='implementation_changed' THEN false ELSE true END,
        'evidence_at',r.captured_at))->>'state' END,
      'status',CASE WHEN r.sport_key IS NULL THEN 'not_supported' ELSE r.recording_status END,
      'capture_date',r.capture_date,'captured_at',r.captured_at,'fixtures',COALESCE(r.fixture_count,0),'mode',r.mode),
    'results',jsonb_build_object('basis','recorded_observations','observations',COALESCE(r.observations,0),
      'settled',COALESCE(r.settled,0),'pending',COALESCE(r.pending,0),'review',COALESCE(r.review,0),'last_result_at',r.last_result_at)
  ) ORDER BY r.code) INTO v_leagues FROM rows r;

  SELECT jsonb_build_object('total_matches',sum((l#>>'{archive,matches}')::bigint),
    'scored_matches',sum((l#>>'{archive,scored_matches}')::bigint),
    'current_season_matches',sum((l#>>'{archive,current_season_matches}')::bigint),
    'current_season_leagues',count(*) FILTER (WHERE (l#>>'{archive,current_season_matches}')::bigint>0),'league_count',21,
    'first_match_date',min((l#>>'{archive,first_match_date}')::date),'last_match_date',max((l#>>'{archive,last_match_date}')::date),
    'import_schedule',jsonb_build_object('cron','15 8 * * 1,5','timezone','UTC','next_run_at',v_times->'import_next',
      'source','repository_declared','run_audit_available',false,'last_successful_run_at',NULL,
      'target_season','2627','matches_current_season',v_season='2627')) INTO v_archive
  FROM jsonb_array_elements(v_leagues) l;
  SELECT count(*) FILTER (WHERE l#>>'{collection,state}'='complete'),
    COALESCE(sum((l#>>'{collection,records}')::bigint),0),COALESCE(bool_or(l#>>'{collection,status}'='failed'),false),
    count(*) FILTER (WHERE l#>>'{recording,status}'='recorded'),COALESCE(sum((l#>>'{recording,fixtures}')::bigint),0),
    COALESCE(bool_or(l#>>'{recording,status}'='error'),false),
    CASE WHEN count(DISTINCT l#>>'{recording,mode}')>1 THEN 'mixed' ELSE max(l#>>'{recording,mode}') END,
    COALESCE(sum((l#>>'{results,observations}')::bigint),0)
  INTO v_collector_complete,v_collector_records,v_collector_failed,v_recorder_complete,v_recorder_records,
    v_recorder_failed,v_recorder_mode,v_observations FROM jsonb_array_elements(v_leagues) l WHERE l->>'odds_feed'='true';

  v_collector_state:=gerball_status_private.stage_state('collector',p_now,v_collector_job,jsonb_build_object(
    'scheduled_at',v_times->'collector_at','deadline_at',v_times->'collector_deadline',
    'last_success_at',v_collection_last_success,'complete',v_collector_complete=18 AND v_parent.status='completed',
    'failed',v_collector_failed OR v_parent.status='failed','completed_leagues',v_collector_complete,'evidence_at',v_parent.activity_at));
  v_recorder_state:=gerball_status_private.stage_state('recorder',p_now,v_recorder_job,jsonb_build_object(
    'scheduled_at',v_times->'recorder_at','deadline_at',v_times->'recorder_deadline','last_success_at',v_capture_last_success,
    'complete',v_recorder_complete=18,'failed',v_recorder_failed OR v_capture.details->>'status'='failed',
    'completed_leagues',v_recorder_complete,'upstream_ready',v_collector_complete=18 AND v_parent.status='completed',
    'implementation_matches',COALESCE(v_implementation_matches,false),'evidence_at',v_capture.recorded_at));
  v_reconcile_state:=gerball_status_private.stage_state('reconciliation',p_now,v_reconcile_job,jsonb_build_object(
    'scheduled_at',v_first_reconcile_at,'deadline_at',v_reconcile_deadline,'last_success_at',v_reconcile.recorded_at,
    'failed',v_reconcile_failure_at IS NOT NULL AND (v_reconcile.recorded_at IS NULL OR v_reconcile_failure_at>v_reconcile.recorded_at)));
  v_stages:=jsonb_build_object(
    'collector',v_collector_state||jsonb_build_object('today_scheduled_at',v_times->'collector_at',
      'deadline_at',v_times->'collector_deadline','next_run_at',v_collector_job->'next_run_at',
      'last_activity_at',greatest(v_collection_last_activity,COALESCE((v_collector_job#>>'{last_run,finished_at}')::timestamptz,
        (v_collector_job#>>'{last_run,started_at}')::timestamptz)),'last_success_at',v_collection_last_success,
      'today_status',v_parent.status,'completed_leagues',v_collector_complete,'expected_leagues',18,'records',v_collector_records,
      'mode',CASE WHEN v_parent.manual THEN 'manual' WHEN v_parent.manual=false THEN 'scheduled' END),
    'recorder',v_recorder_state||jsonb_build_object('today_scheduled_at',v_times->'recorder_at',
      'deadline_at',v_times->'recorder_deadline','next_run_at',v_recorder_job->'next_run_at',
      'last_activity_at',greatest(v_capture_last_activity,COALESCE((v_recorder_job#>>'{last_run,finished_at}')::timestamptz,
        (v_recorder_job#>>'{last_run,started_at}')::timestamptz)),'last_success_at',v_capture_last_success,
      'today_status',CASE WHEN v_recorder_complete=18 THEN 'complete'
        WHEN v_capture.details->>'status' IN ('complete','partial','failed') THEN v_capture.details->>'status' END,
      'completed_leagues',v_recorder_complete,'expected_leagues',18,'records',v_recorder_records,'mode',v_recorder_mode),
    'reconciliation',v_reconcile_state||jsonb_build_object('today_scheduled_at',v_first_reconcile_at,
      'deadline_at',v_reconcile_deadline,'next_run_at',v_reconcile_job->'next_run_at',
      'last_activity_at',greatest(v_reconcile_last_activity,COALESCE((v_reconcile_job#>>'{last_run,finished_at}')::timestamptz,
        (v_reconcile_job#>>'{last_run,started_at}')::timestamptz)),'last_success_at',v_reconcile.recorded_at,
      'today_status',CASE WHEN (v_reconcile.recorded_at AT TIME ZONE 'Europe/London')::date=v_day THEN 'complete' END,
      'completed_leagues',NULL,'expected_leagues',NULL,'records',v_observations,'mode',NULL,
      'stale_after_minutes',90,'checked',v_reconcile.checked,'appended',v_reconcile.appended));

  WITH actual_days AS (
    SELECT collection_date AS day FROM public.gerball_odds_runs WHERE started_at<=p_now
    UNION SELECT capture_date FROM gerball_tracking_private.cohorts
      WHERE rule_version='ppg_last5_dates_050_v1' AND captured_at<=p_now
  ), recent AS (SELECT day FROM actual_days WHERE day BETWEEN v_day-6 AND v_day ORDER BY day DESC LIMIT 7)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('date',d.day,
    'collection',jsonb_build_object('status',CASE WHEN r.updated_at>p_now OR r.completed_at>p_now THEN 'running' ELSE r.status END,
      'completed_leagues',l.completed_leagues,'expected_leagues',18,'records',l.records,
      'manual',CASE WHEN r.updated_at<=p_now THEN r.manual END,
      'last_activity_at',CASE WHEN r.updated_at<=p_now THEN r.updated_at ELSE r.started_at END),
    'recording',jsonb_build_object('completed_leagues',c.completed_leagues,'fixtures',c.fixtures,'mode',c.mode,'last_activity_at',c.captured_at)
  ) ORDER BY d.day DESC),'[]'::jsonb) INTO v_recent
  FROM recent d LEFT JOIN public.gerball_odds_runs r ON r.collection_date=d.day AND r.started_at<=p_now
  LEFT JOIN LATERAL (
    SELECT count(*) FILTER (WHERE x.status IN ('completed','inactive')) AS completed_leagues,
      COALESCE(sum(x.records_collected),0) AS records
    FROM public.gerball_odds_league_runs x JOIN gerball_status_private.leagues() cfg ON cfg.sport_key=x.sport_key
    WHERE x.collection_date=d.day AND x.checked_at<=p_now
  ) l ON true
  LEFT JOIN LATERAL (
    SELECT count(*) AS completed_leagues,COALESCE(sum(fixture_count),0) AS fixtures,max(captured_at) AS captured_at,
      CASE WHEN count(DISTINCT mode)>1 THEN 'mixed' ELSE max(mode) END AS mode
    FROM gerball_tracking_private.cohorts WHERE rule_version='ppg_last5_dates_050_v1' AND capture_date=d.day AND captured_at<=p_now
  ) c ON true;

  FOR v_stage IN SELECT key,value FROM jsonb_each(v_stages) LOOP
    IF v_stage.value->>'state'='attention' THEN
      v_attention:=v_attention||jsonb_build_array(jsonb_build_object('code',v_stage.value->>'reason_code',
        'stage',v_stage.key,'league_code',NULL,'severity','error'));
    END IF;
  END LOOP;
  IF v_season<>'2627' THEN
    v_attention:=v_attention||jsonb_build_array(jsonb_build_object('code','import_target_season_mismatch',
      'stage','archive','league_code',NULL,'severity','warning'));
  END IF;
  FOR v_entry IN SELECT value FROM jsonb_array_elements(v_leagues) LOOP
    IF (v_entry#>>'{archive,current_season_matches}')::bigint=0 THEN
      v_attention:=v_attention||jsonb_build_array(jsonb_build_object('code','archive_current_season_missing',
        'stage','archive','league_code',v_entry->>'code','severity','warning'));
    END IF;
    IF v_entry#>>'{collection,state}'='attention' THEN
      v_reason:=CASE WHEN v_entry#>>'{collection,status}'='failed' THEN 'collection_failed' ELSE 'collection_overdue' END;
      v_attention:=v_attention||jsonb_build_array(jsonb_build_object('code',v_reason,
        'stage','collector','league_code',v_entry->>'code','severity','warning'));
    END IF;
    IF v_entry#>>'{recording,state}'='attention' THEN
      v_reason:=CASE v_entry#>>'{recording,status}' WHEN 'error' THEN 'recording_failed'
        WHEN 'implementation_changed' THEN 'rule_implementation_changed' ELSE 'recording_overdue' END;
      v_attention:=v_attention||jsonb_build_array(jsonb_build_object('code',v_reason,
        'stage','recorder','league_code',v_entry->>'code','severity','warning'));
    END IF;
    IF (v_entry#>>'{results,review}')::bigint>0 THEN
      v_attention:=v_attention||jsonb_build_array(jsonb_build_object('code','result_review_required',
        'stage','reconciliation','league_code',v_entry->>'code','severity','warning'));
    END IF;
  END LOOP;
  RETURN jsonb_build_object('status','ok','version','data_status_v1','generated_at',p_now,
    'timezone','Europe/London','uk_date',v_day,'current_season',v_season,
    'archive',v_archive,'stages',v_stages,'jobs',v_jobs,'leagues',v_leagues,'recent_days',v_recent,'attention',v_attention);
END
$function$;

CREATE FUNCTION public.gerball_data_status()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $function$
  SELECT gerball_status_private.build_snapshot(statement_timestamp());
$function$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gerball_status_private FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA gerball_status_private TO service_role;
REVOKE ALL ON FUNCTION public.gerball_data_status() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gerball_data_status() TO service_role;
NOTIFY pgrst,'reload schema';
