SELECT * FROM (SELECT DISTINCT rw.ev_class::text AS oid,n.nspname AS schema,c.relname AS name
FROM pg_rewrite rw JOIN pg_depend d ON d.classid='pg_rewrite'::regclass AND d.objid=rw.oid
JOIN pg_class c ON c.oid=d.refobjid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE rw.ev_class=ANY($1::oid[]) AND d.refclassid='pg_class'::regclass AND d.deptype='n'
 AND d.refobjid<>rw.ev_class AND c.relkind IN ('r','p','v','m','f')
) dependencies ORDER BY oid,schema COLLATE "C",name COLLATE "C";
