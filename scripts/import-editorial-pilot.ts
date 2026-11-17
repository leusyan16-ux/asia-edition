import assert from "node:assert/strict";
import { readFile, mkdir, copyFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { countries } from "../src/lib/catalog";
import { localCategories } from "../src/features/admin/local-taxonomy";
import {
  localDirectory,
  readLocalState,
} from "../src/features/admin/local-store";
import {
  prepareImport,
  previewDigest,
  commitExternalImport,
  summary,
} from "../src/features/admin/import-engine";
import { isPublicLocalTour } from "../src/features/tours/local-catalog";

async function optionalFile(file: string) {
  try {
    return await readFile(file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}
async function main() {
  assert.equal(process.env.NODE_ENV, "development");
  assert.equal(process.env.ADMIN_MODE, "local");
  assert.equal(process.env.TOUR_DATA_SOURCE, "local");
  const directory = localDirectory();
  assert.equal(directory, path.resolve(".admin-local/pilot-editorial-26"));
  const rootFile = path.resolve(".admin-local/tours.json");
  const workingBefore = await optionalFile(rootFile);
  const content = await readFile(
    "data/pilots/editorial-26/products.json",
    "utf8",
  );
  const products = JSON.parse(content).products;
  assert.equal(products.length, 26);
  const before = await readLocalState(directory);
  const taxonomy = {
    locations: [
      ...countries.flatMap((c) =>
        c.destinations.map((d) => ({
          country: c.slug,
          slug: d.slug,
          name: d.name,
          kind: "destination" as const,
          parent: null,
        })),
      ),
      ...before.tours.flatMap((t) => t.externalProduct?.locations || []),
    ],
    categories: localCategories,
    operators: [],
  };
  const plan = prepareImport(content, "json", taxonomy, before.tours);
  assert.equal(
    summary(plan).failed,
    0,
    JSON.stringify(plan.filter((r) => r.errors.length)),
  );
  assert.equal(
    summary(plan).updated,
    0,
    "Source changes require a separate review; existing content is not overwritten by this pilot loader.",
  );
  await mkdir(directory, { recursive: true });
  const files = ["tours.json", "sources.json", "sources.csv"];
  const existing = [];
  for (const name of files)
    if (await optionalFile(path.join(directory, name))) existing.push(name);
  let backup: string | null = null;
  if (existing.length) {
    backup = path.join(
      directory,
      "backups",
      new Date().toISOString().replace(/[:.]/g, "-") + "-" + randomUUID(),
    );
    await mkdir(backup, { recursive: true });
    for (const name of existing)
      await copyFile(
        path.join(directory, name),
        path.join(backup, name),
        constants.COPYFILE_EXCL,
      );
  }
  for (const name of ["sources.json", "sources.csv"]) {
    const source = await readFile(path.join("data/pilots/editorial-26", name));
    const old = await optionalFile(path.join(directory, name));
    if (old)
      assert.ok(
        old.equals(source),
        "Existing source registry differs; do not overwrite it.",
      );
    else await writeFile(path.join(directory, name), source, { flag: "wx" });
  }
  const log = await commitExternalImport(
    {
      content,
      format: "json",
      offset: 0,
      limit: 26,
      batch_id: "editorial-pilot-approved-" + randomUUID(),
      preview_digest: previewDigest(content, "json", before.tours, 0, 26),
    },
    taxonomy,
    "user-approved-stage-5",
    directory,
  );
  assert.equal(log.failed, 0);
  const state = await readLocalState(directory);
  const ids = new Set(
    products.map((p: { external_product_id: string }) => p.external_product_id),
  );
  const tours = state.tours.filter(
    (t) =>
      t.externalProduct?.provider === "asia_edition_editorial" &&
      ids.has(t.externalProduct.external_product_id),
  );
  assert.equal(tours.length, 26);
  for (const t of tours) {
    const p = products.find(
      (p: { external_product_id: string }) =>
        p.external_product_id === t.externalProduct!.external_product_id,
    );
    assert.equal(t.status, "draft");
    assert.equal(isPublicLocalTour(t), false);
    assert.deepEqual(t.title, p.product.title);
    assert.deepEqual(t.description, p.product.description);
    for (const key of ["country", "city", "location", "category"] as const)
      assert.equal(t[key], p.product[key]);
    assert.equal(t.externalProduct!.source_url, p.source_url);
    assert.equal(t.durationMinutes, null);
    assert.deepEqual(t.images, []);
    assert.deepEqual(t.prices, []);
    assert.deepEqual(t.availability, []);
    assert.equal(t.bookingConditions, null);
    assert.equal(t.cancellation, null);
  }
  for (const original of before.tours) {
    if (
      !original.externalProduct ||
      !ids.has(original.externalProduct.external_product_id)
    )
      assert.deepEqual(
        state.tours.find((t) => t.id === original.id),
        original,
      );
  }
  assert.deepEqual(
    await optionalFile(rootFile),
    workingBefore,
    "Working catalog changed unexpectedly",
  );
  const repeat = summary(prepareImport(content, "json", taxonomy, state.tours));
  assert.deepEqual(repeat, { created: 0, updated: 0, skipped: 26, failed: 0 });
  const report = {
    executed_at: new Date().toISOString(),
    storage: path.join(directory, "tours.json"),
    before_records: before.tours.length,
    created: log.created,
    skipped: log.skipped,
    errors: log.failed,
    editorial_cards: 26,
    published: 0,
    backup,
    source_registry_copied: true,
    text_and_taxonomy_preserved: true,
    working_catalog_unchanged: true,
    working_catalog_sha256: workingBefore
      ? createHash("sha256").update(workingBefore).digest("hex")
      : null,
    repeat_preview: repeat,
    tours: tours.map((t) => ({
      id: t.id,
      slug: t.slug,
      title: t.title,
      country: t.country,
      city: t.city,
      category: t.category,
      status: t.status,
      editor_url: "/admin/tours/" + t.id,
    })),
  };
  await writeFile(
    path.join(directory, "import-report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify({ ...report, tours: undefined }, null, 2));
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
