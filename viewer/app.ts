import MarkdownIt from "markdown-it";
import type { EditorSettings, AnnotationTarget } from "../src/annotations.ts";
declare const editorSettings: EditorSettings | null;
import type {
  Snapshot,
  NormalizedSnapshot,
  FlatObject,
  Relation,
  DbObject,
} from "../src/schema.ts";
declare const sample: Snapshot;
function normalize(
  input: Snapshot | { formatVersion: 1; name?: string; tables: DbObject[] },
): NormalizedSnapshot {
  const nested =
    "databases" in input
      ? input.databases
      : [
          {
            name: input.name || "Database",
            schemas: [{ name: "public", tables: input.tables }],
          },
        ];
  const tables: FlatObject[] = [];
  const databases = nested.map((d) => ({
    ...d,
    name: d.name,
    schemas: d.schemas.map((sc) => ({
      ...sc,
      name: sc.name,
      tables: sc.tables.map((t) => {
        const id = JSON.stringify([d.name, sc.name, t.name]);
        const flat: FlatObject = {
          ...t,
          kind: t.kind || "table",
          dependencies: t.dependencies?.map((r) => ({
            ...r,
            target: JSON.stringify([r.database || d.name, r.schema || sc.name, r.name]),
          })),
          name: id,
          displayName: t.name,
          database: d.name,
          schema: sc.name,
          relations: (t.relations || []).map((r) => ({
            ...r,
            table: JSON.stringify([r.database || d.name, r.schema || sc.name, r.table]),
          })),
        };
        tables.push(flat);
        return flat;
      }),
    })),
  }));
  return { ...input, tables, databases };
}
let db = normalize(sample),
  selected = (db.tables.find((t) => t.displayName === "order_statuses") || db.tables[0]).name,
  tab = "columns",
  masterQuery = "",
  page = "overview",
  activeDatabase = db.databases[0].name,
  overviewTab = "info",
  roleFilter = "",
  activeSchema = "public";
let tabsResize;
const expanded = new Map();
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
const table = () => db.tables.find((t) => t.name === selected);
const currentDatabase = () =>
  db.databases.find((d) => d.name === activeDatabase) || db.databases[0];
const currentTables = () =>
  db.tables.filter(
    (t) => t.database === (page === "table" ? table().database : currentDatabase().name),
  );
