import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";
import {
  initializeEmbedded,
  roleDatabase,
} from "../src/features/ingestion/embedded";
import type { Database } from "../src/features/ingestion/postgres-worker";
import { nativeSettings } from "../src/features/ingestion/native-config";
import { SupabasePrivateMediaStore } from "../src/features/ingestion/storage";
import { indexingEnabled, publicOrigin } from "../src/lib/site-config";
import { siteCopy } from "../src/lib/site-copy";
import {
  signChallenge,
  verifyChallenge,
  saveInquiry,
  inquirySchema,
} from "../src/features/inquiries/model";
import {
  prepareUpload,
  releaseUpload,
  stepUpload,
} from "../src/features/ingestion/upload";
import {
  projectionTaxonomy,
  projectionById,
  saveProjection,
  projectionRepository,
} from "../src/features/ingestion/projection";
import { syntheticProducts } from "../scripts/fixtures/stage10-products";
test("native worker entrypoint refuses unapproved configuration without connecting", () => {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/catalog-worker.ts"],
    {
      env: {
        ...process.env,
        TOUR_DATA_SOURCE: "demo",
        POSTGRES_REMOTE_ENABLED: "false",
      },
      encoding: "utf8",
      timeout: 20000,
      windowsHide: true,
    },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /catalog_worker_start_failed/);
  assert(!result.stderr.includes("postgresql://"));
});
test("launch SQL provisioning: restricted role memberships and private Storage rollback safeguards", async () => {
  const db = new PGlite();
  try {
    await initializeEmbedded(db);
    await db.exec(await readFile("supabase/catalog-server-roles.sql", "utf8"));
    const roles = await db.query<{
      rolname: string;
      rolcanlogin: boolean;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(
      "select rolname,rolcanlogin,rolsuper,rolbypassrls from pg_roles where rolname in ('asia_reader_login','asia_editor_login','asia_worker_login')",
    );
    assert.equal(roles.rows.length, 3);
    assert(
      roles.rows.every((r) => !r.rolcanlogin && !r.rolsuper && !r.rolbypassrls),
    );
    await db.exec(
      "create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid);",
    );
    const sql = await readFile("supabase/storage-private.sql", "utf8");
    await db.exec(sql);
    assert.equal(
      (
        await db.query<{ public: boolean }>(
          "select public from storage.buckets where id='asia-private-media'",
        )
      ).rows[0].public,
      false,
    );
    await db.exec("update storage.buckets set public=true");
    await assert.rejects(db.exec(sql), /Existing bucket is public/);
    await db.exec("rollback");
    assert.equal(
      (
        await db.query<{ public: boolean }>(
          "select public from storage.buckets where id='asia-private-media'",
        )
      ).rows[0].public,
      true,
    );
    await db.exec(
      "update storage.buckets set public=false;create policy TEST_broad_read on storage.objects for select to anon using(true)",
    );
    await assert.rejects(
      db.exec(sql),
      /Review existing Storage object policies/,
    );
    await db.exec("rollback");
  } finally {
    await db.close();
  }
});
test("launch configuration: remote opt-in, verified TLS, role-specific pool and indexing are fail closed", () => {
  const env = {
    TOUR_DATA_SOURCE: "postgres",
    POSTGRES_RUNTIME: "native",
    POSTGRES_REMOTE_ENABLED: "true",
    ADMIN_MODE: "supabase",
    POSTGRES_APPROVED_HOST: "db.example.invalid",
    CATALOG_READER_DATABASE_URL:
      "postgresql://reader:TEST@db.example.invalid/db",
  };
  assert.equal(
    nativeSettings("asia_catalog_reader", env).ssl.rejectUnauthorized,
    true,
  );
  for (const patch of [
    { POSTGRES_REMOTE_ENABLED: "false" },
    { ADMIN_MODE: "local" },
    { POSTGRES_APPROVED_HOST: "wrong.invalid" },
    {
      CATALOG_READER_DATABASE_URL:
        env.CATALOG_READER_DATABASE_URL + "?sslmode=disable",
    },
    { POSTGRES_POOL_MAX: "99" },
  ])
    assert.throws(() =>
      nativeSettings("asia_catalog_reader", { ...env, ...patch }),
    );
  assert.throws(() => nativeSettings("asia_catalog_worker", env));
  assert.equal(indexingEnabled({}), false);
  assert.match(siteCopy("ru", { NODE_ENV: "development" }).sample, /Демо/);
  assert(
    !/demo|sample|klook/i.test(
      siteCopy("en", {
        NODE_ENV: "production",
        TOUR_DATA_SOURCE: "postgres",
        POSTGRES_RUNTIME: "native",
      }).notice,
    ),
  );
  assert.equal(publicOrigin({ SITE_URL: "http://insecure.invalid" }), null);
  assert.equal(
    indexingEnabled({
      ...env,
      NODE_ENV: "production",
      SITE_URL: "https://asia.example.invalid",
      SITE_INDEXING_ENABLED: "true",
    }),
    true,
  );
});
test("private Storage uses authenticated private objects, no overwrite or public URLs; invalid keys rejected", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const transport: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init: init! });
    return new Response(new Uint8Array([1, 2, 3]));
  };
  const store = new SupabasePrivateMediaStore(
      "https://storage.example.invalid",
      "asia-private-media",
      "TEST-key",
      transport,
    ),
    key = randomUUID() + ".webp";
  await store.put(key, new Uint8Array([1]));
  assert.deepEqual(await store.read(key), new Uint8Array([1, 2, 3]));
  assert.equal(calls[0].init.method, "POST");
  assert.equal(
    (calls[0].init.headers as Record<string, string>)["x-upsert"],
    "false",
  );
  assert(!calls[1].url.includes("/public/"));
  await assert.rejects(store.read("../bad"));
  assert.equal(calls.length, 2);
});
test("inquiry anti-spam: signed expiry, minimum delay, tampering, honeypot and consent", () => {
  const key = "TEST-".repeat(10),
    at = Date.now(),
    token = signChallenge(key, at);
  assert(verifyChallenge(token, key, at + 3000));
  assert.throws(() => verifyChallenge(token, key, at + 100));
  assert.throws(() => verifyChallenge(token, key, at + 1800001));
  assert.throws(() => verifyChallenge(token + "x", key, at + 3000));
  const input = {
    product: "test",
    name: "TEST",
    email: "test@example.invalid",
    message: "",
    locale: "ru",
    consent: true,
    website: "",
    token,
  };
  assert(inquirySchema.safeParse(input).success);
  assert(!inquirySchema.safeParse({ ...input, consent: false }).success);
  assert(!inquirySchema.safeParse({ ...input, website: "spam" }).success);
});
test("local SQL launch cycle: import, edit, rights, explicit publication, public projection and durable private inquiries", async () => {
  const engine = new PGlite();
  await initializeEmbedded(engine);
  const raw = engine as unknown as Database,
    worker = roleDatabase(raw, "asia_catalog_worker"),
    editor = roleDatabase(raw, "asia_catalog_editor"),
    reader = roleDatabase(raw, "asia_catalog_reader"),
    taxonomy = await projectionTaxonomy(editor);
  try {
    const result = await prepareUpload(
      worker,
      JSON.stringify(syntheticProducts(1)),
      "json",
      "TEST.json",
      taxonomy,
      "TEST",
      true,
    );
    assert(result.job);
    await releaseUpload(worker, result.job.id);
    await stepUpload(worker, result.job.id, 0, taxonomy, true);
    const id = (
      await editor.query<{ id: string }>(
        "select id from catalog_projection.documents",
      )
    ).rows[0].id;
    let tour = (await projectionById(editor, id))!;
    assert.equal(await projectionRepository(reader).bySlug(tour.slug), null);
    await assert.rejects(
      editor.query(
        "select catalog_projection.authorize_publication($1,$2,$3)",
        [id, tour.updatedAt, "TEST"],
      ),
    );
    const operator = randomUUID();
    await editor.query(
      "insert into public.operators(id,name,verified_at) values($1,'TEST ONLY OPERATOR',now())",
      [operator],
    );
    tour = (
      await saveProjection(
        editor,
        [
          {
            ...tour,
            isDemo: false,
            operator: { id: operator, name: "TEST ONLY OPERATOR" },
            verifiedAt: new Date().toISOString(),
            durationMinutes: 60,
            description: { ru: ["ТЕСТ"], en: ["TEST"] },
            images: [
              {
                url: "https://example.invalid/TEST.webp",
                alt: { ru: "ТЕСТ", en: "TEST" },
              },
            ],
          },
        ],
        { [id]: tour.updatedAt },
        "TEST",
      )
    )[0];
    await editor.query(
      "select catalog_projection.review($1,$2,'approved','licensed','https://example.invalid/TEST-rights','TEST')",
      [id, tour.updatedAt],
    );
    tour = (await projectionById(editor, id))!;
    assert.equal(await projectionRepository(reader).bySlug(tour.slug), null);
    await assert.rejects(
      reader.query(
        "select catalog_projection.authorize_publication($1,$2,$3)",
        [id, tour.updatedAt, "TEST"],
      ),
    );
    await assert.rejects(
      editor.query(
        "select catalog_projection.authorize_publication($1,$2,$3)",
        [id, "stale", "TEST"],
      ),
    );
    await editor.query(
      "select catalog_projection.authorize_publication($1,$2,$3)",
      [id, tour.updatedAt, "TEST"],
    );
    assert((await projectionRepository(reader).bySlug(tour.slug))?.id === id);
    const key = "TEST-".repeat(10),
      make = (email = "test@example.invalid") => ({
        product: tour.slug,
        name: "TEST",
        email,
        message: "TEST CONTACT ONLY",
        locale: "ru",
        consent: true,
        website: "",
        token: signChallenge(key, Date.now() - 3000),
      });
    const input = make();
    const inquiry = await saveInquiry(editor, input, id, key);
    assert.equal(await saveInquiry(editor, input, id, key), inquiry);
    await saveInquiry(editor, make(), id, key);
    await saveInquiry(editor, make(), id, key);
    await assert.rejects(saveInquiry(editor, make(), id, key), /rate limit/);
    assert.equal(
      (
        await editor.query<{ n: number }>(
          "select count(*)::int n from catalog_projection.inquiries",
        )
      ).rows[0].n,
      3,
    );
    await assert.rejects(
      reader.query("select * from catalog_projection.inquiries"),
    );
    await engine.exec("set role authenticated");
    await assert.rejects(
      engine.query("select * from catalog_projection.inquiries"),
    );
    await engine.exec("reset role");
    const source = (
      await worker.query<{ document: Record<string, unknown> }>(
        "select document from catalog_ingest.products where id=$1",
        [id],
      )
    ).rows[0].document;
    await worker.query(
      "update catalog_ingest.products set document=$2::jsonb,revision=revision+1 where id=$1",
      [id, JSON.stringify(source)],
    );
    assert.equal(await projectionRepository(reader).bySlug(tour.slug), null);
    await assert.rejects(
      saveInquiry(editor, make("other@example.invalid"), id, key),
      /not available/,
    );
  } finally {
    await engine.close();
  }
});
