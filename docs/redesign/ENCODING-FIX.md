# Source text display correction

Presentation-only follow-up to `0f371dfe5f6775915c35543b1f8b648c2e805834` on `redesign/signal-command-v7`.

`RTFormat.normalizeDisplayText` replaces only two exact confirmed artifacts before casing, description splitting, truncation and HTML escaping:

| Stored sequence | Display | Occurrences in 60-row sanitized fixture SQL |
| --- | --- | --- |
| ΓÇö | — | 159 |
| ΓÇ¥ | ” | 4 |

No other non-ASCII artifacts occurred in the inspected SQL. Unknown sequences are deliberately left alone. The shared UI and app HTML display boundaries cover source names, addresses, company names, full descriptions, attribution, permit status and source-derived intelligence text. Existing HTML escaping remains in place. Company/title case formatting preserves `[PHONE REDACTED]` exactly.

## Evidence and tests

Source: `revenuetrigger-preview-fixtures.sql`, Library ID `libfile_a64f6f1cb8b88191ab9b1d48d4e14564`. Four unmodified approved-field records are retained in `tests/fixtures/arizona-display.json`: Mesa PMT26-17452 (long scope), Scottsdale 324403 (redaction), Chandler BLD26-2393 (detail/attribution), and Tucson TC-COM-0926-01605 (pipe-dimension quotation marks). Original malformed strings remain in these fixtures. No account/auth/billing data is included.

- `tests/display-normalization.cjs`: PASS. Exact dash/quotation mappings; ordinary UTF-8 and redaction unchanged; title/company/address and Why Now/action boundaries; HTML escaping; input immutability. All six genuine Mesa/Scottsdale/Chandler detail cases pass at 390px and 1366px, including complete source attribution, full description preservation, multi-line wrapping and no horizontal overflow.
- `tests/redesign.cjs` + `tests/additional.cjs`: 41/41 existing synthetic/local checks PASS, including responsive layouts at 390/430/768/1366/1920px, authentication callback contracts, billing callback contracts, filters, Saved, preferences, export and pipeline behavior.
- Twelve local screenshots in `screenshots/encoding/`: each market at both widths, top-of-detail and scrolled description views. Visually reviewed long mobile Mesa description, Scottsdale redaction/source and Chandler description/source.

The genuine records are rendered through intercepted local `/feed` responses, with only categories parsed and date/status/valuation field aliases added for the UI. These tests do not claim combined backend hydration, live source, authentication or payment validation. Synthetic intelligence-boundary tests are separate from genuine records; no intelligence is invented in genuine-record screenshots.

## Scope

Runtime edits: `frontend/public/assets/rt-format.js`, `rt-ui.js`, `rt-app.js` only. The app edit changes its display escape helper only. Signed-in dashboard request/loading code, D1 values, backend, ingestion, adapters, scoring, DFW and deployment configuration are unchanged. No production request, deployment, merge or GitHub push was performed. Existing integration/release gates remain separate from this display fix.
