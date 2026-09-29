-- RevenueTrigger V3 multi-market migration
-- Run ONCE against the existing D1 database before deploying worker.js.
ALTER TABLE leads ADD COLUMN market TEXT NOT NULL DEFAULT 'Phoenix';
UPDATE leads SET market='Tempe' WHERE source LIKE '%Tempe%';
UPDATE leads SET market='Tucson' WHERE source LIKE '%Tucson%';
UPDATE leads SET market='Scottsdale' WHERE source LIKE '%Scottsdale%';
UPDATE leads SET market='Mesa' WHERE source LIKE '%Mesa%';
UPDATE leads SET market='Chandler' WHERE source LIKE '%Chandler%';
CREATE INDEX IF NOT EXISTS idx_leads_market_event ON leads(market,event_date DESC);
