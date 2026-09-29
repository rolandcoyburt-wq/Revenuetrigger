-- Activate only after every chunk has imported successfully.
UPDATE roc_import_meta
SET active_batch='AZROC-2026-09-21-20260928T080802Z',
    source_as_of='2026-09-21',
    record_count=58298,
    source_file='YOUR_ROC_CSV_FILENAME.csv',
    imported_at=datetime('now')
WHERE id=1;

DELETE FROM roc_licenses
WHERE import_batch <> 'AZROC-2026-09-21-20260928T080802Z';