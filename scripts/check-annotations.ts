import { get } from "node:http";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import vm from "node:vm";
import { JSDOM } from "jsdom";
import type { Snapshot } from "../src/schema.ts";
import type { Annotations, EditorSettings } from "../src/annotations.ts";
import { mergeAnnotations, validateAnnotations, emptyAnnotations } from "../src/annotations.ts";
import { startEditor } from "./edit.ts";
import { readAnnotations } from "./annotations.ts";
import { viewerScript } from "./html.ts";
import { rebuild } from "./rebuild.ts";
const snapshot = JSON.parse(
  await readFile(new URL("../examples/schema.json", import.meta.url), "utf8"),
) as Snapshot;
const target = {
  kind: "column" as const,
  database: "commerce",
  schema: "public",
  table: "orders",
  column: "id",
};
const entries: Annotations["entries"] = [
  { target: { kind: "database", database: "commerce" }, description: "受注DB" },
  {
    target: { kind: "schema", database: "commerce", schema: "public" },
    description: "業務スキーマ",
  },
  {
    target: { kind: "table", database: "commerce", schema: "public", table: "orders" },
    description: "注文の設計",
  },
  { target, description: "注文識別子 </script> <b> & $&" },
];
const original = JSON.stringify(snapshot),
  annotations = validateAnnotations({ formatVersion: 1, entries });
