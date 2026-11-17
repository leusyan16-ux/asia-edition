import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createIdentity,
  passwordMatches,
  signSession,
  verifySession,
  authorize,
  assertOrigin,
  isLoopback,
  configuredAdminMode,
} from "../src/features/admin/security";
import {
  adminTourSchema,
  validateTour,
  type AdminTaxonomy,
} from "../src/features/admin/model";
import { demoTour } from "../src/features/tours/demo";
import {
  previewCSV,
  parseCSV,
  csvTemplate,
  csvColumns,
} from "../src/features/admin/csv";
import {
  saveLocalBatch,
  readLocalTours,
  localDirectory,
} from "../src/features/admin/local-store";
import {
  sanitizeImage,
  imageType,
} from "../src/features/admin/image-validation";
import { limitedBody } from "../src/features/admin/http";
const taxonomy: AdminTaxonomy = {
  locations: [
    {
      slug: "ha-long-bay",
      country: "vietnam",
      name: { ru: "Тест", en: "Test" },
      kind: "destination",
    },
  ],
  categories: [{ slug: "nature", name: { ru: "Тест", en: "Test" } }],
  operators: [],
};
const fixture = () =>
  adminTourSchema.parse({ ...demoTour, status: "draft", featured: false });
test("admin authorization: password hashing, tamper/expiry rejection, RBAC and CSRF", () => {
  assert.equal(configuredAdminMode("local", "production"), "disabled");
  assert.equal(configuredAdminMode(undefined, "development"), "disabled");
  assert.equal(configuredAdminMode("local", "development"), "local");
  assert.equal(configuredAdminMode("supabase", "production"), "supabase");
  const identity = createIdentity(
    "admin@example.invalid",
    "test-password-only-123",
  );
  assert.ok(passwordMatches("test-password-only-123", identity));
  assert.ok(!passwordMatches("wrong", identity));
  assert.notEqual(identity.hash, "test-password-only-123");
  const token = signSession(identity, 10000);
  assert.equal(verifySession(token, identity, 10001)?.role, "admin");
  assert.equal(verifySession(token + "x", identity, 10001), null);
  assert.equal(verifySession(token, identity, 3610001), null);
  assert.equal(
    verifySession(
      token,
      createIdentity(identity.email, "another-test-only-password"),
      10001,
    ),
    null,
  );
  assert.throws(() => authorize(null));
  assert.throws(() =>
    authorize({ id: "x", role: "viewer", mode: "supabase" } as never),
  );
  authorize({ id: "x", role: "admin", mode: "local" });
  assert.throws(() =>
    assertOrigin(
      new Request("https://example.invalid/admin/api/tours", {
        headers: { origin: "https://other.invalid" },
      }),
    ),
  );
  assert.throws(() =>
    assertOrigin(new Request("https://example.invalid/admin/api/tours")),
  );
  assertOrigin(
    new Request("https://example.invalid/admin/api/tours", {
      headers: { origin: "https://example.invalid" },
    }),
  );
  assert.ok(isLoopback("localhost:3000"));
  assert.ok(!isLoopback("localhost.evil:3000"));
  assert.ok(!isLoopback("0.0.0.0:3000"));
});
test("tour validation: countries, relationships, translations, prices, schedules and publication", () => {
  const t = fixture();
  assert.ok(validateTour(t, taxonomy));
  assert.throws(() => validateTour({ ...t, country: "egypt" }, taxonomy));
  assert.throws(() => validateTour({ ...t, country: "thailand" }, taxonomy));
  assert.throws(() =>
    validateTour({ ...t, title: { ru: "Тест", en: "" } }, taxonomy),
  );
  assert.throws(() =>
    validateTour({ ...t, prices: [{ ...t.prices[0], adult: -1 }] }, taxonomy),
  );
  assert.throws(() =>
    validateTour({ ...t, prices: [t.prices[0], t.prices[0]] }, taxonomy),
  );
  assert.throws(() =>
    validateTour(
      {
        ...t,
        prices: [
          { ...t.prices[0], validFrom: "2099-02-01", validUntil: "2099-01-01" },
        ],
      },
      taxonomy,
    ),
  );
  assert.throws(() =>
    validateTour(
      {
        ...t,
        departures: [
          {
            weekdays: [8],
            time: "25:00",
            validFrom: "2099-01-01",
            validUntil: "2099-02-01",
          },
        ],
      },
      taxonomy,
    ),
  );
  assert.throws(() =>
    validateTour(
      {
        ...t,
        slots: [
          {
            date: "2099-01-01",
            time: "09:00",
            capacity: 1,
            reserved: 2,
            status: "available",
            verifiedAt: null,
          },
        ],
      },
      taxonomy,
    ),
  );
  assert.throws(() =>
    validateTour({ ...t, status: "published", isDemo: false }, taxonomy),
  );
  assert.throws(() =>
    validateTour({ ...t, status: "published", images: [] }, taxonomy),
  );
  assert.throws(() =>
    validateTour({ ...t, archived: true, status: "published" }, taxonomy),
  );
});
function csv(slug = "test-only-csv") {
  return (
    "slug,country,location,category,title_ru,title_en,description_ru,description_en\r\n" +
    `${slug},vietnam,ha-long-bay,nature,"ТЕСТ, не реальный тур",TEST ONLY,"Первый абзац\nВторой","Test ""only"""\r\n`
  );
}
test("CSV preview: BOM, quotes/newlines, per-row validation, duplicates, limits and draft-only", () => {
  assert.equal(parseCSV("\uFEFF" + csv())[1][4], "ТЕСТ, не реальный тур");
  const result = previewCSV(csv(), taxonomy, []);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].errors, []);
  assert.equal(result[0].tour?.status, "draft");
  assert.equal(result[0].tour?.verifiedAt, null);
  assert.equal(result[0].tour?.description.ru.length, 2);
  assert.ok(
    previewCSV(csv(), taxonomy, [{ slug: "test-only-csv" }])[0].errors.length,
  );
  assert.ok(
    previewCSV(
      csv() + csv().split("\r\n").slice(1).join("\r\n"),
      taxonomy,
      [],
    )[1].errors.length,
  );
  assert.ok(
    previewCSV(csv().replace("vietnam", "egypt"), taxonomy, [])[0].errors
      .length,
  );
  assert.throws(() => parseCSV('"unterminated'));
  assert.throws(() => parseCSV("a\n".repeat(1002)));
  assert.throws(() => previewCSV("slug,slug\nx,x", taxonomy, []));
  assert.throws(() => previewCSV("wrong\nx", taxonomy, []));
  assert.equal(parseCSV(csvTemplate)[0].length, csvColumns.length);
});
test("local persistence: atomic batch rollback, stale versions and duplicate addresses", async () => {
  const oldProfile = process.env.ADMIN_LOCAL_DIRECTORY;
  try {
    process.env.ADMIN_LOCAL_DIRECTORY = "../outside";
    assert.throws(() => localDirectory());
    process.env.ADMIN_LOCAL_DIRECTORY = ".admin-local/qa-test";
    assert.ok(localDirectory().endsWith(path.join(".admin-local", "qa-test")));
  } finally {
    if (oldProfile === undefined) delete process.env.ADMIN_LOCAL_DIRECTORY;
    else process.env.ADMIN_LOCAL_DIRECTORY = oldProfile;
  }
  const dir = await mkdtemp(path.join(tmpdir(), "asia-admin-test-"));
  try {
    const t = fixture();
    const [saved] = await saveLocalBatch([t], {}, dir);
    assert.equal((await readLocalTours(dir)).length, 1);
    const before = await readFile(path.join(dir, "tours.json"), "utf8");
    const duplicate = { ...t, id: "00000000-0000-4000-8000-000000000002" };
    await assert.rejects(
      saveLocalBatch(
        [
          { ...saved, slug: "changed" },
          duplicate,
          { ...duplicate, id: "00000000-0000-4000-8000-000000000003" },
        ],
        { [saved.id]: saved.updatedAt },
        dir,
      ),
    );
    assert.equal(await readFile(path.join(dir, "tours.json"), "utf8"), before);
    await assert.rejects(
      saveLocalBatch(
        [{ ...saved, title: { ru: "Изменение", en: "Changed" } }],
        { [saved.id]: "2000-01-01T00:00:00Z" },
        dir,
      ),
    );
    assert.equal(await readFile(path.join(dir, "tours.json"), "utf8"), before);
    const edited = await saveLocalBatch(
      [{ ...saved, title: { ru: "Только тест", en: "Test only" } }],
      { [saved.id]: saved.updatedAt },
      dir,
    );
    assert.equal(edited[0].title.ru, "Только тест");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("image and body hardening: reject SVG/spoofed headers; decode and re-encode real images", async () => {
  assert.throws(() =>
    imageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')),
  );
  await assert.rejects(
    sanitizeImage(Buffer.from([255, 216, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0])),
  );
  const source = await readFile("public/images/vietnam.jpg");
  const sanitized = await sanitizeImage(source);
  assert.equal(imageType(sanitized), "webp");
  assert.ok(sanitized.length < 8 * 1024 * 1024);
  await assert.rejects(
    limitedBody(
      new Request("http://localhost/admin/api/tours", {
        method: "POST",
        body: "12345",
      }),
      4,
    ),
  );
  assert.equal(
    (
      await limitedBody(
        new Request("http://localhost/admin/api/tours", {
          method: "POST",
          body: "1234",
        }),
        4,
      )
    ).length,
    4,
  );
});
