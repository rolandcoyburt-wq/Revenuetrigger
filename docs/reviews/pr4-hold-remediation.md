# PR #4 HOLD remediation

Scope: public opportunity funnel only. PR stays Draft; no main merge or production deployment.

## History

Reviewed feature head: `eb5ae87f3956e393d751b84ca5ed93c23b955860`.
Remote main at task start: `c2b5b5d9750cd9b4e108807449f38d6d9b9f66d4` (includes the requested `3bddb9d` plus approved section-label typography).
Merge commit: `e4c317327972768130b0b061f372c6e5f485d665`.
The two parents are the reviewed feature head and current remote main, in that order. No rebase. The sole CSS append conflict retains both public funnel and section-label styles.

## Fixes

- Twelve record-bearing diagnostics now require a valid session or the existing internal admin token before querying data or contacting source systems. Existing authenticated/internal response bodies are retained.
- Public teasers contain only `id`, `market`, `name`, `date`, `score`, `temperature`, `value`, `categories`, `stage`, `publicPreview`. IDs are random UUIDs, not hashes or copies of source IDs. Titles come only from fixed trade labels; source names/scopes never form the public title. Categories, market, stage and temperature use allowlists; dates are normalized to ISO.
- Anonymous feed max is 8; anonymous Early Pipeline max is 3. The unavailable pipeline response does not echo upstream error details.
- Logout clears opportunity/pipeline arrays, current detail, feedback, rendered detail, account selections and open modals before waiting on HTTP. Both anonymous previews reload. Authentication generation/token and individual feed request counters reject late responses, including late JSON bodies. Expired sessions use the same clearing path. Ancillary account/feedback/changes responses cannot restore privileged state after logout.
- Remaining counts subtract the returned sample, independently of client-side filtering, and say “additional opportunities detected across this market window.” Existing fresh/stale/partial/empty/unavailable state labels remain visible.

## Anonymous route exposure matrix

All rows apply equally with and without the `/api` prefix. OPTIONS remains CORS-only.

| Routes | Anonymous behavior | Authenticated/internal behavior |
| --- | --- | --- |
| `/feed` | Read-only allowlisted teasers, max 8; aggregate counts and freshness | Same public contract; full feed uses `/dashboard` |
| `/pipeline` | Allowlisted teasers, max 3; aggregate source state/counts; sanitized unavailable response | Existing full pipeline and diagnostics |
| `/leads`, `/score-audit`, `/temperature-calibration` | 401, error only; no record/source reads | Existing full diagnostics; session or admin token |
| `/backfill-preview`, `/historical-coverage` | 401, error only | Existing diagnostics; session or admin token |
| `/relationship-gap-candidates`, `/relationship-candidates`, `/relationship-health` | 401, error only | Existing diagnostics; session or admin token |
| `/tempe-enrichment-preview`, `/attribution-health`, `/tucson-recheck-preview`, `/source-health` | 401, error only | Existing diagnostics; session or admin token |
| `/roc/meta`, `/roc/search`, `/relationships`, `/competitors` | Existing 401 | Existing session requirements |
| `/dashboard`, `/saved`, `/feedback`, `/changes`, `/competitor-watchlist`, `/export.csv` | Existing 401 | Existing full account/entitlement behavior |
| `/admin/alerts-preview`, `/admin/alerts-test`, municipal `/admin/*-debug`, `/refresh` | Existing admin-token rejection | Existing admin requirements |
| `/health`, `/sources`, `/backfill-status`, `/changes-teaser` | Service/coverage/aggregate metadata only; no opportunity records | Unchanged |
| `/auth/request`, `/auth/verify`, `/subscribe`, `/logout` | Existing authentication/account flows; no public opportunity detail | Unchanged |
| `/billing/checkout`, `/billing/sync`, `/billing/portal`, `/stripe/webhook` | Existing session/signature enforcement | Existing billing behavior |

## Tests

Full stdout and exit codes: `pr4-hold-test-results.txt`.

