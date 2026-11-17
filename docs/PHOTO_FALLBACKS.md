# Photo fallback coverage — 30 October 2026

All 2319 public information products now have a real local country photograph available as a contextual fallback. The 17 records without a product image display that photograph, explicitly labeled as a destination photo in RU/EN. Actual product galleries remain unchanged in storage; no itinerary, price, media right or publication status is invented.

Cards, related excursions and information detail pages share the same country-photo helper. If a supplier derivative fails, the original URL is attempted first. If that fails too, the labeled local destination photograph is displayed. A destination photograph is not added to the product gallery or represented as a confirmed programme stop.

Local browser checks: screenshot product getyourguide-1001518 plus a photo-less Laos detail, RU 1440px and EN 390px; no image placeholders, image loads confirmed, no overflow or page errors. Forced external CDN failure still loads local photographs for all three related cards.

Regression coverage checks all 2319 records, all 17 no-photo details/cards in both languages, unknown/excluded destinations and the existing unverified-media gate. The previous GetYourGuide test now expects approved local contextual photography, while still rejecting unverified external media and prices.

Original local catalogue and protected 26 editorial cards remain unchanged by SHA256 checks. No Supabase, booking, payment or public snapshot changes.
