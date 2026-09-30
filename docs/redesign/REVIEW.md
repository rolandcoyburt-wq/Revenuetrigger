# Revenue Trigger — Signal Command v7 review build

**NOT DEPLOYED TO PRODUCTION.** This is an isolated frontend review branch. Nothing has been merged to `main`. Live-data and real email/Stripe verification remain outstanding, so this is not a production-release sign-off.

- Local branch: `redesign/signal-command-v7`
- Approved commit: `2b0c4bbbd6168a8d893fda3fc77647eaaad99a8c`
- GitHub publication: **not pushed**. Authorized push failed because command-line Git has no GitHub credentials. The connected GitHub API confirmed that this exact commit is not present remotely. No replacement commit or alternate branch was published.
- Repository: `rolandcoyburt-wq/Revenuetrigger`
- Baseline: `db5260fe16e0b9f81b36df71a50797a8b69cc7f3` (matches the Core handoff)
- Backend changes: **none**
- D1, adapters, scoring, temperature, auth contracts, billing contracts, cron, DFW, and Cloudflare configuration: **unchanged**

## Homepage visual pass — September 30, 2026

Parent: `cf08fa51619eb813559d6424598c9e599a684d81`. Presentation-only homepage update; all existing deployment blockers below remain open.

- Kept the header, hero and ticker unchanged. Moved “Signals worth your attention” immediately below “How Revenue Trigger Works,” preserving both sections’ original markup and styling.
- Matched the supplied v7 prototype’s Decision Intelligence palette: `#143b2a` band, `#1a4934` introduction panel and pale record panel. Its record/intelligence content remains populated by the existing `/feed` consumer, with no invented metrics.
- Removed the paired bottom feature cards. Early Pipeline now has its own dark section explaining visibility before ordinary issued permits, a clearly labeled conceptual stage guide and the existing Chandler Pipeline link.
- Added a separate green Competitor Intelligence section covering activity, territory, project mix, momentum and competitive movement. Its visual is labeled “Product overview · not live metrics”; it introduces no fabricated competitor records, metrics or new API calls.
- Preserved Built for Your Trade. Markets now uses a dark theme with “Phoenix Metro + Dallas–Fort Worth” and “Built market by market. Designed nationally.” Phoenix Metro is distinguished from Tucson; DFW remains explicitly planned/not live.
- Hunter’s middle pricing card now uses deep green. Pricing, plan features and checkout handlers are unchanged. Final CTA/footer unchanged.

Verification: all five homepage responsive layout checks passed (390, 430, 768, 1366 and 1920px), with no horizontal overflow or page JavaScript errors. Original hero/ticker/product/opportunity/trade/final-CTA markup was compared byte-for-byte with the parent, and requested section order was checked. Desktop/mobile theme colors, product navigation targets and planned DFW disclosure passed. Section screenshots were visually reviewed; isolated section crops hide the sticky header during capture, while full-page images retain it. All browser network traffic used synthetic/local interception.

The prior 41-check regression and 27-check `/feed` results remain historical passing evidence; only the relevant five layout checks were rerun for this HTML/CSS-only change. No consumer/controller, signed-in dashboard, backend, Arizona adapter, DFW ingestion, scoring, auth/billing or Cloudflare configuration change. No genuine-production validation was performed. Nothing merged or deployed.

Current screenshots: `screenshots/after-home-1366.png`, `screenshots/after-home-390.png`, and ten desktop/mobile section crops in `screenshots/home-visual-pass/`.

## Current review: read-only `/feed` consumer integration

**Review only. Not approved for deployment.** This section supersedes earlier pending `/feed` architecture notes. Parent Work commit: `4d2884a1d828c357f03eae2c1b7517ec4797161f`. Core contract inspected through authenticated GitHub source access at branch `core/read-only-feed`, commit `e1ce8d50544944caef5453ba46812b441fa37d57`. Core’s backend branch was not merged into Work and the local backend remains untouched.

### Consumer changes and state handling

