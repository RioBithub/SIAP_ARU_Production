-- =============================================================
-- SIAP ARU v1.7.0 - Rekening Koran / Bank Statement
-- Existing production database migration (safe additive change)
-- =============================================================

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS siap_bank_accounts (
  id CHAR(36) PRIMARY KEY,
  bank_name VARCHAR(150) NOT NULL,
  account_name VARCHAR(200) NOT NULL,
  account_number VARCHAR(120) NOT NULL,
  product_name VARCHAR(150) NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'IDR',
  branch_name VARCHAR(180) NULL,
  unit_name VARCHAR(180) NULL,
  company_address VARCHAR(500) NULL,
  opening_balance DECIMAL(18,2) NOT NULL DEFAULT 0,
  opening_balance_date DATE NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by CHAR(36) NOT NULL,
  updated_by CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_siap_bank_account_number (account_number),
  INDEX idx_siap_bank_account_active (is_active),
  CONSTRAINT fk_siap_bank_account_created FOREIGN KEY (created_by) REFERENCES siap_users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_siap_bank_account_updated FOREIGN KEY (updated_by) REFERENCES siap_users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS siap_bank_transactions (
  id CHAR(36) PRIMARY KEY,
  bank_account_id CHAR(36) NOT NULL,
  transaction_at DATETIME NOT NULL,
  description VARCHAR(500) NOT NULL,
  teller_id VARCHAR(120) NULL,
  reference_no VARCHAR(120) NULL,
  debit_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  credit_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  notes VARCHAR(1000) NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  void_reason VARCHAR(1000) NULL,
  voided_by CHAR(36) NULL,
  voided_at DATETIME NULL,
  created_by CHAR(36) NOT NULL,
  updated_by CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_siap_bank_tx_account_date (bank_account_id, transaction_at),
  INDEX idx_siap_bank_tx_status (status),
  INDEX idx_siap_bank_tx_reference (reference_no),
  CONSTRAINT fk_siap_bank_tx_account FOREIGN KEY (bank_account_id) REFERENCES siap_bank_accounts(id) ON DELETE RESTRICT,
  CONSTRAINT fk_siap_bank_tx_voided FOREIGN KEY (voided_by) REFERENCES siap_users(id) ON DELETE SET NULL,
  CONSTRAINT fk_siap_bank_tx_created FOREIGN KEY (created_by) REFERENCES siap_users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_siap_bank_tx_updated FOREIGN KEY (updated_by) REFERENCES siap_users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
