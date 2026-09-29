-- RevenueTrigger V11 — Tucson PRO cursor
-- Safe additive migration. Does not modify existing leads/users/billing data.

CREATE TABLE IF NOT EXISTS market_cursors (
  market TEXT PRIMARY KEY,
  cursor_key TEXT NOT NULL,
  cursor_value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seed September 2026 just before the first validated Tucson backfill range.
-- First production refresh will scan TC-COM-0926-01584 forward.
INSERT INTO market_cursors (market,cursor_key,cursor_value,updated_at)
VALUES ('Tucson','TC-COM-0926-','1583',datetime('now'))
ON CONFLICT(market) DO NOTHING;
