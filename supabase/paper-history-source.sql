-- Read-only history of the original paper selections, grouped by UK kickoff day.
-- Original bets, captured prices and unit stakes remain immutable.
CREATE INDEX IF NOT EXISTS gerball_paper_bets_kickoff_idx
ON gerball_advice_private.paper_bets(kickoff_at,recorded_at DESC,id DESC);

CREATE OR REPLACE FUNCTION public.gerball_paper_day(p_date date, p_query text, p_limit integer DEFAULT 250, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
 needle text:=lower(trim(coalesce(p_query,'')));
 result jsonb;
BEGIN
 IF p_date IS NULL OR NOT isfinite(p_date) OR p_date<date '0001-01-01'
 OR p_date>(statement_timestamp() AT TIME ZONE 'Europe/London')::date
 OR char_length(needle)>100 OR needle ~ '[[:cntrl:]]'
 OR p_limit IS NULL OR p_limit<1 OR p_limit>1000
 OR p_offset IS NULL OR p_offset<0 OR p_offset>50000 THEN
  RAISE EXCEPTION 'invalid_paper_day_parameters' USING ERRCODE='22023';
 END IF;

 WITH matching AS MATERIALIZED (
  SELECT b.*,coalesce(r.status,'pending') AS result_status,
   r.revision,r.recorded_at AS result_recorded_at,r.full_time_result,r.home_goals,r.away_goals,
   r.match_id,r.imported_at,r.correction_reason,
   CASE WHEN r.status='settled' THEN
    CASE b.market
     WHEN 'H' THEN r.full_time_result='H'
     WHEN 'D' THEN r.full_time_result='D'
     WHEN 'A' THEN r.full_time_result='A'
     WHEN 'O25' THEN r.home_goals+r.away_goals>2
     WHEN 'U25' THEN r.home_goals+r.away_goals<3
    END
   ELSE NULL END AS won
  FROM gerball_advice_private.paper_bets b
  LEFT JOIN LATERAL (
   SELECT status,revision,recorded_at,full_time_result,home_goals,away_goals,
    match_id,imported_at,correction_reason
   FROM gerball_tracking_private.result_revisions
   WHERE observation_id=b.observation_id ORDER BY revision DESC LIMIT 1
  ) r ON true
  -- Convert the two local midnights independently: DST days last 23 or 25 hours.
  -- Leave kickoff_at unwrapped so the date filter can use its B-tree index.
  WHERE (b.recorded_at AT TIME ZONE 'Europe/London')::date = (b.kickoff_at AT TIME ZONE 'Europe/London')::date
   AND b.kickoff_at>=(p_date::timestamp AT TIME ZONE 'Europe/London')
   AND b.kickoff_at<((p_date+1)::timestamp AT TIME ZONE 'Europe/London')
   AND (needle=''
    OR lower(b.home_team) LIKE '%'||needle||'%'
    OR lower(b.away_team) LIKE '%'||needle||'%'
    OR lower(b.league_code) LIKE '%'||needle||'%'
    OR lower(b.bookmaker_name) LIKE '%'||needle||'%'
    OR lower(b.event_id) LIKE '%'||needle||'%'
    OR (CASE b.market WHEN 'H' THEN 'home win' WHEN 'D' THEN 'draw'
     WHEN 'A' THEN 'away win' WHEN 'O25' THEN 'over 2.5 goals'
     WHEN 'U25' THEN 'under 2.5 goals' END) LIKE '%'||needle||'%'
    OR lower(b.market) LIKE '%'||needle||'%'
    OR lower(coalesce(r.status,'pending')) LIKE '%'||needle||'%'
    OR b.fixture_date::text LIKE '%'||needle||'%')
 ), results AS MATERIALIZED (
  SELECT m.*,
   CASE WHEN m.result_status='settled' THEN
    CASE WHEN m.won THEN round(m.recommended_units*(m.odds-1),2)
     ELSE -m.recommended_units END
    ELSE NULL END AS net_units,
   CASE WHEN m.result_status='settled' THEN m.recommended_units ELSE 0 END AS settled_units
  FROM matching m
 ), totals AS (
  SELECT count(*)::integer AS bets,
   count(*) FILTER(WHERE result_status='settled')::integer AS settled,
   count(*) FILTER(WHERE result_status='pending')::integer AS pending,
   count(*) FILTER(WHERE result_status='review')::integer AS review,
   count(*) FILTER(WHERE won IS TRUE)::integer AS won,
   count(*) FILTER(WHERE won IS FALSE)::integer AS lost,
   coalesce(sum(recommended_units),0)::integer AS units_recommended,
   coalesce(sum(settled_units),0)::integer AS units_settled,
   coalesce(round(sum(net_units),2),0) AS net_units
  FROM results
 )
 SELECT jsonb_build_object(
  'version','paper_day_v1','query',needle,'date',p_date,
  'generated_at',statement_timestamp(),
  'total_records',(SELECT bets FROM totals),
  'summary',(SELECT jsonb_build_object(
   'bets',bets,'settled',settled,'pending',pending,'review',review,'won',won,'lost',lost,
   'units_recommended',units_recommended,'units_settled',units_settled,'net_units',net_units,
   'roi_pct',CASE WHEN units_settled>0 THEN round(100*net_units/units_settled,2) ELSE NULL END
  ) FROM totals),
  'records',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'id',id,'model_version',model_version,'event_id',event_id,'observation_id',observation_id,
   'league',league_code,'home',home_team,'away',away_team,'market',market,
   'season',season,'fixture_date',fixture_date,'kickoff_at',kickoff_at,'recorded_at',recorded_at,
   'odds',odds,'bookmaker',bookmaker_name,'bookmaker_key',bookmaker_key,
   'quote_collected_at',quote_collected_at,'quote_updated_at',quote_updated_at,
   'model_probability',model_probability,'estimated_edge',estimated_edge,
   'units',recommended_units,'input',model_snapshot,'status',result_status,
   'revision',revision,'result_recorded_at',result_recorded_at,
   'match_id',match_id,'imported_at',imported_at,'home_goals',home_goals,'away_goals',away_goals,
   'result',full_time_result,'won',won,'net_units',net_units,'correction_reason',correction_reason
  ) ORDER BY recorded_at DESC,id DESC)
   FROM (SELECT * FROM results ORDER BY recorded_at DESC,id DESC LIMIT p_limit OFFSET p_offset) page),
   '[]'::jsonb),'limit',p_limit,'offset',p_offset) INTO result;
 RETURN result;
END
$function$;

REVOKE ALL ON FUNCTION public.gerball_paper_day(date,text,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gerball_paper_day(date,text,integer,integer) TO service_role;

-- Preserve the existing Today endpoint and version, with the new summary added.
CREATE OR REPLACE FUNCTION public.gerball_paper_today(p_query text, p_limit integer DEFAULT 250, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 SELECT public.gerball_paper_day(
  (statement_timestamp() AT TIME ZONE 'Europe/London')::date,p_query,p_limit,p_offset
 ) || jsonb_build_object('version','paper_today_v1')
$function$;
REVOKE ALL ON FUNCTION public.gerball_paper_today(text,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gerball_paper_today(text,integer,integer) TO service_role;
NOTIFY pgrst,'reload schema';
