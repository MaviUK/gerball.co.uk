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
  SELECT DISTINCT ON (s.event_id) s.event_id,s.sport_key,s.football_data_league,s.home_team,s.away_team,s.kickoff_at,
   CASE WHEN (s.kickoff_at AT TIME ZONE 'Europe/London')::date=day THEN 0 ELSE 1 END today_rank,
   CASE WHEN EXISTS(
    SELECT 1 FROM gerball_advice_private.paper_bets b
    WHERE b.event_id=s.event_id AND b.kickoff_at=s.kickoff_at AND b.market IN ('H','D','A') AND b.recorded_at<s.kickoff_at
   ) THEN 0 ELSE 1 END paper_rank
  FROM public.gerball_odds_snapshots s
  WHERE s.collection_date>=day-1 AND s.kickoff_at>uk+interval '7 minutes'
   AND s.kickoff_at<uk+interval '96 hours' AND s.market='h2h'
  ORDER BY s.event_id,s.collection_date DESC,s.collected_at DESC
 ), candidates AS MATERIALIZED(
  SELECT * FROM selected ORDER BY today_rank,paper_rank,kickoff_at,event_id LIMIT 24
 ), pool AS MATERIALIZED(
  SELECT * FROM candidates
  WHERE today_rank=(SELECT min(today_rank) FROM candidates)
   AND paper_rank=(SELECT min(paper_rank) FROM candidates
    WHERE today_rank=(SELECT min(today_rank) FROM candidates))
 ), ranked AS MATERIALIZED(
  SELECT p.*,
   (
    SELECT count(DISTINCT rr.id)::integer
    FROM gerball_surebet_private.refresh_runs rr
    JOIN gerball_surebet_private.refresh_quotes qq ON qq.run_id=rr.id
    JOIN gerball_advice_private.paper_bets b
      ON b.event_id=p.event_id AND b.kickoff_at=p.kickoff_at
      AND b.market=qq.selection AND b.recorded_at<qq.collected_at
    WHERE rr.event_id=p.event_id AND rr.kickoff_at=p.kickoff_at
      AND rr.status='completed' AND rr.completed_at<=p.kickoff_at
      AND qq.source_updated_at<=qq.collected_at
      AND qq.source_updated_at>=qq.collected_at-interval '15 minutes'
      AND qq.bookmaker_key NOT IN ('betfair_ex_uk','smarkets','matchbook')
   ) AS followed_runs,
   (
    SELECT count(*)::integer
    FROM gerball_surebet_private.refresh_runs rr
    WHERE rr.event_id=p.event_id AND rr.kickoff_at=p.kickoff_at
      AND rr.uk_day=day
   ) AS attempts_today
  FROM pool p
 ), numbered AS(
  SELECT *,row_number() OVER(
   ORDER BY followed_runs ASC,attempts_today ASC,kickoff_at,football_data_league,event_id
  ) rn FROM ranked
 )
 SELECT n.* INTO fixture
 FROM numbered n
 WHERE n.rn=1;
 IF NOT FOUND THEN RETURN jsonb_build_object('claimed',false,'reason','no_upcoming_stored_events'); END IF;
 INSERT INTO gerball_surebet_private.refresh_runs(uk_day,slot,event_id,sport_key,league_code,home_team,away_team,kickoff_at)
 VALUES(day,slot_key,fixture.event_id,fixture.sport_key,fixture.football_data_league,
 fixture.home_team,fixture.away_team,fixture.kickoff_at) RETURNING id INTO run_id;
 RETURN jsonb_build_object('claimed',true,'id',run_id,'day',day,'slot',slot_key,
 'event_id',fixture.event_id,'sport_key',fixture.sport_key,'league',fixture.football_data_league,
 'home',fixture.home_team,'away',fixture.away_team,'kickoff_at',fixture.kickoff_at,'budget_remaining',28-cnt-1);
END $function$;
REVOKE ALL ON FUNCTION public.gerball_arb_claim(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gerball_arb_claim(text) TO service_role;
