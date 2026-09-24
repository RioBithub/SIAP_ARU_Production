-- =====================================================================
-- SIAP ARU v1.6 -> v1.6.1
-- FINANCE DAILY UPDATE + YTD MODES + ADJUSTMENT LEDGER + PERIOD CONTROL
-- Database: aru_siap
--
-- Fitur:
-- 1) YTD Manual / Otomatis Bulanan / Basis Manual + Bulanan Terpilih
-- 2) Bulan tidak wajib diisi berurutan
-- 3) Toggle bulan ikut YTD atau tidak
-- 4) Draft / Published untuk data bulanan dan YTD
-- 5) Data per tanggal + update timestamp
-- 6) + Tambah / - Kurangi / Set Total / Reversal
-- 7) Finance history permanen + Audit Log global
-- 8) OPEN / CLOSED periode + reopen dengan alasan
-- 9) Lampiran per adjustment
-- =====================================================================

USE `aru_siap`;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------
-- A. Upgrade siap_finance_monthly_summaries
-- ---------------------------------------------------------------------
SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='aru_siap' AND TABLE_NAME='siap_finance_monthly_summaries' AND COLUMN_NAME='data_date');
SET @sql := IF(@has_col=0,
  'ALTER TABLE `aru_siap`.`siap_finance_monthly_summaries` ADD COLUMN `data_date` DATE NULL AFTER `budget_amount`',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='aru_siap' AND TABLE_NAME='siap_finance_monthly_summaries' AND COLUMN_NAME='include_in_ytd');
SET @sql := IF(@has_col=0,
  'ALTER TABLE `aru_siap`.`siap_finance_monthly_summaries` ADD COLUMN `include_in_ytd` TINYINT(1) NOT NULL DEFAULT 0 AFTER `data_date`',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='aru_siap' AND TABLE_NAME='siap_finance_monthly_summaries' AND COLUMN_NAME='publish_status');
SET @added_publish_status := IF(@has_col=0,1,0);
SET @sql := IF(@has_col=0,
  'ALTER TABLE `aru_siap`.`siap_finance_monthly_summaries` ADD COLUMN `publish_status` VARCHAR(20) NOT NULL DEFAULT ''DRAFT'' AFTER `include_in_ytd`',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='aru_siap' AND TABLE_NAME='siap_finance_monthly_summaries' AND COLUMN_NAME='period_status');
SET @sql := IF(@has_col=0,
  'ALTER TABLE `aru_siap`.`siap_finance_monthly_summaries` ADD COLUMN `period_status` VARCHAR(20) NOT NULL DEFAULT ''OPEN'' AFTER `publish_status`',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='aru_siap' AND TABLE_NAME='siap_finance_monthly_summaries' AND COLUMN_NAME='closed_at');
SET @sql := IF(@has_col=0,
  'ALTER TABLE `aru_siap`.`siap_finance_monthly_summaries` ADD COLUMN `closed_at` DATETIME NULL AFTER `notes`',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='aru_siap' AND TABLE_NAME='siap_finance_monthly_summaries' AND COLUMN_NAME='closed_by');
SET @sql := IF(@has_col=0,
  'ALTER TABLE `aru_siap`.`siap_finance_monthly_summaries` ADD COLUMN `closed_by` CHAR(36) NULL AFTER `closed_at`',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA='aru_siap' AND TABLE_NAME='siap_finance_monthly_summaries' AND INDEX_NAME='idx_siap_fin_summary_publish');
