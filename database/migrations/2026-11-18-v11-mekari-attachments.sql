CREATE TABLE IF NOT EXISTS siap_v11_attachment_signing (
  source_attachment_id CHAR(36) PRIMARY KEY,
  requested_by CHAR(36) NOT NULL,
  provider_id VARCHAR(160) NULL UNIQUE,
  status VARCHAR(24) NOT NULL,
  final_attachment_id CHAR(36) NULL UNIQUE,
  next_poll_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (source_attachment_id) REFERENCES siap_attachments(id) ON DELETE RESTRICT,
  FOREIGN KEY (requested_by) REFERENCES siap_users(id) ON DELETE RESTRICT,
  FOREIGN KEY (final_attachment_id) REFERENCES siap_attachments(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
