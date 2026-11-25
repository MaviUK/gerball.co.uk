-- Isolated event-market collector. Does not alter gerball_odds_snapshots or the main odds cron.
CREATE SCHEMA IF NOT EXISTS gerball_extra_private;
REVOKE ALL ON SCHEMA gerball_extra_private FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA gerball_extra_private TO service_role;
CREATE TABLE IF NOT EXISTS gerball_extra_private.runs(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 collection_date date NOT NULL,mode text NOT NULL CHECK(mode IN ('probe','daily')),
 status text NOT NULL DEFAULT 'claimed' CHECK(status IN ('claimed','completed','failed')),
 started_at timestamptz NOT NULL DEFAULT clock_timestamp(),completed_at timestamptz,
 fixture_count integer NOT NULL DEFAULT 0,discovery_count integer NOT NULL DEFAULT 0,
 price_calls integer NOT NULL DEFAULT 0,prices_saved integer NOT NULL DEFAULT 0,
 credits_reported integer NOT NULL DEFAULT 0,requests_remaining integer,detail text,
 UNIQUE(collection_date,mode));
CREATE TABLE IF NOT EXISTS gerball_extra_private.availability(
 run_id bigint NOT NULL REFERENCES gerball_extra_private.runs(id),
 event_id text NOT NULL,sport_key text NOT NULL,league_code text NOT NULL,
 home_team text NOT NULL,away_team text NOT NULL,kickoff_at timestamptz NOT NULL,
 discovered_at timestamptz NOT NULL,bookmaker_key text NOT NULL,
 bookmaker_name text NOT NULL,market_key text NOT NULL,source_updated_at timestamptz,
 PRIMARY KEY(run_id,event_id,bookmaker_key,market_key));
CREATE TABLE IF NOT EXISTS gerball_extra_private.quotes(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 run_id bigint NOT NULL REFERENCES gerball_extra_private.runs(id),
 event_id text NOT NULL,sport_key text NOT NULL,league_code text NOT NULL,
 home_team text NOT NULL,away_team text NOT NULL,kickoff_at timestamptz NOT NULL,
 collection_date date NOT NULL,bookmaker_key text NOT NULL,bookmaker_name text NOT NULL,
 market_key text NOT NULL,outcome_name text NOT NULL,
 outcome_description text NOT NULL DEFAULT '',line numeric,line_key text NOT NULL DEFAULT '',
 decimal_odds numeric NOT NULL CHECK(decimal_odds>1 AND decimal_odds<=10000),
 source_updated_at timestamptz NOT NULL,collected_at timestamptz NOT NULL,
 UNIQUE(run_id,event_id,bookmaker_key,market_key,outcome_name,outcome_description,line_key));
CREATE INDEX IF NOT EXISTS gerball_extra_quotes_event_idx ON gerball_extra_private.quotes(event_id,collection_date);
CREATE INDEX IF NOT EXISTS gerball_extra_quotes_market_idx ON gerball_extra_private.quotes(market_key,collection_date);
ALTER TABLE gerball_extra_private.runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE gerball_extra_private.availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE gerball_extra_private.quotes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA gerball_extra_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA gerball_extra_private FROM PUBLIC,anon,authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA gerball_extra_private TO service_role;
GRANT INSERT,UPDATE ON gerball_extra_private.runs TO service_role;
GRANT INSERT ON gerball_extra_private.availability,gerball_extra_private.quotes TO service_role;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA gerball_extra_private TO service_role;
CREATE OR REPLACE FUNCTION public.gerball_extra_seed(p_limit integer DEFAULT 2)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
WITH events AS (
SELECT DISTINCT ON (s.sport_key,s.event_id)
 s.event_id,s.sport_key,s.football_data_league,s.home_team,s.away_team,s.kickoff_at,s.collection_date
FROM public.gerball_odds_snapshots s
WHERE p_limit BETWEEN 1 AND 2
 AND s.collection_date >= (now() AT TIME ZONE 'Europe/London')::date-1
 AND s.kickoff_at > now()+interval '1 hour'
 AND s.kickoff_at < now()+interval '14 days'
ORDER BY s.sport_key,s.event_id,s.collection_date DESC
), shortlisted AS (
 SELECT * FROM events
 ORDER BY CASE football_data_league WHEN 'E0' THEN 0 WHEN 'E1' THEN 1 WHEN 'SC0' THEN 2 ELSE 3 END,
 kickoff_at,event_id LIMIT p_limit
)
SELECT COALESCE(jsonb_agg(jsonb_build_object('event_id',event_id,'sport_key',sport_key,
 'league',football_data_league,'home',home_team,'away',away_team,
 'kickoff_at',kickoff_at,'source_date',collection_date) ORDER BY kickoff_at,event_id),'[]'::jsonb)
