-- Requires 2026-11-11-secretariat-workflow.sql. No legacy rows are rewritten.
CREATE TABLE IF NOT EXISTS siap_v11_managers (
  scope VARCHAR(12) PRIMARY KEY,
  user_id CHAR(36) NOT NULL UNIQUE,
  FOREIGN KEY (user_id) REFERENCES siap_users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS siap_v11_letters (
  letter_id CHAR(36) PRIMARY KEY,
  kind VARCHAR(24) NOT NULL DEFAULT 'CORRESPONDENCE',
  requesting_unit VARCHAR(20) NULL,
  received_time TIME NULL,
  delivery_method VARCHAR(16) NULL,
  delivered_by VARCHAR(255) NULL,
  received_by VARCHAR(255) NULL,
  receipt_note VARCHAR(1000) NULL,
  receipt_attachment_id CHAR(36) NULL,
  invoice_revision INT UNSIGNED NOT NULL DEFAULT 1,
  invoice_key CHAR(64) NULL UNIQUE,
  payable_id CHAR(36) NULL UNIQUE,
  persekot_checklist JSON NULL,
  spb_attachment_id CHAR(36) NULL,
  signature_provenance VARCHAR(24) NULL,
  signature_attachment_id CHAR(36) NULL,
  dispatch_channel VARCHAR(16) NULL,
  dispatch_recipient VARCHAR(255) NULL,
  dispatch_attachment_id CHAR(36) NULL,
  FOREIGN KEY (letter_id) REFERENCES siap_letters(id) ON DELETE RESTRICT,
  FOREIGN KEY (payable_id) REFERENCES siap_payables(id) ON DELETE RESTRICT,
  FOREIGN KEY (receipt_attachment_id) REFERENCES siap_attachments(id) ON DELETE RESTRICT,
  FOREIGN KEY (spb_attachment_id) REFERENCES siap_attachments(id) ON DELETE RESTRICT,
  FOREIGN KEY (signature_attachment_id) REFERENCES siap_attachments(id) ON DELETE RESTRICT,
  FOREIGN KEY (dispatch_attachment_id) REFERENCES siap_attachments(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS siap_v11_dispositions (
  disposition_id CHAR(36) PRIMARY KEY,
  purpose VARCHAR(24) NOT NULL,
  invoice_revision INT UNSIGNED NULL,
  result_letter_id CHAR(36) NULL,
  FOREIGN KEY (disposition_id) REFERENCES siap_dispositions(id) ON DELETE RESTRICT,
  FOREIGN KEY (result_letter_id) REFERENCES siap_letters(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS siap_v11_payments (
  id CHAR(36) PRIMARY KEY,
  letter_id CHAR(36) NOT NULL,
  payable_id CHAR(36) NOT NULL,
  disposition_id CHAR(36) NOT NULL,
  submitted_action_id CHAR(36) NOT NULL UNIQUE,
  amount DECIMAL(15,2) NOT NULL,
  payment_date DATE NOT NULL,
  payee VARCHAR(255) NOT NULL,
  recipient_account VARCHAR(120) NOT NULL,
  reference VARCHAR(150) NOT NULL,
  active_reference VARCHAR(150) NULL,
  bookkeeping_note VARCHAR(1000) NOT NULL,
  evidence_id CHAR(36) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  approved_by CHAR(36) NULL,
  approved_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_siap_v11_payment_ref (letter_id,active_reference),
  KEY idx_siap_v11_payment_task (disposition_id,status),
  FOREIGN KEY (letter_id) REFERENCES siap_v11_letters(letter_id) ON DELETE RESTRICT,
  FOREIGN KEY (payable_id) REFERENCES siap_payables(id) ON DELETE RESTRICT,
  FOREIGN KEY (disposition_id) REFERENCES siap_v11_dispositions(disposition_id) ON DELETE RESTRICT,
  FOREIGN KEY (submitted_action_id) REFERENCES siap_disposition_actions(id) ON DELETE RESTRICT,
  FOREIGN KEY (evidence_id) REFERENCES siap_attachments(id) ON DELETE RESTRICT,
  FOREIGN KEY (approved_by) REFERENCES siap_users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS siap_v11_signing (
  id CHAR(36) PRIMARY KEY,
  letter_id CHAR(36) NOT NULL UNIQUE,
  mode VARCHAR(12) NOT NULL,
  provider_id VARCHAR(160) NULL UNIQUE,
  status VARCHAR(24) NOT NULL,
  requested_by CHAR(36) NOT NULL,
  source_attachment_id CHAR(36) NOT NULL,
  final_attachment_id CHAR(36) NULL,
  next_poll_at DATETIME NULL,
  notification_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (letter_id) REFERENCES siap_v11_letters(letter_id) ON DELETE RESTRICT,
  FOREIGN KEY (requested_by) REFERENCES siap_users(id) ON DELETE RESTRICT,
  FOREIGN KEY (source_attachment_id) REFERENCES siap_attachments(id) ON DELETE RESTRICT,
  FOREIGN KEY (final_attachment_id) REFERENCES siap_attachments(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS siap_v11_signing_events (
  signing_id CHAR(36) NOT NULL,
  event_key CHAR(64) NOT NULL,
  received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (signing_id,event_key),
  FOREIGN KEY (signing_id) REFERENCES siap_v11_signing(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
