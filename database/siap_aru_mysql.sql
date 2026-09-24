
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS siap_users (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  email VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(40) NOT NULL,
  unit_name VARCHAR(120) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_siap_users_role (role),
  INDEX idx_siap_users_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS siap_sessions (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ip_address VARCHAR(64) NULL,
  user_agent VARCHAR(500) NULL,
  CONSTRAINT fk_siap_sessions_user FOREIGN KEY (user_id) REFERENCES siap_users(id) ON DELETE CASCADE,
  INDEX idx_siap_sessions_user (user_id),
  INDEX idx_siap_sessions_exp (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS siap_number_formats (
  id CHAR(36) PRIMARY KEY,
  code VARCHAR(40) NOT NULL UNIQUE,
  name VARCHAR(150) NOT NULL,
  document_type VARCHAR(80) NOT NULL,
  pattern VARCHAR(255) NOT NULL,
  description VARCHAR(500) NULL,
  sequence_start INT NOT NULL DEFAULT 1,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_siap_number_formats_user FOREIGN KEY (created_by) REFERENCES siap_users(id) ON DELETE SET NULL,
  INDEX idx_siap_number_formats_type (document_type, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- direction: INCOMING / INTERNAL / OUTGOING
-- INTERNAL dipakai untuk Nota Dinas / Lembar Pengantar Staff ke manajemen.
CREATE TABLE IF NOT EXISTS siap_letters (
  id CHAR(36) PRIMARY KEY,
  direction VARCHAR(20) NOT NULL,
  document_type VARCHAR(80) NOT NULL,
  number_format_id CHAR(36) NULL,
  letter_number VARCHAR(255) NULL,
  external_number VARCHAR(255) NULL,
  subject VARCHAR(500) NOT NULL,
  sender VARCHAR(255) NULL,
  recipient VARCHAR(255) NULL,
  letter_date DATE NOT NULL,
  received_date DATE NULL,
  issued_date DATE NULL,
  confidentiality VARCHAR(20) NOT NULL DEFAULT 'BIASA',
  summary TEXT NULL,
  notes TEXT NULL,
  status VARCHAR(50) NOT NULL,
  current_role VARCHAR(40) NULL,
  current_owner_user_id CHAR(36) NULL,
  is_public TINYINT(1) NOT NULL DEFAULT 1,
  is_backdated TINYINT(1) NOT NULL DEFAULT 0,
  cancelled_reason VARCHAR(1000) NULL,
  created_by CHAR(36) NOT NULL,
  updated_by CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_siap_letters_format FOREIGN KEY (number_format_id) REFERENCES siap_number_formats(id) ON DELETE SET NULL,
  CONSTRAINT fk_siap_letters_owner FOREIGN KEY (current_owner_user_id) REFERENCES siap_users(id) ON DELETE SET NULL,
  CONSTRAINT fk_siap_letters_created FOREIGN KEY (created_by) REFERENCES siap_users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_siap_letters_updated FOREIGN KEY (updated_by) REFERENCES siap_users(id) ON DELETE RESTRICT,
  INDEX idx_siap_letters_direction_status (direction, status),
  INDEX idx_siap_letters_date (letter_date),
  INDEX idx_siap_letters_owner (current_owner_user_id),
  INDEX idx_siap_letters_public (is_public)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS siap_number_ledger (
  id CHAR(36) PRIMARY KEY,
  format_id CHAR(36) NOT NULL,
  letter_id CHAR(36) NULL,
  number_year SMALLINT NOT NULL,
  letter_date DATE NOT NULL,
  seq_base INT NOT NULL,
  variant INT NOT NULL DEFAULT 0,
  rendered_number VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'RESERVED',
  cancelled_reason VARCHAR(1000) NULL,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_siap_ledger_format FOREIGN KEY (format_id) REFERENCES siap_number_formats(id) ON DELETE RESTRICT,
  CONSTRAINT fk_siap_ledger_letter FOREIGN KEY (letter_id) REFERENCES siap_letters(id) ON DELETE SET NULL,
  CONSTRAINT fk_siap_ledger_user FOREIGN KEY (created_by) REFERENCES siap_users(id) ON DELETE RESTRICT,
  UNIQUE KEY uq_siap_ledger_slot (format_id, number_year, seq_base, variant),
  UNIQUE KEY uq_siap_ledger_format_rendered (format_id, rendered_number),
  INDEX idx_siap_ledger_date (format_id, number_year, letter_date),
  INDEX idx_siap_ledger_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS siap_dispositions (
  id CHAR(36) PRIMARY KEY,
  letter_id CHAR(36) NOT NULL,
  parent_id CHAR(36) NULL,
  from_user_id CHAR(36) NOT NULL,
  to_user_id CHAR(36) NOT NULL,
  visibility VARCHAR(20) NOT NULL DEFAULT 'ROUTE',
  instruction TEXT NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'UNSEEN',
  priority VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
  due_date DATE NULL,
  seen_at DATETIME NULL,
  started_at DATETIME NULL,
  completed_at DATETIME NULL,
  returned_at DATETIME NULL,
  return_note TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_siap_disp_letter FOREIGN KEY (letter_id) REFERENCES siap_letters(id) ON DELETE CASCADE,
  CONSTRAINT fk_siap_disp_parent FOREIGN KEY (parent_id) REFERENCES siap_dispositions(id) ON DELETE SET NULL,
  CONSTRAINT fk_siap_disp_from FOREIGN KEY (from_user_id) REFERENCES siap_users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_siap_disp_to FOREIGN KEY (to_user_id) REFERENCES siap_users(id) ON DELETE RESTRICT,
  INDEX idx_siap_disp_letter (letter_id),
  INDEX idx_siap_disp_to_status (to_user_id, status),
  INDEX idx_siap_disp_visibility (visibility)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS siap_letter_actions (
  id CHAR(36) PRIMARY KEY,
  letter_id CHAR(36) NOT NULL,
  actor_user_id CHAR(36) NOT NULL,
  action VARCHAR(50) NOT NULL,
  from_status VARCHAR(50) NULL,
  to_status VARCHAR(50) NULL,
  comment TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_siap_actions_letter FOREIGN KEY (letter_id) REFERENCES siap_letters(id) ON DELETE CASCADE,
  CONSTRAINT fk_siap_actions_actor FOREIGN KEY (actor_user_id) REFERENCES siap_users(id) ON DELETE RESTRICT,
  INDEX idx_siap_actions_letter (letter_id, created_at),
  INDEX idx_siap_actions_actor (actor_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS siap_attachments (
  id CHAR(36) PRIMARY KEY,
  letter_id CHAR(36) NULL,
  disposition_id CHAR(36) NULL,
  letter_action_id CHAR(36) NULL,
  attachment_kind VARCHAR(30) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  stored_name VARCHAR(255) NOT NULL,
  storage_path VARCHAR(500) NOT NULL,
  mime_type VARCHAR(150) NULL,
  original_size BIGINT NOT NULL,
  stored_size BIGINT NOT NULL,
  is_compressed TINYINT(1) NOT NULL DEFAULT 0,
  uploaded_by CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_siap_attach_letter FOREIGN KEY (letter_id) REFERENCES siap_letters(id) ON DELETE CASCADE,
  CONSTRAINT fk_siap_attach_disp FOREIGN KEY (disposition_id) REFERENCES siap_dispositions(id) ON DELETE CASCADE,
  CONSTRAINT fk_siap_attach_action FOREIGN KEY (letter_action_id) REFERENCES siap_letter_actions(id) ON DELETE SET NULL,
  CONSTRAINT fk_siap_attach_user FOREIGN KEY (uploaded_by) REFERENCES siap_users(id) ON DELETE RESTRICT,
  INDEX idx_siap_attach_letter (letter_id),
  INDEX idx_siap_attach_disp (disposition_id),
  INDEX idx_siap_attach_action (letter_action_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS siap_finance_entries (
  id CHAR(36) PRIMARY KEY,
  entry_type VARCHAR(20) NOT NULL,
  entry_date DATE NOT NULL,
  category VARCHAR(120) NOT NULL,
  description VARCHAR(500) NOT NULL,
  amount DECIMAL(18,2) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'POSTED',
  reference_no VARCHAR(120) NULL,
  created_by CHAR(36) NOT NULL,
  updated_by CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_siap_fin_created FOREIGN KEY (created_by) REFERENCES siap_users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_siap_fin_updated FOREIGN KEY (updated_by) REFERENCES siap_users(id) ON DELETE RESTRICT,
  INDEX idx_siap_fin_type_date (entry_type, entry_date),
  INDEX idx_siap_fin_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS siap_budgets (
  id CHAR(36) PRIMARY KEY,
  budget_year SMALLINT NOT NULL,
  category VARCHAR(120) NOT NULL,
  amount DECIMAL(18,2) NOT NULL,
  notes VARCHAR(500) NULL,
  created_by CHAR(36) NOT NULL,
  updated_by CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_siap_budget_created FOREIGN KEY (created_by) REFERENCES siap_users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_siap_budget_updated FOREIGN KEY (updated_by) REFERENCES siap_users(id) ON DELETE RESTRICT,
  UNIQUE KEY uq_siap_budget_year_category (budget_year, category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS siap_receivables (
  id CHAR(36) PRIMARY KEY,
  counterparty VARCHAR(255) NOT NULL,
  invoice_no VARCHAR(120) NOT NULL,
  invoice_date DATE NOT NULL,
  due_date DATE NOT NULL,
  amount DECIMAL(18,2) NOT NULL,
  paid_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  status VARCHAR(30) NOT NULL DEFAULT 'OPEN',
  notes VARCHAR(1000) NULL,
  created_by CHAR(36) NOT NULL,
  updated_by CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_siap_recv_created FOREIGN KEY (created_by) REFERENCES siap_users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_siap_recv_updated FOREIGN KEY (updated_by) REFERENCES siap_users(id) ON DELETE RESTRICT,
  UNIQUE KEY uq_siap_receivable_invoice (invoice_no),
  INDEX idx_siap_receivable_due (due_date, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS siap_payables (
  id CHAR(36) PRIMARY KEY,
  counterparty VARCHAR(255) NOT NULL,
  invoice_no VARCHAR(120) NOT NULL,
  invoice_date DATE NOT NULL,
  due_date DATE NOT NULL,
  amount DECIMAL(18,2) NOT NULL,
  paid_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  status VARCHAR(30) NOT NULL DEFAULT 'OPEN',
  notes VARCHAR(1000) NULL,
  created_by CHAR(36) NOT NULL,
  updated_by CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_siap_pay_created FOREIGN KEY (created_by) REFERENCES siap_users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_siap_pay_updated FOREIGN KEY (updated_by) REFERENCES siap_users(id) ON DELETE RESTRICT,
  UNIQUE KEY uq_siap_payable_invoice (invoice_no),
  INDEX idx_siap_payable_due (due_date, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;



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

CREATE TABLE IF NOT EXISTS siap_finance_attachments (
  id CHAR(36) PRIMARY KEY,
  summary_id CHAR(36) NULL,
  receivable_id CHAR(36) NULL,
  payable_id CHAR(36) NULL,
  ledger_summary_id CHAR(36) NULL,
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
  CONSTRAINT fk_siap_fin_attach_ledger_summary FOREIGN KEY (ledger_summary_id) REFERENCES siap_finance_position_summaries(id) ON DELETE CASCADE,
  CONSTRAINT fk_siap_fin_attach_user FOREIGN KEY (uploaded_by) REFERENCES siap_users(id) ON DELETE RESTRICT,
  INDEX idx_siap_fin_attach_summary (summary_id, created_at),
  INDEX idx_siap_fin_attach_receivable (receivable_id, created_at),
  INDEX idx_siap_fin_attach_payable (payable_id, created_at),
  INDEX idx_siap_fin_attach_ledger_summary (ledger_summary_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS siap_audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id CHAR(36) NULL,
  action VARCHAR(80) NOT NULL,
  entity_type VARCHAR(80) NOT NULL,
  entity_id VARCHAR(80) NULL,
  metadata_json JSON NULL,
  ip_address VARCHAR(64) NULL,
  user_agent VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_siap_audit_user FOREIGN KEY (user_id) REFERENCES siap_users(id) ON DELETE SET NULL,
  INDEX idx_siap_audit_created (created_at),
  INDEX idx_siap_audit_entity (entity_type, entity_id),
  INDEX idx_siap_audit_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
