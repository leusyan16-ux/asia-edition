import { randomUUID } from "node:crypto";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import {
  stageCatalogJob,
  advanceCatalogJob,
} from "../src/features/admin/catalog-jobs";
import { readLocalState } from "../src/features/admin/local-store";
import { countries } from "../src/lib/catalog";
import { localCategories } from "../src/features/admin/local-taxonomy";
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
async function main() {
  const results = [];
  for (const count of process.argv[3]
    ? process.argv[3].split(",").map(Number)
    : [1000, 5000, 10000]) {
    if (!Number.isInteger(count) || count < 1 || count > 100000)
      throw new Error("Invalid benchmark count");
    const directory = await mkdtemp(path.join(tmpdir(), "test-feed-scale-"));
    try {
      const products = Array.from({ length: count }, (_, i) => {
        const c = countries[i % 13];
        return {
          provider: "test_scale",
          external_product_id: `TEST-${i}`,
          source_url: `https://example.invalid/test/${i}`,
          import_status: "pending",
          last_synced_at: "2026-10-14T00:00:00Z",
          test_data: true,
          product: {
            slug: `test-scale-${i}`,
            country: c.slug,
            location: c.destinations[0].slug,
            category: "nature",
            title: { ru: `ТЕСТ ${i}`, en: `TEST ${i}` },
            description: {
              ru: ["Синтетические данные."],
              en: ["Synthetic data."],
            },
          },
        };
      });
      const content = JSON.stringify(products),
        start = performance.now();
      const staged = await stageCatalogJob(
        content,
        "json",
        {
          provider: "test_scale",
          countries: countries.map((c) => c.slug),
          complete: false,
          snapshot_at: "2026-10-14T00:00:00Z",
        },
        taxonomy,
        "synthetic benchmark " + randomUUID(),
        directory,
      );
      if (!staged.job) throw new Error(JSON.stringify(staged.errors));
      const stage_ms = performance.now() - start,
        packet_times: number[] = [];
      let job = staged.job;
      while (job.phase !== "completed") {
        const timer = performance.now();
        job = await advanceCatalogJob(job.id, job.cursor, taxonomy, directory);
        packet_times.push(performance.now() - timer);
        if (job.phase === "failed") throw new Error(job.errors.join(";"));
        if (job.cursor % 10 === 0)
          console.log(`${count} synthetic: ${job.processed}/${count}`);
      }
      const state = await readLocalState(directory);
      if (
        state.tours.length !== count ||
        state.tours.some((t) => t.status !== "draft")
      )
        throw new Error("Scale integrity failure");
      packet_times.sort((a, b) => a - b);
      results.push({
        count,
        parts: job.parts.length,
        stage_ms: +stage_ms.toFixed(2),
        packet_p50_ms:
          +packet_times[Math.floor(packet_times.length / 2)].toFixed(2),
        packet_p95_ms:
          +packet_times[Math.ceil(packet_times.length * 0.95) - 1].toFixed(2),
        total_ms: +(performance.now() - start).toFixed(2),
        created: job.created,
        published: 0,
        rss_mb: +(process.memoryUsage().rss / 1048576).toFixed(1),
      });
      console.log(JSON.stringify(results.at(-1)));
    } finally {
      if (
        !path
          .resolve(directory)
          .startsWith(path.resolve(tmpdir()) + path.sep) ||
        !path.basename(directory).startsWith("test-feed-scale-")
      )
        throw new Error("Unsafe cleanup");
      await rm(directory, { recursive: true, force: true });
    }
  }
  await mkdir("qa/scale", { recursive: true });
  await writeFile(
    `qa/scale/feed-jobs-${process.argv[2] || "final"}.json`,
    JSON.stringify(
      { recorded_at: new Date().toISOString(), synthetic_only: true, results },
      null,
      2,
    ),
  );
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
