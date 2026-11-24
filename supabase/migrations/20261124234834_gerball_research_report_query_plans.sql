-- Preserve report definitions and access while avoiding unnecessary archive scans.
-- Each nullable coverage-filter combination has its own indexable branch. The
-- branches are mutually exclusive, so every selected source row appears once.
-- Existing parameters, result columns, field names and missing-value semantics
-- are unchanged. CREATE OR REPLACE retains the existing owner and grants.
CREATE OR REPLACE FUNCTION public.edgelab_data_coverage(
  p_league text DEFAULT NULL::text,
  p_season text DEFAULT NULL::text
)
RETURNS TABLE(metric text, available bigint, total bigint, coverage_pct numeric)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
WITH f AS MATERIALIZED (
  SELECT source_data AS d
  FROM public.matches
  WHERE p_league IS NOT NULL AND p_season IS NOT NULL
    AND league = p_league AND season = p_season
  UNION ALL
  SELECT source_data
  FROM public.matches
  WHERE p_league IS NOT NULL AND p_season IS NULL
    AND league = p_league
  UNION ALL
  SELECT source_data
  FROM public.matches
  WHERE p_league IS NULL AND p_season IS NOT NULL
    AND season = p_season
  UNION ALL
  SELECT source_data
  FROM public.matches
  WHERE p_league IS NULL AND p_season IS NULL
)
SELECT x.metric,
  sum(CASE WHEN coalesce(f.d->>x.field, '') <> '' THEN 1 ELSE 0 END)::bigint,
  count(*)::bigint,
  round(100.0 * sum(CASE WHEN coalesce(f.d->>x.field, '') <> '' THEN 1 ELSE 0 END) / nullif(count(*), 0), 1)
FROM f
CROSS JOIN (VALUES
  ('Half-time scores', 'HTHG'),
  ('Corners', 'HC'),
  ('Shots', 'HS'),
  ('Shots on target', 'HST'),
  ('Fouls', 'HF'),
  ('Yellow cards', 'HY'),
  ('Red cards', 'HR'),
  ('Referee', 'Referee'),
  ('Bet365 opening home odds', 'B365H'),
  ('Bet365 closing home odds', 'B365CH'),
  ('Bet365 over 2.5 odds', 'B365>2.5'),
  ('Bet365 closing over 2.5 odds', 'B365C>2.5'),
  ('Asian handicap line', 'AHh')
) x(metric, field)
GROUP BY x.metric
ORDER BY x.metric
$function$;

-- Limit source rows to complete league/season partitions containing the exact
-- requested team. Scores are intentionally absent from the discovery lookup so
-- the existing league/season/date/team index can answer it without heap reads.
-- Group season keys per league to avoid repeated heap visits for each season.
CREATE OR REPLACE FUNCTION public.edgelab_team_history(p_team text, p_league text DEFAULT NULL::text)
RETURNS TABLE(
  league text, season text, league_rank bigint, team_count bigint,
  played bigint, wins bigint, draws bigint, losses bigint,
  goals_for bigint, goals_against bigint, points bigint, points_per_game numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
WITH target_seasons AS MATERIALIZED (
  SELECT m.league, array_agg(DISTINCT m.season) AS seasons
  FROM public.matches AS m
  WHERE (m.home_team = p_team OR m.away_team = p_team)
    AND (p_league IS NULL OR m.league = p_league)
  GROUP BY m.league
), target_matches AS MATERIALIZED (
  SELECT m.league, m.season, m.home_team, m.away_team, m.home_goals, m.away_goals
  FROM target_seasons AS t
  CROSS JOIN LATERAL (
    SELECT m.league, m.season, m.home_team, m.away_team, m.home_goals, m.away_goals
    FROM public.matches AS m
    WHERE m.league = t.league AND m.season = ANY (t.seasons)
      AND m.home_goals IS NOT NULL AND m.away_goals IS NOT NULL
    OFFSET 0
  ) AS m
), fixtures AS (
  SELECT m.league, m.season, m.home_team AS team, m.home_goals AS gf, m.away_goals AS ga
  FROM target_matches AS m
  UNION ALL
  SELECT m.league, m.season, m.away_team, m.away_goals, m.home_goals
  FROM target_matches AS m
), aggregated AS (
  SELECT f.league, f.season, f.team,
    count(*)::bigint AS played,
    count(*) FILTER (WHERE gf > ga)::bigint AS wins,
    count(*) FILTER (WHERE gf = ga)::bigint AS draws,
    count(*) FILTER (WHERE gf < ga)::bigint AS losses,
    sum(gf)::bigint AS goals_for,
    sum(ga)::bigint AS goals_against,
    (3 * count(*) FILTER (WHERE gf > ga) + count(*) FILTER (WHERE gf = ga))::bigint AS points
  FROM fixtures AS f
  GROUP BY f.league, f.season, f.team
), ranked AS (
  SELECT a.*,
    row_number() OVER (PARTITION BY a.league, a.season ORDER BY a.points DESC, (a.goals_for - a.goals_against) DESC, a.goals_for DESC, a.team) AS league_rank,
    count(*) OVER (PARTITION BY a.league, a.season) AS team_count
  FROM aggregated AS a
)
SELECT r.league, r.season, r.league_rank, r.team_count, r.played, r.wins, r.draws, r.losses,
  r.goals_for, r.goals_against, r.points, round(r.points::numeric / nullif(r.played, 0), 2)
FROM ranked AS r
WHERE r.team = p_team
ORDER BY r.season DESC, r.league
$function$;
