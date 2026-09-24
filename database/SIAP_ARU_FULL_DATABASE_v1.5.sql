-- =====================================================================
-- SIAP ARU v1.5 - FULL DATABASE (PHPMyAdmin Safe) (SCHEMA + OPERATIONAL USERS)
-- PT Aru Raharja
-- Database  : aru_siap
-- Target    : MySQL 8.x / MariaDB compatible via XAMPP
-- Purpose   : Import pertama kali dari database kosong
--
-- ISI FILE INI:
--   1. CREATE DATABASE aru_siap
--   2. CREATE seluruh tabel SIAP ARU
--   3. CREATE seluruh index, foreign key, dan constraint
--   4. Bootstrap seluruh akun operasional awal
--   5. Bootstrap mode Finance dan format nomor surat awal
--
-- TIDAK ADA:
--   - data surat dummy
--   - data Finance dummy
--   - data piutang/utang dummy
--   - data disposisi dummy
--
-- Akun awal:
--   Root Admin : root@aruraharja.co.id / AdminARU!2026
--   Operasional: password awal SiapARU!2026
-- WAJIB GANTI PASSWORD SETELAH LOGIN PERTAMA / PENYERAHAN AKUN.
-- =====================================================================

SET NAMES utf8mb4;
SET time_zone = '+07:00';

CREATE DATABASE IF NOT EXISTS `aru_siap`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `aru_siap`;

SET FOREIGN_KEY_CHECKS = 0;

