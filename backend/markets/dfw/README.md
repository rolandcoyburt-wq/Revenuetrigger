# Revenue Trigger — Dallas–Fort Worth market adapters

This directory is intentionally additive. It does not edit the shared scoring, entity graph, lead rendering, Arizona adapters, D1 schema, or production market registry.

## Source map

| Market | Source | Role | Readiness | Notes |
|---|---|---|---|---|
| Fort Worth | CFW Open Data Development Permits View | Primary permit ingestion | Production-ready | Public ArcGIS table; updated hourly during business hours; includes permit type/subtype, project/work text, owner, dates/status, valuation, use, units and square feet. |
| Fort Worth | CFW Certificates of Occupancy Table | Occupancy / opening signal | Production-ready | Public ArcGIS table; City states weekday 7am refresh. Strong occupant/project/address fields. |
| Fort Worth | Zoning Cases Current | Early-pipeline enrichment | Enrichment-ready | Public ArcGIS layer with case number, dates, applicant, address, action and from/to zoning. |
| Dallas | DallasNow / Accela public Building module | Current permit source | Provisional | Current official land-management system. Public reports include Building Active, Building Issued and Building Submitted, but a stable machine-readable report export still needs validation before production enablement. |
| Dallas | Commercial Permit Activity Dashboard | Current commercial permit cross-check | Provisional | Official current Tableau dashboard. Treat as validation/fallback until a stable export contract is verified. |
| Dallas | Building Permits (`e7gq-4sah`) | Historical backfill only | Backfill-ready | Official Socrata dataset explicitly says it is historical and no longer updated after migration to DallasNow. |
| Dallas | Zoning / PD-SUP ArcGIS services | Zoning enrichment | Enrichment-ready | Authoritative base zoning plus SUP/PD/PDS lookups. Do not confuse these with the stale zoning-case layer in the 2026 Zoning Map Hub. |

## Canonical DFW record

Every source is normalized before it is mapped into the existing `leadFrom()` contract. The DFW layer preserves:

- source/jurisdiction lineage and schema version
- source record ID and permit/case number
- raw type, subtype, category and status
- canonical lifecycle stage
- file/status/event dates with future-date sanity checks
- normalized Texas address and coordinates when available
- project/work/use fields
- valuation, units and square feet with numeric guardrails
- typed participants (`owner`, `contractor`, `applicant`, `occupant`)
- a conservative `companyCandidate` only when a participant looks organizational
- raw source record for debugging/schema-drift investigation

`toLeadInput()` maps a normalized record to the current Revenue Trigger `leadFrom()` input shape without changing scoring or shared platform behavior.

## Fort Worth adapter behavior

`fetchFortWorthPermits()` uses a server-side `File_Date >= DATE 'YYYY-MM-DD'` filter and ArcGIS pagination. It intentionally uses `File_Date` as the primary freshness gate because municipal `Status_Date` values can occasionally be anomalous. `parseDate()` rejects implausibly future event dates, but the raw source value remains available under `raw`.

`fetchFortWorthOccupancy()` reads the separate CO table and rejects impossible future CO dates. `fetchFortWorthZoningCases()` is a separate enrichment feed so zoning activity cannot overwrite or masquerade as building-permit activity.

## Dallas adapter behavior

`normalizeDallasNowRecord()` is ready for current DallasNow records once a stable report/API payload is validated. Current Dallas ingestion is deliberately **disabled** by `dallasLiveSourceReadiness()` rather than shipping a brittle browser scraper.

`fetchDallasHistoricalPermits()` is safe for historical model/backfill work only. It must never be used as the current Dallas feed.

## Integration rule

Do not add Dallas or Fort Worth to the production `MARKETS` / `LIVE_MARKETS` constants until source health tests pass and the minimal wiring change is reviewed against the latest core-platform branch. This directory can be rebased or cherry-picked independently.
