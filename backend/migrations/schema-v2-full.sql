-- SignalHound V2 full schema for a fresh D1 database.

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

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL DEFAULT 'Beta',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  subscription_status TEXT NOT NULL DEFAULT 'inactive',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON users(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_users_stripe_subscription ON users(stripe_subscription_id);

CREATE TABLE IF NOT EXISTS auth_tokens (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_email_created ON auth_tokens(email,created_at DESC);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS preferences (
  user_id TEXT PRIMARY KEY,
  industries TEXT NOT NULL DEFAULT '["Commercial services"]',
  markets TEXT NOT NULL DEFAULT '["Phoenix"]',
  min_score INTEGER NOT NULL DEFAULT 70,
  alert_frequency TEXT NOT NULL DEFAULT 'none',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS saved_leads (
  user_id TEXT NOT NULL,
  lead_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id,lead_id)
);
CREATE INDEX IF NOT EXISTS idx_saved_leads_user_created ON saved_leads(user_id,created_at DESC);

CREATE TABLE IF NOT EXISTS alert_log (
  user_id TEXT NOT NULL,
  lead_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id,lead_id,channel)
);

CREATE TABLE IF NOT EXISTS billing_events (
  event_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  processed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