-- =====================================================================
-- 1. USERS
-- =====================================================================
CREATE TABLE IF NOT EXISTS `aru_siap`.`siap_users` (
  id CHAR(36) NOT NULL,
  name VARCHAR(150) NOT NULL,
  email VARCHAR(190) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(40) NOT NULL,
  unit_name VARCHAR(120) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_siap_users_email (email),
  INDEX idx_siap_users_role (role),
  INDEX idx_siap_users_active (is_active)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- 2. SESSIONS
-- =====================================================================
CREATE TABLE IF NOT EXISTS `aru_siap`.`siap_sessions` (
  id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ip_address VARCHAR(64) NULL,
  user_agent VARCHAR(500) NULL,

  PRIMARY KEY (id),
  UNIQUE KEY uq_siap_sessions_token_hash (token_hash),
  INDEX idx_siap_sessions_user (user_id),
  INDEX idx_siap_sessions_exp (expires_at),

  CONSTRAINT fk_siap_sessions_user
    FOREIGN KEY (user_id)
    REFERENCES `aru_siap`.`siap_users`(id)
    ON DELETE CASCADE
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- 3. FORMAT NOMOR SURAT
-- =====================================================================
CREATE TABLE IF NOT EXISTS `aru_siap`.`siap_number_formats` (
  id CHAR(36) NOT NULL,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(150) NOT NULL,
  document_type VARCHAR(80) NOT NULL,
  pattern VARCHAR(255) NOT NULL,
  description VARCHAR(500) NULL,
  sequence_start INT NOT NULL DEFAULT 1,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_siap_number_formats_code (code),
  INDEX idx_siap_number_formats_type (document_type, is_active),

  CONSTRAINT fk_siap_number_formats_user
    FOREIGN KEY (created_by)
    REFERENCES `aru_siap`.`siap_users`(id)
    ON DELETE SET NULL
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- 4. DOKUMEN PERSURATAN
-- direction mendukung: INCOMING / INTERNAL / OUTGOING
-- INTERNAL = Nota Dinas / Lembar Pengantar Staff ke manajemen.
-- =====================================================================
CREATE TABLE IF NOT EXISTS `aru_siap`.`siap_letters` (
  id CHAR(36) NOT NULL,
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

  PRIMARY KEY (id),

  INDEX idx_siap_letters_direction_status (direction, status),
  INDEX idx_siap_letters_date (letter_date),
  INDEX idx_siap_letters_owner (current_owner_user_id),
  INDEX idx_siap_letters_public (is_public),
  INDEX idx_siap_letters_number (letter_number),
  INDEX idx_siap_letters_external_number (external_number),

  CONSTRAINT fk_siap_letters_format
    FOREIGN KEY (number_format_id)
    REFERENCES `aru_siap`.`siap_number_formats`(id)
    ON DELETE SET NULL,

  CONSTRAINT fk_siap_letters_owner
    FOREIGN KEY (current_owner_user_id)
    REFERENCES `aru_siap`.`siap_users`(id)
    ON DELETE SET NULL,

  CONSTRAINT fk_siap_letters_created
    FOREIGN KEY (created_by)
    REFERENCES `aru_siap`.`siap_users`(id)
    ON DELETE RESTRICT,

  CONSTRAINT fk_siap_letters_updated
    FOREIGN KEY (updated_by)
    REFERENCES `aru_siap`.`siap_users`(id)
    ON DELETE RESTRICT
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- 5. LEDGER NOMOR SURAT
-- Menjaga nomor tidak duplicate.
-- Mendukung nomor 71 -> 71.1 -> 71.2 dst.
-- Nomor CANCELLED tidak digunakan ulang.
-- =====================================================================
CREATE TABLE IF NOT EXISTS `aru_siap`.`siap_number_ledger` (
  id CHAR(36) NOT NULL,
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

  PRIMARY KEY (id),

  UNIQUE KEY uq_siap_ledger_slot
    (format_id, number_year, seq_base, variant),

  UNIQUE KEY uq_siap_ledger_format_rendered
    (format_id, rendered_number),

  INDEX idx_siap_ledger_date
    (format_id, number_year, letter_date),

  INDEX idx_siap_ledger_status
    (status),

  CONSTRAINT fk_siap_ledger_format
    FOREIGN KEY (format_id)
    REFERENCES `aru_siap`.`siap_number_formats`(id)
    ON DELETE RESTRICT,

  CONSTRAINT fk_siap_ledger_letter
    FOREIGN KEY (letter_id)
    REFERENCES `aru_siap`.`siap_letters`(id)
    ON DELETE SET NULL,

  CONSTRAINT fk_siap_ledger_user
    FOREIGN KEY (created_by)
    REFERENCES `aru_siap`.`siap_users`(id)
    ON DELETE RESTRICT
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- 6. DISPOSISI
-- =====================================================================
CREATE TABLE IF NOT EXISTS `aru_siap`.`siap_dispositions` (
  id CHAR(36) NOT NULL,
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

  PRIMARY KEY (id),

  INDEX idx_siap_disp_letter (letter_id),
  INDEX idx_siap_disp_to_status (to_user_id, status),
  INDEX idx_siap_disp_from_status (from_user_id, status),
  INDEX idx_siap_disp_visibility (visibility),
  INDEX idx_siap_disp_due_date (due_date),

  CONSTRAINT fk_siap_disp_letter
    FOREIGN KEY (letter_id)
    REFERENCES `aru_siap`.`siap_letters`(id)
    ON DELETE CASCADE,

  CONSTRAINT fk_siap_disp_parent
    FOREIGN KEY (parent_id)
    REFERENCES `aru_siap`.`siap_dispositions`(id)
    ON DELETE SET NULL,

  CONSTRAINT fk_siap_disp_from
    FOREIGN KEY (from_user_id)
    REFERENCES `aru_siap`.`siap_users`(id)
    ON DELETE RESTRICT,

  CONSTRAINT fk_siap_disp_to
    FOREIGN KEY (to_user_id)
    REFERENCES `aru_siap`.`siap_users`(id)
    ON DELETE RESTRICT
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- 7. ATTACHMENT SURAT / DISPOSISI
-- Surat asli: tidak dikompresi oleh aplikasi.
-- Lampiran tambahan/disposisi: dikompresi bila hasilnya lebih kecil.
-- =====================================================================
CREATE TABLE IF NOT EXISTS `aru_siap`.`siap_attachments` (
  id CHAR(36) NOT NULL,

  letter_id CHAR(36) NULL,
  disposition_id CHAR(36) NULL,

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

  PRIMARY KEY (id),

  INDEX idx_siap_attach_letter (letter_id),
  INDEX idx_siap_attach_disp (disposition_id),
  INDEX idx_siap_attach_created (created_at),

  CONSTRAINT fk_siap_attach_letter
    FOREIGN KEY (letter_id)
    REFERENCES `aru_siap`.`siap_letters`(id)
    ON DELETE CASCADE,

  CONSTRAINT fk_siap_attach_disp
    FOREIGN KEY (disposition_id)
    REFERENCES `aru_siap`.`siap_dispositions`(id)
    ON DELETE CASCADE,

  CONSTRAINT fk_siap_attach_user
    FOREIGN KEY (uploaded_by)
    REFERENCES `aru_siap`.`siap_users`(id)
    ON DELETE RESTRICT
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- 8. RIWAYAT ACTION SURAT
-- =====================================================================
CREATE TABLE IF NOT EXISTS `aru_siap`.`siap_letter_actions` (
  id CHAR(36) NOT NULL,
  letter_id CHAR(36) NOT NULL,
  actor_user_id CHAR(36) NOT NULL,

  action VARCHAR(50) NOT NULL,
  from_status VARCHAR(50) NULL,
  to_status VARCHAR(50) NULL,
  comment TEXT NULL,

  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),

  INDEX idx_siap_actions_letter (letter_id, created_at),
  INDEX idx_siap_actions_actor (actor_user_id),

  CONSTRAINT fk_siap_actions_letter
    FOREIGN KEY (letter_id)
    REFERENCES `aru_siap`.`siap_letters`(id)
    ON DELETE CASCADE,

  CONSTRAINT fk_siap_actions_actor
    FOREIGN KEY (actor_user_id)
    REFERENCES `aru_siap`.`siap_users`(id)
    ON DELETE RESTRICT
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- 9. LEGACY/COMPATIBILITY FINANCE ENTRY
-- Dipertahankan untuk kompatibilitas source versi sebelumnya.
-- v1.1 utama menggunakan siap_finance_monthly_summaries.
-- =====================================================================
CREATE TABLE IF NOT EXISTS `aru_siap`.`siap_finance_entries` (
  id CHAR(36) NOT NULL,
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

  PRIMARY KEY (id),

  INDEX idx_siap_fin_type_date (entry_type, entry_date),
  INDEX idx_siap_fin_category (category),

  CONSTRAINT fk_siap_fin_created
    FOREIGN KEY (created_by)
    REFERENCES `aru_siap`.`siap_users`(id)
    ON DELETE RESTRICT,

  CONSTRAINT fk_siap_fin_updated
    FOREIGN KEY (updated_by)
    REFERENCES `aru_siap`.`siap_users`(id)
    ON DELETE RESTRICT
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- 10. LEGACY/COMPATIBILITY BUDGET
-- v1.1 ringkasan bulanan memakai budget_amount.
-- =====================================================================
CREATE TABLE IF NOT EXISTS `aru_siap`.`siap_budgets` (
  id CHAR(36) NOT NULL,
  budget_year SMALLINT NOT NULL,
  category VARCHAR(120) NOT NULL,
  amount DECIMAL(18,2) NOT NULL,
  notes VARCHAR(500) NULL,

  created_by CHAR(36) NOT NULL,
  updated_by CHAR(36) NOT NULL,

  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),

  UNIQUE KEY uq_siap_budget_year_category (budget_year, category),

  CONSTRAINT fk_siap_budget_created
    FOREIGN KEY (created_by)
    REFERENCES `aru_siap`.`siap_users`(id)
    ON DELETE RESTRICT,

  CONSTRAINT fk_siap_budget_updated
    FOREIGN KEY (updated_by)
    REFERENCES `aru_siap`.`siap_users`(id)
    ON DELETE RESTRICT
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- 11. PIUTANG
-- =====================================================================
CREATE TABLE IF NOT EXISTS `aru_siap`.`siap_receivables` (
  id CHAR(36) NOT NULL,

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

  PRIMARY KEY (id),

  UNIQUE KEY uq_siap_receivable_invoice (invoice_no),
  INDEX idx_siap_receivable_due (due_date, status),
  INDEX idx_siap_receivable_counterparty (counterparty),

  CONSTRAINT fk_siap_recv_created
    FOREIGN KEY (created_by)
    REFERENCES `aru_siap`.`siap_users`(id)
    ON DELETE RESTRICT,

  CONSTRAINT fk_siap_recv_updated
    FOREIGN KEY (updated_by)
    REFERENCES `aru_siap`.`siap_users`(id)
    ON DELETE RESTRICT
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- 12. UTANG
-- =====================================================================
CREATE TABLE IF NOT EXISTS `aru_siap`.`siap_payables` (
  id CHAR(36) NOT NULL,

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

  PRIMARY KEY (id),

  UNIQUE KEY uq_siap_payable_invoice (invoice_no),
  INDEX idx_siap_payable_due (due_date, status),
  INDEX idx_siap_payable_counterparty (counterparty),

  CONSTRAINT fk_siap_pay_created
    FOREIGN KEY (created_by)
    REFERENCES `aru_siap`.`siap_users`(id)
    ON DELETE RESTRICT,

  CONSTRAINT fk_siap_pay_updated
    FOREIGN KEY (updated_by)
    REFERENCES `aru_siap`.`siap_users`(id)
    ON DELETE RESTRICT
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- 13. RINGKASAN KEUANGAN BULANAN
-- Finance mengedit langsung Pendapatan/Biaya/Anggaran.
-- Laba = income_amount - expense_amount.
-- =====================================================================
CREATE TABLE IF NOT EXISTS `aru_siap`.`siap_finance_monthly_summaries` (
  id CHAR(36) NOT NULL,

  period_month DATE NOT NULL,

  income_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  expense_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  budget_amount DECIMAL(18,2) NOT NULL DEFAULT 0,

  notes TEXT NULL,

  created_by CHAR(36) NOT NULL,
  updated_by CHAR(36) NOT NULL,

  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),

  UNIQUE KEY uq_siap_fin_summary_period (period_month),
  INDEX idx_siap_fin_summary_period (period_month),

  CONSTRAINT fk_siap_fin_summary_created
    FOREIGN KEY (created_by)
    REFERENCES `aru_siap`.`siap_users`(id)
    ON DELETE RESTRICT,

  CONSTRAINT fk_siap_fin_summary_updated
    FOREIGN KEY (updated_by)
    REFERENCES `aru_siap`.`siap_users`(id)
    ON DELETE RESTRICT
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- 14. MODE SUMBER DATA PIUTANG / UTANG
-- SUMMARY = posisi ringkas diisi Finance.
-- DETAIL  = dihitung otomatis dari detail invoice.
-- =====================================================================
CREATE TABLE IF NOT EXISTS `aru_siap`.`siap_finance_source_modes` (
  ledger_type VARCHAR(20) NOT NULL,
  data_mode VARCHAR(20) NOT NULL DEFAULT 'SUMMARY',
  updated_by CHAR(36) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (ledger_type),

  CONSTRAINT fk_siap_fin_mode_user
    FOREIGN KEY (updated_by)
    REFERENCES `aru_siap`.`siap_users`(id)
    ON DELETE SET NULL
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- 15. POSISI RINGKAS PIUTANG / UTANG
-- Dipakai ketika source mode = SUMMARY.
-- Overdue dihitung aplikasi dari total bucket aging.
-- =====================================================================
CREATE TABLE IF NOT EXISTS `aru_siap`.`siap_finance_position_summaries` (
  id CHAR(36) NOT NULL,
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

  PRIMARY KEY (id),
  UNIQUE KEY uq_siap_fin_position_type (ledger_type),
  INDEX idx_siap_fin_position_date (as_of_date),

  CONSTRAINT fk_siap_fin_position_created
    FOREIGN KEY (created_by)
    REFERENCES `aru_siap`.`siap_users`(id)
    ON DELETE RESTRICT,

  CONSTRAINT fk_siap_fin_position_updated
    FOREIGN KEY (updated_by)
    REFERENCES `aru_siap`.`siap_users`(id)
    ON DELETE RESTRICT
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- 16. ATTACHMENT KEUANGAN

-- Dapat terkait ringkasan bulanan, piutang, atau utang.
-- =====================================================================
CREATE TABLE IF NOT EXISTS `aru_siap`.`siap_finance_attachments` (
  id CHAR(36) NOT NULL,

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

  PRIMARY KEY (id),

  INDEX idx_siap_fin_attach_summary (summary_id, created_at),
  INDEX idx_siap_fin_attach_receivable (receivable_id, created_at),
  INDEX idx_siap_fin_attach_payable (payable_id, created_at),
  INDEX idx_siap_fin_attach_ledger_summary (ledger_summary_id, created_at),

  CONSTRAINT fk_siap_fin_attach_summary
    FOREIGN KEY (summary_id)
    REFERENCES `aru_siap`.`siap_finance_monthly_summaries`(id)
    ON DELETE CASCADE,

  CONSTRAINT fk_siap_fin_attach_receivable
    FOREIGN KEY (receivable_id)
    REFERENCES `aru_siap`.`siap_receivables`(id)
    ON DELETE CASCADE,

  CONSTRAINT fk_siap_fin_attach_payable
    FOREIGN KEY (payable_id)
    REFERENCES `aru_siap`.`siap_payables`(id)
    ON DELETE CASCADE,

  CONSTRAINT fk_siap_fin_attach_ledger_summary
    FOREIGN KEY (ledger_summary_id)
    REFERENCES `aru_siap`.`siap_finance_position_summaries`(id)
    ON DELETE CASCADE,

  CONSTRAINT fk_siap_fin_attach_user
    FOREIGN KEY (uploaded_by)
    REFERENCES `aru_siap`.`siap_users`(id)
    ON DELETE RESTRICT
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- 17. AUDIT LOG
-- =====================================================================
CREATE TABLE IF NOT EXISTS `aru_siap`.`siap_audit_logs` (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

  user_id CHAR(36) NULL,
  action VARCHAR(80) NOT NULL,
  entity_type VARCHAR(80) NOT NULL,
  entity_id VARCHAR(80) NULL,

  metadata_json JSON NULL,

  ip_address VARCHAR(64) NULL,
  user_agent VARCHAR(500) NULL,

  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),

  INDEX idx_siap_audit_created (created_at),
  INDEX idx_siap_audit_entity (entity_type, entity_id),
  INDEX idx_siap_audit_user (user_id),
  INDEX idx_siap_audit_action (action),

  CONSTRAINT fk_siap_audit_user
    FOREIGN KEY (user_id)
    REFERENCES `aru_siap`.`siap_users`(id)
    ON DELETE SET NULL
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

-- =====================================================================
-- BOOTSTRAP MINIMUM DATA
-- Bukan demo/seed bisnis.
-- Dibutuhkan agar aplikasi bisa langsung login dan membuat surat keluar.
-- =====================================================================

-- Root Admin
-- Password: AdminARU!2026
INSERT INTO `aru_siap`.`siap_users` (
  id,
  name,
  email,
  password_hash,
  role,
  unit_name,
  is_active,
  created_at,
  updated_at
)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'Root Administrator',
  'root@aruraharja.co.id',
  '$2b$12$7fQKbiKtfKQ3EEKEqR4wNe/2CO8WBpBZY212Z6vvPd/cYNQ.STE7S',
  'ROOT_ADMIN',
  'IT / System',
  1,
  NOW(),
  NOW()
)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  password_hash = VALUES(password_hash),
  role = 'ROOT_ADMIN',
  unit_name = 'IT / System',
  is_active = 1;

SET @SIAP_ROOT_ID := (
  SELECT id
  FROM `aru_siap`.`siap_users`
  WHERE email = 'root@aruraharja.co.id'
  LIMIT 1
);

-- Seluruh akun operasional awal.
-- Password awal semua akun di bawah ini: SiapARU!2026
INSERT INTO `aru_siap`.`siap_users`
(id,name,email,password_hash,role,unit_name,is_active,created_at,updated_at)
VALUES
(UUID(),'Staff Administrasi','staff@aruraharja.co.id','$2b$12$WS2MtnNdx35TKcNaPD59H.LVfEuj/6FehvCIIlKMCRyVl/uY67bdS','STAFF','SDM & Umum',1,NOW(),NOW()),
(UUID(),'Manager Keu, SDM & Umum','manager@aruraharja.co.id','$2b$12$WS2MtnNdx35TKcNaPD59H.LVfEuj/6FehvCIIlKMCRyVl/uY67bdS','MANAGER','Keu, SDM & Umum',1,NOW(),NOW()),
(UUID(),'Manager Operasional','manager.ops@aruraharja.co.id','$2b$12$WS2MtnNdx35TKcNaPD59H.LVfEuj/6FehvCIIlKMCRyVl/uY67bdS','MANAGER','Operasional',1,NOW(),NOW()),
(UUID(),'Manager Gedung','manager.gedung@aruraharja.co.id','$2b$12$WS2MtnNdx35TKcNaPD59H.LVfEuj/6FehvCIIlKMCRyVl/uY67bdS','MANAGER','Gedung',1,NOW(),NOW()),
(UUID(),'Direktur Operasional','dirops@aruraharja.co.id','$2b$12$WS2MtnNdx35TKcNaPD59H.LVfEuj/6FehvCIIlKMCRyVl/uY67bdS','DIRECTOR_OPS','Direksi',1,NOW(),NOW()),
(UUID(),'Direktur Utama','dirut@aruraharja.co.id','$2b$12$WS2MtnNdx35TKcNaPD59H.LVfEuj/6FehvCIIlKMCRyVl/uY67bdS','PRESIDENT_DIRECTOR','Direksi',1,NOW(),NOW()),
(UUID(),'Finance','finance@aruraharja.co.id','$2b$12$WS2MtnNdx35TKcNaPD59H.LVfEuj/6FehvCIIlKMCRyVl/uY67bdS','FINANCE','Finance',1,NOW(),NOW())
ON DUPLICATE KEY UPDATE
  name=VALUES(name),
  password_hash=VALUES(password_hash),
  role=VALUES(role),
  unit_name=VALUES(unit_name),
  is_active=1,
  updated_at=NOW();

-- Hapus session akun bootstrap supaya password baru langsung berlaku jika file di-import ulang.
DELETE s FROM `aru_siap`.`siap_sessions` s
JOIN `aru_siap`.`siap_users` u ON u.id=s.user_id
WHERE u.email IN (
  'root@aruraharja.co.id','staff@aruraharja.co.id','manager@aruraharja.co.id',
  'manager.ops@aruraharja.co.id','manager.gedung@aruraharja.co.id',
  'dirops@aruraharja.co.id','dirut@aruraharja.co.id','finance@aruraharja.co.id'
);

-- Mode awal Piutang/Utang: posisi ringkas.
INSERT INTO `aru_siap`.`siap_finance_source_modes` (ledger_type,data_mode,updated_by)
VALUES ('RECEIVABLE','SUMMARY',@SIAP_ROOT_ID)
ON DUPLICATE KEY UPDATE ledger_type=VALUES(ledger_type);

INSERT INTO `aru_siap`.`siap_finance_source_modes` (ledger_type,data_mode,updated_by)
VALUES ('PAYABLE','SUMMARY',@SIAP_ROOT_ID)
ON DUPLICATE KEY UPDATE ledger_type=VALUES(ledger_type);

-- Format nomor awal.
-- Semua dapat diedit melalui Root Admin.
INSERT INTO `aru_siap`.`siap_number_formats` (
  id, code, name, document_type, pattern, description,
  is_active, created_by, created_at, updated_at
)
SELECT
  UUID(), 'PKS', 'Perjanjian Kerja Sama',
  'PERJANJIAN_KERJA_SAMA',
  '{seq}/PKS/ARU/{roman_month}/{year}',
  'Format awal Perjanjian Kerja Sama; dapat diedit Root Admin.',
  1, @SIAP_ROOT_ID, NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM `aru_siap`.`siap_number_formats` WHERE code='PKS'
);

INSERT INTO `aru_siap`.`siap_number_formats` (
  id, code, name, document_type, pattern, description,
  is_active, created_by, created_at, updated_at
)
SELECT
  UUID(), 'DIR', 'Surat Keluar Direksi',
  'SURAT_DIREKSI',
  '{seq}/ARU-DIR/{roman_month}/{year}',
  'Format awal surat keluar Direksi; dapat diedit Root Admin.',
  1, @SIAP_ROOT_ID, NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM `aru_siap`.`siap_number_formats` WHERE code='DIR'
);

INSERT INTO `aru_siap`.`siap_number_formats` (
  id, code, name, document_type, pattern, description,
  is_active, created_by, created_at, updated_at
)
SELECT
  UUID(), 'OPS', 'Surat Bagian Operasional',
  'SURAT_OPERASIONAL',
  '{seq}/ARU-OPS/{roman_month}/{year}',
  'Format awal surat Operasional; dapat diedit Root Admin.',
  1, @SIAP_ROOT_ID, NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM `aru_siap`.`siap_number_formats` WHERE code='OPS'
);

INSERT INTO `aru_siap`.`siap_number_formats` (
  id, code, name, document_type, pattern, description,
  is_active, created_by, created_at, updated_at
)
SELECT
  UUID(), 'PO', 'Purchase Order',
  'PURCHASE_ORDER',
  '{seq}/PO/ARU/{roman_month}/{year}',
  'Format awal nomor PO; dapat diedit Root Admin.',
  1, @SIAP_ROOT_ID, NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM `aru_siap`.`siap_number_formats` WHERE code='PO'
);

INSERT INTO `aru_siap`.`siap_number_formats` (
  id, code, name, document_type, pattern, description,
  is_active, created_by, created_at, updated_at
)
SELECT
  UUID(), 'UMUM', 'Surat Keluar Umum',
  'SURAT_UMUM',
  '{seq}/ARU-UM/{roman_month}/{year}',
  'Format awal surat keluar umum; dapat diedit Root Admin.',
  1, @SIAP_ROOT_ID, NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM `aru_siap`.`siap_number_formats` WHERE code='UMUM'
);

-- =====================================================================
-- VERIFIKASI RINGKAS
-- =====================================================================
SELECT name,email,role,unit_name,is_active
FROM `aru_siap`.`siap_users`
WHERE email IN (
  'root@aruraharja.co.id','staff@aruraharja.co.id','manager@aruraharja.co.id',
  'manager.ops@aruraharja.co.id','manager.gedung@aruraharja.co.id',
  'dirops@aruraharja.co.id','dirut@aruraharja.co.id','finance@aruraharja.co.id'
)
ORDER BY FIELD(role,'ROOT_ADMIN','PRESIDENT_DIRECTOR','DIRECTOR_OPS','MANAGER','FINANCE','STAFF'),name;

-- =====================================================================
-- IMPORT SELESAI
-- Verifikasi dilakukan SETELAH import dengan memilih database aru_siap
-- di phpMyAdmin. Lihat file README.md.
-- =====================================================================

