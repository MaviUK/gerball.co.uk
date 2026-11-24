-- Gerball odds collection infrastructure. Existing importer and match data are untouched.
-- Run as the project database owner. API credentials remain Edge Function secrets.
-- Scheduler authentication is generated in Vault; no secret value is returned.

CREATE SCHEMA IF NOT EXISTS gerball_odds_private;
REVOKE ALL ON SCHEMA gerball_odds_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA gerball_odds_private TO service_role;

CREATE TABLE IF NOT EXISTS gerball_odds_private.settings (
  name text PRIMARY KEY,
  token_sha256 text NOT NULL CHECK (token_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE gerball_odds_private.settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON gerball_odds_private.settings FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON gerball_odds_private.settings TO service_role;

DO $setup$
DECLARE
  v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets WHERE name = 'gerball_odds_cron_token';
  IF v_secret IS NULL THEN
    v_secret := encode(extensions.gen_random_bytes(32), 'hex');
    PERFORM vault.create_secret(v_secret, 'gerball_odds_cron_token',
      'Private authentication for Gerball daily odds collection');
  END IF;
  IF v_secret !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Existing Gerball odds scheduler token has an invalid format';
  END IF;
  INSERT INTO gerball_odds_private.settings(name, token_sha256)
  VALUES ('cron_token', encode(extensions.digest(v_secret, 'sha256'), 'hex'))
  ON CONFLICT (name) DO UPDATE SET token_sha256 = EXCLUDED.token_sha256;
END
$setup$;

CREATE TABLE IF NOT EXISTS public.gerball_odds_runs (
  collection_date date PRIMARY KEY,
  credential_slot text NOT NULL CHECK (credential_slot IN (
    'ODDS_API_KEY_MON', 'ODDS_API_KEY_TUE', 'ODDS_API_KEY_WED',
    'ODDS_API_KEY_THU', 'ODDS_API_KEY_FRI', 'ODDS_API_KEY_SAT', 'ODDS_API_KEY_SUN'
  )),
  owner uuid NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts > 0),
  status text NOT NULL CHECK (status IN ('running', 'completed', 'partial', 'failed')),
  manual boolean NOT NULL DEFAULT false,
  expected_leagues text[] NOT NULL CHECK (cardinality(expected_leagues) BETWEEN 1 AND 30),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  records_collected integer NOT NULL DEFAULT 0 CHECK (records_collected >= 0),
  requests_remaining integer CHECK (requests_remaining >= 0),
  requests_used integer CHECK (requests_used >= 0),
  requests_last integer CHECK (requests_last >= 0),
  error_message text CHECK (length(error_message) <= 2000)
);

CREATE TABLE IF NOT EXISTS public.gerball_odds_league_runs (
  collection_date date NOT NULL REFERENCES public.gerball_odds_runs(collection_date),
  sport_key text NOT NULL CHECK (sport_key ~ '^soccer_[a-z0-9_]+$'),
  status text NOT NULL CHECK (status IN ('completed', 'failed', 'inactive')),
  records_collected integer NOT NULL DEFAULT 0 CHECK (records_collected >= 0),
  event_count integer NOT NULL DEFAULT 0 CHECK (event_count >= 0),
  bookmaker_count integer NOT NULL DEFAULT 0 CHECK (bookmaker_count >= 0),
  h2h_records integer NOT NULL DEFAULT 0 CHECK (h2h_records >= 0),
  totals_records integer NOT NULL DEFAULT 0 CHECK (totals_records >= 0),
  requests_remaining integer CHECK (requests_remaining >= 0),
  requests_used integer CHECK (requests_used >= 0),
  requests_last integer CHECK (requests_last >= 0),
  error_message text CHECK (length(error_message) <= 2000),
  checked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (collection_date, sport_key)
);

CREATE TABLE IF NOT EXISTS public.gerball_odds_snapshots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider text NOT NULL CHECK (provider = 'the_odds_api'),
  event_id text NOT NULL CHECK (length(btrim(event_id)) BETWEEN 1 AND 200),
  sport_key text NOT NULL CHECK (sport_key ~ '^soccer_[a-z0-9_]+$'),
  football_data_league text CHECK (football_data_league ~ '^[A-Z][A-Z0-9]{0,4}$'),
  league text NOT NULL CHECK (length(btrim(league)) BETWEEN 1 AND 200),
  home_team text NOT NULL CHECK (length(btrim(home_team)) BETWEEN 1 AND 200),
  away_team text NOT NULL CHECK (length(btrim(away_team)) BETWEEN 1 AND 200),
  kickoff_at timestamptz NOT NULL,
  bookmaker_key text NOT NULL CHECK (length(btrim(bookmaker_key)) BETWEEN 1 AND 200),
  bookmaker_name text NOT NULL CHECK (length(btrim(bookmaker_name)) BETWEEN 1 AND 200),
  market text NOT NULL CHECK (market IN ('h2h', 'totals')),
  selection text NOT NULL CHECK (selection IN ('H', 'D', 'A', 'O25', 'U25')),
  line numeric NOT NULL,
  decimal_odds numeric NOT NULL CHECK (decimal_odds > 1 AND decimal_odds <= 10000),
  source_updated_at timestamptz NOT NULL,
  collected_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  collection_date date NOT NULL REFERENCES public.gerball_odds_runs(collection_date),
  response_sha256 text NOT NULL CHECK (response_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK (home_team <> away_team),
  CHECK (source_updated_at <= collected_at),
  CHECK (collected_at < kickoff_at AND recorded_at < kickoff_at),
  CHECK (collection_date = (collected_at AT TIME ZONE 'Europe/London')::date),
  CHECK ((market = 'h2h' AND selection IN ('H', 'D', 'A') AND line = 0)
    OR (market = 'totals' AND selection IN ('O25', 'U25') AND line = 2.5)),
  UNIQUE (provider, event_id, bookmaker_key, market, selection, line, collection_date)
);
CREATE INDEX IF NOT EXISTS gerball_odds_snapshots_kickoff_idx
  ON public.gerball_odds_snapshots(kickoff_at);
CREATE INDEX IF NOT EXISTS gerball_odds_snapshots_collection_sport_idx
  ON public.gerball_odds_snapshots(collection_date, sport_key);

ALTER TABLE public.gerball_odds_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gerball_odds_league_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gerball_odds_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gerball_odds_runs, public.gerball_odds_league_runs,
  public.gerball_odds_snapshots FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.gerball_odds_runs,
  public.gerball_odds_league_runs TO service_role;
GRANT SELECT, INSERT ON public.gerball_odds_snapshots TO service_role;
REVOKE ALL ON SEQUENCE public.gerball_odds_snapshots_id_seq
  FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.gerball_odds_snapshots_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.gerball_odds_authorized(p_digest text)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $function$
  SELECT COALESCE(p_digest ~ '^[a-f0-9]{64}$' AND EXISTS (
    SELECT 1 FROM gerball_odds_private.settings
    WHERE name = 'cron_token' AND token_sha256 = p_digest
  ), false);
$function$;

CREATE OR REPLACE FUNCTION public.gerball_odds_claim_run(
  p_date date, p_slot text, p_owner uuid, p_manual boolean, p_leagues text[]
)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $function$
DECLARE
  v_uk timestamp := clock_timestamp() AT TIME ZONE 'Europe/London';
  v_slot text;
  v_leagues text[];
  v_run public.gerball_odds_runs%ROWTYPE;
  v_inserted boolean := false;
  v_done jsonb;
BEGIN
  v_slot := (ARRAY['ODDS_API_KEY_MON', 'ODDS_API_KEY_TUE', 'ODDS_API_KEY_WED',
    'ODDS_API_KEY_THU', 'ODDS_API_KEY_FRI', 'ODDS_API_KEY_SAT', 'ODDS_API_KEY_SUN'])
    [extract(isodow FROM v_uk)::integer];
  IF p_date IS DISTINCT FROM v_uk::date OR p_slot IS DISTINCT FROM v_slot
      OR p_owner IS NULL OR p_manual IS NULL THEN
    RAISE EXCEPTION 'invalid_collection_identity';
  END IF;
  IF NOT p_manual AND NOT (v_uk::time >= time '12:00' AND v_uk::time < time '12:15') THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'outside_collection_window',
      'completed_leagues', '[]'::jsonb, 'attempt', 0);
  END IF;
  IF p_leagues IS NULL OR cardinality(p_leagues) NOT BETWEEN 1 AND 30
      OR EXISTS (SELECT 1 FROM unnest(p_leagues) AS t(k)
        WHERE k IS NULL OR k !~ '^soccer_[a-z0-9_]+$') THEN
    RAISE EXCEPTION 'invalid_league_configuration';
  END IF;
  SELECT array_agg(DISTINCT k ORDER BY k) INTO v_leagues FROM unnest(p_leagues) AS t(k);
  INSERT INTO public.gerball_odds_runs(collection_date, credential_slot, owner,
    lease_expires_at, status, manual, expected_leagues)
  VALUES (p_date, p_slot, p_owner, clock_timestamp() + interval '180 seconds',
    'running', p_manual, v_leagues)
  ON CONFLICT (collection_date) DO NOTHING RETURNING true INTO v_inserted;
  SELECT * INTO STRICT v_run FROM public.gerball_odds_runs
    WHERE collection_date = p_date FOR UPDATE;
  SELECT COALESCE(jsonb_agg(sport_key ORDER BY sport_key), '[]'::jsonb) INTO v_done
    FROM public.gerball_odds_league_runs
    WHERE collection_date = p_date AND status IN ('completed', 'inactive');
  IF v_run.expected_leagues IS DISTINCT FROM v_leagues THEN
    RAISE EXCEPTION 'daily_configuration_changed';
  END IF;
  IF v_inserted IS TRUE THEN
    RETURN jsonb_build_object('claimed', true, 'reason', 'created',
      'completed_leagues', v_done, 'attempt', 1);
  END IF;
  IF v_run.status = 'completed' THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'daily_run_completed',
      'completed_leagues', v_done, 'attempt', v_run.attempts);
  END IF;
  IF v_run.status = 'running' AND v_run.lease_expires_at > clock_timestamp() THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'daily_run_in_progress',
      'completed_leagues', v_done, 'attempt', v_run.attempts);
  END IF;
  IF NOT p_manual AND v_run.attempts >= 3 THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'automatic_attempt_limit',
      'completed_leagues', v_done, 'attempt', v_run.attempts);
  END IF;
  UPDATE public.gerball_odds_runs SET owner = p_owner,
    lease_expires_at = clock_timestamp() + interval '180 seconds',
    attempts = attempts + 1, status = 'running', manual = manual OR p_manual,
    updated_at = clock_timestamp(), completed_at = NULL, error_message = NULL
  WHERE collection_date = p_date RETURNING * INTO v_run;
  RETURN jsonb_build_object('claimed', true, 'reason', 'retry',
    'completed_leagues', v_done, 'attempt', v_run.attempts);