FROM shortlisted
$function$

CREATE OR REPLACE FUNCTION public.gerball_extra_claim(p_mode text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE v_id bigint; v_day date:=(clock_timestamp() AT TIME ZONE 'Europe/London')::date;
BEGIN
 IF p_mode NOT IN ('daily','probe') THEN RAISE EXCEPTION 'invalid_mode'; END IF;
 INSERT INTO gerball_extra_private.runs(collection_date,mode)
 VALUES(v_day,p_mode) ON CONFLICT DO NOTHING RETURNING id INTO v_id;
 RETURN jsonb_build_object('claimed',v_id IS NOT NULL,'id',v_id,'date',v_day);
END $function$

CREATE OR REPLACE FUNCTION public.gerball_extra_finish(p_id bigint, p_report jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE v_run gerball_extra_private.runs%ROWTYPE; v_record jsonb; v_q jsonb;
v_saved integer:=0;v_discovered integer:=0;
BEGIN
 SELECT * INTO STRICT v_run FROM gerball_extra_private.runs WHERE id=p_id FOR UPDATE;
 IF v_run.status<>'claimed' THEN RAISE EXCEPTION 'run_already_finalized'; END IF;
 IF v_run.collection_date<>(clock_timestamp() AT TIME ZONE 'Europe/London')::date THEN
 RAISE EXCEPTION 'run_date_mismatch'; END IF;
 IF jsonb_typeof(p_report->'availability') IS DISTINCT FROM 'array'
 OR jsonb_typeof(p_report->'quotes') IS DISTINCT FROM 'array'
 OR jsonb_array_length(p_report->'availability')>500
 OR jsonb_array_length(p_report->'quotes')>1500 THEN RAISE EXCEPTION 'payload_out_of_bounds'; END IF;
 FOR v_record IN SELECT value FROM jsonb_array_elements(p_report->'availability')
 LOOP
 INSERT INTO gerball_extra_private.availability(
 run_id,event_id,sport_key,league_code,home_team,away_team,kickoff_at,
 discovered_at,bookmaker_key,bookmaker_name,market_key,source_updated_at)
 VALUES(p_id,v_record->>'event_id',v_record->>'sport_key',v_record->>'league',
 v_record->>'home',v_record->>'away',(v_record->>'kickoff_at')::timestamptz,
 (v_record->>'discovered_at')::timestamptz,v_record->>'bookmaker_key',
 v_record->>'bookmaker',v_record->>'market',
 NULLIF(v_record->>'source_updated_at','')::timestamptz)
 ON CONFLICT DO NOTHING;
 v_discovered:=v_discovered+1;
 END LOOP;
 FOR v_q IN SELECT value FROM jsonb_array_elements(p_report->'quotes')
 LOOP
 IF (v_q->>'market') NOT IN ('halftime_fulltime','alternate_totals_cards','alternate_totals_corners',
 'btts','h2h_3_way_h1','alternate_team_totals_corners','player_to_receive_card')
 OR (v_q->>'collected_at')::timestamptz>(clock_timestamp()+interval '5 minutes')
 OR (v_q->>'source_updated_at')::timestamptz>(v_q->>'collected_at')::timestamptz
 OR (v_q->>'collected_at')::timestamptz>=(v_q->>'kickoff_at')::timestamptz
 THEN RAISE EXCEPTION 'invalid_extra_quote'; END IF;
 INSERT INTO gerball_extra_private.quotes(
 run_id,event_id,sport_key,league_code,home_team,away_team,kickoff_at,collection_date,
 bookmaker_key,bookmaker_name,market_key,outcome_name,outcome_description,line,line_key,
 decimal_odds,source_updated_at,collected_at)
 VALUES(p_id,v_q->>'event_id',v_q->>'sport_key',v_q->>'league',v_q->>'home',v_q->>'away',
 (v_q->>'kickoff_at')::timestamptz,v_run.collection_date,v_q->>'bookmaker_key',
 v_q->>'bookmaker',v_q->>'market',v_q->>'outcome',COALESCE(v_q->>'description',''),
 NULLIF(v_q->>'line','')::numeric,COALESCE(v_q->>'line',''),
 (v_q->>'odds')::numeric,(v_q->>'source_updated_at')::timestamptz,
 (v_q->>'collected_at')::timestamptz)
 ON CONFLICT DO NOTHING;
 v_saved:=v_saved+1;
 END LOOP;
 UPDATE gerball_extra_private.runs SET status=CASE WHEN p_report->>'status'='completed' THEN 'completed' ELSE 'failed' END,
 completed_at=clock_timestamp(),fixture_count=LEAST(2,COALESCE((p_report->>'fixture_count')::integer,0)),
 discovery_count=v_discovered,price_calls=LEAST(2,COALESCE((p_report->>'price_calls')::integer,0)),
 prices_saved=v_saved,credits_reported=LEAST(10,GREATEST(0,COALESCE((p_report->>'credits_reported')::integer,0))),
 requests_remaining=NULLIF(p_report->>'requests_remaining','')::integer,
 detail=left(COALESCE(p_report->>'detail',''),120)
 WHERE id=p_id;
 RETURN jsonb_build_object('status',p_report->>'status','availability',v_discovered,
 'prices',v_saved,'id',p_id);
END $function$

CREATE OR REPLACE FUNCTION public.gerball_extra_status()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
SELECT jsonb_build_object(
 'runs',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.started_at DESC) FROM (
 SELECT collection_date,mode,status,started_at,completed_at,fixture_count,discovery_count,
 price_calls,prices_saved,credits_reported,requests_remaining,detail FROM gerball_extra_private.runs
 ORDER BY started_at DESC LIMIT 14) r),'[]'::jsonb),
 'markets',COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.market_key) FROM (
 SELECT market_key,count(*) as prices,count(DISTINCT event_id) as fixtures,
 count(DISTINCT bookmaker_key) as bookmakers
 FROM gerball_extra_private.quotes GROUP BY market_key) m),'[]'::jsonb),
 'availability',COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.market_key) FROM (
 SELECT market_key,count(DISTINCT event_id) as events,count(DISTINCT bookmaker_key) bookmakers
 FROM gerball_extra_private.availability GROUP BY market_key) m),'[]'::jsonb),
 'latest_quotes',COALESCE((SELECT jsonb_agg(to_jsonb(q)) FROM (
 SELECT collection_date,event_id,league_code,home_team,away_team,kickoff_at,
 market_key,outcome_name,outcome_description,line,decimal_odds,bookmaker_name,
 source_updated_at,collected_at
 FROM gerball_extra_private.quotes ORDER BY collected_at DESC,id DESC LIMIT 50) q),'[]'::jsonb)
)
$function$

REVOKE ALL ON FUNCTION public.gerball_extra_seed(integer),
 public.gerball_extra_claim(text),public.gerball_extra_finish(bigint,jsonb),
 public.gerball_extra_status() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gerball_extra_seed(integer),
 public.gerball_extra_claim(text),public.gerball_extra_finish(bigint,jsonb),
 public.gerball_extra_status() TO service_role;
SELECT cron.schedule('gerball-extra-markets','50 11,12 * * *',$job$
 SELECT net.http_post(
 url:='https://hdueztssmsvvxkwqgcnm.supabase.co/functions/v1/gerball-extra-odds',
 headers:=jsonb_build_object('Content-Type','application/json','x-gerball-token',
 (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='gerball_odds_cron_token')),
 body:='{"mode":"daily"}'::jsonb,timeout_milliseconds:=120000
 ) WHERE extract(hour FROM clock_timestamp() AT TIME ZONE 'Europe/London')=12
 AND extract(minute FROM clock_timestamp() AT TIME ZONE 'Europe/London')=50;
$job$);
NOTIFY pgrst,'reload schema';
