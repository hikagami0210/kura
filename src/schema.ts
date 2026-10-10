/** Shared contract for PostgreSQL collection, JSON snapshots and the static viewer. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface Descriptions {
  description?: string | null;
  dbComment?: string | null;
  kuraDescription?: string;
}
export interface Column extends Descriptions {
  name: string;
  type: string;
  nullable?: boolean;
  pk?: boolean;
  default?: string | null;
  description?: string | null;
  identity?: string;
  generated?: string;
}
export interface Relation {
  table: string;
  column: string;
  target: string;
  schema?: string;
  database?: string;
  kind?: "foreign_key" | "logical";
  confirmed?: boolean;
  validated?: boolean;
  constraint?: string;
  position?: number;
  definition?: string;
  source?: string;
  description?: string;
}
export interface Index {
  name: string;
  method?: string;
  keys: string[];
  primary?: boolean;
  unique?: boolean;
  valid?: boolean;
  include?: string[];
  predicate?: string | null;
  definition?: string;
}
export interface Dependency {
  name: string;
  schema?: string;
  database?: string;
  target?: string;
}
export interface DbObject extends Descriptions {
  name: string;
  kind?: "table" | "view" | "materialized_view";
  owner?: string;
  description?: string | null;
  columns: Column[];
  relations?: Relation[];
  indexes?: Index[];
  definition?: string | null;
  populated?: boolean | null;
  dependencies?: Dependency[];
  rls?: boolean;
  force_rls?: boolean;
  notes?: {
    key?: string;
    text: string;
    confirmed?: boolean;
    source?: string;
  }[];
  master?: {
    columns: string[];
    rows: Record<string, Json>[];
    complete?: boolean;
  };
}
export interface Schema extends Descriptions {
  description?: string | null;
  name: string;
  owner?: string;
  tables: DbObject[];
}
export interface Role {
  name: string;
  login?: boolean;
  superuser?: boolean;
  inherit?: boolean;
  memberships?: string[];
}
export interface SchemaAccess {
  role: string;
  schema: string;
  connect?: boolean;
  usage?: boolean;
  create?: boolean;
  via?: string;
  grantSources?: Record<"connect" | "usage" | "create", string[]>;
}
export interface TableAccess extends SchemaAccess {
  table: string;
  select?: boolean;
  insert?: boolean;
  update?: boolean;
  delete?: boolean;
  rls?: string;
}
export interface DatabaseInfo {
  serverVersion?: string;
  owner?: string;
  encoding?: string;
  collation?: string;
  ctype?: string;
  connectionLimit?: number;
  timezone?: string;
  searchPath?: string;
  currentUser?: string;
  recovery?: boolean;
  size?: string;
  excluded?: Record<string, string>;
  extensions?: { name: string; version: string; schema: string }[];
}
export interface Database extends Descriptions {
  description?: string | null;
  name: string;
  info?: DatabaseInfo;
  schemas: Schema[];
  schemaAccess?: SchemaAccess[];
  access?: TableAccess[];
}
export interface Snapshot {
  formatVersion: 1;
  environment?: string;
  roles?: Role[];
  warnings?: string[];
  databases: Database[];
  source?: string;
  capturedAt?: string;
}
export interface FlatObject extends DbObject {
  displayName: string;
  database: string;
  schema: string;
}
export type NormalizedSnapshot = Omit<Snapshot, "databases"> & {
  tables: FlatObject[];
  databases: (Omit<Database, "schemas"> & {
    schemas: (Omit<Schema, "tables"> & { tables: FlatObject[] })[];
  })[];
};
export interface GenerateConfig {
  connectionEnv: string;
  schemas: string[];
  roles?: string[];
  environment?: string;
  output?: string;
  includeRuntimeInfo?: boolean;
  annotationsFile?: string;
  masters?: {
    schema: string;
    table: string;
    columns: string[];
    orderBy?: string[];
    limit?: number;
  }[];
  logicalRelations?: {
    schema: string;
    table: string;
    column: string;
    targetSchema: string;
    targetTable: string;
    targetColumn: string;
    confirmed?: boolean;
    source?: string;
    description?: string;
  }[];
}