- Marketing requests `/api/feed?days=7&limit=3`; hero, ticker, opportunity previews and Decision Intelligence use those returned records.
- Signed-out Signals requests `/api/feed?days=7&limit=120`, or `limit=200&markets=<selected market>`. Public requests carry no bearer token. No fallback to `/leads` exists.
- Signed-in Signals retains the unchanged `/dashboard?limit=200` request and authorization behavior. Its `loadDashboard` function is byte-for-byte unchanged from the parent commit.
- Public Chandler feed state is no longer overwritten by a separate upstream source-health probe. Signed-in source-health behavior and Early Pipeline loading remain as before. This does not make the entire Signals page a zero-polling page: Early Pipeline still has its separate integration path.
- `fresh`: normal stored-opportunity presentation, no warning. `stale`: retained records with a delayed-update notice. `partial`: retained records with a coverage notice. `empty`: explicit no-stored-opportunities state. `unavailable`: service/data unavailable, no cards, and unknown KPI values shown as dashes rather than measured zeros.
- HTTP failures, malformed JSON and missing/invalid feed state fail honestly. Empty or unavailable responses do not generate sample records. Partial coverage with no opportunities retains both the coverage warning and the no-record state.
- A request sequence guard prevents a slow previous market response from replacing the most recent selection. Filtering retains the reported freshness notice.

Core source inspection confirmed the response envelope includes `state`, `opportunityState`, `leads`, `requested`, counts and per-market `freshness`; the frontend uses Core’s returned state rather than recomputing freshness. Core reported 21/21 backend safety checks; those backend tests were not rerun in Work. No genuine production records or API responses were obtained.

### Visual refinement

The approved v7 direction is retained. Mobile opportunity titles wrap instead of truncating, long company/intelligence text can wrap, narrow-screen Trigger Timelines read vertically, preview actions align at the bottom of cards, and mobile row actions have 44px targets. State notices use subdued amber/neutral treatment; settled status indicators no longer animate. Public calls to action say “See opportunities” rather than promising live data. Missing Decision Intelligence returns no empty metrics panel. Official permit valuation remains separate from amber estimated service opportunity.

### Verification and artifacts

- **41/41 synthetic/local regression checks passed** after the consumer switch and visual CSS refinement, including desktop/mobile layouts, six-market filtering, search/sort, details, Saved, simulated auth/billing callbacks, Competitors and Sources.
- **27/27 synthetic/local `/feed` integration checks passed**, covering five states on both pages at 390px/1366px, HTTP 503, malformed JSON, missing state, partial-with-empty results, signed-in dashboard contract, market-response ordering, long text and sparse intelligence. The layout subset was rerun after the final copy/state polish.
- All browser tests intercepted external requests. Mock account, authentication, preference and Stripe requests remained local simulations; no real email, transaction, account change or production API request occurred.
- `tests/feed-integration.cjs` and `docs/redesign/feed-test-results.json` provide the new reproducible test and results. Existing regression results remain in `docs/redesign/test-results.json`.
- Updated homepage/Signals captures: `screenshots/after-home-1366.png`, `after-home-390.png`, `after-signals-1366.png`, `after-signals-390.png`. Sixteen state examples are in `screenshots/feed-states/` (home/Signals × stale/partial/empty/unavailable × desktop/mobile). All are synthetic/local examples, not sanitized production-shape or live validation.

### Remaining gates

1. Genuine Arizona production-shape validation for all six markets, pending authorized SELECT-only D1 extraction. No genuine fixtures have been supplied.
2. Coordinated Core `/feed` and Work frontend integration in an authorized preview: Core’s implementation exists on its review branch but is not deployed or merged. Confirm the actual contract, states and data parity there before release. The frontend intentionally degrades if `/feed` is unavailable; it does not fall back to `/leads`.
3. Authorized end-to-end Resend/magic-link validation.
4. Stripe test-mode Checkout → callback → webhook/entitlement → Portal validation.
5. Actual Cloudflare preview validation of `/signals`, `/competitors` and `/sources` clean routes.
6. Chandler Early Pipeline genuine-data integration validation, separate from D1 fixtures because Pipeline records are not stored there.
7. Repository publication of exact Work history remains unresolved; the Work branch remains local. Visual changes and state examples remain subject to user review.

