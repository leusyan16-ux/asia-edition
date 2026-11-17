import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import {
  initializeEmbedded,
  roleDatabase,
} from "../src/features/ingestion/embedded";
import type { Database } from "../src/features/ingestion/postgres-worker";
import {
  galleryMediaReviews,
  reviewGalleryMedia,
} from "../src/features/ingestion/media-review";
import { emptyTour } from "../src/features/admin/model";

test("gallery rights request: strict bounded input and no SQL for invalid submissions", async () => {
  let calls = 0;
  const db = {
    async query<T>() {
      calls++;
      return { rows: [] as T[] };
    },
  };
  const value = {
    product: randomUUID(),
    key: randomUUID() + ".webp",
    rights: "licensed",
    evidence: "https://example.invalid/TEST-PROOF",
  };
  for (const input of [
    { ...value, key: "../outside.webp" },
    { ...value, evidence: null },
    { ...value, evidence: "http://example.invalid/proof" },
    { ...value, rights: "published" },
    { ...value, product: "bad-id" },
    { ...value, actor: "FORGED" },
    { ...value, evidence: "https://example.invalid/" + "x".repeat(2048) },
  ])
    await assert.rejects(reviewGalleryMedia(db, input));
  assert.equal(calls, 0);
});

test("gallery rights service: persisted links, private roles, confirmation and withdrawal without publishing", async () => {
  const engine = new PGlite();
  try {
    await initializeEmbedded(engine);
    const raw = engine as unknown as Database,
      editor = roleDatabase(raw, "asia_catalog_editor"),
      reader = roleDatabase(raw, "asia_catalog_reader");
    const product = randomUUID(),
      asset = randomUUID(),
      key = asset + ".webp";
    await editor.query(
      "insert into catalog_projection.media_assets(id,key,bytes,sha256,actor) values($1,$2,1,$3,'TEST ONLY')",
      [asset, key, "a".repeat(64)],
    );
    const d = {
      ...emptyTour(product),
      country: "thailand",
      location: "chiang-mai",
      category: "culture",
      slug: "test-media-review-" + product,
      title: { ru: "ТЕСТ", en: "TEST" },
      images: [
        { url: "/images/admin/" + key, alt: { ru: "ТЕСТ", en: "TEST" } },
      ],
    };
    await editor.query(
      "insert into catalog_projection.documents(id,document) values($1,$2::jsonb)",
      [product, JSON.stringify(d)],
    );
    assert.equal(
      (await galleryMediaReviews(editor, product))[0].content_rights_status,
      "unknown",
    );
    const input = {
      product,
      key,
      rights: "licensed",
      evidence: "https://example.invalid/TEST-PROOF",
    };
    await assert.rejects(
      reviewGalleryMedia(editor, { ...input, product: randomUUID() }),
      /Сначала сохраните/,
    );
    await assert.rejects(reviewGalleryMedia(reader, input));
    await reviewGalleryMedia(editor, input);
    const rows = await galleryMediaReviews(editor, product);
    assert.equal(rows[0].content_rights_status, "licensed");
    assert.equal(rows[0].rights_evidence, input.evidence);
    assert.equal(
      (
        await editor.query<{ status: string }>(
          "select status from catalog_projection.documents where id=$1",
          [product],
        )
      ).rows[0].status,
      "draft",
    );
    assert.equal(
      (await reader.query("select * from catalog_projection.documents")).rows
        .length,
      0,
    );
    await reviewGalleryMedia(editor, {
      ...input,
      rights: "restricted",
      evidence: null,
    });
    assert.equal(
      (await galleryMediaReviews(editor, product))[0].content_rights_status,
      "restricted",
    );
    await editor.query(
      "update catalog_projection.documents set document=jsonb_set(document,'{images}','[]'),revision=revision+1 where id=$1",
      [product],
    );
    await assert.rejects(
      reviewGalleryMedia(editor, input),
      /Сначала сохраните/,
    );
  } finally {
    await engine.close();
  }
});
