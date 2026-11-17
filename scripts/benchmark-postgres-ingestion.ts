/** Offline load harness ONLY: embedded PostgreSQL, synthetic data, no .env load. */
import { PGlite } from "@electric-sql/pglite";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import {
  stageStream,
  type Database,
} from "../src/features/ingestion/postgres-worker";
import { runOneJob } from "../src/features/ingestion/runner";
import { readDraftPage } from "../src/features/ingestion/repository";
import { countries } from "../src/lib/catalog";
import { localCategories } from "../src/features/admin/local-taxonomy";
async function main() {
  const count = Number(process.argv[2] ?? 10000);
  if (!Number.isInteger(count) || count < 1 || count > 100000)
    throw new Error("Count must be 1..100000");
  const db = new PGlite();
  const store = db as unknown as Database;
  const taxonomy = {
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
  let peak = process.memoryUsage().rss;
  const samples = setInterval(() => {
    peak = Math.max(peak, process.memoryUsage().rss);
  }, 10);
  try {
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
    await db.exec(await readFile("supabase/catalog-worker-role.sql", "utf8"));
    await db.exec("set role asia_catalog_worker");
    const at = "2026-10-18T00:00:00Z";
    async function* records() {
      for (let n = 0; n < count; n++)
        yield {
          provider: "test_stage8_load",
          external_product_id: `TEST-${n}`,
          source_url: `https://example.invalid/test/${n}`,
          last_synced_at: at,
          import_status: "pending" as const,
          test_data: true,
          product: {
            slug: `test-stage8-load-${n}`,
            country: "japan",
            location: "kyoto",
            category: "culture",
            title: { ru: `ТЕСТ ${n}`, en: `TEST ${n}` },
            description: {
              ru: ["Синтетический нагрузочный текст. ".repeat(20)],
              en: ["Synthetic load description. ".repeat(20)],
            },
          },
        };
    }
    const start = performance.now();
    await stageStream(
      store,
      records(),
      {
        provider: "test_stage8_load",
        countries: ["japan"],
        snapshot_at: at,
        complete: false,
      },
      taxonomy,
      true,
    );
    const staged = performance.now();
    await runOneJob(store, "offline-load", taxonomy, undefined, true);
    const done = performance.now();
    const readStart = performance.now();
    const page = await readDraftPage(store);
    const state = await db.query<{ total: number; published: number }>(
      "select count(*)::int total,count(*) filter(where document->>'status'<>'draft')::int published from catalog_ingest.products",
    );
    if (
      state.rows[0].total !== count ||
      state.rows[0].published !== 0 ||
      page.items.length !== Math.min(count, 25)
    )
      throw new Error("Load invariant failed");
    const report = {
      at: new Date().toISOString(),
      environment:
        "Embedded PGlite in one Node process; NOT production/cloud performance",
      count,
      stage_ms: staged - start,
      worker_ms: done - staged,
      page_ms: performance.now() - readStart,
      peak_sampled_rss_mb: Math.max(peak, process.memoryUsage().rss) / 1048576,
      end_heap_mb: process.memoryUsage().heapUsed / 1048576,
      max_packet_records: 250,
      max_packet_input_bytes: 4194304,
      published: 0,
    };
    await mkdir("data/benchmarks/stage8", { recursive: true });
    await writeFile(
      `data/benchmarks/stage8/embedded-${count}.json`,
      JSON.stringify(report, null, 2) + "\n",
    );
    console.log(JSON.stringify(report));
  } finally {
    clearInterval(samples);
    await db.close();
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
