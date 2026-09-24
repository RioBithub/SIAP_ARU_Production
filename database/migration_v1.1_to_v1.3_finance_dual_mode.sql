-- SIAP ARU v1.3 - Finance Dual Mode migration
-- Target database: aru_siap
-- Jalankan sekali jika database sebelumnya sudah memakai SIAP ARU v1.1/v1.2.

USE aru_siap;
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS siap_finance_source_modes (
  ledger_type VARCHAR(20) PRIMARY KEY,
  data_mode VARCHAR(20) NOT NULL DEFAULT 'SUMMARY',
  updated_by CHAR(36) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_siap_fin_mode_user FOREIGN KEY (updated_by) REFERENCES siap_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS siap_finance_position_summaries (
  id CHAR(36) PRIMARY KEY,
  ledger_type VARCHAR(20) NOT NULL,
  as_of_date DATE NOT NULL,
  outstanding_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  due_30_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  due_30_count INT NOT NULL DEFAULT 0,
  aging_1_30_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  aging_30_60_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  aging_60_90_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  aging_90_plus_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  notes TEXT NULL,
  created_by CHAR(36) NOT NULL,
  updated_by CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_siap_fin_position_type (ledger_type),
  INDEX idx_siap_fin_position_date (as_of_date),
  CONSTRAINT fk_siap_fin_position_created FOREIGN KEY (created_by) REFERENCES siap_users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_siap_fin_position_updated FOREIGN KEY (updated_by) REFERENCES siap_users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @has_col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA='aru_siap' AND TABLE_NAME='siap_finance_attachments' AND COLUMN_NAME='ledger_summary_id'
);
SET @sql := IF(@has_col=0,
  'ALTER TABLE aru_siap.siap_finance_attachments ADD COLUMN ledger_summary_id CHAR(36) NULL AFTER payable_id',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA='aru_siap' AND TABLE_NAME='siap_finance_attachments' AND INDEX_NAME='idx_siap_fin_attach_ledger_summary'
);
SET @sql := IF(@has_idx=0,
  'ALTER TABLE aru_siap.siap_finance_attachments ADD INDEX idx_siap_fin_attach_ledger_summary (ledger_summary_id, created_at)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_fk := (
  SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA='aru_siap' AND CONSTRAINT_NAME='fk_siap_fin_attach_ledger_summary'
);
SET @sql := IF(@has_fk=0,
  'ALTER TABLE aru_siap.siap_finance_attachments ADD CONSTRAINT fk_siap_fin_attach_ledger_summary FOREIGN KEY (ledger_summary_id) REFERENCES aru_siap.siap_finance_position_summaries(id) ON DELETE CASCADE',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @root_id := (SELECT id FROM siap_users WHERE role='ROOT_ADMIN' ORDER BY created_at LIMIT 1);
INSERT INTO siap_finance_source_modes(ledger_type,data_mode,updated_by)
VALUES('RECEIVABLE','SUMMARY',@root_id)
ON DUPLICATE KEY UPDATE ledger_type=VALUES(ledger_type);
INSERT INTO siap_finance_source_modes(ledger_type,data_mode,updated_by)
VALUES('PAYABLE','SUMMARY',@root_id)
ON DUPLICATE KEY UPDATE ledger_type=VALUES(ledger_type);

SELECT ledger_type,data_mode,updated_at FROM siap_finance_source_modes ORDER BY ledger_type;
