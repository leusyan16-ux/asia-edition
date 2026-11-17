# Analytics staging verification — 2026-11-11

Scope: Supabase `xnnxmhwvixrqenunhhbt` and Vercel Preview only. Production unchanged.

## Cause and repair

The Dashboard failure was caused by missing migration-010 objects, not empty analytics or merely a PostgREST cache delay. The owner confirmed the absence of `commerce_analytics_daily` and three RPC signatures through SQL Editor.

The owner successfully applied `supabase/commerce010-staging-repair.sql`. It adds missing 010 objects transactionally, preserves existing function bodies and records, restores original grants/RLS, and requests a PostgREST schema reload. Do not rerun the earlier function-only repair as a substitute.

## Live checks completed

- All three 010 tables are accessible with the staging server role through real GET queries.
- One active Owner remains; no bootstrap or account creation performed.
- Invalid event rejected with PostgreSQL `23514`.
- Dashboard and customers RPCs reject anonymous access (`42501`) and server-key calls without a staff identity (`P0001`).
- Anonymous HTTP event without consent: HTTP 204, zero database rows.
- Anonymous HTTP event with consent: HTTP 204, exactly one database hit; approximate geography populated by Vercel.
- Only the exact QA path/markers were removed afterward; real visitor records untouched.
- RU/EN catalogs: HTTP 200, 2319 count present.
- Guest access to analytics/customers/orders: HTTP 404; guest session endpoint: HTTP 200.
- 127/127 automated tests passed; TypeScript and ESLint passed. Vercel Next.js build passed.

## Deployment

- Preview: https://asia-edition-g9fddihuf-pricol1.vercel.app
- Staging alias: https://asia-edition-staging-pricol1.vercel.app

The successful Preview builds ran guarded verification scripts using existing sensitive Preview variables. No credentials were printed, no temporary QA files uploaded, and local `package.json` was restored to `next build`.

## Owner-session acceptance still required

The user's authenticated browser could not be controlled safely because its URL could not be established. Therefore successful rendering of the Owner Dashboard/CRM is not claimed as a completed live browser check. Refresh `/admin/analytics`, `/admin/customers`, and `/admin/orders` in the existing MFA-confirmed Owner session. Local tests cover allowed Owner AAL2 access, denied AAL1/ordinary access, CRM responses, additive repair and idempotence.

This Preview verification does not authorize a Production deployment.

## Admin session recovery follow-up

The admin routes previously converted every identity/MFA failure into `notFound()`. Unlike the account API client, direct Server Component navigation did not run the bounded session refresh. This concealed expired or unavailable identity checks as a missing route; the exact state of the user's private cookie was not inspected.

The routes now redirect unauthenticated requests to `/admin/login?next=...`. That screen invokes the existing session API (one refresh/retry), then retries the original server-protected route. Return destinations are allowlisted. Role and MFA checks remain mandatory; no session tokens are exposed to browser JavaScript.

Latest Preview: https://asia-edition-438ri7r3m-pricol1.vercel.app, attached to the same staging alias.

Live guest checks after alias update: admin login 200; analytics/orders/customers 307 to the login screen; RU/EN catalogs 200 with 2319 count; session API 200 and orders API denies unauthenticated access. TypeScript, ESLint, Vercel build and 130/130 tests passed. Owner rendering still requires an actual MFA-confirmed Owner session; no such session was fabricated or bypassed.
