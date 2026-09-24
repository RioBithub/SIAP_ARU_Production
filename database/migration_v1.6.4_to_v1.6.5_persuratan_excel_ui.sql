-- =====================================================================
-- SIAP ARU v1.6.4 -> v1.6.5
-- PERSURATAN EXCEL COMPATIBILITY + LEGACY DATA FIELDS + FORMAT ARU
-- Database: aru_siap
-- =====================================================================

USE `aru_siap`;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------
-- A. Metadata import Excel lama pada surat keluar
-- ---------------------------------------------------------------------
SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='aru_siap' AND TABLE_NAME='siap_letters' AND COLUMN_NAME='legacy_import_key');
SET @sql := IF(@has_col=0,
  'ALTER TABLE `aru_siap`.`siap_letters` ADD COLUMN `legacy_import_key` VARCHAR(255) NULL AFTER `cancelled_reason`',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='aru_siap' AND TABLE_NAME='siap_letters' AND COLUMN_NAME='legacy_number_text');
SET @sql := IF(@has_col=0,
  'ALTER TABLE `aru_siap`.`siap_letters` ADD COLUMN `legacy_number_text` VARCHAR(80) NULL AFTER `legacy_import_key`',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='aru_siap' AND TABLE_NAME='siap_letters' AND COLUMN_NAME='legacy_user_input');
SET @sql := IF(@has_col=0,
  'ALTER TABLE `aru_siap`.`siap_letters` ADD COLUMN `legacy_user_input` VARCHAR(180) NULL AFTER `legacy_number_text`',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='aru_siap' AND TABLE_NAME='siap_letters' AND COLUMN_NAME='legacy_file_url');
SET @sql := IF(@has_col=0,
  'ALTER TABLE `aru_siap`.`siap_letters` ADD COLUMN `legacy_file_url` TEXT NULL AFTER `legacy_user_input`',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='aru_siap' AND TABLE_NAME='siap_letters' AND COLUMN_NAME='legacy_sheet_name');
SET @sql := IF(@has_col=0,
  'ALTER TABLE `aru_siap`.`siap_letters` ADD COLUMN `legacy_sheet_name` VARCHAR(150) NULL AFTER `legacy_file_url`',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='aru_siap' AND TABLE_NAME='siap_letters' AND COLUMN_NAME='legacy_row_no');
SET @sql := IF(@has_col=0,
  'ALTER TABLE `aru_siap`.`siap_letters` ADD COLUMN `legacy_row_no` INT NULL AFTER `legacy_sheet_name`',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='aru_siap' AND TABLE_NAME='siap_letters' AND COLUMN_NAME='legacy_number_conflict');
SET @sql := IF(@has_col=0,
  'ALTER TABLE `aru_siap`.`siap_letters` ADD COLUMN `legacy_number_conflict` TINYINT(1) NOT NULL DEFAULT 0 AFTER `legacy_row_no`',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA='aru_siap' AND TABLE_NAME='siap_letters' AND INDEX_NAME='uq_siap_letters_legacy_import_key');
SET @sql := IF(@has_idx=0,
  'ALTER TABLE `aru_siap`.`siap_letters` ADD UNIQUE INDEX `uq_siap_letters_legacy_import_key` (`legacy_import_key`)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA='aru_siap' AND TABLE_NAME='siap_letters' AND INDEX_NAME='idx_siap_letters_legacy_sheet');
SET @sql := IF(@has_idx=0,
  'ALTER TABLE `aru_siap`.`siap_letters` ADD INDEX `idx_siap_letters_legacy_sheet` (`legacy_sheet_name`,`legacy_row_no`)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------
-- B. Format resmi diselaraskan dengan workbook "Form Persuratan ARU.xlsx"
--    Web tetap menampilkan angka urut saja; format lengkap disimpan backend.
-- ---------------------------------------------------------------------
UPDATE `aru_siap`.`siap_number_formats`
SET `name`='Perjanjian Kerja Sama', `pattern`='P/{seq}/AR/{year}',
    `description`='Referensi workbook ARU: P/ Nomor Surat / AR / tahun.'
WHERE `document_type`='PERJANJIAN_KERJA_SAMA' OR `code`='PKS';

UPDATE `aru_siap`.`siap_number_formats`
SET `name`='Surat Keluar Direksi', `pattern`='Dir/{seq}/AR/{year}',
    `description`='Referensi workbook ARU: Dir/ Nomor Surat / AR / tahun.'
WHERE `document_type`='SURAT_DIREKSI' OR `code`='DIR';

UPDATE `aru_siap`.`siap_number_formats`
SET `name`='Surat Bagian Operasional', `pattern`='Oprsl/{seq}/AR/{year}',
    `description`='Referensi workbook ARU: Oprsl/ No. Surat / AR / tahun.'
WHERE `document_type`='SURAT_OPERASIONAL' OR `code`='OPS';

UPDATE `aru_siap`.`siap_number_formats`
SET `name`='Purchase Order', `pattern`='PO/{seq}/AR/{year}',
    `description`='Referensi workbook ARU: PO/ No. Surat / AR / tahun.'
WHERE `document_type`='PURCHASE_ORDER' OR `code`='PO';

UPDATE `aru_siap`.`siap_number_formats`
SET `name`='Surat Keluar Umum', `pattern`='UM/{seq}/AR/{year}',
    `description`='Referensi workbook ARU: UM/ Nomor Surat / AR / tahun.'
WHERE `document_type`='SURAT_UMUM' OR `code`='UMUM';

SET FOREIGN_KEY_CHECKS = 1;

SELECT 'SIAP ARU v1.6.5 PERSURATAN UPDATE OK' AS result;
