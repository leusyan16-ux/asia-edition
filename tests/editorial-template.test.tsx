import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { TourDetail } from "../src/features/tours/components/detail";
import { emptyTour, adminDocumentSchema } from "../src/features/admin/model";
import { randomUUID } from "node:crypto";
import { allCountries as countries } from "../src/lib/catalog";
import { localCategories } from "../src/features/admin/local-taxonomy";
import { demoTour } from "../src/features/tours/demo";
const escaped=(value:string)=>renderToStaticMarkup(<>{value}</>);

test("26 editorial templates RU/EN: factual metadata, safe breadcrumbs, original content and no booking controls", async () => {
  const input = JSON.parse(
    await readFile("data/pilots/editorial-26/products.json", "utf8"),
  );
  const taxonomy = {
    locations: [
      ...countries.flatMap((c) =>
        c.destinations.map((d) => ({
          slug: d.slug,
          country: c.slug,
          name: d.name,
          kind: "destination" as const,
          parent: null,
        })),
      ),
      ...input.products.flatMap((p: { locations: [] }) => p.locations),
    ],
    categories: localCategories,
    operators: [],
  };
  const rows = input.products.map((p: { product: object; source_url: string; last_synced_at: string }) => ({tour: {...adminDocumentSchema.parse({...emptyTour(randomUUID()), ...p.product}),externalProduct:{source_url:p.source_url,last_synced_at:p.last_synced_at}},errors:[]}));
  assert.equal(rows.length, 26);
  for (const row of rows) {
    assert.deepEqual(row.errors, []);
    const tour = row.tour!;
    for (const locale of ["ru", "en"] as const) {
      const context = {
        city: tour.city,
        sourceUrl: tour.externalProduct!.source_url,
        checkedOn: tour.externalProduct!.last_synced_at.slice(0, 10),
      };
      const html = renderToStaticMarkup(
        <TourDetail
          tour={tour}
          locale={locale}
          taxonomy={taxonomy}
          related={[]}
          editorial={context}
        />,
      );
      assert.ok(html.includes(`lang="${locale}"`));
      assert.ok(html.includes(escaped(tour.title[locale])));
      assert.ok(html.includes(escaped(tour.description[locale][0])));
      assert.ok(
        html.includes(
          escaped(countries.find((c) => c.slug === tour.country)!.name[locale]),
        ),
      );
      assert.ok(
        html.includes(
          escaped(localCategories.find((c) => c.slug === tour.category)!.name[locale]),
        ),
      );
      assert.ok(html.includes(tour.externalProduct!.source_url.replaceAll('&','&amp;')));
      assert.ok(html.includes('rel="noopener noreferrer"'));
      assert.ok(!html.includes("/pilot-"));
      for (const hidden of [
        "booking-widget",
        "mobile-booking",
        "<select",
        "<input",
        "<img",
        "tour-gallery",
        'id="itinerary"',
        'id="services"',
      ])
        assert.ok(!html.includes(hidden), hidden);
      if (!tour.city)
        assert.ok(
          !html.includes(`<dt>${locale === "ru" ? "Город" : "City"}</dt>`),
        );
    }
  }
  const normal = renderToStaticMarkup(
    <TourDetail tour={demoTour} locale="ru" related={[]} taxonomy={taxonomy} />,
  );
  assert.ok(normal.includes("booking-widget"));
  assert.ok(normal.includes("tour-gallery"));
});
