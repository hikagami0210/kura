import type { ExecFileSyncOptionsWithBufferEncoding } from "node:child_process";
import type { Snapshot, GenerateConfig } from "../src/schema.ts";
import { mkdir, access, writeFile, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const root = new URL("../", import.meta.url).pathname;
const bin = process.env.KURA_PG_BIN || "/opt/homebrew/opt/postgresql@17/bin";
const workspace = resolve(root, ".kura-test"),
  data = resolve(workspace, "data"),
  socket = resolve(workspace, "socket");
const run = (name: string, args: string[], options: ExecFileSyncOptionsWithBufferEncoding = {}) =>
  execFileSync(resolve(bin, name), args, {
    cwd: root,
    stdio: "pipe",
    ...options,
  });
const env = {
  ...process.env,
  PGHOST: socket,
  PGPORT: "55432",
  PGUSER: "kura_admin",
  PGDATABASE: "postgres",
};
let started = false;
try {
  await access(resolve(bin, "initdb"));
  await mkdir(socket, { recursive: true, mode: 0o700 });
  let initialized = true;
  try {
    await access(resolve(data, "PG_VERSION"));
  } catch {
    initialized = false;
  }
  if (!initialized)
    run("initdb", [
      "-D",
      data,
      "-U",
      "kura_admin",
      "--auth-local=trust",
      "--auth-host=scram-sha-256",
      "--encoding=UTF8",
      "--locale=C",
    ]);
  try {
    run("pg_ctl", ["-D", data, "status"]);
  } catch {
    run("pg_ctl", [
      "-D",
      data,
      "-l",
      resolve(workspace, "postgres.log"),
      "-o",
      `-p 55432 -k ${socket} -c listen_addresses=''`,
      "-w",
      "start",
    ]);
    started = true;
  }
  const existing = run(
    "psql",
    [
      "-X",
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      "SELECT 1 FROM pg_database WHERE datname='kura_demo'",
    ],
    { env },
  )
    .toString()
    .trim();
  if (existing !== "1") run("createdb", ["kura_demo"], { env });
  run(
    "psql",
    [
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      "-d",
      "kura_demo",
      "-f",
      resolve(root, "examples/test-db/fixture.sql"),
    ],
    { env },
  );
  const connectionString = `postgresql://kura_admin@localhost:55432/kura_demo?host=${encodeURIComponent(socket)}`;
  const generate = () =>
    execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve(root, "scripts/generate.ts"),
        "--config",
        resolve(root, "examples/test-db/config.json"),
      ],
      {
        cwd: root,
        env: { ...env, KURA_DATABASE_URL: connectionString },
        stdio: "pipe",
      },
    );
  console.log("専用テストDBを準備しました。生成を2回実行します。");
  console.log(generate().toString().trim());
  const output = resolve(root, "dist/demo");
  const firstJson = await readFile(resolve(output, "schema.json")),
    firstHtml = await readFile(resolve(output, "index.html"));
  generate();
  const secondJson = await readFile(resolve(output, "schema.json")),
    secondHtml = await readFile(resolve(output, "index.html"));
  assert(firstJson.equals(secondJson), "JSON must be byte-identical");
  assert(firstHtml.equals(secondHtml), "HTML must be byte-identical");
  const snapshot = JSON.parse(firstJson.toString()) as Snapshot,
    db = snapshot.databases[0],
    objects = db.schemas.flatMap((s) => s.tables.map((t) => ({ ...t, schema: s.name })));
  assert(
    objects.find((t) => t.name === "orders")!.relations!.some((r) => r.table === "order_statuses"),
  );
  assert.equal(objects.find((t) => t.name === "line_events")!.relations!.length, 2);
  assert(
    objects
      .find((t) => t.name === "orders")!
      .indexes!.some((i) => i.include?.includes("total_amount")),
  );
  assert(objects.find((t) => t.name === "orders")!.indexes!.some((i) => i.predicate));
  assert(
    objects
      .find((t) => t.name === "active_orders")!
      .dependencies!.some((d) => d.name === "customers"),
  );
  assert.equal(objects.find((t) => t.name === "order_totals")!.populated, true);
  assert.equal(objects.find((t) => t.name === "order_statuses")!.master!.rows.length, 3);
  assert(db.access!.some((a) => a.role === "kura_reader" && a.table === "orders" && a.select));
  assert(
    db.schemaAccess!.some((a) => a.role === "kura_reader" && a.schema === "audit" && !a.usage),
  );
  assert(db.access!.some((a) => a.role === "kura_reader" && a.table === "customers" && !a.select));
  assert(
    db
      .schemaAccess!.find((a) => a.role === "kura_reader" && a.schema === "reporting")!
      .grantSources!.usage.includes("ロール継承: kura_readonly"),
  );
  assert(
    db.schemaAccess!.find((a) => a.role === "kura_reader" && a.schema === "audit")!.grantSources!
      .usage.length === 0,
  );
  assert(
    db
      .schemaAccess!.find((a) => a.role === "kura_app" && a.schema === "public")!
      .grantSources!.usage.includes("直接付与"),
  );
  assert(
    db
      .schemaAccess!.find((a) => a.role === "kura_admin" && a.schema === "public")!
      .grantSources!.usage.includes("Superuser"),
  );
  assert(db.schemaAccess!.every((a) => a.via));
  // Failed extraction must not replace the previously generated HTML.
  const badPath = resolve(workspace, "invalid-config.json");
  const badConfig = JSON.parse(
    await readFile(resolve(root, "examples/test-db/config.json"), "utf8"),
  ) as GenerateConfig;
  badConfig.schemas = ["kura_missing_schema"];
  badConfig.output = output;
  await writeFile(badPath, JSON.stringify(badConfig));
  let failed = false;
  try {
    execFileSync(
      process.execPath,
      ["--import", "tsx", resolve(root, "scripts/generate.ts"), "--config", badPath],
      { env: { ...env, KURA_DATABASE_URL: connectionString }, stdio: "pipe" },
    );
  } catch (error) {
    assert(error && typeof error === "object" && "stderr" in error);
    assert(String(error.stderr).includes("指定されたスキーマが見つかりません。"));
    failed = true;
  }
  assert(failed);
  assert(
    firstHtml.equals(await readFile(resolve(output, "index.html"))),
    "Failed extraction must preserve previous HTML",
  );
  // Execute the generated viewer logic with DOM mocks, not only parse its syntax.
  const { default: vm } = await import("node:vm");
  const scripts = [...firstHtml.toString().matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const nodes = new Map();
  const context = {
    URLSearchParams,
    document: {
      getElementById: (id: string) => {
        if (!nodes.has(id)) nodes.set(id, { value: "", innerHTML: "", textContent: "" });
        return nodes.get(id);
      },
      querySelectorAll: () => [],
    },
  };
  vm.createContext(context);
  vm.runInContext(scripts[1][1], context);
  vm.runInContext("validate(sample)", context);
  assert(nodes.get("view").innerHTML.includes("kura_demo"));
  const hash = createHash("sha256").update(firstHtml).digest("hex");
  await writeFile(
    resolve(output, "verification.json"),
    JSON.stringify(
      {
        jsonIdentical: true,
        htmlIdentical: true,
        htmlSha256: hash,
        objects: objects.length,
        checks: [
          "foreign keys",
          "composite FK",
          "partial/covering indexes",
          "views/dependencies",
          "materialized views",
          "masters",
          "inherited privileges",
          "denied privileges",
          "failed generation preserves HTML",
          "generated viewer",
        ],
      },
      null,
      2,
    ) + "\n",
  );
  console.log("JSON・HTMLの2回生成が完全一致。テーブル・ビュー・権限等の取得も確認しました。");
} catch (e) {
  console.error("テスト失敗: " + (e instanceof Error ? e.message : String(e)));
  if (e && typeof e === "object" && "stderr" in e && e.stderr) console.error(String(e.stderr));
  process.exitCode = 1;
} finally {
  if (started) {
    run("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"]);
    console.log("専用テストサーバーを停止しました。");
  }
}
