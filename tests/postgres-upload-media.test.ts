import test from "node:test";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import sharp from "sharp";
import {
  initializeEmbedded,
  inventoryMigrations,
  roleDatabase,
} from "../src/features/ingestion/embedded";
import {
  prepareUpload,
  releaseUpload,
  stepUpload,
  UPLOAD_LIMITS,
} from "../src/features/ingestion/upload";
import {
  claim,
  type Database,
} from "../src/features/ingestion/postgres-worker";
import {
  projectionTaxonomy,
  projectionById,
  saveProjection,
  projectionRepository,
} from "../src/features/ingestion/projection";
import {
  uploadMedia,
  readMedia,
  retireMedia,
  LocalMediaStore,
  type MediaStore,
} from "../src/features/ingestion/media";
import { parseQuery } from "../src/features/tours/query";
import { adminTourSchema, emptyTour } from "../src/features/admin/model";
import {
  syntheticProducts,
  syntheticCSV,
} from "../scripts/fixtures/stage10-products";
async function context() {
  const db = new PGlite();
  await initializeEmbedded(db);
  const raw = db as unknown as Database,
    worker = roleDatabase(raw, "asia_catalog_worker"),
    editor = roleDatabase(raw, "asia_catalog_editor"),
    reader = roleDatabase(raw, "asia_catalog_reader");
  return {
    db,
    worker,
    editor,
    reader,
    taxonomy: await projectionTaxonomy(editor),
  };
}
test("upload preview: held jobs, row errors, size limits, duplicate-free replay and checkpoint resume", async () => {
  const { db, worker, editor, taxonomy } = await context();
  try {
    const invalid = syntheticProducts(2);
    invalid[1].product.title.ru = "";
    const bad = await prepareUpload(
      worker,
      JSON.stringify(invalid),
      "json",
      "TEST-invalid.json",
      taxonomy,
      "TEST",
      true,
    );
    assert.equal(bad.job, null);
    assert(bad.preview.errors.some((e) => e.row === 2));
    await assert.rejects(
      prepareUpload(
        worker,
        "x".repeat(UPLOAD_LIMITS.maxBytes + 1),
        "json",
        "TEST-large.json",
        taxonomy,
        "TEST",
        true,
      ),
      /МБ/,
    );
    await assert.rejects(
      prepareUpload(
        worker,
        JSON.stringify(Array.from({ length: 20001 }, () => ({}))),
        "json",
        "TEST-rows.json",
        taxonomy,
        "TEST",
        true,
      ),
      /20000/,
    );
    const products = syntheticProducts(51),
      content = JSON.stringify(products);
    const prepared = await prepareUpload(
      worker,
      content,
      "json",
      "TEST-51.json",
      taxonomy,
      "TEST",
      true,
    );
    assert(prepared.job);
    assert.equal(prepared.preview.created, 51);
    assert.equal(await claim(worker, "UNCONFIRMED"), undefined);
    assert.equal(
      (await editor.query("select id from catalog_projection.documents")).rows
        .length,
      0,
    );
    await releaseUpload(worker, prepared.job.id);
    let first = await stepUpload(worker, prepared.job.id, 0, taxonomy, true);
    assert.equal(first.cursor, 1);
    assert.equal(
      (await stepUpload(worker, prepared.job.id, 0, taxonomy, true)).cursor,
      1,
    );
    const replay = await prepareUpload(
      worker,
      content,
      "json",
      "TEST-51.json",
      taxonomy,
      "TEST",
      true,
    );
    assert.equal(replay.job?.id, first.id);
    assert(replay.replayed);
    assert.equal(replay.job?.cursor, 1);
    await worker.query(
      "update catalog_ingest.jobs set state='running',owner='TEST-CRASH',lease_until=now()-interval '1 second',attempts=max_attempts where id=$1",
      [first.id],
    );
    await releaseUpload(worker, first.id);
    first = await stepUpload(worker, first.id, 1, taxonomy, true);
    assert.equal(first.state, "completed");
    assert.equal(first.created, 51);
    const next = await prepareUpload(
      worker,
      JSON.stringify(syntheticProducts(51, "2026-10-20T00:00:00Z")),
      "json",
      "TEST-next.json",
      taxonomy,
      "TEST",
      true,
    );
    assert.equal(next.preview.skipped, 51);
    assert(next.job);
    await releaseUpload(worker, next.job.id);
    await stepUpload(worker, next.job.id, 0, taxonomy, true);
    await stepUpload(worker, next.job.id, 1, taxonomy, true);
    assert.equal(
      (await editor.query("select id from catalog_projection.documents")).rows
        .length,
      51,
    );
    const csv = await prepareUpload(
      worker,
      syntheticCSV(syntheticProducts(51, "2026-10-20T00:00:00Z")),
      "csv",
      "TEST.csv",
      taxonomy,
      "TEST",
      true,
    );
    assert.equal(csv.preview.failed, 0);
    assert.equal(csv.preview.skipped, 51);
    assert(csv.job);
    await releaseUpload(worker, csv.job.id);
    await stepUpload(worker, csv.job.id, 0, taxonomy, true);
    await stepUpload(worker, csv.job.id, 1, taxonomy, true);
    const mixed = syntheticProducts(2);
    mixed[1].provider = "different";
    const failed = await prepareUpload(
      worker,
      JSON.stringify(mixed),
      "json",
      "TEST-mixed.json",
      taxonomy,
      "TEST",
      true,
    );
    assert(failed.preview.failed > 0);
    assert.equal(failed.job, null);
    const conflict = syntheticProducts(1);
    conflict[0].provider = "test_other";
    const rejected = await prepareUpload(
      worker,
      JSON.stringify(conflict),
      "json",
      "TEST-collision.json",
      taxonomy,
      "TEST",
      true,
    );
    assert.equal(rejected.job, null);
    assert(
      rejected.preview.errors.some((e) =>
        e.message.includes("уже используется"),
      ),
    );
    const parallel = syntheticProducts(1);
    parallel[0].provider = "test_concurrent";
    parallel[0].product.slug = "test-concurrent-upload";
    const attempts = await Promise.allSettled([
      prepareUpload(
        worker,
        JSON.stringify(parallel),
        "json",
        "TEST-parallel.json",
        taxonomy,
        "TEST",
        true,
      ),
      prepareUpload(
        worker,
        JSON.stringify(parallel),
        "json",
        "TEST-parallel.json",
        taxonomy,
        "TEST",
        true,
      ),
    ]);
    const fulfilled = attempts.filter((a) => a.status === "fulfilled");
    assert(fulfilled.length > 0);
    assert.equal(new Set(fulfilled.map((a) => a.value.job?.id)).size, 1);
    const priorId = fulfilled[0].value.job!.id;
    await worker.query(
      "update catalog_ingest.jobs set state='cancelled' where id=$1",
      [priorId],
    );
    const restaged = await prepareUpload(
      worker,
      JSON.stringify(parallel),
      "json",
      "TEST-restage.json",
      taxonomy,
      "TEST",
      true,
    );
    assert(restaged.job);
    assert.notEqual(restaged.job.id, priorId);
    assert.equal(restaged.replayed, false);
    const denied = roleDatabase(
      db as unknown as Database,
      "asia_catalog_reader",
    );
    await assert.rejects(denied.query("select * from catalog_ingest.uploads"));
  } finally {
    await db.close();
  }
});
test("migration 006 upgrades an existing local projection without changing documents; inherited grants revoked", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      "create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;",
    );
    for (const file of inventoryMigrations)
      await db.exec(await readFile("supabase/migrations/" + file, "utf8"));
    await db.exec(await readFile("supabase/catalog-worker-role.sql", "utf8"));
    await db.exec(
      await readFile(
        "supabase/migrations/202610180005_catalog_projection.sql",
        "utf8",
      ),
    );
    const tour = adminTourSchema.parse({
      ...emptyTour(randomUUID()),
      country: "thailand",
      location: "chiang-mai",
      category: "culture",
      slug: "test-existing-stage9",
      title: { ru: "ТЕСТ СОХРАНИТЬ", en: "TEST PRESERVE" },
    });
    await db.query(
      "insert into catalog_projection.documents(id,document) values($1,$2::jsonb)",
      [tour.id, JSON.stringify(tour)],
    );
    await db.exec(
      "alter default privileges grant all on tables to anon,authenticated",
    );
    await initializeEmbedded(db);
    await initializeEmbedded(db);
    assert.deepEqual(
      (
        await db.query<{ document: unknown }>(
          "select document from catalog_projection.documents where id=$1",
          [tour.id],
        )
      ).rows[0].document,
      tour,
    );
    await db.exec("set role authenticated");
    await assert.rejects(db.query("select * from catalog_ingest.uploads"));
    await assert.rejects(
      db.query("select * from catalog_projection.media_assets"),
    );
    await db.exec("reset role");
    assert.equal(
      (
        await db.query<{ allowed: boolean }>(
          "select has_table_privilege('authenticated','catalog_projection.publication_permissions','INSERT') allowed",
        )
      ).rows[0].allowed,
      false,
    );
  } finally {
    await db.close();
  }
});
test("staging manifest requires private Storage, verified TLS and existing migration files; execution stays disabled", async () => {
  const config = JSON.parse(
    await readFile("config/supabase-staging.example.json", "utf8"),
  );
  assert.equal(config.enabled, false);
  assert(config.database.tls_required);
  assert(config.database.reject_unauthorized_certificates);
  assert(config.storage.private_by_default);
  assert.equal(config.database.browser_database_credentials, false);
  assert.equal(config.publication_permission_api, true);
  assert.equal(config.automatic_publication, false);
  for (const file of config.migration_order)
    assert((await readFile(file, "utf8")).length > 0);
});
test("private filesystem media store: canonical paths, exclusive writes and isolated roundtrip", async () => {
  const profile = path.resolve(
      ".admin-postgres",
      "test-stage10-store-" + randomUUID(),
    ),
    store = new LocalMediaStore(path.join(profile, "assets")),
    key = randomUUID() + ".webp";
  try {
    const bytes = await sharp({
      create: { width: 2, height: 2, channels: 3, background: "#184d3b" },
    })
      .webp()
      .toBuffer();
    await store.put(key, bytes);
    assert.deepEqual(Buffer.from(await store.read(key)), bytes);
    await assert.rejects(store.put(key, bytes));
    await assert.rejects(store.read("../" + key));
    await assert.rejects(
      new LocalMediaStore(process.cwd()).put(key, bytes),
      /outside/,
    );
  } finally {
    assert(profile.startsWith(path.resolve(".admin-postgres") + path.sep));
    assert(path.basename(profile).startsWith("test-stage10-store-"));
    await rm(profile, { recursive: true, force: true });
  }
});
test("media: verified bytes, gallery links, reimport preservation, private access and non-destructive retirement", async () => {
  const { db, worker, editor, reader, taxonomy } = await context();
  const bytesByKey = new Map<string, Uint8Array>();
  const store: MediaStore = {
    backend: "local",
    async put(k, b) {
      bytesByKey.set(k, b);
    },
    async read(k) {
      return bytesByKey.get(k)!;
    },
  };
  try {
    const png = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#285a46" },
    })
      .png()
      .toBuffer();
    const file = new File([new Uint8Array(png)], "TEST-own-image.png", {
      type: "image/png",
    });
    await assert.rejects(
      uploadMedia(
        editor,
        store,
        new File(["<svg/>"], "TEST.svg", { type: "image/svg+xml" }),
        "TEST",
      ),
      /JPEG/,
    );
    await assert.rejects(
      uploadMedia(
        editor,
        store,
        new File([new Uint8Array(png)], "TEST.jpg", { type: "image/jpeg" }),
        "TEST",
      ),
      /не совпадает/,
    );
    const url = await uploadMedia(editor, store, file, "TEST"),
      key = url.split("/").at(-1)!;
    assert.equal(
      (await sharp(await store.read(key)).metadata()).format,
      "webp",
    );
    const prepared = await prepareUpload(
      worker,
      JSON.stringify(syntheticProducts(1)),
      "json",
      "TEST.json",
      taxonomy,
      "TEST",
      true,
    );
    assert(prepared.job);
    await releaseUpload(worker, prepared.job.id);
    await stepUpload(worker, prepared.job.id, 0, taxonomy, true);
    const id = (
      await editor.query<{ id: string }>(
        "select id from catalog_projection.documents",
      )
    ).rows[0].id;
    let tour = (await projectionById(editor, id))!;
    tour = (
      await saveProjection(
        editor,
        [
          {
            ...tour,
            title: { ru: "ТЕСТ РЕДАКЦИЯ", en: "TEST EDITORIAL" },
            description: { ru: ["ТЕСТ"], en: ["TEST"] },
            durationMinutes: 60,
            images: [{ url, alt: { ru: "ТЕСТ", en: "TEST" } }],
          },
        ],
        { [id]: tour.updatedAt },
        "TEST",
      )
    )[0];
    assert((await readMedia(editor, store, key)).length > 0);
    await assert.rejects(readMedia(reader, store, key, true));
    await assert.rejects(retireMedia(editor, url), /Сначала/);
    const repeat = await prepareUpload(
      worker,
      JSON.stringify(syntheticProducts(1, "2026-10-20T00:00:00Z")),
      "json",
      "TEST-next.json",
      taxonomy,
      "TEST",
      true,
    );
    assert(repeat.job);
    await releaseUpload(worker, repeat.job.id);
    await stepUpload(worker, repeat.job.id, 0, taxonomy, true);
    tour = (await projectionById(editor, id))!;
    assert.equal(tour.images[0].url, url);
    assert.equal(tour.title.en, "TEST EDITORIAL");
    await editor.query("select catalog_projection.review($1,$2,$3,$4,$5,$6)", [
      id,
      tour.updatedAt,
      "approved",
      "licensed",
      "https://example.invalid/TEST-rights",
      "TEST",
    ]);
    tour = (await projectionById(editor, id))!;
    assert.equal(tour.externalProduct?.publication_readiness, "ready");
    await assert.rejects(
      saveProjection(
        editor,
        [{ ...tour, status: "published" }],
        { [id]: tour.updatedAt },
        "TEST",
      ),
      /разрешение/,
    );
    await assert.rejects(
      editor.query("select * from catalog_projection.publication_permissions"),
    );
    assert.equal(
      (await projectionRepository(reader).list(parseQuery({}, "ru"))).total,
      0,
    );
    tour = (
      await saveProjection(
        editor,
        [{ ...tour, images: [] }],
        { [id]: tour.updatedAt },
        "TEST",
      )
    )[0];
    // Immutable queued/source URL references, including percent escapes, block retirement.
    const encoded = url.replace("a", "%61");
    await db.query(
      "update catalog_ingest.parts set records=$2::jsonb where job_id=$1",
      [
        prepared.job.id,
        JSON.stringify([{ product: { images: [{ url: encoded }] } }]),
      ],
    );
    await assert.rejects(retireMedia(editor, url), /используется/);
    await db.query(
      "update catalog_ingest.parts set records='[{}]' where job_id=$1",
      [prepared.job.id],
    );
    await retireMedia(editor, url);
    await assert.rejects(readMedia(editor, store, key));
    assert(bytesByKey.has(key), "Physical bytes must remain retained");
    await assert.rejects(
      new LocalMediaStore(process.cwd()).read("../outside.webp"),
      /ключ/,
    );
    await assert.rejects(
      reader.query("select * from catalog_projection.media_assets"),
    );
  } finally {
    await db.close();
  }
});
