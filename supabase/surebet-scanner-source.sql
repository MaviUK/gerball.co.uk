CREATE OR REPLACE FUNCTION public.gerball_surebet_feed()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
WITH collected AS MATERIALIZED (
 SELECT s.event_id,s.football_data_league AS league,s.home_team AS home,s.away_team AS away,
 s.kickoff_at,s.collection_date,s.collected_at,s.source_updated_at,
 s.bookmaker_key,s.bookmaker_name,
 CASE WHEN s.market='h2h' THEN 'full_time_result' ELSE 'goals_total' END AS market,
 CASE WHEN s.market='h2h' THEN s.selection WHEN s.selection='O25' THEN 'Over' ELSE 'Under' END AS outcome,
 CASE WHEN s.market='totals' THEN s.line ELSE NULL::numeric END AS line,
 ''::text AS description,s.decimal_odds
 FROM public.gerball_odds_snapshots s
 WHERE s.collection_date>=(clock_timestamp() AT TIME ZONE 'Europe/London')::date-1
 AND s.collected_at>now()-interval '24 hours'
 AND s.source_updated_at>=s.collected_at-interval '90 minutes'
 AND s.kickoff_at>now() AND s.kickoff_at<now()+interval '15 days'
 AND s.bookmaker_key NOT IN ('betfair_ex_uk','smarkets','matchbook')
 AND s.decimal_odds>1 AND s.decimal_odds<1000
 AND ((s.market='h2h' AND s.selection IN ('H','D','A'))
   OR (s.market='totals' AND s.selection IN ('O25','U25') AND s.line=2.5))
 UNION ALL
 SELECT e.event_id,e.league_code,e.home_team,e.away_team,e.kickoff_at,e.collection_date,
 e.collected_at,e.source_updated_at,e.bookmaker_key,e.bookmaker_name,
 e.market_key,e.outcome_name,e.line,e.outcome_description,e.decimal_odds
 FROM gerball_extra_private.quotes e
 WHERE e.collection_date>=(clock_timestamp() AT TIME ZONE 'Europe/London')::date-1
 AND e.collected_at>now()-interval '24 hours'
 AND e.source_updated_at>=e.collected_at-interval '90 minutes'
 AND e.kickoff_at>now() AND e.kickoff_at<now()+interval '15 days'
 AND e.bookmaker_key NOT IN ('betfair_ex_uk','smarkets','matchbook')
 AND e.decimal_odds>1 AND e.decimal_odds<1000
 AND (e.market_key IN ('btts','h2h_3_way_h1','halftime_fulltime','alternate_totals_corners','alternate_totals_cards'))
 UNION ALL
 SELECT q.event_id,q.league_code,q.home_team,q.away_team,q.kickoff_at,
 r.uk_day,q.collected_at,q.source_updated_at,q.bookmaker_key,q.bookmaker_name,
 'full_time_result'::text,q.selection,NULL::numeric,''::text,q.decimal_odds
 FROM gerball_surebet_private.refresh_quotes q
 JOIN gerball_surebet_private.refresh_runs r ON r.id=q.run_id AND r.status='completed'
 WHERE q.collected_at>now()-interval '24 hours'
 AND q.source_updated_at>=q.collected_at-interval '90 minutes'
 AND q.kickoff_at>now() AND q.kickoff_at<now()+interval '15 days'
 AND q.bookmaker_key NOT IN ('betfair_ex_uk','smarkets','matchbook')
), newest AS MATERIALIZED (
 SELECT event_id,kickoff_at,market,coalesce(line,-1) AS line_group,description,
 MAX(collected_at) AS newest
 FROM collected
 GROUP BY event_id,kickoff_at,market,coalesce(line,-1),description
), aligned AS MATERIALIZED (
 SELECT c.*
 FROM collected c JOIN newest n ON n.event_id=c.event_id
 AND n.kickoff_at=c.kickoff_at AND n.market=c.market
 AND n.line_group=coalesce(c.line,-1) AND n.description=c.description
 WHERE c.collected_at>=n.newest-interval '2 minutes'
), best AS MATERIALIZED (
 SELECT DISTINCT ON (event_id,kickoff_at,market,coalesce(line,-1),description,outcome)
 event_id,league,home,away,kickoff_at,collection_date,collected_at,source_updated_at,
 bookmaker_key,bookmaker_name,market,outcome,line,description,decimal_odds
 FROM aligned
 ORDER BY event_id,kickoff_at,market,coalesce(line,-1),description,outcome,
 decimal_odds DESC,source_updated_at DESC,collected_at DESC,bookmaker_key ASC
), limited AS (
 SELECT * FROM best ORDER BY kickoff_at,event_id,market,line NULLS FIRST,outcome LIMIT 6000
)
SELECT jsonb_build_object(
 'version','surebet_feed_v1',
 'generated_at',now(),
 'max_quote_age_hours',24,
 'max_source_delay_minutes',90,
 'active_window_minutes',15,
 'exchange_prices_excluded',true,
 'scanned_fixture_count',(SELECT count(DISTINCT event_id) FROM collected),
 'complete_market_quote_rows',(SELECT count(*) FROM limited),
 'refresh',(
 SELECT jsonb_build_object(
 'slot',r.slot,'updated_at',r.completed_at,'status',r.status,
 'stored_quotes',r.stored_quotes,'provider_cost',r.provider_cost,
 'requests_remaining',r.remaining_credits,
 'daily_request_count',(SELECT count(*) FROM gerball_surebet_private.refresh_runs z WHERE z.uk_day=(now() AT TIME ZONE 'Europe/London')::date),
 'daily_credits_used',(SELECT COALESCE(sum(provider_cost),0) FROM gerball_surebet_private.refresh_runs z WHERE z.uk_day=(now() AT TIME ZONE 'Europe/London')::date),
 'daily_request_cap',28,'minimum_provider_reserve',100
 ) FROM gerball_surebet_private.refresh_runs r ORDER BY r.started_at DESC LIMIT 1),
 'quotes',COALESCE((SELECT jsonb_agg(jsonb_build_object(
 'event_id',event_id,'league',league,'home',home,'away',away,'kickoff_at',kickoff_at,
 'market',market,'outcome',outcome,'line',line,'description',description,
 'decimal_odds',decimal_odds,'bookmaker',bookmaker_name,'bookmaker_key',bookmaker_key,
 'source_updated_at',source_updated_at,'collected_at',collected_at,
 'collection_date',collection_date)
 ORDER BY kickoff_at,event_id,market,outcome) FROM limited),'[]'::jsonb)
)
$function$;
REVOKE ALL ON FUNCTION public.gerball_surebet_feed() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gerball_surebet_feed() TO service_role;
NOTIFY pgrst,'reload schema';
