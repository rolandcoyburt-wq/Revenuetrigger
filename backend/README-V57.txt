RevenueTrigger Production V57 — Arizona ROC Contractor Intelligence

This is the ROC identity/license-data foundation brought forward before Phase 3 Relationship Intelligence.

WHAT IT ADDS
- Matches Competitor Intelligence companies to the imported Arizona Registrar of Contractors current roster.
- Exact normalized Business Name match: 99% identity-match confidence.
- Exact normalized DBA match: 96%.
- AZ ROC MATCHED badge in the competitor feed.
- Competitor profile shows:
  ROC license number
  license status
  class code and class type
  classification detail
  licensed business location
  qualifying party
  issued and expiration dates
  licensed entity / DBA
  trade tags derived from ROC classification
  roster source date
- Missing exact ROC match is NOT described as unlicensed.
- ROC aliases strengthen RevenueTrigger company entity resolution.

NEW API
GET /api/roc/meta
GET /api/roc/search?q=...&city=...&class=...&status=...&limit=...

HEALTH
/api/health now reports whether a ROC roster is active and its source date/record count.

FIRST DEPLOY
1) npx wrangler d1 execute signalhound --remote --file=./migration-v57-az-roc.sql
2) npx wrangler deploy
3) Deploy competitors.html

LOAD THE FULL ROC ROSTER
1) Download "All Current Contractors" CSV from:
   https://roc.az.gov/posting-list
2) Put the CSV in this V57 folder.
3) Run:
   python import_roc.py "YOUR_ROC_CSV_FILENAME.csv"
4) Then run:
   .\import_roc.ps1
5) Verify:
   https://api.revenuetrigger.ai/api/health

IMPORT SAFETY
The new roster is imported under an inactive batch.
It becomes authoritative only after every chunk succeeds.
A failed partial import will not replace the previous active roster.

NORMAL REFRESH
For future ROC posting-list updates, repeat only the CSV download + import_roc.py + import_roc.ps1 steps.
No new migration is needed.

DATA INTERPRETATION
- Use All Current Contractors as the master ROC roster.
- Commercial / Residential / Dual lists overlap and should not be added together.
- A license row is not necessarily a unique company.
- Qualifying Party is not automatically an owner.
- Roster presence is not a recommendation.
- Confirm current standing with AZ ROC before consequential use.

No Stripe changes.
index.html remains included from the current production lineage.
