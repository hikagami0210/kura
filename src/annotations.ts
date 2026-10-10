import type { Snapshot, Descriptions } from "./schema.ts";
export type AnnotationTarget =
  | { kind: "database"; database: string }
  | { kind: "schema"; database: string; schema: string }
  | { kind: "table"; database: string; schema: string; table: string }
  | { kind: "column"; database: string; schema: string; table: string; column: string };
export interface Annotation {
  target: AnnotationTarget;
  description: string;
}
export interface Annotations {
  formatVersion: 1;
  entries: Annotation[];
}
export interface EditorSettings {
  token: string;
  revision: string;
  annotations: Annotations;
  unmatched: Annotation[];
  originalDescriptions?: Annotation[];
}
export const emptyAnnotations = (): Annotations => ({ formatVersion: 1, entries: [] });
export function targetKey(t: AnnotationTarget): string {
  return JSON.stringify([
    t.kind,
    t.database,
    "schema" in t ? t.schema : null,
    "table" in t ? t.table : null,
    "column" in t ? t.column : null,
  ]);
}
export function validateAnnotations(value: unknown): Annotations {
  if (
    !value ||
    typeof value !== "object" ||
    !("formatVersion" in value) ||
    value.formatVersion !== 1 ||
    !("entries" in value) ||
    !Array.isArray(value.entries)
  )
    throw Error("annotations.jsonにはformatVersion: 1とentries配列が必要です。");
  const seen = new Set<string>();
  const entries = value.entries.map((entry: unknown): Annotation => {
    if (
      !entry ||
      typeof entry !== "object" ||
      !("description" in entry) ||
      typeof entry.description !== "string" ||
      entry.description.length > 50000 ||
      !("target" in entry) ||
      !entry.target ||
      typeof entry.target !== "object"
    )
      throw Error("説明または対象の形式が不正です。");
    const t = entry.target as Record<string, unknown>;
    const keys =
      t.kind === "database"
        ? ["kind", "database"]
        : t.kind === "schema"
          ? ["kind", "database", "schema"]
          : t.kind === "table"
            ? ["kind", "database", "schema", "table"]
            : t.kind === "column"
              ? ["kind", "database", "schema", "table", "column"]
              : null;
    if (
      !keys ||
      Object.keys(t).length !== keys.length ||
      keys.some((k) => typeof t[k] !== "string" || !t[k] || String(t[k]).length > 1024)
    )
      throw Error("説明の対象が不正です。");
    const target = Object.fromEntries(keys.map((k) => [k, t[k]])) as AnnotationTarget;
    const key = targetKey(target);
    if (seen.has(key)) throw Error("説明の対象が重複しています。");
    seen.add(key);
    return { target, description: entry.description };
  });
  return {
    formatVersion: 1,
    entries: entries.sort((a, b) =>
      targetKey(a.target) < targetKey(b.target)
        ? -1
        : targetKey(a.target) > targetKey(b.target)
          ? 1
          : 0,
    ),
  };
}
export function annotationObject(
  snapshot: Snapshot,
  t: AnnotationTarget,
): Descriptions | undefined {
  const d = snapshot.databases.find((d) => d.name === t.database);
  if (t.kind === "database") return d;
  const sc = d?.schemas.find((s) => s.name === t.schema);
  if (t.kind === "schema") return sc;
  const table = sc?.tables.find((x) => x.name === t.table);
  if (t.kind === "table") return table;
  return table?.columns.find((c) => c.name === t.column);
}
export function mergeAnnotations(
  snapshot: Snapshot,
  annotations: Annotations,
): { snapshot: Snapshot; unmatched: Annotation[] } {
  const result = structuredClone(snapshot),
    unmatched: Annotation[] = [];
  for (const entry of annotations.entries) {
    const object = annotationObject(result, entry.target);
    if (object) {
      object.dbComment = object.description ?? null;
      object.kuraDescription = entry.description;
      object.description = entry.description;
    } else unmatched.push(entry);
  }
  return { snapshot: result, unmatched };
}

export function originalDescriptions(snapshot: Snapshot): Annotation[] {
  const entries: Annotation[] = [];
  const add = (target: AnnotationTarget, description?: string | null) => {
    if (typeof description === "string") entries.push({ target, description });
  };
  for (const d of snapshot.databases) {
    add({ kind: "database", database: d.name }, d.description);
    for (const sc of d.schemas) {
      add({ kind: "schema", database: d.name, schema: sc.name }, sc.description);
      for (const t of sc.tables) {
        add({ kind: "table", database: d.name, schema: sc.name, table: t.name }, t.description);
        for (const c of t.columns)
          add(
            { kind: "column", database: d.name, schema: sc.name, table: t.name, column: c.name },
            c.description,
          );
      }
    }
  }
  return entries;
}
