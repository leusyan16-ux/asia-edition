import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { demoTour } from "../src/features/tours/demo";
import { adminTourSchema } from "../src/features/admin/model";
import {
  readLocalPublicPage,
  readLocalPublicBySlug,
  readLocalSummaries,
} from "../src/features/admin/local-store";
import { overviewPage } from "../src/features/admin/overview-query";
test("server pages: published-only, verified prices before filtering, bounded admin payload, last page and file invalidation", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "test-page-scale-"));
  try {
    const tours = Array.from({ length: 101 }, (_, i) =>
      adminTourSchema.parse({
        ...demoTour,
        id: crypto.randomUUID(),
        slug: `test-${String(i).padStart(4, "0")}`,
        title: { ru: `ТЕСТ ${i}`, en: `TEST ${i}` },
        status: i === 0 ? "draft" : "published",
        visible: i !== 1,
        archived: false,
        prices: demoTour.prices.map((p) => ({
          ...p,
          verifiedAt: i === 2 ? "2026-10-14T00:00:00Z" : null,
        })),
      }),
    );
    await writeFile(
      path.join(directory, "tours.json"),
      JSON.stringify({ version: 2, tours, imports: [] }),
    );
    const query = {
      page: 1,
      pageSize: 9,
      locale: "en" as const,
      sort: "featured" as const,
      currency: "USD",
    };
    let page = await readLocalPublicPage(query, directory);
    assert.equal(page.total, 99);
    assert.equal(page.items.length, 9);
    assert.ok(
      !page.items.some((t) => t.id === tours[0].id || t.id === tours[1].id),
    );
    assert.equal(await readLocalPublicBySlug(tours[0].slug, directory), null);
    assert.equal(
      (await readLocalPublicPage({ ...query, minPrice: 1 }, directory)).total,
      1,
    );
    assert.equal(
      (await readLocalPublicPage({ ...query, page: 11 }, directory)).items
        .length,
      9,
    );
    const summaries = await readLocalSummaries(directory);
    const admin = overviewPage(summaries, {
      status: "published",
      search: "TEST",
      page: 4,
    });
    assert.equal(admin.pagination.total, 100);
    assert.equal(admin.items.length, 25);
    assert.equal(overviewPage(summaries, { page: 9999 }).pagination.page, 5);
    assert.equal(
      overviewPage(summaries, { search: "not found" }).items.length,
      0,
    );
    tours[2].status = "draft";
    await writeFile(
      path.join(directory, "tours.json"),
      JSON.stringify({ version: 2, tours, imports: [] }),
    );
    page = await readLocalPublicPage(query, directory);
    assert.equal(page.total, 98);
    assert.equal(
      (await readLocalPublicPage({ ...query, minPrice: 1 }, directory)).total,
      0,
    );
  } finally {
    assert.ok(
      path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep),
    );
    await rm(directory, { recursive: true, force: true });
  }
});
