import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { prepareImport, summary } from "../src/features/admin/import-engine";
import { localCategories } from "../src/features/admin/local-taxonomy";
test("Klook public-page study: 12 genuine-source drafts, cached prices isolated, no duplicate replay", async () => {
  const content = await readFile(
    "data/pilots/klook-public-12/products.json",
    "utf8",
  );
  const observation = JSON.parse(
    await readFile("data/pilots/klook-public-12/observations.json", "utf8"),
  );
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
  for (const row of rows) {
    const t = row.tour!;
    assert.equal(t.status, "draft");
    assert.equal(t.isDemo, false);
    assert.deepEqual(t.prices, []);
    assert.deepEqual(t.availability, []);
    assert.deepEqual(t.images, []);
    assert.equal(t.durationMinutes, null);
    assert.equal(t.externalProduct!.provider, "klook");
    assert.equal(t.externalProduct!.content_rights_status, "unknown");
    assert.equal(t.externalProduct!.publication_readiness, "blocked");
    assert.equal(t.externalProduct!.editorial_status, "pending");
    const id = t.externalProduct!.external_product_id;
    assert(observation.products.some((p: unknown[]) => p[0] === id));
    assert.equal(
      new URL(t.externalProduct!.source_url).hostname,
      "www.klook.com",
    );
  }
  assert.equal(observation.direct_http_test.product_status, 403);
  assert.equal(observation.direct_http_test.stopped_on_denial, true);
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
});
test("static CLI entrypoints run under package CommonJS conventions and fail safely without inputs", () => {
  for (const file of [
    "scripts/prepare-public-feed.ts",
    "scripts/export-static-catalog.ts",
  ]) {
    const result = spawnSync(process.execPath, ["--import", "tsx", file], {
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Usage:/);
    assert(!result.stderr.includes("Top-level await"));
  }
});
