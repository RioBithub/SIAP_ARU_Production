-- =============================================================
-- SIAP ARU v1.7.1 - Import Rekening Koran BRI PDF
-- Additive production migration
-- =============================================================

SET NAMES utf8mb4;

CREATE TABLE siap_bank_import_batches (
  id CHAR(36) PRIMARY KEY,
  bank_account_id CHAR(36) NOT NULL,
  source_bank VARCHAR(40) NOT NULL DEFAULT 'BRI',
  source_format VARCHAR(80) NOT NULL DEFAULT 'BRI_IBBIZ_PDF',
  parser_version VARCHAR(30) NOT NULL DEFAULT '1.0',
  original_name VARCHAR(255) NOT NULL,
  file_hash CHAR(64) NOT NULL,
  statement_date DATE NOT NULL,
  period_from DATE NOT NULL,
  period_to DATE NOT NULL,
  statement_opening_balance DECIMAL(18,2) NOT NULL,
  statement_closing_balance DECIMAL(18,2) NOT NULL,
  manual_opening_balance DECIMAL(18,2) NULL,
  manual_closing_balance DECIMAL(18,2) NULL,
  total_debit DECIMAL(18,2) NOT NULL DEFAULT 0,
  total_credit DECIMAL(18,2) NOT NULL DEFAULT 0,
  source_transaction_count INT NOT NULL DEFAULT 0,
  inserted_count INT NOT NULL DEFAULT 0,
  duplicate_count INT NOT NULL DEFAULT 0,
  source_document_id CHAR(36) NULL,
  parse_warnings_json LONGTEXT NULL,
  parsed_json LONGTEXT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  created_by CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  corrected_by CHAR(36) NULL,
  corrected_at DATETIME NULL,
  undone_by CHAR(36) NULL,
  undone_at DATETIME NULL,
  undo_reason VARCHAR(1000) NULL,
  INDEX idx_bank_import_account_period (bank_account_id, period_to, period_from),
  INDEX idx_bank_import_status (status),
  INDEX idx_bank_import_hash (bank_account_id, file_hash),
  CONSTRAINT fk_bank_import_account FOREIGN KEY (bank_account_id) REFERENCES siap_bank_accounts(id) ON DELETE RESTRICT,
  CONSTRAINT fk_bank_import_document FOREIGN KEY (source_document_id) REFERENCES siap_bank_documents(id) ON DELETE SET NULL,
  CONSTRAINT fk_bank_import_created FOREIGN KEY (created_by) REFERENCES siap_users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_bank_import_corrected FOREIGN KEY (corrected_by) REFERENCES siap_users(id) ON DELETE SET NULL,
  CONSTRAINT fk_bank_import_undone FOREIGN KEY (undone_by) REFERENCES siap_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE siap_bank_transactions
  ADD COLUMN import_batch_id CHAR(36) NULL AFTER bank_account_id,
  ADD COLUMN external_fingerprint CHAR(64) NULL AFTER import_batch_id,
  ADD COLUMN source_balance_after DECIMAL(18,2) NULL AFTER credit_amount,
  ADD INDEX idx_bank_tx_import_batch (import_batch_id),
  ADD UNIQUE KEY uq_bank_tx_external_fingerprint (bank_account_id, external_fingerprint),
  ADD CONSTRAINT fk_bank_tx_import_batch FOREIGN KEY (import_batch_id) REFERENCES siap_bank_import_batches(id) ON DELETE SET NULL;
