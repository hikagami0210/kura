import { mergeAnnotations, emptyAnnotations, originalDescriptions } from "../src/annotations.ts";
import type { Annotations, EditorSettings } from "../src/annotations.ts";
import { readFile } from "node:fs/promises";
import { build, transform } from "esbuild";
import vm from "node:vm";
import assert from "node:assert/strict";
import type { Snapshot } from "../src/schema.ts";
const root = new URL("../", import.meta.url);
// Shared compilation path for generated HTML and viewer checks.
export async function viewerScript(snapshot?: Snapshot, editor?: EditorSettings): Promise<string> {
  const input =
    snapshot ??
    (JSON.parse(await readFile(new URL("examples/schema.json", root), "utf8")) as Snapshot);
  if (!input.databases?.some((d) => d.schemas?.some((s) => s.tables?.length)))
    throw Error("表示対象のテーブル・ビューがありません。");
  const json = JSON.stringify(input)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026");
  const source = await readFile(new URL("viewer/app.ts", root), "utf8");
  const markdown = await build({
    stdin: {
      contents: 'export { default } from "markdown-it";',
      resolveDir: new URL("viewer/", root).pathname,
    },
    bundle: true,
    write: false,
    format: "iife",
    globalName: "KuraMarkdown",
    platform: "browser",
    minify: true,
    target: "es2022",
  });
  const result = await transform(
    source.replace(
      'import MarkdownIt from "markdown-it";',
      "const MarkdownIt = KuraMarkdown.default;",
    ),
    {
      loader: "ts",
      target: "es2022",
      legalComments: "none",
    },
  );
  const settings = JSON.stringify(editor || null)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026");
  return (
    "const sample=" +
    json +
    ";\nconst editorSettings=" +
    settings +
    ";\n" +
    markdown.outputFiles[0].text +
    "\n" +
    result.code
  ).replace(/<\/script/gi, "<\\/script");
}
export async function htmlDocument(
  snapshot?: Snapshot,
  annotations: Annotations = emptyAnnotations(),
  editor?: EditorSettings,
): Promise<string> {
  const result = await build({
    entryPoints: [new URL("viewer/mermaid-entry.ts", root).pathname],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2022",
    minify: true,
    legalComments: "eof",
    splitting: false,
  });
  const library = result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
  let source = await readFile(new URL("viewer/index.html", root), "utf8");
  if (snapshot) source = source.replace("サンプルデータ", "DBスナップショット");
  assert(source.includes("<!-- KURA_SCRIPTS -->"), "Script injection marker must exist");
  const input =
    snapshot ??
    (JSON.parse(await readFile(new URL("examples/schema.json", root), "utf8")) as Snapshot);
  const merged = mergeAnnotations(input, annotations);
  for (const entry of merged.unmatched)
    console.warn("説明の対象が見つかりません: " + JSON.stringify(entry.target));
  const app = await viewerScript(
    merged.snapshot,
    editor
      ? {
          ...editor,
          unmatched: merged.unmatched,
          originalDescriptions: originalDescriptions(input),
        }
      : undefined,
  );
  const html = source.replace(
    "<!-- KURA_SCRIPTS -->",
    () => `<script>${library}</script>\n<script>${app}</script>`,
  );
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 2);
  assert.equal(scripts[0][1], library);
  for (const [, code] of scripts) new vm.Script(code);
  assert.equal((html.match(/<\/script/gi) || []).length, 2);
  return html;
}
