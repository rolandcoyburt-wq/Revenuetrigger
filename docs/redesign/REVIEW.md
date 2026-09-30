# Revenue Trigger — Signal Command v7 review build

**NOT DEPLOYED TO PRODUCTION.** This is an isolated frontend review branch. Nothing has been merged to `main`. Live-data and real email/Stripe verification remain outstanding, so this is not a production-release sign-off.

- Branch: `redesign/signal-command-v7`
- Repository: `rolandcoyburt-wq/Revenuetrigger`
- Baseline: `db5260fe16e0b9f81b36df71a50797a8b69cc7f3` (matches the Core handoff)
- Backend changes: **none**
- D1, adapters, scoring, temperature, auth contracts, billing contracts, cron, DFW, and Cloudflare configuration: **unchanged**

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

1. Automatic approval review rejected the attempted read-only production `/leads` download because the API was not verified and the records could be sensitive. The request was not retried through another route. Roland's explicit authorization is needed before retrying production API validation.
2. Run read-only real data checks for all six Arizona markets and source health, then compare the baseline and redesign against the same responses.
3. Complete an authorized end-to-end email/magic-link flow and Stripe test-mode flow in a suitable environment. Do not use live charges to fill this gap.
4. Core should review frontend auth/billing callback continuity, public failure behavior, the Saved route and the shared card/timeline field mapping before approving deployment.
5. Existing Sources content identifies integrated markets; it is not a live operational health dashboard. That baseline behavior was retained.
6. Existing page-specific auth and pricing handlers remain in Competitors/Sources. A larger deduplication can follow after production parity is signed off. The first pass deliberately retains the original layout CSS beneath the new presentation layer.

No backend/API change is proposed or required for this build. Tucson enrichment and DFW work remain outside this branch.

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
