import type { FlatObject } from "../src/schema.ts";
import { viewerScript } from "./html.ts";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import assert from "node:assert/strict";
const root = new URL("../", import.meta.url);
const html = await readFile(new URL("viewer/index.html", root), "utf8");
const script = await viewerScript();
new vm.Script(script);
// Pure rendering checks; browser appearance and downloads need separate verification.
const elements = new Map();
const element = (id: string) => {
  if (!elements.has(id)) elements.set(id, { value: "", innerHTML: "", textContent: "" });
  return elements.get(id);
};
const c: Record<string, any> = {
  URLSearchParams,
  document: { getElementById: element, querySelectorAll: () => [] },
};
vm.createContext(c);
vm.runInContext(script, c);
const markdownHtml = vm.runInContext(
  'markdownDescription("## 設計\\n\\n**重要**\\n\\n- 項目\\n\\n<script>alert(1)</script>\\n\\n[x](javascript:alert(1))")',
  c,
);
assert(markdownHtml.includes("<h2>設計</h2>"));
assert(markdownHtml.includes("<strong>重要</strong>"));
assert(markdownHtml.includes("<li>項目</li>"));
assert(!markdownHtml.includes("<script>"));
assert(!markdownHtml.includes('href="javascript:'));

const sample = JSON.parse(await readFile(new URL("examples/schema.json", root), "utf8"));
c.fixture = sample;
vm.runInContext("validate(fixture)", c);
assert.deepEqual(
  JSON.parse(vm.runInContext("JSON.stringify(sample)", c)),
  sample,
  "Embedded fixture must match examples/schema.json",
);
assert(element("overview-panel").innerHTML.includes("データベース基本情報"));
assert(!element("overview-panel").innerHTML.includes("data-er-action"));
vm.runInContext("overviewTab='er';render()", c);
assert(element("overview-panel").innerHTML.includes("Entity Relationship Diagram"));
assert(vm.runInContext("mermaid()", c).includes("order_events"));
assert(vm.runInContext("mermaid()", c).includes(".."));
for (const view of ["info", "schemas", "tables", "er", "accounts", "logical"])
  vm.runInContext(`overviewTab='${view}';render()`, c);
vm.runInContext("overviewTab='accounts';render();roleFilter='docs_reader';accessRows()", c);
assert(element("access-rows").innerHTML.includes("基本権限不足"));
assert(!element("access-rows").innerHTML.includes("app_user"));
for (const view of ["columns", "master", "indexes", "relations", "er"])
  vm.runInContext(`page='table';tab='${view}';render()`, c);
vm.runInContext("page='overview';activeDatabase='analytics';overviewTab='info';render()", c);
assert(!vm.runInContext("mermaid()", c).includes("order_events"));
console.log("データ形式、表示処理、権限フィルター、DB間の分離を確認しました。");

vm.runInContext("activeDatabase='commerce';activeSchema='master';page='schema';render()", c);
assert(element("view").innerHTML.includes("docs_reader"));
assert(element("view").innerHTML.includes("commerce_owner"));
assert(element("view").innerHTML.includes("data-er-action"));
assert(vm.runInContext("erTables().every(t=>t.schema==='master')", c));
assert(!element("tables").innerHTML.includes('class="nav active" data-select='));
assert(element("tables").innerHTML.includes("tree-row schema-link active"));
vm.runInContext("page='overview';render()", c);
assert(!element("tables").innerHTML.includes('class="nav active" data-select='));
assert(!element("tables").innerHTML.includes("tree-row schema-link active"));
assert(element("tables").innerHTML.includes("Overview"));

vm.runInContext(
  "selected=db.tables.find(t=>t.displayName==='order_statuses').name;page='table';tab='master';render()",
  c,
);
assert(element("master-rows").innerHTML.includes("cell-more"));
assert(element("master-rows").innerHTML.includes("master-grid"));
assert(vm.runInContext("table().master.columns.length", c) >= 12);
assert(!vm.runInContext("cell('<script>alert(1)</script>')", c).includes("<script>"));
console.log("スキーマ権限、多カラム、長文展開、文字列のエスケープを確認しました。");

