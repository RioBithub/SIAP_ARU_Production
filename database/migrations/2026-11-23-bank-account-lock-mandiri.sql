SET @sql = IF(
  EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()
          AND TABLE_NAME='siap_bank_accounts' AND COLUMN_NAME='finance_locked'),
  'SELECT 1',
  'ALTER TABLE siap_bank_accounts ADD COLUMN finance_locked TINYINT(1) NOT NULL DEFAULT 0'
);
PREPARE bank_lock_stmt FROM @sql;
EXECUTE bank_lock_stmt;
DEALLOCATE PREPARE bank_lock_stmt;

SET @sql = IF(
  EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()
          AND TABLE_NAME='siap_bank_transactions' AND COLUMN_NAME='source_row_no'),
  'SELECT 1',
  'ALTER TABLE siap_bank_transactions ADD COLUMN source_row_no INT UNSIGNED NULL'
);
PREPARE bank_source_row_stmt FROM @sql;
EXECUTE bank_source_row_stmt;
DEALLOCATE PREPARE bank_source_row_stmt;
