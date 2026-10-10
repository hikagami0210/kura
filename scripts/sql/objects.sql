SELECT c.oid::text AS oid, n.nspname AS schema, c.relname AS name,
 CASE c.relkind WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized_view' ELSE 'table' END AS kind,
 pg_get_userbyid(c.relowner) AS owner, obj_description(c.oid,'pg_class') AS description,
 CASE WHEN c.relkind IN ('v','m') THEN pg_get_viewdef(c.oid,true) END AS definition,
 CASE WHEN c.relkind='m' THEN c.relispopulated END AS populated,
 c.relrowsecurity AS rls, c.relforcerowsecurity AS force_rls
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE c.relkind IN ('r','p','v','m','f') AND n.nspname=ANY($1::text[])
ORDER BY n.nspname COLLATE "C",c.relname COLLATE "C";
