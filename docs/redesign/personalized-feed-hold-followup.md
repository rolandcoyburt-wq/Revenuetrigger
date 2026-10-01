# PR #10 follow-up — local evidence, remote qualification still HOLD

Branch: `fix/personalized-feed-query-v1`. Reviewed ancestor: `36a2be15d987abb901da380dc9ce22686147e68a`.
Branch base remains `27f4cc8de7cbbc44e2f7c0a7f1dffe1000681a81`; newer mobile/menu production changes are intentionally not merged into this isolated fix.

## Preference correctness

Both account and onboarding dynamically include a valid saved nonstandard score as a current-preference option. A saved 70 displays `70+ — Current preference`, and saving without a change preserves 70. Explicit zero remains Any score. Empty, nonnumeric and out-of-range selections are rejected before a frontend request. The backend also rejects invalid input with 400 before writing preferences. No schema/default workaround.

Local browser tests cover all three paid plans at 390px and 1366px: 70 and 0 account round trips; onboarding 0/40/60/70/75/80; blank/invalid/100 rejection in both forms. Backend tests cover numeric thresholds and invalid string/null/boolean/range inputs without overwrite.

## Query change

Every selected market is still exhausted. Within each market, history and optional score predicates run in SQL, using stable `(datetime(event_date), id)` keyset ordering. Hydration, clustering and industry matching precede result-cap selection. Since clusters are market-scoped, each market can be processed separately; retaining the top K matched results between markets is mathematically equivalent to globally ranking all matched results. No candidate ceiling was introduced. Cross-page clusters and distinct Dallas/Fort Worth projects have equivalence coverage.

The optional `migration-v59-personalized-feed-index.sql` defines `(market, datetime(event_date), id)`. It was tested only in local in-memory SQLite and has NOT been applied to any D1 database. The worker does not depend on its existence, create indexes, or execute migrations.

Original plan with existing indexes:

```
SEARCH leads USING INDEX idx_leads_market_event (market=?)
USE TEMP B-TREE FOR ORDER BY
```

`datetime(event_date)` does not match the existing raw-text date index, so only the market prefix is useful. Global ID ordering needs a temporary sort. Optimized per-market query with the expression index:

```
SEARCH leads USING INDEX idx_leads_market_event_cursor (market=? AND <expr>>?)
```

No temporary sort. Without the new index, the correct query still uses the market prefix and a temporary sort.

## Reproducible scale harness

```
node --expose-gc backend/tests/personalized-feed-scale.mjs 30000
FEED_BENCH_INDEX=1 node --expose-gc backend/tests/personalized-feed-scale.mjs 30000
FEED_BENCH_INDEX=1 node --max-old-space-size=96 --expose-gc backend/tests/personalized-feed-scale.mjs 60000
```

Synthetic, production-shaped stress data, NOT a measurement of actual production volume: six selected markets (Phoenix, Tempe, Mesa, Chandler, Fort Worth, Dallas), evenly distributed over 89 days, plus 10,000 irrelevant/expired rows. Territory uses 90 days, all eight industries, Any score and a 500-result cap. Dallas provenance includes Submitted/Issued observations, applicant business role, temporary-ID state, fingerprint and source/detail URLs, averaging 2,619–2,620 bytes per Dallas record. Scopes are approximately 700 bytes. The sparse scenario leaves only 1% of records with matching categories. No fixtures are uploaded or persisted remotely.

Single-run local Node 24 / SQLite 3.53.3 measurements (not Cloudflare latency):

| Query / population | Match | Candidate queries | Rows returned by SQL | SQL ms | End-to-end ms | Sampled heap peak | Result bytes |
|---|---|---:|---:|---:|---:|---:|---:|
| Reviewed query / 30,000 | All | 61 | 30,000 | 3,615 | 5,313 | 141,278,336 | 1,594,766 |
| Reviewed query / 30,000 | 1% | 61 | 30,000 | 2,662 | 4,050 | 144,364,544 | 828,464 |
| Per-market, existing indexes / 30,000 | All | 66 | 30,000 | 1,881 | 3,373 | 167,896,872 | 1,594,766 |
| Per-market, existing indexes / 30,000 | 1% | 66 | 30,000 | 1,161 | 2,339 | 132,135,504 | 828,464 |
| Per-market, expression index / 30,000 | All | 66 | 30,000 | 352 | 2,554 | 152,824,168 | 1,594,766 |
| Per-market, expression index / 30,000 | 1% | 66 | 30,000 | 229 | 1,690 | 142,001,848 | 828,464 |
| Per-market, expression index / 60,000 | All | 126 | 60,000 | 497 | 3,718 | 134,953,144 | 1,595,715 |
| Per-market, expression index / 60,000 | 1% | 126 | 60,000 | 475 | 3,049 | 124,422,088 | 1,380,364 |

Queries include the final empty page when a market population is an exact multiple of 500; preference and Saved reads are additional. SQL scanned-row counters are not exposed by node:sqlite; returned rows are NOT claimed as scanned rows. Raw candidate JSON totals were about 52.5 MB (30k) and 105.1 MB (60k) with all industries. Heap sampling occurs at query boundaries and after completion, not a profiler-certified maximum. RSS includes the in-memory SQLite fixture itself (roughly 410–465 MB in optimized runs), so it is not a Worker memory estimate. Running the 60k indexed workload with `--max-old-space-size=64 --max-semi-space-size=4` failed with V8 heap exhaustion. Larger single-market concentrations and concurrency remain unqualified.

**Conclusion: SQL efficiency improved and exhaustive correctness is preserved, but this evidence does not establish Cloudflare operational safety. Keep scale readiness HOLD pending actual Worker CPU/memory/latency measurements and additional memory work if needed.**

## Regression results

- Backend: 174 checks across personalized feed 34, Dallas 32, Fort Worth 4, stored feed 26, public funnel 66, checkout 12.
- Mocked-service browser scenarios: personalized/preferences/onboarding 6, account preferences 12, public funnel 22, checkout 48, Dallas/Fort Worth/Saved/reload/logout 18 (106 total).
- Syntax checks and `git diff --check`: passed.

## Isolated preview / pending real authentication

- Frontend: `https://fix-personalized-feed-query-v1-signalhound-phoenix.rolandcoyburt.workers.dev/`
- Backend: `https://fix-personalized-feed-query-v1-signalhound-api.rolandcoyburt.workers.dev/api`
- Frontend workers.dev configuration targets that backend. Preview CORS/auth return target the matching frontend.
- Preview D1 remains `revenuetrigger-preview` / `3e002252-2664-496f-a77f-a3a9880274d8`.
- Production URLs, bindings, Price IDs and secrets unchanged. No migration or D1 write performed.

Real authenticated Scout/Hunter/Territory validation is NOT reported as passed. Preference save and Saved round trips necessarily write preview D1, conflicting with the explicit no-D1-writes constraint; authenticated session use may also update last-seen state. Authorized test accounts/session access and explicit permission for preview-only validation writes are needed. No auth bypass or plan mutation was introduced. Do not merge or deploy production based on these local results alone. PR #10 remains Draft.
