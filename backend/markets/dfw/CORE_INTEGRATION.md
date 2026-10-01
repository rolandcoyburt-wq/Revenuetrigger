# Fort Worth + Core integration review

Base requested: `17481f74b8698960ad965a13c04bdbda428d4dfe`.
PR #2 source: `e382fb2055550a7a409e5044caeafb2e507c463d`.
Common baseline: `db5260fe16e0b9f81b36df71a50797a8b69cc7f3`.

## Conflicts identified before integration

- No overlapping Worker implementation hunks: Core adds the stored read-only feed; PR #2 adds registration, adapter wiring, source recognition and neutral permit-source wording. Core's feed helpers/route are preserved byte-for-byte.
- Core's data-URL test loader cannot resolve new relative adapter imports. The feed test now imports the Worker by file URL; runtime code is unaffected. Tests run under Node 24.
- The named base predates the current Core preview Stripe configuration. Actual Core head at review is `7f20a5ac2712daa536158b94f64188148b3d0b5c`, the direct child of `17481f7`. The combined branch starts from the requested base and retains that exact existing config commit before integration. Thus preview sandbox prices are preserved, not reset to REPLACE placeholders.
- PR #2 also contains Dallas adapters, shared test tooling and older integration documentation. Only `fort-worth.js`, `normalize.js`, `sources.js` and Fort Worth Worker hunks are carried over. Dallas adapter/index/health/smoke modules are excluded. The unchanged shared source catalog contains Dallas metadata but no Dallas Worker registration or execution path.

## Preserved contracts

- `/feed`: D1 SELECT -> hydrateStoredLead -> clusterLeads -> response. No adapter polling, refresh, persistence or auth/session writes. Feed implementation is unchanged.
- All Arizona adapters, scoring, auth/billing, schema, frontend files and current Core Wrangler configuration unchanged.
- Fort Worth uses existing leadFrom scoring/normalization and persistence architecture.
- Dallas absent from MARKETS/LIVE_MARKETS; explicit `/feed?markets=Dallas` returns 400 before D1 access.
- Adding Fort Worth to LIVE_MARKETS automatically extends default feed queries, explicit allowlist, SQL bindings and freshness/state metadata. No feed runtime edits needed.
- Existing refresh/scheduled logic iterates LIVE_MARKETS, so a future deployment would include Fort Worth in normal refresh. Cron code/config is unchanged; no refresh or deployment was executed during review.
- Territory remains marketLimit 6 despite seven registered live markets. Entitlement changes require a separate product decision.

## Tests

Run from repository root using Node 24:

```
node backend/tests/feed-readonly.test.mjs
node backend/tests/fort-worth-integration.test.mjs
```

Results: 24/24 feed checks and 4/4 integration checks pass.

Feed checks include all six Arizona filters, Fort Worth default inclusion, stored-row hydration/clustering, fresh/stale/empty/partial/unavailable states, no external request attempts, SELECT-only D1 access, no session writes, and Dallas rejection. Integration checks cover normalization, sparse values, paginated/deduplicated mock adapter responses, fetchMarket wiring, unchanged core scoring output, source recognition and `/sources` registration.

All adapter responses are mocked. No live municipal requests, Cloudflare writes, production deployments or frontend integration performed. Node may emit its existing typeless-package ESM warning; tests pass without changing package configuration.

This branch is for combined backend review and subsequent preview validation. PR #2 is not merged to main. Cloudflare preview and frontend integration remain separate gates.
