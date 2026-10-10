SELECT i.indrelid::text AS oid,ic.relname AS name,am.amname AS method,
 i.indisprimary AS primary,i.indisunique AS unique,i.indisvalid AS valid,
 ARRAY(SELECT pg_get_indexdef(i.indexrelid,k,true) FROM generate_series(1,i.indnkeyatts) k) AS keys,
 ARRAY(SELECT pg_get_indexdef(i.indexrelid,k,true) FROM generate_series(i.indnkeyatts+1,i.indnatts) k) AS include,
 pg_get_expr(i.indpred,i.indrelid) AS predicate,pg_get_indexdef(i.indexrelid) AS definition
FROM pg_index i JOIN pg_class ic ON ic.oid=i.indexrelid JOIN pg_am am ON am.oid=ic.relam
WHERE i.indrelid=ANY($1::oid[]) ORDER BY i.indrelid,ic.relname COLLATE "C";
