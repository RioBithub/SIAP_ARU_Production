SET @siap_dev_signature_sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()
    AND TABLE_NAME='siap_v11_attachment_signing' AND COLUMN_NAME='mode'
  ),
  'SELECT 1',
  'ALTER TABLE siap_v11_attachment_signing ADD COLUMN mode VARCHAR(16) NOT NULL DEFAULT ''sandbox'''
);
PREPARE siap_dev_signature_stmt FROM @siap_dev_signature_sql;
EXECUTE siap_dev_signature_stmt;
DEALLOCATE PREPARE siap_dev_signature_stmt;
