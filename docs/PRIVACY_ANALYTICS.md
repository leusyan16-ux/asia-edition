# Privacy and analytics — staging, 2026-11-11

Scope: staging Preview only. No catalogue, request, migration or Production changes.

## Automatic operational data

Authentication/session handling, user-requested cart/favorites persistence, request processing, permissions and abuse prevention remain functional regardless of optional analytics choice. Dashboard registration totals, request counts and CRM statuses derive from existing operational records, not browser tracking events. Technical diagnostics remain in hosting/server logs; they are not an additional visitor funnel or a new analytics identifier.

No consent-free behavioural tracking or consent-free visitor/geography counter was introduced. Audience-measurement exemptions are conditional, not automatic: [CNIL guidance](https://www.cnil.fr/en/sheet-ndeg16-use-analytics-your-websites-and-applications). Necessary storage must serve its stated necessary purpose: [ICO guidance](https://app-ico-public-prod-uksouth.azurewebsites.net/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/what-are-the-exceptions/).

## Optional data

Explicit Allow enables existing visit/page/catalog/product/search/filter/cart/checkout/request/chat/auth events, device category, external referring hostname and approximate network country/city. Browser events are ignored without `ae-analytics=yes`; the server independently enforces this signal. No account ID is sent to analytics. The server derives a daily pseudonymous network identifier transiently; raw IP and full user-agent are not stored in the analytics table. This is pseudonymous aggregation, not a claim of mathematical anonymisation.

Recognisable contacts, telephone/account-like input, full URLs and markup are excluded from free-text dimensions. Search is capped at 120 characters. This filtering cannot identify every possible personal name entered into free text; the policy asks users not to put personal data in search.

## Choice and presentation

- Compact RU/EN notice, explicit equally accessible Allow and Decline, localized policy link.
- No navigation, form blocking, redirect or implicit acceptance after Decline.
- Decision retained up to 180 days; existing legacy choices migrate without changing yes/no. Invalid/expired values do not activate tracking.
- Privacy preferences is available at the page bottom. Opening/closing it retains the decision; explicit revocation stops new optional events.
- Cookie fallback supports browsers that deny localStorage. Cookie restoration does not extend a stored choice's expiry on each navigation.
- Route effects deduplicate page/catalog/search/product emissions within a mounted client route lifecycle. Legitimate repeated navigations/actions still count as separate actions. This is not a globally exactly-once delivery guarantee.
- Dashboard separates operational figures from consent-only audience/funnel metrics. Aggregate data older than 35 days is cleaned on the next event write, as implemented by the existing RPC; no new retention job was claimed.

## Checks

- 135/135 automated tests passed, including expiry/legacy/malformed-choice handling and sensitive dimension filtering; TypeScript and ESLint passed.
- Local isolated browser checks RU 390px / EN 1440px: zero tracking before choice/after refusal, no redirect, cart and sign-in remain accessible, saved decision survives reload, grant starts events, opening preferences does not duplicate pageview, revocation stops subsequent events and preserves cart. API replies were mocked locally; no real accounts or customer requests were created by UI tests.
- Live staging API probes cover no choice, explicit Decline and Allow. The guarded verification script checks zero denied rows and one permitted QA pageview, then deletes only the exact QA path/markers. A separate server-side read checks existing CRM/analytics availability and anonymous RPC denial.

No new third-party tracking SDK, advertising pixel, schema, migration or service key was added. Existing secret values were not changed or printed.
