import { readFile, cp } from "node:fs/promises";
import { resolve } from "node:path";
import type { GenerateConfig, Snapshot } from "../src/schema.ts";
import { configPaths, readAnnotations, atomicWrite } from "./annotations.ts";
import { htmlDocument } from "./html.ts";
export async function rebuild(configPath: string): Promise<string> {
  const config = JSON.parse(await readFile(resolve(configPath), "utf8")) as GenerateConfig;
  const paths = configPaths(configPath, config),
    snapshot = JSON.parse(await readFile(resolve(paths.output, "schema.json"), "utf8")) as Snapshot;
  const { annotations } = await readAnnotations(paths.annotations);
  const html = await htmlDocument(snapshot, annotations);
  const output = resolve(paths.output, "index.html");
  await atomicWrite(output, html);
  await cp(
    new URL("../docs/THIRD_PARTY.txt", import.meta.url),
    resolve(paths.output, "THIRD_PARTY.txt"),
  );
  return output;
}
if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--config") {
    console.error("使い方: ./kura build --config kura.config.json");
    process.exitCode = 1;
  } else
    rebuild(args[1])
      .then((path) => console.log("JSON + annotations → HTML: " + path))
      .catch((e: unknown) => {
        console.error(e instanceof Error ? e.message : String(e));
        process.exitCode = 1;
      });
}