const merged = mergeAnnotations(snapshot, annotations).snapshot;
assert.equal(merged.databases[0].description, "受注DB");
assert.equal(
  merged.databases[0].schemas.find((s) => s.name === "public")!.description,
  "業務スキーマ",
);
assert.equal(
  merged.databases[0].schemas
    .find((s) => s.name === "public")!
    .tables.find((t) => t.name === "orders")!.description,
  "注文の設計",
);
assert.equal(JSON.stringify(snapshot), original, "DB snapshot must never be mutated");
assert.deepEqual(mergeAnnotations(snapshot, emptyAnnotations()).snapshot, snapshot);
assert.throws(() => validateAnnotations({ formatVersion: 1, entries: [entries[0], entries[0]] }));
const orphan = {
  target: { kind: "table" as const, database: "commerce", schema: "public", table: "deleted" },
  description: "保存しておく説明",
};
assert.equal(
  mergeAnnotations(snapshot, { formatVersion: 1, entries: [orphan] }).unmatched.length,
  1,
);
const directory = await mkdtemp(resolve(tmpdir(), "kura-editor-"));
let server: Awaited<ReturnType<typeof startEditor>>["server"] | undefined;
try {
  const output = resolve(directory, "output"),
    configPath = resolve(directory, "config.json"),
    annotationsPath = resolve(directory, "annotations.json");
  await mkdir(output);
  await writeFile(resolve(output, "schema.json"), original);
  await writeFile(
    configPath,
    JSON.stringify({ connectionEnv: "NOT_USED", schemas: ["public"], output: "output" }),
  );
  const editor = await startEditor(configPath, 0);
  server = editor.server;
  assert.equal((server.address() as { address: string }).address, "127.0.0.1");
  const html = await (await fetch(editor.url)).text();
  const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][1][1];
  const nodes = new Map();
  const context = {
    URLSearchParams,
    document: {
      getElementById: (id: string) => {
        if (!nodes.has(id)) nodes.set(id, { value: "", innerHTML: "", textContent: "" });
        return nodes.get(id);
      },
      querySelectorAll: () => [],
      createElement: () => ({ className: "", innerHTML: "", querySelector: () => null }),
      querySelector: () => ({ append: () => {} }),
    },
  };
  vm.createContext(context);
  vm.runInContext(code, context);
  const settings = vm.runInContext("editorSettings", context) as EditorSettings;
  const send = (revision: string, doc: Annotations, extra: Record<string, string> = {}) =>
    fetch(editor.url + "api/annotations", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Kura-Token": settings.token, ...extra },
      body: JSON.stringify({ revision, annotations: doc }),
    });
  assert.equal(
    (await send(settings.revision, annotations, { "X-Kura-Token": "invalid" })).status,
    403,
  );
  assert.equal(
    (await send(settings.revision, annotations, { Origin: "https://outside.invalid" })).status,
    403,
  );
  const deniedHost = await new Promise<number | undefined>((accept, reject) => {
    get(editor.url, { headers: { Host: "outside.invalid" } }, (response) => {
      response.resume();
      accept(response.statusCode);
    }).on("error", reject);
  });
  assert.equal(deniedHost, 403);
  assert.equal(
    (await send(settings.revision, { formatVersion: 1, entries: [orphan] })).status,
    400,
  );
  const saved = await send(settings.revision, annotations);
  assert.equal(saved.status, 200);
  const state = (await saved.json()) as { revision: string };
  assert.deepEqual((await readAnnotations(annotationsPath)).annotations, annotations);
  assert.equal(await readFile(resolve(output, "schema.json"), "utf8"), original);
  const staticHtml = await readFile(resolve(output, "index.html"), "utf8");
  assert(staticHtml.includes("const editorSettings=null;"));
  assert.equal((await send(settings.revision, emptyAnnotations())).status, 409);
  await rebuild(configPath);
  assert.equal(
    await readFile(resolve(output, "index.html"), "utf8"),
    staticHtml,
    "Rebuild must use exactly the same merge",
  );
  const renderedCode = [...staticHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)][1][1];
  const readContext = { URLSearchParams, document: context.document };
  vm.createContext(readContext);
  vm.runInContext(renderedCode, readContext);
  assert.equal(vm.runInContext("sample.databases[0].description", readContext), "受注DB");
  assert.equal(
    vm.runInContext(
      'sample.databases[0].schemas.find(s=>s.name==="public").tables.find(t=>t.name==="orders").columns.find(c=>c.name==="id").description',
      readContext,
    ),
    entries[3].description,
  );
  assert.equal(vm.runInContext("editorSettings", readContext), null);
  // Test edit controls and form saving with a DOM fixture; this is not browser visual verification.
  const dom = new JSDOM(await readFile(new URL("../viewer/index.html", import.meta.url), "utf8"));
  dom.window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  dom.window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new dom.window.Event("close"));
  };
  let reloads = 0;
  const ui = {
    URLSearchParams,
    setTimeout,
    clearTimeout,
    document: dom.window.document,
    location: { hash: "", reload: () => reloads++ },
    fetch: (path: string, init: RequestInit) => fetch(new URL(path, editor.url), init),
  };
  const uiSettings: EditorSettings = {
    ...settings,
    revision: state.revision,
    annotations,
    unmatched: [],
  };
  const uiCode = await viewerScript(merged, uiSettings);
  vm.createContext(ui);
  vm.runInContext(uiCode, ui);
  assert(dom.window.document.querySelector("[data-edit-description]"));
  assert(dom.window.document.querySelector("header .actions .editor-banner"));
  vm.runInContext(
    "page='table';selected=db.tables.find(t=>t.database==='commerce'&&t.displayName==='orders').name;tab='columns';render()",
    ui,
  );
  const buttons = [
    ...dom.window.document.querySelectorAll<HTMLButtonElement>("[data-edit-description]"),
  ];
  const button = buttons.find((b) => JSON.parse(b.dataset.editDescription!).kind === "column")!;
  button.click();
  const dialog = dom.window.document.querySelector("dialog")!,
    textarea = dialog.querySelector("textarea")!;
  assert(dialog.open);
  assert(textarea.value);
  assert(button.querySelector("svg"));
  assert(!button.textContent);
  assert(!dialog.querySelector('button[type="submit"]'));
  assert(!dialog.querySelector(".original-comment"));
  const previewPanel = dialog.querySelector<HTMLElement>(".annotation-preview")!;
  const writePanel = dialog.querySelector<HTMLElement>("#annotation-write")!;
  assert(previewPanel.hidden);
  textarea.value = "**プレビュー**";
  dialog.querySelector<HTMLButtonElement>('[data-mode="preview"]')!.click();
  assert(writePanel.hidden);
  assert(!previewPanel.hidden);
  assert.equal(previewPanel.querySelector("strong")!.textContent, "プレビュー");
  dialog.querySelector<HTMLButtonElement>('[data-mode="write"]')!.click();
  assert(!writePanel.hidden);
  assert(previewPanel.hidden);
  assert.equal(textarea.value, "**プレビュー**");

  const waitSaved = async () => {
    for (
      let i = 0;
      i < 400 && dialog.querySelector<HTMLElement>(".editor-status")!.dataset.state !== "saved";
      i++
    )
      await new Promise((r) => setTimeout(r, 25));
    assert.equal(dialog.querySelector<HTMLElement>(".editor-status")!.dataset.state, "saved");
  };
  textarea.value = "一文字目";
  textarea.dispatchEvent(new dom.window.Event("input"));
  textarea.value = "UIからの自動保存";
  textarea.dispatchEvent(new dom.window.Event("input"));
  await waitSaved();
  assert.equal(reloads, 0, "No page reload after save");
  assert(
    (await readAnnotations(annotationsPath)).annotations.entries.some(
      (e) => e.description === "UIからの自動保存",
    ),
  );
  assert(
    [...dom.window.document.querySelectorAll("[data-description-value]")].some(
      (e) => e.querySelector(".kura-description")?.textContent?.trim() === "UIからの自動保存",
    ),
  );
  assert(dom.window.document.querySelector(".description-divider"));
  assert(dom.window.document.querySelector(".db-comment"));
  assert(dialog.open);
  textarea.dispatchEvent(new dom.window.Event("compositionstart"));
  textarea.value = "変換中";
  textarea.dispatchEvent(new dom.window.Event("input"));
  await new Promise((r) => setTimeout(r, 800));
  assert(
    !(await readAnnotations(annotationsPath)).annotations.entries.some(
      (e) => e.description === "変換中",
    ),
  );
  textarea.value = "変換後";
  textarea.dispatchEvent(new dom.window.Event("compositionend"));
  await waitSaved();
  assert(
    (await readAnnotations(annotationsPath)).annotations.entries.some(
      (e) => e.description === "変換後",
    ),
  );
  assert(!dialog.querySelector("[data-reset]"));
  assert(!dialog.querySelector("label"));
  assert(!dialog.querySelector("h2 + p"));
  textarea.value = "";
  textarea.dispatchEvent(new dom.window.Event("input"));
  await waitSaved();
  assert(
    !(await readAnnotations(annotationsPath)).annotations.entries.some(
      (e) => e.target.kind === "column" && e.target.column === "id",
    ),
  );
  textarea.value = "閉じる前の保存";
  textarea.dispatchEvent(new dom.window.Event("input"));
  dialog.querySelector<HTMLButtonElement>("[data-close]")!.click();
  for (let i = 0; i < 400 && dialog.isConnected; i++) await new Promise((r) => setTimeout(r, 25));
  assert(!dialog.isConnected);
  assert(
    (await readAnnotations(annotationsPath)).annotations.entries.some(
      (e) => e.description === "閉じる前の保存",
    ),
  );
  const latest = await readAnnotations(annotationsPath);
  const resets = await send(latest.revision, emptyAnnotations());
  assert.equal(resets.status, 200);
  const resetHtml = await readFile(resolve(output, "index.html"), "utf8");
  assert(!resetHtml.includes("UIからの保存"));
  assert.equal(await readFile(resolve(output, "schema.json"), "utf8"), original);
  // External file changes are detected and unmatched annotations are preserved.
  await writeFile(annotationsPath, JSON.stringify({ formatVersion: 1, entries: [orphan] }));
  const nextHtml = await (await fetch(editor.url)).text();
  assert(nextHtml.includes("deleted"));
  const orphanState = await readAnnotations(annotationsPath);
  assert.equal((await send(orphanState.revision, emptyAnnotations())).status, 200);
  assert.deepEqual((await readAnnotations(annotationsPath)).annotations, emptyAnnotations());
  const finalState = await readAnnotations(annotationsPath);
  await writeFile(resolve(output, "schema.json"), original + "\n");
  assert.equal(
    (await send(finalState.revision, annotations)).status,
    409,
    "Do not overwrite HTML for a changed snapshot",
  );
  console.log(
    "説明のマージ・編集UI・ファイル保存・再生成・削除・競合・ローカルAPI制限を確認しました。",
  );
} finally {
  if (server)
    await new Promise<void>((accept, reject) => server!.close((e) => (e ? reject(e) : accept())));
  await rm(directory, { recursive: true, force: true });
}
