# Dallas frontend preview integration

Base main: `22d1d58dbbf69eee46c979177824ef9ac8cda5af`.
Branch: `integration/frontend-dallas-v1`.
Reviewed backend: `90efe3e228e9f5ca588c29a4f50ed42a710f3198`.
Configured preview API: `https://cfe9680c-signalhound-api.rolandcoyburt.workers.dev/api`.
Expected frontend alias: `https://integration-frontend-dallas-v1-signalhound-phoenix.rolandcoyburt.workers.dev`.

## Changes

Dallas joins shared market configuration, opportunity/account/onboarding selectors, Sources, Competitors and marketing coverage. Dallas and Fort Worth remain distinct. Territory remains six selected markets. Early Pipeline remains Chandler-only. Existing public teaser, request race, authentication, billing and feed-state code is unchanged. A legacy mobile pointer-events rule is overridden for the Competitors market buttons.

Production API/checkout settings and all backend configuration, bindings and code are unchanged. No production deploy, main merge, D1 write or migration was performed. PR #6 stays Draft. Dallas is still disabled on the deployed production frontend.

## Local checks

All external services in browser regressions are mocked; local tests are not proof of real authenticated preview operation.

| Suite | Result |
| --- | --- |
| Dallas desktop/mobile | 18 scenarios pass at 390 and 1366 px |
| Account preferences | 8 scenarios pass |
| Frontend public funnel, logout and request races | 22 checks pass |
| Frontend checkout | 48 cases pass; no Stripe request |
| Preview config | Pass: four hosts, pinned preview API, production API unchanged, distinct markets, six-market cap |
| Encoding | 8 groups pass: pure display mappings, six Arizona detail/wrapping cases, shared display/escaping |
| Homepage hero public context | Pass |
| Approved backend Dallas integration | 32/32 pass |
| Approved backend Fort Worth integration | 4/4 pass |
| Approved backend stored feed / Arizona filters | 26/26 pass |
| Approved backend public funnel | 66/66 pass |
| Approved backend checkout | 12/12 pass |

The same four backend suites on the frontend main base also passed (106 checks). Separately, the optional direct-network Dallas live-validation script received `DallasNow Building Issued parameter GET failed: 403` from this execution environment. No bypass was attempted. This is distinct from the already-approved deployed Worker's genuine ingestion and the successful stored preview feed below.

Dallas browser checks cover anonymous Reveal, sanitized rows, full authenticated detail, long wrapping, source attribution, account and onboarding persistence across reload, rejection of eight markets, two different valid six-market selections including Dallas/Fort Worth, Saved across reload, logout clearing, mixed Dallas/Fort Worth, Sources, Competitors mobile taps, homepage coverage, and page overflow/errors.

## Remote status / blocker

A read-only request to the pinned backend returned HTTP 200, fresh Dallas feed, eight approved-field teasers, 290 scanned stored records and 284 clustered opportunities. Allowed row fields were exactly id, market, name, date, score, temperature, value, categories, stage, publicPreview.

Further read-only remote checks passed: mixed Dallas + Fort Worth feed HTTP 200/fresh with both markets and eight sanitized teasers; anonymous Chandler pipeline HTTP 200 with three teasers; anonymous Dallas `/api/leads` HTTP 401; `/api/sources` lists Dallas and Fort Worth live.

However, its `Access-Control-Allow-Origin` is still:
`https://feature-public-opportunity-funnel-v1-signalhound-phoenix.rolandcoyburt.workers.dev`

The matching frontend origin is not allowed. Cloudflare dashboard access in this environment remains at its security check; no authenticated Cloudflare API credentials are available here. A pinned Worker version is immutable: updating preview CORS/auth-return settings creates a new configuration version. This needs a preview-only update with unchanged reviewed Worker code, DB `revenuetrigger-preview` / `3e002252-2664-496f-a77f-a3a9880274d8`, and existing test Stripe secrets/Price IDs. Set both ALLOWED_ORIGIN and FRONTEND_URL to the matching frontend alias, then pin the frontend API to that resulting version. FRONTEND_URL also supplies Stripe checkout/portal return URLs.

Real authenticated preview preferences, Saved, Competitors and logout validation remain pending this configuration and an authenticated test session. Do not treat mocked checks as remote validation. No production configuration should be altered to resolve this blocker.
