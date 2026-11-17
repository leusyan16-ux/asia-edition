import test from "node:test";
import assert from "node:assert/strict";
import { KlookAdapter } from "../src/features/admin/klook-adapter";
import { prepareImport } from "../src/features/admin/import-engine";
import { localCategories } from "../src/features/admin/local-taxonomy";
import type { ExternalImportRecord } from "../src/features/admin/import-engine";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { runSavedHtmlBatch } from "../src/features/admin/klook-offline-batch";
import { performance } from "node:perf_hooks";

// In-memory labelled synthetic fixtures only; never public inventory.
const base: ExternalImportRecord = {
  provider: "klook",
  external_product_id: "999999",
  source_url: "https://www.klook.com/activity/999999-test-only/",
  import_status: "needs_review",
  last_synced_at: "2026-10-25T00:00:00Z",
  test_data: true,
  locations: [
    {
      slug: "singapore-city",
      country: "singapore",
      name: { ru: "Сингапур", en: "Singapore" },
      kind: "city",
      parent: null,
    },
  ],
  packages: [
    {
      external_package_id: "1",
      title: { ru: "ТЕСТ пакет", en: "TEST package 1" },
      description: { ru: "ТЕСТ описание", en: "TEST description" },
      prices: [],
    },
  ],
  product: {
    slug: "test-only-saved-json",
    country: "singapore",
    location: "singapore-city",
    category: "parks",
    title: { ru: "ТЕСТ", en: "TEST ONLY" },
    description: { ru: ["ТЕСТ"], en: ["SYNTHETIC ONLY"] },
  },
};
function payload() {
  return {
    success: true,
    result: {
      activity_id: 999999,
      currency_symbol: "US$",
      spu_group_info: [
        {
          group_id: 1,
          name: "TEST ONLY group",
          spu_list: [1, 2].map((spu_id) => ({
            spu_id,
            spu_name: `TEST package ${spu_id}`,
            spu_desc: "TEST description",
            spu_icon_items: [],
            price_show: { sale_price: "US$ 12.50", sale_price_value: "12.50" },
            has_stocks: true,
            best_sku_id: 1000 + spu_id,
            publish_info: {
              publish_status: 1,
              published_time_utc: "0001-01-01 00:00:00",
            },
          })),
        },
      ],
      first_spu_detail: {
        spu_basic: { spu_id: 2, spu_name: "TEST package 2" },
        icon_items: [
          {
            title: "TEST no cancellation",
            track: { name: "Cancellation_Policy" },
            description: ["TEST non-refundable"],
          },
        ],
        sections: [
          {
            title: "TEST section",
            section_type: "",
            components: [
              {
                type: "markdown",
                data: {
                  title: "TEST included",
                  props: { field_key: "aid_spu_whats_include" },
                  render_obj: [
                    {
                      content:
                        "<b>TEST included</b><script>doNotExecute()</script>",
                    },
                  ],
                },
              },
              {
                type: "image",
                data: {
                  images: [
                    {
                      image_url:
                        "https://res.klook.com/image/upload/test-only.jpg",
                      image_alt: "SYNTHETIC ONLY",
                    },
                    { image_url: "https://evil.invalid/test.jpg" },
                  ],
                },
              },
            ],
          },
        ],
      },
    },
  };
}
const adapter = new KlookAdapter();

