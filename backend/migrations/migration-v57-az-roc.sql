-- RevenueTrigger V57 — Arizona ROC Contractor Intelligence
CREATE TABLE IF NOT EXISTS roc_licenses (
  license_no TEXT NOT NULL,
  business_name TEXT NOT NULL,
  dba TEXT,
  class_code TEXT,
  class_detail TEXT,
  class_type TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  qualifying_party TEXT,
  issued_date TEXT,
  expiration_date TEXT,
  status TEXT,
  canonical_name TEXT NOT NULL,
  canonical_dba TEXT,
  import_batch TEXT NOT NULL,
  source_as_of TEXT,
  imported_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (license_no, import_batch)
);

CREATE INDEX IF NOT EXISTS idx_roc_license_active_name
ON roc_licenses(import_batch, canonical_name);

CREATE INDEX IF NOT EXISTS idx_roc_license_active_dba
ON roc_licenses(import_batch, canonical_dba);

CREATE INDEX IF NOT EXISTS idx_roc_license_city
ON roc_licenses(import_batch, city);

CREATE INDEX IF NOT EXISTS idx_roc_license_class
ON roc_licenses(import_batch, class_code);

CREATE INDEX IF NOT EXISTS idx_roc_license_status
ON roc_licenses(import_batch, status);

CREATE TABLE IF NOT EXISTS roc_import_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  active_batch TEXT,
  source_as_of TEXT,
  record_count INTEGER NOT NULL DEFAULT 0,
  source_file TEXT,
  imported_at TEXT
);

INSERT OR IGNORE INTO roc_import_meta
(id, active_batch, source_as_of, record_count, source_file, imported_at)
VALUES (1, NULL, NULL, 0, NULL, NULL);