Backend, `/leads`, scoring/temperature thresholds, Arizona adapters, DFW, D1 and Cloudflare configuration are unchanged. No production request, merge or deployment was performed. No broad backend refactoring was started.

## Phase 1 closure update — account preference correction

**Current status: PASS for isolated review-branch continuation; NOT approved for production deployment.** This section supersedes earlier handoff plans where they conflict, including the earlier request for a SELECT-only Chandler Early Pipeline fixture.

Core independently verified the exact reviewed commit `2b0c4bbbd6168a8d893fda3fc77647eaaad99a8c` against baseline `db5260fe16e0b9f81b36df71a50797a8b69cc7f3`. Core reported preserved feed/pipeline/Saved/auth/Stripe callback architecture, accurate planned DFW labeling, no backend/schema/adapter/DFW changes and no obvious mobile regression in the supplied artifacts. This is review approval only.

### Isolated correction

A new commit immediately after the reviewed commit changes only:

- `frontend/public/signals.html`: account `prefScore` now includes `75+ HOT` (numeric value 75), with 80 relabeled `80+ HOT · strict`; existing 40/60 options remain.
- `docs/redesign/REVIEW.md`: records the correction, accumulated handoff findings, verification and current blockers.

The correction commit is identifiable as the commit containing this section, titled `Fix account HOT preference options and record Phase 1 gates`. No backend score/temperature thresholds, JavaScript preference persistence behavior, Arizona adapters, DFW code or deployment configuration were changed.

### Focused verification

**8/8 synthetic/local browser cases passed**: each of 40, 60, 75 and 80 at 390px and 1366px. Each case verified account initialization from the stored mock preference, exact option labels/values, numeric preference-save payload, retention after reload, no horizontal page overflow and no page JavaScript errors. All external requests were fulfilled or aborted by local test interception; mock preference saves and billing-sync responses did not contact production or modify real accounts. The initial harness returned the default mock score through billing sync; aligning that mock response with the test account resolved the harness mismatch. No application change beyond the selector was needed.

The earlier **41 passing checks remain synthetic/local validation** and were not rerun for this two-option HTML correction. Genuine fixture validation has not occurred and must not be represented as live API or production integration validation.

### Publication

The authenticated GitHub connector was checked again: fetching the reviewed parent SHA returned `422: No commit found`. Exposed connector operations do not import exact local Git history. The branch remains local, with no replacement-SHA reconstruction, credential request, push, merge or deployment in this closure step. Repository publication will be resolved separately.

### Current deployment blockers

1. **Genuine Arizona production-shape validation:** pending authorized SELECT-only D1 access for Phoenix, Tempe, Tucson, Scottsdale, Mesa and Chandler. Core has an extraction kit but no genuine records have been supplied. Synthetic records must not be relabeled genuine.
2. **`/leads` architecture decision:** the homepage currently consumes `/leads`, which can refresh/persist when stored records are absent. Core will decide the architecture separately. No behavior change or `/leads` call was made for this correction.
3. **Real passwordless authentication:** authorized end-to-end Resend/magic-link validation remains outstanding.
4. **Stripe:** test-mode Checkout → callback → webhook/entitlement → Portal validation remains outstanding.
5. **Cloudflare clean routes:** `/signals`, `/competitors` and `/sources` require validation in an actual Cloudflare preview environment.
6. **Chandler Early Pipeline real-data integration:** Core confirms these records are not stored in D1; SELECT-only extraction cannot provide them. Real-data validation is a separate integration requirement, not part of the D1 fixture gate.

No production API requests, production data modifications, backend edits, adapter edits, DFW edits or Cloudflare security changes occurred during this correction. Nothing was merged or deployed. Codex Phase 2 has not begun. Work stops after this isolated correction and report.

## What changed

The root is now the v7-inspired marketing experience. The complete Opportunity Feed and Chandler Early Pipeline live on `/signals`, with their existing vanilla JavaScript behavior retained. The shared stone/paper/graphite presentation uses production SVG assets, green actions and amber estimated values.

The homepage requests three current records from the existing public `/leads` API. They populate the hero, activity ticker, opportunity previews and Decision Intelligence example. Missing intelligence is omitted. Failed requests show an unavailable state. Dallas–Fort Worth is explicitly planned and not live. Scout remains a subscription plan; no pretend Scout intelligence or CRM Pipeline route was created.

