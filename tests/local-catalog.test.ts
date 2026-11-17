import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  localCatalogAllowed,
  isPublicLocalTour,
  localTourPayload,
} from "../src/features/tours/local-catalog";
import {
  readLocalTours,
  saveLocalBatch,
} from "../src/features/admin/local-store";
import { adminTourSchema } from "../src/features/admin/model";
import { demoTour } from "../src/features/tours/demo";
import { selectTours } from "../src/features/tours/query";
test("local catalog: strict development/localhost opt-in, private drafts and published-only payload", async () => {
  assert.equal(
    localCatalogAllowed("development", "local", "local", "localhost:3000"),
    true,
  );
  for (const host of ["example.com", "localhost.evil.com", "192.168.1.1"])
    assert.equal(
      localCatalogAllowed("development", "local", "local", host),
      false,
    );
  for (const env of ["production", "test", undefined])
    assert.equal(
      localCatalogAllowed(env, "local", "local", "localhost"),
      false,
    );
  assert.equal(
    localCatalogAllowed("development", "supabase", "local", "localhost"),
    false,
  );
  assert.equal(
    localCatalogAllowed("development", "local", "demo", "localhost"),
    false,
  );
  const dir = await mkdtemp(path.join(tmpdir(), "asia-local-catalog-"));
  try {
    const draft = adminTourSchema.parse({
      ...demoTour,
      id: crypto.randomUUID(),
      slug: "local-test",
      status: "draft",
      images: [
        {
          url: "/images/admin/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp",
          alt: { ru: "TEST", en: "TEST" },
        },
      ],
    });
    let [saved] = await saveLocalBatch([draft], {}, dir);
    assert.equal(
      (await readLocalTours(dir)).filter(isPublicLocalTour).length,
      0,
    );
    assert.equal(
      localTourPayload(saved, true).images[0].url,
      "/admin/api/images/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp",
    );
    [saved] = await saveLocalBatch(
      [{ ...saved, summary: { ru: "TEST EDIT", en: "TEST EDIT" } }],
      { [saved.id]: saved.updatedAt },
      dir,
    );
    [saved] = await saveLocalBatch(
      [{ ...saved, status: "published" }],
      { [saved.id]: saved.updatedAt },
      dir,
    );
    const publicTours = (await readLocalTours(dir))
      .filter(isPublicLocalTour)
      .map((t) => localTourPayload(t));
    assert.equal(publicTours.length, 1);
    assert.equal(publicTours[0].summary.en, "TEST EDIT");
    assert.equal(publicTours[0].verifiedAt, null);
    assert.equal(publicTours[0].prices.length, 0);
    assert.equal(publicTours[0].availability.length, 0);
    assert.equal(
      selectTours(publicTours, { locale: "ru", page: 1, pageSize: 9 }, false)
        .total,
      1,
    );
    assert.equal(isPublicLocalTour({ ...saved, visible: false }), false);
    assert.equal(isPublicLocalTour({ ...saved, archived: true }), false);
    assert.equal(
      publicTours.some((t) => t.id === demoTour.id),
      false,
    );
  } finally {
    const target = path.resolve(dir);
    assert.ok(target.startsWith(path.resolve(tmpdir()) + path.sep));
    await rm(target, { recursive: true, force: true });
  }
});
