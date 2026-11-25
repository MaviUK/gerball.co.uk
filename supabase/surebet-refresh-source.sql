-- Deployed intraday 1X2 collector. Apply after the historical odds tables and surebet feed infrastructure.
CREATE SCHEMA IF NOT EXISTS gerball_surebet_private;
REVOKE ALL ON SCHEMA gerball_surebet_private FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA gerball_surebet_private TO service_role;
CREATE TABLE IF NOT EXISTS gerball_surebet_private.refresh_runs (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 uk_day date NOT NULL,slot text NOT NULL,
 status text NOT NULL DEFAULT 'claimed' CHECK(status IN ('claimed','completed','failed')),
 started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 completed_at timestamptz,event_id text NOT NULL,sport_key text NOT NULL,league_code text NOT NULL,
 home_team text NOT NULL,away_team text NOT NULL,kickoff_at timestamptz NOT NULL,
 provider_cost integer NOT NULL DEFAULT 0 CHECK(provider_cost BETWEEN 0 AND 4),
 remaining_credits integer,stored_quotes integer NOT NULL DEFAULT 0,failure_reason text,
 UNIQUE(uk_day,slot)
);
CREATE TABLE IF NOT EXISTS gerball_surebet_private.refresh_quotes (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 run_id bigint NOT NULL REFERENCES gerball_surebet_private.refresh_runs(id),
 event_id text NOT NULL,league_code text NOT NULL,home_team text NOT NULL,away_team text NOT NULL,
 kickoff_at timestamptz NOT NULL,bookmaker_key text NOT NULL,bookmaker_name text NOT NULL,
 selection text NOT NULL CHECK(selection IN ('H','D','A')),
 decimal_odds numeric NOT NULL CHECK(decimal_odds>1 AND decimal_odds<=1000),
 source_updated_at timestamptz NOT NULL,collected_at timestamptz NOT NULL,
 UNIQUE(run_id,bookmaker_key,selection)
);
CREATE INDEX IF NOT EXISTS gerball_surebet_refresh_latest_idx ON gerball_surebet_private.refresh_quotes(event_id,collected_at DESC);
CREATE INDEX IF NOT EXISTS gerball_surebet_runs_day_idx ON gerball_surebet_private.refresh_runs(uk_day,started_at DESC);
ALTER TABLE gerball_surebet_private.refresh_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE gerball_surebet_private.refresh_quotes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA gerball_surebet_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA gerball_surebet_private FROM PUBLIC,anon,authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA gerball_surebet_private TO service_role;
GRANT INSERT,UPDATE ON gerball_surebet_private.refresh_runs TO service_role;
GRANT INSERT ON gerball_surebet_private.refresh_quotes TO service_role;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA gerball_surebet_private TO service_role;

CREATE OR REPLACE FUNCTION public.gerball_arb_claim(p_mode text DEFAULT 'scheduled'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
 uk timestamptz:=clock_timestamp();
 day date:=(clock_timestamp() AT TIME ZONE 'Europe/London')::date;
 hr int:=extract(hour FROM clock_timestamp() AT TIME ZONE 'Europe/London');
 mi int:=extract(minute FROM clock_timestamp() AT TIME ZONE 'Europe/London');
 slot_key text;
 cnt int;
 last_remaining int;
 fixture record;
 run_id bigint;
BEGIN
 IF p_mode NOT IN ('scheduled','probe') THEN RAISE EXCEPTION 'invalid_mode'; END IF;
 IF p_mode='scheduled' AND (hr<14 OR hr>20 OR mi%15>4) THEN
   RETURN jsonb_build_object('claimed',false,'reason','outside_refresh_window'); END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('gerball_arb_daily_credit_limit'));
 slot_key:=CASE WHEN p_mode='probe' THEN 'probe' ELSE pg_catalog.lpad(hr::text,2,'0')||':'||pg_catalog.lpad((mi-mi%15)::text,2,'0') END;
 IF EXISTS(SELECT 1 FROM gerball_surebet_private.refresh_runs WHERE uk_day=day AND slot=slot_key) THEN
   RETURN jsonb_build_object('claimed',false,'reason','slot_already_claimed'); END IF;
 SELECT count(*) INTO cnt FROM gerball_surebet_private.refresh_runs WHERE uk_day=day;
 SELECT remaining_credits INTO last_remaining FROM gerball_surebet_private.refresh_runs
 WHERE remaining_credits IS NOT NULL AND uk_day=day ORDER BY started_at DESC LIMIT 1;
 IF cnt>=28 THEN RETURN jsonb_build_object('claimed',false,'reason','daily_28_request_cap'); END IF;
 IF (SELECT COALESCE(sum(provider_cost),0)+4*count(*) FILTER(WHERE status='claimed')
     FROM gerball_surebet_private.refresh_runs WHERE uk_day=day)>=32 THEN
  RETURN jsonb_build_object('claimed',false,'reason','daily_credit_budget_reserve'); END IF;
 IF last_remaining IS NOT NULL AND last_remaining<100 THEN
   RETURN jsonb_build_object('claimed',false,'reason','provider_quota_reserve'); END IF;
 WITH selected AS MATERIALIZED(
   SELECT DISTINCT ON (s.event_id) s.event_id,s.sport_key,s.football_data_league,
   s.home_team,s.away_team,s.kickoff_at
   FROM public.gerball_odds_snapshots s
   WHERE s.collection_date >= day-1 AND s.kickoff_at>uk+interval '60 minutes'
    AND s.kickoff_at<uk+interval '96 hours' AND s.market='h2h'
   ORDER BY s.event_id,s.collection_date DESC,s.collected_at DESC
 ), numbered AS(
   SELECT *,row_number() OVER(ORDER BY kickoff_at,football_data_league,event_id) rn
   FROM (SELECT * FROM selected ORDER BY kickoff_at,football_data_league,event_id LIMIT 24) candidates
 ), size AS (SELECT count(*) n FROM numbered)
 SELECT n.* INTO fixture
 FROM numbered n CROSS JOIN size z
 WHERE n.rn=1+((CASE WHEN p_mode='probe' THEN 0 ELSE ((hr-14)*4+(mi-mi%15)/15) END)%NULLIF(z.n,0));
 IF NOT FOUND THEN RETURN jsonb_build_object('claimed',false,'reason','no_upcoming_stored_events'); END IF;
 INSERT INTO gerball_surebet_private.refresh_runs(uk_day,slot,event_id,sport_key,league_code,home_team,away_team,kickoff_at)
 VALUES(day,slot_key,fixture.event_id,fixture.sport_key,fixture.football_data_league,
 fixture.home_team,fixture.away_team,fixture.kickoff_at) RETURNING id INTO run_id;
 RETURN jsonb_build_object('claimed',true,'id',run_id,'day',day,'slot',slot_key,
 'event_id',fixture.event_id,'sport_key',fixture.sport_key,'league',fixture.football_data_league,
 'home',fixture.home_team,'away',fixture.away_team,'kickoff_at',fixture.kickoff_at,'budget_remaining',28-cnt-1);
