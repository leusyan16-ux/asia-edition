import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import {
  GetYourGuideAdapter,
  parseGygInput,
  parseGygDuration,
  gygRowSchema,
  gygTitleTask,
} from "../src/features/admin/getyourguide-adapter";
import { prepareImport } from "../src/features/admin/import-engine";
import { localCategories } from "../src/features/admin/local-taxonomy";
import { localTourPayload } from "../src/features/tours/local-catalog";
import { TourCards } from "../src/features/tours/components/cards";
import { TourDetail } from "../src/features/tours/components/detail";
import { selectTours, parseQuery } from "../src/features/tours/query";
import {
  compileStaticCatalog,
  publicationDigest,
} from "../src/features/tours/static-catalog";

// Synthetic in-memory provider rows, never published or persisted.
function fixture() {
  return {
    source: "GetYourGuide",
    source_product_id: "999999",
    source_url:
      "https://www.getyourguide.com/bangkok-l169/test-only-city-tour-t999999/",
    title_uk: "СИНТЕТИЧНИЙ ТЕСТ — екскурсія містом",
    image_url_reference: "https://cdn.getyourguide.com/test-only.jpg",
    display_price_text: "37 USD",
    rating_text: "4,9",
    duration_and_features_text: "2 - 4 години • Приватна група",
    country: "Thailand (search context; verify route)",
    city: "",
    description_uk: "",
    cancellation_policy: "",
    availability: "",
    rights_status: "unverified",
    publication_status: "needs_review",
    source_files: "TEST ONLY.txt",
  };
}
const at = "2026-10-26T10:00:00Z";
function normalize(raw = fixture()) {
  const row = gygRowSchema.parse(raw),
    task = gygTitleTask(row);
  const result = new GetYourGuideAdapter(
    [
      {
        key: task.key,
        sourceHash: task.sourceHash,
        targetText: "ТЕСТ — городская экскурсия",
      },
    ],
    at,
  ).prepare([row]);
  assert.equal(result.excluded.length, 0);
  const record = result.records[0];
  const taxonomy = {
    locations: record.locations!,
    categories: localCategories,
    operators: [],
  };
  const plan = prepareImport(JSON.stringify([record]), "json", taxonomy, []);
  assert.deepEqual(plan[0].errors, []);
  return { record, tour: plan[0].tour!, taxonomy };
}
test("GetYourGuide: supplied fields retained privately, prices/photos/rating never auto-verified, duplicate-free updates preserve editorial content", () => {
  const { record, tour, taxonomy } = normalize();
  assert.equal(tour.status, "draft");
  assert.equal(tour.externalProduct!.content_rights_status, "unknown");
  assert.equal(tour.externalProduct!.publication_readiness, "blocked");
  assert.deepEqual(tour.images, []);
  assert.deepEqual(tour.prices, []);
  assert.equal(tour.durationMinutes, null);
  assert.equal(
    (
      tour.externalProduct!.source_metadata!.price_observation as {
        currency: string;
      }
    ).currency,
    "USD",
  );
  assert.equal(
    (
      tour.externalProduct!.source_metadata!.rating_observation as {
        value: number;
      }
    ).value,
    4.9,
  );
  assert.equal(tour.externalProduct!.external_product_id, "999999");
  assert.equal(
    prepareImport(JSON.stringify([record]), "json", taxonomy, [tour])[0].action,
    "skip",
  );
  const revised = normalize({
    ...fixture(),
    display_price_text: "41 USD",
  }).record;
  const edit = {
    ...tour,
    title: { ru: "Редактор сохранил это название", en: "Keep this edit" },
  };
  const update = prepareImport(JSON.stringify([revised]), "json", taxonomy, [
    edit,
  ])[0];
  assert.equal(update.action, "update");
  assert.equal(update.tour?.id, tour.id);
  assert.equal(update.tour?.title.ru, edit.title.ru);
  const publicPayload = localTourPayload(tour, true);
  assert(!JSON.stringify(publicPayload).includes("image_references"));
  const malicious = {
    ...fixture(),
    rights_status: "licensed",
    publication_status: "published",
  };
  assert.equal(normalize(malicious).tour.status, "draft");
});

