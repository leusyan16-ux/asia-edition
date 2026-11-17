# Official visitor guidance — 30 October 2026

Three narrowly matched guidance profiles accompany information-only detail pages in RU/EN. They are destination advice, not supplier inclusions or booking terms. No tour record, snapshot, price, draft status or protected editorial card is modified.

Verified primary sources:
- Gardens by the Bay visiting guidelines: https://www.gardensbythebay.com.sg/en/plan-your-visit/visiting-guidelines.html — no eating/drinking in Flower Dome and Cloud Forest; respect plants; stroller users should use lifts. Check the linked official opening/closure calendar before travel.
- METMalaysia Langkawi district forecast: https://www.met.gov.my/en/forecast/weather/district/Ds001/ — live forecast link only; no stale forecast, sailing clearance or promised departure imported.
- Panorama Langkawi SkyCab: https://langkawiskycab.my/en/help/on-the-day/weather-and-closures — weather/technical stoppages and rescheduling/exchange guidance. No guarantee of refund or extension of operator terms to a reseller package.

Profiles match explicit attraction names and country, never every product in a country. Marine-specific advice is restricted to the sea category. Unmatched products retain the existing generic preparation checklist.

Excluded evidence: APSARA page returned 403; PETRONAS page failed retrieval; Universal Studios guide PDF returned 404. No visitor rules from these unavailable pages have been published. No protection bypass or repeated blocked requests.

Regression tests cover matching, negative geography/title cases, RU/EN presence, HTTPS sources, immutable 2319-record snapshot and nonzero actual coverage. Local PostgreSQL tests remain local tests, not Supabase production verification.

Actual coverage: 74 unique information cards (15 Gardens by the Bay, 59 Langkawi; 5 of the latter also match SkyCab). Local checks: 111/111 tests, TypeScript, ESLint and production build passed. Original local catalog and protected editorial-26 SHA256 hashes unchanged.