END
$function$;

CREATE OR REPLACE FUNCTION public.gerball_odds_store_league(
  p_date date, p_owner uuid, p_sport text, p_status text, p_rows jsonb, p_meta jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $function$
DECLARE
  v_run public.gerball_odds_runs%ROWTYPE;
  v_existing public.gerball_odds_league_runs%ROWTYPE;
  v_inserted integer := 0;
  v_total integer := 0;
  v_events integer := 0;
  v_bookmakers integer := 0;
  v_h2h integer := 0;
  v_totals integer := 0;
  v_meta record;
BEGIN
  SELECT * INTO STRICT v_run FROM public.gerball_odds_runs
    WHERE collection_date = p_date FOR UPDATE;
  IF v_run.owner IS DISTINCT FROM p_owner OR v_run.status <> 'running'
      OR v_run.lease_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'collection_lease_lost';
  END IF;
  IF p_sport IS NULL OR NOT (p_sport = ANY(v_run.expected_leagues))
      OR p_status IS NULL OR p_status NOT IN ('completed', 'failed', 'inactive')
      OR p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array'
      OR p_meta IS NULL OR jsonb_typeof(p_meta) <> 'object' THEN
    RAISE EXCEPTION 'invalid_league_result';
  END IF;
  IF jsonb_array_length(p_rows) > 20000
      OR (p_status <> 'completed' AND jsonb_array_length(p_rows) <> 0) THEN
    RAISE EXCEPTION 'invalid_snapshot_batch';
  END IF;
  SELECT * INTO v_existing FROM public.gerball_odds_league_runs
    WHERE collection_date = p_date AND sport_key = p_sport;
  IF FOUND AND v_existing.status IN ('completed', 'inactive') THEN
    RETURN jsonb_build_object('inserted', 0, 'total', v_existing.records_collected);
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_rows) AS t(r)
    WHERE jsonb_typeof(r) <> 'object'
       OR (r->>'sport_key') IS DISTINCT FROM p_sport
       OR (r->>'collection_date') IS DISTINCT FROM p_date::text
       OR (r->>'provider') IS DISTINCT FROM 'the_odds_api'
  ) THEN
    RAISE EXCEPTION 'snapshot_identity_mismatch';
  END IF;
  -- Explicit fields exclude caller control of IDs and the server recorded_at timestamp.
  INSERT INTO public.gerball_odds_snapshots(provider, event_id, sport_key,
    football_data_league, league, home_team, away_team, kickoff_at, bookmaker_key,
    bookmaker_name, market, selection, line, decimal_odds, source_updated_at,
    collected_at, collection_date, response_sha256)
  SELECT r.provider, r.event_id, r.sport_key, r.football_data_league, r.league,
    r.home_team, r.away_team, r.kickoff_at, r.bookmaker_key, r.bookmaker_name,
    r.market, r.selection, r.line, r.decimal_odds, r.source_updated_at,
    r.collected_at, r.collection_date, r.response_sha256
  FROM jsonb_to_recordset(p_rows) AS r(provider text, event_id text, sport_key text,
    football_data_league text, league text, home_team text, away_team text,
    kickoff_at timestamptz, bookmaker_key text, bookmaker_name text, market text,
    selection text, line numeric, decimal_odds numeric, source_updated_at timestamptz,
    collected_at timestamptz, collection_date date, response_sha256 text)
  -- A fixture may start while the provider response is being processed. Skip it
  -- rather than letting one imminent kickoff roll back every other valid quote.
  WHERE r.kickoff_at > clock_timestamp() + interval '15 seconds'
  ON CONFLICT (provider, event_id, bookmaker_key, market, selection, line, collection_date)
    DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  SELECT count(*)::integer, count(DISTINCT event_id)::integer,
    count(DISTINCT bookmaker_key)::integer,
    count(*) FILTER (WHERE market = 'h2h')::integer,
    count(*) FILTER (WHERE market = 'totals')::integer
  INTO v_total, v_events, v_bookmakers, v_h2h, v_totals
  FROM public.gerball_odds_snapshots
    WHERE collection_date = p_date AND sport_key = p_sport;
  SELECT * INTO v_meta FROM jsonb_to_record(p_meta) AS m(event_count integer,
    bookmaker_count integer, h2h_records integer, totals_records integer,
    requests_remaining integer, requests_used integer, requests_last integer,
    error_message text);
  INSERT INTO public.gerball_odds_league_runs(collection_date, sport_key, status,
    records_collected, event_count, bookmaker_count, h2h_records, totals_records,
    requests_remaining, requests_used, requests_last, error_message)
  VALUES (p_date, p_sport, p_status, v_total, v_events,
    v_bookmakers, v_h2h, v_totals, v_meta.requests_remaining, v_meta.requests_used,
    v_meta.requests_last, left(v_meta.error_message, 2000))
  ON CONFLICT (collection_date, sport_key) DO UPDATE SET
    status = EXCLUDED.status, records_collected = EXCLUDED.records_collected,
    event_count = EXCLUDED.event_count, bookmaker_count = EXCLUDED.bookmaker_count,
    h2h_records = EXCLUDED.h2h_records, totals_records = EXCLUDED.totals_records,
    requests_remaining = EXCLUDED.requests_remaining, requests_used = EXCLUDED.requests_used,
    requests_last = EXCLUDED.requests_last, error_message = EXCLUDED.error_message,
    checked_at = clock_timestamp();
  UPDATE public.gerball_odds_runs SET updated_at = clock_timestamp()
    WHERE collection_date = p_date;
  RETURN jsonb_build_object('inserted', v_inserted, 'total', v_total);
