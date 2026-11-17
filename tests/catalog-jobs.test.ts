import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  stageCatalogJob,
  advanceCatalogJob,
  reviewExternalProduct,
} from "../src/features/admin/catalog-jobs";
import {
  readLocalState,
  readLocalTourById,
  updateLocalState,
} from "../src/features/admin/local-store";
import { countries } from "../src/lib/catalog";
import { localCategories } from "../src/features/admin/local-taxonomy";
import {
  providerMappingsSchema,
  emptyProviderMappings,
} from "../src/features/admin/provider-mapping";
import { adminTourSchema } from "../src/features/admin/model";
const taxonomy = {
  locations: countries.flatMap((c) =>
    c.destinations.map((d) => ({
      slug: d.slug,
      country: c.slug,
      name: d.name,
      kind: "destination" as const,
      parent: null,
    })),
  ),
  categories: localCategories,
  operators: [],
};
const timestamp = "2026-10-14T00:00:00Z";
function feed(count: number, time = timestamp) {
  return Array.from({ length: count }, (_, i) => ({
    provider: "test_scale",
    external_product_id: `TEST-${i}`,
    source_url: `https://example.invalid/test/${i}`,
    import_status: "pending",
    last_synced_at: time,
    test_data: true,
    product: {
      slug: `test-scale-${i}`,
      country: "thailand",
      location: "chiang-mai",
      category: "culture",
      title: { ru: `ТЕСТ ${i}`, en: `TEST ${i}` },
      description: { ru: ["Синтетический текст"], en: ["Synthetic text"] },
    },
    packages: [
      {
        external_package_id: "TEST-PACKAGE",
        title: { ru: "ТЕСТ", en: "TEST" },
        prices: [],
      },
    ],
  }));
}
const scope = (time = timestamp, complete = false) => ({
  provider: "test_scale",
  countries: ["thailand"],
  snapshot_at: time,
  complete,
});
async function temporary(fn: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(tmpdir(), "test-jobs-"));
  try {
    await fn(dir);
  } finally {
    assert.ok(path.resolve(dir).startsWith(path.resolve(tmpdir()) + path.sep));
    await rm(dir, { recursive: true, force: true });
  }
}
async function finish(id: string, dir: string) {
  let job = (await readLocalState(dir)).catalogJobs!.find((j) => j.id === id)!;
  while (job.phase !== "completed") {
    job = await advanceCatalogJob(id, job.cursor, taxonomy, dir);
    assert.notEqual(job.phase, "failed");
  }
  return job;
}

test("durable jobs: preview isolation, crash/replay, checksums, atomic cursor and duplicate-free resume", async () =>
  temporary(async (dir) => {
    const content = JSON.stringify(feed(501));
    const result = await stageCatalogJob(
      content,
      "json",
      scope(),
      taxonomy,
      "TEST",
      dir,
    );
    assert.ok(result.job);
    assert.equal(result.job.mapping[0].internal_product_id, null);
    assert.equal((await readLocalState(dir)).tours.length, 0);
    const id = result.job.id;
    const first = await advanceCatalogJob(id, 0, taxonomy, dir);
    assert.equal(first.processed, 250);
    assert.equal((await advanceCatalogJob(id, 0, taxonomy, dir)).cursor, 1);
    assert.equal((await readLocalState(dir)).tours.length, 250);
    const packet = path.join(dir, "catalog-jobs", id, "1.json"),
      original = await readFile(packet);
    await writeFile(packet, "corrupted");
    await assert.rejects(advanceCatalogJob(id, 1, taxonomy, dir));
    assert.equal((await readLocalState(dir)).tours.length, 250);
    assert.equal((await readLocalState(dir)).catalogJobs![0].cursor, 1);
    await writeFile(packet, original);
    const conflictId = crypto.randomUUID();
    await updateLocalState(
      (s) => ({
        state: {
          ...s,
          tours: [
            ...s.tours,
            {
              ...s.tours[0],
              id: conflictId,
              slug: "test-scale-250",
              externalProduct: null,
            },
          ],
        },
        value: null,
      }),
      dir,
    );
    const rejected = await advanceCatalogJob(id, 1, taxonomy, dir);
    assert.equal(rejected.phase, "failed");
    assert.equal(rejected.cursor, 1);
    assert.equal((await readLocalState(dir)).tours.length, 251);
    await updateLocalState(
      (s) => ({
        state: { ...s, tours: s.tours.filter((t) => t.id !== conflictId) },
        value: null,
      }),
      dir,
    );
    const done = await finish(id, dir);
    assert.equal(done.created, 501);
    assert.equal(done.phase, "completed");
    const state = await readLocalState(dir);
    assert.equal(state.tours.length, 501);
    assert.ok(
      state.tours.every(
        (t) =>
          t.status === "draft" &&
          t.externalProduct!.publication_readiness === "blocked",
      ),
    );
    const repeat = await stageCatalogJob(
      content,
      "json",
      scope(),
      taxonomy,
      "TEST",
      dir,
    );
    assert.ok(repeat.job);
    const repeated = await finish(repeat.job.id, dir);
    assert.equal(repeated.skipped, 501);
    assert.equal((await readLocalState(dir)).tours.length, 501);
    assert.equal(done.mapping[0].package_ids[0], "TEST-PACKAGE");
    assert.equal(done.mapping[0].internal_product_id, state.tours[0].id);
  }));

