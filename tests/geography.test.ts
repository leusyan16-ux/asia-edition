import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { countries, allCountries, defaultLocale } from "../src/lib/catalog";
import { geographyError, isAllowedTour, southeastAsianCountries } from "../src/lib/geography";
import { demoTour } from "../src/features/tours/demo";
import { parseQuery, selectTours } from "../src/features/tours/query";
import { tourSchema } from "../src/features/tours/model";
import { prepareImport } from "../src/features/admin/import-engine";
import { localCategories } from "../src/features/admin/local-taxonomy";
import { staticCatalogRepository, staticReviewSchema } from "../src/features/tours/static-catalog";

test("Southeast Asia only: 11 public countries, historical data retained and RU default", () => {
  assert.deepEqual(countries.map((c) => c.slug).sort(), [...southeastAsianCountries].sort());
  assert.equal(defaultLocale, "ru");
  for (const country of ["japan", "south-korea", "china", "turkey"]) {
    assert(allCountries.some((c) => c.slug === country));
    assert(!countries.some((c) => c.slug === country));
  }
  assert(tourSchema.safeParse({ ...demoTour, country: "japan" }).success);
  assert.equal(isAllowedTour({ ...demoTour, country: "japan" }), false);
});

test("Routes: Russia, transit, external source facts and package descriptions are held", () => {
  assert(isAllowedTour({ ...demoTour, languages: ["Russian", "English"] }));
  for (const route of ["Thailand via Moscow", "Транзит через РФ", "Россия", "Vladivostok", "South Korea", "Япония"]) {
    assert(geographyError({ ...demoTour, itinerary: [{ title: { en: route, ru: route } }] }));
  }
  for (const country of ["ru", "RU", "russia", "japan", "united-states"]) {
    assert(geographyError({ ...demoTour, routeCountries: ["vietnam", country] }));
  }
  assert.equal(geographyError({ ...demoTour, routeCountries: ["vietnam", "thailand"] }), null);
  assert(!isAllowedTour({ ...demoTour, externalProduct: { facts: { ...demoTour, country: "japan" } } }));
  assert(!isAllowedTour({ ...demoTour, externalProduct: { commercial: { packages: [{description:{en:"Transfer via Russia"}}] } } }));
});

test("Import rejects disallowed geography; public filters, counts and direct static links exclude it", async () => {
  const input = JSON.parse(await readFile("tests/fixtures/external-products.test.json", "utf8"));
  const taxonomy = {locations: countries.flatMap((c) => c.destinations.map((d) => ({...d,country:c.slug}))),categories:localCategories,operators:[]};
  const original = input.products[0];
  for (const product of [
    {...original.product,country:"japan"},
    {...original.product,routeCountries:["thailand","russia"]},
    {...original.product,meeting:{ru:"Встреча в Москве",en:"Meet in Moscow"}},
  ]) {
    const result = prepareImport(JSON.stringify([{...original,product}]),"json",taxonomy,[],true);
    assert.equal(result[0].action,"error");
    assert(result[0].errors.some((e) => /Southeast Asia|excluded destination/.test(e)));
  }
  const outside = {...demoTour,slug:"archived-japan",country:"japan" as const,isDemo:false,verifiedAt:"2026-10-25T00:00:00Z"};
  const query = parseQuery({},"en");
  assert.equal(selectTours([demoTour,outside],query).total,1);
  assert.equal(selectTours([outside],{...query,search:"Japan"}).total,0);
  const repo = staticCatalogRepository({version:1,records:[{tour:outside,priceWindows:[]}],taxonomy:{locations:[{slug:"kyoto",country:"japan",name:{ru:"Киото",en:"Kyoto"}}],categories:[]}});
  assert.equal(await repo.bySlug(outside.slug),null);
  assert.equal((await repo.list(query)).total,0);
  assert(!(await repo.taxonomy()).locations.some((l) => l.country === "japan"));
  assert.equal(staticReviewSchema.safeParse({digest:"a".repeat(64),publicationApproved:true,imagesApproved:true}).success,false);
});
