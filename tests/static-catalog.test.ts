import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { prepareImport } from "../src/features/admin/import-engine";
import { countries } from "../src/lib/catalog";
import { localCategories } from "../src/features/admin/local-taxonomy";
import {
  compileStaticCatalog,
  publicationDigest,
  staticCatalogRepository,
} from "../src/features/tours/static-catalog";
import { parseQuery, selectTours } from "../src/features/tours/query";
import type { Tour } from "../src/features/tours/model";
test("base price filters and sorting include the public information price projection", async () => {
  const source = JSON.parse(await readFile("src/features/tours/published-catalog.json", "utf8"));
  const base = source.records[0].tour as Tour;
  const tours = [
    { ...base, slug: "higher", previewPrice: { amount: 90 } },
    { ...base, slug: "lower", previewPrice: { amount: 40 } },
  ];
  const result = selectTours(tours, {
    locale:"ru",currency:"USD",page:1,pageSize:9,minPrice:30,maxPrice:100,sort:"price-asc",
  }, false);
  assert.equal(result.total,2);
  assert.deepEqual(result.items.map(tour=>tour.slug),["lower","higher"]);
});
const taxonomy = {
  locations: countries.flatMap((c) =>
    c.destinations.map((d) => ({ ...d, country: c.slug })),
  ),
  categories: localCategories,
  operators: [],
};
async function fixture() {
  const rows = prepareImport(
    await readFile("tests/fixtures/external-products.test.json", "utf8"),
    "json",
    taxonomy,
    [],
    true,
  );
  const t = structuredClone(rows.find((r) => r.tour)?.tour);
  assert(t?.externalProduct);
  // Isolated test fixture only. Never written to an active catalog or snapshot.
  t.status = "published";
  t.isDemo = false;
  t.verifiedAt = "2026-10-24T00:00:00Z";
  Object.assign(t.externalProduct, {
    test_data: false,
    source_status: "active",
    editorial_status: "approved",
    content_rights_status: "licensed",
    publication_readiness: "ready",
    rights_evidence: "https://example.invalid/test-only-evidence",
  });
  t.images = [{ url: "/images/thailand.jpg", alt: { ru: "Тест", en: "Test" } }];
  t.prices = [
    {
      currency: "USD",
      adult: 10,
      child: null,
      childMinAge: null,
      childMaxAge: null,
      verifiedAt: "2026-10-24T00:00:00Z",
      validFrom: "2026-10-24",
      validUntil: "2026-10-26",
    },
  ];
  return t;
}
const now = new Date("2026-10-25T12:00:00Z");

test("static export: geography approval cannot authorize an excluded country or Russian transit", async () => {
  for (const change of [
    { country: "japan" as const },
    { routeCountries: ["thailand", "russia"] },
    { itinerary: [{title:{ru:"Транзит через РФ",en:"Transit through Russia"},description:{ru:"ТЕСТ",en:"TEST"},durationMinutes:null}] },
  ]) {
    const t = {...await fixture(), ...change};
    const review = {digest:publicationDigest(t),publicationApproved:true,imagesApproved:true,geographyApproved:true};
    const result = compileStaticCatalog([t],[review],taxonomy,now);
    assert.equal(result.snapshot.records.length,0);
    assert.match(result.rejected[0].reason,/Geography/);
  }
});
test("static export: explicit consent, deduplication, no private metadata, no booking slots", async () => {
  const t = await fixture(),
    review = {
      digest: publicationDigest(t),
      publicationApproved: true,
      imagesApproved: true,
      geographyApproved: true,
    };
  assert.equal(compileStaticCatalog([t], [], taxonomy, now).rejected.length, 1);
  const result = compileStaticCatalog([t, t], [review], taxonomy, now);
  assert.equal(result.snapshot.records.length, 1);
  assert.equal(result.rejected.length, 1);
  assert(!JSON.stringify(result.snapshot).includes("rights_evidence"));
  assert(!JSON.stringify(result.snapshot).includes("external_product_id"));
  assert.deepEqual(result.snapshot.records[0].tour.availability, []);
  for (const changes of [
    { status: "draft" },
    { archived: true },
    { visible: false },
    { isDemo: true },
    { title: { ru: "Изменено", en: "Changed" } },
    { images: [{ url: "/images/admin/private.jpg", alt: t.title }] },
  ])
    assert.equal(
      compileStaticCatalog([{ ...t, ...changes }], [review], taxonomy, now)
        .snapshot.records.length,
      0,
    );
  for (const changes of [
    { test_data: true },
    { source_status: "missing" },
    { editorial_status: "pending" },
    { content_rights_status: "restricted" },
    { publication_readiness: "blocked" },
    { rights_evidence: null },
  ]) {
    const changed = {
      ...t,
      externalProduct: { ...t.externalProduct, ...changes },
    };
    assert.equal(
      compileStaticCatalog(
        [changed],
        [{ ...review, digest: publicationDigest(changed) }],
        taxonomy,
        now,
      ).snapshot.records.length,
      0,
    );
  }
});
test("static catalog: 900 isolated fixtures, filters, RU/EN, pagination, expired prices and details", async () => {
  const t = await fixture();
  const documents = Array.from({ length: 900 }, (_, i) => ({
    ...t,
    id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    slug: `isolated-test-${i}`,
    externalProduct: {
      ...t.externalProduct!,
      external_product_id: `isolated-${i}`,
    },
  }));
  const reviews = documents.map((d) => ({
    digest: publicationDigest(d),
    publicationApproved: true,
    imagesApproved: true,
      geographyApproved: true,
  }));
  const result = compileStaticCatalog(documents, reviews, taxonomy, now);
  assert.equal(result.rejected.length, 0);
  assert.equal(result.snapshot.records.length, 900);
  const repo = staticCatalogRepository(result.snapshot, now);
  for (const locale of ["ru", "en"] as const) {
    const page = await repo.list({
      ...parseQuery(
        { country: t.country, category: t.category, search: t.title[locale] },
        locale,
      ),
      page: 2,
    });
    assert.equal(page.total, 900);
    assert.equal(page.items.length, 9);
  }
  assert.equal((await repo.bySlug("isolated-test-5"))?.prices.length, 1);
  assert.equal(
    (
      await staticCatalogRepository(
        result.snapshot,
        new Date("2026-10-27"),
      ).bySlug("isolated-test-5")
    )?.prices.length,
    0,
  );
  assert.equal(await repo.bySlug("draft-does-not-exist"), null);
  const empty = staticCatalogRepository({
    version: 1,
    taxonomy: { locations: [], categories: [] },
    records: [],
  });
  assert.deepEqual((await empty.taxonomy()).locations, []);
});
