import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  emptyTour,
  type AdminTour,
  adminSummarySchema,
  missingInformation,
} from "../src/features/admin/model";
import {
  readLocalState,
  readLocalTourById,
} from "../src/features/admin/local-store";
import {
  prepareImport,
  previewDigest,
  commitExternalImport,
} from "../src/features/admin/import-engine";
import { selectTours } from "../src/features/tours/query";
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
async function measure(fn: () => unknown | Promise<unknown>, n = 5) {
  const times = [];
  for (let i = 0; i < n; i++) {
    const start = performance.now();
    await fn();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return {
    p50_ms: +times[Math.floor(n / 2)].toFixed(2),
    p95_ms: +times[Math.ceil(n * 0.95) - 1].toFixed(2),
  };
}
async function main() {
  const results = [];
  for (const count of [1000, 5000, 10000]) {
    const directory = await mkdtemp(path.join(tmpdir(), "test-scale-"));
    try {
      const tours = Array.from({ length: count }, (_, i) => {
        const country = countries[i % 13];
        return {
          ...emptyTour(randomUUID()),
          slug: `synthetic-${i}`,
          title: { ru: `ТЕСТ продукт ${i}`, en: `TEST product ${i}` },
          description: {
            ru: ["Синтетический тестовый текст."],
            en: ["Synthetic test text."],
          },
          country: country.slug as AdminTour["country"],
          location: country.destinations[0].slug,
          isDemo: true,
          status: "draft" as const,
        };
      });
      const raw = JSON.stringify({ version: 2, tours, imports: [] });
      await writeFile(path.join(directory, "tours.json"), raw);
      const publicItems = tours.map((t) => ({
        ...t,
        status: "published" as const,
      }));
      const query = {
        locale: "ru" as const,
        page: 1,
        pageSize: 24,
        search: "продукт",
        country: "thailand",
        sort: "featured" as const,
      };
      const records = tours.slice(0, Math.min(count, 5000)).map((t, i) => ({
        provider: "test_scale",
        external_product_id: `TEST-${i}`,
        source_url: `https://example.invalid/test/${i}`,
        import_status: "pending",
        last_synced_at: "2026-10-14T00:00:00Z",
        test_data: true,
        product: {
          slug: t.slug,
          country: t.country,
          location: t.location,
          category: t.category,
          title: t.title,
          description: t.description,
        },
      }));
      const content = JSON.stringify({ schema_version: 1, products: records });
      const read = await measure(() => readLocalState(directory));
      const editor = await measure(() =>
        readLocalTourById(tours[count - 1].id, directory),
      );
      const overview = await measure(async () => {
        const state = await readLocalState(directory);
        return state.tours.map((t) =>
          adminSummarySchema.parse({
            ...t,
            missing: missingInformation(t, []),
          }),
        );
      });
      const search = await measure(() =>
        selectTours(publicItems, query, false),
      );
      const pagination = await measure(() =>
        selectTours(
          publicItems,
          {
            locale: "en",
            page: Math.ceil(count / 24),
            pageSize: 24,
            sort: "featured",
          },
          false,
        ),
      );
      const importPreview = await measure(
        () => prepareImport(content, "json", taxonomy, [], true),
        3,
      );
      const importDir = path.join(directory, "test-import");
      await mkdir(importDir);
      const start = performance.now();
      await commitExternalImport(
        {
          content,
          format: "json",
          offset: 0,
          limit: 250,
          batch_id: "baseline",
          preview_digest: previewDigest(content, "json", [], 0, 250),
        },
        taxonomy,
        "synthetic-benchmark",
        importDir,
      );
      results.push({
        count,
        json_mb: +(Buffer.byteLength(raw) / 1048576).toFixed(2),
        read,
        editor,
        overview,
        search,
        pagination,
        import_rows: records.length,
        importPreview,
        first_import_batch_ms: +(performance.now() - start).toFixed(2),
        max_rss_mb: +(process.memoryUsage().rss / 1048576).toFixed(1),
      });
      console.log(JSON.stringify(results.at(-1)));
    } finally {
      if (
        !path
          .resolve(directory)
          .startsWith(path.resolve(tmpdir()) + path.sep) ||
        !path.basename(directory).startsWith("test-scale-")
      )
        throw new Error("Unsafe cleanup");
      await rm(directory, { recursive: true, force: true });
    }
  }
  await mkdir("qa/scale", { recursive: true });
  const label = process.argv[2] || "baseline";
  await writeFile(
    `qa/scale/${label}.json`,
    JSON.stringify(
      {
        recorded_at: new Date().toISOString(),
        runtime: process.version,
        synthetic_only: true,
        iterations: 5,
        results,
      },
      null,
      2,
    ),
  );
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
