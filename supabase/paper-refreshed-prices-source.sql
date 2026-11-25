CREATE OR REPLACE FUNCTION public.gerball_paper_refreshed_prices()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
WITH todays_events AS MATERIALIZED (
 SELECT s.event_id,s.kickoff_at,min(s.home_team) home_team,min(s.away_team) away_team,min(s.football_data_league) league
 FROM public.gerball_odds_snapshots s
 WHERE s.collection_date >= (now() AT TIME ZONE 'Europe/London')::date-1
 AND (s.kickoff_at AT TIME ZONE 'Europe/London')::date=(now() AT TIME ZONE 'Europe/London')::date
 AND s.kickoff_at>now() AND s.market='h2h'
 GROUP BY s.event_id,s.kickoff_at
), recent_runs AS MATERIALIZED (
 SELECT DISTINCT ON (r.event_id) r.id,r.event_id,r.kickoff_at,r.completed_at,r.provider_cost,r.remaining_credits
 FROM gerball_surebet_private.refresh_runs r
 JOIN todays_events e ON e.event_id=r.event_id AND e.kickoff_at=r.kickoff_at
 WHERE r.status='completed' AND r.uk_day=(now() AT TIME ZONE 'Europe/London')::date
 ORDER BY r.event_id,r.completed_at DESC,r.id DESC
), valid_quotes AS MATERIALIZED (
 SELECT q.event_id,q.kickoff_at,q.selection,q.bookmaker_name,q.bookmaker_key,q.decimal_odds,
  q.collected_at,q.source_updated_at,r.id run_id
 FROM recent_runs r
 JOIN gerball_surebet_private.refresh_quotes q ON q.run_id=r.id
 WHERE q.event_id=r.event_id AND q.kickoff_at=r.kickoff_at
 AND q.selection IN ('H','D','A')
 AND q.bookmaker_key NOT IN ('betfair_ex_uk','smarkets','matchbook')
 AND q.decimal_odds>1 AND q.decimal_odds<=1000
 AND q.source_updated_at<=q.collected_at
 AND q.source_updated_at>=q.collected_at-interval '15 minutes'
 AND q.collected_at<q.kickoff_at
), best AS (
 SELECT DISTINCT ON (q.event_id,q.selection)
  q.event_id,q.kickoff_at,q.selection,q.bookmaker_name,q.bookmaker_key,q.decimal_odds,
  q.collected_at,q.source_updated_at,q.run_id,e.home_team,e.away_team,e.league
 FROM valid_quotes q JOIN todays_events e
 ON e.event_id=q.event_id AND e.kickoff_at=q.kickoff_at
 ORDER BY q.event_id,q.selection,q.decimal_odds DESC,q.source_updated_at DESC,q.bookmaker_key
)
SELECT jsonb_build_object(
 'version','paper_price_refresh_v1',
 'generated_at',now(),
 'uk_date',(now() AT TIME ZONE 'Europe/London')::date,
 'scope','pre-kickoff today, full-time home/draw/away, fixed-odds bookmaker quotes only',
 'fresh_minutes',15,
 'total_eligible_events',(SELECT count(*) FROM todays_events),
 'events_with_refresh',(SELECT count(*) FROM recent_runs),
 'total_prices',(SELECT count(*) FROM best),
 'last_refresh_at',(SELECT max(completed_at) FROM recent_runs),
 'prices',COALESCE((
 SELECT jsonb_agg(jsonb_build_object(
 'event_id',event_id,'kickoff_at',kickoff_at,'home',home_team,'away',away_team,'league',league,'selection',selection,
 'bookmaker',bookmaker_name,'bookmaker_key',bookmaker_key,
 'odds',decimal_odds,'quote_collected_at',collected_at,
 'quote_updated_at',source_updated_at,'run_id',run_id
 ) ORDER BY kickoff_at,event_id,selection) FROM best),'[]'::jsonb)
)
$function$;
REVOKE ALL ON FUNCTION public.gerball_paper_refreshed_prices() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gerball_paper_refreshed_prices() TO service_role;
NOTIFY pgrst,'reload schema';
