CREATE OR REPLACE FUNCTION public.gerball_paper_odds_movement()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
WITH eligible AS MATERIALIZED (
 SELECT b.id,b.event_id,b.kickoff_at,b.home_team,b.away_team,b.league_code,b.market,
 b.bookmaker_name AS original_bookmaker,b.bookmaker_key AS original_bookmaker_key,
 b.odds AS original_odds,b.model_probability,b.estimated_edge,b.recorded_at,
 b.quote_collected_at AS original_capture,
 b.recommended_units
 FROM gerball_advice_private.paper_bets b
 WHERE b.market IN ('H','D','A')
), runs AS MATERIALIZED (
 SELECT b.id AS bet_id,r.id AS run_id,r.completed_at,
 b.event_id,b.market,b.kickoff_at
 FROM eligible b JOIN gerball_surebet_private.refresh_runs r
  ON r.event_id=b.event_id AND r.kickoff_at=b.kickoff_at AND r.status='completed'
 WHERE r.completed_at>b.recorded_at AND r.completed_at<=b.kickoff_at
), valid AS MATERIALIZED (
 SELECT r.bet_id,r.run_id,r.completed_at,q.bookmaker_name,q.bookmaker_key,q.decimal_odds,
 q.collected_at,q.source_updated_at
 FROM runs r JOIN gerball_surebet_private.refresh_quotes q
   ON q.run_id=r.run_id AND q.selection=r.market AND q.event_id=r.event_id AND q.kickoff_at=r.kickoff_at
 WHERE q.collected_at>=(SELECT recorded_at FROM eligible WHERE id=r.bet_id)
 AND q.collected_at<r.kickoff_at
 AND q.source_updated_at<=q.collected_at
 AND q.source_updated_at>=q.collected_at-interval '15 minutes'
 AND q.bookmaker_key NOT IN ('betfair_ex_uk','smarkets','matchbook')
 AND q.decimal_odds>1 AND q.decimal_odds<=1000
), best_per_run AS MATERIALIZED (
 SELECT DISTINCT ON (bet_id,run_id)
 bet_id,run_id,completed_at,bookmaker_name,bookmaker_key,decimal_odds,collected_at,source_updated_at
 FROM valid
 ORDER BY bet_id,run_id,decimal_odds DESC,source_updated_at DESC,bookmaker_key
), latest AS MATERIALIZED (
 SELECT DISTINCT ON (bet_id) *
 FROM best_per_run
 ORDER BY bet_id,completed_at DESC,run_id DESC
), earliest AS MATERIALIZED (
 SELECT DISTINCT ON (bet_id) *
 FROM best_per_run
 ORDER BY bet_id,completed_at ASC,run_id ASC
), original_book AS MATERIALIZED (
 SELECT DISTINCT ON (b.id)
 b.id bet_id,q.bookmaker_name,q.bookmaker_key,q.decimal_odds,q.collected_at
 FROM eligible b JOIN valid q ON q.bet_id=b.id AND q.bookmaker_key=b.original_bookmaker_key
 ORDER BY b.id,q.collected_at DESC
), rows AS MATERIALIZED (
 SELECT b.id,b.event_id,b.kickoff_at,b.home_team,b.away_team,b.league_code,b.market,
 b.original_bookmaker,b.original_bookmaker_key,b.original_odds,
 b.recorded_at,b.original_capture,b.model_probability,b.estimated_edge,b.recommended_units,
 e.decimal_odds AS first_fixed_odds,e.collected_at AS first_fixed_capture,
 l.decimal_odds AS latest_fixed_odds,l.bookmaker_name AS latest_fixed_bookmaker,
 l.bookmaker_key AS latest_fixed_bookmaker_key,l.collected_at AS latest_fixed_capture,
 l.source_updated_at AS latest_fixed_updated,
 ob.decimal_odds AS same_book_odds,ob.collected_at AS same_book_capture,
 (SELECT count(*) FROM best_per_run br WHERE br.bet_id=b.id)::integer AS samples,
 round((l.decimal_odds-b.original_odds),4) AS odds_delta,
 round((l.decimal_odds/b.original_odds-1)*100,2) AS odds_change_pct,
 round((b.model_probability*l.decimal_odds-1)*100,2) AS model_edge_at_latest_pct,
 CASE WHEN l.decimal_odds IS NULL THEN 'no_followup'
 WHEN b.model_probability*l.decimal_odds>1 THEN 'positive_model_edge'
 ELSE 'nonpositive_model_edge' END AS edge_status,
 CASE WHEN l.decimal_odds IS NULL THEN NULL
 WHEN l.decimal_odds>b.original_odds THEN 'higher_fixed_price'
 WHEN l.decimal_odds<b.original_odds THEN 'lower_fixed_price'
 ELSE 'unchanged' END AS direction
 FROM eligible b
 LEFT JOIN latest l ON l.bet_id=b.id
 LEFT JOIN earliest e ON e.bet_id=b.id
 LEFT JOIN original_book ob ON ob.bet_id=b.id
), items AS (
 SELECT * FROM rows WHERE latest_fixed_odds IS NOT NULL ORDER BY latest_fixed_capture DESC,id DESC LIMIT 100
)
SELECT jsonb_build_object(
 'version','paper_odds_movement_v1',
 'generated_at',now(),
 'scope','original paper 1X2 versus later sampled best UK fixed-odds bookmaker offers, not execution proof',
 'followup_selection','earliest upcoming UK paper 1X2 with no valid follow-up first, then least sampled; existing API budget unchanged',
 'upcoming_paper_bets',(SELECT count(*) FROM rows WHERE kickoff_at>now()),
 'upcoming_unfollowed_bets',(SELECT count(*) FROM rows WHERE kickoff_at>now() AND latest_fixed_odds IS NULL),
 'today_upcoming_unfollowed_bets',(SELECT count(*) FROM rows WHERE kickoff_at>now() AND (kickoff_at AT TIME ZONE 'Europe/London')::date=(now() AT TIME ZONE 'Europe/London')::date AND latest_fixed_odds IS NULL),
 'total_eligible_bets',(SELECT count(*) FROM rows),
 'followed_bets',(SELECT count(*) FROM rows WHERE latest_fixed_odds IS NOT NULL),
 'unfollowed_bets',(SELECT count(*) FROM rows WHERE latest_fixed_odds IS NULL),
 'positive_model_edge_at_latest',(SELECT count(*) FROM rows WHERE edge_status='positive_model_edge'),
 'nonpositive_model_edge_at_latest',(SELECT count(*) FROM rows WHERE edge_status='nonpositive_model_edge'),
 'higher_fixed_price',(SELECT count(*) FROM rows WHERE direction='higher_fixed_price'),
 'lower_fixed_price',(SELECT count(*) FROM rows WHERE direction='lower_fixed_price'),
 'unchanged_fixed_price',(SELECT count(*) FROM rows WHERE direction='unchanged'),
 'same_original_bookmaker_observed',(SELECT count(*) FROM rows WHERE same_book_odds IS NOT NULL),
 'data_limitations','Only sparse sampled full-time result markets; original prices may be Exchange whereas new prices exclude Exchange commission; no assertion of same-bookmaker CLV or demonstrated profitability.',
 'items',COALESCE((SELECT jsonb_agg(jsonb_build_object(
  'bet_id',id,'event_id',event_id,'league',league_code,'home',home_team,'away',away_team,
  'market',market,'kickoff_at',kickoff_at,'original_bookmaker',original_bookmaker,
  'original_bookmaker_key',original_bookmaker_key,'original_odds',original_odds,
  'original_recorded_at',recorded_at,'original_quote_at',original_capture,
  'model_probability',model_probability,'original_edge_pct',round(estimated_edge*100,2),
  'units',recommended_units,'first_followup_odds',first_fixed_odds,
  'first_followup_at',first_fixed_capture,'latest_fixed_odds',latest_fixed_odds,
  'latest_fixed_bookmaker',latest_fixed_bookmaker,'latest_fixed_bookmaker_key',latest_fixed_bookmaker_key,
  'latest_fixed_capture',latest_fixed_capture,'latest_fixed_updated',latest_fixed_updated,
  'same_book_odds',same_book_odds,'same_book_capture',same_book_capture,
  'samples',samples,'odds_delta',odds_delta,'odds_change_pct',odds_change_pct,
  'model_edge_at_latest_pct',model_edge_at_latest_pct,'edge_status',edge_status,
  'direction',direction
 ) ORDER BY latest_fixed_capture DESC,id DESC) FROM items),'[]'::jsonb)
)
$function$;
REVOKE ALL ON FUNCTION public.gerball_paper_odds_movement() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gerball_paper_odds_movement() TO service_role;
NOTIFY pgrst,'reload schema';
