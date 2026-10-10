import { readFile, writeFile, mkdir, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { emptyAnnotations, validateAnnotations } from "../src/annotations.ts";
import type { Annotations } from "../src/annotations.ts";
import type { GenerateConfig } from "../src/schema.ts";
export function configPaths(configPath: string, config: GenerateConfig) {
  const base = dirname(resolve(configPath)),
    output = resolve(base, config.output || "kura-output");
  const annotations = resolve(base, config.annotationsFile || "annotations.json");
  if (
    [resolve(output, "schema.json"), resolve(output, "index.html"), resolve(configPath)].includes(
      annotations,
    )
  )
    throw Error("annotationsFileは設定・取得JSON・HTMLとは別のファイルにしてください。");
  return { output, annotations };
}
export async function readAnnotations(
  path: string,
): Promise<{ annotations: Annotations; revision: string }> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && e.code === "ENOENT")
      return { annotations: emptyAnnotations(), revision: "missing" };
    throw e;
  }
  return {
    annotations: validateAnnotations(JSON.parse(text)),
    revision: createHash("sha256").update(text).digest("hex"),
  };
}
export async function atomicWrite(path: string, text: string) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = path + "." + randomUUID() + ".tmp";
  try {
    await writeFile(temporary, text);
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
