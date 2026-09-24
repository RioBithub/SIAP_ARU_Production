-- =====================================================================
-- SIAP ARU v1.6.3 -> v1.6.4
-- PIUTANG/UTANG QUICK ADJUSTMENT + FINANCE ATTACHMENT DELETE SUPPORT
-- Database: aru_siap
-- =====================================================================

USE `aru_siap`;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS `aru_siap`.`siap_finance_position_adjustments` (
  `id` CHAR(36) NOT NULL,
  `summary_id` CHAR(36) NOT NULL,
  `ledger_type` VARCHAR(20) NOT NULL,
  `metric` VARCHAR(30) NOT NULL,
  `adjustment_type` VARCHAR(20) NOT NULL,
  `amount` DECIMAL(18,2) NOT NULL DEFAULT 0,
  `value_before` DECIMAL(18,2) NOT NULL DEFAULT 0,
  `value_after` DECIMAL(18,2) NOT NULL DEFAULT 0,
  `data_date` DATE NOT NULL,
  `note` VARCHAR(2000) NOT NULL,
  `reversed_adjustment_id` CHAR(36) NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  `created_by` CHAR(36) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_siap_fin_pos_adj_summary` (`summary_id`,`created_at`),
  INDEX `idx_siap_fin_pos_adj_ledger` (`ledger_type`,`created_at`),
  INDEX `idx_siap_fin_pos_adj_metric` (`metric`,`created_at`),
  INDEX `idx_siap_fin_pos_adj_reversed` (`reversed_adjustment_id`),
  CONSTRAINT `fk_siap_fin_pos_adj_summary`
    FOREIGN KEY (`summary_id`) REFERENCES `aru_siap`.`siap_finance_position_summaries`(`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_siap_fin_pos_adj_reversed`
    FOREIGN KEY (`reversed_adjustment_id`) REFERENCES `aru_siap`.`siap_finance_position_adjustments`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_siap_fin_pos_adj_user`
    FOREIGN KEY (`created_by`) REFERENCES `aru_siap`.`siap_users`(`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @has_col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA='aru_siap' AND TABLE_NAME='siap_finance_attachments' AND COLUMN_NAME='position_adjustment_id'
);
SET @sql := IF(@has_col=0,
  'ALTER TABLE `aru_siap`.`siap_finance_attachments` ADD COLUMN `position_adjustment_id` CHAR(36) NULL AFTER `adjustment_id`',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA='aru_siap' AND TABLE_NAME='siap_finance_attachments' AND INDEX_NAME='idx_siap_fin_attach_position_adjustment'
);
SET @sql := IF(@has_idx=0,
  'ALTER TABLE `aru_siap`.`siap_finance_attachments` ADD INDEX `idx_siap_fin_attach_position_adjustment` (`position_adjustment_id`,`created_at`)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_fk := (
  SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA='aru_siap' AND CONSTRAINT_NAME='fk_siap_fin_attach_position_adjustment'
);
SET @sql := IF(@has_fk=0,
  'ALTER TABLE `aru_siap`.`siap_finance_attachments` ADD CONSTRAINT `fk_siap_fin_attach_position_adjustment` FOREIGN KEY (`position_adjustment_id`) REFERENCES `aru_siap`.`siap_finance_position_adjustments`(`id`) ON DELETE CASCADE',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET FOREIGN_KEY_CHECKS = 1;

SELECT 'SIAP ARU v1.6.4 AR/AP UPDATE OK' AS result;