- Stored feed: **24/24**; six old full-record assertions updated to the teaser contract, preserving read-only, clustering, market and freshness checks.
- Public backend security: **66/66**; both route aliases, expired tokens, polluted fields, random IDs, max limits, full authenticated dashboard/diagnostics, unavailable pipeline errors.
- Frontend state and rendering: **22/22**; immediate logout clearing, header/body races for dashboard and pipeline, late `/me`/preferences/billing-sync/changes, expired sessions, Reveal, count semantics, five feed states, encoding/redaction.
- Fort Worth: **4/4**; adapter normalization/pagination, integration, Dallas exclusion and Territory six-market cap.
- Backend checkout: **12/12**; both aliases/all plans, enabled test-mode checkout and disabled guard, mocked Stripe/D1.
- Frontend checkout: **48/48**; all four entry points, all plans, signed in/out, current and retained preview baseline. The old production-disabled expectation was stale relative to the approved test-mode release and is corrected.
- Preview configuration assertions: **PASS**; matching API/origin pair, preview D1 only, unchanged production configuration and Stripe Price IDs.
- JS syntax and `git diff --check`: **PASS**.

All automated tests use mocks/in-memory state. No live Stripe checkout, email, D1 writes, migrations, fixture SQL, refresh or municipal ingestion were invoked by tests. Historical Playwright visual suites are not counted as rerun; this change's frontend state tests execute actual app/format/UI/auth scripts in a minimal DOM.

## Preview pair

Frontend: https://feature-public-opportunity-funnel-v1-signalhound-phoenix.rolandcoyburt.workers.dev
Backend: https://feature-public-opportunity-funnel-v1-signalhound-api.rolandcoyburt.workers.dev/api

This branch’s Cloudflare preview aliases and immutable version URLs select the feature backend; version URLs therefore cannot fall back to production. Use the canonical frontend alias above for validation because backend CORS/auth callbacks allow that matching origin. Production remains `https://api.revenuetrigger.ai/api` with checkout enabled. Backend `[previews.vars]` allows that frontend and uses it for auth/Stripe redirects. Existing preview D1 remains `revenuetrigger-preview` (`3e002252-2664-496f-a77f-a3a9880274d8`). Production configuration before `[previews.vars]` is byte-identical to main. No secrets are copied or edited; existing test Price IDs are unchanged.

Read-only deployed-preview checks must verify the pair after GitHub/Cloudflare finishes building. Authenticated and Stripe regressions above are local mocked tests, not claims of live authenticated or Stripe transactions.

## Deployed preview verification

Cloudflare reported successful frontend and backend builds/deployments for runtime head `03ab677a7dd2ce2a89a13ebebd85568623b44d2c`. The canonical frontend was reloaded after this deployment and renders the matching sanitized backend contract. Browser checks confirmed:

- Mixed markets: 8 teasers, accurate stored-snapshot/stale state, aggregate count wording.
- Fort Worth filter: 8 sanitized teasers; market-window count remains broader than client-side filters.
- Chandler Early Pipeline: 3 teasers.
- Reveal: opens the free-account/sign-in dialog, not full detail.

Direct API and JavaScript-asset navigation was blocked by this execution environment (`ERR_BLOCKED_BY_CLIENT`; shell HTTP 403). Therefore negative-route HTTP status and response-key assertions are worker-level mocked tests, not claimed as direct deployed HTTP probes. Authenticated logout/race and Stripe tests likewise use local mocks; no live account or checkout transaction was created.

The preview configuration test verifies the API mapping, matching CORS origin and preview-only D1 binding. No production deployment, production binding/secret change, D1 writes, migration, fixture SQL or refresh was performed by this work. PR #4 is still Draft; remote main remains `c2b5b5d9750cd9b4e108807449f38d6d9b9f66d4`.

## Complete PR changed-file list against merged main

- `backend/worker.js`
- `backend/wrangler.toml`
- `backend/tests/checkout-disable.test.mjs`
- `backend/tests/feed-readonly.test.mjs`
- `backend/tests/public-funnel.test.mjs`
- `frontend/public/assets/rt-app.js`
- `frontend/public/assets/rt-config.js`
- `frontend/public/assets/rt-shell.css` (original funnel + merge resolution)
- `frontend/public/assets/rt-ui.js` (original funnel)
- `frontend/public/signals.html` (original funnel)
- `tests/checkout-disable.cjs`
- `tests/funnel-preview-config.cjs`
- `tests/public-funnel.cjs`
- `docs/reviews/pr4-hold-remediation.md`
- `docs/reviews/pr4-hold-test-results.txt`
