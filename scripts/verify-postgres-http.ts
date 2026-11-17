/** Own temporary localhost profiles only; no .env reads or remote connections. */
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import {
  initializeEmbedded,
  roleDatabase,
} from "../src/features/ingestion/embedded";
import {
  stageStream,
  type Database,
} from "../src/features/ingestion/postgres-worker";
import { runOneJob } from "../src/features/ingestion/runner";
import {
  projectionTaxonomy,
  projectionById,
} from "../src/features/ingestion/projection";
import { createIdentity } from "../src/features/admin/security";
import { adminTourSchema } from "../src/features/admin/model";
import { demoTour } from "../src/features/tours/demo";
async function main() {
  const name = "test-stage9-http-" + randomUUID(),
    pgdir = path.resolve(".admin-postgres", name),
    admindir = path.resolve(".admin-local", name),
    dist = path.resolve("qa", name + "-next");
  const pilot = ".admin-local/pilot-editorial-26/tours.json",
    hash = async () =>
      createHash("sha256")
        .update(await readFile(pilot))
        .digest("hex"),
    before = await hash();
  const origin = "http://127.0.0.1:3012",
    email = "qa@example.invalid",
    password = "QA-" + randomUUID();
  const previousNextEnv = await readFile("next-env.d.ts", "utf8");
  let server: ReturnType<typeof spawn> | undefined,
    output = "";
  try {
    await mkdir(pgdir, { recursive: true });
    await mkdir(admindir, { recursive: true });
    await writeFile(
      path.join(admindir, "identity.json"),
      JSON.stringify(createIdentity(email, password)),
      { flag: "wx", mode: 0o600 },
    );
    const db = new PGlite(pgdir);
    let initial;
    try {
      await initializeEmbedded(db);
      const raw = db as unknown as Database,
        editor = roleDatabase(raw, "asia_catalog_editor"),
        worker = roleDatabase(raw, "asia_catalog_worker"),
        taxonomy = await projectionTaxonomy(editor);
      const at = "2026-10-18T00:00:00Z";
      async function* feed() {
        yield {
          provider: "test_http",
          external_product_id: "TEST-HTTP",
          source_url: "https://example.invalid/test",
          last_synced_at: at,
          import_status: "pending" as const,
          test_data: true,
          product: {
            slug: "test-http-draft",
            country: "japan",
            location: "kyoto",
            category: "culture",
            title: { ru: "ТЕСТ HTTP ЧЕРНОВИК", en: "TEST HTTP DRAFT" },
          },
        };
      }
      await stageStream(
        worker,
        feed(),
        {
          provider: "test_http",
          countries: ["japan"],
          snapshot_at: at,
          complete: false,
        },
        taxonomy,
        true,
      );
      await runOneJob(worker, "TEST HTTP", taxonomy, undefined, true);
      const id = (
        await editor.query<{ id: string }>(
          "select id from catalog_projection.documents",
        )
      ).rows[0].id;
      initial = (await projectionById(editor, id))!;
      const fixture = adminTourSchema.parse({
        ...demoTour,
        id: randomUUID(),
        slug: "test-http-public-fixture",
        title: {
          ru: "ТЕСТ HTTP ПУБЛИЧНЫЙ ШАБЛОН",
          en: "TEST HTTP PUBLIC FIXTURE",
        },
        archived: false,
        visible: true,
        externalProduct: null,
      });
      await db.query(
        "insert into catalog_projection.documents(id,document) values($1,$2::jsonb)",
        [fixture.id, JSON.stringify(fixture)],
      );
    } finally {
      await db.close();
    }
    server = spawn(
      process.execPath,
      [
        "node_modules/next/dist/bin/next",
        "dev",
        "--hostname",
        "127.0.0.1",
        "--port",
        "3012",
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NODE_ENV: "development",
          ADMIN_MODE: "local",
          TOUR_DATA_SOURCE: "postgres",
          ADMIN_LOCAL_DIRECTORY: ".admin-local/" + name,
          POSTGRES_LOCAL_PROFILE: name,
          POSTGRES_LOCAL_WORKER: "off",
          NEXT_DIST_DIR: path.relative(process.cwd(), dist),
        },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const capture = (bytes: Buffer) => {
      output = (output + bytes.toString()).slice(-6000);
    };
    server.stdout?.on("data", capture);
    server.stderr?.on("data", capture);
    let ready = false;
    for (let i = 0; i < 90; i++) {
      try {
        const r = await fetch(origin + "/admin/login");
        if (r.ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 1000));
    }
    assert(ready, "Local server failed to start");
    const anonymous = await fetch(origin + "/admin/api/postgres");
    assert.equal(anonymous.status, 403);
    const login = await fetch(origin + "/admin/api/session", {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0],
      headers = { Cookie: cookie };
    for (const locale of ["ru", "en"]) {
      const catalog = await fetch(`${origin}/${locale}/tours`);
      assert.equal(catalog.status, 200);
      const html = await catalog.text();
      assert(html.includes("test-http-public-fixture"));
      assert(!html.includes("test-http-draft"));
      assert.equal(
        (await fetch(`${origin}/${locale}/tours/test-http-draft`)).status,
        404,
      );
      const preview: Response = await fetch(
        `${origin}/admin/tours/${initial.id}/preview?locale=${locale}`,
        { headers },
      );
      assert.equal(preview.status, 200);
      assert(
        (await preview.text()).includes(
          locale === "ru" ? "ТЕСТ HTTP ЧЕРНОВИК" : "TEST HTTP DRAFT",
        ),
      );
    }
    for (const route of [
      "/admin",
      "/admin/import",
      `/admin/tours/${initial.id}`,
    ]) {
      const r = await fetch(origin + route, { headers });
      assert.equal(r.status, 200);
      assert(!(await r.text()).includes("NEXT_HTTP_ERROR_FALLBACK;500"));
    }
    const save = await fetch(origin + "/admin/api/tours", {
      method: "POST",
      headers: {
        ...headers,
        Origin: origin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tours: [
          {
            ...initial,
            title: { ru: "ТЕСТ HTTP ПРАВКА", en: "TEST HTTP EDIT" },
          },
        ],
        expected: { [initial.id]: initial.updatedAt },
      }),
    });
    assert.equal(save.status, 200, await save.text());
    const forbidden = await fetch(origin + "/admin/api/tours", {
      method: "POST",
      headers: {
        ...headers,
        Origin: "https://example.invalid",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    assert([400, 403].includes(forbidden.status));
    const oldImport = await fetch(origin + "/admin/api/import", {
      method: "POST",
      headers: {
        ...headers,
        Origin: origin,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    assert.notEqual(oldImport.status, 200);
    const jobs = await fetch(origin + "/admin/api/postgres", { headers });
    assert.equal(jobs.status, 200);
    assert.equal((await jobs.json()).jobs.length, 1);
    assert.equal(await hash(), before);
    await mkdir("data/benchmarks/stage9", { recursive: true });
    await writeFile(
      "data/benchmarks/stage9/http-smoke.json",
      JSON.stringify(
        {
          at: new Date().toISOString(),
          localhost: true,
          ru_en_catalog: true,
          private_preview: true,
          admin_editor_save: true,
          jobs: true,
          anonymous_denied: true,
          csrf_denied: true,
          legacy_import_blocked: true,
          pilot_sha256: before,
          imported_published: 0,
        },
        null,
        2,
      ) + "\n",
    );
    console.log("Local PostgreSQL HTTP smoke: passed");
  } catch (error) {
    console.error(output.slice(-4000));
    throw error;
  } finally {
    if (server?.pid)
      await new Promise((r) =>
        spawn("taskkill", ["/PID", String(server!.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        }).on("close", r),
      );
    for (const [directory, root] of [
      [pgdir, ".admin-postgres"],
      [admindir, ".admin-local"],
      [dist, "qa"],
    ]) {
      assert(directory.startsWith(path.resolve(root) + path.sep));
      assert(path.basename(directory).startsWith("test-stage9-http-"));
      await rm(directory, { recursive: true, force: true });
    }
    const tsconfig = JSON.parse(await readFile("tsconfig.json", "utf8"));
    tsconfig.include = tsconfig.include.filter(
      (entry: string) =>
        !entry.startsWith(
          path.relative(process.cwd(), dist).split(path.sep).join("/") + "/",
        ),
    );
    await writeFile("tsconfig.json", JSON.stringify(tsconfig, null, 2) + "\n");
    const currentNextEnv = await readFile("next-env.d.ts", "utf8");
    if (currentNextEnv.includes(name + "-next/"))
      await writeFile("next-env.d.ts", previousNextEnv);
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
