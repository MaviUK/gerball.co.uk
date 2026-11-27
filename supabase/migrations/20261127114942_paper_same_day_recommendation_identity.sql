-- Preserve immutable advance-created research, while allowing a fresh paper
-- recommendation on the fixture's UK match day. Excluded advance rows must not
-- occupy the identity reserved for eligible same-day recommendations.
SET LOCAL lock_timeout = '5s';

CREATE UNIQUE INDEX gerball_paper_bets_same_day_event_key
ON gerball_advice_private.paper_bets (model_version, league_code, event_id)
WHERE (recorded_at AT TIME ZONE 'Europe/London')::date
    = (kickoff_at AT TIME ZONE 'Europe/London')::date;

CREATE UNIQUE INDEX gerball_paper_bets_same_day_fixture_key
ON gerball_advice_private.paper_bets
  (model_version, league_code, season, fixture_date, home_team, away_team)
WHERE (recorded_at AT TIME ZONE 'Europe/London')::date
    = (kickoff_at AT TIME ZONE 'Europe/London')::date;

-- Both replacement indexes are in place before removing the broader identities.
-- Keep the primary key, observation uniqueness, foreign keys and other checks.
ALTER TABLE gerball_advice_private.paper_bets
  DROP CONSTRAINT paper_bets_model_version_league_code_event_id_key,
  DROP CONSTRAINT paper_bets_model_version_league_code_season_fixture_date_ho_key;

CREATE OR REPLACE FUNCTION gerball_advice_private.check_paper_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
 src gerball_tracking_private.observations%ROWTYPE;
 recorded_day date;
BEGIN
 NEW.recorded_at:=clock_timestamp();
 recorded_day:=(NEW.recorded_at AT TIME ZONE 'Europe/London')::date;
 IF (NEW.kickoff_at AT TIME ZONE 'Europe/London')::date IS DISTINCT FROM recorded_day
 OR NEW.fixture_date IS DISTINCT FROM recorded_day THEN
 RAISE EXCEPTION 'paper_advice_requires_same_uk_day' USING ERRCODE='22023';
 END IF;
 SELECT * INTO STRICT src FROM gerball_tracking_private.observations WHERE id=NEW.observation_id;
 IF src.fixture_date IS DISTINCT FROM recorded_day
 OR (src.recorded_at AT TIME ZONE 'Europe/London')::date IS DISTINCT FROM recorded_day THEN
 RAISE EXCEPTION 'paper_advice_requires_same_day_observation' USING ERRCODE='22023';
 END IF;
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
$function$;

REVOKE ALL ON FUNCTION gerball_advice_private.check_paper_insert()
FROM PUBLIC,anon,authenticated,service_role;
