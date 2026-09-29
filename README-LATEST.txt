RevenueTrigger — Latest Complete Cloudflare Deployment Build

Frontend:
- index.html: latest V84 homepage build
- competitors.html: latest competitor build carried forward through V84

Backend:
- worker.js: V57 production backend lineage currently associated with the live API
- wrangler.toml: Cloudflare deployment configuration
- migration-v51-action-intelligence.sql
- migration-v57-az-roc.sql

ROC:
- import_roc.py
- import_roc_v60_d1_safe.ps1 included when available

Notes:
- Production ROC roster is already imported and active. Do not rerun ROC migration/import unless intentionally rebuilding it.
- No secret values are bundled here.
