-- Nota Dinas separates the person drafting from the formal sender and the assigned signature assistant.
SET @nota_columns = CONCAT_WS(', ',
  IF(EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='siap_v11_letters' AND COLUMN_NAME='nota_author_user_id'), NULL, 'ADD COLUMN nota_author_user_id CHAR(36) NULL'),
  IF(EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='siap_v11_letters' AND COLUMN_NAME='nota_signature_assistant_user_id'), NULL, 'ADD COLUMN nota_signature_assistant_user_id CHAR(36) NULL')
);
SET @nota_sql = IF(@nota_columns = '', 'SELECT 1', CONCAT('ALTER TABLE siap_v11_letters ', @nota_columns));
PREPARE nota_stmt FROM @nota_sql;
EXECUTE nota_stmt;
DEALLOCATE PREPARE nota_stmt;
