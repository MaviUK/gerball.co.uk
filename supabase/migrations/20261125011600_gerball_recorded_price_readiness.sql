-- Read-only evidence join: exact fixture, same capture day, selection and timestamps.
CREATE OR REPLACE FUNCTION public.gerball_price_readiness(p_capture_date date DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''
AS $func$
WITH chosen AS (SELECT COALESCE(p_capture_date,(SELECT max(c.capture_date) FROM gerball_tracking_private.cohorts c)) day),
captured AS MATERIALIZED(
 SELECT o.id,o.event_id,o.league_code,o.recorded_at,o.kickoff_at,o.fixture,
 o.fixture->'home'->>'provider_name' home_team,o.fixture->'away'->>'provider_name' away_team,c.capture_date
 FROM gerball_tracking_private.observations o JOIN gerball_tracking_private.cohorts c ON c.id=o.cohort_id
 JOIN chosen d ON c.capture_date=d.day
),qualified AS(
 SELECT o.id,o.event_id,o.league_code,o.recorded_at,o.kickoff_at,o.home_team,o.away_team,o.capture_date,m.key market
 FROM captured o CROSS JOIN LATERAL jsonb_each(o.fixture->'markets') m WHERE m.value->>'status'='match'
),priced AS MATERIALIZED(
 SELECT q.*,p.decimal_odds,p.bookmaker_name FROM qualified q LEFT JOIN LATERAL(
 SELECT s.decimal_odds,s.bookmaker_name FROM public.gerball_odds_snapshots s
 WHERE s.event_id=q.event_id AND s.football_data_league=q.league_code AND s.selection=q.market
 AND s.collection_date=q.capture_date AND s.collected_at<=q.recorded_at AND s.source_updated_at<=q.recorded_at
 AND s.kickoff_at=q.kickoff_at ORDER BY s.decimal_odds DESC,s.source_updated_at DESC,s.bookmaker_key ASC LIMIT 1
 ) p ON true
), market_counts AS (
 SELECT market,count(*) qualifying,count(*) FILTER(WHERE decimal_odds IS NOT NULL) priced FROM priced GROUP BY market
),league_counts AS (
 SELECT league_code,count(*) qualifying,count(*) FILTER(WHERE decimal_odds IS NOT NULL) priced FROM priced GROUP BY league_code
)
SELECT jsonb_build_object(
 'capture_date',(SELECT day FROM chosen),'generated_at',now(),
 'label','Research quote-availability audit; not approved betting signals',
 'total_observations',(SELECT count(*) FROM captured),
 'qualifying_markets',(SELECT count(*) FROM priced),
 'priced_markets',(SELECT count(*) FROM priced WHERE decimal_odds IS NOT NULL),
 'unpriced_markets',(SELECT count(*) FROM priced WHERE decimal_odds IS NULL),
 'markets',COALESCE((SELECT jsonb_agg(jsonb_build_object('market',market,'qualifying',qualifying,'priced',priced) ORDER BY market) FROM market_counts),'[]'::jsonb),
 'leagues',COALESCE((SELECT jsonb_agg(jsonb_build_object('league',league_code,'qualifying',qualifying,'priced',priced) ORDER BY league_code) FROM league_counts),'[]'::jsonb),
 'missing_quote_examples',COALESCE((SELECT jsonb_agg(to_jsonb(e)) FROM (
 SELECT league_code,home_team,away_team,market,kickoff_at,recorded_at FROM priced WHERE decimal_odds IS NULL
 ORDER BY kickoff_at,league_code,event_id,market LIMIT 30) e),'[]'::jsonb)
)
$func$;
REVOKE ALL ON FUNCTION public.gerball_price_readiness(date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gerball_price_readiness(date) TO service_role;
NOTIFY pgrst,'reload schema';