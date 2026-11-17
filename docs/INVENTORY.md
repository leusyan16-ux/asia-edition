# Inventory architecture — phases 1–4

The platform includes the inventory model, reusable tour template, filtered catalog and phase 4 administration (uploads, duplication, CSV imports). Phase 5 persisted booking requests remains separate work. There are no live payments, customer records or outgoing confirmations.

## Boundaries

- `supabase/migrations/202610100001_tour_inventory.sql`: normalized PostgreSQL schema, 13-country allowlist, publication guards, indexes, RLS and public read RPCs. It seeds country/category taxonomy only, never tours, operators or availability.
- `src/features/tours/model.ts`: Zod-validated aggregate used by the server repository and all presentation components.
- `src/features/tours/repository.ts`: server-only read adapter. Default source is the single fixture in `demo.ts`. No database connection occurs in demo mode. Supabase mode never falls back to fake data after an error.
- `query.ts`: server input validation, filtering, sorting and paging. Currency filters compare amounts only within one currency; no exchange rates are invented.
- `components`: shared gallery, tour cards, filters, content sections and booking preview. Missing localized sections are omitted. No reviews or invented operators are rendered.

## Relational data

Countries → locations (city, resort, destination, optional parent) → tours. Composite keys prevent cross-country assignments. Turkish locations require an explicit verification flag for Asian territory. Countries are restricted to the approved list.

Tour translations contain RU/EN titles, paragraph descriptions, highlights, inclusions/exclusions, schedule copy, transportation, meeting/pickup copy, cancellation/participation conditions and SEO. Ordered child tables hold images, itinerary steps, FAQ, pickup locations and meeting points. Image records include source/credit fields.

Operators have public names and verification timestamps; supplier contacts and contracts live in a separate table with no public read policy. Prices use decimal amounts and ISO-style currency codes, adult/child amounts and child age bands, optional effective date ranges and a verification timestamp. Null child pricing never implies free entry. Recurring schedules are distinct from confirmed dated slots with capacity, reserved count, status and verification.

`draft`, `published` and `unavailable` are supported. Start imports as drafts, attach both languages and images, verify the operator and inventory, then publish. Public readers receive only published, verified, non-demo tours from verified operators. Prices and dates have their own verification gates. Public roles cannot write any table. Publication without RU/EN descriptions and an image is rejected.

## Integration rehearsal

1. Use an isolated Supabase test project. Apply the migration there; do not apply it to existing production services.
2. Generate Supabase database types using that project's verified schema when implementing administration.
3. Import approved locations, operators and tours as drafts. Preserve supplier references and image rights. Populate schedules, rates, itinerary and conditions from verified sources.
4. Verify RLS with anon and authenticated clients, including attempts to read draft translations, supplier contacts and unverified rates/slots. Test the public RPC output against `tourSchema`.
5. Set `TOUR_DATA_SOURCE=supabase`, the project's URL and public anon key only in the isolated environment. The app uses public read access; never add a service-role key to browser configuration.
6. Rebuild to allow that project's `tour-images` public storage bucket host in Next Image. Other external image hosts require an explicit allowlist decision. Administration now supports safe uploads; configure Storage policies as described in `ADMIN.md`.

Only after this integration has been tested should real inventory replace the demo. The present migration has been exercised with an embedded PostgreSQL engine; that is not a deployed Supabase integration test. No migration has been applied to an external database.

## Booking limits and phase 5 requirements

The widget demonstrates prices, guest counts and verified-date presentation. Its action is always disabled, for demo and real data alike. It does not store or send customer data. Sample USD 100 / USD 50 values are clearly labeled display fixtures, not commercial prices.

Phase 5 must select an exact departure slot and its date-effective rate, validate guest ages/limits on the server, recalculate totals from database prices, and atomically reserve capacity with locking/idempotency. A daily preview uses the maximum available capacity of an individual departure rather than summing incompatible slots. It is not a guarantee of bookable space. Customer PII, booking RLS, retention and confirmation delivery need a separate reviewed design. Payments remain off until explicitly authorized and tested.

## Phase 4 administration

Implemented protected administration, fresh role checks, server mutation validation, transactional aggregate RPCs, optimistic concurrency, image sanitization/storage policies, CSV preview with per-row errors and atomic draft import, duplication/archival and audit events. The admin migration extends the existing normalized inventory; public RLS remains in place and respects visibility/archive flags. Setup and operational limits are documented in `ADMIN.md`. Booking management still requires the separate phase 5 request schema; no bookings are fabricated.

## Validation

`pnpm test` runs domain filters/pagination, sparse-template rendering and the actual SQL migration/RLS/RPC against temporary PGlite PostgreSQL. The 360 scale records exist solely in that transient test database. `pnpm typecheck`, `pnpm lint` and `pnpm build` validate the application.
