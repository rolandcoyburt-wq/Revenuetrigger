-- RevenueTrigger V22 — Customer outcome feedback loop
-- Safe additive migration.

CREATE TABLE IF NOT EXISTS lead_feedback (
  user_id TEXT NOT NULL,
  lead_id TEXT NOT NULL,
  relevance TEXT,
  outcome TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, lead_id)
);

CREATE INDEX IF NOT EXISTS idx_lead_feedback_lead ON lead_feedback(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_feedback_outcome ON lead_feedback(outcome);
CREATE INDEX IF NOT EXISTS idx_lead_feedback_relevance ON lead_feedback(relevance);

CREATE TABLE IF NOT EXISTS lead_feedback_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  lead_id TEXT NOT NULL,
  action TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_feedback_events_lead ON lead_feedback_events(lead_id);
CREATE INDEX IF NOT EXISTS idx_feedback_events_user ON lead_feedback_events(user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_events_action ON lead_feedback_events(action);
