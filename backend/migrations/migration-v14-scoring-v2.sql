-- RevenueTrigger V14 — Opportunity Score V2
ALTER TABLE leads ADD COLUMN official_value REAL;

-- Replay recent Tucson permits once under the new model.
UPDATE market_cursors
SET cursor_value = CAST(MAX(0, CAST(cursor_value AS INTEGER) - 40) AS TEXT),
    updated_at = datetime('now')
WHERE market = 'Tucson';
