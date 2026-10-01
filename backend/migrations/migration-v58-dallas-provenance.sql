-- Durable Dallas observation history and participant/source semantics.
-- Nullable; existing market rows and human-readable source attribution are unchanged.
ALTER TABLE leads ADD COLUMN source_provenance TEXT;
