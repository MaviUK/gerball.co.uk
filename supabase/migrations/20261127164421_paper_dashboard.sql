-- Aggregate the entire saved paper ledger before paginating the displayed bets.
-- This is a read-only report. No predictions, prices, settlements or schedules change.
-- Eligibility matches the deployed latest-pre-kickoff paper reports; future UK
-- match dates and provisional scores are deliberately outside these totals.
CREATE OR REPLACE FUNCTION public.gerball_paper_dashboard(
 p_model text, p_month date, p_date date DEFAULT NULL,
 p_query text DEFAULT '', p_limit integer DEFAULT 100, p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO ''
AS $function$
DECLARE
 today_uk date := (statement_timestamp() AT TIME ZONE 'Europe/London')::date;
 next_month date;
 needle text := lower(trim(coalesce(p_query,'')));
 output jsonb;
BEGIN
 IF p_model IS NULL OR p_model NOT IN ('odds','reverse','extra')
 OR p_month IS NULL OR NOT isfinite(p_month) OR p_month < date '0001-01-01'
 OR extract(day FROM p_month) <> 1
 OR p_month > date_trunc('month',today_uk)::date
 OR p_date IS NOT NULL AND (NOT isfinite(p_date) OR p_date < p_month
   OR p_date >= (p_month+interval '1 month')::date OR p_date > today_uk)
 OR char_length(needle)>100 OR needle ~ '[[:cntrl:]]'
 OR p_limit IS NULL OR p_limit<1 OR p_limit>250
 OR p_offset IS NULL OR p_offset<0 OR p_offset>1000000 THEN
  RAISE EXCEPTION 'invalid_paper_dashboard_parameters' USING ERRCODE='22023';
 END IF;
 next_month := (p_month+interval '1 month')::date;

 WITH regular_base AS MATERIALIZED (
  SELECT b.*,coalesce(r.status,'pending') AS result_status,
   r.revision,r.recorded_at AS result_recorded_at,r.full_time_result,
   r.home_goals,r.away_goals,r.match_id,r.imported_at,r.correction_reason
  FROM gerball_advice_private.paper_bets b
  LEFT JOIN LATERAL (
   SELECT status,revision,recorded_at,full_time_result,home_goals,away_goals,
    match_id,imported_at,correction_reason
   FROM gerball_tracking_private.result_revisions
   WHERE observation_id=b.observation_id ORDER BY revision DESC LIMIT 1
  ) r ON true
  WHERE p_model IN ('odds','reverse')
   AND (p_model='odds' OR b.market IN ('H','A'))
   AND b.fixture_date<=today_uk
   AND b.kickoff_at<((today_uk+1)::timestamp AT TIME ZONE 'Europe/London')
   AND b.recorded_at<b.kickoff_at
   AND NOT EXISTS (
    SELECT 1 FROM gerball_advice_private.paper_bets newer_b
    WHERE newer_b.event_id=b.event_id AND newer_b.kickoff_at=b.kickoff_at
     AND newer_b.model_version=b.model_version AND newer_b.recorded_at<newer_b.kickoff_at
     AND (newer_b.recorded_at>b.recorded_at OR
      (newer_b.recorded_at=b.recorded_at AND newer_b.id>b.id))
   )
 ), regular_prices AS (
  SELECT b.*,
   CASE WHEN p_model='reverse' THEN CASE b.market WHEN 'H' THEN 'A' ELSE 'H' END
    ELSE b.market END AS selection,
   CASE WHEN p_model='reverse' THEN q.decimal_odds ELSE b.odds END AS effective_odds,
   CASE WHEN p_model='reverse' THEN q.bookmaker_name ELSE b.bookmaker_name END AS effective_bookmaker,
   CASE WHEN p_model='reverse' THEN q.collected_at ELSE b.quote_collected_at END AS effective_capture,
   CASE WHEN p_model='reverse' AND q.decimal_odds IS NULL THEN 'odds_unavailable'
    ELSE b.result_status END AS stage
  FROM regular_base b
  LEFT JOIN LATERAL (
   SELECT o.decimal_odds,o.bookmaker_name,o.collected_at
   FROM public.gerball_odds_snapshots o
   WHERE p_model='reverse' AND o.event_id=b.event_id AND o.market='h2h'
    AND o.selection=(CASE b.market WHEN 'H' THEN 'A' ELSE 'H' END)
    AND o.decimal_odds>1
    AND o.collection_date=(b.recorded_at AT TIME ZONE 'Europe/London')::date
    AND o.collected_at<=b.recorded_at AND o.collected_at<b.kickoff_at
    AND (o.source_updated_at IS NULL OR o.source_updated_at<=b.recorded_at)
   ORDER BY o.decimal_odds DESC,o.collected_at DESC,o.id DESC LIMIT 1
  ) q ON true
 ), regular_scored AS (
  SELECT b.*,
   CASE WHEN b.stage='settled' THEN CASE b.selection
    WHEN 'H' THEN b.full_time_result='H' WHEN 'D' THEN b.full_time_result='D'
    WHEN 'A' THEN b.full_time_result='A' WHEN 'O25' THEN b.home_goals+b.away_goals>2
    WHEN 'U25' THEN b.home_goals+b.away_goals<3 END ELSE NULL END AS won
  FROM regular_prices b
 ), extra_base AS MATERIALIZED (
  SELECT b.*,r.full_time_result,r.home_goals,r.away_goals,
   CASE WHEN r.status='settled' AND r.match_id IS NOT NULL AND m.id IS NOT NULL
     AND (b.market_key='btts' OR m.source_data->>'HTR' IN ('H','D','A')) THEN 'settled'
    WHEN r.status='review' THEN 'review' ELSE 'pending' END AS stage,
   m.source_data
  FROM gerball_extra_private.paper_bets b
  LEFT JOIN LATERAL (
   SELECT status,match_id,full_time_result,home_goals,away_goals
   FROM gerball_tracking_private.result_revisions
   WHERE observation_id=b.observation_id ORDER BY revision DESC LIMIT 1
  ) r ON true
  LEFT JOIN public.matches m ON m.id=r.match_id
  WHERE p_model='extra' AND b.fixture_date<=today_uk
   AND b.kickoff_at<((today_uk+1)::timestamp AT TIME ZONE 'Europe/London')
   AND b.recorded_at<b.kickoff_at
   AND NOT EXISTS (
    SELECT 1 FROM gerball_extra_private.paper_bets newer_b
    WHERE newer_b.event_id=b.event_id AND newer_b.kickoff_at=b.kickoff_at
     AND newer_b.model_version=b.model_version
     AND newer_b.market_key=b.market_key AND newer_b.outcome_code=b.outcome_code
     AND newer_b.recorded_at<newer_b.kickoff_at
     AND (newer_b.recorded_at>b.recorded_at OR
      (newer_b.recorded_at=b.recorded_at AND newer_b.id>b.id))
   )
 ), extra_scored AS (
  SELECT b.*,
   CASE WHEN b.stage='settled' THEN CASE b.market_key
    WHEN 'h2h_3_way_h1' THEN (b.source_data->>'HTR')=b.outcome_code
    WHEN 'halftime_fulltime' THEN ((b.source_data->>'HTR')||b.full_time_result)=b.outcome_code
    WHEN 'btts' THEN (b.home_goals>0 AND b.away_goals>0)=(b.outcome_code='Yes')
   END ELSE NULL END AS won
  FROM extra_base b
 ), source_rows AS (
  SELECT b.id,b.kickoff_at,(b.kickoff_at AT TIME ZONE 'Europe/London')::date AS day,
   b.recommended_units AS units,b.effective_odds AS odds,b.stage AS status,b.won,
   lower(concat_ws(' ',b.home_team,b.away_team,b.league_code,b.effective_bookmaker,
    b.selection,b.stage,CASE WHEN b.won THEN 'won win' WHEN b.won IS FALSE THEN 'lost loss' END,
    CASE b.selection WHEN 'H' THEN 'home win' WHEN 'D' THEN 'draw' WHEN 'A' THEN 'away win'
     WHEN 'O25' THEN 'over 2.5 goals' WHEN 'U25' THEN 'under 2.5 goals' END,
    (b.kickoff_at AT TIME ZONE 'Europe/London')::date::text)) AS search_text,
   jsonb_build_object(
    'id',b.id,'original_id',CASE WHEN p_model='reverse' THEN b.id END,
    'event_id',b.event_id,'observation_id',b.observation_id,'model_version',b.model_version,
    'home',b.home_team,'away',b.away_team,'league',b.league_code,'season',b.season,
    'fixture_date',b.fixture_date,'kickoff_at',b.kickoff_at,'recorded_at',b.recorded_at,
    'market',b.selection,'original_market',CASE WHEN p_model='reverse' THEN b.market END,
    'odds',b.effective_odds,'bookmaker',b.effective_bookmaker,'units',b.recommended_units,
    'quote_collected_at',b.effective_capture,'odds_captured_at',b.effective_capture,
    'model_probability',CASE WHEN p_model='odds' THEN b.model_probability END,
    'estimated_edge',CASE WHEN p_model='odds' THEN b.estimated_edge END,
    'revision',b.revision,'result_recorded_at',b.result_recorded_at,
    'home_goals',b.home_goals,'away_goals',b.away_goals,'result',b.full_time_result,
    'match_id',b.match_id,'imported_at',b.imported_at,'correction_reason',b.correction_reason
   ) AS record
  FROM regular_scored b
  UNION ALL
  SELECT b.id,b.kickoff_at,(b.kickoff_at AT TIME ZONE 'Europe/London')::date,
   b.units,b.decimal_odds,b.stage,b.won,
   lower(concat_ws(' ',b.home_team,b.away_team,b.league_code,b.bookmaker_name,
    b.market_key,b.outcome_name,b.outcome_code,b.stage,
    CASE WHEN b.won THEN 'won win' WHEN b.won IS FALSE THEN 'lost loss' END,
    CASE b.market_key WHEN 'h2h_3_way_h1' THEN 'half time result'
     WHEN 'halftime_fulltime' THEN 'half time full time' WHEN 'btts' THEN 'both teams to score' END,
    (b.kickoff_at AT TIME ZONE 'Europe/London')::date::text)),
   jsonb_build_object(
    'id',b.id,'event_id',b.event_id,'model_version',b.model_version,
    'home',b.home_team,'away',b.away_team,'league',b.league_code,
    'fixture_date',b.fixture_date,'kickoff_at',b.kickoff_at,'recorded_at',b.recorded_at,
    'market',b.market_key,'outcome',b.outcome_name,'code',b.outcome_code,
    'odds',b.decimal_odds,'bookmaker',b.bookmaker_name,'units',b.units,
    'odds_collected_at',b.odds_collected_at,'model_probability',b.model_probability,
    'estimated_edge',b.estimated_edge,'home_goals',b.home_goals,'away_goals',b.away_goals,
    'result',b.full_time_result,
    'score',CASE WHEN b.stage='settled' THEN b.home_goals::text||'-'||b.away_goals::text END
   )
  FROM extra_scored b
 ), calculated AS MATERIALIZED (
  SELECT s.*,CASE WHEN s.status='settled' THEN
   CASE WHEN s.won THEN round(s.units*(s.odds-1),2) ELSE -s.units END
   ELSE NULL END AS net_units
  FROM source_rows s
 ), period_rows AS (
  SELECT p.period,c.* FROM (VALUES ('overall'),('month'),('selected')) p(period)
  LEFT JOIN calculated c ON p.period='overall'
   OR (p.period='month' AND c.day>=p_month AND c.day<next_month)
   OR (p.period='selected' AND c.day=p_date)
 ), counts AS (
  SELECT p.period,NULL::date AS day,
   count(p.id) FILTER(WHERE p.status<>'odds_unavailable')::integer AS bets,
   count(p.id) FILTER(WHERE p.status='settled')::integer AS settled,
   count(p.id) FILTER(WHERE p.won IS TRUE)::integer AS won,
   count(p.id) FILTER(WHERE p.won IS FALSE)::integer AS lost,
   count(p.id) FILTER(WHERE p.status='pending')::integer AS pending,
   count(p.id) FILTER(WHERE p.status='review')::integer AS review,
   count(p.id) FILTER(WHERE p.status='odds_unavailable')::integer AS missing_odds,
   coalesce(sum(p.units) FILTER(WHERE p.status<>'odds_unavailable'),0)::numeric AS units,
   coalesce(sum(p.units) FILTER(WHERE p.status='settled'),0)::numeric AS units_settled,
   coalesce(round(sum(p.net_units),2),0)::numeric AS net_units
  FROM period_rows p GROUP BY p.period
  UNION ALL
  SELECT 'daily',c.day,
   count(*) FILTER(WHERE c.status<>'odds_unavailable')::integer,
   count(*) FILTER(WHERE c.status='settled')::integer,
   count(*) FILTER(WHERE c.won IS TRUE)::integer,
   count(*) FILTER(WHERE c.won IS FALSE)::integer,
   count(*) FILTER(WHERE c.status='pending')::integer,
   count(*) FILTER(WHERE c.status='review')::integer,
   count(*) FILTER(WHERE c.status='odds_unavailable')::integer,
   coalesce(sum(c.units) FILTER(WHERE c.status<>'odds_unavailable'),0)::numeric,
   coalesce(sum(c.units) FILTER(WHERE c.status='settled'),0)::numeric,
   coalesce(round(sum(c.net_units),2),0)::numeric
  FROM calculated c WHERE c.day>=p_month AND c.day<next_month GROUP BY c.day
 ), metrics AS (
  SELECT c.period,c.day,jsonb_build_object(
   'bets',c.bets,'settled',c.settled,'won',c.won,'lost',c.lost,
   'pending',c.pending,'review',c.review,'missing_odds',c.missing_odds,
   'units',c.units,'units_recommended',c.units,'units_settled',c.units_settled,
   'net_units',c.net_units,
   'roi_pct',CASE WHEN c.units_settled>0 THEN round(100*c.net_units/c.units_settled,2) END
  ) AS value FROM counts c
 ), calendar AS (
  SELECT p_month+n AS day FROM generate_series(0,next_month-p_month-1) n
 ), daily AS (
  SELECT d.day,coalesce(m.value,jsonb_build_object(
   'bets',0,'settled',0,'won',0,'lost',0,'pending',0,'review',0,'missing_odds',0,
   'units',0,'units_recommended',0,'units_settled',0,'net_units',0,'roi_pct',NULL
  ))||jsonb_build_object('date',d.day,'is_future',d.day>today_uk) AS value
  FROM calendar d LEFT JOIN metrics m ON m.period='daily' AND m.day=d.day
 ), matching AS MATERIALIZED (
  SELECT c.* FROM calculated c
  WHERE (p_date IS NULL OR c.day=p_date)
   AND (needle='' OR strpos(c.search_text,needle)>0)
 ), page AS (
  SELECT m.* FROM matching m ORDER BY m.kickoff_at DESC,m.id DESC
  LIMIT p_limit OFFSET p_offset
 )
 SELECT jsonb_build_object(
  'version','paper_dashboard_v1','model',p_model,'month',to_char(p_month,'YYYY-MM'),
  'date',p_date,'query',needle,'generated_at',statement_timestamp(),'through_date',today_uk,
  'earliest_date',(SELECT min(day) FROM calculated),
  'summary',(SELECT value FROM metrics WHERE period='overall'),
  'month_summary',(SELECT value FROM metrics WHERE period='month'),
  'day_summary',CASE WHEN p_date IS NOT NULL THEN (SELECT value FROM metrics WHERE period='selected') END,
  'daily',(SELECT jsonb_agg(value ORDER BY day) FROM daily),
  'records',coalesce((SELECT jsonb_agg(record||jsonb_build_object(
   'date',day,'status',status,'won',won,'net_units',net_units
  ) ORDER BY kickoff_at DESC,id DESC) FROM page),'[]'::jsonb),
  'total_records',(SELECT count(*) FROM matching),
  'limit',p_limit,'offset',p_offset
 ) INTO output;
 RETURN output;
END
$function$;

REVOKE ALL ON FUNCTION public.gerball_paper_dashboard(text,date,date,text,integer,integer)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gerball_paper_dashboard(text,date,date,text,integer,integer)
 TO service_role;
NOTIFY pgrst,'reload schema';
