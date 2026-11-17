# Product
<!-- impeccable:product-schema 1 -->
## Platform
web
## Stack
Next.js, TypeScript, Tailwind CSS; Supabase reserved for future integration.
## Product Purpose
Independent premium travel marketplace for destinations across Southeast Asia, with Russian and English localization.
## Capabilities and Constraints
First release: visual foundation, country and destination exploration, navigation and local sample search. No payments, authentication, production services or database connections. All sample content is labeled. One demonstration tour uses labeled test prices; there are no invented bookable dates. Real inventory requires supplier verification.
## Open decisions
ASIA EDITION is the approved demo name. Deployment target and real inventory are undecided.

## Approved destination scope
Current public region: Southeast Asia only (UN M49): Thailand, Vietnam, Indonesia, Malaysia, Singapore, Philippines, Cambodia, Laos, Brunei, Myanmar and Timor-Leste. Japan, South Korea and all other non-regional destinations are excluded from public pages and imports. No route may enter or transit Russian Federation territory. Historical country records and the original 26 editorial cards remain intact and private. Russian remains default; English secondary.

## Marketplace phases 1–3
Full tour template and server-filtered catalog now share a validated inventory model. One labeled demonstration tour includes test prices solely to verify presentation/calculation; it has no actual supplier, availability or bookable action. Supabase-compatible schema and read-only adapter are prepared, with connections OFF by default. Administration and real booking requests belong to the next independent phases.