test("GetYourGuide: CSV/JSON parity, ID integrity, geography exclusions and literal duration handling", () => {
  const row = fixture(),
    headers = Object.keys(row),
    csv =
      headers.join(",") +
      "\n" +
      Object.values(row)
        .map((v) => '"' + v.replaceAll('"', '""') + '"')
        .join(",");
  assert.equal(
    new GetYourGuideAdapter().prepare([
      {
        ...row,
        source_url: row.source_url.replace(
          "test-only-city-tour",
          "official_hawk-test-only-tour",
        ),
      },
    ]).records.length,
    1,
  );
  assert.deepEqual(
    parseGygInput(csv, "csv"),
    parseGygInput(JSON.stringify([row]), "json"),
  );
  assert.equal(
    new GetYourGuideAdapter().prepare([row, row]).excluded.length,
    1,
  );
  assert.equal(
    new GetYourGuideAdapter().prepare([{ ...row, source_product_id: "1" }])
      .excluded.length,
    1,
  );
  assert.equal(
    new GetYourGuideAdapter().prepare([
      { ...row, title_uk: "З Делі: Тадж-Махал і Джайпур" },
    ]).records.length,
    0,
  );
  assert.equal(
    new GetYourGuideAdapter().prepare([
      { ...row, title_uk: "СИНТЕТИЧНИЙ ТЕСТ — Росія" },
    ]).records.length,
    0,
  );
  assert.equal(
    new GetYourGuideAdapter().prepare([
      {
        ...row,
        source_url: row.source_url.replace("bangkok-l169", "tokyo-l193"),
      },
    ]).records.length,
    0,
  );
  assert.equal(parseGygDuration("6,5 години • Приватна група"), 390);
  assert.equal(parseGygDuration("35 - 50 хвилини"), null);
  assert.equal(parseGygDuration("30 хвилини - 1 година"), null);
  assert.equal(parseGygDuration("Тур на цілий день"), null);
  const missing = normalize({
    ...row,
    display_price_text: "",
    image_url_reference: "",
    rating_text: "",
  });
  assert.deepEqual(missing.tour.prices, []);
});

test("GetYourGuide cards/detail RU/EN render without remote images or prices, search/filter work only on explicit fixtures, publication gates remain closed", () => {
  const { tour, taxonomy } = normalize();
  for (const locale of ["ru", "en"] as const) {
    const html = renderToStaticMarkup(
      <>
        <TourCards items={[tour]} locale={locale} />
        <TourDetail
          tour={localTourPayload(tour, true)}
          locale={locale}
          related={[]}
          taxonomy={taxonomy}
        />
      </>,
    );
    assert(html.includes(locale === "ru" ? "Фото направления" : "Destination photo"));
    assert(html.includes("<img"));
    assert(html.includes("photo-context-label"));
    assert(!html.includes("cdn.getyourguide.com"));
    assert(!html.includes("37.00"));
    assert(html.includes(tour.title[locale]));
    assert(!html.includes("undefined"));
  }
  const q = parseQuery(
    {
      country: "thailand",
      location: tour.location,
      category: tour.category,
      search: "городская",
    },
    "ru",
  );
  assert.equal(selectTours([tour], q).total, 0);
  // In-memory published fixture only; never an actual publication.
  assert.equal(
    selectTours([{ ...tour, status: "published", verifiedAt: at }], q).total,
    1,
  );
  assert.equal(
    selectTours([{ ...tour, status: "published", verifiedAt: at }], {
      ...q,
      country: "laos",
    }).total,
    0,
  );
  const reviews = [
    {
      digest: publicationDigest(tour),
      publicationApproved: true,
      imagesApproved: true,
      geographyApproved: true,
    },
  ];
  assert.equal(
    compileStaticCatalog([tour], reviews, taxonomy, new Date(at)).snapshot
      .records.length,
    0,
  );
});
