-- Read-only deployment check for the report-query optimizations.
-- Run before and after applying the migration. The definition hash should
-- change; signature, result type, owner, ACL, role access and settings should not.
-- Captured pre-change metadata for all three functions:
-- owner=postgres; SECURITY INVOKER; STABLE; search_path=public;
-- ACL={=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}.
WITH expected(signature, before_md5) AS (
  VALUES
    ('public.edgelab_data_coverage(text,text)', '11cd4ba83290caf4e169742ec637005c'),
    ('public.edgelab_team_history(text,text)', '518758d41c67aebf44c730e93b199ba5'),
    ('public.edgelab_odds_movement(text,text,text,text)', 'c0797af8e8bf89d4d175cb59ecb20ba2')
)
SELECT expected.signature,
  expected.before_md5,
  md5(pg_get_functiondef(p.oid)) AS current_definition_md5,
  md5(pg_get_functiondef(p.oid)) <> expected.before_md5 AS definition_changed,
  pg_get_function_arguments(p.oid) AS arguments,
  pg_get_function_result(p.oid) AS result_type,
  pg_get_userbyid(p.proowner) AS owner,
  p.proacl::text AS acl,
  p.prosecdef AS security_definer,
  p.provolatile AS volatility,
  p.proisstrict AS strict,
  p.proconfig AS settings,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute
FROM expected
JOIN pg_proc p ON p.oid = to_regprocedure(expected.signature)
ORDER BY expected.signature;
