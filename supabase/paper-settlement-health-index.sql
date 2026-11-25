-- Accelerate the latest imported results timestamp used by settlement monitoring.
CREATE INDEX IF NOT EXISTS gerball_matches_import_clock_idx
ON public.matches (imported_at DESC)
WHERE source='football-data.co.uk';
