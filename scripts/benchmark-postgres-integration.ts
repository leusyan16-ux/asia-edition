/** Local synthetic integration load. Each count runs in a separate process. */
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
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
  projectionRepository,
  projectionOverview,
  projectionById,
  projectionTaxonomy,
  importDashboard,
} from "../src/features/ingestion/projection";
import { emptyTour, adminTourSchema } from "../src/features/admin/model";
import { demoTour } from "../src/features/tours/demo";
import { parseQuery } from "../src/features/tours/query";
async function main() {
  const count = Number(process.argv[2] ?? 1000);
  if (![1000, 5000, 10000, 12500].includes(count))
    throw new Error("Count must be 1000,5000,10000,12500");
  const db = new PGlite();
  let peak = process.memoryUsage().rss;
  const timer = setInterval(() => {
    peak = Math.max(peak, process.memoryUsage().rss);
  }, 10);
  try {
    await initializeEmbedded(db);
    const raw = db as unknown as Database,
      editor = roleDatabase(raw, "asia_catalog_editor"),
      reader = roleDatabase(raw, "asia_catalog_reader"),
      worker = roleDatabase(raw, "asia_catalog_worker");
    const taxonomy = await projectionTaxonomy(editor),
      repo = projectionRepository(reader);
    let first = "";
    // Independent public TEST fixtures, NOT imports. Only this ephemeral database.
    for (let offset = 0; offset < count; offset += 250) {
      const docs = [];
      for (let n = offset; n < Math.min(count, offset + 250); n++) {
        const d = adminTourSchema.parse({
          ...emptyTour(randomUUID()),
          slug: `test-public-${String(n).padStart(6, "0")}`,
          country: "japan",
          location: "kyoto",
          category: "culture",
          title: { ru: `ТЕСТ ${n}`, en: `TEST ${n}` },
          description: {
            ru: ["Синтетическая фикстура"],
            en: ["Synthetic fixture"],
          },
          durationMinutes: 60,
          isDemo: true,
          status: "published",
          images: [demoTour.images[0]],
          prices: [],
        });
        if (!first) first = d.id;
        docs.push(d);
      }
      await db.query(
        "insert into catalog_projection.documents(id,document) select (d->>'id')::uuid,d from jsonb_array_elements($1::jsonb) d",
        [JSON.stringify(docs)],
      );
    }
    const timestamp = "2026-10-18T00:00:00Z";
    async function* feed() {
      for (let n = 0; n < count; n++)
        yield {
          provider: "test_stage9",
          external_product_id: `TEST-${n}`,
          source_url: `https://example.invalid/test/${n}`,
          last_synced_at: timestamp,
          import_status: "pending" as const,
          test_data: true,
          product: {
            slug: `test-import-${n}`,
            country: "japan",
            location: "kyoto",
            category: "culture",
            title: { ru: `ТЕСТ ИМПОРТ ${n}`, en: `TEST IMPORT ${n}` },
            description: {
              ru: ["ТЕСТ ".repeat(100)],
              en: ["TEST ".repeat(100)],
            },
          },
        };
    }
    const started = performance.now();
    await stageStream(
      worker,
      feed(),
      {
        provider: "test_stage9",
        countries: ["japan"],
        snapshot_at: timestamp,
        complete: false,
      },
      taxonomy,
      true,
      50,
    );
    const staged = performance.now();
    const samples: Record<string, number[]> = {
      catalog: [],
      filtered: [],
      admin: [],
      editor: [],
      jobs: [],
    };
    let errors = 0;
    const timed = async (name: string, fn: () => Promise<unknown>) => {
      const start = performance.now();
      try {
        await fn();
      } catch (e) {
        errors++;
        throw e;
      } finally {
        samples[name].push(performance.now() - start);
      }
    };
    const reading = Array.from({ length: 4 }, async () => {
      for (let round = 0; round < 10; round++) {
        await timed("catalog", () =>
          repo.list(parseQuery({ page: String((round % 3) + 1) }, "ru")),
        );
        await timed("filtered", () =>
          repo.list(
            parseQuery(
              {
                country: "japan",
                location: "kyoto",
                category: "culture",
                search: "ТЕСТ",
                duration: "short",
              },
              "en",
            ),
          ),
        );
        await timed("admin", () =>
          projectionOverview(editor, { page: round + 1 }),
        );
        await timed("editor", () => projectionById(editor, first));
        await timed("jobs", () => importDashboard(editor));
      }
    });
    const importing = runOneJob(
      worker,
      "stage9-load",
      taxonomy,
      undefined,
      true,
    );
    await Promise.all([...reading, importing]);
    const finished = performance.now();
    const publicPage = await repo.list(parseQuery({}, "ru"));
    const overview = await projectionOverview(editor, {});
    const importedPublished = (
      await db.query<{ n: number }>(
        "select count(*)::int n from catalog_projection.documents where source_id is not null and status<>'draft'",
      )
    ).rows[0].n;
    if (
      publicPage.total !== count ||
      overview.stats.total !== count * 2 ||
      importedPublished !== 0
    )
      throw new Error("Isolation/count invariant failed");
    const latencies = Object.fromEntries(
      Object.entries(samples).map(([name, values]) => {
        values.sort((a, b) => a - b);
        return [
          name,
          {
            requests: values.length,
            p50_ms: values[Math.floor(values.length * 0.5)],
            p95_ms:
              values[
                Math.min(values.length - 1, Math.floor(values.length * 0.95))
              ],
            max_ms: values.at(-1),
          },
        ];
      }),
    );
    const report = {
      at: new Date().toISOString(),
      environment:
        "Local embedded PostgreSQL/PGlite; adapters, NOT HTTP or production; four concurrent async clients serialize inside PGlite",
      imported: count,
      batch_size: 50,
      independent_public_test_fixtures: count,
      stage_ms: staged - started,
      worker_and_concurrent_reads_ms: finished - staged,
      latencies,
      errors,
      peak_sampled_rss_mib: Math.max(peak, process.memoryUsage().rss) / 1048576,
      end_heap_mib: process.memoryUsage().heapUsed / 1048576,
      imported_published: importedPublished,
    };
    await mkdir("data/benchmarks/stage9", { recursive: true });
    await writeFile(
      `data/benchmarks/stage9/integration-${count}.json`,
      JSON.stringify(report, null, 2) + "\n",
    );
    console.log(JSON.stringify(report));
  } finally {
    clearInterval(timer);
    await db.close();
  }
}
void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