test("900 SYNTHETIC saved responses use existing bounded batches without duplicate products", () => {
  const start = performance.now();
  let peak = process.memoryUsage().rss,
    count = 0;
  const taxonomy = {
    locations: base.locations!,
    categories: localCategories,
    operators: [],
  };
  for (let offset = 0; offset < 900; offset += 250) {
    const records = [];
    for (let n = offset; n < Math.min(offset + 250, 900); n++) {
      const id = 1000000 + n;
      const raw = payload();
      raw.result.activity_id = id;
      const input = {
        ...base,
        external_product_id: String(id),
        source_url: `https://www.klook.com/activity/${id}-test-only/`,
        product: { ...base.product, slug: `test-only-saved-json-${id}` },
      };
      records.push(
        adapter.normalizeSavedPackages(raw, input, "2026-10-25T01:00:00Z")
          .record,
      );
    }
    const content = JSON.stringify({ schema_version: 1, products: records });
    const rows = prepareImport(content, "json", taxonomy, [], true);
    assert(
      rows.every((r) => r.action === "create" && r.tour?.status === "draft"),
    );
    const replay = prepareImport(
      content,
      "json",
      taxonomy,
      rows.map((r) => r.tour!),
      true,
    );
    assert(replay.every((r) => r.action === "skip"));
    count += rows.length;
    peak = Math.max(peak, process.memoryUsage().rss);
  }
  assert.equal(count, 900);
  console.log(
    `SYNTHETIC SAVED JSON ONLY: ${count} products; ${Math.round(performance.now() - start)} ms; peak sampled process RSS ${Math.round(peak / 1048576)} MiB; batches <=250; no network/persistence`,
  );
});

test("saved Klook JSON: correct detail binding, draft import, currency/price quarantine and repeat identity", () => {
  const result = adapter.normalizeSavedPackages(
    payload(),
    base,
    "2026-10-25T01:00:00Z",
  );
  assert.equal(result.record.packages?.length, 2);
  assert.equal(result.observation.detailed_package_id, "2");
  assert.deepEqual(result.record.packages![0].inclusions, { ru: [], en: [] });
  assert.deepEqual(result.record.packages![1].inclusions, {
    ru: [],
    en: ["TEST included"],
  });
  assert.equal(result.record.packages![0].title.ru, "ТЕСТ пакет");
  assert.equal(result.record.packages![0].cancellation, null);
  assert.match(
    result.record.packages![1].cancellation!.en,
    /TEST non-refundable/,
  );
  assert.equal(result.observation.currency, "USD");
  assert.deepEqual(result.record.product.prices, []);
  assert.deepEqual(result.record.product.images, []);
  assert(result.record.packages!.every((p) => p.prices!.length === 0));
  const content = JSON.stringify({
    schema_version: 1,
    products: [result.record],
  });
  const taxonomy = {
    locations: base.locations!,
    categories: localCategories,
    operators: [],
  };
  const first = prepareImport(content, "json", taxonomy, [], true);
  assert.deepEqual(first[0].errors, []);
  const tour = first[0].tour!;
  assert.equal(tour.status, "draft");
  assert.equal(tour.externalProduct?.publication_readiness, "blocked");
  assert.equal(tour.externalProduct?.content_rights_status, "unknown");
  assert.equal(
    prepareImport(content, "json", taxonomy, [tour], true)[0].action,
    "skip",
  );
  const edited = { ...tour, title: { ru: "ТЕСТ редактор", en: "TEST editor" } };
  const changed = payload();
  changed.result.spu_group_info[0].spu_list[0].spu_desc = "TEST changed";
  const update = adapter.normalizeSavedPackages(
    changed,
    base,
    "2026-10-25T02:00:00Z",
  );
  const row = prepareImport(
    JSON.stringify([update.record]),
    "json",
    taxonomy,
    [edited],
    true,
  )[0];
  assert.equal(row.action, "update");
  assert.equal(row.tour?.id, tour.id);
  assert.equal(row.tour?.title.ru, "ТЕСТ редактор");
});

