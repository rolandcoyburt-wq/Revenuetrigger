RevenueTrigger V103 — Chandler Official Accela Source

What changed
- Keeps all V102 Scottsdale diagnostics and Chandler fuzzy-match improvements.
- Adds the City of Chandler official Accela permit layer (ArcGIS) as a validation/enrichment source.
- Early Pipeline now attempts participant resolution in this order:
  1. exact permit/project match to Chandler Accela permit record
  2. participant fields already present in DSActiveProjects
  3. conservative GPS Construction Projects project-name match
- Adds companyProvenance and match-confidence metadata to pipeline rows.
- Adds protected GET /admin/chandler-permits-debug?days=30 endpoint.
- Does NOT promote Chandler into the live Opportunity Feed yet.
- No SQL migrations or schema changes.

Protected diagnostic endpoints after deployment
- /admin/scottsdale-debug?days=7
- /admin/chandler-permits-debug?days=30
Both require the existing ADMIN_TOKEN as a Bearer token.