END $function$;
CREATE OR REPLACE FUNCTION public.gerball_arb_finish(p_id bigint, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE r gerball_surebet_private.refresh_runs%ROWTYPE; item jsonb; saved int:=0;
 c int:=COALESCE((p_payload->>'credits_used')::int,0);
 q int:=NULLIF(p_payload->>'remaining_credits','')::int;
BEGIN
 SELECT * INTO STRICT r FROM gerball_surebet_private.refresh_runs WHERE id=p_id FOR UPDATE;
 IF r.status<>'claimed' OR c<0 OR c>4 OR q<0 OR jsonb_typeof(p_payload->'quotes')<>'array'
 OR jsonb_array_length(p_payload->'quotes')>150 THEN RAISE EXCEPTION 'invalid_run_payload'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_payload->'quotes') LOOP
  IF item->>'event_id' IS DISTINCT FROM r.event_id OR item->>'selection' NOT IN ('H','D','A')
  OR (item->>'odds')::numeric<=1 OR (item->>'odds')::numeric>1000
  OR (item->>'collected_at')::timestamptz>=r.kickoff_at
  OR (item->>'collected_at')::timestamptz>clock_timestamp()+interval '1 minute'
  OR (item->>'updated_at')::timestamptz>(item->>'collected_at')::timestamptz
  OR length(item->>'bookmaker_key')>80 OR length(item->>'bookmaker')>160
  THEN RAISE EXCEPTION 'invalid_arbitrage_quote'; END IF;
  INSERT INTO gerball_surebet_private.refresh_quotes(
    run_id,event_id,league_code,home_team,away_team,kickoff_at,
    bookmaker_key,bookmaker_name,selection,decimal_odds,source_updated_at,collected_at)
   VALUES(p_id,r.event_id,r.league_code,r.home_team,r.away_team,r.kickoff_at,
   item->>'bookmaker_key',item->>'bookmaker',item->>'selection',(item->>'odds')::numeric,
   (item->>'updated_at')::timestamptz,(item->>'collected_at')::timestamptz)
   ON CONFLICT DO NOTHING;
   saved:=saved+1;
 END LOOP;
 UPDATE gerball_surebet_private.refresh_runs SET
 status=CASE WHEN p_payload->>'status'='completed' THEN 'completed' ELSE 'failed' END,
 completed_at=clock_timestamp(),provider_cost=c,remaining_credits=q,stored_quotes=saved,
 failure_reason=left(coalesce(p_payload->>'reason',''),100)
 WHERE id=p_id;
 RETURN jsonb_build_object('id',p_id,'status',p_payload->>'status','stored',saved,
 'credits_used',c,'remaining_credits',q);
END $function$;
REVOKE ALL ON FUNCTION public.gerball_arb_claim(text),public.gerball_arb_finish(bigint,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gerball_arb_claim(text),public.gerball_arb_finish(bigint,jsonb) TO service_role;
SELECT cron.schedule('gerball-surebet-quarterhour','0,15,30,45 13-20 * * *',$job$
 SELECT net.http_post(
 url:='https://hdueztssmsvvxkwqgcnm.supabase.co/functions/v1/gerball-surebet-refresh',
 headers:=jsonb_build_object('Content-Type','application/json','x-gerball-token',
 (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='gerball_odds_cron_token')),
 body:='{"mode":"scheduled"}'::jsonb,timeout_milliseconds:=50000
 ) WHERE extract(hour FROM clock_timestamp() AT TIME ZONE 'Europe/London') BETWEEN 14 AND 20
 AND mod(extract(minute FROM clock_timestamp() AT TIME ZONE 'Europe/London')::integer,15)=0;
$job$);
NOTIFY pgrst,'reload schema';
