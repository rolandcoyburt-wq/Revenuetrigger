-- RevenueTrigger V12 — persist permit status in lead detail
-- Safe additive migration.

ALTER TABLE leads ADD COLUMN permit_status TEXT;

UPDATE leads
SET permit_status = '—'
WHERE permit_status IS NULL;
