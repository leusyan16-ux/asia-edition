import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import {
  initializeEmbedded,
  roleDatabase,
} from "../src/features/ingestion/embedded";
import {
  projectionRepository,
  projectionOverview,
  projectionById,
  projectionTaxonomy,
  saveProjection,
  importDashboard,
} from "../src/features/ingestion/projection";
import {
  stageStream,
  type Database,
} from "../src/features/ingestion/postgres-worker";
import { runOneJob } from "../src/features/ingestion/runner";
import { adminTourSchema, emptyTour } from "../src/features/admin/model";
import { parseQuery, selectTours } from "../src/features/tours/query";
import { localTourPayload } from "../src/features/tours/local-catalog";
import { demoTour } from "../src/features/tours/demo";
import {
  assertLocalPostgres,
  postgresSelected,
  postgresDirectory,
} from "../src/features/ingestion/config";
import { startSupervisor } from "../src/features/ingestion/supervisor";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  claim,
  processPacket,
} from "../src/features/ingestion/postgres-worker";
import { createServerPool } from "../src/features/ingestion/pool";
import { createLoopbackPostgresPool } from "../src/features/ingestion/pg-pool";
test("PostgreSQL projection: public parity, private drafts, editorial concurrency and source refresh", async () => {
  const db = new PGlite();
  await initializeEmbedded(db);
  const database = db as unknown as Database,
    editor = roleDatabase(database, "asia_catalog_editor"),
    reader = roleDatabase(database, "asia_catalog_reader"),
    worker = roleDatabase(database, "asia_catalog_worker");
  try {
    const repo = projectionRepository(reader),
      taxonomy = await projectionTaxonomy(editor);
    const fixtures = Array.from({ length: 12 }, (_, i) =>
      adminTourSchema.parse({
        ...emptyTour(randomUUID()),
        country: "thailand",
        location: "chiang-mai",
        category: "culture",
        slug: `test-projection-${i.toString().padStart(2, "0")}`,
        title: { ru: `ТЕСТ ${i}`, en: `TEST ${i}` },
        description: { ru: ["ТЕСТ"], en: ["TEST"] },
        images: [demoTour.images[0]],
        durationMinutes: [60, 240, 600, 1000][i % 4],
        isDemo: true,
        status: i === 11 ? "draft" : "published",
        prices: [
          {
            ...demoTour.prices[0],
            adult: i,
            verifiedAt: "2026-10-18T00:00:00Z",
            validFrom: null,
            validUntil: null,
          },
        ],
      }),
    );
    await saveProjection(editor, fixtures, {}, "TEST ADMIN");
    const q = parseQuery({}, "ru");
    assert.equal((await repo.list(q)).total, 11);
    assert.equal(await repo.bySlug(fixtures[11].slug), null);
    assert.equal(
      (await reader.query("select * from catalog_projection.documents")).rows
        .length,
      11,
    );
    await assert.rejects(reader.query("select * from catalog_ingest.jobs"));
    for (const params of [
      {},
      { search: "ТЕСТ 1" },
      { duration: "half" },
      { sort: "price-desc", maxPrice: "5" },
      { sort: "duration", page: "2" },
      { country: "thailand", category: "culture", location: "chiang-mai" },
      { search: "%' OR true --" },
    ]) {
      const query = parseQuery(params, "en"),
        actual = await repo.list(query),
        expected = selectTours(
          fixtures.map((t) => localTourPayload(t)),
          query,
        );
      assert.equal(actual.total, expected.total);
      assert.deepEqual(
        actual.items.map((t) => t.id),
        expected.items.map((t) => t.id),
      );
    }
    const at = "2026-10-18T00:00:00Z";
    async function* feed(time = at) {
      yield {
        provider: "test_projection",
        external_product_id: "TEST-1",
        source_url: "https://example.invalid/test/1",
        last_synced_at: time,
        import_status: "pending" as const,
        test_data: true,
        product: {
          slug: "test-import-projection",
          country: "thailand",
          location: "chiang-mai",
          category: "culture",
          title: { ru: "ТЕСТ ИМПОРТ", en: "TEST IMPORT" },
        },
      };
    }
    const scope = {
      provider: "test_projection",
      countries: ["thailand"],
      snapshot_at: at,
      complete: false,
    };
    await stageStream(worker, feed(), scope, taxonomy, true);
    await runOneJob(worker, "TEST WORKER", taxonomy, undefined, true);
    const source = (
      await editor.query<{ id: string }>(
        "select id from catalog_projection.documents where slug='test-import-projection'",
      )
    ).rows[0];
    const prior = (await projectionById(editor, source.id))!;
    assert.equal(prior.status, "draft");
    assert.equal(await repo.bySlug(prior.slug), null);
    const saved = (
      await saveProjection(
        editor,
        [
          {
            ...prior,
            title: { ru: "Редакторская правка", en: "Editorial change" },
          },
        ],
        { [prior.id]: prior.updatedAt },
        "TEST ADMIN",
      )
    )[0];
    await editor.query("select catalog_projection.review($1,$2,$3,$4,$5,$6)", [
      saved.id,
      saved.updatedAt,
      "approved",
      "licensed",
      "https://example.invalid/TEST-RIGHTS",
      "TEST ADMIN",
    ]);
    const reviewed = (await projectionById(editor, saved.id))!;
    assert.equal(reviewed.status, "draft");
    assert.equal(reviewed.externalProduct?.publication_readiness, "blocked");
    await assert.rejects(
      reader.query("select catalog_projection.review($1,$2,$3,$4,$5,$6)", [
        saved.id,
        reviewed.updatedAt,
        "approved",
        "licensed",
        "https://example.invalid/TEST-RIGHTS",
        "ATTACKER",
      ]),
    );
    await assert.rejects(
      saveProjection(
        editor,
        [prior],
        { [prior.id]: prior.updatedAt },
        "TEST ADMIN",
      ),
      /изменились/,
    );
    await assert.rejects(
      saveProjection(
        editor,
        [
          {
            ...saved,
            externalProduct: {
              ...saved.externalProduct!,
              content_rights_status: "licensed",
            },
          },
        ],
        { [saved.id]: saved.updatedAt },
        "TEST ADMIN",
      ),
    );
    const next = "2026-10-19T00:00:00Z";
    await stageStream(
      worker,
      feed(next),
      { ...scope, snapshot_at: next },
      taxonomy,
      true,
    );
    await runOneJob(worker, "NEXT WORKER", taxonomy, undefined, true);
    const refreshed = (await projectionById(editor, source.id))!;
    assert.equal(refreshed.title.ru, "Редакторская правка");
    assert.equal(refreshed.externalProduct?.last_synced_at, next);
    assert.equal(refreshed.status, "draft");
    assert.equal(refreshed.externalProduct?.editorial_status, "approved");
    assert.equal(refreshed.externalProduct?.content_rights_status, "licensed");
    await assert.rejects(
      saveProjection(
        editor,
        [saved],
        { [saved.id]: saved.updatedAt },
        "TEST ADMIN",
      ),
      /изменились/,
    );
    const page = await projectionOverview(editor, { search: "Редакторская" });
    assert.equal(page.items.length, 1);
    assert.equal(page.stats.total, 13);
    assert.equal((await importDashboard(editor)).jobs.length, 2);
    await assert.rejects(
      editor.query(
        "update catalog_projection.documents set document=jsonb_set(document,'{status}','\"published\"') where id=$1",
        [prior.id],
      ),
    );
    await db.exec("set role anon");
    await assert.rejects(
      db.query("select * from catalog_projection.documents"),
    );
    await db.exec("reset role");
    const supervisor = startSupervisor(worker, async () => taxonomy, {
      pollMs: 50,
    });
    await supervisor.stop();
    await supervisor.finished;
  } finally {
    await db.close();
  }
});
test("PostgreSQL switch stays opt-in and rejects production, remote host and unsafe profile", () => {
  assert.equal(postgresSelected({} as NodeJS.ProcessEnv), false);
  const env = {
    NODE_ENV: "development",
    ADMIN_MODE: "local",
    TOUR_DATA_SOURCE: "postgres",
  } as NodeJS.ProcessEnv;
  assert.doesNotThrow(() => assertLocalPostgres("localhost:3000", env));
  assert.throws(() => assertLocalPostgres("example.com", env));
  assert.throws(() =>
    assertLocalPostgres("localhost", { ...env, NODE_ENV: "production" }),
  );
  assert.throws(() => postgresDirectory("../pilot-editorial-26"));
});
test("persistent PostgreSQL restart resumes source and projection atomically", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "asia-stage9-pg-"));
  let db = new PGlite(directory);
  try {
    await initializeEmbedded(db);
    let raw = db as unknown as Database;
    const taxonomy = await projectionTaxonomy(
      roleDatabase(raw, "asia_catalog_editor"),
    );
    const at = "2026-10-18T00:00:00Z";
    async function* feed() {
      for (let n = 0; n < 51; n++)
        yield {
          provider: "test_restart",
          external_product_id: `TEST-${n}`,
          source_url: "https://example.invalid/test",
          last_synced_at: at,
          import_status: "pending" as const,
          test_data: true,
          product: {
            slug: `test-restart-${n}`,
            country: "thailand",
            location: "chiang-mai",
            category: "culture",
            title: { ru: `ТЕСТ ${n}`, en: `TEST ${n}` },
          },
        };
    }
    let worker = roleDatabase(raw, "asia_catalog_worker");
    const id = await stageStream(
      worker,
      feed(),
      {
        provider: "test_restart",
        countries: ["thailand"],
        snapshot_at: at,
        complete: false,
      },
      taxonomy,
      true,
      50,
    );
    const lease = (await claim(worker, "before-restart"))!;
    await processPacket(worker, lease, 0, taxonomy, true);
    await db.close();
    db = new PGlite(directory);
    await initializeEmbedded(db);
    raw = db as unknown as Database;
    worker = roleDatabase(raw, "asia_catalog_worker");
    await db.query(
      "update catalog_ingest.jobs set lease_until=now()-interval '1 second' where id=$1",
      [id],
    );
    await runOneJob(worker, "after-restart", taxonomy, undefined, true);
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from catalog_projection.documents",
        )
      ).rows[0].n,
      51,
    );
    assert.equal(
      (
        await projectionRepository(
          roleDatabase(raw, "asia_catalog_reader"),
        ).list(parseQuery({}, "ru"))
      ).total,
      0,
    );
    assert.equal(
      (await importDashboard(roleDatabase(raw, "asia_catalog_editor"))).jobs[0]
        .state,
      "completed",
    );
  } finally {
    await db.close();
    assert(directory.startsWith(path.resolve(tmpdir()) + path.sep));
    assert(path.basename(directory).startsWith("asia-stage9-pg-"));
    await rm(directory, { recursive: true, force: true });
  }
});
test("pool lifecycle and rollback are bounded; remote connectors rejected before connection", async () => {
  const statements: string[] = [];
  let released = 0,
    closed = 0;
  const query = async <T>(sql: string) => {
    statements.push(sql);
    return { rows: [] as T[] };
  };
  const pool = createServerPool((settings) => {
    assert.equal(settings.max, 4);
    assert.equal(settings.connectionTimeoutMillis, 5000);
    return {
      query,
      async connect() {
        return {
          query,
          release() {
            released++;
          },
        };
      },
      async end() {
        closed++;
      },
    };
  });
  await assert.rejects(
    pool.database.transaction(async () => {
      throw new Error("TEST rollback");
    }),
    /TEST rollback/,
  );
  assert(statements.includes("ROLLBACK"));
  assert.equal(released, 1);
  await pool.close();
  await pool.close();
  assert.equal(closed, 1);
  assert.throws(
    () => createLoopbackPostgresPool("postgresql://example.invalid/test"),
    /loopback/,
  );
  assert.throws(
    () =>
      createLoopbackPostgresPool(
        "postgresql://localhost/test?host=example.invalid",
      ),
    /overrides/,
  );
  const lazy = createLoopbackPostgresPool("postgresql://localhost:5432/test");
  await lazy.close();
});
