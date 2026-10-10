import { configPaths, readAnnotations } from "./annotations.ts";
import type { GenerateConfig } from "../src/schema.ts";
import { readFile, mkdir, writeFile, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { collect } from "./collect.ts";
import { htmlDocument } from "./html.ts";
// Canonical object key order; array order is explicitly defined by collection queries.
export function canonical<T>(value: T): T {
  if (Array.isArray(value)) return value.map(canonical) as T;
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical((value as Record<string, unknown>)[k])]),
    ) as T;
  return value;
}
async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--config")
    throw Error("使い方: ./kura generate --config examples/test-db/config.json");
  const configPath = resolve(args[1]),
    config = JSON.parse(await readFile(configPath, "utf8")) as GenerateConfig;
  const connectionString = process.env[config.connectionEnv];
  if (typeof config.connectionEnv !== "string" || !connectionString)
    throw Error("設定のconnectionEnvに指定した環境変数へDB接続先を設定してください。");
  const snapshot = canonical(await collect(config, connectionString));
  const { output, annotations: annotationsPath } = configPaths(configPath, config);
  const { annotations } = await readAnnotations(annotationsPath);
  const html = await htmlDocument(snapshot, annotations);
  // Stage everything before publishing. HTML is renamed last; failures preserve the previous HTML.
  await mkdir(output, { recursive: true });
  const suffix = "." + randomUUID() + ".tmp",
    files: [string, string][] = [
      ["schema.json", JSON.stringify(snapshot, null, 2) + "\n"],
      [
        "THIRD_PARTY.txt",
        await readFile(new URL("../docs/THIRD_PARTY.txt", import.meta.url), "utf8"),
      ],
      ["index.html", html],
    ];
  try {
    for (const [name, body] of files) await writeFile(resolve(output, name + suffix), body);
    for (const [name] of files) await rename(resolve(output, name + suffix), resolve(output, name));
  } finally {
    for (const [name] of files) await rm(resolve(output, name + suffix), { force: true });
  }
  for (const message of snapshot.warnings || []) console.warn("注意: " + message);
  console.log("DB情報 → JSON → HTML: " + resolve(output, "index.html"));
}
if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname)
  main().catch((e) => {
    console.error("生成失敗: " + e.message);
    process.exitCode = 1;
  });