The existing pricing plan names, prices, feature lists and checkout contracts were copied unchanged. The marketing root processes existing magic-link and billing callbacks. Saved route state and pending plan selection survive the magic-link return.

### Changed files

| File | Purpose |
| --- | --- |
| `frontend/public/index.html` | Marketing homepage with existing pricing and passwordless sign-in entry. |
| `frontend/public/signals.html` | Extracted working feed, Early Pipeline, account, onboarding, detail, feedback and scoring modals. |
| `frontend/public/competitors.html` | Shared application navigation, visual styling, session helper integration and clean links; existing intelligence logic retained. |
| `frontend/public/sources.html` | Shared public navigation, visual styling, session helpers and clean links; source diagram behavior retained. |
| `assets/rt-config.js` | Shared API base and current Arizona market list. |
| `assets/rt-auth.js` | Shared session access, passwordless request/verification and authenticated request helpers. |
| `assets/rt-shell.js` | Public/application headers, mobile menus and modal keyboard/focus support. |
| `assets/rt-shell.css` | Shared design tokens and application/existing-page presentation overrides. |
| `assets/rt-legacy.css` | Existing production styles extracted intact to retain responsive layout and modal behavior. |
| `assets/rt-format.js` | Existing title/company/money display helpers shared by marketing and Signals. |
| `assets/rt-ui.js` | Shared opportunity cards, authoritative temperature badges, Trigger Timeline and Decision Intelligence presentation. |
| `assets/rt-app.js` | Extracted working application controller, Saved/account route handling and scoped fixes described below. |
| `assets/rt-marketing.css`, `assets/rt-marketing.js` | v7 homepage layout, public-data rendering, sign-in and root callback handling. |
| `tests/*` | Local clean-route server, synthetic fixtures and browser regression scripts. |
| `docs/redesign/*` | Test results, screenshots and this review. |

Asset paths above are relative to `frontend/public/`. Root-level legacy copies of `index.html`, `competitors.html` and `worker.js` were not changed. The deployed asset directory remains `frontend/public`.

### Scoped frontend fixes

- Removed sample-lead fallback during feed failure. An unavailable response never becomes fake live activity.
- Removed the invented Application-stage fallback when lifecycle data is missing.
- HOT KPI counts use returned `temperature`, not a separate frontend threshold calculation.
- Saved deep links prompt sign-in and restore the Saved-only view after authentication.
- Direct `/signals?saved=1#magic=...` callbacks retain query state.
- Pipeline degraded status persists when filters change.
- Opportunity IDs in shared feed buttons use data attributes and delegated handlers.

## Route map

| Route | Behavior |
| --- | --- |
| `/` | Marketing and existing root auth/billing callback handling. |
| `/signals` | Public feed or signed-in personalized dashboard. |
| `/signals#pipeline` | Chandler Early Pipeline. |
| `/signals?saved=1` | Existing Saved-only feed state; sign-in required. |
| `/signals?account=1` | Existing account/preferences/billing modal. |
| `/competitors` | Existing competitor intelligence, profiles and relationships. |
| `/sources` | Existing sources and source diagram. |
| `/#pricing` | Existing plan pricing and checkout actions. |
| `/#signals`, `/#pipeline` | Legacy bookmarks forwarded to the application. |

No framework or dynamic routing was introduced. `signals.html` uses Cloudflare's existing clean HTML URL behavior.

## Screenshots

**All records in these screenshots are synthetic QA fixtures. They do not show current production activity or counts.**

