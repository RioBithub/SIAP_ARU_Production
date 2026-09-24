-- SIAP ARU v1 -> v2 Finance migration
-- Aman dijalankan berulang karena menggunakan CREATE TABLE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS siap_finance_monthly_summaries (
  id CHAR(36) PRIMARY KEY,
  period_month DATE NOT NULL,
  income_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  expense_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  budget_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  notes TEXT NULL,
  created_by CHAR(36) NOT NULL,
  updated_by CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_siap_fin_summary_created FOREIGN KEY (created_by) REFERENCES siap_users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_siap_fin_summary_updated FOREIGN KEY (updated_by) REFERENCES siap_users(id) ON DELETE RESTRICT,
  UNIQUE KEY uq_siap_fin_summary_period (period_month),
  INDEX idx_siap_fin_summary_period (period_month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS siap_finance_attachments (
  id CHAR(36) PRIMARY KEY,
  summary_id CHAR(36) NULL,
  receivable_id CHAR(36) NULL,
  payable_id CHAR(36) NULL,
  attachment_kind VARCHAR(40) NOT NULL DEFAULT 'SUPPORTING',
  original_name VARCHAR(255) NOT NULL,
  stored_name VARCHAR(255) NOT NULL,
  storage_path VARCHAR(500) NOT NULL,
  mime_type VARCHAR(150) NULL,
  original_size BIGINT NOT NULL,
  stored_size BIGINT NOT NULL,
  is_compressed TINYINT(1) NOT NULL DEFAULT 0,
  uploaded_by CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_siap_fin_attach_summary FOREIGN KEY (summary_id) REFERENCES siap_finance_monthly_summaries(id) ON DELETE CASCADE,
  CONSTRAINT fk_siap_fin_attach_receivable FOREIGN KEY (receivable_id) REFERENCES siap_receivables(id) ON DELETE CASCADE,
  CONSTRAINT fk_siap_fin_attach_payable FOREIGN KEY (payable_id) REFERENCES siap_payables(id) ON DELETE CASCADE,
  CONSTRAINT fk_siap_fin_attach_user FOREIGN KEY (uploaded_by) REFERENCES siap_users(id) ON DELETE RESTRICT,
  INDEX idx_siap_fin_attach_summary (summary_id, created_at),
  INDEX idx_siap_fin_attach_receivable (receivable_id, created_at),
  INDEX idx_siap_fin_attach_payable (payable_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
