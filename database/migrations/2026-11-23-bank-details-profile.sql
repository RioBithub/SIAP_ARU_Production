SET @sql = IF(
  EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()
          AND TABLE_NAME='siap_users' AND COLUMN_NAME='alias'),
  'SELECT 1',
  'ALTER TABLE siap_users ADD COLUMN alias VARCHAR(150) NULL'
);
PREPARE user_alias_stmt FROM @sql;
EXECUTE user_alias_stmt;
DEALLOCATE PREPARE user_alias_stmt;

CREATE TABLE IF NOT EXISTS siap_bank_detail_imports (
  id CHAR(36) PRIMARY KEY,
  bank_account_id CHAR(36) NOT NULL,
  file_hash CHAR(64) NOT NULL,
  document_id CHAR(36) NULL,
  original_name VARCHAR(255) NOT NULL,
  period_from DATE NOT NULL,
  period_to DATE NOT NULL,
  inserted_count INT UNSIGNED NOT NULL,
  duplicate_count INT UNSIGNED NOT NULL,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_bank_detail_file (bank_account_id,file_hash),
  CONSTRAINT fk_bank_detail_import_account FOREIGN KEY (bank_account_id) REFERENCES siap_bank_accounts(id),
  CONSTRAINT fk_bank_detail_import_document FOREIGN KEY (document_id) REFERENCES siap_bank_documents(id) ON DELETE SET NULL,
  CONSTRAINT fk_bank_detail_import_user FOREIGN KEY (created_by) REFERENCES siap_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS siap_bank_detail_rows (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  bank_account_id CHAR(36) NOT NULL,
  import_id CHAR(36) NOT NULL,
  fingerprint CHAR(64) NOT NULL,
  entry_date DATE NOT NULL,
  description VARCHAR(2000) NOT NULL,
  proof_no VARCHAR(150) NULL,
  debit_amount DECIMAL(18,2) NOT NULL,
  credit_amount DECIMAL(18,2) NOT NULL,
  balance DECIMAL(18,2) NOT NULL,
  gl_debit_increases TINYINT(1) NOT NULL,
  UNIQUE KEY uq_bank_detail_row (bank_account_id,fingerprint),
  INDEX idx_bank_detail_date (bank_account_id,entry_date,id),
  CONSTRAINT fk_bank_detail_row_account FOREIGN KEY (bank_account_id) REFERENCES siap_bank_accounts(id),
  CONSTRAINT fk_bank_detail_row_import FOREIGN KEY (import_id) REFERENCES siap_bank_detail_imports(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