| View | Before | After |
| --- | --- | --- |
| Desktop homepage, 1366px | [Before](screenshots/before-home-1366.png) | [After](screenshots/after-home-1366.png) |
| Mobile homepage, 390px | [Before](screenshots/before-home-390.png) | [After](screenshots/after-home-390.png) |
| Desktop opportunity feed | [Before](screenshots/before-feed-1366.png) | [After](screenshots/after-signals-1366.png) |
| Mobile opportunity feed | [Before](screenshots/before-feed-390.png) | [After](screenshots/after-signals-390.png) |
| Desktop Competitors | — | [After](screenshots/after-competitors-1366.png) |
| Mobile Competitors | — | [After](screenshots/after-competitors-390.png) |
| Desktop Sources | — | [After](screenshots/after-sources-1366.png) |
| Mobile Sources | — | [After](screenshots/after-sources-390.png) |
| Desktop competitor profile | — | [After](screenshots/after-competitor-profile-1366.png) |
| Mobile opportunity detail | — | [After](screenshots/after-opportunity-detail-390.png) |

## Verification scope

The browser suites use synthetic records and intercept **all external network requests**. No email was sent, no live Stripe session was created and no production data was downloaded. **41 local checks passed.** Results are in [test-results.json](test-results.json).

### Responsive and product tests

- Homepage, Signals, Competitors and Sources at 390, 430, 768, 1366 and 1920px: no horizontal page overflow or uncaught page errors.
- Three homepage previews, shared title/value rendering, returned temperature and missing-data behavior.
- Public and personalized feed; market/trade/score filters; Listed/Not Listed; search and sorting.
- Opportunity detail, full description, separate official valuation and estimated service value, feedback, Saved mutation, preferences, CSV export and logout.
- Early Pipeline detail, filtering, unavailable state and persistent degraded status.
- Competitor search parameters, profile, relationship evidence and watchlist entitlement gate.
- Mobile navigation, Saved/detail modal, competitor profile and source diagram selection.
- JavaScript syntax and `git diff --check`.

### Authentication tests

The synthetic API tests exercise passwordless request payloads, root verification, session storage, redirect to Signals, legacy session fallback, expired-session recovery, failed/expired magic links, Saved return state and direct Signals callback query preservation.

**Real Resend delivery, a real magic-link session and production-origin cookie/CORS behavior were not tested.**

### Billing tests

The synthetic API tests exercise Scout/Hunter/Territory checkout payloads, pending-plan continuation after sign-in, root success/cancel messaging, `/billing/sync` and existing billing portal requests.

**Real Stripe Checkout, portal pages, webhooks, payment state and entitlement updates were not tested.** No payment was made.

### Arizona validation

Phoenix, Tempe, Tucson, Scottsdale, Mesa and Chandler were each exercised with synthetic records. Tests check outgoing market filters and source attribution. The market adapters and backend are byte-for-byte unchanged relative to the baseline.

**Current counts, source health and real API response shapes were not validated.** The shape inventory was taken from the checked-in frontend and backend, not a production response snapshot.

## Outstanding gates and Core review

Roland explicitly authorized publication of commit `2b0c4bb` and read-only production validation on September 30, 2026. The earlier approval gate is resolved. Core will receive the exact local commit as an archive and Git bundle because authenticated exact-commit push is unavailable. Core has selected sanitized D1 fixtures for the next validation stage; direct production validation is not authorized by this handoff.

1. The first-turn automatic approval rejection is superseded by Roland's explicit authorization. However, source inspection now confirms that `GET /leads` can call `refresh(env,days)` when its stored result set is empty. `refresh()` can delete Chandler rows and calls `persist()` to write leads. There is no read-only flag in this route. Accordingly, `/leads` was not called during this validation attempt. Core has selected sanitized stored-record fixtures under the current no-mutation restriction. No backend change was made.

2. Await Core’s sanitized genuine Arizona fixtures, then validate the frontend with all external requests intercepted. Label those results sanitized real-production-shape validation. Live API/production integration validation remains a separate pre-deployment requirement.
3. Complete an authorized end-to-end email/magic-link flow and Stripe test-mode flow in a suitable environment. Do not use live charges to fill this gap.
4. Core should review frontend auth/billing callback continuity, public failure behavior, the Saved route and the shared card/timeline field mapping before approving deployment.
5. Existing Sources content identifies integrated markets; it is not a live operational health dashboard. That baseline behavior was retained.
6. Existing page-specific auth and pricing handlers remain in Competitors/Sources. A larger deduplication can follow after production parity is signed off. The first pass deliberately retains the original layout CSS beneath the new presentation layer.

