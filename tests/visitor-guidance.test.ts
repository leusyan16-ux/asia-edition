import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  visitorGuidance,
  visitorGuidanceProfiles,
} from "../src/features/tours/visitor-guidance";
import type { Tour } from "../src/features/tours/model";
test("Official guidance matches the named destination, never merely the country", () => {
  const t = (country: Tour["country"], en: string, category = "sea") => ({
    country,
    title: { ru: "", en },
    category,
  });
  assert.equal(
    visitorGuidance(t("malaysia", "Langkawi sunset cruise")).length,
    1,
  );
  assert.equal(visitorGuidance(t("malaysia", "Langkawi SkyCab")).length, 2);
  assert.equal(visitorGuidance(t("singapore", "Gardens by the Bay")).length, 1);
  assert.equal(
    visitorGuidance(t("singapore", "Singapore city tour")).length,
    0,
  );
  assert.equal(visitorGuidance(t("thailand", "Langkawi")).length, 0);
  assert.equal(
    visitorGuidance(t("malaysia", "Langkawi city walk", "city"))[0].tips.length,
    1,
  );
  for (const p of visitorGuidanceProfiles) {
    assert.equal(new URL(p.source).protocol, "https:");
    for (const tip of p.tips) {
      assert(tip.ru.length > 20);
      assert(tip.en.length > 20);
    }
  }
});
test("Source guidance leaves published records and commercial fields unchanged", () => {
  const s = JSON.parse(
    readFileSync("src/features/tours/published-catalog.json", "utf8"),
  );
  const before = JSON.stringify(s);
  const coverage: Record<string, number> = {};
  for (const r of s.records)
    for (const p of visitorGuidance(r.tour as Tour))
      coverage[p.id] = (coverage[p.id] || 0) + 1;
  assert.equal(JSON.stringify(s), before);
  assert.equal(s.records.length, 2319);
  assert(coverage["langkawi-weather"] > 0);
  assert(coverage["gardens-by-the-bay"] > 0);
  assert(coverage.skycab > 0);
  console.log("Official guidance coverage", coverage);
});

