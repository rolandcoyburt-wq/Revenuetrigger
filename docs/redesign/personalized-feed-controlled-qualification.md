# Controlled preview qualification — blocked at Cloudflare access

This record supersedes the previous follow-up's write-authorization blocker. The user has now authorized controlled preview writes, v59 after a recovery bookmark, and a separate disposable D1 for synthetic stress data. Production remains HOLD.

## Branch and merge

- Reviewed parent: `db007f2abeb4963d3d6134866fecc65cf143da6f`.
- Merged main: `211cfb6a8791d83af8d22da9c6702f71095f9d67`.
- Merge commit: `8101f303d769466ae84bcb7033682a2e32600c8c` (two parents; no rebase).
- Merge brings current mobile layout, compact Market Brief and shared homepage navigation into this isolated branch.
- Follow-up changes only regression tests and this record; approved backend runtime architecture is unchanged.

## Cloudflare access and preview diagnosis

No Cloudflare plugin was found, no configured Cloudflare CLI credential was available, and the dashboard remained on “Performing security verification” after one reload. The final visible challenge Ray ID was `a43e9adc1b7ca37b`. No CAPTCHA was solved, no access control bypass was attempted, and no account session was available. Manual access is required before continuing account-level inspection.

GitHub's Cloudflare check runs independently confirm successful builds for reviewed head `db007f2...`:

- Frontend build ID: `9704115b-dc47-4a98-a33d-6e4ea8a5ef51`, success at 2026-10-01 21:19:46 UTC.
- Backend build ID: `cefe3d9d-c098-4495-9018-cde06ef49c4f`, success at 2026-10-01 21:19:45 UTC.

These are BUILD IDs, not Worker version IDs. They do not prove the effective deployed bindings or active alias/version. Those must be inspected in Cloudflare. The previous “feed unavailable” symptom has not been resolved, so remote qualification remains invalid/not started.

Repository configuration, not yet independently confirmed from deployed Worker settings:

- Frontend: `https://fix-personalized-feed-query-v1-signalhound-phoenix.rolandcoyburt.workers.dev/signals`
- Frontend preview API / backend: `https://fix-personalized-feed-query-v1-signalhound-api.rolandcoyburt.workers.dev/api`
- Preview ALLOWED_ORIGIN and FRONTEND_URL: `https://fix-personalized-feed-query-v1-signalhound-phoenix.rolandcoyburt.workers.dev`
- Preview DB: `revenuetrigger-preview`, `3e002252-2664-496f-a77f-a3a9880274d8`.
- Production configuration is unchanged by this work.

## Recovery and migration gate

No recovery bookmark captured. Index existence not inspected remotely. v59 NOT applied. No deployed EXPLAIN QUERY PLAN available. Do not apply the migration until effective preview binding, a fresh recovery bookmark and index absence have been verified. If the index already exists, do not reapply it.

No preview D1 writes, production D1 writes, migrations, disposable database creation, load tests or production deployment were performed during this qualification attempt.

## Exhaustive-reference comparison — local only

The personalized suite now performs 15 explicit reference comparisons: Scout/Hunter/Territory × scores 0/40/60/75/80. Each uses an unpaged reference population and global clustering/ranking, compared by exact returned IDs with the paged production function. The reference clock is fixed at SQL second precision for both paths.

Fixtures include 3,000 unrelated higher-scored records, 1,200 records with 1% matching industries, enough eligible projects to fill each plan cap, 1,100 equal-date duplicate-project rows spanning pages, mixed SQLite/ISO date strings, and records one second before, exactly at, and one second after the entitled cutoff. Result caps are exactly 80/250/500, history exactly 7/30/90 days. Cross-market clusters remain separate. **15/15 comparisons passed, zero ID mismatches.**

These comparisons are synthetic local SQLite evidence, not comparisons against deployed preview data.

## Regression totals after main merge

| Group | Passed |
|---|---:|
| Personalized backend, including reference comparisons | 49 |
| Public-funnel backend | 66 |
| Checkout backend | 12 |
| Dallas backend | 32 |
| Fort Worth backend | 4 |
| Stored feed backend | 26 |
| **Backend total** | **189** |
| Personalized account/onboarding browser scenarios | 6 |
| Preferences browser scenarios | 12 |
| Public-funnel frontend checks | 22 |
| Checkout frontend cases | 48 |
| Dallas/Fort Worth/Saved/reload/logout browser scenarios | 18 |
| Mobile layout page/viewport scenarios | 12 |
| **Frontend total** | **118** |

Dallas browser tests now expand the mobile Filters controls before using them and expand coverage/select Territory before checking their displayed content. No runtime workaround was introduced. JS syntax and `git diff --check` passed.

## Remote authenticated validation

Scout, Hunter and Territory real-account checks: NOT RUN. No test account was created or changed, no authentication bypass used, no secrets requested in chat. 70/0/40/60/75/80, invalid selection rejection, limits/history, Saved/reload, Dallas/Fort Worth, empty-state action and logout pass locally but remain unverified on the deployed pair.

## Worker qualification matrix — not measured

| Workload | Concurrency | Cold / warm | p50 / p95 / max wall | CPU | D1 queries / duration / rows_read | Bytes | Failures / resource errors |
|---|---|---|---|---|---|---|---|
| Current representative preview | 1 / 2 / 5 | Not run | Not measured | Not measured | Not measured | Not measured | Not tested |
| Projected larger, disposable DB | 1 / 2 / 5 | Not run | Not measured | Not measured | Not measured | Not measured | Not tested |
| Concentrated single market, disposable DB | 1 / 2 / 5 | Not run | Not measured | Not measured | Not measured | Not measured | Not tested |
| 1% industry match, disposable DB | 1 / 2 / 5 | Not run | Not measured | Not measured | Not measured | Not measured | Not tested |

Peak Worker isolate memory/available telemetry has not been inspected. Prior Node heap results are NOT production clearance. No new memory optimization is claimed: the user requires valid deployed/concentrated evidence first, and that gate is blocked. Do not substitute localhost timings for any cell above.

## Resume sequence

1. Restore account access; verify exact frontend/backend Worker version IDs and effective preview binding/configuration. Diagnose the unavailable feed.
2. Capture fresh preview Time Travel bookmark; inspect index; apply v59 only if absent; retain deployed query-plan evidence.
3. Validate genuine Scout/Hunter/Territory accounts and compare each deployed result to exhaustive reference data.
4. Create separate disposable preview D1 for stress data; keep all synthetic rows out of retained preview DB. Isolate stress Worker bindings and telemetry from production.
5. Run cold/warm concurrency 1/2/5 and capture the requested metrics; qualify memory in Worker/equivalent runtime, documenting limits. Optimize only if evidence requires it, preserving exhaustive matching.

PR #10 remains Draft. No merge to main. Production remains HOLD.
