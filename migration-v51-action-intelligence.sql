-- RevenueTrigger V51 — Action Intelligence
CREATE TABLE IF NOT EXISTS competitor_watchlist (
  user_id TEXT NOT NULL,
  company TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, company)
);

CREATE INDEX IF NOT EXISTS idx_competitor_watchlist_user
ON competitor_watchlist(user_id);

CREATE TABLE IF NOT EXISTS competitor_watch_alert_log (
  user_id TEXT NOT NULL,
  company TEXT NOT NULL,
  signature TEXT NOT NULL,
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, company, signature)
);

CREATE INDEX IF NOT EXISTS idx_competitor_watch_alert_user
ON competitor_watch_alert_log(user_id, sent_at);
