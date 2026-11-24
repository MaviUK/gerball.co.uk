-- Read model for collected upcoming odds and historical team form.
-- The public Edge Function calls this RPC with its server-side service role.
-- Existing collection, importer, historical tables and prediction functions are unchanged.

CREATE TABLE IF NOT EXISTS public.gerball_team_aliases (
  provider text NOT NULL CHECK (provider = 'the_odds_api'),
  league_code text NOT NULL CHECK (league_code ~ '^[A-Z][A-Z0-9]{0,4}$'),
  provider_name text NOT NULL CHECK (length(btrim(provider_name)) BETWEEN 1 AND 200),
  canonical_name text NOT NULL CHECK (length(btrim(canonical_name)) BETWEEN 1 AND 200),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (provider, league_code, provider_name)
);
ALTER TABLE public.gerball_team_aliases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gerball_team_aliases FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.gerball_team_aliases TO service_role;

CREATE OR REPLACE FUNCTION public.gerball_upcoming_data(
  p_league text DEFAULT NULL,
  p_days integer DEFAULT 14,
  p_event_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = ''
AS $function$
DECLARE
  v_now timestamptz := statement_timestamp();
  v_output jsonb;
BEGIN
  IF p_days IS NULL OR p_days < 1 OR p_days > 31
      OR (p_league IS NOT NULL AND p_league !~ '^[A-Z][A-Z0-9]{0,4}$')
      OR (p_event_id IS NOT NULL AND (length(p_event_id) NOT BETWEEN 1 AND 200
        OR p_event_id !~ '^[A-Za-z0-9_-]+$')) THEN
    RAISE EXCEPTION 'invalid_upcoming_parameters' USING ERRCODE = '22023';
  END IF;

  WITH latest_run AS MATERIALIZED (
    SELECT r.collection_date, r.status
    FROM public.gerball_odds_runs AS r
    WHERE r.status IN ('completed', 'partial')
      AND EXISTS (SELECT 1 FROM public.gerball_odds_snapshots AS s
        WHERE s.collection_date = r.collection_date)
    ORDER BY r.collection_date DESC LIMIT 1
  ), collection_info AS (
    SELECT max(s.collected_at) AS collected_at
    FROM public.gerball_odds_snapshots AS s
    JOIN latest_run AS r USING (collection_date)
  ), eligible_odds AS MATERIALIZED (
    SELECT s.* FROM public.gerball_odds_snapshots AS s
    JOIN latest_run AS r USING (collection_date)
    WHERE s.kickoff_at > v_now
      AND s.kickoff_at <= ((v_now AT TIME ZONE 'Europe/London')
        + make_interval(days => p_days)) AT TIME ZONE 'Europe/London'
      AND (p_league IS NULL OR s.football_data_league = p_league)
      AND (p_event_id IS NULL OR s.event_id = p_event_id)
  ), fixture_base AS MATERIALIZED (
    SELECT DISTINCT ON (s.event_id) s.provider, s.event_id, s.sport_key,
      s.football_data_league AS league_code, s.league AS league_name,
      s.kickoff_at, s.home_team, s.away_team,
      (s.kickoff_at AT TIME ZONE 'Europe/London')::date AS fixture_date,
      to_char((s.kickoff_at AT TIME ZONE 'Europe/London') - interval '6 months', 'YY')
        || to_char((s.kickoff_at AT TIME ZONE 'Europe/London') + interval '6 months', 'YY')
        AS season
    FROM eligible_odds AS s
    ORDER BY s.event_id, s.collected_at DESC, s.id DESC
  ), wanted_seasons AS MATERIALIZED (
    SELECT DISTINCT league_code, season FROM fixture_base WHERE league_code IS NOT NULL
  ), seasonal_matches AS MATERIALIZED (
    -- Keep the lookup parameterized by league and season. The existing composite
    -- index serves these small slices without scanning the whole historical table.
    SELECT m.* FROM wanted_seasons AS w
    CROSS JOIN LATERAL (
      SELECT m.id, m.league, m.season, m.match_date, m.home_team, m.away_team,
        m.full_time_result, m.home_goals, m.away_goals
      FROM public.matches AS m
      WHERE m.league = w.league_code AND m.season = w.season
        AND m.full_time_result IN ('H', 'D', 'A')
        AND m.home_goals >= 0 AND m.away_goals >= 0
        AND m.match_date <= (v_now AT TIME ZONE 'Europe/London')::date
      OFFSET 0
    ) AS m
  ), current_names AS MATERIALIZED (
    SELECT league AS league_code, home_team AS team_name FROM seasonal_matches
    UNION
    SELECT league AS league_code, away_team AS team_name FROM seasonal_matches
  ), fixture_teams AS MATERIALIZED (
    SELECT f.provider, f.event_id, f.league_code, f.fixture_date, f.season,
      t.side, t.provider_name, a.canonical_name AS alias_name
    FROM fixture_base AS f
    CROSS JOIN LATERAL (VALUES ('home', f.home_team), ('away', f.away_team))
      AS t(side, provider_name)
    LEFT JOIN public.gerball_team_aliases AS a ON a.provider = f.provider
      AND a.league_code = f.league_code AND a.provider_name = t.provider_name
  ), old_alias_candidates AS MATERIALIZED (
    SELECT DISTINCT t.league_code, t.alias_name AS team_name
    FROM fixture_teams AS t
    WHERE t.alias_name IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM current_names AS n
      WHERE n.league_code = t.league_code AND n.team_name = t.alias_name
    )
  ), old_alias_names AS MATERIALIZED (
    -- An alias can still identify a club with only older same-league history.
    -- Only unresolved candidate names require a historical probe.
    SELECT c.* FROM old_alias_candidates AS c
    CROSS JOIN LATERAL (
      SELECT 1 FROM public.matches AS m
      WHERE m.league = c.league_code
        AND (m.home_team = c.team_name OR m.away_team = c.team_name)
        AND m.match_date <= (v_now AT TIME ZONE 'Europe/London')::date
      LIMIT 1
    ) AS found
  ), valid_alias_names AS (
    SELECT * FROM current_names UNION ALL SELECT * FROM old_alias_names
  ), current_mapping AS MATERIALIZED (
    SELECT t.*,
      CASE WHEN alias_target.team_name IS NOT NULL THEN t.alias_name
        WHEN exact_name.team_name IS NOT NULL THEN t.provider_name ELSE NULL END AS current_canonical,
      CASE WHEN alias_target.team_name IS NOT NULL THEN 'alias'
        WHEN exact_name.team_name IS NOT NULL THEN 'exact' ELSE 'unmatched' END AS current_status
    FROM fixture_teams AS t
    LEFT JOIN valid_alias_names AS alias_target ON alias_target.league_code = t.league_code
      AND alias_target.team_name = t.alias_name
    LEFT JOIN current_names AS exact_name ON exact_name.league_code = t.league_code
      AND exact_name.team_name = t.provider_name
  ), old_exact_candidates AS MATERIALIZED (
    SELECT DISTINCT league_code, provider_name AS team_name
    FROM current_mapping WHERE current_canonical IS NULL
  ), old_exact_names AS MATERIALIZED (
    SELECT c.* FROM old_exact_candidates AS c
    CROSS JOIN LATERAL (
      SELECT 1 FROM public.matches AS m
      WHERE m.league = c.league_code
        AND (m.home_team = c.team_name OR m.away_team = c.team_name)
        AND m.match_date <= (v_now AT TIME ZONE 'Europe/London')::date
      LIMIT 1
    ) AS found
  ), mapped_teams AS MATERIALIZED (
    SELECT t.*, COALESCE(t.current_canonical, old_name.team_name) AS canonical_name,
      CASE WHEN t.current_canonical IS NOT NULL THEN t.current_status
        WHEN old_name.team_name IS NOT NULL THEN 'exact' ELSE 'unmatched' END AS match_status
    FROM current_mapping AS t
    LEFT JOIN old_exact_names AS old_name ON old_name.league_code = t.league_code
      AND old_name.team_name = t.provider_name
  ), stats_keys AS MATERIALIZED (
    SELECT DISTINCT league_code, season, canonical_name, fixture_date
    FROM mapped_teams WHERE canonical_name IS NOT NULL
  ), team_results AS MATERIALIZED (
    SELECT m.id, m.league AS league_code, m.season, m.match_date,
      t.team_name, t.venue, t.goals_for, t.goals_against, t.result,
      CASE t.result WHEN 'W' THEN 3 WHEN 'D' THEN 1 ELSE 0 END AS points
    FROM seasonal_matches AS m
    CROSS JOIN LATERAL (VALUES
      (m.home_team, 'home', m.home_goals, m.away_goals,
        CASE m.full_time_result WHEN 'H' THEN 'W' WHEN 'D' THEN 'D' ELSE 'L' END),
      (m.away_team, 'away', m.away_goals, m.home_goals,
        CASE m.full_time_result WHEN 'A' THEN 'W' WHEN 'D' THEN 'D' ELSE 'L' END)
    ) AS t(team_name, venue, goals_for, goals_against, result)
  ), ranked_results AS (
    SELECT k.league_code, k.season, k.canonical_name, k.fixture_date,
      r.id, r.match_date, r.venue, r.goals_for, r.goals_against, r.result, r.points,
      row_number() OVER (PARTITION BY k.league_code, k.season, k.canonical_name, k.fixture_date
        ORDER BY r.match_date DESC, r.id DESC) AS recent_rank
    FROM stats_keys AS k JOIN team_results AS r ON r.league_code = k.league_code
      AND r.season = k.season AND r.team_name = k.canonical_name
      -- Results on the fixture's own date are excluded because historical kickoff times
      -- are not available consistently. This also prevents same-day lookahead.
      AND r.match_date < k.fixture_date
  ), team_stats AS (
    SELECT league_code, season, canonical_name, fixture_date,
      jsonb_build_object(
        'season', season, 'played', count(*),
        'wins', count(*) FILTER (WHERE result = 'W'),
        'draws', count(*) FILTER (WHERE result = 'D'),
        'losses', count(*) FILTER (WHERE result = 'L'),
        'goals_for', sum(goals_for), 'goals_against', sum(goals_against),
        'ppg', round(sum(points)::numeric / count(*), 2),
        'form', string_agg(result, '' ORDER BY match_date, id) FILTER (WHERE recent_rank <= 5),
        'last_match_date', max(match_date),
        'home_played', count(*) FILTER (WHERE venue = 'home'),
        'home_ppg', round(sum(points) FILTER (WHERE venue = 'home')::numeric
          / NULLIF(count(*) FILTER (WHERE venue = 'home'), 0), 2),
        'away_played', count(*) FILTER (WHERE venue = 'away'),
        'away_ppg', round(sum(points) FILTER (WHERE venue = 'away')::numeric
          / NULLIF(count(*) FILTER (WHERE venue = 'away'), 0), 2)
      ) AS stats
    FROM ranked_results GROUP BY league_code, season, canonical_name, fixture_date
  ), fixture_team_data AS (
    SELECT t.event_id, jsonb_object_agg(t.side, jsonb_build_object(
      'provider_name', t.provider_name, 'canonical_name', t.canonical_name,
      'match_status', t.match_status, 'stats', s.stats
    )) AS teams
    FROM mapped_teams AS t LEFT JOIN team_stats AS s ON s.league_code = t.league_code
      AND s.season = t.season AND s.canonical_name = t.canonical_name
      AND s.fixture_date = t.fixture_date
    GROUP BY t.event_id
  ), ranked_prices AS (
    SELECT s.*, row_number() OVER (PARTITION BY s.event_id, s.selection
      ORDER BY s.decimal_odds DESC, s.source_updated_at DESC,
        s.collected_at DESC, s.bookmaker_key ASC, s.id ASC) AS price_rank
    FROM eligible_odds AS s
  ), best_prices AS (
    SELECT event_id, jsonb_build_object('H', NULL, 'D', NULL, 'A', NULL, 'O25', NULL, 'U25', NULL)
      || jsonb_object_agg(selection, jsonb_build_object(
        'price', decimal_odds, 'bookmaker_key', bookmaker_key,
        'bookmaker_name', bookmaker_name, 'source_updated_at', source_updated_at,
        'collected_at', collected_at
      )) AS markets
    FROM ranked_prices WHERE price_rank = 1 GROUP BY event_id
  ), bookmaker_counts AS (
    SELECT event_id, count(DISTINCT bookmaker_key) AS bookmaker_count
    FROM eligible_odds GROUP BY event_id
  ), bookmaker_market_data AS (
    SELECT event_id, bookmaker_key, max(bookmaker_name) AS bookmaker_name,
      jsonb_build_object('H', NULL, 'D', NULL, 'A', NULL, 'O25', NULL, 'U25', NULL)
      || jsonb_object_agg(selection, jsonb_build_object('price', decimal_odds,
        'source_updated_at', source_updated_at, 'collected_at', collected_at)) AS markets
    FROM eligible_odds WHERE p_event_id IS NOT NULL
    GROUP BY event_id, bookmaker_key
  ), bookmaker_details AS (
    SELECT event_id, jsonb_agg(jsonb_build_object('key', bookmaker_key,
      'name', bookmaker_name, 'markets', markets) ORDER BY bookmaker_name, bookmaker_key)
      AS bookmakers
    FROM bookmaker_market_data GROUP BY event_id
  ), mapping_totals AS (
    SELECT count(*) AS total_teams,
      count(*) FILTER (WHERE match_status <> 'unmatched') AS matched_teams
    FROM (SELECT DISTINCT league_code, provider_name, match_status FROM mapped_teams) AS names
  ), fixture_output AS (
    SELECT f.kickoff_at, f.league_code, f.event_id,
      jsonb_build_object('event_id', f.event_id, 'sport_key', f.sport_key,
        'league_code', f.league_code, 'league_name', f.league_name, 'kickoff_at', f.kickoff_at,
        'home', t.teams->'home', 'away', t.teams->'away', 'markets', p.markets,
        'bookmaker_count', b.bookmaker_count,
        'bookmakers', COALESCE(d.bookmakers, '[]'::jsonb),
        'bookmakers_loaded', p_event_id IS NOT NULL) AS fixture
    FROM fixture_base AS f
    JOIN fixture_team_data AS t USING (event_id)
    JOIN best_prices AS p USING (event_id)
    JOIN bookmaker_counts AS b USING (event_id)
    LEFT JOIN bookmaker_details AS d USING (event_id)
  )
  SELECT jsonb_build_object(
    'collected_at', (SELECT collected_at FROM collection_info),
    'collection_date', (SELECT collection_date FROM latest_run),
    'collection_status', COALESCE((SELECT status FROM latest_run), 'no_data'),
    'timezone', 'Europe/London', 'generated_at', v_now,
    'mapping', (SELECT jsonb_build_object('matched_teams', matched_teams,
      'total_teams', total_teams) FROM mapping_totals),
    'fixtures', (SELECT COALESCE(jsonb_agg(fixture ORDER BY kickoff_at, league_code, event_id),
      '[]'::jsonb) FROM fixture_output)
  ) INTO v_output;
  RETURN v_output;
