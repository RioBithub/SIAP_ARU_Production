-- ============================================================
-- SIAP ARU v1.5 -> v1.6
-- Workflow Surat Keluar + Lampiran per Proses
-- Database: aru_siap
-- Aman dijalankan pada database existing.
-- ============================================================
USE `aru_siap`;

SET @has_col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA='aru_siap' AND TABLE_NAME='siap_attachments' AND COLUMN_NAME='letter_action_id'
);
SET @sql := IF(
  @has_col=0,
  'ALTER TABLE `aru_siap`.`siap_attachments` ADD COLUMN `letter_action_id` CHAR(36) NULL AFTER `disposition_id`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA='aru_siap' AND TABLE_NAME='siap_attachments' AND INDEX_NAME='idx_siap_attach_action'
);
SET @sql := IF(
  @has_idx=0,
  'ALTER TABLE `aru_siap`.`siap_attachments` ADD INDEX `idx_siap_attach_action` (`letter_action_id`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_fk := (
  SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA='aru_siap' AND CONSTRAINT_NAME='fk_siap_attach_action'
);
SET @sql := IF(
  @has_fk=0,
  'ALTER TABLE `aru_siap`.`siap_attachments` ADD CONSTRAINT `fk_siap_attach_action` FOREIGN KEY (`letter_action_id`) REFERENCES `aru_siap`.`siap_letter_actions`(`id`) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT 'MIGRATION v1.6 OK' AS result;