END
$function$;

CREATE OR REPLACE FUNCTION public.gerball_odds_finish_run(
  p_date date, p_owner uuid, p_error text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $function$
DECLARE
  v_run public.gerball_odds_runs%ROWTYPE;
  v_total integer;
  v_done integer;
  v_status text;
  v_remaining integer;
  v_used integer;
  v_last integer;
  v_leagues jsonb;
  v_failures jsonb;
  v_error text;
BEGIN
  SELECT * INTO STRICT v_run FROM public.gerball_odds_runs
    WHERE collection_date = p_date FOR UPDATE;
  IF v_run.owner IS DISTINCT FROM p_owner OR v_run.status <> 'running'
      OR v_run.lease_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'collection_lease_lost';
  END IF;
  SELECT count(*)::integer INTO v_total FROM public.gerball_odds_snapshots
    WHERE collection_date = p_date;
  SELECT count(*) FILTER (WHERE status IN ('completed', 'inactive'))::integer,
    min(requests_remaining), max(requests_used),
    COALESCE(jsonb_agg(jsonb_build_object('sport_key', sport_key, 'status', status,
      'records_collected', records_collected, 'event_count', event_count,
      'bookmaker_count', bookmaker_count, 'h2h_records', h2h_records,
      'totals_records', totals_records, 'requests_remaining', requests_remaining,
      'requests_used', requests_used, 'requests_last', requests_last,
      'error_message', error_message, 'checked_at', checked_at) ORDER BY sport_key),
      '[]'::jsonb)
  INTO v_done, v_remaining, v_used, v_leagues
  FROM public.gerball_odds_league_runs WHERE collection_date = p_date;
  SELECT requests_last INTO v_last FROM public.gerball_odds_league_runs
    WHERE collection_date = p_date AND requests_last IS NOT NULL
    ORDER BY requests_used DESC NULLS LAST, checked_at DESC LIMIT 1;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('sport_key', k,
    'error', COALESCE(l.error_message, 'league_incomplete')) ORDER BY k), '[]'::jsonb)
  INTO v_failures FROM unnest(v_run.expected_leagues) AS t(k)
  LEFT JOIN public.gerball_odds_league_runs AS l ON l.collection_date = p_date
    AND l.sport_key = k
  WHERE l.status IS NULL OR l.status = 'failed';
  v_error := NULLIF(left(p_error, 2000), '');
  v_status := CASE WHEN v_done = cardinality(v_run.expected_leagues) AND v_error IS NULL
    THEN 'completed' WHEN v_total > 0 THEN 'partial' ELSE 'failed' END;
  IF v_error IS NULL AND v_status <> 'completed' THEN
    v_error := 'One or more configured leagues require retry';
  END IF;
  UPDATE public.gerball_odds_runs SET status = v_status, records_collected = v_total,
    requests_remaining = v_remaining, requests_used = v_used, requests_last = v_last,
    error_message = v_error, completed_at = clock_timestamp(), updated_at = clock_timestamp(),
    lease_expires_at = clock_timestamp()
  WHERE collection_date = p_date RETURNING * INTO v_run;
  RETURN jsonb_build_object('status', v_status, 'collection_date', p_date,
    'credential_slot', v_run.credential_slot, 'attempts', v_run.attempts,
    'manual', v_run.manual, 'records_collected', v_total,
    'requests_remaining', v_remaining, 'requests_used', v_used, 'requests_last', v_last,
    'error_message', v_error, 'failures', v_failures, 'leagues', v_leagues,
    'started_at', v_run.started_at, 'completed_at', v_run.completed_at);
END
$function$;

REVOKE ALL ON FUNCTION public.gerball_odds_authorized(text),
  public.gerball_odds_claim_run(date, text, uuid, boolean, text[]),
  public.gerball_odds_store_league(date, uuid, text, text, jsonb, jsonb),
  public.gerball_odds_finish_run(date, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gerball_odds_authorized(text),
  public.gerball_odds_claim_run(date, text, uuid, boolean, text[]),
  public.gerball_odds_store_league(date, uuid, text, text, jsonb, jsonb),
  public.gerball_odds_finish_run(date, uuid, text)
  TO service_role;

NOTIFY pgrst, 'reload schema';
