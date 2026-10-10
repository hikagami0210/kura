import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { configPaths, readAnnotations, atomicWrite } from "./annotations.ts";
import { htmlDocument } from "./html.ts";
import { validateAnnotations, annotationObject, targetKey } from "../src/annotations.ts";
import type { Snapshot, GenerateConfig } from "../src/schema.ts";
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
async function body(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new HttpError(413, "説明ファイルは1MB以内にしてください。");
    chunks.push(Buffer.from(chunk));
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "JSONの形式が不正です。");
  }
}
export async function startEditor(configPath: string, port = 4173) {
  const config = JSON.parse(await readFile(resolve(configPath), "utf8")) as GenerateConfig;
  const paths = configPaths(configPath, config);
  const snapshotPath = resolve(paths.output, "schema.json");
  const snapshotText = await readFile(snapshotPath, "utf8");
  const snapshot = JSON.parse(snapshotText) as Snapshot;
  const ensureSnapshot = async () => {
    if ((await readFile(snapshotPath, "utf8")) !== snapshotText)
      throw new HttpError(409, "schema.jsonが更新されました。編集サーバーを再起動してください。");
  };
  const token = randomBytes(32).toString("hex");
  let origin = "",
    cachedRevision = "",
    cachedHtml = "";
  let queue: Promise<unknown> = Promise.resolve();
  const page = async () => {
    await ensureSnapshot();
    const state = await readAnnotations(paths.annotations);
    if (state.revision !== cachedRevision) {
      cachedHtml = await htmlDocument(snapshot, state.annotations, {
        token,
        revision: state.revision,
        annotations: state.annotations,
        unmatched: [],
      });
      cachedRevision = state.revision;
    }
    return cachedHtml;
  };
  await page();
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
    try {
      if (req.headers.host !== new URL(origin).host)
        throw new HttpError(403, "このホストからのアクセスは許可されていません。");
      if (req.headers.origin && req.headers.origin !== origin)
        throw new HttpError(403, "別のサイトからのアクセスは許可されていません。");
      if (req.method === "GET" && req.url === "/") {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(await page());
        return;
      }
      if (req.method !== "POST" || req.url !== "/api/annotations")
        throw new HttpError(404, "見つかりません。");
      if (req.headers["x-kura-token"] !== token)
        throw new HttpError(403, "編集用トークンが不正です。");
      if (!req.headers["content-type"]?.startsWith("application/json"))
        throw new HttpError(415, "application/jsonで送信してください。");
      const input = await body(req);
      if (
        !input ||
        typeof input !== "object" ||
        !("revision" in input) ||
        typeof input.revision !== "string" ||
        !("annotations" in input)
      )
        throw new HttpError(400, "保存データが不正です。");
      const operation = queue.then(async () => {
        await ensureSnapshot();
        const current = await readAnnotations(paths.annotations);
        if (current.revision !== input.revision)
          throw new HttpError(
            409,
            "別の画面やファイルで説明が更新されています。再読み込みしてから編集してください。",
          );
        let annotations;
        try {
          annotations = validateAnnotations(input.annotations);
        } catch (e) {
          throw new HttpError(400, e instanceof Error ? e.message : String(e));
        }
        for (const entry of annotations.entries) {
          if (annotationObject(snapshot, entry.target)) continue;
          if (
            !current.annotations.entries.some(
              (x) =>
                targetKey(x.target) === targetKey(entry.target) &&
                x.description === entry.description,
            )
          )
            throw new HttpError(400, "取得JSONに存在しない対象へ説明を追加できません。");
        }
        const html = await htmlDocument(snapshot, annotations);
        if ((await readAnnotations(paths.annotations)).revision !== input.revision)
          throw new HttpError(409, "保存中にファイルが更新されました。再読み込みしてください。");
        await ensureSnapshot();
        await atomicWrite(paths.annotations, JSON.stringify(annotations, null, 2) + "\n");
        let warning = "";
        try {
          await atomicWrite(resolve(paths.output, "index.html"), html);
        } catch {
          warning =
            "説明は保存しましたが、HTMLを更新できませんでした。./kura buildで再生成してください。";
        }
        cachedRevision = "";
        return { ...(await readAnnotations(paths.annotations)), warning };
      });
      queue = operation.catch(() => {});
      const result = await operation;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify(result));
    } catch (e) {
      res.statusCode = e instanceof HttpError ? e.status : 500;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
    }
  });
  await new Promise<void>((accept, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      accept();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw Error("編集サーバーを起動できません。");
  origin = "http://127.0.0.1:" + address.port;
  return { server, url: origin + "/", annotationsPath: paths.annotations };
}
if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const args = process.argv.slice(2),
    port = args.length === 4 && args[2] === "--port" ? Number(args[3]) : 4173;
  if (
    ![2, 4].includes(args.length) ||
    args[0] !== "--config" ||
    (args.length === 4 && args[2] !== "--port") ||
    !Number.isInteger(port) ||
    port < 0 ||
    port > 65535
  ) {
    console.error("使い方: ./kura edit --config kura.config.json [--port 4173]");
    process.exitCode = 1;
  } else
    startEditor(args[1], port)
      .then(({ server, url, annotationsPath }) => {
        console.log(
          "説明の編集: " + url + "\n保存先: " + annotationsPath + "\nCtrl+Cで終了します。",
        );
        for (const signal of ["SIGINT", "SIGTERM"] as const)
          process.once(signal, () => server.close());
      })
      .catch((e: unknown) => {
        console.error(e instanceof Error ? e.message : String(e));
        process.exitCode = 1;
      });
}
