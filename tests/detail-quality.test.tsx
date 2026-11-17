import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { tourImageVariant } from "../src/features/tours/image-variants";
import { sourceInformationFacts } from "../src/features/tours/information-facts";
import {
  snapshotSchema,
  informationDigest,
  staticCatalogRepository,
} from "../src/features/tours/static-catalog";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { TourDetail } from "../src/features/tours/components/detail";
test("Image variants: same approved asset, native scale-down, bounded widths and no foreign hosts", () => {
  const u =
    "https://cdn.getyourguide.com/image/format=auto%2Cfit=cover%2Cwidth=270%2Cheight=180%2Cdpr=2/tour_img/TEST.jpg";
  const v = tourImageVariant(u, 1600);
  assert(v.includes("fit=scale-down"));
  assert(v.includes("width=1600"));
  assert(v.endsWith("/tour_img/TEST.jpg"));
  assert(!v.includes("height=180"));
  assert.equal(
    tourImageVariant(u.replace("cdn.getyourguide.com", "evil.example"), 1600),
    u.replace("cdn.getyourguide.com", "evil.example"),
  );
  assert.equal(
    tourImageVariant("/images/fixture.jpg", 1600),
    "/images/fixture.jpg",
  );
  assert.equal(tourImageVariant(u, 99999), u);
  assert.equal(
    tourImageVariant(u + "?token=private", 1600),
    u + "?token=private",
  );
});
test("Information facts: exact source duration/range, no guessed timings or included pickup", () => {
  const document = (raw: string) => ({
    highlights: { ru: ["ТЕСТ"], en: ["TEST"] },
    externalProduct: {
      source_metadata: { original: { duration_and_features_text: raw } },
    },
  });
  assert.equal(
    sourceInformationFacts(document("4 години")).duration?.ru,
    "4 часа",
  );
  assert.equal(
    sourceInformationFacts(document("3 дні • Приватна група")).duration?.en,
    "3 days",
  );
  assert.equal(
    sourceInformationFacts(document("3 дні • Приватна група")).format?.ru,
    "Частная группа",
  );
  assert.equal(
    sourceInformationFacts(document("2–4 години • Доступний трансфер")).duration
      ?.en,
    "2–4 hours",
  );
  assert.equal(
    sourceInformationFacts(document("Доступний трансфер")).pickupMentioned,
    true,
  );
  assert.equal(
    sourceInformationFacts(document("Разная продолжительность")).duration,
    undefined,
  );
});
test("Approved production details: all cards preserved, facts in dedicated scope, no commercial leakage and exact RU/EN rendering", async () => {
  const s = snapshotSchema.parse(
    JSON.parse(
      await readFile("src/features/tours/published-catalog.json", "utf8"),
    ),
  );
  assert.equal(s.records.length, 2319);
  assert(
    s.records.every(
      (r) =>
        r.informationApproval?.scope === "titles-source-details-images" &&
        r.informationApproval?.digest === informationDigest(r.tour),
    ),
  );
  assert(
    s.records.every(
      (r) =>
        !r.tour.referencePrice &&
        !r.tour.prices.length &&
        !r.tour.availability.length &&
        r.tour.durationMinutes === null,
    ),
  );
  const t = s.records.find(
    (r) => r.tour.slug === "getyourguide-1001869",
  )?.tour;
  assert(t?.informationFacts?.duration);
  assert.equal(t.informationFacts.duration.ru, "4 часа");
  assert(t.description.en.join(" ").includes("non-alcoholic"));
  for (const locale of ["ru", "en"] as const) {
    const html = renderToStaticMarkup(
      <TourDetail
        tour={t}
        locale={locale}
        related={[]}
        taxonomy={s.taxonomy}
      />,
    );
    assert(html.includes("activity-highlights"));
    assert(html.includes("activity-questions"));
    assert(html.includes("www.met.gov.my"));
    assert(html.includes('dateTime="2026-10-30"'));
    assert(html.includes(locale === "ru" ? "Официальный источник" : "Official source"));
    assert(html.includes(locale === "ru" ? "Продолжительность" : "Duration"));
    assert(!html.includes("booking-widget"));
    assert(html.includes("width=1600"));
  }
  const bad = structuredClone(s);
  bad.records[0].tour.informationFacts!.duration = {
    ru: "999 часов",
    en: "999 hours",
  };
  assert.equal(
    (
      await staticCatalogRepository(bad).list({
        locale: "en",
        page: 1,
        pageSize: 9,
      })
    ).total,
    2316,
  );
});