No backend/API change is proposed or required for this build. Tucson enrichment and DFW work remain outside this branch.


## Authorized production validation attempt — September 30, 2026

**Status: blocked; real-record frontend validation is not complete.** The 41 previously passing checks remain synthetic local tests and must not be treated as real-data results.

### Read-only safety review

Before sending API requests, the checked-in Worker route handlers and relevant helpers were reviewed. `/sources`, `/changes-teaser`, `/pipeline?market=Chandler` and the Scottsdale/Chandler `/source-health` paths use source reads and/or SQL SELECTs in the reviewed implementation. The `/leads` route has a conditional refresh/persistence path and was excluded. No authentication, account, Saved, preference, watchlist, billing, email, admin refresh or other mutation endpoint was exercised.

### Requests attempted

At approximately 2026-09-30 09:00 UTC (02:00 Arizona time), five unauthenticated GET requests were attempted. No credentials, cookies, customer session or authorization header were sent. Each returned HTTP 403 through the available execution environment. These responses do not establish whether the underlying municipal sources are healthy, degraded or unavailable.

| Endpoint | Method | Result |
| --- | --- | --- |
| `/sources` | GET | HTTP 403; coverage metadata not retrieved |
| `/changes-teaser` | GET | HTTP 403; aggregate activity not retrieved |
| `/pipeline?market=Chandler` | GET | HTTP 403; pipeline data/source status not retrieved |
| `/source-health?market=Chandler&days=7` | GET | HTTP 403; source health not retrieved |
| `/source-health?market=Scottsdale&days=7` | GET | HTTP 403; source health not retrieved |
| `/leads` (any market or limit) | Not called | Conditional D1 write path conflicts with the authorized scope |

No access-control workaround or authenticated customer session was used after these failures.

### Results by Arizona market

| Market | Real opportunity/filter/detail validation | Source check | Count and attribution comparison |
| --- | --- | --- | --- |
| Phoenix | Blocked: `/leads` may mutate | Shared `/sources` returned 403 | Not performed |
| Tempe | Blocked: `/leads` may mutate | Shared `/sources` returned 403 | Not performed |
| Tucson | Blocked: `/leads` may mutate | Shared `/sources` returned 403 | Not performed |
| Scottsdale | Blocked: `/leads` may mutate | `/source-health` returned 403 | Not performed |
| Mesa | Blocked: `/leads` may mutate | Shared `/sources` returned 403 | Not performed |
| Chandler | Blocked: even its direct-source lead path can fall through to the stored/refresh path | `/source-health` and `/pipeline` returned 403 | Not performed |

### Frontend findings and missing-field coverage

No production opportunity payload was obtained. Therefore market/trade filtering, HOT/WARM/score presentation, Listed/Not Listed, search/sorting, details, actual lifecycle timelines, Decision Intelligence, valuation distinctions and company provenance remain **unverified with real records**. No new real-record frontend defect can be established from this attempt.

Homepage ticker and three-opportunity preview remain verified only against synthetic responses. Static inspection confirms DFW is labeled planned/not live and no illustrative DFW record was introduced into the production frontend. Failure and missing-field behavior passed the previous synthetic tests; real API degraded/empty/partial payloads were not available to compare.

The synthetic fixtures provide successful JSON responses. The actual attempted reads returned HTTP 403 instead, so no production JSON schema comparison was possible. Production record counts and source attribution were neither obtained nor compared. The backend/adapters remain unchanged, but this is not a substitute for a runtime count comparison.

### Scope and privacy confirmations

- All **attempted** Revenue Trigger API requests were GETs to paths reviewed as read-only; `/leads` was intentionally not called.
- No production mutation endpoint was called. No D1 write, customer-data change, email, Stripe checkout/charge, account action, Saved/preference/watchlist change, backend edit or adapter edit was performed.
- No production/customer record was retrieved, included in a screenshot or exposed in this report.
- No code was merged into `main`. **Nothing was deployed.**
- The approved commit remains unchanged. This report update is a local documentation change outside that commit and has not been published.

### Remaining requirements

Authenticated Git push access is needed to publish the exact approved commit. The available GitHub connector can create commits but cannot import the local commit with its exact original identity through its exposed methods; publishing a different SHA was not attempted.

