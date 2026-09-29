CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT,
  event_date TEXT,
  company TEXT,
  scope TEXT,
  score INTEGER NOT NULL,
  categories TEXT NOT NULL,
  value INTEGER NOT NULL,
  temperature TEXT,
  permit TEXT,
  source TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_leads_score_date ON leads(score DESC,event_date DESC);

CREATE TABLE IF NOT EXISTS subscribers (
  email TEXT PRIMARY KEY,
  plan TEXT NOT NULL DEFAULT 'Beta',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
