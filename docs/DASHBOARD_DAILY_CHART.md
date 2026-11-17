# Daily Dashboard chart — staging, 2026-11-11

Preview: https://asia-edition-staging-pricol1.vercel.app/admin/analytics
Deployment: https://asia-edition-4uinftt51-pricol1.vercel.app

## Delivered

Grouped visit/request bars, integer Y axis, UTC date X axis, legend, period totals, 7/30/90-day chart selector, hover/tap/keyboard inspector, explicit zero markers and an accessible daily table. Long periods scroll within the chart and open at recent dates; bar width is capped independently of period length. Summary/funnel periods elsewhere on the Dashboard remain unchanged and have their own selector.

Visits use actual `visit` event hit totals, rather than relabelling the legacy RPC's distinct daily visitor counts as visit totals. The consent restriction is visible next to the chart. Request totals use durable operational records, excluding the same `@example.invalid` test contacts excluded by the existing Dashboard RPC.

## Retention and access

The existing RPC permits only 1/7/30 days and deletes analytics days older than `current_date - 35`. No applied migration or retention policy was changed. The new private aggregate reader supports 90-day requests using existing tables. Analytics days outside the retained window are `null`, shown as unknown, never fabricated zero. Totals disclose when visit coverage is partial. Missing days inside the retained window are zero recorded consented visits, not zero real-world visitors.

The page requires authenticated Owner/admin and AAL2 before creating the server-only analytics reader. Order reads retain the authenticated staff client and RLS. The analytics service credential remains server-only. Raw source rows, visitor hashes, order IDs and credentials are not passed to the client. Reads use bounded 500-row keyset pages and aggregate into daily maps; errors do not produce a misleading partial/zero chart.

## Verification

- 139/139 automated tests passed; TypeScript, ESLint and Vercel build passed.
- 18 isolated browser combinations passed: mobile 390px / desktop 1440px; 7/30/90 days; zero/small/large counts. Checked dates, all days, hover/tap selection, keyboard, unknown retention days and page overflow. Synthetic fixtures remain under ignored `qa/` and are not used by the deployed page.
- Read-only staging checks of the production reader returned 7/30/90 daily slots, with visit coverage of 7/30/36 calendar days including today. At verification time, each range contained 3 visit hits and 4 non-example test-domain requests. No test visits or requests were inserted.
- Real PostgREST keyset cursor syntax accepted. Only aggregate counts were logged.
- Public guest access to Dashboard remains a login redirect, not exposure of analytics. No Owner session was impersonated; authenticated visual rendering was exercised using isolated local fixtures, and the deployed data reader was checked against real staging data separately.

Production, catalogue, customer records and database schema were not changed. For a complete future 90-day visit history, a separate retention/privacy-policy decision and SQL change would be required; historical purged data cannot be recovered by this UI.
