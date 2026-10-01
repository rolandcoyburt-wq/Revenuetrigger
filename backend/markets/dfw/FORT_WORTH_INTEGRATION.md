# Fort Worth integration review package

Branch: `integration/fort-worth-market-v1`  
Base: `main@db5260fe16e0b9f81b36df71a50797a8b69cc7f3`

## What this branch enables

Fort Worth becomes a live Revenue Trigger market using the City of Fort Worth Development Permits Open Data feed.

The integration path is:

1. `fetchFortWorthPermits()` reads the official ArcGIS table.
2. The DFW normalization layer rejects implausible future dates and normalizes address, value, scope, participants and source lineage.
3. `toLeadInput()` maps the normalized record into the existing core `leadFrom()` input contract.
4. `leadFrom()` applies the existing production opportunity scoring and data-confidence logic unchanged.
5. The existing refresh/persist flow writes Fort Worth leads into the current `leads` table using the existing `market` text column.

## Core worker changes

Only the following core behaviors are changed:

- import the Fort Worth adapter and DFW `toLeadInput()`
- add `Fort Worth` to `MARKETS`
- add `Fort Worth` to `LIVE_MARKETS`
- add Fort Worth to `SOURCE_STATUS`
- add `fetchFortWorth()`
- route `fetchMarket('Fort Worth')`
- recognize Fort Worth in `marketFromSource()`
- make the public `/leads` source label geographically neutral

No scoring logic, D1 schema, billing, authentication, saved-lead behavior, entity graph, Arizona adapter, or frontend code is changed.

## Dallas status

Dallas is not added to `MARKETS` or `LIVE_MARKETS`.

The branch carries the DFW Dallas modules so the DFW workstream remains coherent, but DallasNow primary building permits remain disabled. Dallas ROW and zoning code has no worker import path in this package and is therefore not part of the live worker execution path.

## Review checks

Before merge or deployment, validate:

- `node backend/markets/dfw/test.mjs`
- `node backend/markets/dfw/live-smoke.mjs`
- `GET /sources` includes Fort Worth as live
- `GET /leads?markets=Fort%20Worth&days=7` returns Fort Worth records
- Fort Worth records persist with `market='Fort Worth'`
- existing Arizona market requests still return unchanged results
- scheduled refresh reports a Fort Worth market result rather than failing the full refresh
- no unexpected change to plan-market selection behavior

## Product entitlement note

The existing Territory entitlement remains `marketLimit: 6` while the live-market registry becomes seven markets. This branch intentionally does not change plan entitlements. If Territory should select every live market simultaneously, update that separately as an explicit product decision.

## Rollout recommendation

Use a Cloudflare preview or non-production Worker first. Exercise Fort Worth single-market requests and one authenticated dashboard flow, then review D1 rows and source health before any production merge/deploy.
