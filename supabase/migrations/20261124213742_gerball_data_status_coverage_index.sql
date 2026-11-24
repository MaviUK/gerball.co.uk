-- Exact archive coverage without repeatedly fetching the wide match rows.
-- This non-unique index preserves historical values and existing constraints.
-- Keep this migration separate so its write lock ends immediately after the build.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '90s';
CREATE INDEX gerball_matches_status_cover_idx
  ON public.matches (league, season, match_date)
  INCLUDE (imported_at, home_goals, away_goals, full_time_result);
