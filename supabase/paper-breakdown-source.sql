CREATE OR REPLACE FUNCTION public.gerball_paper_breakdown()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
WITH ledger AS MATERIALIZED (
 SELECT b.id,b.league_code,b.home_team,b.away_team,b.market,b.bookmaker_name,b.kickoff_at,b.fixture_date,b.season,b.recommended_units,b.odds,
 coalesce(r.status,'pending') result_status,
 CASE WHEN r.status='settled' THEN CASE b.market
 WHEN 'H' THEN r.full_time_result='H'
 WHEN 'D' THEN r.full_time_result='D'
 WHEN 'A' THEN r.full_time_result='A'
 WHEN 'O25' THEN r.home_goals+r.away_goals>2
 WHEN 'U25' THEN r.home_goals+r.away_goals<3 END ELSE NULL END won
 FROM gerball_advice_private.paper_bets b
 LEFT JOIN LATERAL (
 SELECT status,full_time_result,home_goals,away_goals
 FROM gerball_tracking_private.result_revisions
 WHERE observation_id=b.observation_id ORDER BY revision DESC LIMIT 1
 ) r ON true
), calculated AS MATERIALIZED (
 SELECT *,
 CASE WHEN result_status='settled' THEN
 CASE WHEN won THEN round(recommended_units*(odds-1),2) ELSE -recommended_units END
 ELSE NULL END net_units
 FROM ledger
), group_rows AS (
 SELECT dim.kind,dim.label,c.id,c.result_status,c.won,c.recommended_units,c.net_units
 FROM calculated c
 CROSS JOIN LATERAL (
 VALUES ('market',c.market),
 ('league',c.league_code),
 ('home_team',c.home_team),
 ('away_team',c.away_team),
 ('bookmaker',c.bookmaker_name),
 ('season',c.season)
 ) dim(kind,label)
), grouped AS (
 SELECT kind,label,count(*)::integer bets,
 count(*) FILTER(WHERE result_status='settled')::integer settled,
 count(*) FILTER(WHERE won IS TRUE)::integer won,
 count(*) FILTER(WHERE won IS FALSE)::integer lost,
 count(*) FILTER(WHERE result_status='pending')::integer pending,
 count(*) FILTER(WHERE result_status='review')::integer review,
 coalesce(sum(recommended_units),0)::integer recommended_units,
 coalesce(sum(recommended_units) FILTER(WHERE result_status='settled'),0)::integer settled_units,
 coalesce(sum(net_units),0)::numeric net_units
 FROM group_rows GROUP BY kind,label
), entries AS (
 SELECT kind,label,bets,settled,won,lost,pending,review,recommended_units,settled_units,
 round(net_units,2) net_units,
 CASE WHEN settled_units>0 THEN round(100*net_units/settled_units,2) ELSE NULL END roi_pct
 FROM grouped
)
SELECT jsonb_build_object(
 'version','paper_breakdown_v1','generated_at',now(),
 'scope','all saved hypothetical paper selections, latest settlement revision',
 'total_bets',(SELECT count(*) FROM calculated),
 'settled_bets',(SELECT count(*) FROM calculated WHERE result_status='settled'),
 'total_net_units',(SELECT coalesce(round(sum(net_units),2),0) FROM calculated),
 'groups',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.kind,e.bets DESC,e.label) FROM entries e),'[]'::jsonb)
)
$function$;
REVOKE ALL ON FUNCTION public.gerball_paper_breakdown() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gerball_paper_breakdown() TO service_role;
NOTIFY pgrst,'reload schema';
