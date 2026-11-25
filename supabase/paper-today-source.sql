CREATE OR REPLACE FUNCTION public.gerball_paper_today(p_query text, p_limit integer DEFAULT 250, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE needle text:=lower(trim(coalesce(p_query,'')));result jsonb;
BEGIN
 IF char_length(needle)>100 OR p_limit IS NULL OR p_limit<1 OR p_limit>1000
 OR p_offset IS NULL OR p_offset<0 OR p_offset>50000 THEN
 RAISE EXCEPTION 'invalid_search_parameters' USING ERRCODE='22023';END IF;
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
 WHEN 'U25' THEN r.home_goals+r.away_goals<3 END
 ELSE NULL END AS won
 FROM gerball_advice_private.paper_bets b
 LEFT JOIN LATERAL (
 SELECT status,revision,recorded_at,full_time_result,home_goals,away_goals,
 match_id,imported_at,correction_reason
 FROM gerball_tracking_private.result_revisions
 WHERE observation_id=b.observation_id ORDER BY revision DESC LIMIT 1
 ) r ON true
 WHERE (b.kickoff_at AT TIME ZONE 'Europe/London')::date=(now() AT TIME ZONE 'Europe/London')::date
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
 ), results AS (
 SELECT m.*,
 CASE WHEN m.result_status='settled' THEN
 CASE WHEN m.won THEN round(m.recommended_units*(m.odds-1),2)
 ELSE -m.recommended_units END
 ELSE NULL END AS net_units
 FROM matching m
 )
 SELECT jsonb_build_object(
 'version','paper_today_v1','query',needle,'date',(now() AT TIME ZONE 'Europe/London')::date,
 'total_records',(SELECT count(*) FROM results),
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
 'result',full_time_result,'won',won,'net_units',net_units,
 'correction_reason',correction_reason
 ) ORDER BY recorded_at DESC,id DESC)
 FROM (SELECT * FROM results ORDER BY recorded_at DESC,id DESC LIMIT p_limit OFFSET p_offset) page),
 '[]'::jsonb),'limit',p_limit,'offset',p_offset) INTO result;
 RETURN result;
END
$function$;
REVOKE ALL ON FUNCTION public.gerball_paper_today(text,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gerball_paper_today(text,integer,integer) TO service_role;
NOTIFY pgrst,'reload schema';
