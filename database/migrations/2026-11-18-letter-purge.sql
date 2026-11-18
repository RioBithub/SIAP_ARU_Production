-- File cleanup is retryable after the document transaction has committed.
CREATE TABLE IF NOT EXISTS siap_letter_purge_files (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  letter_id CHAR(36) NOT NULL,
  storage_path VARCHAR(500) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_siap_letter_purge_files_letter (letter_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Retain ordering when new disposition actions happen within the same second.
SET @siap_disposition_log_ddl = IF(
  (SELECT DATETIME_PRECISION FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='siap_disposition_actions' AND COLUMN_NAME='created_at') = 6,
  'SELECT 1',
  'ALTER TABLE siap_disposition_actions MODIFY COLUMN created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)'
);
PREPARE siap_disposition_log_stmt FROM @siap_disposition_log_ddl;
EXECUTE siap_disposition_log_stmt;
DEALLOCATE PREPARE siap_disposition_log_stmt;
