CREATE TABLE IF NOT EXISTS siap_v11_notifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  audit_id BIGINT UNSIGNED NOT NULL,
  recipient_user_id CHAR(36) NOT NULL,
  entity_type VARCHAR(16) NOT NULL,
  entity_id CHAR(36) NOT NULL,
  title VARCHAR(255) NOT NULL,
  read_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_v11_notification_recipient (audit_id, recipient_user_id),
  KEY idx_v11_notification_inbox (recipient_user_id, read_at, id),
  FOREIGN KEY (audit_id) REFERENCES siap_audit_logs(id) ON DELETE RESTRICT,
  FOREIGN KEY (recipient_user_id) REFERENCES siap_users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