test("sync lifecycle: partial omissions untouched, complete omissions draft/missing, explicit discontinued and editorial preservation", async () =>
  temporary(async (dir) => {
    let result = await stageCatalogJob(
      JSON.stringify(feed(3)),
      "json",
      scope(),
      taxonomy,
      "TEST",
      dir,
    );
    await finish(result.job!.id, dir);
    const time = "2026-10-15T00:00:00Z";
    const records = feed(2, time);
    const revised = {
      ...records[1],
      source_status: "discontinued",
      product: {
        ...records[1].product,
        title: { ru: "ТЕСТ изменение", en: "TEST change" },
      },
    };
    result = await stageCatalogJob(
      JSON.stringify([records[0], revised]),
      "json",
      scope(time),
      taxonomy,
      "TEST",
      dir,
    );
    await finish(result.job!.id, dir);
    let state = await readLocalState(dir);
    assert.equal(state.tours[2].externalProduct!.source_status, "active");
    assert.equal(state.tours[1].externalProduct!.source_status, "discontinued");
    assert.equal(state.tours[1].title.ru, "ТЕСТ 1");
    assert.equal(
      state.tours[1].externalProduct!.facts.title.ru,
      "ТЕСТ изменение",
    );
    result = await stageCatalogJob(
      JSON.stringify([records[0], revised]),
      "json",
      scope(time, true),
      taxonomy,
      "TEST",
      dir,
    );
    const done = await finish(result.job!.id, dir);
    assert.equal(done.missing, 1);
    state = await readLocalState(dir);
    assert.equal(state.tours.length, 3);
    assert.equal(state.tours[2].externalProduct!.source_status, "missing");
    assert.equal(state.tours[2].status, "draft");
    const stale = await stageCatalogJob(
      JSON.stringify(feed(1)),
      "json",
      scope(timestamp, true),
      taxonomy,
      "TEST",
      dir,
    );
    assert.equal(stale.job, null);
    assert.ok(stale.summary.failed > 0);
    const reactivated = await stageCatalogJob(
      JSON.stringify(feed(3, "2026-10-16T00:00:00Z")),
      "json",
      scope("2026-10-16T00:00:00Z"),
      taxonomy,
      "TEST",
      dir,
    );
    await finish(reactivated.job!.id, dir);
    assert.ok(
      (await readLocalState(dir)).tours.every(
        (t) => t.externalProduct!.source_status === "active",
      ),
    );
  }));

test("publication and content rights: separate states, evidence required, no automatic publication; cache isolated and invalidated", async () =>
  temporary(async (dir) => {
    const result = await stageCatalogJob(
      JSON.stringify(feed(1)),
      "json",
      scope(),
      taxonomy,
      "TEST",
      dir,
    );
    await finish(result.job!.id, dir);
    const state = await readLocalState(dir),
      tour = state.tours[0];
    state.tours[0].title.ru = "NOT PERSISTED";
    assert.notEqual(
      (await readLocalTourById(tour.id, dir))!.title.ru,
      "NOT PERSISTED",
    );
    await assert.rejects(
      reviewExternalProduct(
        tour.id,
        {
          editorial_status: "approved",
          content_rights_status: "licensed",
          rights_evidence: null,
        },
        dir,
      ),
    );
    const reviewed = await reviewExternalProduct(
      tour.id,
      {
        editorial_status: "approved",
        content_rights_status: "licensed",
        rights_evidence: "https://example.invalid/test-license",
      },
      dir,
    );
    assert.equal(reviewed.status, "draft");
    assert.equal(reviewed.externalProduct!.publication_readiness, "blocked");
    assert.equal(
      (await readLocalState(dir)).tours[0].externalProduct!.rights_evidence,
      "https://example.invalid/test-license",
    );
    assert.equal(
      adminTourSchema.safeParse({ ...reviewed, status: "published" }).success,
      false,
    );
    const fresh = await readLocalTourById(tour.id, dir);
    assert.equal(fresh!.externalProduct!.editorial_status, "approved");
    assert.ok(providerMappingsSchema.safeParse(emptyProviderMappings).success);
    assert.equal(
      providerMappingsSchema.safeParse({
        ...emptyProviderMappings,
        packages: [
          {
            provider: "test",
            external_product_id: "1",
            external_package_id: "A",
            internal_package_id: crypto.randomUUID(),
          },
          {
            provider: "test",
            external_product_id: "1",
            external_package_id: "A",
            internal_package_id: crypto.randomUUID(),
          },
        ],
      }).success,
      false,
    );
  }));
