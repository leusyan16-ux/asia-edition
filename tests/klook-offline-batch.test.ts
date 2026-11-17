import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import {
  runSavedHtmlBatch,
  discoverSavedHtml,
} from "../src/features/admin/klook-offline-batch";
import { parseKlookSavedHtml } from "../src/features/admin/klook-offline-html";
import {
  translationTasks,
  reviewedDraftMapping,
  LocalCommandTranslator,
  type OfflineTranslator,
} from "../src/features/admin/offline-translations";

const geography = [
  ["TH", "Bangkok"],
  ["VN", "Da Nang"],
  ["ID", "Ubud"],
  ["PH", "Manila"],
  ["KH", "Siem Reap"],
  ["SG", "Singapore"],
  ["MY", "Kuala Lumpur"],
];
function fixture(index: number, locale = "en") {
  const [country, city] = geography[index % geography.length],
    id = 9000000 + index;
  const url = `https://www.klook.com/activity/${id}-synthetic-test-only/`;
  return `<html lang="${locale}"><head><link rel="canonical" href="${url}"><script type="application/ld+json">${JSON.stringify({ "@type": "Product", url, name: `TEST ONLY Gardens ${id}`, description: `SYNTHETIC TEST DESCRIPTION ${id}`, address: { addressCountry: country, addressLocality: city } })}</script></head><body><h2>Packages</h2><div id="group-web-id-${id}" class="js-pkg-id-${id}"><h3>TEST PACKAGE ${id}</h3><div class="desc">TEST DESCRIPTION ${id}</div><div class="price-block__main">THB 125.50</div></div><!--${"SYNTHETIC-TEST-ONLY ".repeat(800)}--></body></html>`;
}
const fixtureTranslator: OfflineTranslator = {
  name: "synthetic-test-transport-NOT-a-translation-model",
  translate: async (tasks) =>
    tasks.map((t) => ({
      key: t.key,
      sourceHash: t.sourceHash,
      targetText: `ТЕСТОВАЯ ЗАГЛУШКА ${t.text}`,
    })),
};
test("offline batch: 900 isolated synthetic products across seven countries, bounded imports, duplicates, denial and draft gates", async () => {
  const parent = path.resolve("data/manual-klook-html");
  const root = await mkdtemp(path.join(parent, "qa-batch-"));
  try {
    const input = path.join(root, "input"),
      output = path.join(root, "output");
    await mkdir(input);
    for (let i = 0; i < 900; i++) {
      const directory = path.join(input, geography[i % 7][0]);
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, `${i}.html`), fixture(i));
    }
    await writeFile(path.join(input, "zz-duplicate.html"), fixture(0));
    await mkdir(path.join(input, "TH", "bad_files"));
    await writeFile(
      path.join(input, "TH", "bad_files", "image.jpg"),
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.invalid/must-not-fetch"/></svg>',
    );
    await writeFile(
      path.join(input, "TH", "0.html"),
      fixture(0).replace("</body>", '<img src="./bad_files/image.jpg"></body>'),
    );
    await writeFile(
      path.join(input, "zz-denied.html"),
      "<title>Access denied</title>",
    );
    await mkdir(path.join(input, "unrelated_files"));
    await writeFile(
      path.join(input, "unrelated_files", "saved_resource.html"),
      "not a product",
    );
    assert.equal((await discoverSavedHtml(input)).length, 902);
    const report = await runSavedHtmlBatch(
      input,
      output,
      {},
      { dataset: "synthetic", translator: fixtureTranslator },
    );
    assert.equal(report.candidates, 900);
    assert.equal(report.duplicateFiles, 1);
    assert.equal(report.held, 2);
    assert.equal(report.failures.length, 2);
    assert.deepEqual(
      report.batches.map((b) => b.products),
      [250, 250, 250, 150],
    );
    assert.equal(report.repeat.skipped, 900);
    assert.equal(report.readyForPublication, 0);
    assert.equal(report.networkRequests, 0);
    assert.equal(report.dataset, "synthetic");
    const countries = new Set<string>();
    for (const batch of report.batches) {
      const products = JSON.parse(
        await readFile(path.join(output, batch.file), "utf8"),
      ).products;
      for (const product of products) {
        assert.equal(product.provider, "test_fixture");
        assert.equal(product.test_data, true);
        assert.deepEqual(product.product.prices, []);
        assert.deepEqual(product.product.images, []);
        assert.deepEqual(product.product.availability, []);
        assert.equal(product.packages.length, 1);
        assert.deepEqual(product.packages[0].prices, []);
        assert(product.packages[0].title.ru.startsWith("ТЕСТОВАЯ ЗАГЛУШКА"));
        countries.add(product.product.country);
      }
    }
    assert.equal(countries.size, 7);
    const quality = (await readFile(path.join(output, "quality.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(quality.length, 902);
    assert(quality.every((q) => q.readyForPublication === false));
    assert.equal(
      quality.find((q) => q.productId === "9000000" && q.duplicate === false)
        .photos.missingOrInvalid,
      1,
    );
    await assert.rejects(
      () => runSavedHtmlBatch(input, output),
      /already exists/,
    );
    const cachedInput = path.join(root, "cached-input");
    await mkdir(cachedInput);
    await writeFile(path.join(cachedInput, "one.html"), fixture(5));
    const cachedTasks = translationTasks(
      parseKlookSavedHtml(fixture(5)).observation,
    );
    let called = 0;
    const cachedReport = await runSavedHtmlBatch(
      cachedInput,
      path.join(root, "cached-output"),
      {},
      {
        dataset: "synthetic",
        proposals: await fixtureTranslator.translate(cachedTasks),
        translator: {
          name: "cache-test-only",
          translate: async () => {
            called++;
            throw Error("Must not retranslate cached source");
          },
        },
      },
    );
    assert.equal(cachedReport.candidates, 1);
    assert.equal(called, 0);
    const conflictInput = path.join(root, "conflict-input");
    await mkdir(conflictInput);
    await writeFile(path.join(conflictInput, "one.html"), fixture(5));
    await writeFile(path.join(conflictInput, "two.html"), fixture(12));
    const conflict = await runSavedHtmlBatch(
      conflictInput,
      path.join(root, "conflict-output"),
      {
        "one.html": {
          location: { slug: "test-city", name: { ru: "A", en: "A" } },
        },
        "two.html": {
          location: { slug: "test-city", name: { ru: "B", en: "B" } },
        },
      },
      { dataset: "synthetic", translator: fixtureTranslator },
    );
    assert.equal(conflict.candidates, 1);
    assert.equal(conflict.validation.length, 1);
    // Preserve only the compact benchmark metrics; no synthetic inventory enters a catalog.
    await writeFile(
      "data/manual-klook-html/synthetic-batch-benchmark.json",
      JSON.stringify(
        {
          ...report,
          fixtureBytes: Buffer.byteLength(fixture(0)),
          fixtureTranslator:
            "test stub; translation throughput/quality NOT benchmarked",
          temporaryFixturesDeletedAfterTest: true,
        },
        null,
        2,
      ),
    );
    console.log(
      `SYNTHETIC ONLY: ${report.elapsedMs} ms; peak RSS ${report.peakRssMiB} MiB; 900 drafts / 4 import files`,
    );
  } finally {
    assert(root.startsWith(parent + path.sep));
    await rm(root, { recursive: true, force: true });
  }
});
test("offline detection: country/city breadcrumbs and reviewable category inference, ambiguous countries held", () => {
  const input =
    '<html lang="en"><link rel="canonical" href="https://www.klook.com/activity/9000999-synthetic-test-only/"><h1>TEST ONLY River Cruise</h1><script type="application/ld+json">{"@type":"BreadcrumbList","itemListElement":[{"item":{"name":"Vietnam","@id":"https://www.klook.com/destination/co1-vietnam/"}},{"item":{"name":"Da Nang","@id":"https://www.klook.com/destination/c1-da-nang/"}}]}</script></html>';
  const result = parseKlookSavedHtml(input);
  assert.equal(result.observation.normalized.country, "vietnam");
  assert.equal(result.observation.city, "Da Nang");
  assert.equal(result.observation.normalized.category, "sea");
  assert.equal(
    result.observation.normalized.categoryOrigin,
    "title-inference-needs-review",
  );
  assert.equal(result.record, null);
  assert.throws(
    () =>
      parseKlookSavedHtml(
        fixture(0).replace(
          "</head>",
          '<script type="application/ld+json">{"@type":"BreadcrumbList","itemListElement":[{"item":{"name":"Japan","@id":"https://www.klook.com/destination/co2-japan/"}}]}</script></head>',
        ),
      ),
    /Country conflict/,
  );
});
test("translation drafts: source-bound, no autoapproval, stale/duplicate/numerically changed outputs rejected, both directions", async () => {
  for (const [source, bad] of [
    ["Outdoor Audio Tour (Tram)", "Outdoor Audio Tour (альбом)"],
    ["High tea", "Высокий чай"],
    ["Redemption voucher", "Ваучер на выкуп"],
  ]) {
    const t = translationTasks({
      ...parseKlookSavedHtml(fixture(2)).observation,
      title: source,
    })[0];
    assert.equal(
      reviewedDraftMapping(
        {},
        [t],
        [{ key: t.key, sourceHash: t.sourceHash, targetText: bad }],
      ).rejected.length,
      1,
    );
  }
  for (const locale of ["en", "ru"] as const) {
    const o = parseKlookSavedHtml(fixture(2, locale)).observation,
      tasks = translationTasks(o);
    assert(tasks.every((t) => t.to !== locale));
    const proposals = await fixtureTranslator.translate(tasks);
    const mapped = reviewedDraftMapping({}, tasks, proposals);
    assert.equal(mapped.accepted.length, tasks.length);
    assert(mapped.accepted.every((p) => p.reviewStatus === "needs_review"));
    assert.equal(
      reviewedDraftMapping(
        {},
        tasks,
        proposals.map((p) => ({ ...p, sourceHash: "0".repeat(64) })),
      ).accepted.length,
      0,
    );
    assert.equal(
      reviewedDraftMapping({}, tasks, [proposals[0], proposals[0]]).rejected
        .length,
      1,
    );
    assert.equal(
      reviewedDraftMapping({}, tasks, [
        { ...proposals[0], targetText: "Invented number 123" },
      ]).rejected.length,
      1,
    );
  }
});
test("local command translation: explicit trusted executable, protocol failure and timeout", async () => {
  assert.throws(
    () => new LocalCommandTranslator("relative-command"),
    /absolute/,
  );
  const o = parseKlookSavedHtml(fixture(0)).observation,
    tasks = translationTasks(o);
  const program =
    'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>console.log(JSON.stringify(JSON.parse(s).map(t=>({key:t.key,sourceHash:t.sourceHash,targetText:"TEST ONLY "+t.text})))));';
  assert.equal(
    (
      await new LocalCommandTranslator(process.execPath, [
        "-e",
        program,
      ]).translate(tasks)
    ).length,
    tasks.length,
  );
  await assert.rejects(
    () =>
      new LocalCommandTranslator(process.execPath, [
        "-e",
        'console.log("not JSON")',
      ]).translate(tasks),
    /Invalid/,
  );
  await assert.rejects(
    () =>
      new LocalCommandTranslator(
        process.execPath,
        ["-e", "setTimeout(()=>{},5000)"],
        100,
      ).translate(tasks),
    /timed out/,
  );
});