Core will supply sanitized genuine stored-record fixtures for Phoenix, Tempe, Tucson, Scottsdale, Mesa, Chandler and Chandler Early Pipeline. No fixtures have been received; fixture validation has not started. No new endpoint, direct API retry, authenticated request or access-control workaround is part of this handoff.

## Core architectural findings and safe handoff — September 30, 2026

The following findings were supplied by Core and govern the next stage:

- `/leads` is not guaranteed read-only: absent stored records can invoke refresh/persist behavior.
- Tucson refresh behavior can update market cursor state.
- Authenticated GET endpoints can update session `last_seen_at`; GET alone does not guarantee zero mutation.
- No existing endpoint provides the complete stored Opportunity shape while guaranteeing both zero mutation and zero upstream polling.
- The five public-endpoint 403 responses appear specific to the Work environment/access path. They are an access limitation, **not evidence that the Revenue Trigger Worker is unavailable**.
- Sanitized D1 fixtures were selected as the safe validation method. A permanent validation endpoint was deliberately deferred.

### Package identity and documentation boundary

The exact committed build remains branch `redesign/signal-command-v7`, commit `2b0c4bbbd6168a8d893fda3fc77647eaaad99a8c`. No new commit was created. The source ZIP and Git bundle preserve that identity. The outer handoff includes this updated REVIEW separately from the committed source archive, plus the minimized request-attempt log, changed-file list, screenshots and synthetic test artifacts. Post-commit documentation is explicitly supplemental and does not represent a modified build.

The available authenticated GitHub integration cannot import this exact local commit through its exposed methods; the earlier CLI push lacked credentials. No replacement commit was created. Core can inspect the bundle and push only the review branch using its existing authorized access. No credential creation or request is needed.

### Fixture validation status and acceptance scope

All six Arizona markets and Chandler Early Pipeline are **awaiting fixtures**. The existing **41 passing checks are synthetic/local validation only**. No sanitized real-production-shape result, production JSON difference, real-record missing-field defect or market count comparison is claimed yet.

Once supplied, fixtures will exercise cards, score/temperature (HOT/WARM/WATCH), Listed/Not Listed, short/long titles, long descriptions/company names, company present/missing and provenance, participant roles, multiple trades, official valuation present/absent, estimated opportunity present/absent, project clusters, lifecycle/timeline, Data Confidence, Action Intelligence, Why Now, Next Best Action, Buying Window, First-Mover, sparse records, search/filter/sort and desktop/mobile layouts. They will also cover homepage real-opportunity mappings and Chandler Early Pipeline degradation. Unavailable intelligence must be omitted; official permit/project valuation must remain distinct from estimated trade/service opportunity.

Core’s fixture request is included as `CORE-FIXTURE-REQUEST.md` in the handoff. Selection targets approximately 5–10 genuine stored records per market, prioritizing edge cases and excluding subscriber/account/session/billing/customer information. SELECT-only extraction is requested from Core; Work has not performed extraction.

### Stop point and scope confirmation

Packaging and documentation only were performed for this handoff. No additional production API requests were made. The previous five attempted requests remain documented above; `/leads` was not called. No production data was modified, nothing was deployed, and nothing was merged. Backend Worker behavior, Arizona adapters, DFW and Cloudflare security remain unchanged. Fixture validation is pending receipt of Core’s sanitized records. Do not open the un-intercepted frontend against production during this phase, since its existing feed calls use `/leads`.

## Reproduce local tests

Requires Python 3, Node, Playwright 1.62.1 and a Chromium browser. Start the static server from the repository root:

```sh
python3 tests/serve.py
```

In another terminal:

```sh
node tests/redesign.cjs
node tests/additional.cjs
```

If using a separately installed Chromium, set `RT_CHROMIUM_PATH` to its executable path. The review run used Chromium 153 from `@sparticuz/chromium` after the standard Playwright browser download failed. This test dependency was not added to production dependencies.

For manual local review, the pages call the configured public API unless you intercept requests. The test scripts always intercept external requests and do not require production credentials.

**NOT DEPLOYED TO PRODUCTION.**
