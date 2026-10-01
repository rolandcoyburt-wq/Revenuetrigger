-- Optional query acceleration; no data or entitlement changes.
-- Not applied by the worker. Apply only through a separately authorized migration.
CREATE INDEX IF NOT EXISTS idx_leads_market_event_cursor
ON leads(market,datetime(event_date),id);