END
$function$;

REVOKE ALL ON FUNCTION public.gerball_upcoming_data(text, integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gerball_upcoming_data(text, integer, text) TO service_role;
NOTIFY pgrst, 'reload schema';

-- Reviewed identity mapping: source data and metadata evidence are in data/team-aliases.json.
INSERT INTO public.gerball_team_aliases (provider, league_code, provider_name, canonical_name, reason)
SELECT provider, league_code, provider_name, canonical_name, reason
FROM jsonb_to_recordset($aliases$
[
  {
    "provider": "the_odds_api",
    "league_code": "B1",
    "provider_name": "Cercle Brugge KSV",
    "canonical_name": "Cercle Brugge",
    "reason": "KSV club suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "B1",
    "provider_name": "KV Kortrijk",
    "canonical_name": "Kortrijk",
    "reason": "KV club prefix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "B1",
    "provider_name": "KV Mechelen",
    "canonical_name": "Mechelen",
    "reason": "KV club prefix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "B1",
    "provider_name": "Leuven",
    "canonical_name": "Oud-Heverlee Leuven",
    "reason": "Stored name includes the Oud-Heverlee prefix."
  },
  {
    "provider": "the_odds_api",
    "league_code": "B1",
    "provider_name": "RAAL La Louvière",
    "canonical_name": "RAAL La Louviere",
    "reason": "Accent-only spelling difference."
  },
  {
    "provider": "the_odds_api",
    "league_code": "B1",
    "provider_name": "Royal Antwerp",
    "canonical_name": "Antwerp",
    "reason": "Royal prefix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "B1",
    "provider_name": "Sint Truiden",
    "canonical_name": "St Truiden",
    "reason": "Sint is abbreviated to St in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "B1",
    "provider_name": "SK Beveren",
    "canonical_name": "Beveren",
    "reason": "SK club prefix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "B1",
    "provider_name": "Standard Liege",
    "canonical_name": "Standard",
    "reason": "Liege location suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "B1",
    "provider_name": "SV Zulte-Waregem",
    "canonical_name": "Waregem",
    "reason": "Stored name abbreviates the expanded Zulte-Waregem name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "B1",
    "provider_name": "Union Saint-Gilloise",
    "canonical_name": "St. Gilloise",
    "reason": "Stored name abbreviates Saint and omits Union."
  },
  {
    "provider": "the_odds_api",
    "league_code": "D1",
    "provider_name": "1. FC Köln",
    "canonical_name": "FC Koln",
    "reason": "Number prefix and accent omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "D1",
    "provider_name": "Bayer Leverkusen",
    "canonical_name": "Leverkusen",
    "reason": "Bayer prefix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "D1",
    "provider_name": "Borussia Dortmund",
    "canonical_name": "Dortmund",
    "reason": "Borussia prefix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "D1",
    "provider_name": "Borussia Monchengladbach",
    "canonical_name": "M'gladbach",
    "reason": "Stored abbreviation of Monchengladbach."
  },
  {
    "provider": "the_odds_api",
    "league_code": "D1",
    "provider_name": "Eintracht Frankfurt",
    "canonical_name": "Ein Frankfurt",
    "reason": "Eintracht is abbreviated to Ein in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "D1",
    "provider_name": "FC Schalke 04",
    "canonical_name": "Schalke 04",
    "reason": "FC club prefix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "D1",
    "provider_name": "FSV Mainz 05",
    "canonical_name": "Mainz",
    "reason": "FSV prefix and 05 suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "D1",
    "provider_name": "Hamburger SV",
    "canonical_name": "Hamburg",
    "reason": "Stored short form of Hamburger SV."
  },
  {
    "provider": "the_odds_api",
    "league_code": "D1",
    "provider_name": "SC Freiburg",
    "canonical_name": "Freiburg",
    "reason": "SC club prefix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "D1",
    "provider_name": "SC Paderborn",
    "canonical_name": "Paderborn",
    "reason": "SC club prefix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "D1",
    "provider_name": "TSG Hoffenheim",
    "canonical_name": "Hoffenheim",
    "reason": "TSG club prefix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "D1",
    "provider_name": "VfB Stuttgart",
    "canonical_name": "Stuttgart",
    "reason": "VfB club prefix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "D2",
    "provider_name": "1. FC Heidenheim",
    "canonical_name": "Heidenheim",
    "reason": "Number and FC club prefixes omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "D2",
    "provider_name": "1. FC Kaiserslautern",
    "canonical_name": "Kaiserslautern",
    "reason": "Number and FC club prefixes omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "D2",
    "provider_name": "1. FC Magdeburg",
    "canonical_name": "Magdeburg",
    "reason": "Number and FC club prefixes omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "D2",
    "provider_name": "1. FC Nürnberg",
    "canonical_name": "Nurnberg",
    "reason": "Club prefixes and accent omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "D2",
    "provider_name": "Arminia Bielefeld",
    "canonical_name": "Bielefeld",
    "reason": "Arminia prefix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "D2",
    "provider_name": "Dynamo Dresden",
    "canonical_name": "Dresden",
    "reason": "Dynamo prefix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "D2",
    "provider_name": "Eintracht Braunschweig",
    "canonical_name": "Braunschweig",
    "reason": "Eintracht prefix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "D2",
    "provider_name": "FC Energie Cottbus",
    "canonical_name": "Cottbus",
    "reason": "FC Energie prefixes omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "D2",
    "provider_name": "FC St. Pauli",
    "canonical_name": "St Pauli",
    "reason": "FC prefix and punctuation omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "D2",
    "provider_name": "Greuther Fürth",
    "canonical_name": "Greuther Furth",
    "reason": "Accent-only spelling difference."
  },
  {
    "provider": "the_odds_api",
    "league_code": "D2",
    "provider_name": "Hannover 96",
    "canonical_name": "Hannover",
    "reason": "96 suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "D2",
    "provider_name": "Hertha Berlin",
    "canonical_name": "Hertha",
    "reason": "Berlin location suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "D2",
    "provider_name": "Karlsruher SC",
    "canonical_name": "Karlsruhe",
    "reason": "Stored short form of Karlsruher SC."
  },
  {
    "provider": "the_odds_api",
    "league_code": "D2",
    "provider_name": "SV Darmstadt 98",
    "canonical_name": "Darmstadt",
    "reason": "SV prefix and 98 suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "D2",
    "provider_name": "VfL Bochum",
    "canonical_name": "Bochum",
    "reason": "VfL club prefix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "D2",
    "provider_name": "VfL Osnabrück",
    "canonical_name": "Osnabruck",
    "reason": "VfL prefix and accent omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "D2",
    "provider_name": "VfL Wolfsburg",
    "canonical_name": "Wolfsburg",
    "reason": "VfL club prefix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "E0",
    "provider_name": "Brighton and Hove Albion",
    "canonical_name": "Brighton",
    "reason": "Stored short form of the expanded club name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "E0",
    "provider_name": "Coventry City",
    "canonical_name": "Coventry",
    "reason": "City suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "E0",
    "provider_name": "Hull City",
    "canonical_name": "Hull",
    "reason": "City suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "E0",
    "provider_name": "Ipswich Town",
    "canonical_name": "Ipswich",
    "reason": "Town suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "E0",
    "provider_name": "Leeds United",
    "canonical_name": "Leeds",
    "reason": "United suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "E0",
    "provider_name": "Manchester City",
    "canonical_name": "Man City",
    "reason": "Manchester is abbreviated to Man in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "E0",
    "provider_name": "Manchester United",
    "canonical_name": "Man United",
    "reason": "Manchester is abbreviated to Man in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "E0",
    "provider_name": "Newcastle United",
    "canonical_name": "Newcastle",
    "reason": "United suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "E0",
    "provider_name": "Nottingham Forest",
    "canonical_name": "Nott'm Forest",
    "reason": "Nottingham is abbreviated to Nott'm in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "E0",
    "provider_name": "Tottenham Hotspur",
    "canonical_name": "Tottenham",
    "reason": "Hotspur suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "E1",
    "provider_name": "Birmingham City",
    "canonical_name": "Birmingham",
    "reason": "City suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "E1",
    "provider_name": "Blackburn Rovers",
    "canonical_name": "Blackburn",
    "reason": "Rovers suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "E1",
    "provider_name": "Bolton Wanderers",
    "canonical_name": "Bolton",
    "reason": "Wanderers suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "E1",
    "provider_name": "Cardiff City",
    "canonical_name": "Cardiff",
    "reason": "City suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "E1",
    "provider_name": "Charlton Athletic",
    "canonical_name": "Charlton",
    "reason": "Athletic suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "E1",
    "provider_name": "Derby County",
    "canonical_name": "Derby",
    "reason": "County suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "E1",
    "provider_name": "Lincoln City",
    "canonical_name": "Lincoln",
    "reason": "City suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "E1",
    "provider_name": "Norwich City",
    "canonical_name": "Norwich",
    "reason": "City suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "E1",
    "provider_name": "Preston North End",
    "canonical_name": "Preston",
    "reason": "North End suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "E1",
    "provider_name": "Queens Park Rangers",
    "canonical_name": "QPR",
    "reason": "Stored initials of Queens Park Rangers."
  },
  {
    "provider": "the_odds_api",
    "league_code": "E1",
    "provider_name": "Stoke City",
    "canonical_name": "Stoke",
    "reason": "City suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "E1",
    "provider_name": "Swansea City",
    "canonical_name": "Swansea",
    "reason": "City suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "E1",
    "provider_name": "West Bromwich Albion",
    "canonical_name": "West Brom",
    "reason": "Stored short form of West Bromwich Albion."
  },
  {
    "provider": "the_odds_api",
    "league_code": "E1",
    "provider_name": "West Ham United",
    "canonical_name": "West Ham",
    "reason": "United suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "E1",
    "provider_name": "Wolverhampton Wanderers",
    "canonical_name": "Wolves",
    "reason": "Stored common short name for Wolverhampton Wanderers."
  },
  {
    "provider": "the_odds_api",
    "league_code": "E1",
    "provider_name": "Wrexham AFC",
    "canonical_name": "Wrexham",
    "reason": "AFC club suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "E2",
    "provider_name": "Bradford City",
    "canonical_name": "Bradford",
    "reason": "City suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "E2",
    "provider_name": "Bromley FC",
    "canonical_name": "Bromley",
    "reason": "FC club suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "E2",
    "provider_name": "Burton Albion",
    "canonical_name": "Burton",
    "reason": "Albion suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "E2",
    "provider_name": "Cambridge United",
    "canonical_name": "Cambridge",
    "reason": "United suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "E2",
    "provider_name": "Doncaster Rovers",
    "canonical_name": "Doncaster",
    "reason": "Rovers suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "E2",
    "provider_name": "Huddersfield Town",
    "canonical_name": "Huddersfield",
    "reason": "Town suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "E2",
    "provider_name": "Leicester City",
    "canonical_name": "Leicester",
    "reason": "City suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "E2",
    "provider_name": "Mansfield Town",
    "canonical_name": "Mansfield",
    "reason": "Town suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "E2",
    "provider_name": "Oxford United",
    "canonical_name": "Oxford",
    "reason": "United suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "E2",
    "provider_name": "Peterborough United",
    "canonical_name": "Peterboro",
    "reason": "Stored shortened Peterborough spelling with United omitted."
  },
  {
    "provider": "the_odds_api",
    "league_code": "E2",
    "provider_name": "Plymouth Argyle",
    "canonical_name": "Plymouth",
    "reason": "Argyle suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "E2",
    "provider_name": "Sheffield Wednesday",
    "canonical_name": "Sheffield Weds",
    "reason": "Wednesday is abbreviated to Weds in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "E2",
    "provider_name": "Stockport County FC",
    "canonical_name": "Stockport",
    "reason": "County and FC suffixes omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "E2",
    "provider_name": "Wigan Athletic",
    "canonical_name": "Wigan",
    "reason": "Athletic suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "E2",
    "provider_name": "Wimbledon",
    "canonical_name": "AFC Wimbledon",
    "reason": "Official AFC Wimbledon site uses Wimbledon for its current League One team; this maps no legacy Wimbledon records."
  },
  {
    "provider": "the_odds_api",
    "league_code": "E2",
    "provider_name": "Wycombe Wanderers",
    "canonical_name": "Wycombe",
    "reason": "Wanderers suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "E3",
    "provider_name": "Accrington Stanley",
    "canonical_name": "Accrington",
    "reason": "Stanley suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "E3",
    "provider_name": "Bristol Rovers",
    "canonical_name": "Bristol Rvs",
    "reason": "Rovers is abbreviated to Rvs in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "E3",
    "provider_name": "Cheltenham Town",
    "canonical_name": "Cheltenham",
    "reason": "Town suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "E3",
    "provider_name": "Chesterfield FC",
    "canonical_name": "Chesterfield",
    "reason": "FC club suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "E3",
    "provider_name": "Colchester United",
    "canonical_name": "Colchester",
    "reason": "United suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "E3",
    "provider_name": "Crewe Alexandra",
    "canonical_name": "Crewe",
    "reason": "Alexandra suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "E3",
    "provider_name": "Exeter City",
    "canonical_name": "Exeter",
    "reason": "City suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "E3",
    "provider_name": "Grimsby Town",
    "canonical_name": "Grimsby",
    "reason": "Town suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "E3",
    "provider_name": "Northampton Town",
    "canonical_name": "Northampton",
    "reason": "Town suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "E3",
    "provider_name": "Oldham Athletic",
    "canonical_name": "Oldham",
    "reason": "Athletic suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "E3",
    "provider_name": "Rotherham United",
    "canonical_name": "Rotherham",
    "reason": "United suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "E3",
    "provider_name": "Salford City",
    "canonical_name": "Salford",
    "reason": "City suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "E3",
    "provider_name": "Shrewsbury Town",
    "canonical_name": "Shrewsbury",
    "reason": "Town suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "E3",
    "provider_name": "Swindon Town",
    "canonical_name": "Swindon",
    "reason": "Town suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "E3",
    "provider_name": "Tranmere Rovers",
    "canonical_name": "Tranmere",
    "reason": "Rovers suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "E3",
    "provider_name": "York City",
    "canonical_name": "York",
    "reason": "City suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "F1",
    "provider_name": "AS Monaco",
    "canonical_name": "Monaco",
    "reason": "AS club prefix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "F1",
    "provider_name": "Le Mans FC",
    "canonical_name": "Le Mans",
    "reason": "FC club suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "F1",
    "provider_name": "Paris Saint Germain",
    "canonical_name": "Paris SG",
    "reason": "Saint Germain is abbreviated to SG in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "F1",
    "provider_name": "RC Lens",
    "canonical_name": "Lens",
    "reason": "RC club prefix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "G1",
    "provider_name": "AE Kifisia FC",
    "canonical_name": "Kifisia",
    "reason": "AE prefix and FC suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "G1",
    "provider_name": "AEK Athens",
    "canonical_name": "AEK",
    "reason": "Athens location suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "G1",
    "provider_name": "Aris Thessaloniki",
    "canonical_name": "Aris",
    "reason": "Thessaloniki location suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "G1",
    "provider_name": "Atromitos Athens",
    "canonical_name": "Atromitos",
    "reason": "Athens location suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "G1",
    "provider_name": "Iraklis FC",
    "canonical_name": "Iraklis",
    "reason": "FC club suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "G1",
    "provider_name": "Kalamata FC",
    "canonical_name": "Kalamata",
    "reason": "FC club suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "G1",
    "provider_name": "Levadiakos",
    "canonical_name": "Levadeiakos",
    "reason": "Reviewed transliteration variant; the current stored team spelling is Levadeiakos, superseding the old exact spelling."
  },
  {
    "provider": "the_odds_api",
    "league_code": "G1",
    "provider_name": "Olympiakos Piraeus",
    "canonical_name": "Olympiakos",
    "reason": "Piraeus location suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "G1",
    "provider_name": "Panetolikos Agrinio",
    "canonical_name": "Panetolikos",
    "reason": "Agrinio location suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "G1",
    "provider_name": "PAOK Thessaloniki",
    "canonical_name": "PAOK",
    "reason": "Thessaloniki location suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "G1",
    "provider_name": "Volos FC",
    "canonical_name": "Volos NFC",
    "reason": "Stored NFC suffix variant retains the distinct Volos name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "I1",
    "provider_name": "AC Milan",
    "canonical_name": "Milan",
    "reason": "AC club prefix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "I1",
    "provider_name": "AS Roma",
    "canonical_name": "Roma",
    "reason": "AS club prefix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "I1",
    "provider_name": "Atalanta BC",
    "canonical_name": "Atalanta",
    "reason": "BC club suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "I1",
    "provider_name": "Inter Milan",
    "canonical_name": "Inter",
    "reason": "Milan location suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "I2",
    "provider_name": "Cesena FC",
    "canonical_name": "Cesena",
    "reason": "FC club suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "I2",
    "provider_name": "Hellas Verona",
    "canonical_name": "Verona",
    "reason": "Hellas prefix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "I2",
    "provider_name": "Südtirol",
    "canonical_name": "Sudtirol",
    "reason": "Accent-only spelling difference."
  },
  {
    "provider": "the_odds_api",
    "league_code": "I2",
    "provider_name": "US Catanzaro 1929",
    "canonical_name": "Catanzaro",
    "reason": "US prefix and 1929 suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "N1",
    "provider_name": "ADO Den Haag",
    "canonical_name": "Den Haag",
    "reason": "ADO club prefix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "N1",
    "provider_name": "FC Twente Enschede",
    "canonical_name": "Twente",
    "reason": "FC prefix and Enschede location suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "N1",
    "provider_name": "FC Utrecht",
    "canonical_name": "Utrecht",
    "reason": "FC club prefix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "N1",
    "provider_name": "FC Zwolle",
    "canonical_name": "Zwolle",
    "reason": "FC club prefix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "N1",
    "provider_name": "Fortuna Sittard",
    "canonical_name": "For Sittard",
    "reason": "Fortuna is abbreviated to For in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "N1",
    "provider_name": "NEC Nijmegen",
    "canonical_name": "Nijmegen",
    "reason": "NEC club prefix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "N1",
    "provider_name": "SC Cambuur",
    "canonical_name": "Cambuur",
    "reason": "SC club prefix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "N1",
    "provider_name": "SC Telstar",
    "canonical_name": "Telstar",
    "reason": "SC club prefix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "P1",
    "provider_name": "Académico de Viseu",
    "canonical_name": "Academico Viseu",
    "reason": "Accent and de particle omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "P1",
    "provider_name": "Braga",
    "canonical_name": "Sp Braga",
    "reason": "Stored name adds the abbreviated Sp club prefix."
  },
  {
    "provider": "the_odds_api",
    "league_code": "P1",
    "provider_name": "CF Estrela",
    "canonical_name": "Estrela",
    "reason": "CF club prefix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "P1",
    "provider_name": "CS Maritimo",
    "canonical_name": "Maritimo",
    "reason": "CS club prefix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "P1",
    "provider_name": "Famalicão",
    "canonical_name": "Famalicao",
    "reason": "Accent-only spelling difference."
  },
  {
    "provider": "the_odds_api",
    "league_code": "P1",
    "provider_name": "FC Porto",
    "canonical_name": "Porto",
    "reason": "FC club prefix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "P1",
    "provider_name": "Moreirense FC",
    "canonical_name": "Moreirense",
    "reason": "FC club suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "P1",
    "provider_name": "Rio Ave FC",
    "canonical_name": "Rio Ave",
    "reason": "FC club suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "P1",
    "provider_name": "Sporting Lisbon",
    "canonical_name": "Sp Lisbon",
    "reason": "Sporting is abbreviated to Sp in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "P1",
    "provider_name": "Vitória SC",
    "canonical_name": "Guimaraes",
    "reason": "UEFA uses Vitoria SC and Guimaraes for the same club; distinct from Vitoria Setubal."
  },
  {
    "provider": "the_odds_api",
    "league_code": "SC0",
    "provider_name": "Dundee FC",
    "canonical_name": "Dundee",
    "reason": "FC suffix omitted; distinct from Dundee United."
  },
  {
    "provider": "the_odds_api",
    "league_code": "SC0",
    "provider_name": "Falkirk F.C.",
    "canonical_name": "Falkirk",
    "reason": "Punctuated FC club suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "SP1",
    "provider_name": "Alavés",
    "canonical_name": "Alaves",
    "reason": "Accent-only spelling difference."
  },
  {
    "provider": "the_odds_api",
    "league_code": "SP1",
    "provider_name": "Athletic Bilbao",
    "canonical_name": "Ath Bilbao",
    "reason": "Athletic is abbreviated to Ath in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "SP1",
    "provider_name": "Atlético Madrid",
    "canonical_name": "Ath Madrid",
    "reason": "Stored abbreviated Atletico Madrid spelling."
  },
  {
    "provider": "the_odds_api",
    "league_code": "SP1",
    "provider_name": "CA Osasuna",
    "canonical_name": "Osasuna",
    "reason": "CA club prefix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "SP1",
    "provider_name": "Celta Vigo",
    "canonical_name": "Celta",
    "reason": "Vigo location suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "SP1",
    "provider_name": "Deportivo La Coruña",
    "canonical_name": "La Coruna",
    "reason": "Deportivo prefix and accent omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "SP1",
    "provider_name": "Elche CF",
    "canonical_name": "Elche",
    "reason": "CF club suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "SP1",
    "provider_name": "Espanyol",
    "canonical_name": "Espanol",
    "reason": "Stored alternative spelling of Espanyol."
  },
  {
    "provider": "the_odds_api",
    "league_code": "SP1",
    "provider_name": "Málaga",
    "canonical_name": "Malaga",
    "reason": "Accent-only spelling difference."
  },
  {
    "provider": "the_odds_api",
    "league_code": "SP1",
    "provider_name": "Rayo Vallecano",
    "canonical_name": "Vallecano",
    "reason": "Rayo prefix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "SP1",
    "provider_name": "Real Betis",
    "canonical_name": "Betis",
    "reason": "Real prefix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "SP1",
    "provider_name": "Real Racing Club de Santander",
    "canonical_name": "Santander",
    "reason": "Stored short form of the expanded Santander club name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "SP1",
    "provider_name": "Real Sociedad",
    "canonical_name": "Sociedad",
    "reason": "Real prefix omitted; first-team identity retained."
  },
  {
    "provider": "the_odds_api",
    "league_code": "SP2",
    "provider_name": "AD Ceuta FC",
    "canonical_name": "Ceuta",
    "reason": "AD prefix and FC suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "SP2",
    "provider_name": "Almería",
    "canonical_name": "Almeria",
    "reason": "Accent-only spelling difference."
  },
  {
    "provider": "the_odds_api",
    "league_code": "SP2",
    "provider_name": "Andorra CF",
    "canonical_name": "Andorra",
    "reason": "CF club suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "SP2",
    "provider_name": "Burgos CF",
    "canonical_name": "Burgos",
    "reason": "CF club suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "SP2",
    "provider_name": "Cádiz CF",
    "canonical_name": "Cadiz",
    "reason": "CF club suffix and accent omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "SP2",
    "provider_name": "CD Castellón",
    "canonical_name": "Castellon",
    "reason": "CD club prefix and accent omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "SP2",
    "provider_name": "CD Eldense",
    "canonical_name": "Eldense",
    "reason": "CD club prefix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "SP2",
    "provider_name": "Celta Fortuna",
    "canonical_name": "Celta B",
    "reason": "RC Celta officially renamed its reserve side Celta B to Celta Fortuna in 2023; the first team remains separate."
  },
  {
    "provider": "the_odds_api",
    "league_code": "SP2",
    "provider_name": "Córdoba",
    "canonical_name": "Cordoba",
    "reason": "Accent-only spelling difference."
  },
  {
    "provider": "the_odds_api",
    "league_code": "SP2",
    "provider_name": "Girona FC",
    "canonical_name": "Girona",
    "reason": "FC club suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "SP2",
    "provider_name": "Granada CF",
    "canonical_name": "Granada",
    "reason": "CF club suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "SP2",
    "provider_name": "Leganés",
    "canonical_name": "Leganes",
    "reason": "Accent-only spelling difference."
  },
  {
    "provider": "the_odds_api",
    "league_code": "SP2",
    "provider_name": "Real Sociedad B",
    "canonical_name": "Sociedad B",
    "reason": "Real prefix omitted; B reserve-team suffix retained."
  },
  {
    "provider": "the_odds_api",
    "league_code": "SP2",
    "provider_name": "Real Valladolid CF",
    "canonical_name": "Valladolid",
    "reason": "Real prefix and CF suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "SP2",
    "provider_name": "Sabadell FC",
    "canonical_name": "Sabadell",
    "reason": "FC club suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "SP2",
    "provider_name": "SD Eibar",
    "canonical_name": "Eibar",
    "reason": "SD club prefix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "SP2",
    "provider_name": "Sporting Gijón",
    "canonical_name": "Sp Gijon",
    "reason": "Sporting abbreviation and accent-free spelling in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "T1",
    "provider_name": "Amed SK",
    "canonical_name": "Amedspor",
    "reason": "Stored spor suffix variant of the Amed club name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "T1",
    "provider_name": "Basaksehir",
    "canonical_name": "Buyuksehyr",
    "reason": "TFF identifies Basaksehir's former Istanbul Buyuksehir name; the stored dataset uses the Buyuksehyr spelling."
  },
  {
    "provider": "the_odds_api",
    "league_code": "T1",
    "provider_name": "Besiktas JK",
    "canonical_name": "Besiktas",
    "reason": "JK club suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "T1",
    "provider_name": "Çaykur Rizespor",
    "canonical_name": "Rizespor",
    "reason": "Caykur prefix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "T1",
    "provider_name": "Çorum FK",
    "canonical_name": "Corum",
    "reason": "FK club suffix and accent omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "T1",
    "provider_name": "Erzurum BB",
    "canonical_name": "Erzurumspor",
    "reason": "Club confirms Buyuksehir Belediye Erzurumspor became Erzurumspor FK; this does not map the separate historical Erzurum team."
  },
  {
    "provider": "the_odds_api",
    "league_code": "T1",
    "provider_name": "Eyüpspor",
    "canonical_name": "Eyupspor",
    "reason": "Accent-only spelling difference."
  },
  {
    "provider": "the_odds_api",
    "league_code": "T1",
    "provider_name": "Gazişehir Gaziantep",
    "canonical_name": "Gaziantep",
    "reason": "Gazisehir prefix omitted; Gaziantepspor remains distinct."
  },
  {
    "provider": "the_odds_api",
    "league_code": "T1",
    "provider_name": "Genclerbirligi SK",
    "canonical_name": "Genclerbirligi",
    "reason": "SK club suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "T1",
    "provider_name": "Goztepe",
    "canonical_name": "Goztep",
    "reason": "Stored shortened spelling of Goztepe."
  },
  {
    "provider": "the_odds_api",
    "league_code": "T1",
    "provider_name": "Kasimpasa SK",
    "canonical_name": "Kasimpasa",
    "reason": "SK club suffix omitted in stored name."
  },
  {
    "provider": "the_odds_api",
    "league_code": "T1",
    "provider_name": "Torku Konyaspor",
    "canonical_name": "Konyaspor",
    "reason": "Torku prefix omitted in stored name."
  }
]
$aliases$::jsonb)
AS a(provider text, league_code text, provider_name text, canonical_name text, reason text)
ON CONFLICT (provider, league_code, provider_name) DO UPDATE
SET canonical_name = EXCLUDED.canonical_name, reason = EXCLUDED.reason;
