import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { countries } from "../src/lib/catalog";
import { localCategories } from "../src/features/admin/local-taxonomy";
import {
  prepareImport,
  commitExternalImport,
  previewDigest,
  summary,
} from "../src/features/admin/import-engine";
import {
  readLocalState,
  readLocalTours,
  saveLocalBatch,
} from "../src/features/admin/local-store";
import { KlookAdapter } from "../src/features/admin/klook-adapter";
import { adminTourSchema } from "../src/features/admin/model";
import { demoTour } from "../src/features/tours/demo";
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
async function fixture() {
  return readFile("tests/fixtures/external-products.test.json", "utf8");
}
const cleanup = async (dir: string) => {
  assert.ok(path.resolve(dir).startsWith(path.resolve(tmpdir()) + path.sep));
  await rm(dir, { recursive: true, force: true });
};
test("external imports: CSV/JSON, regional countries, identity errors, test isolation and no invented commerce", async () => {
  const source = await fixture();
  const rows = prepareImport(source, "json", taxonomy, [], true);
  assert.deepEqual(summary(rows), {
    created: 2,
    updated: 0,
    skipped: 0,
    failed: 0,
  });
  assert.equal(rows[0].tour?.status, "draft");
  assert.equal(rows[0].tour?.externalProduct?.import_status, "needs_review");
  assert.deepEqual(rows[0].tour?.prices, []);
  assert.deepEqual(rows[0].tour?.slots, []);
  assert.equal(rows[0].tour?.externalProduct?.commercial.packages.length, 1);
  assert.ok(
    prepareImport(source, "json", taxonomy, [], false).every(
      (r) => r.errors.length,
    ),
  );
  assert.equal(
    prepareImport(
      await readFile("tests/fixtures/external-products.test.csv", "utf8"),
      "csv",
      taxonomy,
      [],
      true,
    )[0].action,
    "create",
  );
  const parsed = JSON.parse(source);
  const base = parsed.products[0];
  for (const country of countries) {
    const item = {
      ...base,
      external_product_id: "TEST-" + country.slug,
      locations: country.destinations.length ? [] : [{slug:`test-city-${country.slug}`,country:country.slug,name:{ru:"ТЕСТ",en:"TEST"},kind:"city",parent:null}],
      product: {
        ...base.product,
        country: country.slug,
        location: country.destinations[0]?.slug ?? `test-city-${country.slug}`,
        slug: "test-" + country.slug,
      },
    };
    assert.equal(
      prepareImport(JSON.stringify([item]), "json", taxonomy, [], true)[0]
        .action,
      "create",
    );
  }
  assert.equal(
    prepareImport(JSON.stringify([base, base]), "json", taxonomy, [], true)[1]
      .action,
    "error",
  );
  for (const field of [
    "provider",
    "external_product_id",
    "source_url",
    "import_status",
    "last_synced_at",
  ]) {
    const invalid = { ...base };
    delete invalid[field];
    assert.equal(
      prepareImport(JSON.stringify([invalid]), "json", taxonomy, [], true)[0]
        .action,
      "error",
    );
  }
  assert.equal(
    prepareImport(
      JSON.stringify([
        { ...base, product: { ...base.product, country: "egypt" } },
      ]),
      "json",
      taxonomy,
      [],
      true,
    )[0].action,
    "error",
  );
  assert.equal(
    prepareImport(
      JSON.stringify([{ ...base, source_url: "javascript:alert(1)" }]),
      "json",
      taxonomy,
      [],
      true,
    )[0].action,
    "error",
  );
  assert.equal(
    prepareImport(
      JSON.stringify([
        { ...base, packages: [base.packages[0], base.packages[0]] },
      ]),
      "json",
      taxonomy,
      [],
      true,
    )[0].action,
    "error",
  );
  const city = {
    slug: "test-only-city",
    country: "thailand",
    name: { ru: "ТЕСТ ГОРОД", en: "TEST CITY" },
    kind: "city",
  };
  assert.equal(
    prepareImport(
      JSON.stringify([
        {
          ...base,
          locations: [city],
          product: { ...base.product, city: city.slug },
        },
      ]),
      "json",
      taxonomy,
      [],
      true,
    )[0].action,
    "create",
  );
  await assert.rejects(new KlookAdapter().normalize({}));
});
test("external import: atomic journals, repeat import, editorial preservation, stale preview, older snapshots, replay and legacy storage", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "test-external-"));
  try {
    const manual = adminTourSchema.parse({
      ...demoTour,
      id: crypto.randomUUID(),
      slug: "test-existing-manual",
      status: "draft",
    });
    await writeFile(path.join(dir, "tours.json"), JSON.stringify([manual]));
    const content = await fixture();
    async function commit(
      text = content,
      batch_id = crypto.randomUUID(),
      offset = 0,
      limit = 250,
      token?: string,
    ) {
      const state = await readLocalState(dir);
      return commitExternalImport(
        {
          content: text,
          format: "json",
          offset,
          limit,
          batch_id,
          preview_digest:
            token || previewDigest(text, "json", state.tours, offset, limit),
        },
        taxonomy,
        "TEST ADMIN",
        dir,
      );
    }
    const first = await commit(content, "batch-first");
    assert.equal(first.created, 2);
    const state = await readLocalState(dir);
    assert.equal(state.tours.length, 3);
    assert.equal(state.imports.length, 1);
    assert.equal(state.tours[0].slug, manual.slug);
    const replay = await commit(content, "batch-first");
    assert.equal(replay.id, first.id);
    assert.equal((await readLocalState(dir)).imports.length, 1);
    await assert.rejects(commit(content + " ", "batch-first"));
    const second = await commit();
    assert.equal(second.skipped, 2);
    assert.equal((await readLocalTours(dir)).length, 3);
    let imported = (await readLocalTours(dir)).find(
      (t) => t.externalProduct?.external_product_id === "TEST-001",
    )!;
    [imported] = await saveLocalBatch(
      [
        {
          ...imported,
          title: { ru: "ТЕСТ — РЕДАКЦИЯ", en: "TEST EDITORIAL" },
          summary: { ru: "ТЕСТ ПРАВКА", en: "TEST EDIT" },
          status: "draft",
        },
      ],
      { [imported.id]: imported.updatedAt },
      dir,
    );
    const changed = JSON.parse(content);
    changed.products[0].product.title = {
      ru: "ТЕСТ — ИСТОЧНИК V2",
      en: "TEST SOURCE V2",
    };
    changed.products[0].last_synced_at = "2026-10-14T01:00:00Z";
    const updated = await commit(JSON.stringify(changed));
    assert.equal(updated.updated, 1);
    assert.equal(updated.skipped, 1);
    imported = (await readLocalTours(dir)).find((t) => t.id === imported.id)!;
    assert.equal(imported.title.en, "TEST EDITORIAL");
    assert.equal(imported.externalProduct?.facts.title.en, "TEST SOURCE V2");
    assert.equal(imported.status, "draft");
    assert.equal(
      prepareImport(
        content,
        "json",
        taxonomy,
        await readLocalTours(dir),
        true,
      )[0].action,
      "error",
    );
    const stale = previewDigest(
      JSON.stringify(changed),
      "json",
      await readLocalTours(dir),
      0,
      250,
    );
    await saveLocalBatch(
      [{ ...imported, summary: { ru: "ТЕСТ ПОЗЖЕ", en: "TEST LATER" } }],
      { [imported.id]: imported.updatedAt },
      dir,
    );
    await assert.rejects(
      commit(JSON.stringify(changed), crypto.randomUUID(), 0, 250, stale),
    );
    const invalid = JSON.parse(JSON.stringify(changed));
    invalid.products.push({
      ...invalid.products[0],
      external_product_id: "TEST-BAD",
      product: { ...invalid.products[0].product, country: "egypt" },
    });
    const before = await readLocalTours(dir);
    const rejected = await commit(JSON.stringify(invalid));
    assert.equal(rejected.status, "rejected");
    assert.equal(rejected.failed, 1);
    assert.deepEqual(await readLocalTours(dir), before);
    const forbidden = {
      ...imported,
      externalProduct: {
        ...imported.externalProduct!,
        external_product_id: "CHANGED",
      },
    };
    await assert.rejects(
      saveLocalBatch([forbidden], { [imported.id]: imported.updatedAt }, dir),
    );
  } finally {
    await cleanup(dir);
  }
});
test("external import: large file chunks remain idempotent and unpriced", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "test-external-scale-"));
  try {
    const base = JSON.parse(await fixture()).products[1];
    const products = Array.from({ length: 260 }, (_, i) => ({
      ...base,
      external_product_id: "TEST-SCALE-" + i,
      product: { ...base.product, slug: "test-scale-" + i },
    }));
    const content = JSON.stringify(products);
    for (const offset of [0, 250]) {
      const tours = await readLocalTours(dir);
      const limit = Math.min(250, 260 - offset);
      const log = await commitExternalImport(
        {
          content,
          format: "json",
          offset,
          limit,
          batch_id: "scale-" + offset,
          preview_digest: previewDigest(content, "json", tours, offset, limit),
        },
        taxonomy,
        "TEST ADMIN",
        dir,
      );
      assert.equal(log.created, limit);
    }
    const state = await readLocalState(dir);
    assert.equal(state.tours.length, 260);
    assert.equal(state.imports.length, 2);
    assert.ok(
      state.tours.every((t) => t.status === "draft" && t.prices.length === 0),
    );
  } finally {
    await cleanup(dir);
  }
});
