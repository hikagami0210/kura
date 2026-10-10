SELECT c.conrelid::text AS oid,c.conname AS constraint,
 child.attname AS column, parent.attname AS target,n.nspname AS schema,p.relname AS table,
 c.convalidated AS validated, k.ordinality AS position,
 pg_get_constraintdef(c.oid,true) AS definition,
 CASE WHEN c.contype='f' THEN 'foreign_key' END AS kind
FROM pg_constraint c
JOIN LATERAL unnest(c.conkey,c.confkey) WITH ORDINALITY k(childnum,parentnum,ordinality) ON true
JOIN pg_attribute child ON child.attrelid=c.conrelid AND child.attnum=k.childnum
JOIN pg_attribute parent ON parent.attrelid=c.confrelid AND parent.attnum=k.parentnum
JOIN pg_class p ON p.oid=c.confrelid JOIN pg_namespace n ON n.oid=p.relnamespace
WHERE c.contype='f' AND c.conrelid=ANY($1::oid[])
ORDER BY c.conrelid,c.conname COLLATE "C",k.ordinality;
