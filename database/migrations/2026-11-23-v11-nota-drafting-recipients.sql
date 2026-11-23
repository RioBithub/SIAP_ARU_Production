-- Adds Staff drafting assignments and additional recipients without changing existing notes.
SET @nota_drafter_columns = CONCAT_WS(', ',
  IF(EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='siap_v11_letters'
    AND COLUMN_NAME='nota_drafter_user_id'), NULL, 'ADD COLUMN nota_drafter_user_id CHAR(36) NULL'),
  IF(EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='siap_v11_letters'
    AND COLUMN_NAME='nota_draft_instruction'), NULL, 'ADD COLUMN nota_draft_instruction TEXT NULL')
);
SET @nota_drafter_sql = IF(@nota_drafter_columns = '', 'SELECT 1', CONCAT('ALTER TABLE siap_v11_letters ', @nota_drafter_columns));
PREPARE nota_drafter_stmt FROM @nota_drafter_sql;
EXECUTE nota_drafter_stmt;
DEALLOCATE PREPARE nota_drafter_stmt;

CREATE TABLE IF NOT EXISTS siap_v11_nota_recipients (
  letter_id CHAR(36) NOT NULL,
  recipient_user_id CHAR(36) NOT NULL,
  PRIMARY KEY (letter_id, recipient_user_id),
  FOREIGN KEY (letter_id) REFERENCES siap_v11_letters(letter_id) ON DELETE CASCADE,
  FOREIGN KEY (recipient_user_id) REFERENCES siap_users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
