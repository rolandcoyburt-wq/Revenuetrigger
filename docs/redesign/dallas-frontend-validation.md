# Dallas frontend preview integration

Base main: `22d1d58dbbf69eee46c979177824ef9ac8cda5af`.
Branch: `integration/frontend-dallas-v1`.
Validated frontend: `880454ea524ba9e929923e7531ec0cd0dfd07abd`.
Validated backend: `0e3a1d500173c701a874f9b6f56de6f8e7a3d56e`.
Reviewed backend runtime: `90efe3e228e9f5ca588c29a4f50ed42a710f3198` (unchanged).
Configured preview API: `https://278f022f-signalhound-api.rolandcoyburt.workers.dev/api`.
Validated frontend alias: `https://integration-frontend-dallas-v1-signalhound-phoenix.rolandcoyburt.workers.dev`.

## Changes

Dallas joins shared market configuration, opportunity/account/onboarding selectors, Sources, Competitors and marketing coverage. Dallas and Fort Worth remain distinct. Territory remains six selected markets. Early Pipeline remains Chandler-only. Existing public teaser, request race, authentication, billing and feed-state code is unchanged. A legacy mobile pointer-events rule is overridden for the Competitors market buttons.

Production API/checkout settings, D1 bindings, Stripe configuration and backend runtime code are unchanged. The backend follow-up changed only preview ALLOWED_ORIGIN and FRONTEND_URL. PR #6 and PR #8 remain Draft. Dallas is still disabled on the deployed production frontend.

## Local checks

All external services in browser regressions are mocked; local tests are not proof of real authenticated preview operation.

| Suite | Result |
| --- | --- |
| Dallas desktop/mobile | 18 scenarios pass at 390 and 1366 px |
| Account preferences | 8 scenarios pass |
| Frontend public funnel, logout and request races | 22 checks pass |
| Frontend checkout | 48 cases pass; no Stripe request |
| Combined release config | 13/13 checks pass against the combined approved backend + frontend tree; includes four host mappings, runtime identity, origins, D1 isolation, Stripe configuration, live markets, plan cap, Chandler-only pipeline and 8/3 public limits |
| Encoding | 8 groups pass: pure display mappings, six Arizona detail/wrapping cases, shared display/escaping |
| Homepage hero public context | Pass |
| Approved backend Dallas integration | 32/32 pass |
| Approved backend Fort Worth integration | 4/4 pass |
| Approved backend stored feed / Arizona filters | 26/26 pass |
| Approved backend public funnel | 66/66 pass |
| Approved backend checkout | 12/12 pass |

The same four backend suites on the frontend main base also passed (106 checks). Separately, the optional direct-network Dallas live-validation script received `DallasNow Building Issued parameter GET failed: 403` from this execution environment. No bypass was attempted. This is distinct from the already-approved deployed Worker's genuine ingestion and the successful stored preview feed below.

Dallas browser checks cover anonymous Reveal, sanitized rows, full authenticated detail, long wrapping, source attribution, account and onboarding persistence across reload, rejection of eight markets, two different valid six-market selections including Dallas/Fort Worth, Saved across reload, logout clearing, mixed Dallas/Fort Worth, Sources, Competitors mobile taps, homepage coverage, and page overflow/errors.

## Completed remote validation

A read-only request to the pinned backend returned HTTP 200, fresh Dallas feed, eight approved-field teasers, 290 scanned stored records and 284 clustered opportunities. Allowed row fields were exactly id, market, name, date, score, temperature, value, categories, stage, publicPreview.

Further read-only remote checks passed: mixed Dallas + Fort Worth feed HTTP 200/fresh with both markets and eight sanitized teasers; anonymous Chandler pipeline HTTP 200 with three teasers; anonymous Dallas `/api/leads` HTTP 401; `/api/sources` lists Dallas and Fort Worth live.

The CORS/auth-return mismatch is resolved. Backend preview `278f022f` returns the Dallas frontend origin in preflight, and preview ALLOWED_ORIGIN / FRONTEND_URL both match the frontend alias above. The deployed frontend targets `https://278f022f-signalhound-api.rolandcoyburt.workers.dev/api`.

The completed real authenticated preview validation, reported by the owner/Core for these exact validated heads, passed:

- Sign-in.
- Dallas preference save and persistence after reload.
- Full stored Dallas opportunity detail.
- Saved Dallas opportunity persistence after reload.
- Competitors with Dallas selected.
- Dallas + Fort Worth mixed behavior.
- Logout immediately clearing privileged state.
- Return to sanitized public state: at most eight opportunities and three Early Pipeline teasers.

These remote results are separate from the mocked local browser checks. They were not repeated solely for this test/documentation correction. Core reported no remaining runtime blocker.

Preview D1 remains `revenuetrigger-preview` / `3e002252-2664-496f-a77f-a3a9880274d8`. Production D1 remains `signalhound` / `5b0156dc-1646-4233-abf7-5d65ef30a317`. Production origins remain `https://revenuetrigger.ai`; production API remains `https://api.revenuetrigger.ai/api`. Existing sandbox Stripe configuration is unchanged.

## Final test/documentation correction

Only `tests/funnel-preview-config.cjs` and this document changed. The corrected test was run in an isolated local combined tree merging approved backend `0e3a1d500173c701a874f9b6f56de6f8e7a3d56e` with frontend `880454ea524ba9e929923e7531ec0cd0dfd07abd`, with the corrected test overlaid. The merge was conflict-free. Node syntax checking and `git diff --check` passed. No runtime files changed on the frontend branch; no merge to main, production deployment, migration or D1 write occurred during this correction.
