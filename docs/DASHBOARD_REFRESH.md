# Dashboard freshness — staging, 2026-11-11

## Event-to-database path

After explicit analytics consent and client hydration, the browser posts events immediately to `/api/analytics`; there is no batch queue, cron delay or timer before sending. The handler awaits `commerce_record_event` and only returns HTTP 204 after a successful database operation. Failures are not counted as success. A marked live staging pageview probe completed in **2.074622 seconds**, including network and server/database time. This single observation is not a latency guarantee. The exact QA row is removed by the existing guarded verification script.

`pageview` is emitted for route/query navigation; `visit` is emitted once per UTC day per tab's session storage after consent. The daily chart displays visit event hit totals and persisted request counts, not all pageviews or every event type. Other activity metrics update in the Dashboard alongside it.

## Before and after

Previously, the Dashboard queried Supabase when the route was opened or manually refreshed. There was no polling or realtime subscription. The page already uses `dynamic = "force-dynamic"`; the RPC and private chart reader have no application data TTL or aggregate cache. The browser could keep displaying its previously rendered snapshot indefinitely.

The new client control calls **Next.js `router.refresh()` every 30,000 ms** while the tab is visible, online and not already refreshing. This requests a new Server Component payload and fresh database reads, without document reload, changing URL/search parameters or clearing client chart/scroll state. Both `days` and `chartDays` selections remain intact. The same server authorization, MFA and RLS checks run again.

Hidden/offline tabs pause; returning to the tab or regaining connectivity requests a catch-up refresh. Simultaneous focus/visibility triggers and manual/automatic clicks are coalesced. The toolbar shows the last successful load time in UTC and offers a manual refresh. The unavailable-data screen also retries, without claiming a successful timestamp. All timers/listeners are cleaned up when leaving the Dashboard. Polling the admin route does not itself create visitor analytics events.

A committed event normally appears on the next active-tab refresh: up to 30 seconds plus request/render latency. Browser throttling, a slow network/database, a pending refresh, offline/hidden state or an expired session can extend this. No exact delivery-time SLA or websocket/realtime behaviour is claimed.

## Checks

- 140/140 automated tests; TypeScript and ESLint passed.
- Six isolated browser scenarios: mobile/desktop × 7/30/90 selected days. Controlled test clocks verified 30-second refreshes, retained URL and input state, no document reload, pause/resume, manual refresh and cleanup. The Next router was mocked only in local ignored QA fixtures; no mock authentication was added to the website.
- Live staging verification measures a real event write, checks database visibility and removes only its QA marker. Existing read-only 7/30/90 chart probes run during the Preview build, logging aggregates only.
- Authenticated Owner browser polling was not impersonated. Deployed route smoke checks retain guest redirects and protected data access.

Production, catalogue, migrations and existing customer requests are unchanged.
