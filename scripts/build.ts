import type { Snapshot } from "../src/schema.ts";
import { readAnnotations } from "./annotations.ts";
import { mkdir, writeFile, cp, rename, readFile } from "node:fs/promises";
import { htmlDocument } from "./html.ts";
const root = new URL("../", import.meta.url);
const raw = await readFile(new URL("examples/schema.json", root), "utf8");
const snapshot = JSON.parse(raw) as Snapshot;
const { annotations } = await readAnnotations(new URL("examples/annotations.json", root).pathname);
const html = await htmlDocument(undefined, annotations);
await mkdir(new URL("dist/", root), { recursive: true });
await writeFile(new URL("dist/schema.json", root), raw);
await writeFile(new URL("dist/index.html.tmp", root), html);
await rename(new URL("dist/index.html.tmp", root), new URL("dist/index.html", root));
await cp(new URL("docs/THIRD_PARTY.txt", root), new URL("dist/THIRD_PARTY.txt", root));
await cp(new URL("LICENSE", root), new URL("dist/LICENSE", root));
console.log("dist/index.html を生成しました。MermaidとELKを同梱し、オフラインで開けます。");

// Keep the editable sample separate from the public demo.
const localDirectory = new URL(".local/viewer/", root);
await mkdir(localDirectory, { recursive: true });
await writeFile(new URL("schema.json", localDirectory), raw);
const localAnnotations = await readAnnotations(new URL(".local/annotations.json", root).pathname);
await writeFile(
  new URL("index.html", localDirectory),
  await htmlDocument(snapshot, localAnnotations.annotations),
);

// Pages publishes only these files, excluding local test output under dist/.
await mkdir(new URL("dist/site/", root), { recursive: true });
for (const file of ["index.html", "schema.json", "THIRD_PARTY.txt", "LICENSE"])
  await cp(new URL("dist/" + file, root), new URL("dist/site/" + file, root));
