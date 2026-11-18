-- Keep the authenticated owner in siap_sessions.user_id. Existing sessions start in their own account.
SET @siap_account_switch_sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='siap_sessions' AND COLUMN_NAME='impersonated_user_id'
  ),
  'SELECT 1',
  'ALTER TABLE siap_sessions ADD COLUMN impersonated_user_id CHAR(36) NULL'
);
PREPARE siap_account_switch_stmt FROM @siap_account_switch_sql;
EXECUTE siap_account_switch_stmt;
DEALLOCATE PREPARE siap_account_switch_stmt;