const { JSDOM } = await import("jsdom");
const dom = new JSDOM("<!doctype html><html><body></body></html>");
globalThis.window = dom.window as unknown as Window & typeof globalThis;
globalThis.document = dom.window.document;
const { default: mermaid } = await import("mermaid");
mermaid.initialize({
  startOnLoad: false,
  securityLevel: "strict",
  layout: "elk",
});
for (const name of ["commerce", "analytics"]) {
  c.testDatabase = name;
  vm.runInContext("page='overview';activeDatabase=testDatabase", c);
  const definition = vm.runInContext("mermaid()", c);
  const parsed = await mermaid.parse(definition);
  assert.equal(parsed.diagramType, "er");
  vm.runInContext("db.tables.reverse();for(const t of db.tables)t.relations?.reverse()", c);
  assert.equal(vm.runInContext("mermaid()", c), definition, "Output order must be stable");
}
console.log("公式MermaidでER構文と出力順の再現性を確認しました。");
for (const action of ["fullscreen", "in", "out", "fit", "export"])
  assert(vm.runInContext("diagram()", c).includes(`data-er-action="${action}"`));
for (const [w, h, edge] of [
  [100, 200, 2400],
  [10000, 500, 4096],
  [1, 100000, 2400],
]) {
  c.dimensions = [w, h, edge];
  const size = vm.runInContext("jpegDimensions(...dimensions)", c);
  assert(size.width > 0 && size.height > 0);
  assert(Math.max(size.width, size.height) <= edge);
}
assert.throws(() => vm.runInContext("jpegDimensions(0,10,2400)", c));
console.log("ER操作ボタンとJPEGの出力サイズ上限を確認しました。");

assert(vm.runInContext("mermaid()", c).includes("subgraph"));
vm.runInContext("page='overview';activeDatabase='commerce'", c);
const erTables = vm.runInContext("erTables()", c) as FlatObject[];
const svg = dom.window.document.createElementNS("http://www.w3.org/2000/svg", "svg");
erTables.forEach((t, i) => {
  const group = dom.window.document.createElementNS("http://www.w3.org/2000/svg", "g");
  group.id = `kura-er-1-entity-T${i}-${i}`;
  group.setAttribute("class", "node");
  group.getBBox = () => new dom.window.DOMRect(-100, -60, 200, 120);
  svg.append(group);
});
c.document.createElementNS = (...args: unknown[]) =>
  Reflect.apply(dom.window.document.createElementNS, dom.window.document, args);
c.testSvg = svg;
vm.runInContext("addErDetails(testSvg)", c);
assert.equal(svg.querySelectorAll("[data-er-detail]").length, erTables.length);
assert.equal(svg.querySelector("[data-er-detail]")!.getAttribute("role"), "button");
console.log("スキーマ囲みの構文と、各テーブルの詳細ボタンを確認しました。");

assert(svg.querySelector("[data-er-detail] .lucide-square-arrow-out-up-right"));
assert.equal(svg.querySelectorAll("[data-er-detail] text").length, 0);
assert.equal(svg.querySelector("[data-er-detail]")!.getAttribute("transform"), "translate(64,-52)");

assert(!vm.runInContext("nullIcon(true)", c).includes("<svg"));
assert(vm.runInContext("nullIcon(false)", c).includes("<svg"));
assert(!vm.runInContext("yes(false)", c).includes("<svg"));
assert(vm.runInContext("yes(true)", c).includes("<svg"));
assert(vm.runInContext("yes(undefined)", c).includes("未取得"));

vm.runInContext("page='overview';activeDatabase='commerce';overviewTab='schemas';render()", c);
assert(element("overview-panel").innerHTML.includes("data-list-schema"));
vm.runInContext("overviewTab='tables';render()", c);
assert(element("overview-panel").innerHTML.includes("data-list-table"));

vm.runInContext(
  "page='table';selected=db.tables.find(t=>t.database==='commerce'&&t.displayName==='orders').name;activeDatabase='commerce';tab='relations'",
  c,
);
const hash = vm.runInContext("routeHash()", c);
c.testHash = hash;
assert(vm.runInContext("readRoute(testHash)", c));
assert.equal(vm.runInContext("tab", c), "relations");
assert.equal(vm.runInContext("table().displayName", c), "orders");
assert.equal(vm.runInContext("readRoute('#db=unknown&view=table')", c), false);
console.log("共有URLからのテーブル・タブ復元を確認しました。");

