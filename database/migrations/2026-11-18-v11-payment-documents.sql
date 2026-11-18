-- Apply after 2026-11-17-v11-workflow.sql. Existing checklist and SPB are preserved.
CREATE TABLE IF NOT EXISTS siap_v11_payment_documents (
  letter_id CHAR(36) NOT NULL,
  document_code VARCHAR(12) NOT NULL,
  attachment_id CHAR(36) NOT NULL UNIQUE,
  PRIMARY KEY (letter_id,document_code),
  FOREIGN KEY (letter_id) REFERENCES siap_v11_letters(letter_id) ON DELETE RESTRICT,
  FOREIGN KEY (attachment_id) REFERENCES siap_attachments(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS siap_v11_payment_recipients (
  letter_id CHAR(36) PRIMARY KEY,
  recipient_type VARCHAR(12) NOT NULL,
  FOREIGN KEY (letter_id) REFERENCES siap_v11_letters(letter_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
