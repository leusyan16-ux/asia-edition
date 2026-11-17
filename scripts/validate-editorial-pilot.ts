import { isAllowedCountry } from "../src/lib/geography";
import { parseCSV } from "../src/features/admin/csv";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { allCountries as countries } from "../src/lib/catalog";
import { localCategories } from "../src/features/admin/local-taxonomy";
import {
  prepareImport,
  previewDigest,
  commitExternalImport,
  summary,
  digest,
} from "../src/features/admin/import-engine";
import { readLocalState } from "../src/features/admin/local-store";

const root = path.resolve("data/pilots/editorial-26");
const taxonomy = {
  locations: countries.flatMap((c) =>
    c.destinations.map((d) => ({
      country: c.slug,
      slug: d.slug,
      name: d.name,
      kind: "destination" as const,
      parent: null,
    })),
  ),
  categories: localCategories,
  operators: [],
};

export async function validateEditorialPilot() {
  let json = await readFile(path.join(root, "products.json"), "utf8");
  let csv = await readFile(path.join(root, "products.csv"), "utf8");
  const registry = JSON.parse(
    await readFile(path.join(root, "sources.json"), "utf8"),
  );
  const products = JSON.parse(json).products;
  assert.equal(products.length, 26);
  assert.equal(registry.records.length, 26);
  const counts: Record<string, number> = {};
  for (const p of products) {
    counts[p.product.country] = (counts[p.product.country] || 0) + 1;
    const source = registry.records.find(
      (s: { external_product_id: string }) =>
        s.external_product_id === p.external_product_id,
    );
    assert.ok(source);
    assert.equal(source.publication_status, "draft");
    assert.equal(source.checked_on, "2026-10-14");
    assert.ok(
      source.sources.some((s: { url: string }) => s.url === p.source_url),
    );
    assert.equal(p.provider, "asia_edition_editorial");
    assert.equal(p.import_status, "needs_review");
    assert.equal(p.test_data, false);
    assert.equal(p.packages.length, 0);
    assert.ok(p.product.title.ru && p.product.title.en);
    assert.equal(p.product.durationMinutes, null);
    for (const field of [
      "images",
      "prices",
      "availability",
      "departures",
      "slots",
      "itinerary",
      "faq",
    ])
      assert.equal(p.product[field].length, 0);
    for (const field of [
      "meeting",
      "pickup",
      "cancellation",
      "bookingConditions",
    ])
      assert.equal(p.product[field], null);
    for (const field of ["inclusions", "exclusions"])
      assert.deepEqual(p.product[field], { ru: [], en: [] });
  }
  assert.deepEqual(
    Object.keys(counts).sort(),
    // Historical pilot intentionally retains its original 13-country scope.
    countries.filter((c) => c.slug !== "singapore").map((c) => c.slug).sort(),
  );
  assert.ok(Object.values(counts).every((n) => n === 2));
  const regional = products.filter((p: {product:{country:string}}) => isAllowedCountry(p.product.country));
  const n = regional.length;
  const allPlan = prepareImport(json, "json", taxonomy, []);
  assert.equal(allPlan.filter((r) => r.action === "error").length, 26 - n);
  json = JSON.stringify({schema_version:1, products:regional});
  const csvRows = parseCSV(csv);
  const header = csvRows.shift()!;
  const countryIndex = header.indexOf("country");
  csv = [header, ...csvRows.filter((r) => isAllowedCountry(r[countryIndex]))].map((r) => r.map((v) => '"'+v.replaceAll('"','""')+'"').join(",")).join("\r\n");
  const plan = prepareImport(json, "json", taxonomy, []);
  const csvPlan = prepareImport(csv, "csv", taxonomy, []);
  const expected = { created: n, updated: 0, skipped: 0, failed: 0 };
  assert.deepEqual(
    summary(plan),
    expected,
    JSON.stringify(plan.filter((r) => r.errors.length)),
  );
  assert.deepEqual(
    summary(csvPlan),
    expected,
    JSON.stringify(csvPlan.filter((r) => r.errors.length)),
  );
  for (let i = 0; i < n; i++)
    assert.equal(
      plan[i].tour!.externalProduct!.fingerprint,
      csvPlan[i].tour!.externalProduct!.fingerprint,
      `CSV/JSON mismatch: row ${i + 1}`,
    );
  // Negative test: duplicate identities in one file must be rejected, never silently overwritten.
  assert.equal(
    prepareImport(
      JSON.stringify([products[0], products[0]]),
      "json",
      taxonomy,
      [],
    )[1].action,
    "error",
  );
  // Simulate persistence only in a new OS temporary directory, never an ADMIN_LOCAL_DIRECTORY.
  const directory = await mkdtemp(path.join(tmpdir(), "ae-editorial-pilot-"));
  try {
    const apply = async (
      content: string,
      format: "json" | "csv",
      batch_id: string,
    ) => {
      const state = await readLocalState(directory);
      return commitExternalImport(
        {
          content,
          format,
          batch_id,
          offset: 0,
          limit: n,
          preview_digest: previewDigest(content, format, state.tours, 0, n),
        },
        taxonomy,
        "isolated-pilot-validation",
        directory,
      );
    };
    const first = await apply(json, "json", "pilot-validation-first");
    assert.equal(first.created, n);
    assert.equal(first.failed, 0);
    const original = await readLocalState(directory);
    const edited = {
      ...original.tours[0],
      title: {
        ru: "Редакционная правка для проверки",
        en: "Editorial change for validation",
      },
    };
    // Reimport must preserve an existing editorial title (in-memory planning, no working catalog).
    const editorialPlan = prepareImport(json, "json", taxonomy, [
      edited,
      ...original.tours.slice(1),
    ]);
    assert.equal(editorialPlan[0].tour!.title.ru, edited.title.ru);
    const second = await apply(json, "json", "pilot-validation-second");
    const crossFormat = await apply(csv, "csv", "pilot-validation-csv");
    for (const log of [second, crossFormat]) {
      assert.equal(log.skipped, n);
      assert.equal(log.created, 0);
      assert.equal(log.updated, 0);
      assert.equal(log.failed, 0);
    }
    const state = await readLocalState(directory);
    assert.equal(state.tours.length, n);
    assert.deepEqual(
      state.tours.map((t) => t.id),
      original.tours.map((t) => t.id),
    );
    assert.ok(
      state.tours.every(
        (t) =>
          t.status === "draft" &&
          t.verifiedAt === null &&
          t.images.length === 0 &&
          t.prices.length === 0,
      ),
    );
    assert.equal(state.tours.filter((t) => t.status === "published").length, 0);
    return {
      checked_at: new Date().toISOString(),
      profile: "editorial-26",
      source_records: 26,
      excluded_by_current_region: 26 - n,
      mode: "temporary_store_simulation_only",
      json_sha256: digest(json),
      csv_sha256: digest(csv),
      countries: counts,
      json_preview: summary(plan),
      csv_preview: summary(csvPlan),
      first_simulation: { created: first.created, failed: first.failed },
      json_reimport: {
        created: second.created,
        updated: second.updated,
        skipped: second.skipped,
        failed: second.failed,
      },
      csv_reimport: {
        created: crossFormat.created,
        updated: crossFormat.updated,
        skipped: crossFormat.skipped,
        failed: crossFormat.failed,
      },
      remaining_records: state.tours.length,
      published: 0,
      editorial_preservation: true,
      duplicate_rejected: true,
      working_catalog_written: false,
      remote_services_accessed: false,
    };
  } finally {
    assert.ok(
      path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep),
    );
    assert.ok(path.basename(directory).startsWith("ae-editorial-pilot-"));
    await rm(directory, { recursive: true, force: true });
  }
}

async function main() {
  const report = await validateEditorialPilot();
  await writeFile(
    path.join(root, "validation-report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve("scripts/validate-editorial-pilot.ts")
) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
