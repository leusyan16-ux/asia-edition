import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  stageStream,
  claim,
  processPacket,
  retryLater,
  type Database,
} from "../src/features/ingestion/postgres-worker";
import { readNDJSON } from "../src/features/ingestion/stream";
import { countries } from "../src/lib/catalog";
import { localCategories } from "../src/features/admin/local-taxonomy";
export const taxonomy = {
  locations: countries.flatMap((c) =>
    c.destinations.map((d) => ({
      slug: d.slug,
      country: c.slug,
      name: d.name,
      kind: "destination" as const,
      parent: null,
    })),
  ),
  categories: localCategories,
  operators: [],
};
export async function database() {
  const db = new PGlite();
  await db.exec(
    "create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;",
  );
  for (const file of [
    "202610100001_tour_inventory.sql",
    "202610100002_admin.sql",
    "202610140003_external_import_foundation.sql",
    "202610180004_catalog_worker.sql",
  ])
    await db.exec(await readFile("supabase/migrations/" + file, "utf8"));
  return db;
}
const time = "2026-10-18T00:00:00Z";
export const scope = {
  provider: "test_stage8",
  countries: ["thailand"],
  snapshot_at: time,
  complete: false,
};
export async function* records(count: number, offset = 0) {
  for (let n = offset; n < offset + count; n++)
    yield {
      provider: "test_stage8",
      external_product_id: `TEST-${n}`,
      source_url: `https://example.invalid/test/${n}`,
      last_synced_at: time,
      import_status: "pending" as const,
      test_data: true,
      packages:
        n === 0
          ? [
              {
                external_package_id: "TEST-PACKAGE",
                title: { ru: "ТЕСТ", en: "TEST" },
                prices: [],
              },
            ]
          : [],
      product: {
        slug: `test-stage8-${n}`,
        country: "thailand",
        location: "chiang-mai",
        category: "culture",
        title: { ru: `ТЕСТ ${n}`, en: `TEST ${n}` },
      },
    };
}
test("PostgreSQL ingestion: migrations, RLS, fencing, atomic recovery and preserved editorial data", async () => {
  const db = await database();
  const store = db as unknown as Database;
  try {
    await db.exec("set role anon");
    await assert.rejects(db.query("select * from catalog_ingest.products"));
    await assert.rejects(
      db.query("select * from catalog_ingest.claim('attacker',60)"),
    );
    await db.exec("reset role;set role authenticated");
    await assert.rejects(db.query("select * from catalog_ingest.jobs"));
    await db.exec("reset role");
    await db.exec(await readFile("supabase/catalog-worker-role.sql", "utf8"));
    await db.exec("set role asia_catalog_worker");
    await assert.rejects(db.query("select * from public.admin_members"));
    const id = await stageStream(store, records(251), scope, taxonomy, true);
    await assert.rejects(
      stageStream(store, records(1), scope, taxonomy, true),
      /Overlapping/,
    );
    const first = (await claim(store, "first"))!;
    assert.equal(first.id, id);
    assert.equal(await claim(store, "second"), undefined);
    await processPacket(store, first, 0, taxonomy, true);
    assert.equal(await processPacket(store, first, 0, taxonomy, true), false);
    await db.query(
      "update catalog_ingest.jobs set lease_until=now()-interval '1 second' where id=$1",
      [id],
    );
    const recovered = (await claim(store, "recovered"))!;
    assert.equal(recovered.cursor, 1);
    await assert.rejects(
      processPacket(store, first, 1, taxonomy, true),
      /Lost lease/,
    );
    // Fault injection belongs to the test DBA, not the restricted worker.
    await db.exec("reset role");
    await db.query(
      "update catalog_ingest.parts set checksum=repeat('0',64) where job_id=$1 and ordinal=1",
      [id],
    );
    await db.exec("set role asia_catalog_worker");
    await assert.rejects(
      processPacket(store, recovered, 1, taxonomy, true),
      /checksum/,
    );
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from catalog_ingest.products",
        )
      ).rows[0].n,
      250,
    );
    await retryLater(store, recovered, "TEST transient failure");
    assert.equal(
      (
        await db.query<{ state: string }>(
          "select state from catalog_ingest.jobs where id=$1",
          [id],
        )
      ).rows[0].state,
      "retry",
    );
    // Restore only our test packet and simulate backoff passing.
    const { digest } = await import("../src/features/admin/import-engine");
    const packet = (
      await db.query<{ records: unknown }>(
        "select records from catalog_ingest.parts where job_id=$1 and ordinal=1",
        [id],
      )
    ).rows[0].records;
    await db.exec("reset role");
    await db.query(
      "update catalog_ingest.parts set checksum=$2 where job_id=$1 and ordinal=1",
      [id, digest(packet)],
    );
    await db.exec("set role asia_catalog_worker");
    await db.query(
      "update catalog_ingest.jobs set available_at=now()-interval '1 second' where id=$1",
      [id],
    );
    const resumed = (await claim(store, "resumed"))!;
    await processPacket(store, resumed, 1, taxonomy, true);
    assert.equal(await processPacket(store, resumed, 1, taxonomy, true), false);
    await db.query(
      `update catalog_ingest.products set document=jsonb_set(document,'{title,ru}','"Редакторский текст"') where external_product_id='TEST-0'`,
    );
    await stageStream(
      store,
      records(1),
      { ...scope, complete: true },
      taxonomy,
      true,
    );
    const repeat = (await claim(store, "repeat"))!;
    await processPacket(store, repeat, 0, taxonomy, true);
    const result = (
      await db.query<{
        document: {
          status: string;
          title: { ru: string };
          externalProduct: { source_status: string };
        };
      }>(
        "select document from catalog_ingest.products where external_product_id='TEST-0'",
      )
    ).rows[0].document;
    assert.equal(result.title.ru, "Редакторский текст");
    assert.equal(result.status, "draft");
    const { readDraftPage } =
      await import("../src/features/ingestion/repository");
    const page = await readDraftPage(store, null, 25);
    assert.equal(page.items.length, 25);
    assert.equal((await readDraftPage(store, page.next, 25)).items.length, 25);
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from catalog_ingest.products where document->'externalProduct'->>'source_status'='missing'",
        )
      ).rows[0].n,
      250,
    );
    async function* collision() {
      let index = 0;
      for await (const item of records(2, 900)) {
        if (index++ === 1) item.product.slug = "test-stage8-0";
        yield item;
      }
    }
    const broken = await stageStream(store, collision(), scope, taxonomy, true);
    const brokenLease = (await claim(store, "rollback"))!;
    await assert.rejects(processPacket(store, brokenLease, 0, taxonomy, true));
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from catalog_ingest.products where external_product_id='TEST-900'",
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await db.query<{ cursor: number }>(
          "select cursor from catalog_ingest.jobs where id=$1",
          [broken],
        )
      ).rows[0].cursor,
      0,
    );
    await db.query(
      "update catalog_ingest.jobs set lease_until=now()-interval '1 second',attempts=max_attempts where id=$1",
      [broken],
    );
    assert.equal(await claim(store, "exhausted"), undefined);
    assert.equal(
      (
        await db.query<{ state: string }>(
          "select state from catalog_ingest.jobs where id=$1",
          [broken],
        )
      ).rows[0].state,
      "failed",
    );
    async function* duplicates() {
      for await (const item of records(251)) {
        if (item.external_product_id === "TEST-250")
          item.external_product_id = "TEST-0";
        yield item;
      }
    }
    await assert.rejects(
      stageStream(store, duplicates(), scope, taxonomy, true),
      /Duplicate source identity/,
    );
    await assert.rejects(db.query("delete from catalog_ingest.products"));
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from catalog_ingest.packages",
        )
      ).rows[0].n,
      1,
    );
    await db.exec("reset role");
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from public.tours",
        )
      ).rows[0].n,
      0,
    );
  } finally {
    await db.close();
  }
});
test("stream parser handles UTF8 boundaries and bounded lines", async () => {
  const value = JSON.stringify({ title: "ТЕСТ" });
  const bytes = Buffer.from(value + "\n");
  async function* chunks() {
    yield bytes.subarray(0, 12);
    yield bytes.subarray(12);
  }
  const result = [];
  for await (const row of readNDJSON(chunks())) result.push(row);
  assert.deepEqual(result, [{ title: "ТЕСТ" }]);
  async function* huge() {
    yield "x".repeat(4 * 1024 * 1024 + 1);
  }
  await assert.rejects(async () => {
    for await (const row of readNDJSON(huge())) void row;
  }, /limit/);
});
