-- Increment immutable revision numbers whenever a previously saved imported result changes.
CREATE OR REPLACE FUNCTION gerball_tracking_private.reconcile_results()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_row record;
  v_result jsonb;
  v_hash text;
  v_last_hash text;
  v_revision integer;
  v_checked integer := 0;
  v_appended integer := 0;
  v_started_at timestamptz := clock_timestamp();
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('gerball-tracking-reconcile',0)) THEN
    RETURN jsonb_build_object('status','already_running');
  END IF;
  FOR v_row IN
    SELECT o.*, COALESCE(c.candidates,'[]'::jsonb) AS candidates
    FROM gerball_tracking_private.observations AS o
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object('id',m.id,'league',m.league,'season',m.season,
        'match_date',m.match_date,'home_team',m.home_team,'away_team',m.away_team,
        'home_goals',m.home_goals,'away_goals',m.away_goals,'full_time_result',m.full_time_result,
        'source',m.source,'imported_at',m.imported_at) ORDER BY m.id) AS candidates
      FROM public.matches AS m
      WHERE m.league = o.league_code AND m.season = o.season AND m.match_date = o.fixture_date
        AND m.home_team = o.fixture#>>'{home,canonical_name}'
        AND m.away_team = o.fixture#>>'{away,canonical_name}'
    ) AS c ON true
    WHERE o.kickoff_at <= v_started_at - interval '3 hours'
    ORDER BY o.id
  LOOP
    v_checked := v_checked + 1;
    v_result := gerball_tracking_private.evaluate_result(v_row.fixture || jsonb_build_object(
      'season',v_row.season,'fixture_date',v_row.fixture_date,'recorded_at',v_row.recorded_at),v_row.candidates);
    v_hash := encode(extensions.digest((v_result - 'imported_at')::text,'sha256'),'hex');
    SELECT result_sha256,revision INTO v_last_hash,v_revision
      FROM gerball_tracking_private.result_revisions
      WHERE observation_id = v_row.id ORDER BY revision DESC LIMIT 1;
    IF v_last_hash IS DISTINCT FROM v_hash THEN
      INSERT INTO gerball_tracking_private.result_revisions(observation_id,revision,status,reason,
        match_id,source,imported_at,home_goals,away_goals,full_time_result,result_sha256,correction_reason)
      VALUES (v_row.id,coalesce(v_revision,0)+1,v_result->>'status',v_result->>'reason',(v_result->>'match_id')::bigint,
        v_result->>'source',(v_result->>'imported_at')::timestamptz,(v_result->>'home_goals')::integer,
        (v_result->>'away_goals')::integer,v_result->>'full_time_result',v_hash,
        CASE WHEN v_revision IS NOT NULL THEN 'Imported result availability or score changed; the previous revision is retained.' END);
      v_appended := v_appended + 1;
    END IF;
  END LOOP;
  v_result := jsonb_build_object('status','complete','checked',v_checked,'appended',v_appended);
  INSERT INTO gerball_tracking_private.operation_runs(operation,details) VALUES ('reconcile',v_result);
  RETURN v_result;
END
$function$;

-- Read-only settlement health for the saved paper ledger.
CREATE OR REPLACE FUNCTION public.gerball_paper_settlement_health()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
WITH ledger AS MATERIALIZED (
 SELECT b.id,b.observation_id,b.league_code,b.event_id,b.home_team,b.away_team,
 b.fixture_date,b.kickoff_at,b.market,b.recommended_units,
 r.status result_status,r.reason result_reason,r.revision,r.recorded_at result_recorded_at,
 r.imported_at result_imported_at,r.match_id,r.home_goals,r.away_goals,
 r.correction_reason,
 CASE WHEN b.kickoff_at>now() THEN 'upcoming'
      WHEN b.kickoff_at>now()-interval '3 hours' THEN 'in_progress'
      WHEN r.status='settled' THEN 'settled'
      WHEN r.status='review' THEN 'review'
      WHEN r.status='pending' THEN 'awaiting_import'
      ELSE 'awaiting_reconciliation' END AS stage
 FROM gerball_advice_private.paper_bets b
 LEFT JOIN LATERAL (
 SELECT status,reason,revision,recorded_at,imported_at,match_id,
        home_goals,away_goals,correction_reason
 FROM gerball_tracking_private.result_revisions
 WHERE observation_id=b.observation_id
 ORDER BY revision DESC LIMIT 1
 ) r ON true
), stage_totals AS (
 SELECT stage,count(*)::integer bets
 FROM ledger GROUP BY stage
), latest_job AS (
 SELECT recorded_at,details FROM gerball_tracking_private.operation_runs
 WHERE operation='reconcile' ORDER BY recorded_at DESC LIMIT 1
), last_import AS (
 SELECT max(imported_at) AS latest_import
 FROM public.matches WHERE source='football-data.co.uk'
), due AS (
 SELECT *,extract(epoch FROM (now()-kickoff_at))/3600 AS hours_since_kickoff
 FROM ledger
 WHERE kickoff_at<=now()-interval '3 hours' AND stage<>'settled'
 ORDER BY kickoff_at,id LIMIT 40
), revision_stats AS (
 SELECT count(*)::integer total_revisions,
        count(DISTINCT observation_id)::integer observed_fixtures,
        count(DISTINCT observation_id) FILTER (WHERE revision>1)::integer corrected_observations
 FROM gerball_tracking_private.result_revisions
)
SELECT jsonb_build_object(
 'version','paper_settlement_health_v1',
 'generated_at',now(),
 'settlement_delay_hours',3,
 'late_threshold_hours',48,
 'records_total',(SELECT count(*) FROM ledger),
 'stages',coalesce((SELECT jsonb_agg(jsonb_build_object('stage',stage,'bets',bets) ORDER BY stage) FROM stage_totals),'[]'::jsonb),
 'settled',(SELECT count(*) FROM ledger WHERE stage='settled'),
 'review',(SELECT count(*) FROM ledger WHERE stage='review'),
 'pending_after_grace',(SELECT count(*) FROM ledger WHERE stage IN ('awaiting_import','awaiting_reconciliation')),
 'late_over_48_hours',(SELECT count(*) FROM ledger WHERE kickoff_at<now()-interval '48 hours' AND stage IN ('review','awaiting_import','awaiting_reconciliation')),
 'latest_reconcile_at',(SELECT recorded_at FROM latest_job),
 'latest_reconcile',(SELECT details FROM latest_job),
 'latest_results_import_at',(SELECT latest_import FROM last_import),
 'revisions',(SELECT to_jsonb(revision_stats) FROM revision_stats),
 'unsettled_examples',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'paper_id',id,'observation_id',observation_id,'league',league_code,
   'home',home_team,'away',away_team,'market',market,
   'kickoff_at',kickoff_at,'stage',stage,
   'hours_since_kickoff',round(hours_since_kickoff::numeric,1),
   'reason',result_reason,'revision',revision,'result_recorded_at',result_recorded_at
 ) ORDER BY kickoff_at,id) FROM due),'[]'::jsonb)
)
$function$;
REVOKE ALL ON FUNCTION public.gerball_paper_settlement_health() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gerball_paper_settlement_health() TO service_role;
NOTIFY pgrst,'reload schema';
