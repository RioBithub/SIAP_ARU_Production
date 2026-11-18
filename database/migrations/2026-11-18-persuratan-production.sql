-- Additive and repeatable on the SIAP ARU MySQL/MariaDB schema.
SET @siap_letter_columns = CONCAT_WS(', ',
  IF(EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='siap_letters' AND COLUMN_NAME='deleted_at'), NULL, 'ADD COLUMN deleted_at DATETIME NULL'),
  IF(EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='siap_letters' AND COLUMN_NAME='deleted_by'), NULL, 'ADD COLUMN deleted_by CHAR(36) NULL'),
  IF(EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='siap_letters' AND COLUMN_NAME='deletion_reason'), NULL, 'ADD COLUMN deletion_reason VARCHAR(1000) NULL'),
  IF(EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='siap_letters' AND COLUMN_NAME='approval_snapshot'), NULL, 'ADD COLUMN approval_snapshot JSON NULL'),
  IF(EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='siap_letters' AND COLUMN_NAME='active_original_attachment_id'), NULL, 'ADD COLUMN active_original_attachment_id CHAR(36) NULL')
);
SET @siap_workflow_ddl = IF(@siap_letter_columns='', 'SELECT 1', CONCAT('ALTER TABLE siap_letters ', @siap_letter_columns));
PREPARE siap_workflow_stmt FROM @siap_workflow_ddl;
EXECUTE siap_workflow_stmt;
DEALLOCATE PREPARE siap_workflow_stmt;

SET @siap_workflow_ddl = IF(
  EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='siap_dispositions' AND COLUMN_NAME='due_time'),
  'SELECT 1', 'ALTER TABLE siap_dispositions ADD COLUMN due_time TIME NULL'
);
PREPARE siap_workflow_stmt FROM @siap_workflow_ddl;
EXECUTE siap_workflow_stmt;
DEALLOCATE PREPARE siap_workflow_stmt;

CREATE TABLE IF NOT EXISTS siap_correspondence_settings (
  setting_key VARCHAR(64) PRIMARY KEY,
  value_json JSON NOT NULL,
  updated_by CHAR(36) NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
