import type { QueryResultRow } from "pg";
import type {
  GenerateConfig,
  Snapshot,
  DbObject,
  Column,
  Relation,
  Index,
  Dependency,
  DatabaseInfo,
  Role,
  Schema,
  SchemaAccess,
  TableAccess,
  Json,
} from "../src/schema.ts";
import pg from "pg";
import { readFile } from "node:fs/promises";
const { Client } = pg;
const sqlFile = (name: string) =>
  readFile(new URL("sql/" + name + ".sql", import.meta.url), "utf8");
const ident = (s: string) => '"' + s.replaceAll('"', '""') + '"';
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export async function collect(config: GenerateConfig, connectionString: string): Promise<Snapshot> {
  if (
    !Array.isArray(config.schemas) ||
    !config.schemas.length ||
    config.schemas.some((s) => typeof s !== "string")
  )
    throw Error("schemas に対象スキーマを指定してください。");
  const client = new Client({
    connectionString,
    application_name: "kura",
    connectionTimeoutMillis: 10000,
  });
  await client.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout='30s'");
    const session = (
      await client.query<
        Pick<DatabaseInfo, "timezone" | "searchPath" | "currentUser" | "recovery">
      >(
        `SELECT current_setting('TimeZone') AS timezone,current_setting('search_path') AS "searchPath",current_user AS "currentUser",pg_is_in_recovery() AS recovery`,
      )
    ).rows[0];
    await client.query("SET LOCAL search_path=pg_catalog");
    const query = async <T extends QueryResultRow>(name: string, args: unknown[]): Promise<T[]> =>
      (await client.query<T>(await sqlFile(name), args)).rows;
    const objects = await query<DbObject & { oid: string; schema: string }>("objects", [
      config.schemas,
    ]);
    const ids = objects.map((o) => o.oid);
    const cols = await query<Column & { oid: string; attnum: number }>("columns", [ids]),
      relations = await query<Relation & { oid: string }>("relations", [ids]),
      indexes = await query<Index & { oid: string }>("indexes", [ids]),
      deps = await query<Dependency & { oid: string }>("dependencies", [ids]);
    const schemas = (
      await client.query<Schema>(
        'SELECT nspname AS name,pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname=ANY($1::text[]) ORDER BY nspname COLLATE "C"',
        [config.schemas],
      )
    ).rows;
    if (schemas.length !== new Set(config.schemas).size)
      throw Error("指定されたスキーマが見つかりません。");
    const info = (
      await client.query<DatabaseInfo & { name: string }>(
        `SELECT current_setting('server_version') AS "serverVersion",pg_get_userbyid(datdba) AS owner,pg_encoding_to_char(encoding) AS encoding,datcollate AS collation,datctype AS ctype,datconnlimit AS "connectionLimit",current_database() AS name FROM pg_database WHERE datname=current_database()`,
      )
    ).rows[0];
    Object.assign(info, session);
    if (config.includeRuntimeInfo === true)
      info.size = (
        await client.query<{ size: string }>(
          "SELECT pg_size_pretty(pg_database_size(current_database())) AS size",
        )
      ).rows[0].size;
    else info.excluded = { size: "再現性を優先し、変動する容量は取得対象外" };
    const extensions = (
      await client.query<NonNullable<DatabaseInfo["extensions"]>[number]>(
        'SELECT e.extname AS name,e.extversion AS version,n.nspname AS schema FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace ORDER BY e.extname COLLATE "C"',
      )
    ).rows;
    const roles = (
      await client.query<Role & { oid: string }>(
        `SELECT r.oid::text AS oid,r.rolname AS name,r.rolcanlogin AS login,r.rolsuper AS superuser,r.rolinherit AS inherit,ARRAY(SELECT p.rolname FROM pg_auth_members m JOIN pg_roles p ON p.oid=m.roleid WHERE m.member=r.oid ORDER BY p.rolname COLLATE "C") AS memberships FROM pg_roles r WHERE r.rolname !~ '^pg_' AND ($1::text[] IS NULL OR r.rolname=ANY($1::text[])) ORDER BY r.rolname COLLATE "C"`,
        [config.roles || null],
      )
    ).rows;
    const roleIds = roles.map((r) => r.oid);
    const schemaAccess = (
      await client.query<SchemaAccess>(
        `SELECT r.rolname AS role,n.nspname AS schema,has_database_privilege(r.oid,current_database(),'CONNECT') AS connect,has_schema_privilege(r.oid,n.oid,'USAGE') AS usage,has_schema_privilege(r.oid,n.oid,'CREATE') AS create FROM pg_roles r CROSS JOIN pg_namespace n WHERE r.oid=ANY($1::oid[]) AND n.nspname=ANY($2::text[]) ORDER BY r.rolname COLLATE "C",n.nspname COLLATE "C"`,
        [roleIds, config.schemas],
      )
    ).rows;
    // Resolve effective ACL grants, including inherited roles without SET ROLE.
    const grantPaths = (
      await client.query<{
        role: string;
        schema: string;
        privilege: string;
        source: string;
      }>(
        `
   WITH grants AS (
    SELECT n.nspname AS schema,n.nspowner AS owner,a.* FROM pg_namespace n
    CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a
    WHERE n.nspname=ANY($2::text[])
   ), dbgrants AS (
    SELECT d.datdba AS owner,a.* FROM pg_database d
    CROSS JOIN LATERAL aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a
    WHERE d.datname=current_database() AND a.privilege_type='CONNECT'
   )
   SELECT r.rolname AS role,n.nspname AS schema,p.privilege_type AS privilege,
    CASE WHEN r.rolsuper THEN 'Superuser'
     WHEN a.grantee=0 THEN 'PUBLIC'
     WHEN a.grantee=r.oid THEN CASE WHEN a.grantee=a.owner THEN '所有者' ELSE '直接付与' END
     ELSE 'ロール継承: '||pg_get_userbyid(a.grantee) END AS source
   FROM pg_roles r CROSS JOIN pg_namespace n
   CROSS JOIN (VALUES ('CONNECT'),('USAGE'),('CREATE')) p(privilege_type)
   LEFT JOIN LATERAL (
    SELECT g.owner,g.grantee FROM grants g WHERE g.schema=n.nspname AND g.privilege_type=p.privilege_type
    UNION ALL SELECT g.owner,g.grantee FROM dbgrants g WHERE p.privilege_type='CONNECT'
   ) a ON (a.grantee=0 OR a.grantee=r.oid OR pg_has_role(r.oid,a.grantee,'USAGE'))
   WHERE r.oid=ANY($1::oid[]) AND n.nspname=ANY($2::text[]) AND (r.rolsuper OR a.grantee IS NOT NULL)
   ORDER BY r.rolname COLLATE "C",n.nspname COLLATE "C",p.privilege_type,source
  `,
        [roleIds, config.schemas],
      )
    ).rows;
    for (const entry of schemaAccess) {
      const sources = (key: string): string[] =>
        [
          ...new Set(
            grantPaths
              .filter(
                (g) => g.role === entry.role && g.schema === entry.schema && g.privilege === key,
              )
              .map((g) => g.source),
          ),
        ].sort(compare);
      const grantSources = {
        connect: sources("CONNECT"),
        usage: sources("USAGE"),
        create: sources("CREATE"),
      };
      entry.grantSources = grantSources;
      entry.via = (["connect", "usage", "create"] as const)
        .map((key) => key.toUpperCase() + ": " + (grantSources[key].join(" / ") || "未付与"))
        .join(" · ");
    }
    const access = (
      await client.query<TableAccess>(
        `SELECT r.rolname AS role,n.nspname AS schema,c.relname AS table,has_database_privilege(r.oid,current_database(),'CONNECT') AS connect,has_schema_privilege(r.oid,n.oid,'USAGE') AS usage,has_table_privilege(r.oid,c.oid,'SELECT') AS select,has_table_privilege(r.oid,c.oid,'INSERT') AS insert,has_table_privilege(r.oid,c.oid,'UPDATE') AS update,has_table_privilege(r.oid,c.oid,'DELETE') AS delete,CASE WHEN c.relrowsecurity THEN '有効・ポリシー未評価' ELSE '無効' END AS rls FROM pg_roles r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE r.oid=ANY($1::oid[]) AND c.oid=ANY($2::oid[]) ORDER BY r.rolname COLLATE "C",n.nspname COLLATE "C",c.relname COLLATE "C"`,
        [roleIds, ids],
      )
    ).rows;
    const strip = <T extends { oid: string }>(r: T): Omit<T, "oid"> => {
      const { oid: _oid, ...rest } = r;
      return rest;
    };
    const warnings: string[] = [];
    const objectNames = new Set(objects.map((o) => JSON.stringify([o.schema, o.name])));
    for (const o of objects) {
      o.columns = cols.filter((c) => c.oid === o.oid).map(({ attnum: _attnum, ...c }) => strip(c));
      o.relations = relations
        .filter((r) => r.oid === o.oid)
        .map(strip)
        .filter((r) => {
          if (objectNames.has(JSON.stringify([r.schema, r.table]))) return true;
          warnings.push(`${o.schema}.${o.name}: 外部キーの参照先 ${r.schema}.${r.table} は対象外`);
          return false;
        });
      o.indexes = indexes.filter((r) => r.oid === o.oid).map(strip);
      if (o.kind !== "table")
        o.dependencies = deps
          .filter((r) => r.oid === o.oid)
          .map(strip)
          .filter((r) => {
            if (objectNames.has(JSON.stringify([r.schema, r.name]))) return true;
            warnings.push(`${o.schema}.${o.name}: 依存先 ${r.schema}.${r.name} は対象外`);
            return false;
          });
    }
    const masterTargets = new Set();
    for (const m of config.masters || []) {
      const key = JSON.stringify([m.schema, m.table]);
      if (masterTargets.has(key)) throw Error("マスター対象が重複しています。");
      masterTargets.add(key);
      const o = objects.find((o) => o.schema === m.schema && o.name === m.table);
      if (!o || o.kind !== "table") throw Error("マスター対象のテーブルが見つかりません。");
      if (
        !Array.isArray(m.columns) ||
        !m.columns.length ||
        m.columns.some((c) => !o.columns.some((x) => x.name === c))
      )
        throw Error("マスターのcolumnsが不正です。");
      const order = m.orderBy || o.columns.filter((c) => c.pk).map((c) => c.name);
      if (!order.length || order.some((c) => !o.columns.some((x) => x.name === c)))
        throw Error("マスターにはorderByまたは主キーが必要です。");
      const limit = m.limit ?? 1000;
      if (!Number.isInteger(limit) || limit < 1 || limit > 10000)
        throw Error("マスターのlimitは1〜10000です。");
      // Order by explicit keys, then complete projected value to break ties deterministically.
      const fields = m.columns.map(ident).join(",");
      const result = await client.query<{ row: Record<string, Json> }>(
        `SELECT to_jsonb(x) AS row FROM (SELECT ${fields} FROM ${ident(m.schema)}.${ident(m.table)} ORDER BY ${order.map(ident).join(",")},jsonb_build_array(${fields})::text COLLATE "C" LIMIT $1) x`,
        [limit + 1],
      );
      o.master = {
        columns: m.columns,
        complete: result.rows.length <= limit,
        rows: result.rows.slice(0, limit).map((r) => r.row),
      };
    }
    // Logical relations are curated configuration, never inferred from names during collection.
    for (const r of config.logicalRelations || []) {
      const o = objects.find((o) => o.schema === r.schema && o.name === r.table),
        target = objects.find((o) => o.schema === r.targetSchema && o.name === r.targetTable);
      if (
        !o ||
        !target ||
        !o.columns.some((c) => c.name === r.column) ||
        !target.columns.some((c) => c.name === r.targetColumn)
      )
        throw Error("論理リレーションの対象が不正です。");
      o.relations!.push({
        schema: r.targetSchema,
        table: r.targetTable,
        column: r.column,
        target: r.targetColumn,
        kind: "logical",
        confirmed: r.confirmed === true,
        source: r.source || "設定ファイル",
        description: r.description || "",
      });
    }
    for (const sc of schemas)
      sc.tables = objects
        .filter((o) => o.schema === sc.name)
        .map((o) => {
          const { oid: _oid, schema: _schema, ...rest } = o;
          return rest;
        });
    const { name, ...basic } = info;
    await client.query("COMMIT");
    return {
      formatVersion: 1,
      environment: config.environment || name,
      roles: roles.map(strip),
      warnings: warnings.sort(compare),
      databases: [{ name, info: { ...basic, extensions }, schemas, schemaAccess, access }],
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}