vm.runInContext(
  "page='table';selected=db.tables.find(t=>t.database==='commerce'&&t.displayName==='orders').name;tab='indexes';render()",
  c,
);
assert(element("panel").innerHTML.includes("orders_customer_created_idx"));
assert(element("panel").innerHTML.includes("orders_pending_idx"));
assert(svg.querySelector('[data-er-detail] rect[width="32"]'));

assert(
  svg.querySelector("[data-er-hit]")!.getAttribute("style")!.includes("fill:transparent!important"),
);

assert(html.includes('rel="icon"'));
vm.runInContext(
  "page='table';selected=db.tables.find(t=>t.displayName==='orders'&&t.database==='commerce').name;tab='columns';render()",
  c,
);
assert(!element("view").innerHTML.includes("マスターデータ件数"));
vm.runInContext("selected=db.tables.find(t=>t.displayName==='order_statuses').name;render()", c);
assert(element("view").innerHTML.includes("マスターデータ件数"));
for (const kind of ["view", "materialized_view"]) {
  c.testKind = kind;
  vm.runInContext(
    "selected=db.tables.find(t=>t.kind===testKind).name;page='table';tab='definition';render()",
    c,
  );
  assert(element("panel").innerHTML.includes("SELECT"));
  vm.runInContext("tab='dependencies';render()", c);
  assert(element("panel").innerHTML.includes("public.orders"));
  const tabs = vm.runInContext("detailTabs(table())", c) as [string, string][];
  assert(!tabs.some(([id]) => id === "master"));
  assert.equal(
    tabs.some(([id]) => id === "indexes"),
    kind === "materialized_view",
  );
}
vm.runInContext("page='overview';overviewTab='views';activeDatabase='commerce';render()", c);
assert(element("overview-panel").innerHTML.includes("active_orders"));
assert(element("overview-panel").innerHTML.includes("order_totals"));
console.log("通常ビュー・マテリアライズドビューの定義、依存関係、一覧を確認しました。");

for (const format of ["jpeg", "svg", "svg-hd", "mmd"])
  assert(vm.runInContext("diagram()", c).includes('value="' + format + '"'));
assert(vm.runInContext("diagram()", c).includes('value="svg" selected'));

vm.runInContext(
  "page='table';selected=db.tables.find(t=>t.database==='commerce'&&t.displayName==='orders').name;tab='er';render()",
  c,
);
const relatedNames = JSON.parse(
  vm.runInContext("JSON.stringify(erTables().map(t=>t.displayName))", c),
);
assert(relatedNames.includes("orders"));
assert(relatedNames.includes("customers"), "Include outgoing FK target");
assert(relatedNames.includes("order_events"), "Include incoming logical reference across schemas");
assert(!relatedNames.includes("active_orders"), "Exclude unrelated object");
assert(!element("panel").innerHTML.includes("スキーマ全体"));
await mermaid.parse(vm.runInContext("mermaid()", c));
vm.runInContext("page='overview';activeDatabase='commerce'", c);
assert(
  vm.runInContext('erTables().some(t=>t.displayName==="payment_methods")', c),
  "Overview retains all tables",
);
console.log("テーブルERの参照先・参照元の絞り込みと、DB全体ERを確認しました。");

// Snapshot embedding preserves literal text and cannot close the script element.
const escapedFixture = JSON.parse(JSON.stringify(sample));
escapedFixture.databases[0].schemas[0].tables[0].description = "</script><b> & $&";
const escapedCode = await viewerScript(escapedFixture);
assert(!escapedCode.includes("</script>"));
const escapedContext = { URLSearchParams, document: c.document };
vm.createContext(escapedContext);
vm.runInContext(escapedCode, escapedContext);
assert.deepEqual(
  JSON.parse(vm.runInContext("JSON.stringify(sample)", escapedContext)),
  escapedFixture,
);
