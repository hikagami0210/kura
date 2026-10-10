SELECT a.attrelid::text AS oid,a.attnum,a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,
 NOT a.attnotnull AS nullable,pg_get_expr(d.adbin,d.adrelid) AS "default",
 col_description(a.attrelid,a.attnum) AS description,
 EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid=a.attrelid AND c.contype='p' AND a.attnum=ANY(c.conkey)) AS pk,
 a.attidentity AS identity,a.attgenerated AS generated
FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
WHERE a.attrelid=ANY($1::oid[]) AND a.attnum>0 AND NOT a.attisdropped
ORDER BY a.attrelid,a.attnum;