test("saved JSON rejects mismatched/unsafe IDs, failed responses, duplicate IDs, unknown detail and excluded geography", () => {
  const mismatch = payload();
  assert.throws(
    () =>
      adapter.normalizeSavedPackages(payload(), {
        ...base,
        source_url: "https://example.invalid/activity/999999-test-only/",
      }),
    /Klook activity source/,
  );
  mismatch.result.activity_id = 128;
  assert.throws(
    () => adapter.normalizeSavedPackages(mismatch, base),
    /mismatch/,
  );
  assert.throws(() =>
    adapter.normalizeSavedPackages({ ...payload(), success: false }, base),
  );
  const duplicate = payload();
  duplicate.result.spu_group_info[0].spu_list.push(
    duplicate.result.spu_group_info[0].spu_list[0],
  );
  assert.throws(
    () => adapter.normalizeSavedPackages(duplicate, base),
    /Duplicate/,
  );
  const detail = payload();
  detail.result.first_spu_detail.spu_basic.spu_id = 999;
  assert.throws(
    () => adapter.normalizeSavedPackages(detail, base),
    /Detail package/,
  );
  const unsafe = payload();
  unsafe.result.activity_id = Number.MAX_SAFE_INTEGER + 1;
  assert.throws(() => adapter.normalizeSavedPackages(unsafe, base));
  for (const country of ["japan", "south-korea", "russia"]) {
    assert.throws(
      () =>
        adapter.normalizeSavedPackages(payload(), {
          ...base,
          product: { ...base.product, country },
        }),
      /Southeast Asia/,
    );
  }
  const transit = payload();
  transit.result.spu_group_info[0].spu_list[0].spu_desc =
    "TEST transfer via Russia";
  assert.throws(
    () => adapter.normalizeSavedPackages(transit, base),
    /excluded destination/,
  );
  const unknown = payload();
  unknown.result.currency_symbol = "$";
  assert.equal(
    adapter.normalizeSavedPackages(unknown, base).observation.currency,
    null,
  );
  const changed = payload();
  changed.result.spu_group_info[0].spu_list[0].spu_name =
    "TEST different source";
  assert.equal(
    adapter.normalizeSavedPackages(changed, base).record.packages![0].title.ru,
    "",
  );
});

test("existing offline batch auto-merges a bounded sidecar once and holds corrupt/mismatched responses", async () => {
  const root = await mkdtemp(
    path.resolve("data/manual-klook-html/test-saved-packages-"),
  );
  try {
    const input = path.join(root, "input");
    await mkdir(input);
    const source = base.source_url;
    await writeFile(
      path.join(input, "test.html"),
      `<html lang="en"><head><link rel="canonical" href="${source}"><script type="application/ld+json">${JSON.stringify({ "@type": "Product", url: source, name: "TEST ONLY saved packages", description: "SYNTHETIC ONLY", address: { addressCountry: "SG", addressLocality: "Singapore" } })}</script></head><body>TEST ONLY</body></html>`,
    );
    const mapping = {
      "test.html": {
        category: "parks",
        title: { ru: "ТЕСТ" },
        description: { ru: "ТЕСТ" },
      },
    };
    const file = path.join(input, "klook-999999-packages.json");
    await writeFile(file, JSON.stringify(payload()));
    const output = path.join(root, "merged");
    const report = await runSavedHtmlBatch(input, output, mapping, {
      dataset: "synthetic",
    });
    assert.equal(report.candidates, 1);
    assert.equal(report.repeat.skipped, 1);
    const products = JSON.parse(
      await readFile(path.join(output, "products.json"), "utf8"),
    );
    assert.equal(products.products.length, 1);
    assert.equal(products.products[0].packages.length, 2);
    const observations = JSON.parse(
      (await readFile(path.join(output, "observations.jsonl"), "utf8")).trim(),
    );
    assert.equal(observations.packageJson.detailed_package_id, "2");
    for (const [name, content] of [
      ["invalid", "{"],
      [
        "mismatch",
        JSON.stringify({
          ...payload(),
          result: { ...payload().result, activity_id: 128 },
        }),
      ],
    ]) {
      await writeFile(file, content);
      const held = await runSavedHtmlBatch(
        input,
        path.join(root, name),
        mapping,
        { dataset: "synthetic" },
      );
      assert.equal(held.candidates, 0);
      assert.equal(held.failures.length, 1);
    }
  } finally {
    assert(path.basename(root).startsWith("test-saved-packages-"));
    await rm(root, { recursive: true, force: true });
  }
});
