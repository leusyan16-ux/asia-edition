/** Offline synthetic upload service benchmark. Never opens a persistent profile. */
import { PGlite } from "@electric-sql/pglite";
import { mkdir, writeFile } from "node:fs/promises";
import {
  initializeEmbedded,
  roleDatabase,
} from "../src/features/ingestion/embedded";
import {
  prepareUpload,
  releaseUpload,
  stepUpload,
  UPLOAD_LIMITS,
} from "../src/features/ingestion/upload";
import {
  projectionTaxonomy,
  projectionRepository,
} from "../src/features/ingestion/projection";
import { parseQuery } from "../src/features/tours/query";
import type { Database } from "../src/features/ingestion/postgres-worker";
import { syntheticProducts, syntheticCSV } from "./fixtures/stage10-products";
async function main() {
  const count = Number(process.argv[2] ?? 1000),
    format = process.argv[3] === "csv" ? "csv" : "json";
  if (![1000, 5000, 10000, 12500].includes(count))
    throw new Error("Count must be 1000,5000,10000,12500");
  const db = new PGlite();
  let peak = process.memoryUsage().rss;
  const sampler = setInterval(() => {
    peak = Math.max(peak, process.memoryUsage().rss);
  }, 10);
  try {
    await initializeEmbedded(db);
    const raw = db as unknown as Database,
      worker = roleDatabase(raw, "asia_catalog_worker"),
      editor = roleDatabase(raw, "asia_catalog_editor"),
      reader = roleDatabase(raw, "asia_catalog_reader"),
      taxonomy = await projectionTaxonomy(editor);
    const content =
      format === "csv"
        ? syntheticCSV(syntheticProducts(count))
        : JSON.stringify(syntheticProducts(count));
    if (Buffer.byteLength(content) > UPLOAD_LIMITS.maxBytes)
      throw new Error("Fixture exceeds UI limit");
    const start = performance.now(),
      prepared = await prepareUpload(
        worker,
        content,
        format,
        `TEST-${count}.${format}`,
        taxonomy,
        "TEST LOAD",
        true,
      ),
      staged = performance.now();
    if (!prepared.job || prepared.preview.failed)
      throw new Error("Preparation failed");
    await releaseUpload(worker, prepared.job.id);
    let job = prepared.job;
    const latencies: number[] = [];
    const first = performance.now();
    job = await stepUpload(worker, job.id, job.cursor, taxonomy, true);
    latencies.push(performance.now() - first);
    const replay = await prepareUpload(
      worker,
      content,
      format,
      `TEST-${count}.${format}`,
      taxonomy,
      "TEST LOAD",
      true,
    );
    if (
      replay.job?.id !== job.id ||
      replay.job.cursor !== job.cursor ||
      !replay.replayed
    )
      throw new Error("Replay invariant failed");
    const old = await stepUpload(worker, job.id, 0, taxonomy, true);
    if (old.cursor !== job.cursor) throw new Error("Old checkpoint advanced");
    while (job.state !== "completed") {
      const at = performance.now();
      job = await stepUpload(worker, job.id, job.cursor, taxonomy, true);
      latencies.push(performance.now() - at);
    }
    const finished = performance.now(),
      publicPage = await projectionRepository(reader).list(
        parseQuery({}, "ru"),
      );
    const inventory = (
      await editor.query<{ n: number }>(
        "select count(*)::int n from catalog_projection.documents",
      )
    ).rows[0].n;
    if (inventory !== count || publicPage.total !== 0 || job.created !== count)
      throw new Error("Inventory/draft-only invariant failed");
    latencies.sort((a, b) => a - b);
    const report = {
      at: new Date().toISOString(),
      environment:
        "Local embedded PostgreSQL upload service; NOT HTTP or production",
      count,
      format,
      input_bytes: Buffer.byteLength(content),
      prepare_ms: staged - start,
      import_ms: finished - staged,
      packet_count: latencies.length,
      packet_p50_ms: latencies[Math.floor(latencies.length * 0.5)],
      packet_p95_ms:
        latencies[
          Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))
        ],
      peak_sampled_rss_mib: Math.max(peak, process.memoryUsage().rss) / 1048576,
      end_heap_mib: process.memoryUsage().heapUsed / 1048576,
      duplicates: 0,
      imported_published: publicPage.total,
      replayed_same_job: true,
      errors: 0,
    };
    const reportDirectory =
      process.env.LAUNCH_QA === "true"
        ? "data/benchmarks/launch"
        : "data/benchmarks/stage10";
    await mkdir(reportDirectory, { recursive: true });
    await writeFile(
      `${reportDirectory}/upload-${count}-${format}.json`,
      JSON.stringify(report, null, 2) + "\n",
    );
    console.log(JSON.stringify(report));
  } finally {
    clearInterval(sampler);
    await db.close();
  }
}
void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