const logical = (r: Relation) => r.kind === "logical";
const friendly = (id) => {
  const t = db.tables.find((t) => t.name === id);
  return t ? t.schema + "." + t.displayName : id;
};
function save(name: string, text: string, type: string) {
  const u = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
const sidebarIcons: Record<string, string> = {
  database:
    '<ellipse cx="12" cy="5" rx="9" ry="3" />\n  <path d="M3 5V19A9 3 0 0 0 21 19V5" />\n  <path d="M3 12A9 3 0 0 0 21 12" />',
  folders:
    '<path d="M20 5a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h2.5a1.5 1.5 0 0 1 1.2.6l.6.8a1.5 1.5 0 0 0 1.2.6z" />\n  <path d="M3 8.268a2 2 0 0 0-1 1.738V19a2 2 0 0 0 2 2h11a2 2 0 0 0 1.732-1" />',
  "table-2":
    '<path d="M3 9h18" />\n  <path d="M9 3v18" />\n  <rect x="3" y="3" width="18" height="18" rx="2" />',
  "layout-dashboard":
    '<rect width="7" height="9" x="3" y="3" rx="1" />\n  <rect width="7" height="5" x="14" y="3" rx="1" />\n  <rect width="7" height="9" x="14" y="12" rx="1" />\n  <rect width="7" height="5" x="3" y="16" rx="1" />',
};
sidebarIcons.view =
  '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 9v12"/><circle cx="15" cy="15" r="2"/>';
function sidebarIcon(name) {
  return `<span class="tree-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${sidebarIcons[name]}</svg></span>`;
}
const isView = (t: DbObject) => t.kind === "view" || t.kind === "materialized_view";
const kindLabel = (t: DbObject) =>
  t.kind === "view"
    ? "ビュー"
    : t.kind === "materialized_view"
      ? "マテリアライズドビュー"
      : t.master
        ? "マスター"
        : "テーブル";
function detailTabs(t: DbObject) {
  return isView(t)
    ? [
        ["columns", "カラム定義"],
        ["definition", "定義SQL"],
        ["dependencies", "依存関係"],
        ...(t.kind === "materialized_view" ? [["indexes", "インデックス"]] : []),
      ]
    : [
        ["columns", "カラム定義"],
        ["master", "マスターデータ"],
        ["indexes", "インデックス"],
        ["relations", "リレーション"],
        ["er", "ER図"],
      ];
}
function nav() {
  const q = $<HTMLInputElement>("search").value.toLowerCase();
  let count = 0;
  $("tables").innerHTML =
    db.databases
      .map((d) => {
        const dk = JSON.stringify([d.name]);
        const schemas = d.schemas
          .map((sc) => {
            const sk = JSON.stringify([d.name, sc.name]);
            const hits = sc.tables.filter((t) =>
              (t.database + " " + t.schema + " " + t.displayName + " " + (t.description || ""))
                .toLowerCase()
                .includes(q),
            );
            if (!hits.length) return "";
            count += hits.length;
            return `<details class="tree-group" data-tree="${esc(sk)}" ${q || expanded.get(sk) !== false ? "open" : ""}><summary class="tree-heading"><button class="tree-toggle" data-toggle-tree="${esc(sk)}" aria-label="${esc(sc.name)}を展開・折りたたみ" aria-expanded="${q || expanded.get(sk) !== false ? "true" : "false"}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></button><button class="tree-row schema-link ${page === "schema" && activeDatabase === d.name && activeSchema === sc.name ? "active" : ""}" data-schema="${esc(sk)}">${sidebarIcon("folders")}<span>${esc(sc.name)}</span><small>${hits.length}</small></button></summary><div class="tree-children">${hits.map((t) => `<button class="nav ${page === "table" && selected === t.name ? "active" : ""}" data-select="${esc(t.name)}"><span>${sidebarIcon(isView(t) ? "view" : "table-2")} ${esc(t.displayName)}</span><small>${isView(t) ? (t.kind === "view" ? "VIEW" : "MAT VIEW") : t.master ? "MASTER" : t.columns.length}</small></button>`).join("")}</div></details>`;
          })
          .join("");
        if (!schemas) return "";
        return `<details class="tree-group" data-tree="${esc(dk)}" ${q || expanded.get(dk) !== false ? "open" : ""}><summary class="tree-heading"><button class="tree-toggle" data-toggle-tree="${esc(dk)}" aria-label="${esc(d.name)}を展開・折りたたみ" aria-expanded="${q || expanded.get(dk) !== false ? "true" : "false"}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></button><button class="tree-row" data-db="${esc(d.name)}">${sidebarIcon("database")}<strong>${esc(d.name)}</strong></button></summary><div class="tree-children"><button class="nav ${page === "overview" && activeDatabase === d.name ? "active" : ""}" data-db="${esc(d.name)}"><span>${sidebarIcon("layout-dashboard")} Overview</span></button>${schemas}</div></details>`;
      })
      .join("") || '<div class="empty">見つかりません</div>';
  document.querySelectorAll<HTMLElement>("[data-select]").forEach(
    (b) =>
      (b.onclick = () => {
        selected = b.dataset.select;
        activeDatabase = table().database;
        page = "table";
        tab = "columns";
        masterQuery = "";
        render();
      }),
  );
  document
    .querySelectorAll<HTMLElement>(".tree-heading")
    .forEach((summary) => (summary.onclick = (e) => e.preventDefault()));
  document.querySelectorAll<HTMLElement>("[data-toggle-tree]").forEach(
    (button) =>
      (button.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const group = button.closest("details");
        group.open = !group.open;
        button.setAttribute("aria-expanded", String(group.open));
        expanded.set(button.dataset.toggleTree, group.open);
      }),
  );
  document.querySelectorAll<HTMLElement>("[data-schema]").forEach(
    (b) =>
      (b.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        [activeDatabase, activeSchema] = JSON.parse(b.dataset.schema);
        page = "schema";
        render();
      }),
  );
  document.querySelectorAll<HTMLElement>("[data-db]").forEach(
    (b) =>
      (b.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        activeDatabase = b.dataset.db;
        page = "overview";
        overviewTab = "info";
        render();
      }),
  );
  document.querySelectorAll<HTMLDetailsElement>("[data-tree]").forEach(
    (el) =>
      (el.ontoggle = () => {
        if (!q) expanded.set(el.dataset.tree, el.open);
      }),
  );
}
function routeHash() {
  const params = new URLSearchParams({ db: activeDatabase, view: page });
  if (page === "overview") params.set("tab", overviewTab);
  if (page === "schema") params.set("schema", activeSchema);
  if (page === "table") {
    const t = table();
    params.set("schema", t.schema);
    params.set("table", t.displayName);
    params.set("tab", tab);
  }
  return "#" + params.toString();
}
function writeRoute() {
  if (typeof location === "undefined" || typeof history === "undefined") return;
  const next = routeHash();
  if (location.hash !== next) history.pushState(null, "", next);
}
function readRoute(hash) {
  try {
    const p = new URLSearchParams(hash.replace(/^#/, "")),
      database = db.databases.find((d) => d.name === p.get("db"));
    if (!database) return false;
    const view = p.get("view");
    if (view === "table") {
      const t = db.tables.find(
        (t) =>
          t.database === database.name &&
          t.schema === p.get("schema") &&
          t.displayName === p.get("table"),
      );
      if (!t) return false;
      selected = t.name;
      tab = detailTabs(t).some(([id]) => id === p.get("tab")) ? p.get("tab") : "columns";
    } else if (view === "schema") {
      if (!database.schemas.some((s) => s.name === p.get("schema"))) return false;
      activeSchema = p.get("schema");
    } else if (view === "overview") {
      overviewTab = ["info", "schemas", "tables", "views", "er", "accounts", "logical"].includes(
        p.get("tab"),
      )
        ? p.get("tab")
        : "info";
    } else return false;
    activeDatabase = database.name;
    page = view;
    masterQuery = "";
    return true;
  } catch {
    return false;
  }
}
function render(updateUrl = true) {
  if (updateUrl) writeRoute();
  cleanupDiagrams();
  const view = $("view");
  const oldBar = view.querySelector?.<HTMLElement>(".tab-indicator")?.getBoundingClientRect();
  const oldTabs = view.querySelector?.<HTMLElement>(".tabs")?.dataset.context;
  renderContent();
  bindInfoHints();
  bindDescriptionEditors();
  animateTabs(oldBar, oldTabs);
  renderDiagrams();
}
function animateTabs(previous, previousContext) {
  const view = $("view"),
    tabs = view.querySelector?.<HTMLElement>(".tabs"),
    reduce =
      typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (tabs) {
    const context = page === "table" ? selected : activeDatabase;
    tabs.dataset.context = context;
    const active = tabs.querySelector(".tab.active"),
      bar = document.createElement("span");
    bar.className = "tab-indicator";
    tabs.append(bar);
    const update = (old?: DOMRect) => {
      const rect = active.getBoundingClientRect(),
        parent = tabs.getBoundingClientRect(),
        left = rect.left - parent.left + tabs.scrollLeft;
      bar.style.width = rect.width + "px";
      bar.style.transform = `translateX(${left}px)`;
      if (old && previousContext === context && !reduce && bar.animate)
        bar.animate(
          [
            {
              transform: `translateX(${old.left - parent.left + tabs.scrollLeft}px)`,
              width: old.width + "px",
            },
            { transform: `translateX(${left}px)`, width: rect.width + "px" },
          ],
          { duration: 330, easing: "cubic-bezier(.22,1,.36,1)" },
        );
    };
    update(previous);
    if (typeof ResizeObserver !== "undefined") {
      tabsResize?.disconnect();
      tabsResize = new ResizeObserver(() => update());
      tabsResize.observe(tabs);
    }
  }
  const panel = view.querySelector?.("#panel, #overview-panel");
  if (panel?.animate && !reduce)
    panel.animate(
      [
        { opacity: 0, transform: "translateY(4px)", filter: "blur(2px)" },
        { opacity: 1, transform: "translateY(0)", filter: "blur(0)" },
      ],
      { duration: 300, easing: "cubic-bezier(.22,1,.36,1)" },
    );
}
let renderSequence = 0;
const diagramCleanups = [];
function cleanupDiagrams() {
  for (const fn of diagramCleanups.splice(0)) fn();
}
async function renderDiagrams() {
  const seq = ++renderSequence;
  const targets = $("view").querySelectorAll?.<HTMLElement>("[data-er]");
  if (!targets?.length) return;
  $("view")
    .querySelectorAll<HTMLElement>("[data-er-open]")
    .forEach((button) => (button.onclick = () => openErTable(button.dataset.erOpen)));
  const source = mermaid();
  for (const target of targets) {
    try {
      if (!globalThis.KuraER)
        throw Error("ライブラリを同梱するため npm run build で生成したHTMLを開いてください。");
      const svg = await globalThis.KuraER(source);
      if (seq !== renderSequence || !target.isConnected) return;
      target.innerHTML = svg;
      setupDiagram(target);
    } catch (error) {
      if (seq !== renderSequence) return;
      target.textContent = "ER図を表示できませんでした: " + error.message;
    }
  }
}
function renderContent() {
  nav();
  if (page === "schema") {
    renderSchema();
    return;
  }
  if (page === "overview") {
    renderOverview();
    return;
  }
  const t = table(),
    refs = db.tables.flatMap((x) =>
      (x.relations || []).filter((r) => r.table === t.name).map((r) => ({ from: x.name, ...r })),
    );
  $("breadcrumb").textContent = t.database + " / " + t.schema + " / " + t.displayName;
  $("footer").textContent =
    `取得元: ${db.environment || "未指定"}  ·  取得日時: ${db.capturedAt || "未指定"}  ·  format v${db.formatVersion}`;
  $("view").innerHTML =
    `<div class="heading"><div><h1>${esc(t.displayName)}</h1>${descriptionEditor({ kind: "table", database: t.database, schema: t.schema, table: t.displayName }, t.description)}</div><span class="badge ${t.master ? "" : "neutral"}">${kindLabel(t)}</span></div><div class="stats"><div class="stat"><span>カラム</span><strong>${t.columns.length}</strong><span>Columns</span></div><div class="stat"><span>参照関係</span><strong>${(t.relations || []).length + refs.length}</strong><span>Incoming & outgoing</span></div>${t.master ? `<div class="stat"><span>マスターデータ件数</span><strong>${t.master.rows.length}</strong><span>${t.master.complete ? "全件掲載" : "抜粋"}</span></div>` : ""}</div><div class="tabs">${detailTabs(
      t,
    )
      .map(
        ([id, label]) =>
          `<button class="tab ${tab === id ? "active" : ""}" data-tab="${id}">${label}</button>`,
      )
      .join("")}</div><div id="panel"></div>`;
  document.querySelectorAll<HTMLElement>("[data-tab]").forEach(
    (b) =>
      (b.onclick = () => {
        tab = b.dataset.tab;
        render();
      }),
  );
  if (tab === "columns")
    $("panel").innerHTML =
      `<div class="card"><div class="card-head"><h2>カラム定義</h2></div><div class="table-scroll"><table class="columns-grid"><thead><tr><th>カラム名</th><th>型</th><th title="NULLを許可しない制約">NOT_NULL</th><th>デフォルト</th><th>コメント</th></tr></thead><tbody>${t.columns.map((c) => `<tr><td><code>${esc(c.name)}</code>${c.pk ? '<span class="key">PK</span>' : ""}${(t.relations || []).some((r) => r.column === c.name && !logical(r)) ? '<span class="key">FK</span>' : ""}</td><td><code>${esc(c.type)}</code></td><td>${nullIcon(c.nullable)}</td><td><code>${cell(c.default ?? "—")}</code></td><td>${descriptionEditor({ kind: "column", database: t.database, schema: t.schema, table: t.displayName, column: c.name }, c.description)}</td></tr>`).join("")}</tbody></table></div></div>`;
  if (tab === "master") {
    if (!t.master) {
      $("panel").innerHTML =
        '<div class="card empty">このテーブルはマスターデータの掲載対象ではありません。</div>';
      return;
    }
    $("panel").innerHTML =
      `<div class="card"><div class="card-head"><h2>マスターデータ</h2><input class="search" id="master-search" placeholder="値・コメントで検索" style="width:240px;margin:0" aria-label="マスターデータ検索"></div><div class="table-scroll" id="master-rows"></div></div><div class="callout">コメント案はサンプルです。値から推測した業務上の意味は、アプリのコードや仕様を確認してから採用します。</div>`;
    $<HTMLInputElement>("master-search").value = masterQuery;
    $("master-search").oninput = (e) => {
      masterQuery = (e.target as HTMLInputElement).value;
      masterRows();
    };
    masterRows();
  }
  if (tab === "definition")
    $("panel").innerHTML =
      `<div class="card"><div class="card-head"><h2>定義SQL</h2></div><div class="content"><pre>${esc(t.definition || "未取得")}</pre>${t.kind === "materialized_view" ? `<p>データ格納状態：${t.populated === true ? "格納済み" : t.populated === false ? "未格納" : "未取得"}</p><div class="source">最終REFRESH日時は標準のメタデータから取得できないため表示しません。</div>` : ""}</div></div>`;
  if (tab === "dependencies") {
    const incoming = db.tables.flatMap((x) =>
      (x.dependencies || []).filter((d) => d.target === t.name).map(() => ({ target: x.name })),
    );
    const links = (list) =>
      list
        .map(
          (d) =>
            `<div class="relation"><button data-dependency="${esc(d.target)}">${esc(friendly(d.target))}</button></div>`,
        )
        .join("") || '<div class="empty">なし</div>';
    $("panel").innerHTML =
      `<div class="card"><div class="card-head"><h2>参照先</h2></div>${t.dependencies ? links(t.dependencies) : '<div class="empty">未取得</div>'}</div><div class="card"><div class="card-head"><h2>このビューを参照するオブジェクト</h2></div>${links(incoming)}</div>`;
    document
      .querySelectorAll<HTMLElement>("[data-dependency]")
      .forEach((button) => (button.onclick = () => openErTable(button.dataset.dependency)));
  }
  if (tab === "indexes")
    $("panel").innerHTML =
      `<div class="card"><div class="card-head"><h2>インデックス</h2></div>${Array.isArray(t.indexes) ? (t.indexes.length ? `<div class="table-scroll"><table class="indexes-grid"><thead><tr><th>名前</th><th>方式</th><th>キー / 式</th><th>PK</th><th>UNIQUE</th><th>有効</th><th>INCLUDE</th><th>条件</th></tr></thead><tbody>${t.indexes.map((x) => `<tr><td><code>${esc(x.name)}</code></td><td>${esc(x.method || "未取得")}</td><td>${cell((x.keys || []).join(", "))}</td><td>${yes(x.primary)}</td><td>${yes(x.unique)}</td><td>${yes(x.valid)}</td><td>${cell((x.include || []).join(", ") || "—")}</td><td>${cell(x.predicate || "—")}</td></tr>`).join("")}</tbody></table></div><div class="content">${t.indexes.map((x) => `<div style="margin-bottom:16px"><div class="source">${esc(x.name)}</div><pre>${esc(x.definition || "定義未取得")}</pre></div>`).join("")}</div>` : '<div class="empty">インデックスはありません。</div>') : '<div class="empty">インデックス情報は未取得です。</div>'}</div>`;
  if (tab === "relations")
    $("panel").innerHTML =
      `<div class="card"><div class="card-head"><h2>参照先・参照元</h2></div>${(t.relations || []).map((r) => `<div class="relation"><code>${esc(t.displayName)}.${esc(r.column)}</code><span>${logical(r) ? "⇢ 論理" : "→ FK"}</span><button data-go="${esc(r.table)}">${esc(friendly(r.table))}.${esc(r.target)}</button></div>`).join("")}${refs.map((r) => `<div class="relation"><button data-go="${esc(r.from)}">${esc(friendly(r.from))}.${esc(r.column)}</button><span>${logical(r) ? "⇢ 論理" : "→ FK"}</span><code>${esc(t.displayName)}.${esc(r.target)}</code></div>`).join("")}${!refs.length && !(t.relations || []).length ? '<div class="empty">外部キーの定義はありません。</div>' : ""}</div>`;
  if (tab === "er") {
    const mm = mermaid();
    $("panel").innerHTML =
      `<div class="card"><div class="card-head"><h2>関連テーブルのER図</h2></div><div class="diagram">${diagram()}</div></div><div class="card"><div class="card-head"><h2>Mermaidソース</h2></div><div class="content"><pre>${esc(mm)}</pre></div></div>`;
  }
  document.querySelectorAll<HTMLElement>("[data-go]").forEach(
    (b) =>
      (b.onclick = () => {
        selected = b.dataset.go;
        activeDatabase = table().database;
        page = "table";
        tab = "columns";
        render();
      }),
  );
}
function boolIcon(value, trueLabel = "あり", falseLabel = "なし") {
  if (value === false)
    return `<span class="boolean-empty" title="${esc(falseLabel)}" aria-label="${esc(falseLabel)}"></span>`;
  if (value !== true)
    return '<span class="boolean-unknown" title="未取得" role="img" aria-label="未取得">?</span>';
  return `<span class="boolean-check" title="${esc(trueLabel)}" role="img" aria-label="${esc(trueLabel)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg></span>`;
}
function nullIcon(nullable) {
  return boolIcon(
    nullable === true ? false : nullable === false ? true : undefined,
    "NOT NULL制約あり",
    "NULL許容",
  );
}
function cell(value) {
  const text =
    value === null
      ? "NULL"
      : value === undefined
        ? "—"
        : typeof value === "object"
          ? JSON.stringify(value, null, 2)
          : String(value);
  if (text.length <= 140) return `<div class="cell-text">${esc(text)}</div>`;
  return `<details class="cell-more"><div class="cell-preview cell-text">${esc(text)}</div><summary>全文を表示 / 閉じる（${text.length.toLocaleString()}文字）</summary><div class="cell-full cell-text">${esc(text)}</div></details>`;
}
function masterRows() {
  const t = table(),
    q = masterQuery.toLowerCase(),
    rows = t.master.rows.filter((r) =>
      (
        JSON.stringify(r) +
        " " +
        ((t.notes || []).find((n) => n.key === String(r[t.master.columns[0]]))?.text || "")
      )
        .toLowerCase()
        .includes(q),
    );
  $("master-rows").innerHTML =
    `<table class="master-grid" style="width:${t.master.columns.length * 220 + 360}px"><thead><tr>${t.master.columns.map((c) => `<th>${esc(c)}</th>`).join("")}<th>意味・補足</th></tr></thead><tbody>${rows
      .map((r) => {
        const n = (t.notes || []).find((n) => n.key === String(r[t.master.columns[0]]));
        return `<tr>${t.master.columns.map((c) => `<td>${typeof r[c] === "boolean" ? `<span class="badge ${r[c] ? "" : "neutral"}">${r[c] ? "有効" : "無効"}</span>` : cell(r[c])}</td>`).join("")}<td>${n ? `${cell(n.text)} <span class="badge ${n.confirmed ? "" : "llm"}">${n.confirmed ? "確認済み" : "要確認"}</span><div class="source">${cell(n.source)}</div>` : "—"}</td></tr>`;
      })
      .join(
        "",
      )}</tbody></table>${!rows.length ? '<div class="empty">一致するデータがありません。</div>' : ""}`;
}
function erTables() {
  const tables = currentTables(),
    included = new Set([selected]);
  if (page === "table") {
    for (const t of tables)
      for (const r of t.relations || []) {
        if (t.name === selected) included.add(r.table);
        if (r.table === selected) included.add(t.name);
      }
  }
  return tables
    .filter((t) =>
      page === "schema" ? t.schema === activeSchema : page !== "table" || included.has(t.name),
    )
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
function mermaid() {
  const tables = erTables(),
    names = new Map(tables.map((t, i) => [t.name, "T" + i])),
    schemas = [...new Set(tables.map((t) => t.schema))].sort();
  const clean = (v) => String(v).replace(/["\r\n]/g, "");
  const groups = schemas.map(
    (schema, index) =>
      `    subgraph S${index}["${clean(schema)} スキーマ"]\n` +
      tables
        .filter((t) => t.schema === schema)
        .map(
          (t) =>
            `        ${names.get(t.name)}["${clean(t.displayName)}"] {\n${t.columns.map((c, i) => `            ${c.type.replace(/[^a-zA-Z0-9_]/g, "_")} ${/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(c.name) ? c.name : "column_" + i}${c.pk ? " PK" : ""}`).join("\n")}\n        }`,
        )
        .join("\n") +
      "\n    end",
  );
  return (
    "---\nconfig:\n  layout: elk\n---\nerDiagram\n" +
    groups.join("\n") +
    "\n" +
    tables
      .flatMap((t) =>
        [...(t.relations || [])]
          .filter(
            (r) =>
              names.has(r.table) &&
              (page !== "table" || t.name === selected || r.table === selected),
          )
          .sort((a, b) =>
            JSON.stringify(a) < JSON.stringify(b)
              ? -1
              : JSON.stringify(a) > JSON.stringify(b)
                ? 1
                : 0,
          )
          .map(
            (r) =>
              `    ${names.get(t.name)} ${logical(r) ? "}o..||" : "}o--||"} ${names.get(r.table)} : "${clean(r.column + (logical(r) ? "（論理参照）" : ""))}"`,
          ),
      )
      .join("\n")
  );
}
async function openErTable(id) {
  if (document.fullscreenElement) await document.exitFullscreen();
  selected = id;
  activeDatabase = table().database;
  page = "table";
  tab = "columns";
  masterQuery = "";
  render();
}
function addErDetails(svg: SVGSVGElement) {
  const ns = "http://www.w3.org/2000/svg";
  erTables().forEach((table, index) => {
    const entity =
      svg.querySelector<SVGGElement>(`g[id="entity-T${index}-${index}"]`) ||
      [...svg.querySelectorAll<SVGGElement>("g.node")].find((n) =>
        new RegExp(`(?:^|-)entity-T${index}-[0-9]+$`).test(n.id),
      );
    if (!entity) return;
    const box = entity.getBBox(),
      name = entity.querySelector<SVGGraphicsElement>(".name");
    if (name) {
      const labelBox = name.getBBox(),
        available = Math.max(30, box.width - 48),
        scale = Math.min(1, available / Math.max(1, labelBox.width));
      name.setAttribute(
        "transform",
        `translate(${box.x + 10 - labelBox.x * scale},${box.y + 6 - labelBox.y * scale}) scale(${scale})`,
      );
    }
    const button = document.createElementNS(ns, "g");
    button.setAttribute("data-er-detail", table.name);
    button.setAttribute("role", "button");
    button.setAttribute("tabindex", "0");
    button.setAttribute("aria-label", table.displayName + "の詳細");
    button.setAttribute("transform", `translate(${box.x + box.width - 36},${box.y + 8})`);
    button.style.cursor = "pointer";
    const icon = document.createElementNS(ns, "svg");
    for (const [key, value] of Object.entries({
      x: 2,
      y: 2,
      width: 14,
      height: 14,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "#4267df",
      "stroke-width": 2,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      class: "lucide lucide-square-arrow-out-up-right",
    }))
      icon.setAttribute(key, String(value));
    for (const d of [
      "M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6",
      "m21 3-9 9",
      "M15 3h6v6",
    ]) {
      const path = document.createElementNS(ns, "path");
      path.setAttribute("d", d);
      icon.append(path);
    }
    const title = document.createElementNS(ns, "title");
    title.textContent = table.displayName + "の詳細を開く";
    const hit = document.createElementNS(ns, "rect");
    for (const [key, value] of Object.entries({
      x: -7,
      y: -7,
      width: 32,
      height: 32,
      rx: 5,
      fill: "transparent",
      stroke: "none",
      "stroke-width": 1,
      "data-er-hit": "",
      "pointer-events": "all",
    }))
      hit.setAttribute(key, String(value));
    hit.setAttribute(
      "style",
      "fill:transparent!important;stroke:none!important;stroke-width:0!important",
    );
    button.classList.add("er-detail-button");
    button.append(title, hit, icon);
    const open = (e) => {
      e.preventDefault();
      e.stopPropagation();
      openErTable(table.name).catch((err) => {
        svg.closest(".er-widget").querySelector(".er-message").textContent = err.message;
      });
    };
    button.addEventListener("pointerdown", (e) => e.stopPropagation());
    button.addEventListener("click", open);
    button.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") open(e);
    });
    entity.append(button);
  });
}
function diagram() {
  return `<section class="er-widget" aria-label="ER図ビューアー"><div class="er-toolbar"><button class="btn" data-er-action="fullscreen">全画面</button><button class="btn" data-er-action="out" aria-label="縮小">−</button><span class="er-scale" aria-live="polite">100%</span><button class="btn" data-er-action="in" aria-label="拡大">＋</button><button class="btn" data-er-action="fit">全体表示</button><select class="btn" data-er-format aria-label="書き出し形式"><option value="jpeg">JPEG</option><option value="svg" selected>SVG（標準）</option><option value="svg-hd">SVG（高精細）</option><option value="mmd">MMD</option></select><button class="btn" data-er-action="export">書き出し</button></div><div class="er-viewport" data-er><div class="diagram-status">MermaidでER図を配置しています…</div></div><div class="er-message" role="status"></div><div class="er-hint">ドラッグで移動 · ホイール / ピンチで拡大縮小 · 保存時は図全体を出力</div><div class="er-table-links">${erTables()
    .map(
      (t) =>
        `<button class="btn" data-er-open="${esc(t.name)}">${esc(t.displayName)} <span style="color:var(--muted)">(${esc(t.schema)})</span></button>`,
    )
    .join("")}</div></section>`;
}
function jpegDimensions(width, height, maxEdge) {
  if (!(width > 0 && height > 0)) throw Error("図のサイズを取得できません。");
  const ratio = Math.min(maxEdge / width, maxEdge / height);
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}
function exportedSvg(svg: SVGSVGElement, scale = 1) {
  const clone = svg.cloneNode(true) as SVGSVGElement,
    box = svg.viewBox.baseVal;
  clone.querySelectorAll<HTMLElement>("[data-er-detail]").forEach((button) => button.remove());
  clone.style.removeProperty("transform");
  clone.style.removeProperty("transform-origin");
  clone.style.removeProperty("transition");
  clone.style.removeProperty("width");
  clone.style.removeProperty("height");
  clone.style.removeProperty("max-width");
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(box.width * scale));
  clone.setAttribute("height", String(box.height * scale));
  return {
    text: new XMLSerializer().serializeToString(clone),
    width: box.width,
    height: box.height,
  };
}
async function jpegBlob(svg: SVGSVGElement, maxEdge: number) {
  await document.fonts?.ready;
  const exported = exportedSvg(svg),
    size = jpegDimensions(exported.width, exported.height, maxEdge),
    url = URL.createObjectURL(new Blob([exported.text], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(Error("図の画像化に失敗しました。SVG保存をお試しください。"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw Error("画像を生成できません。");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, size.width, size.height);
    ctx.drawImage(img, 0, 0, size.width, size.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.94),
    );
    if (!blob) throw Error("JPEGを書き出せませんでした。SVG保存をお試しください。");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}
function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function setupDiagram(target: HTMLElement) {
  const widget = target.closest<HTMLElement>(".er-widget"),
    svg = target.querySelector("svg");
  if (!widget || !svg || !globalThis.KuraPanzoom) return;
  addErDetails(svg);
  const message = widget.querySelector(".er-message"),
    label = widget.querySelector(".er-scale"),
    pan = globalThis.KuraPanzoom(svg, {
      minScale: 0.2,
      maxScale: 8,
      step: 0.08,
      animate: false,
    });
  const wheel = (e) => pan.zoomWithWheel(e),
    change = (e) => (label.textContent = Math.round(e.detail.scale * 100) + "%");
  target.addEventListener("wheel", wheel, { passive: false });
  svg.addEventListener("panzoomchange", change);
  const full = widget.querySelector<HTMLButtonElement>('[data-er-action="fullscreen"]');
  const onFullscreen = () => {
    full.textContent = document.fullscreenElement === widget ? "全画面を閉じる" : "全画面";
    pan.reset({ animate: false });
  };
  document.addEventListener("fullscreenchange", onFullscreen);
  diagramCleanups.push(() => {
    pan.destroy();
    target.removeEventListener("wheel", wheel);
    svg.removeEventListener("panzoomchange", change);
    document.removeEventListener("fullscreenchange", onFullscreen);
  });
  widget.querySelectorAll<HTMLButtonElement>("[data-er-action]").forEach(
    (button) =>
      (button.onclick = async () => {
        message.textContent = "";
        try {
          switch (button.dataset.erAction) {
            case "in":
              pan.zoomIn();
              break;
            case "out":
              pan.zoomOut();
              break;
            case "fit":
              pan.reset({ animate: true });
              break;
            case "fullscreen":
              if (document.fullscreenElement === widget) await document.exitFullscreen();
              else if (widget.requestFullscreen) await widget.requestFullscreen();
              else throw Error("このブラウザーは全画面表示に対応していません。");
              break;
            case "export": {
              const format = widget.querySelector<HTMLSelectElement>("[data-er-format]").value,
                name = currentDatabase().name + "-er";
              button.disabled = true;
              button.textContent = "書き出し中…";
              try {
                if (format === "mmd") save(name + ".mmd", mermaid(), "text/plain");
                else if (format === "jpeg") downloadBlob(name + ".jpg", await jpegBlob(svg, 2400));
                else {
                  const out = exportedSvg(svg, format === "svg-hd" ? 2 : 1);
                  save(
                    name + (format === "svg-hd" ? "-hd" : "") + ".svg",
                    out.text,
                    "image/svg+xml",
                  );
                }
              } finally {
                button.disabled = false;
                button.textContent = "書き出し";
              }
              break;
            }
          }
        } catch (error) {
          message.textContent = error.message;
        }
      }),
  );
}

function yes(v) {
  return boolIcon(v);
}
const infoHints = {
  serverVersion: "接続先PostgreSQLのバージョン。利用できる機能やSQLの差異を確認できます。",
  owner: "データベースを所有するロール。テーブル個別の所有者とは異なる場合があります。",
  encoding: "文字の保存に使う文字コード。通常はUTF8です。",
  collation: "文字列の比較や並べ替えに使う規則。列ごとの設定も影響します。",
  ctype: "文字の分類や大文字・小文字の扱いに使うロケールです。",
  size: "データベースのディスク使用量。変動するため標準では取得しません。includeRuntimeInfoを有効にすると取得します。",
  connectionLimit: "このDBへの接続数上限。-1はDB単位の制限なし。サーバー全体の接続制限は別です。",
  timezone: "取得に使った接続のタイムゾーン。別のアプリ接続の設定と同じとは限りません。",
  searchPath: "スキーマを省略した名前を探す順序。取得接続で収集処理が変更する前の値です。",
  currentUser: "取得に使った接続の実効ロール。取得できる情報や権限に関係します。",
  recovery: "サーバーがリカバリー中かどうか。スタンバイ等でtrueになります。",
};
function infoHint(label, key) {
  return (
    '<span class="info-label info-hover" data-info-hint="' +
    key +
    '" tabindex="0" aria-describedby="hint-' +
    key +
    '">' +
    esc(label) +
    '</span><div class="info-popover" role="tooltip" id="hint-' +
    key +
    '" popover="manual">' +
    esc(infoHints[key] || "コメント未登録") +
    "</div>"
  );
}
function bindInfoHints() {
  document.querySelectorAll<HTMLElement>("[data-info-hint]").forEach((label) => {
    const pop = $("hint-" + label.dataset.infoHint);
    const close = () => {
      if (pop.hidePopover && pop.matches(":popover-open")) pop.hidePopover();
    };
    const show = () => {
      if (!pop.showPopover) return;
      document.querySelectorAll<HTMLElement>(".info-popover").forEach((other) => {
        if (other !== pop && other.matches(":popover-open")) other.hidePopover();
      });
      if (!pop.matches(":popover-open")) pop.showPopover();
      const box = label.getBoundingClientRect(),
        size = pop.getBoundingClientRect();
      pop.style.left = Math.max(16, Math.min(box.left, innerWidth - size.width - 16)) + "px";
      pop.style.top =
        (box.bottom + 8 + size.height > innerHeight
          ? Math.max(16, box.top - size.height - 8)
          : box.bottom + 8) + "px";
    };
    label.onmouseenter = show;
    label.onmouseleave = close;
    label.onfocus = show;
    label.onblur = close;
    label.onkeydown = (e) => {
      if (e.key === "Escape") close();
    };
  });
}
function renderOverview() {
  const d = currentDatabase(),
    tables = currentTables(),
    relations = tables.flatMap((t) => (t.relations || []).map((r) => ({ from: t, ...r }))),
    info = d.info || {};
  $("breadcrumb").textContent = d.name + " / Overview";
  $("footer").textContent =
    `取得元: ${db.environment || "未指定"} · 取得日時: ${db.capturedAt || "未指定"}${db.environment === "demo" ? " · サンプル情報" : ""}`;
  $("view").innerHTML =
    `<div class="heading"><div><h1>${esc(d.name)}</h1>${descriptionEditor({ kind: "database", database: d.name }, d.description)}</div><span class="badge neutral">${esc(info.serverVersion || "バージョン未取得")}</span></div><div class="overview-counts"><button class="count-card" data-overview="schemas"><span>スキーマ</span><strong>${d.schemas.length}</strong></button><button class="count-card" data-overview="tables"><span>テーブル</span><strong>${tables.filter((t) => !isView(t)).length}</strong></button><button class="count-card" data-overview="views"><span>ビュー</span><strong>${tables.filter(isView).length}</strong></button></div><div class="tabs">${[
      ["info", "基本情報"],
      ["schemas", "スキーマ一覧"],
      ["tables", "テーブル一覧"],
      ["views", "ビュー一覧"],
      ["er", "ER図"],
      ["accounts", "アカウント・権限"],
      ["logical", "論理リレーション"],
    ]
      .map(
        ([id, label]) =>
          `<button class="tab ${overviewTab === id ? "active" : ""}" data-overview="${id}">${label}</button>`,
      )
      .join("")}</div><div id="overview-panel"></div>`;
  document.querySelectorAll<HTMLElement>("[data-overview]").forEach(
    (b) =>
      (b.onclick = () => {
        overviewTab = b.dataset.overview;
        render();
      }),
  );
  const panel = $("overview-panel");
  if (overviewTab === "info") {
    const fields = [
      ["サーバーバージョン", "serverVersion", "SHOW server_version"],
      ["DB所有者", "owner", "\\l+"],
      ["エンコーディング", "encoding", "\\l+"],
      ["照合順序", "collation", "\\l+"],
      ["文字分類", "ctype", "\\l+"],
      ["接続数上限", "connectionLimit", "pg_database.datconnlimit"],
      ["タイムゾーン", "timezone", "SHOW TimeZone"],
      ["search_path", "searchPath", "SHOW search_path"],
      ["取得時のロール", "currentUser", "current_user"],
      ["リカバリー中", "recovery", "pg_is_in_recovery()"],
    ];
    panel.innerHTML = `<div class="card"><div class="card-head"><h2>データベース基本情報</h2></div><div class="table-scroll"><table class="db-info-grid"><thead><tr><th>項目</th><th>値</th><th>取得元</th></tr></thead><tbody>${fields.map(([label, key, source]) => `<tr><td>${infoHint(label, key)}</td><td>${esc(key === "connectionLimit" && info[key] === -1 ? "制限なし" : key === "recovery" && typeof info[key] === "boolean" ? (info[key] ? "リカバリー中" : "通常稼働") : (info[key] ?? info.excluded?.[key] ?? "未取得"))}</td><td><code>${esc(source)}</code></td></tr>`).join("")}</tbody></table></div></div><div class="card"><div class="card-head"><h2>拡張機能</h2></div><div class="table-scroll"><table class="extensions-grid"><thead><tr><th>拡張名</th><th>バージョン</th><th>スキーマ</th></tr></thead><tbody>${(info.extensions || []).map((e) => `<tr><td><code>${esc(e.name)}</code></td><td>${esc(e.version)}</td><td>${esc(e.schema)}</td></tr>`).join("")}</tbody></table></div>${!info.extensions ? '<div class="empty">未取得</div>' : ""}</div>`;
  }
  if (overviewTab === "er") {
    panel.innerHTML = `<div class="card"><div class="card-head"><h2>Entity Relationship Diagram</h2></div><div class="content"><span class="badge neutral">実線：外部キー</span> <span class="badge llm">破線：論理リレーション（未確認を含む）</span></div><div class="diagram">${diagram()}</div></div>`;
  }
  if (overviewTab === "schemas") {
    panel.innerHTML = `<div class="card"><div class="card-head"><h2>スキーマ一覧</h2></div><div class="table-scroll"><table class="schemas-grid"><thead><tr><th>スキーマ</th><th>所有者</th><th>テーブル数</th></tr></thead><tbody>${d.schemas.map((sc) => `<tr><td><button class="link-button" data-list-schema="${esc(sc.name)}">${esc(sc.name)}</button></td><td>${esc(sc.owner || "未取得")}</td><td>${sc.tables.length}</td></tr>`).join("")}</tbody></table></div></div>`;
    panel.querySelectorAll?.<HTMLElement>("[data-list-schema]").forEach(
      (button) =>
        (button.onclick = () => {
          activeSchema = button.dataset.listSchema;
          page = "schema";
          render();
        }),
    );
  }
  if (overviewTab === "tables" || overviewTab === "views") {
    panel.innerHTML = `<div class="card"><div class="card-head"><h2>${overviewTab === "views" ? "ビュー一覧" : "テーブル一覧"}</h2></div><div class="table-scroll"><table class="objects-grid"><thead><tr><th>テーブル</th><th>スキーマ</th><th>カラム数</th><th>種別</th><th>コメント</th></tr></thead><tbody>${tables
      .filter((t) => (overviewTab === "views" ? isView(t) : !isView(t)))
      .map(
        (t) =>
          `<tr><td><button class="link-button" data-list-table="${esc(t.name)}">${esc(t.displayName)}</button></td><td>${esc(t.schema)}</td><td>${t.columns.length}</td><td>${kindLabel(t)}</td><td>${descriptionEditor({ kind: "table", database: t.database, schema: t.schema, table: t.displayName }, t.description)}</td></tr>`,
      )
      .join("")}</tbody></table></div></div>`;
    panel
      .querySelectorAll?.<HTMLElement>("[data-list-table]")
      .forEach((button) => (button.onclick = () => openErTable(button.dataset.listTable)));
  }
  if (overviewTab === "accounts") {
    const roles = db.roles || [];
    panel.innerHTML = `<div class="card"><div class="card-head"><h2>アカウント・ロール一覧</h2><small>ロールはPostgreSQLクラスタ共通 / 権限はこのDB</small></div><div class="table-scroll"><table class="roles-grid"><thead><tr><th>ロール</th><th>ログイン</th><th>Superuser</th><th>INHERIT</th><th>所属ロール</th></tr></thead><tbody>${roles.map((r) => `<tr><td><code>${esc(r.name)}</code></td><td>${yes(r.login)}</td><td>${yes(r.superuser)}</td><td>${yes(r.inherit)}</td><td>${esc((r.memberships || []).join(", ") || "—")}</td></tr>`).join("")}</tbody></table></div>${!roles.length ? '<div class="empty">ロール情報は未取得です。</div>' : ""}</div><div class="card"><div class="card-head"><h2>スキーマをまたぐ参照権限</h2><select id="role-filter" class="btn"><option value="">すべてのロール</option>${roles.map((r) => `<option value="${esc(r.name)}" ${roleFilter === r.name ? "selected" : ""}>${esc(r.name)}</option>`).join("")}</select></div><div id="access-rows" class="table-scroll"></div></div><div class="callout">CONNECT・スキーマUSAGE・テーブルSELECTを分けて表示します。権限があっても、接続認証やRLSのポリシーによって実際の接続・参照範囲は変わります。列単位の権限とSET ROLEによる切り替えはこの試作では未評価です。</div>`;
    $("role-filter").onchange = (e) => {
      roleFilter = (e.target as HTMLInputElement).value;
      accessRows();
    };
    accessRows();
  }
  if (overviewTab === "logical") {
    const list = relations.filter(logical);
    panel.innerHTML = `<div class="card"><div class="card-head"><h2>制約未定義の論理リレーション</h2></div>${list.map((r) => `<div class="content" style="border-bottom:1px solid var(--line)"><code>${esc(r.from.schema)}.${esc(r.from.displayName)}.${esc(r.column)}</code> ⇢ <code>${esc(friendly(r.table))}.${esc(r.target)}</code> <span class="badge ${r.confirmed ? "" : "llm"}">${r.confirmed ? "確認済み" : "候補・要確認"}</span><p>${esc(r.description || "コメント未登録")}</p><div class="source">根拠：${esc(r.source || "未登録")}</div></div>`).join("") || '<div class="empty">論理リレーションは未登録です。</div>'}</div><div class="callout">スキーマをまたぐ外部キーもPostgreSQLで定義できます。ここにはスキーマ境界に関係なく、外部キー制約が存在しない関係を掲載します。名前・型の一致は候補に留め、JOIN条件や仕様を根拠に確認します。</div>`;
  }
}
function accessRows() {
  const rows = (currentDatabase().access || []).filter((a) => !roleFilter || a.role === roleFilter);
  $("access-rows").innerHTML =
    `<table class="access-grid"><thead><tr><th>ロール</th><th>対象</th><th>CONNECT</th><th>USAGE</th><th>SELECT</th><th>参照判定</th><th title="INSERT">追加</th><th title="UPDATE">更新</th><th title="DELETE">削除</th><th>権限経路 / RLS</th></tr></thead><tbody>${rows
      .map((a) => {
        const ok = a.connect === true && a.usage === true && a.select === true,
          blocked = [a.connect, a.usage, a.select].includes(false);
        return `<tr><td><code>${esc(a.role)}</code></td><td><code>${esc(a.schema)}.${esc(a.table)}</code></td><td>${yes(a.connect)}</td><td>${yes(a.usage)}</td><td>${yes(a.select)}</td><td><span class="badge ${ok ? "" : blocked ? "neutral" : "llm"}">${ok ? "基本権限あり" : blocked ? "基本権限不足" : "未評価"}</span></td><td>${yes(a.insert)}</td><td>${yes(a.update)}</td><td>${yes(a.delete)}</td><td>${esc(a.via || "未取得")}<div class="source">RLS：${esc(a.rls || "未取得")}</div></td></tr>`;
      })
      .join(
        "",
      )}</tbody></table>${!rows.length ? '<div class="empty">このロールの権限情報は未取得です。</div>' : ""}`;
}
function renderSchema() {
  const d = currentDatabase(),
    sc = d.schemas.find((x) => x.name === activeSchema);
  if (!sc) {
    $("view").innerHTML = '<div class="empty">スキーマが見つかりません。</div>';
    return;
  }
  const accounts = (d.schemaAccess || []).filter((a) => a.schema === sc.name);
  $("breadcrumb").textContent = d.name + " / " + sc.name;
  $("footer").textContent = "スキーマ権限とテーブル権限は別です。未取得の権限は推測しません。";
  $("view").innerHTML =
    `<div class="heading"><div><h1>${esc(sc.name)}</h1>${descriptionEditor({ kind: "schema", database: d.name, schema: sc.name }, sc.description)}</div><span class="badge neutral">スキーマ</span></div><div class="stats"><div class="stat"><span>所属テーブル</span><strong>${sc.tables.length}</strong><span>このスキーマのテーブル</span></div><div class="stat"><span>USAGEありのロール</span><strong>${d.schemaAccess ? accounts.filter((a) => a.usage === true).length : "—"}</strong><span>取得済みロールのうち</span></div><div class="stat"><span>所有者</span><strong style="font-size:18px">${esc(sc.owner || "未取得")}</strong><span>スキーマ所有者</span></div></div><div class="card"><div class="card-head"><h2>スキーマへのアクセス権限</h2></div><div class="table-scroll"><table class="schema-access-grid"><thead><tr><th>アカウント・ロール</th><th>ログイン</th><th>CONNECT</th><th>USAGE</th><th>CREATE</th><th>付与経路</th></tr></thead><tbody>${accounts.map((a) => `<tr><td><code>${esc(a.role)}</code></td><td>${yes((db.roles || []).find((r) => r.name === a.role)?.login)}</td><td>${yes(a.connect)}</td><td>${yes(a.usage)}</td><td>${yes(a.create)}</td><td>${cell(a.via || "未取得")}</td></tr>`).join("")}</tbody></table></div>${!accounts.length ? '<div class="empty">スキーマ権限は未取得です。</div>' : ""}</div><div class="callout">USAGEはスキーマ内のオブジェクトにアクセスするための権限です。テーブルの参照には別途SELECTが必要です。テーブル権限とRLSはDB概要の「アカウント・権限」で確認できます。</div><h2 style="margin:28px 0 16px">所属するテーブル・ビュー</h2><div class="schema-cards">${sc.tables.map((t) => `<div class="card"><div class="card-head"><h2><button class="link-button" data-schema-table="${esc(t.name)}">${esc(t.displayName)}</button></h2><span class="badge ${t.master ? "" : "neutral"}">${kindLabel(t)}</span></div><div class="content">${descriptionEditor({ kind: "table", database: t.database, schema: t.schema, table: t.displayName }, t.description)}<div class="source">${t.columns.length}カラム · ${(t.relations || []).length}参照先</div></div></div>`).join("")}</div>`;
  $("view").innerHTML +=
    `<div class="card"><div class="card-head"><h2>Entity Relationship Diagram</h2></div><div class="content"><span class="badge neutral">実線：外部キー</span> <span class="badge llm">破線：論理リレーション（未確認を含む）</span></div><div class="diagram">${diagram()}</div></div>`;
  document.querySelectorAll<HTMLElement>("[data-schema-table]").forEach(
    (b) =>
      (b.onclick = () => {
        selected = b.dataset.schemaTable;
        page = "table";
        tab = "columns";
        masterQuery = "";
        render();
      }),
  );
}
// oxlint-disable-next-line eslint/no-unused-vars -- Entry point invoked by the VM checks in scripts/check.ts and scripts/demo.ts.
function validate(v) {
  if (v && Array.isArray(v.databases)) {
    const dbNames = new Set();
    for (const d of v.databases) {
      if (typeof d.name !== "string" || dbNames.has(d.name) || !Array.isArray(d.schemas))
        throw Error("データベース名は一意で、schemas 配列が必要です。");
      dbNames.add(d.name);
      const schemas = new Set();
      for (const sc of d.schemas) {
        if (typeof sc.name !== "string" || schemas.has(sc.name) || !Array.isArray(sc.tables))
          throw Error("スキーマ名は一意で、tables 配列が必要です。");
        schemas.add(sc.name);
        const names = new Set();
        for (const t of sc.tables) {
          if (typeof t.name !== "string" || names.has(t.name))
            throw Error("スキーマ内のテーブル名は一意にしてください。");
          names.add(t.name);
        }
      }
    }
    v = normalize(v);
  }
  if (!v || v.formatVersion !== 1 || !Array.isArray(v.tables) || !v.tables.length)
    throw Error("formatVersion: 1 と空でない tables 配列が必要です。");
  if (v.tables.length > 200) throw Error("この試作版では200テーブルまで読み込めます。");
  const names = new Set();
  for (const t of v.tables) {
    if (typeof t.name !== "string" || names.has(t.name) || !Array.isArray(t.columns))
      throw Error("テーブル名は一意で、columns 配列が必要です。");
    names.add(t.name);
    if (t.columns.some((c) => typeof c.name !== "string" || typeof c.type !== "string"))
      throw Error("各カラムに name と type が必要です。");
    if (
      t.master &&
      (!Array.isArray(t.master.columns) ||
        !Array.isArray(t.master.rows) ||
        t.master.rows.some((r) => !r || typeof r !== "object"))
    )
      throw Error("マスターには columns と rows 配列が必要です。");
    if (t.kind && !["table", "view", "materialized_view"].includes(t.kind))
      throw Error("未対応のオブジェクト種別です。");
    if (t.dependencies && !Array.isArray(t.dependencies))
      throw Error("dependencies は配列にしてください。");
    if (t.notes && !Array.isArray(t.notes)) throw Error("notes は配列にしてください。");
    if (t.relations && !Array.isArray(t.relations)) throw Error("relations は配列にしてください。");
  }
  for (const t of v.tables)
    for (const r of t.relations || [])
      if (
        !names.has(r.table) ||
        !t.columns.some((c) => c.name === r.column) ||
        !v.tables.find((x) => x.name === r.table).columns.some((c) => c.name === r.target)
      )
        throw Error("外部キーのテーブルまたはカラムが見つかりません。");
  return v;
}
const descriptionMarkdown = new MarkdownIt({ html: false, breaks: true, linkify: false }).disable(
  "image",
);
function markdownDescription(value: string): string {
  return '<div class="markdown-description">' + descriptionMarkdown.render(value) + "</div>";
}
function descriptionContent(target: AnnotationTarget, description?: string | null): string {
  const object = descriptionObject(target);
  const kura = object?.kuraDescription,
    comment = object?.dbComment ?? (kura === undefined ? description : null);
  if (kura && comment)
    return (
      '<div class="kura-description">' +
      markdownDescription(kura) +
      '</div><hr class="description-divider"><div class="db-comment">' +
      cell(comment) +
      "</div>"
    );
  if (kura?.trim()) return markdownDescription(kura);
  const text = comment || description;
  return text?.trim() ? cell(text) : '<span class="comment-empty">コメント未入力</span>';
}
function descriptionEditor(target: AnnotationTarget, description?: string | null): string {
  const content = descriptionContent(target, description);
  if (!editorSettings) return '<div class="description-text">' + content + "</div>";
  return (
    '<div class="description-editable"><div class="description-text" data-description-value="' +
    esc(JSON.stringify(target)) +
    '">' +
    content +
    '</div><button class="link-button description-edit" data-edit-description="' +
    esc(JSON.stringify(target)) +
    '" title="コメントを編集" aria-label="コメントを編集"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button></div>'
  );
}
function bindDescriptionEditors() {
  if (!editorSettings) return;
  document
    .querySelectorAll<HTMLElement>("[data-edit-description]")
    .forEach(
      (button) =>
        (button.onclick = () => openDescriptionEditor(JSON.parse(button.dataset.editDescription))),
    );
}
function annotationKey(t: AnnotationTarget): string {
  return JSON.stringify([
    t.kind,
    t.database,
    "schema" in t ? t.schema : null,
    "table" in t ? t.table : null,
    "column" in t ? t.column : null,
  ]);
}
function editorTargetLabel(t: AnnotationTarget): string {
  return [
    t.database,
    "schema" in t ? t.schema : null,
    "table" in t ? t.table : null,
    "column" in t ? t.column : null,
  ]
    .filter((x) => x !== null)
    .join(" / ");
}
let descriptionSaveQueue: Promise<unknown> = Promise.resolve();
function originalDescription(target: AnnotationTarget): string {
  return (
    editorSettings.originalDescriptions?.find(
      (e) => annotationKey(e.target) === annotationKey(target),
    )?.description || ""
  );
}
function descriptionObject(
  target: AnnotationTarget,
): import("../src/schema.ts").Descriptions | undefined {
  const database = db.databases.find((d) => d.name === target.database);
  if (target.kind === "database") return database;
  const schema = database?.schemas.find((s) => s.name === target.schema);
  if (target.kind === "schema") return schema;
  const table = schema?.tables.find((t) => t.displayName === target.table);
  if (target.kind === "table") return table;
  return table?.columns.find((c) => c.name === target.column);
}
function updateDescriptionDisplay(previous: EditorSettings["annotations"]) {
  const targets = new Map(
    [...previous.entries, ...editorSettings.annotations.entries].map((e) => [
      annotationKey(e.target),
      e.target,
    ]),
  );
  const changed = new Set<string>();
  for (const [key, target] of targets) {
    const object = descriptionObject(target);
    if (!object) continue;
    const next =
      editorSettings.annotations.entries.find((e) => annotationKey(e.target) === key)
        ?.description ?? originalDescription(target);
    const kura = editorSettings.annotations.entries.find(
      (e) => annotationKey(e.target) === key,
    )?.description;
    if (object.description !== next || object.kuraDescription !== kura) {
      object.dbComment = originalDescription(target);
      object.kuraDescription = kura;
      object.description = next;
      changed.add(key);
    }
  }
  document.querySelectorAll<HTMLElement>("[data-description-value]").forEach((element) => {
    const target = JSON.parse(element.dataset.descriptionValue) as AnnotationTarget;
    if (changed.has(annotationKey(target)))
      element.innerHTML = descriptionContent(target, descriptionObject(target)?.description);
  });
  editorSettings.unmatched = editorSettings.unmatched.filter((e) =>
    editorSettings.annotations.entries.some(
      (x) => annotationKey(x.target) === annotationKey(e.target),
    ),
  );
  const orphanButton = document.querySelector<HTMLElement>("[data-unmatched]");
  if (orphanButton) {
    if (editorSettings.unmatched.length)
      orphanButton.textContent =
        "対象が見つからないコメント: " + editorSettings.unmatched.length + "件";
    else orphanButton.remove();
  }
}
async function saveDescriptions(
  entries:
    | EditorSettings["annotations"]["entries"]
    | (() => EditorSettings["annotations"]["entries"]),
  message: HTMLElement,
): Promise<boolean> {
  message.textContent = "保存中…";
  message.dataset.state = "saving";
  const operation = descriptionSaveQueue.then(async () => {
    try {
      const previous = editorSettings.annotations;
      const response = await fetch("/api/annotations", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Kura-Token": editorSettings.token },
        body: JSON.stringify({
          revision: editorSettings.revision,
          annotations: {
            formatVersion: 1,
            entries: typeof entries === "function" ? entries() : entries,
          },
        }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || "保存できませんでした。");
      editorSettings.revision = result.revision;
      editorSettings.annotations = result.annotations;
      updateDescriptionDisplay(previous);
      message.textContent = result.warning || "保存済み";
      message.dataset.state = result.warning ? "error" : "saved";
      return true;
    } catch (error) {
      message.textContent = error instanceof Error ? error.message : String(error);
      message.dataset.state = "error";
      return false;
    }
  });
  descriptionSaveQueue = operation.catch(() => {});
  return operation;
}
function openDescriptionEditor(target: AnnotationTarget) {
  if (document.querySelector(".description-dialog")) return;
  const key = annotationKey(target),
    existing = editorSettings.annotations.entries.find((e) => annotationKey(e.target) === key);
  const dialog = document.createElement("dialog");
  dialog.className = "description-dialog annotation-dialog";
  dialog.innerHTML =
    '<h2>コメント</h2><div class="annotation-tabs" role="tablist" aria-label="コメントの編集モード"><button type="button" role="tab" aria-selected="true" aria-controls="annotation-write" id="annotation-write-tab" data-mode="write">Write</button><button type="button" role="tab" aria-selected="false" aria-controls="annotation-preview" id="annotation-preview-tab" data-mode="preview" tabindex="-1">Preview</button></div><div class="annotation-panels"><div id="annotation-write" role="tabpanel" aria-labelledby="annotation-write-tab"><textarea id="annotation-description" aria-label="コメント（Markdown）" rows="8" maxlength="50000" placeholder="この対象の役割や、設計の意図を入力"></textarea></div><div id="annotation-preview" role="tabpanel" aria-labelledby="annotation-preview-tab" class="annotation-preview markdown-description" hidden></div></div><p class="source">入力を止めると自動保存します。DBコメントは変更しません。</p><div class="editor-status" role="status" data-state="saved">保存済み</div><div class="editor-actions"><button type="button" class="btn" data-close>閉じる</button></div>';
  const textarea = dialog.querySelector("textarea"),
    message = dialog.querySelector<HTMLElement>(".editor-status");
  let saved: string | null = existing ? existing.description : null,
    desired = saved;
  textarea.value = existing?.description ?? "";
  const preview = dialog.querySelector<HTMLElement>(".annotation-preview")!;
  const updatePreview = () => {
    preview.innerHTML = descriptionMarkdown.render(textarea.value);
  };
  updatePreview();
  const modeButtons = [...dialog.querySelectorAll<HTMLButtonElement>("[data-mode]")];
  const setMode = (mode: string) => {
    updatePreview();
    dialog.querySelector<HTMLElement>("#annotation-write")!.hidden = mode !== "write";
    preview.hidden = mode !== "preview";
    for (const button of modeButtons) {
      const selected = button.dataset.mode === mode;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
  };
  modeButtons.forEach((button, index) => {
    button.onclick = () => setMode(button.dataset.mode!);
    button.onkeydown = (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? 1 : 1 - index;
      setMode(modeButtons[next].dataset.mode!);
      modeButtons[next].focus();
    };
  });
  let timer: ReturnType<typeof setTimeout> | undefined,
    active: Promise<boolean> | undefined,
    composing = false;
  const flush = async (): Promise<boolean> => {
    if (composing) return false;
    clearTimeout(timer);
    timer = undefined;
    if (active) {
      const ok = await active;
      if (!ok) return false;
      return flush();
    }
    if (desired === saved) return true;
    const value = desired;
    active = saveDescriptions(() => {
      const entries = editorSettings.annotations.entries.filter(
        (e) => annotationKey(e.target) !== key,
      );
      if (value !== null) entries.push({ target, description: value });
      return entries;
    }, message);
    const ok = await active;
    active = undefined;
    if (!ok) return false;
    saved = value;
    if (desired !== saved) return flush();
    return true;
  };
  const schedule = () => {
    desired = textarea.value || null;
    updatePreview();
    clearTimeout(timer);
    if (desired === saved && !active) {
      message.textContent = "保存済み";
      message.dataset.state = "saved";
      return;
    }
    message.textContent = "入力中…";
    message.dataset.state = "pending";
    if (!composing) timer = setTimeout(() => void flush(), 650);
  };
  textarea.oninput = schedule;
  textarea.addEventListener("compositionstart", () => {
    composing = true;
    clearTimeout(timer);
  });
  textarea.addEventListener("compositionend", () => {
    composing = false;
    schedule();
  });
  textarea.onblur = () => {
    if (!composing) void flush();
  };
  const close = async () => {
    if (composing) return;
    const ok = await flush();
    if (ok) dialog.close();
  };
  dialog.querySelector<HTMLButtonElement>("[data-close]").onclick = close;
  dialog.oncancel = (e) => {
    e.preventDefault();
    void close();
  };
  const unload = (e: BeforeUnloadEvent) => {
    if (desired !== saved || active) {
      e.preventDefault();
      e.returnValue = "";
    }
  };
  if (typeof addEventListener === "function") addEventListener("beforeunload", unload);
  dialog.onclose = () => {
    clearTimeout(timer);
    if (typeof removeEventListener === "function") removeEventListener("beforeunload", unload);
    dialog.remove();
  };
  document.body.append(dialog);
  dialog.showModal();
  textarea.focus();
}

function initializeEditor() {
  if (!editorSettings) return;
  const bar = document.createElement("div");
  bar.className = "editor-banner";
  bar.innerHTML =
    "<span>コメントの編集モード · annotations.jsonへ保存</span>" +
    (editorSettings.unmatched.length
      ? '<button class="link-button" data-unmatched>対象が見つからないコメント: ' +
        editorSettings.unmatched.length +
        "件</button>"
      : "");
  document.querySelector("header .actions").append(bar);
  const button = bar.querySelector<HTMLButtonElement>("[data-unmatched]");
  if (button)
    button.onclick = () => {
      const dialog = document.createElement("dialog");
      dialog.className = "description-dialog";
      dialog.innerHTML =
        '<h2>対象が見つからないコメント</h2><p class="source">削除・名前変更された対象のコメントです。自動では削除しません。</p><div class="editor-status" role="status"></div>' +
        editorSettings.unmatched
          .map(
            (entry, i) =>
              '<div class="orphan-description"><strong>' +
              esc(editorTargetLabel(entry.target)) +
              "</strong><p>" +
              esc(entry.description) +
              '</p><button class="btn" data-orphan="' +
              i +
              '">コメントを削除</button></div>',
          )
          .join("") +
        '<button class="btn" data-close>閉じる</button>';
      dialog.querySelectorAll<HTMLButtonElement>("[data-orphan]").forEach(
        (b) =>
          (b.onclick = async () => {
            dialog
              .querySelectorAll<HTMLButtonElement>("button")
              .forEach((x) => (x.disabled = true));
            const target = editorSettings.unmatched[Number(b.dataset.orphan)].target;
            const ok = await saveDescriptions(
              () =>
                editorSettings.annotations.entries.filter(
                  (e) => annotationKey(e.target) !== annotationKey(target),
                ),
              dialog.querySelector<HTMLElement>(".editor-status"),
            );
            if (ok) b.closest(".orphan-description").remove();
            dialog
              .querySelectorAll<HTMLButtonElement>("button")
              .forEach((x) => (x.disabled = false));
          }),
      );
      dialog.querySelector<HTMLButtonElement>("[data-close]").onclick = () => dialog.close();
      dialog.onclose = () => dialog.remove();
      document.body.append(dialog);
      dialog.showModal();
    };
}
initializeEditor();
$("search").oninput = nav;
if (typeof location !== "undefined") readRoute(location.hash);
if (typeof addEventListener === "function") {
  const restore = () => {
    if (readRoute(location.hash)) render(false);
  };
  addEventListener("popstate", restore);
  addEventListener("hashchange", restore);
}
render();
