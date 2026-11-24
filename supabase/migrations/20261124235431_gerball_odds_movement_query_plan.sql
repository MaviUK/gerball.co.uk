-- Preserve the existing odds parsing, buckets and arithmetic.
-- Resolve optional season scope through exclusive indexable branches, then
-- evaluate each opening/closing price once before aggregation.
CREATE OR REPLACE FUNCTION public.edgelab_odds_movement(p_league text, p_season text DEFAULT NULL::text, p_market text DEFAULT 'H'::text, p_team text DEFAULT NULL::text)
 RETURNS TABLE(movement text, bets bigint, wins bigint, win_pct numeric, avg_open numeric, avg_close numeric, avg_shift_pct numeric, flat_profit numeric, flat_roi_pct numeric)
 LANGUAGE sql
 STABLE
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
WITH scoped_matches AS MATERIALIZED (
  SELECT m.home_team,m.away_team,m.full_time_result,m.source_data,m.home_goals,m.away_goals
  FROM public.matches AS m
  WHERE p_season IS NOT NULL AND m.league=p_league AND m.season=p_season
    AND m.home_goals IS NOT NULL AND m.away_goals IS NOT NULL
  UNION ALL
  SELECT m.home_team,m.away_team,m.full_time_result,m.source_data,m.home_goals,m.away_goals
  FROM public.matches AS m
  WHERE p_season IS NULL AND m.league=p_league
    AND m.home_goals IS NOT NULL AND m.away_goals IS NOT NULL
), selected AS (
select m.home_team,m.away_team,m.full_time_result,m.source_data,
case p_market when 'H' then 'B365H' when 'D' then 'B365D' when 'A' then 'B365A' when 'O25' then 'B365>2.5' else 'B365<2.5' end as opening_key,
case p_market when 'H' then 'B365CH' when 'D' then 'B365CD' when 'A' then 'B365CA' when 'O25' then 'B365C>2.5' else 'B365C<2.5' end as closing_key,
(m.home_goals+m.away_goals) as total_goals
from scoped_matches m where (p_team is null or m.home_team=p_team or m.away_team=p_team)
), prices AS MATERIALIZED (
select s.full_time_result,s.total_goals,case when (source_data->>opening_key) ~ '^[0-9]+(\.[0-9]+)?$' then (source_data->>opening_key)::numeric end as opening,
case when (source_data->>closing_key) ~ '^[0-9]+(\.[0-9]+)?$' then (source_data->>closing_key)::numeric end as closing from selected s
), evaluated as (
select p.*,case when closing<opening*0.98 then 'Shortened >2%' when closing>opening*1.02 then 'Drifted >2%' else 'Stable ±2%' end as bucket,
case p_market when 'H' then full_time_result='H' when 'D' then full_time_result='D' when 'A' then full_time_result='A' when 'O25' then total_goals>2 else total_goals<3 end as won
from prices p where opening>1.01 and closing>1.01
)
select e.bucket,count(*)::bigint,count(*) filter(where won)::bigint,round(100.0*count(*) filter(where won)/nullif(count(*),0),1),round(avg(opening),3),round(avg(closing),3),round(avg(100.0*(closing/opening-1)),2),round(sum(case when won then opening-1 else -1 end),2),round(100.0*sum(case when won then opening-1 else -1 end)/nullif(count(*),0),2)
from evaluated e group by e.bucket order by e.bucket
$function$;

