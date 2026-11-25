-- Reproducible source snapshot of the paper-only recommendations deployed 25 Nov 2026.
-- Existing historical imports, collector, and recorded screens are NOT replaced.
CREATE SCHEMA IF NOT EXISTS gerball_advice_private;
REVOKE ALL ON SCHEMA gerball_advice_private FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA gerball_advice_private TO service_role;

CREATE OR REPLACE FUNCTION public.gerball_bet_candidates(p_capture_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
WITH day AS (
 SELECT COALESCE(p_capture_date, (statement_timestamp() AT TIME ZONE 'Europe/London')::date) capture_date
), cohort_set AS (
 SELECT c.id FROM gerball_tracking_private.cohorts c JOIN day d ON c.capture_date=d.capture_date
 WHERE c.rule_version='ppg_last5_dates_050_v1'
), obs AS MATERIALIZED (
 SELECT o.id,o.event_id,o.league_code,o.recorded_at,o.kickoff_at,o.fixture,o.fixture_date,o.season,o.phase,
 o.fixture->'home'->>'canonical_name' home_team,o.fixture->'away'->>'canonical_name' away_team,
 o.fixture->'home'->>'provider_name' provider_home,o.fixture->'away'->>'provider_name' provider_away,
 o.input_sha256
 FROM gerball_tracking_private.observations o JOIN cohort_set c ON c.id=o.cohort_id
 WHERE o.kickoff_at>statement_timestamp() AND o.recorded_at<o.kickoff_at
), baseline AS MATERIALIZED (
 SELECT m.league, count(*)::numeric n,
 count(*) FILTER(WHERE m.full_time_result='H')::numeric h,
 count(*) FILTER(WHERE m.full_time_result='D')::numeric d,
 count(*) FILTER(WHERE m.full_time_result='A')::numeric a,
 count(*) FILTER(WHERE m.home_goals+m.away_goals>2)::numeric over25
 FROM public.matches m JOIN day d ON m.match_date<d.capture_date AND m.match_date>=d.capture_date-interval '730 days'
 WHERE m.home_goals>=0 AND m.away_goals>=0
 AND m.imported_at <= (SELECT min(recorded_at) FROM obs)
 GROUP BY m.league
), features AS MATERIALIZED (
 SELECT o.*,b.n league_n,b.h/NULLIF(b.n,0) base_h,b.d/NULLIF(b.n,0) base_d,b.a/NULLIF(b.n,0) base_a,
 b.over25/NULLIF(b.n,0) base_o,
 h.n home_n,h.h home_h,h.d home_d,h.a home_a,h.over25 home_o,
 a.n away_n,a.h away_h,a.d away_d,a.a away_a,a.over25 away_o
 FROM obs o LEFT JOIN baseline b ON b.league=o.league_code
 LEFT JOIN LATERAL (
 SELECT count(*)::numeric n,count(*) FILTER(WHERE full_time_result='H')::numeric h,
 count(*) FILTER(WHERE full_time_result='D')::numeric d,
 count(*) FILTER(WHERE full_time_result='A')::numeric a,
 count(*) FILTER(WHERE home_goals+away_goals>2)::numeric over25
 FROM (
 SELECT full_time_result,home_goals,away_goals FROM public.matches m
 WHERE m.league=o.league_code AND m.home_team=o.home_team
 AND m.match_date<(o.recorded_at AT TIME ZONE 'Europe/London')::date
 AND m.match_date>=((o.recorded_at AT TIME ZONE 'Europe/London')::date-interval '730 days')::date
 AND m.imported_at<=o.recorded_at AND m.home_goals>=0 AND m.away_goals>=0
 ORDER BY m.match_date DESC,m.id DESC LIMIT 20) x
 ) h ON true
 LEFT JOIN LATERAL (
 SELECT count(*)::numeric n,count(*) FILTER(WHERE full_time_result='H')::numeric h,
 count(*) FILTER(WHERE full_time_result='D')::numeric d,
 count(*) FILTER(WHERE full_time_result='A')::numeric a,
 count(*) FILTER(WHERE home_goals+away_goals>2)::numeric over25
 FROM (
 SELECT full_time_result,home_goals,away_goals FROM public.matches m
 WHERE m.league=o.league_code AND m.away_team=o.away_team
 AND m.match_date<(o.recorded_at AT TIME ZONE 'Europe/London')::date
 AND m.match_date>=((o.recorded_at AT TIME ZONE 'Europe/London')::date-interval '730 days')::date
 AND m.imported_at<=o.recorded_at AND m.home_goals>=0 AND m.away_goals>=0
 ORDER BY m.match_date DESC,m.id DESC LIMIT 20) x
 ) a ON true
), probabilities AS (
 SELECT f.*,v.market,v.model_probability::numeric model_probability
 FROM features f
 CROSS JOIN LATERAL (
 VALUES
 ('H',(20*f.base_h+f.home_h+f.away_h)/(20+f.home_n+f.away_n)),
 ('D',(20*f.base_d+f.home_d+f.away_d)/(20+f.home_n+f.away_n)),
 ('A',(20*f.base_a+f.home_a+f.away_a)/(20+f.home_n+f.away_n)),
 ('O25',(20*f.base_o+f.home_o+f.away_o)/(20+f.home_n+f.away_n)),
 ('U25',(20*(1-f.base_o)+(f.home_n-f.home_o)+(f.away_n-f.away_o))/(20+f.home_n+f.away_n))
 ) v(market,model_probability)
), priced AS (
 SELECT p.*,s.decimal_odds,s.bookmaker_key,s.bookmaker_name,s.collected_at quote_collected_at,
 s.source_updated_at quote_updated_at,
 round((p.model_probability*s.decimal_odds-1)::numeric,4) estimated_edge,
 CASE WHEN p.home_team IS NULL OR p.away_team IS NULL THEN 'team_not_linked'
 WHEN COALESCE(p.league_n,0)<100 THEN 'insufficient_league_history'
 WHEN COALESCE(p.home_n,0)<10 OR COALESCE(p.away_n,0)<10 THEN 'insufficient_venue_history'
 WHEN s.decimal_odds IS NULL THEN 'no_captured_odds'
 WHEN s.decimal_odds NOT BETWEEN 1.4 AND 6 THEN 'price_out_of_scope'
 WHEN p.recorded_at-s.collected_at>interval '120 minutes' THEN 'stale_collection'
 WHEN p.recorded_at-s.source_updated_at>interval '24 hours' THEN 'stale_provider_quote'
 WHEN p.model_probability*s.decimal_odds-1<0.08 THEN 'no_estimated_edge'
 ELSE 'candidate' END decision
 FROM probabilities p
 LEFT JOIN LATERAL (
 SELECT s.decimal_odds,s.bookmaker_key,s.bookmaker_name,s.collected_at,s.source_updated_at
 FROM public.gerball_odds_snapshots s
 WHERE s.event_id=p.event_id AND s.football_data_league=p.league_code
 AND s.kickoff_at=p.kickoff_at AND s.selection=p.market
 AND s.collection_date=(p.recorded_at AT TIME ZONE 'Europe/London')::date
 AND s.collected_at<=p.recorded_at AND s.source_updated_at<=p.recorded_at
 ORDER BY s.decimal_odds DESC,s.source_updated_at DESC,s.bookmaker_key LIMIT 1
 ) s ON true
), ranked AS (
 SELECT p.*,row_number() over(partition BY p.id
 ORDER BY (p.decision='candidate') DESC,p.estimated_edge DESC NULLS LAST,
 p.market ASC) preference_rank
 FROM priced p
), fixtures AS (
 SELECT id,event_id,league_code,recorded_at,kickoff_at,fixture_date,phase,season,
 home_team,away_team,provider_home,provider_away,input_sha256,
 market,model_probability,estimated_edge,decimal_odds,bookmaker_key,bookmaker_name,
 quote_collected_at,quote_updated_at,decision,league_n,home_n,away_n,
 CASE WHEN decision='candidate' THEN
 LEAST(5,GREATEST(1,1+floor((estimated_edge-0.08)/0.06)::integer)) ELSE 0 END AS units
 FROM ranked WHERE preference_rank=1
)
SELECT jsonb_build_object(
 'version','paper_advice_v1','model_version','venue20_league20_shrink_v1',
 'generated_at',statement_timestamp(),
 'capture_date',(SELECT capture_date FROM day),
 'rule','recent 20 home matches and 20 away matches, plus 20 league prior; historical data imported before recording',
 'minimum_samples',jsonb_build_object('home',10,'away',10,'league',100),
 'minimum_model_edge',0.08,'model_unvalidated',true,
 'source','frozen 12:15 UK historical screen observations and previously collected bookmaker prices',
 'quote_max_collection_age_minutes',120,
 'complete_cohorts',(SELECT count(*) FROM cohort_set),
 'fixtures',COALESCE((SELECT jsonb_agg(jsonb_build_object(
 'observation_id',id,'event_id',event_id,'league',league_code,'kickoff_at',kickoff_at,
 'recorded_at',recorded_at,'fixture_date',fixture_date,'phase',phase,
 'home',COALESCE(home_team,provider_home),'away',COALESCE(away_team,provider_away),
 'market',market,'probability',round(model_probability,4),'estimated_edge',estimated_edge,
 'quoted_odds',decimal_odds,'bookmaker_key',bookmaker_key,'bookmaker',bookmaker_name,
 'quote_collected_at',quote_collected_at,'quote_updated_at',quote_updated_at,
 'decision',decision,'units',units,'league_sample',league_n,'home_sample',home_n,
 'away_sample',away_n,'input_sha256',input_sha256
 ) ORDER BY kickoff_at,league_code,event_id) FROM fixtures),'[]'::jsonb)
)
$function$


REVOKE ALL ON FUNCTION public.gerball_bet_candidates(date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gerball_bet_candidates(date) TO service_role;

CREATE TABLE IF NOT EXISTS gerball_advice_private.model_versions(
version text PRIMARY KEY,algorithm_sha256 text NOT NULL CHECK(algorithm_sha256 ~ '^[a-f0-9]{64}$'),
frozen_at timestamptz NOT NULL DEFAULT clock_timestamp(),specification jsonb NOT NULL);
INSERT INTO gerball_advice_private.model_versions(version,algorithm_sha256,specification)
VALUES('venue20_league20_shrink_v1',
encode(extensions.digest(pg_get_functiondef('public.gerball_bet_candidates(date)'::regprocedure),'sha256'),'hex'),
'{"prior":"20 league match pseudo-count","profit":"gross hypothetical payout at captured decimal odds","markets":["H","D","A","O25","U25"],"purpose":"exploratory paper suggestions, not validated EV","unit_band":"1-5 according to estimated edge, not real stakes","team_sample":20,"league_sample":100,"lookback_days":730,"quote_max_minutes":120,"minimum_estimated_edge":0.08,"minimum_team_home_away":10,"quote_source_max_hours":24,"cross_market_combinations":false,"one_selection_per_fixture":true}'::jsonb)
ON CONFLICT(version) DO NOTHING;

CREATE TABLE IF NOT EXISTS gerball_advice_private.paper_bets(
id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
model_version text NOT NULL REFERENCES gerball_advice_private.model_versions(version),
observation_id bigint NOT NULL REFERENCES gerball_tracking_private.observations(id),
league_code text NOT NULL,event_id text NOT NULL,season text NOT NULL,
fixture_date date NOT NULL,kickoff_at timestamptz NOT NULL,home_team text NOT NULL,away_team text NOT NULL,
market text NOT NULL CHECK(market IN ('H','D','A','O25','U25')),
odds numeric NOT NULL CHECK(odds BETWEEN 1.4 AND 6),
bookmaker_key text NOT NULL,bookmaker_name text NOT NULL,
quote_collected_at timestamptz NOT NULL,quote_updated_at timestamptz NOT NULL,
model_probability numeric NOT NULL CHECK(model_probability BETWEEN 0 AND 1),
estimated_edge numeric NOT NULL,recommended_units integer NOT NULL CHECK(recommended_units BETWEEN 1 AND 5),
model_snapshot jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
UNIQUE(model_version,league_code,event_id),
UNIQUE(model_version,league_code,season,fixture_date,home_team,away_team),
UNIQUE(observation_id));
CREATE INDEX IF NOT EXISTS gerball_paper_bets_order_idx
ON gerball_advice_private.paper_bets(recorded_at DESC,id DESC);
CREATE TABLE IF NOT EXISTS gerball_advice_private.paper_captures(
capture_date date PRIMARY KEY,captured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
fixture_count integer NOT NULL,recommendations_saved integer NOT NULL,
model_version text NOT NULL REFERENCES gerball_advice_private.model_versions(version));
ALTER TABLE gerball_advice_private.model_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE gerball_advice_private.paper_bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE gerball_advice_private.paper_captures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA gerball_advice_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA gerball_advice_private FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA gerball_advice_private TO service_role;

CREATE OR REPLACE FUNCTION gerball_advice_private.check_paper_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE src gerball_tracking_private.observations%ROWTYPE;
BEGIN
 NEW.recorded_at:=clock_timestamp();
 SELECT * INTO STRICT src FROM gerball_tracking_private.observations WHERE id=NEW.observation_id;
 IF src.event_id<>NEW.event_id OR src.league_code<>NEW.league_code OR src.kickoff_at<>NEW.kickoff_at
 OR NEW.recorded_at>=src.kickoff_at OR src.recorded_at>NEW.recorded_at
 OR NEW.quote_collected_at>src.recorded_at OR NEW.quote_updated_at>src.recorded_at
 OR src.recorded_at-NEW.quote_collected_at>interval '120 minutes'
 OR src.recorded_at-NEW.quote_updated_at>interval '24 hours'
 OR NEW.odds*NEW.model_probability-1<0.08
 OR NEW.model_snapshot->>'input_sha256' IS DISTINCT FROM src.input_sha256
 OR NEW.model_snapshot->>'event_id' IS DISTINCT FROM src.event_id
 OR NEW.model_snapshot->>'market' IS DISTINCT FROM NEW.market
 OR (NEW.model_snapshot->>'units')::integer IS DISTINCT FROM NEW.recommended_units THEN
 RAISE EXCEPTION 'invalid_frozen_paper_advice' USING ERRCODE='22023';
 END IF;
 RETURN NEW;
END;
$function$

CREATE OR REPLACE FUNCTION gerball_advice_private.reject_paper_edit()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
 RAISE EXCEPTION 'paper_advice_is_append_only' USING ERRCODE='55000';
END;
$function$

DROP TRIGGER IF EXISTS paper_bets_before_insert ON gerball_advice_private.paper_bets;
CREATE TRIGGER paper_bets_before_insert BEFORE INSERT ON gerball_advice_private.paper_bets
FOR EACH ROW EXECUTE FUNCTION gerball_advice_private.check_paper_insert();
DROP TRIGGER IF EXISTS paper_bets_no_mutation ON gerball_advice_private.paper_bets;
CREATE TRIGGER paper_bets_no_mutation BEFORE UPDATE OR DELETE ON gerball_advice_private.paper_bets
FOR EACH ROW EXECUTE FUNCTION gerball_advice_private.reject_paper_edit();
DROP TRIGGER IF EXISTS paper_captures_no_mutation ON gerball_advice_private.paper_captures;
CREATE TRIGGER paper_captures_no_mutation BEFORE UPDATE OR DELETE ON gerball_advice_private.paper_captures
FOR EACH ROW EXECUTE FUNCTION gerball_advice_private.reject_paper_edit();

CREATE OR REPLACE FUNCTION gerball_advice_private.capture_paper_bets()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
 today date:=(clock_timestamp() AT TIME ZONE 'Europe/London')::date;
 uk_time time:=(clock_timestamp() AT TIME ZONE 'Europe/London')::time;
 report jsonb;
 row jsonb;
 saved integer:=0;
 complete integer;
 frozen text;
 actual text;
 cohort_count integer;
BEGIN
 IF uk_time < time '12:30' OR uk_time >= time '12:50' THEN
 RETURN jsonb_build_object('status','not_scheduled_time','date',today); END IF;
 IF EXISTS (SELECT 1 FROM gerball_advice_private.paper_captures WHERE capture_date=today) THEN
 RETURN jsonb_build_object('status','already_captured','date',today); END IF;
 SELECT count(DISTINCT league_code) INTO cohort_count
 FROM gerball_tracking_private.cohorts WHERE capture_date=today AND rule_version='ppg_last5_dates_050_v1';
 IF cohort_count<>18 THEN RETURN jsonb_build_object('status','waiting_for_18_leagues','captured',cohort_count,'date',today); END IF;
 SELECT algorithm_sha256 INTO STRICT frozen FROM gerball_advice_private.model_versions WHERE version='venue20_league20_shrink_v1';
 actual:=encode(extensions.digest(pg_get_functiondef('public.gerball_bet_candidates(date)'::regprocedure),'sha256'),'hex');
 IF frozen<>actual THEN RAISE EXCEPTION 'advice_model_version_changed' USING ERRCODE='55000'; END IF;
 report:=public.gerball_bet_candidates(today);
 complete:=(report->>'complete_cohorts')::integer;
 IF complete<>18 THEN RAISE EXCEPTION 'incomplete_advice_capture' USING ERRCODE='55000'; END IF;
 FOR row IN SELECT value FROM jsonb_array_elements(report->'fixtures')
 LOOP
 IF (row->>'decision')='candidate' AND (row->>'units')::integer>0 THEN
 INSERT INTO gerball_advice_private.paper_bets (
 model_version,observation_id,league_code,event_id,season,fixture_date,kickoff_at,
 home_team,away_team,market,odds,bookmaker_key,bookmaker_name,
 quote_collected_at,quote_updated_at,model_probability,estimated_edge,recommended_units,model_snapshot
 ) SELECT 'venue20_league20_shrink_v1',(row->>'observation_id')::bigint,row->>'league',row->>'event_id',
 o.season,o.fixture_date,o.kickoff_at,
 row->>'home',row->>'away',row->>'market',(row->>'quoted_odds')::numeric,
 row->>'bookmaker_key',row->>'bookmaker',(row->>'quote_collected_at')::timestamptz,
 (row->>'quote_updated_at')::timestamptz,(row->>'probability')::numeric,
 (row->>'estimated_edge')::numeric,(row->>'units')::integer,row
 FROM gerball_tracking_private.observations o WHERE o.id=(row->>'observation_id')::bigint
 ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS complete = ROW_COUNT;
 saved:=saved+complete;
 END IF;
 END LOOP;
 INSERT INTO gerball_advice_private.paper_captures(capture_date,fixture_count,recommendations_saved,model_version)
 VALUES(today,jsonb_array_length(report->'fixtures'),saved,'venue20_league20_shrink_v1')
 ON CONFLICT DO NOTHING;
 RETURN jsonb_build_object('status','completed','date',today,'saved',saved);
END;
$function$

CREATE OR REPLACE FUNCTION public.gerball_paper_report(p_limit integer DEFAULT 250, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE output jsonb;
BEGIN
 IF p_limit IS NULL OR p_limit<1 OR p_limit>1000 OR p_offset IS NULL OR p_offset<0 OR p_offset>50000 THEN
 RAISE EXCEPTION 'invalid_paper_report_page' USING ERRCODE='22023'; END IF;
 WITH ledger AS MATERIALIZED (
  SELECT b.*,
  COALESCE(s.status,'pending') AS result_status,
  s.revision,s.recorded_at result_recorded_at,s.full_time_result,s.home_goals,s.away_goals,
  s.match_id,s.imported_at,s.correction_reason,
  CASE WHEN s.status='settled' THEN
    CASE b.market WHEN 'H' THEN s.full_time_result='H'
    WHEN 'D' THEN s.full_time_result='D'
    WHEN 'A' THEN s.full_time_result='A'
    WHEN 'O25' THEN s.home_goals+s.away_goals>2
    WHEN 'U25' THEN s.home_goals+s.away_goals<3 END
  ELSE NULL END AS won
  FROM gerball_advice_private.paper_bets b
  LEFT JOIN LATERAL(
    SELECT status,revision,recorded_at,full_time_result,home_goals,away_goals,
    match_id,imported_at,correction_reason FROM gerball_tracking_private.result_revisions
    WHERE observation_id=b.observation_id ORDER BY revision DESC LIMIT 1
  ) s ON true
 ), computed AS MATERIALIZED (
  SELECT l.*,CASE WHEN result_status='settled' THEN
   CASE WHEN won THEN round(recommended_units*(odds-1),2) ELSE -recommended_units END
   ELSE NULL END AS net_units,
   CASE WHEN result_status='settled' THEN recommended_units ELSE 0 END AS settled_units
  FROM ledger l
 ), buckets AS (
  SELECT m.market,c.count_bets,c.settled,c.won,c.lost,c.pending,c.review,c.units_recommended,c.units_settled,c.net
  FROM (VALUES ('ALL'),('H'),('D'),('A'),('O25'),('U25')) m(market)
  CROSS JOIN LATERAL (
  SELECT count(*)::integer count_bets,
   count(*) FILTER(WHERE result_status='settled')::integer settled,
   count(*) FILTER(WHERE won IS TRUE)::integer won,
   count(*) FILTER(WHERE won IS FALSE)::integer lost,
   count(*) FILTER(WHERE result_status='pending')::integer pending,
   count(*) FILTER(WHERE result_status='review')::integer review,
   COALESCE(sum(recommended_units),0)::integer units_recommended,
   COALESCE(sum(settled_units),0)::integer units_settled,
   COALESCE(round(sum(net_units),2),0) net
  FROM computed WHERE m.market='ALL' OR market=m.market
  ) c
 ), ordered AS (
  SELECT id,kickoff_at,net_units,sum(net_units) OVER(ORDER BY kickoff_at,id) running
  FROM computed WHERE result_status='settled'
 ), drawdowns AS (
  SELECT id,kickoff_at,net_units,running,
  GREATEST(0,max(running) OVER(ORDER BY kickoff_at,id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW))-running drawdown
  FROM ordered
 )
 SELECT jsonb_build_object(
  'version','paper_ledger_v1','model_version','venue20_league20_shrink_v1',
  'generated_at',statement_timestamp(),
  'disclaimer','Exploratory paper predictions at archived quotes: not placed bets, not executable odds, not validated expected value.',
  'profit_basis','gross hypothetical paper units, without fees, based on first captured quote and latest imported result revision',
  'units_definition','abstract stake units; no monetary value or bankroll percentage specified',
  'same_match_combinations_available',false,
  'cards_markets_available',false,
  'summary',COALESCE((SELECT jsonb_agg(jsonb_build_object(
   'market',market,'bets',count_bets,'settled',settled,'won',won,'lost',lost,'pending',pending,'review',review,
   'units_recommended',units_recommended,'units_settled',units_settled,'net_units',net,
   'roi_pct', CASE WHEN units_settled>0 THEN round(100*net/units_settled,2) ELSE NULL END
  ) ORDER BY market) FROM buckets),'[]'::jsonb),
  'max_drawdown_units',(SELECT round(max(drawdown),2) FROM drawdowns),
  'total_records',(SELECT count(*) FROM computed),
  'last_capture',(SELECT jsonb_build_object('date',capture_date,'saved',recommendations_saved,
   'fixtures',fixture_count,'captured_at',captured_at) FROM gerball_advice_private.paper_captures
   ORDER BY capture_date DESC LIMIT 1),
  'records',COALESCE((SELECT jsonb_agg(jsonb_build_object(
   'id',id,'model_version',model_version,'event_id',event_id,'observation_id',observation_id,
   'league',league_code,'home',home_team,'away',away_team,'market',market,
   'season',season,'fixture_date',fixture_date,'kickoff_at',kickoff_at,'recorded_at',recorded_at,
   'odds',odds,'bookmaker',bookmaker_name,'bookmaker_key',bookmaker_key,
   'quote_collected_at',quote_collected_at,'quote_updated_at',quote_updated_at,
   'model_probability',model_probability,'estimated_edge',estimated_edge,
   'units',recommended_units,'input',model_snapshot,
   'status',result_status,'revision',revision,'result_recorded_at',result_recorded_at,
   'match_id',match_id,'imported_at',imported_at,'home_goals',home_goals,'away_goals',away_goals,
   'result',full_time_result,'won',won,'net_units',net_units,'correction_reason',correction_reason
  ) ORDER BY recorded_at DESC,id DESC) FROM
  (SELECT * FROM computed ORDER BY recorded_at DESC,id DESC LIMIT p_limit OFFSET p_offset) page),'[]'::jsonb),
  'preview',public.gerball_bet_candidates(NULL),
  'limit',p_limit,'offset',p_offset
 ) INTO output;
 RETURN output;
END
$function$

REVOKE ALL ON FUNCTION gerball_advice_private.capture_paper_bets() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION gerball_advice_private.check_paper_insert() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION gerball_advice_private.reject_paper_edit() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.gerball_paper_report(integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gerball_paper_report(integer,integer) TO service_role;
SELECT cron.schedule('gerball-paper-bets','35,40,45 11,12 * * *',
  $$SELECT gerball_advice_private.capture_paper_bets()$$);
NOTIFY pgrst,'reload schema';
