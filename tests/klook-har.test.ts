import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { extractKlookHar } from "../src/features/admin/klook-har";
import { runSavedHtmlBatch } from "../src/features/admin/klook-offline-batch";
import type { SavedPageMapping } from "../src/features/admin/klook-offline-html";

// Synthetic HAR transport fixtures only. Not acquired or publishable inventory.
function pair(id: number) {
  const url = `https://www.klook.com/en-US/activity/${id}-test-only/`;
  const html = `<html lang="en"><head><title>TEST ONLY ${id}</title><meta property="og:title" content="TEST ONLY John's &amp; garden"><script>window.account={token:'DO_NOT_EXPORT'}</script><script type="application/ld+json">${JSON.stringify({ "@type": "Product", name: `TEST ONLY ${id}`, description: "SYNTHETIC ONLY", url, address: { addressCountry: "SG", addressLocality: "Singapore" } })}</script></head><body><input value="DO_NOT_EXPORT"></body></html>`;
  const packages = {
    success: true,
    token: "DO_NOT_EXPORT",
    result: {
      activity_id: id,
      currency_symbol: "US$",
      spu_group_info: [
        {
          group_id: 1,
          name: "TEST ONLY",
          spu_list: [
            {
              spu_id: 1,
              spu_name: "TEST ONLY package",
              spu_desc: "SYNTHETIC ONLY",
              spu_icon_items: [],
              price_show: { sale_price: "US$ 2.00", sale_price_value: "2.00" },
              session_token: "DO_NOT_EXPORT",
            },
          ],
        },
      ],
    },
  };
  return [
    {
      request: {
        url: url + "?token=DO_NOT_EXPORT",
        headers: [{ name: "Authorization", value: "DO_NOT_EXPORT" }],
      },
      response: { status: 200, content: { mimeType: "text/html", text: html } },
    },
    {
      request: {
        url: "https://www.klook.com/observed-path-not-an-endpoint-contract?token=DO_NOT_EXPORT",
      },
      response: {
        status: 200,
        content: {
          mimeType: "application/json",
          encoding: "base64",
          text: Buffer.from(JSON.stringify(packages)).toString("base64"),
        },
      },
    },
  ];
}

test("HAR: twenty unique passive captures flow into the existing batch importer as drafts", async () => {
  const root = await mkdtemp(path.resolve("data/manual-klook-html/test-har-"));
  try {
    const extracted = extractKlookHar({
      log: {
        entries: Array.from({ length: 20 }, (_, i) => pair(900000 + i)).flat(),
      },
    });
    assert.equal(extracted.report.uniqueActivityIds, 20);
    assert.equal(extracted.report.completePairs, 20);
    const input = path.join(root, "input");
    await mkdir(input);
    const manifest: Record<string, SavedPageMapping> = {};
    for (const p of extracted.products) {
      assert(p.html && p.packages && !p.held);
      assert(!JSON.stringify(p).includes("DO_NOT_EXPORT"));
      const folder = path.join(input, p.id);
      await mkdir(folder);
      const name = `${p.id}/klook-${p.id}.html`;
      manifest[name] = {
        category: "parks",
        title: { ru: "ТЕСТ" },
        description: { ru: "ТЕСТ" },
      };
      await writeFile(path.join(folder, `klook-${p.id}.html`), p.html);
      await writeFile(
        path.join(folder, `klook-${p.id}-packages.json`),
        JSON.stringify(p.packages),
      );
    }
    const report = await runSavedHtmlBatch(
      input,
      path.join(root, "output"),
      manifest,
      { dataset: "synthetic" },
    );
    assert.equal(report.candidates, 20);
    assert.equal(report.repeat.skipped, 20);
    assert.equal(report.readyForPublication, 0);
    const products = JSON.parse(
      await readFile(path.join(root, "output/products.json"), "utf8"),
    ).products;
    assert.equal(
      new Set(
        products.map(
          (p: { external_product_id: string }) => p.external_product_id,
        ),
      ).size,
      20,
    );
    assert(
      products.every(
        (p: { product: { prices: unknown[]; images: unknown[] } }) =>
          p.product.prices.length === 0 && p.product.images.length === 0,
      ),
    );
    // Regional checks remain in the existing importer, after HAR extraction.
    const japan = path.join(input, "900000/klook-900000.html");
    await writeFile(
      japan,
      (await readFile(japan, "utf8")).replace(
        '"addressCountry":"SG"',
        '"addressCountry":"JP"',
      ),
    );
    const transit = path.join(input, "900001/klook-900001.html");
    await writeFile(
      transit,
      (await readFile(transit, "utf8")).replace(
        '"description":"SYNTHETIC ONLY"',
        '"description":"SYNTHETIC ONLY transfer via Russia"',
      ),
    );
    const restricted = await runSavedHtmlBatch(
      input,
      path.join(root, "restricted"),
      manifest,
      { dataset: "synthetic" },
    );
    assert.equal(restricted.candidates, 18);
    assert.equal(restricted.validation.length + restricted.failures.length, 2);
  } finally {
    assert(path.basename(root).startsWith("test-har-"));
    await rm(root, { recursive: true, force: true });
  }
});

test("HAR: exact duplicates deduplicate, conflicting snapshots held, foreign/403 entries never replayed", () => {
  const entries = pair(900000);
  const same = extractKlookHar({ log: { entries: [...entries, ...entries] } });
  assert.equal(same.products.length, 1);
  assert.equal(same.report.duplicates, 2);
  const conflict = structuredClone(entries[1]);
  const body = JSON.parse(
    Buffer.from(conflict.response.content.text, "base64").toString("utf8"),
  );
  body.result.currency_symbol = "€";
  conflict.response.content.text = Buffer.from(JSON.stringify(body)).toString(
    "base64",
  );
  const held = extractKlookHar({ log: { entries: [...entries, conflict] } });
  assert.equal(held.products[0].held, true);
  const denied = extractKlookHar({
    log: {
      entries: [
        {
          request: { url: "https://www.klook.com/en-US/activity/123-test/" },
          response: {
            status: 403,
            content: { mimeType: "text/html", text: "blocked" },
          },
        },
        {
          request: { url: "https://evil.invalid/activity/123-test/" },
          response: {
            status: 200,
            content: { mimeType: "text/html", text: "untrusted" },
          },
        },
      ],
    },
  });
  assert.equal(denied.products.length, 0);
  assert.equal(denied.report.networkRequests, 0);
  const missing = extractKlookHar({
    log: {
      entries: [
        {
          request: { url: "https://www.klook.com/activity/127/" },
          response: { status: 200, content: { mimeType: "text/html" } },
        },
        entries[1],
      ],
    },
  });
  assert.equal(missing.report.missingBodies, 1);
  assert(missing.products[0].held);
  assert.throws(() => extractKlookHar({ log: { entries: "invalid" } }));
});
