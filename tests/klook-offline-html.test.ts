import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import {
  parseKlookSavedHtml,
  MAX_SAVED_HTML_BYTES,
} from "../src/features/admin/klook-offline-html";
import { prepareImport } from "../src/features/admin/import-engine";
import { localCategories } from "../src/features/admin/local-taxonomy";
const source = "https://www.klook.com/en-US/activity/999999-test-fixture/";
const mapping = {
  category: "tickets",
  location: {
    slug: "singapore-city",
    name: { ru: "Сингапур", en: "Singapore" },
  },
  title: { ru: "СИНТЕТИЧЕСКИЙ ТЕСТ" },
  description: { ru: "Синтетический HTML для теста, не реальный продукт." },
};
function html(extra = "", overrides = {}) {
  return `<!doctype html><html lang="en-US"><head><link rel="canonical" href="${source}"><meta property="og:image" content="https://res.klook.com/image/upload/test-only.jpg"><script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "Product", url: source, name: "SYNTHETIC HTML TEST ONLY", description: "Test <b>only</b> &amp; not real.", category: "Tickets", duration: "PT2H", address: { addressCountry: "SG", addressLocality: "Singapore", streetAddress: "TEST ADDRESS" }, image: [{ url: "https://res.klook.com/image/upload/test-only.jpg" }, "https://res.klook.com/image/upload/PartnerAward.png"], offers: [{ "@type": "Offer", name: "TEST package", sku: "TEST-SKU", price: "12.50", priceCurrency: "USD", priceValidUntil: "2026-10-26" }], ...overrides })}</script></head><body><h1>TEST</h1><h2>Packages</h2><h3>TEST package A</h3><p>US$ 12.50</p><h2>About</h2>${extra}</body></html>`;
}
test("offline HTML: source facts, offers/images held separately, existing importer retains draft/review gates", () => {
  const result = parseKlookSavedHtml(html(), mapping, "2026-10-25T00:00:00Z");
  assert(result.record);
  assert.equal(result.observation.external_product_id, "999999");
  assert.equal(result.observation.country, "singapore");
  assert.equal(result.observation.city, "Singapore");
  assert.equal(result.observation.duration, "PT2H");
  assert.deepEqual(result.observation.packageNames, ["TEST package A"]);
  assert.equal(result.observation.offers[0].price, "12.50");
  assert.equal(result.observation.offers[0].verified, false);
  assert.equal(result.observation.imageCandidates.length, 1);
  assert.equal(result.observation.description, "Test only & not real.");
  const taxonomy = {
    locations: result.record.locations!,
    categories: localCategories,
    operators: [],
  };
  const content = JSON.stringify({
    schema_version: 1,
    products: [result.record],
  });
  const rows = prepareImport(content, "json", taxonomy, []);
  assert.equal(rows[0].action, "create");
  const tour = rows[0].tour!;
  assert.equal(tour.status, "draft");
  assert.deepEqual(tour.prices, []);
  assert.deepEqual(tour.images, []);
  assert.deepEqual(tour.availability, []);
  assert.equal(tour.durationMinutes, null);
  assert.equal(tour.externalProduct!.content_rights_status, "unknown");
  assert.equal(tour.externalProduct!.publication_readiness, "blocked");
  assert.equal(
    prepareImport(content, "json", taxonomy, [tour])[0].action,
    "skip",
  );
});
test("offline HTML: no guessed translations/geography, untrusted scripts never executed, malformed JSON-LD tolerated", () => {
  const incomplete = parseKlookSavedHtml(
    html(
      '<script>throw new Error("must never execute")</script><script type="application/ld+json">{bad}</script>',
    ),
  );
  assert.equal(incomplete.record, null);
  assert(incomplete.observation.missing.includes("Russian title"));
  assert(incomplete.observation.warnings.some((w) => w.includes("Malformed")));
  assert.throws(
    () => parseKlookSavedHtml(html(), { ...mapping, country: "japan" }),
    /disagrees/,
  );
  assert.throws(
    () => parseKlookSavedHtml(html(), { ...mapping, locale: "ru" }),
    /locale disagrees/,
  );
  assert.throws(
    () =>
      parseKlookSavedHtml(html(), {
        source_url: "https://www.klook.com/activity/123-other/",
      }),
    /Conflicting/,
  );
  assert.throws(
    () =>
      parseKlookSavedHtml("<title>Access denied</title>", {
        source_url: source,
      }),
    /Challenge/,
  );
  assert.throws(
    () =>
      parseKlookSavedHtml("<title>klook.com</title>", { source_url: source }),
    /No product title/,
  );
  assert.throws(
    () =>
      parseKlookSavedHtml("<title>Test</title>", {
        source_url: "https://www.klook.com.evil.invalid/activity/123-test/",
      }),
    /No valid/,
  );
  assert.throws(
    () => parseKlookSavedHtml("x".repeat(MAX_SAVED_HTML_BYTES + 1)),
    /16 MiB/,
  );
});
test("offline HTML: unrelated JSON-LD, local assets and absent structured prices cannot become verified inventory", () => {
  const input = `<html lang="en"><link rel="canonical" href="${source}"><h1>TEST HTML ONLY</h1><meta name="description" content="TEST"><img src="test_files/image.jpg"><script type="application/ld+json">${JSON.stringify({ "@type": "Product", url: "https://www.klook.com/activity/123-other/", name: "Wrong product", offers: { price: 9999 } })}</script></html>`;
  const result = parseKlookSavedHtml(input, {
    ...mapping,
    country: "singapore",
  });
  assert.equal(result.observation.title, "TEST HTML ONLY");
  assert.equal(result.observation.offers.length, 0);
  assert.equal(
    result.observation.imageCandidates[0].origin,
    "img:unverified-page-context:local-saved-reference",
  );
});
test("offline CLI: local-only report, partial holds, duplicate detection and no overwrite", async () => {
  const parent = path.resolve("data/manual-klook-html");
  const root = await mkdtemp(path.join(parent, "qa-"));
  try {
    const input = path.join(root, "input"),
      output = path.join(root, "output");
    await mkdir(input);
    await writeFile(path.join(input, "one.html"), html());
    await writeFile(path.join(input, "duplicate.html"), html());
    await writeFile(
      path.join(input, "incomplete.html"),
      `<html lang="en"><link rel="canonical" href="https://www.klook.com/activity/123-incomplete/"><h1>TEST INCOMPLETE</h1></html>`,
    );
    const manifest = path.join(root, "manifest.json");
    const config = path.join(root, "config.json");
    await writeFile(config, JSON.stringify({ dataset: "synthetic" }));
    await writeFile(
      manifest,
      JSON.stringify({ "one.html": mapping, "duplicate.html": mapping }),
    );
    const run = () =>
      spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "scripts/parse-klook-html.ts",
          input,
          output,
          manifest,
          config,
        ],
        { encoding: "utf8", windowsHide: true },
      );
    const first = run();
    assert.equal(first.status, 0, first.stderr);
    const report = JSON.parse(
      await readFile(path.join(output, "report.json"), "utf8"),
    );
    assert.equal(report.candidates, 1);
    assert.equal(report.held, 2);
    assert.equal(report.networkRequests, 0);
    assert.equal(report.repeat.skipped, 1);
    assert.equal(report.failures.length, 1);
    const before = await readFile(path.join(output, "products.json"), "utf8");
    assert.equal(run().status, 1);
    assert.equal(
      await readFile(path.join(output, "products.json"), "utf8"),
      before,
    );
    const heldOutput = path.join(root, "held-output");
    const held = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/parse-klook-html.ts", input, heldOutput],
      { encoding: "utf8", windowsHide: true },
    );
    assert.equal(held.status, 0, held.stderr);
    assert.equal(
      JSON.parse(await readFile(path.join(heldOutput, "report.json"), "utf8"))
        .candidates,
      0,
    );
    assert.deepEqual(
      JSON.parse(await readFile(path.join(heldOutput, "products.json"), "utf8"))
        .products,
      [],
    );
    assert(
      JSON.parse(
        await readFile(path.join(heldOutput, "report.json"), "utf8"),
      ).failures.some((f: { error: string }) =>
        f.error.includes("Synthetic-labelled"),
      ),
    );
  } finally {
    assert(root.startsWith(parent + path.sep));
    await rm(root, { recursive: true, force: true });
  }
});
test("observed saved-DOM package cards: real IDs, scoped display prices, no following-detail contamination", () => {
  const card =
    '<div id="group-web-id-42" class="card js-pkg-id-42"><h3>TEST PACKAGE</h3><div class="desc">TEST DESCRIPTION</div><div><span class="underline-price--strike">US$ 20.00</span><div class="price-block__main">US$ 12.50</div></div><span class="title">No cancellation</span></div><div class="price-block__main">US$ 9999</div>';
  const result = parseKlookSavedHtml(html(card), mapping);
  assert.equal(result.observation.packageCards.length, 1);
  const p = result.observation.packageCards[0];
  assert.equal(p.external_package_id, "42");
  assert.equal(p.amount, 12.5);
  assert.equal(p.currency, "USD");
  assert.equal(p.retailText, "US$ 20.00");
  assert.equal(p.verified, false);
  assert.deepEqual(p.conditions, ["No cancellation"]);
  assert.equal(result.record!.packages![0].external_package_id, "42");
  assert.deepEqual(result.record!.packages![0].prices, []);
  for (const currency of ["SGD", "THB", "IDR", "JPY", "KRW", "MYR"]) {
    const other = parseKlookSavedHtml(
      html(card.replace("US$ 12.50", `${currency} 12.50`)),
      mapping,
    );
    assert.equal(other.observation.packageCards[0].currency, currency);
  }
  assert.equal(
    parseKlookSavedHtml(html(card.replace("US$ 12.50", "USD 12,50")), mapping)
      .observation.packageCards[0].amount,
    null,
  );
});
