# Final Preview fixes — 2026-11-11

Staging only: https://asia-edition-staging-pricol1.vercel.app
Deployment: https://asia-edition-p9d56ukv9-pricol1.vercel.app
Production and migrations unchanged.

## Catalogue

- The immutable source snapshot still contains 2319 records. A reversible editorial hold list excludes two from listing, detail lookup and request validation: `getyourguide-1514696` (reported housing-tour presentation pending editorial review) and `getyourguide-632479` (eSIM service outside this excursion collection).
- Visible catalogue: 2317. Country totals: Thailand 364, Vietnam 485, Indonesia 322, Malaysia 304, Singapore 285, Philippines 246, Laos 154, Cambodia 140, Brunei 15, Timor-Leste 2.
- All source records were checked structurally for stable ID duplication, blank RU/EN titles, source photographs, currency/amount shape and geography eligibility. No duplicate stable IDs, blank titles or malformed supplied reference prices found.
- Five pairs of identical normalized titles have different provider activity IDs and remain distinct. No speculative merge.
- Seventeen records lack source photographs and retain destination-image fallbacks. This is not a claim that every photo, translation or commercial price was individually reverified. Full review details are local-only in `qa/catalog-quality-review.json`.
- Empty countries are absent from homepage links, footer and country filters; location filters remain based on eligible inventory. Geographic checks continue to exclude non-regional/RF itineraries.
- Source drafts and the 26 editorial cards were not edited or deleted. No new prices or reviews were invented.

## Interactions

- Cart icon links directly to the cart, with an immediate count and confirmation. Existing revision-checked guest/server cart merging is reused; no competing header merge is triggered by an immediate count update.
- Card/detail hearts toggle, reflect selection and share counts. Guest favorites persist locally; login sync uses the existing unique-key Supabase favorites endpoint. Server-side eligibility and RLS remain enforced.
- Public contact CTA and request-chat destinations use `https://t.me/VN_instal`. Notification bot credentials and outbox code are unchanged.
- Added contrasting header/heart states and keyboard focus. Mobile header avoids horizontal overflow.

## Analytics

- Replaced the authentication throttle reused for analytics with a separate bounded 120-events/minute limiter. Authentication still permits only 10 attempts/10 minutes.
- Daily visit marker now rolls over by UTC date; optional consent remains required.
- Empty visit data displays an explanatory state rather than a misleading requests-only bar chart. Funnel/geography/popularity empty states explain missing consented activity.
- Live staging ingestion verified eight marked events (`visit`, `pageview`, `product`, `search`, `filter`, `cart_add`, `checkout`, `request_success`): one hit each with consent, zero without consent. Approximate country/city populated. These were explicit analytics QA events, not real bookings or new customer requests.
- All QA event rows were removed by exact test path/markers. Real visitor rows were not deleted. Live verification found one active Owner and four existing requests; no new real requests or Telegram messages were created in this run.

## Verification and limits

- 133/133 automated tests passed; TypeScript, ESLint and Vercel Next.js build passed.
- Isolated browser tests: RU 390px and EN 1440px, guest favorites toggle, immediate cart count, cart navigation, persistence after navigation, guest-to-account synchronization, request UI and emitted consented funnel events. API responses in these local UI tests were mocked; no live account/booking was fabricated.
- Live protected Dashboard/CRM RPCs deny anonymous and staff-less service calls. Actual Owner browser rendering was not impersonated; existing Owner/MFA checks remain unchanged.
- Preview promotion to Production still requires the owner's separate authorization.
