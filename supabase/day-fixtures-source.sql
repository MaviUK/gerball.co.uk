-- Read-only fixtures and imported results for a UK match day.
-- Include only paper bets captured on that match day.
CREATE OR REPLACE FUNCTION public.gerball_day_fixtures(p_date date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with observed as materialized (
 select distinct on (o.event_id,o.kickoff_at)
   o.id,o.event_id,o.league_code,o.season,o.fixture_date,o.kickoff_at,
   coalesce(o.fixture#>>'{home,canonical_name}',o.fixture#>>'{home,provider_name}') home_team,
   coalesce(o.fixture#>>'{away,canonical_name}',o.fixture#>>'{away,provider_name}') away_team,
   o.recorded_at
 from gerball_tracking_private.observations o
 where o.fixture_date=p_date
   and (o.kickoff_at at time zone 'Europe/London')::date=p_date
 order by o.event_id,o.kickoff_at,o.recorded_at desc,o.id desc
), results as (
 select o.event_id,o.league_code,o.season,o.kickoff_at,o.home_team,o.away_team,
  m.home_goals,m.away_goals,m.full_time_result,m.imported_at,m.id match_id,
  (select jsonb_agg(jsonb_build_object('market',b.market,'units',b.recommended_units,'odds',b.odds))
   from gerball_advice_private.paper_bets b
   where b.event_id=o.event_id and b.kickoff_at=o.kickoff_at
    and (b.recorded_at at time zone 'Europe/London')::date=p_date) paper_bets
 from observed o
 left join lateral (
   select m.id,m.home_goals,m.away_goals,m.full_time_result,m.imported_at
   from public.matches m
   where m.league=o.league_code and m.season=o.season and m.match_date=p_date
     and m.home_team=o.home_team and m.away_team=o.away_team
     and m.source='football-data.co.uk'
     and m.home_goals>=0 and m.away_goals>=0
     and m.full_time_result=(case when m.home_goals>m.away_goals then 'H' when m.home_goals<m.away_goals then 'A' else 'D' end)
   order by m.imported_at desc,m.id desc limit 1
 ) m on true
), imported_only as (
 select null::text event_id,m.league league_code,m.season,null::timestamptz kickoff_at,
   m.home_team,m.away_team,m.home_goals,m.away_goals,m.full_time_result,m.imported_at,m.id match_id,
   null::jsonb paper_bets
 from public.matches m
 where m.match_date=p_date and m.source='football-data.co.uk'
  and m.home_goals>=0 and m.away_goals>=0
  and m.full_time_result=(case when m.home_goals>m.away_goals then 'H' when m.home_goals<m.away_goals then 'A' else 'D' end)
  and not exists(select 1 from observed o where o.league_code=m.league and o.season=m.season and o.home_team=m.home_team and o.away_team=m.away_team)
), all_fixtures as (
 select * from results union all select * from imported_only
)
select jsonb_build_object(
 'version','gerball_day_fixtures_v1','date',p_date,
 'total',(select count(*) from all_fixtures),
 'results_available',(select count(*) from all_fixtures where match_id is not null),
 'matches',coalesce((select jsonb_agg(jsonb_build_object(
   'event_id',event_id,'league',league_code,'season',season,'kickoff_at',kickoff_at,
   'home',home_team,'away',away_team,'home_goals',home_goals,'away_goals',away_goals,
   'result',full_time_result,'result_imported_at',imported_at,'paper_bets',coalesce(paper_bets,'[]'::jsonb)
  ) order by kickoff_at nulls last,league_code,home_team,away_team)
  from (select * from all_fixtures order by kickoff_at nulls last,league_code,home_team,away_team limit 1500) x),'[]'::jsonb)
);
$function$;

REVOKE ALL ON FUNCTION public.gerball_day_fixtures(date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gerball_day_fixtures(date) TO service_role;
NOTIFY pgrst,'reload schema';
