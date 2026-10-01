# Fort Worth frontend integration

## Build lineage and scope

Exact requested starting frontend: `1a6eee4582a659681b937cce650cff1d5f69f8e4`.
Created `integration/frontend-fort-worth-v1` from that commit and replayed the already approved headline (`3fed37b`) and social-card (`7cbc02f0ae731c178f54385d0305b72652819946`) follow-ups using fast-forward cherry-picks. No frontend files were copied from the backend branch.

Backend contract: `integration/signal-command-fort-worth-v1` at `4eda205b26793013e8297eb587ce1048f5e4442b`.
This isolated frontend build pins its API base to:
`https://integration-signal-command-fort-worth-v1-signalhound-api.rolandcoyburt.workers.dev/api`.
Pinning prevents an older browser-local production API override from defeating preview isolation. This configuration is for combined preview, not production.

## Frontend changes

- Add Fort Worth to the shared market list, Opportunity Feed and Competitor selectors. Account and onboarding options inherit the seventh market from the shared list.
- Keep backend-provided entitlements authoritative. Territory remains six selected markets; seven available choices do not increase its limit. Pricing copy now states “up to 6 selected markets”.
- Add Fort Worth to Sources cards, its interactive source diagram and seven-market coverage count. Dallas remains explicitly planned/not live and is absent from all selectable market lists.
- Replace inappropriate Arizona-only product wording. Preserve the Arizona list in its own homepage panel; add separate Fort Worth coverage and Dallas status.
- Preserve public `/feed` states and signed-in `/dashboard`; no `/leads`, refresh or adapter fallback added.
- Preserve shared encoding normalization; also use it in Competitors source-derived display escaping.
- Make inherited pale Why Now/action labels and cluster text readable in light detail panels.

## Validation

- 15/15 Fort Worth-specific local checks passed (390px and 1366px): genuine mixed Mesa/Fort Worth records, Fort Worth filtering, details/lifecycle/valuation/temperature/clustering/Action Intelligence, Sources, all seven preference choices, six-market Territory cap, persistence of Fort Worth selection, Saved, Competitors, homepage copy, and all five feed states.
- 41/41 existing regression checks passed, including 390/430/768/1366/1920px layouts, auth/billing callback contracts, filters, Saved, export, competitor views and Chandler pipeline behavior.
- 31/31 existing feed checks passed, including 400 invalid_market, 503 unavailable, failed network, freshness arrays and no sample fallback.
- 8/8 existing preference cases passed (40/60/75/80 at desktop/mobile).
- Existing display-normalization checks passed: both exact mappings, UTF-8, redaction, immutable inputs, source attribution and wrapping for genuine Mesa/Scottsdale/Chandler data.

Live read-only preview evidence on 2026-10-01 UTC:
- GET `/api/feed?markets=Fort%20Worth&days=7&limit=10`: HTTP 200, `fresh`, 10 stored Fort Worth opportunities.
- GET `/api/feed?markets=Fort%20Worth,Mesa&days=7&limit=20`: HTTP 200, `fresh`, 7 Fort Worth + 13 Mesa; `x-revenuetrigger-read-only: true`.
- CORS response matches the existing redesign preview origin exactly.
- GET `/api/sources`: seven live markets; Fort Worth live; Dallas absent.

`tests/fixtures/fort-worth-preview.json` contains five actual stored preview records (three Fort Worth, two Mesa), selected from the mixed response. All hydrated intelligence, scores, valuations, lifecycle and clustering fields remain as returned. Contact-pattern sanitation found zero matches. Account/Saved/preference and Competitor services are explicitly mocked in local tests; these are not real authenticated end-to-end results. Feed state variations are also synthetic.

No production requests, production database changes, production deployment, main merge, adapter modification, scoring change, or backend edit. Chandler Early Pipeline code and the encoding formatter are unchanged from the requested baseline. Real authenticated Fort Worth account/Saved/Competitor flows remain a separate integration gate; these tests do not claim Resend or Stripe end-to-end validation.
