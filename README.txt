RevenueTrigger V102 — Data QA

Changes:
1. Chandler Early Pipeline participant matching
   - keeps direct participant fields as highest priority
   - adds conservative fuzzy project-name matching against Chandler GPS Construction Projects
   - requires >=2 meaningful shared project tokens and a strong confidence threshold
   - returns companyMatchType/companyMatchConfidence for QA

2. Scottsdale diagnostics
   - adds protected GET /admin/scottsdale-debug?days=7
   - requires existing ADMIN_TOKEN bearer auth
   - reports raw parsed row count, CSV headers, coverage fields, issue-date distribution, and five sample rows
   - does not alter Scottsdale production ingestion yet

No SQL migrations. No schema changes. No frontend changes.