SET @sql := IF(@has_idx=0,
  'ALTER TABLE `aru_siap`.`siap_finance_monthly_summaries` ADD INDEX `idx_siap_fin_summary_publish` (`publish_status`,`period_month`)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA='aru_siap' AND TABLE_NAME='siap_finance_monthly_summaries' AND INDEX_NAME='idx_siap_fin_summary_ytd');
SET @sql := IF(@has_idx=0,
  'ALTER TABLE `aru_siap`.`siap_finance_monthly_summaries` ADD INDEX `idx_siap_fin_summary_ytd` (`include_in_ytd`,`period_month`)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_fk := (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA='aru_siap' AND CONSTRAINT_NAME='fk_siap_fin_summary_closed');
SET @sql := IF(@has_fk=0,
  'ALTER TABLE `aru_siap`.`siap_finance_monthly_summaries` ADD CONSTRAINT `fk_siap_fin_summary_closed` FOREIGN KEY (`closed_by`) REFERENCES `aru_siap`.`siap_users`(`id`) ON DELETE SET NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Pertahankan data lama agar tetap terlihat setelah upgrade.
-- include_in_ytd sengaja tetap 0: Finance yang menentukan bulan mana yang masuk YTD.
SET @sql := IF(@added_publish_status=1,
  'UPDATE `aru_siap`.`siap_finance_monthly_summaries` SET `publish_status`=''PUBLISHED'', `updated_at`=`updated_at` WHERE (`income_amount`<>0 OR `expense_amount`<>0 OR `budget_amount`<>0 OR `notes` IS NOT NULL)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE `aru_siap`.`siap_finance_monthly_summaries`
SET `data_date` = CASE
  WHEN `period_month` = DATE_FORMAT(CURDATE(),'%Y-%m-01') THEN CURDATE()
  ELSE LAST_DAY(`period_month`)
END,
    `updated_at`=`updated_at`
WHERE `data_date` IS NULL;

-- ---------------------------------------------------------------------
-- B. Posisi Tahun Berjalan / YTD
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `aru_siap`.`siap_finance_yearly_summaries` (
  `id` CHAR(36) NOT NULL,
  `summary_year` SMALLINT NOT NULL,
  `calculation_mode` VARCHAR(30) NOT NULL DEFAULT 'HYBRID',
  `base_through_month` TINYINT NULL,
  `base_income_amount` DECIMAL(18,2) NOT NULL DEFAULT 0,
  `base_expense_amount` DECIMAL(18,2) NOT NULL DEFAULT 0,
  `annual_budget_amount` DECIMAL(18,2) NOT NULL DEFAULT 0,
  `as_of_date` DATE NULL,
  `notes` TEXT NULL,
  `publish_status` VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  `created_by` CHAR(36) NOT NULL,
  `updated_by` CHAR(36) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_siap_fin_yearly_year` (`summary_year`),
  INDEX `idx_siap_fin_yearly_publish` (`publish_status`,`summary_year`),
  CONSTRAINT `fk_siap_fin_yearly_created` FOREIGN KEY (`created_by`) REFERENCES `aru_siap`.`siap_users`(`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_siap_fin_yearly_updated` FOREIGN KEY (`updated_by`) REFERENCES `aru_siap`.`siap_users`(`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- C. Ledger adjustment Finance
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `aru_siap`.`siap_finance_adjustments` (
  `id` CHAR(36) NOT NULL,
  `summary_id` CHAR(36) NOT NULL,
  `metric` VARCHAR(20) NOT NULL,
  `adjustment_type` VARCHAR(20) NOT NULL,
  `amount` DECIMAL(18,2) NOT NULL DEFAULT 0,
  `value_before` DECIMAL(18,2) NOT NULL DEFAULT 0,
  `value_after` DECIMAL(18,2) NOT NULL DEFAULT 0,
  `data_date` DATE NOT NULL,
  `include_in_ytd_snapshot` TINYINT(1) NOT NULL DEFAULT 0,
  `note` VARCHAR(2000) NOT NULL,
  `reversed_adjustment_id` CHAR(36) NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  `created_by` CHAR(36) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_siap_fin_adj_summary` (`summary_id`,`created_at`),
  INDEX `idx_siap_fin_adj_metric` (`metric`,`created_at`),
  INDEX `idx_siap_fin_adj_reversed` (`reversed_adjustment_id`),
  CONSTRAINT `fk_siap_fin_adj_summary` FOREIGN KEY (`summary_id`) REFERENCES `aru_siap`.`siap_finance_monthly_summaries`(`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_siap_fin_adj_reversed` FOREIGN KEY (`reversed_adjustment_id`) REFERENCES `aru_siap`.`siap_finance_adjustments`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_siap_fin_adj_user` FOREIGN KEY (`created_by`) REFERENCES `aru_siap`.`siap_users`(`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- D. Lampiran per adjustment
-- ---------------------------------------------------------------------
SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='aru_siap' AND TABLE_NAME='siap_finance_attachments' AND COLUMN_NAME='adjustment_id');
SET @sql := IF(@has_col=0,
  'ALTER TABLE `aru_siap`.`siap_finance_attachments` ADD COLUMN `adjustment_id` CHAR(36) NULL AFTER `ledger_summary_id`',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA='aru_siap' AND TABLE_NAME='siap_finance_attachments' AND INDEX_NAME='idx_siap_fin_attach_adjustment');
SET @sql := IF(@has_idx=0,
  'ALTER TABLE `aru_siap`.`siap_finance_attachments` ADD INDEX `idx_siap_fin_attach_adjustment` (`adjustment_id`,`created_at`)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_fk := (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA='aru_siap' AND CONSTRAINT_NAME='fk_siap_fin_attach_adjustment');
SET @sql := IF(@has_fk=0,
  'ALTER TABLE `aru_siap`.`siap_finance_attachments` ADD CONSTRAINT `fk_siap_fin_attach_adjustment` FOREIGN KEY (`adjustment_id`) REFERENCES `aru_siap`.`siap_finance_adjustments`(`id`) ON DELETE CASCADE',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET FOREIGN_KEY_CHECKS = 1;

SELECT 'SIAP ARU v1.6.1 FINANCE UPDATE OK' AS result;
