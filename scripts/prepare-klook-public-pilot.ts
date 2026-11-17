// Converts a small, explicitly observed public-page study using the existing importer.
// No network, no crawler, no active catalog writes, no publication permissions.
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { prepareImport, summary } from "../src/features/admin/import-engine";
import { localCategories } from "../src/features/admin/local-taxonomy";
async function main() {
  const root = "data/pilots/klook-public-12";
  const observations = JSON.parse(
    await readFile(`${root}/observations.json`, "utf8"),
  );
  const products = observations.products.map(
    (row: (string | number | null)[]) => {
      const [id, slug, en, ru, category, type, descriptionRu, descriptionEn] =
        row;
      const title = { ru, en },
        description = { ru: [descriptionRu], en: [descriptionEn] };
      return {
        provider: "klook",
        external_product_id: id,
        source_url: `https://www.klook.com/en-US/activity/${id}-${slug}/`,
        import_status: "needs_review",
        last_synced_at: observations.observed_at,
        test_data: false,
        product_type: type,
        packages: [],
        locations: [
          {
            slug: "singapore-city",
            country: "singapore",
            name: { ru: "Сингапур", en: "Singapore" },
            kind: "city",
            parent: null,
          },
        ],
        product: {
          slug: `klook-${id}-${slug}`,
          country: "singapore",
          city: "singapore-city",
          location: "singapore-city",
          category,
          title,
          summary: { ru: descriptionRu, en: descriptionEn },
          description,
          timezone: "Asia/Singapore",
          durationMinutes: null,
          images: [],
          prices: [],
          availability: [],
          seo: { title, description: { ru: descriptionRu, en: descriptionEn } },
        },
      };
    },
  );
  const content = JSON.stringify({ schema_version: 1, products }, null, 2);
  const taxonomy = {
    locations: [
      {
        slug: "singapore-city",
        country: "singapore",
        name: { ru: "Сингапур", en: "Singapore" },
        kind: "city" as const,
        parent: null,
      },
    ],
    categories: localCategories,
    operators: [],
  };
  const rows = prepareImport(content, "json", taxonomy, []);
  assert.deepEqual(summary(rows), {
    created: 12,
    updated: 0,
    skipped: 0,
    failed: 0,
  });
  assert.deepEqual(
    summary(
      prepareImport(
        content,
        "json",
        taxonomy,
        rows.map((r) => r.tour!),
      ),
    ),
    { created: 0, updated: 0, skipped: 12, failed: 0 },
  );
  for (const row of rows) {
    assert.equal(row.tour!.status, "draft");
    assert.equal(row.tour!.externalProduct!.editorial_status, "pending");
    assert.equal(row.tour!.externalProduct!.content_rights_status, "unknown");
    assert.equal(row.tour!.externalProduct!.publication_readiness, "blocked");
    assert.deepEqual(row.tour!.prices, []);
  }
  await writeFile(`${root}/products.json`, content, { flag: "wx" });
  await writeFile(
    `${root}/validation-report.json`,
    JSON.stringify(
      {
        observed_at: observations.observed_at,
        source: observations.access,
        products: 12,
        countries: ["singapore"],
        initial: summary(rows),
        repeat: { created: 0, updated: 0, skipped: 12, failed: 0 },
        draft_only: true,
        ready_for_publication: 0,
        photo_head_checked: 3,
        photos_downloaded: 0,
        direct_http_status: 403,
        live_prices_verified: 0,
        active_catalog_modified: false,
      },
      null,
      2,
    ),
    { flag: "wx" },
  );
  console.log(
    "12 real indexed-source drafts validated; repeat import skips all 12. No active store or public snapshot modified.",
  );
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
