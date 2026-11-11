-- Apply after routing-target, final-business-flow, document-types, and SPK/invoice.
-- Existing letters keep their original routing. New letters use the Secretariat
-- workflow once an active account with role SECRETARIAT exists.

SET @siap_ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()
    AND TABLE_NAME='siap_letters' AND COLUMN_NAME='uses_secretariat'),
  'SELECT 1',
  'ALTER TABLE siap_letters
    ADD COLUMN uses_secretariat TINYINT(1) NOT NULL DEFAULT 0,
    ADD COLUMN secretariat_review_required TINYINT(1) NOT NULL DEFAULT 0,
    ADD COLUMN sent_date DATE NULL,
    ADD COLUMN source_letter_id CHAR(36) NULL,
    ADD COLUMN source_disposition_id CHAR(36) NULL,
    ADD CONSTRAINT fk_siap_letter_source FOREIGN KEY (source_letter_id) REFERENCES siap_letters(id) ON DELETE SET NULL,
    ADD CONSTRAINT fk_siap_letter_source_disp FOREIGN KEY (source_disposition_id) REFERENCES siap_dispositions(id) ON DELETE SET NULL'
);
PREPARE siap_stmt FROM @siap_ddl;
EXECUTE siap_stmt;
DEALLOCATE PREPARE siap_stmt;

SET @siap_ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()
    AND TABLE_NAME='siap_document_types' AND COLUMN_NAME='secretariat_review_required'),
  'SELECT 1',
  'ALTER TABLE siap_document_types ADD COLUMN secretariat_review_required TINYINT(1) NOT NULL DEFAULT 0'
);
PREPARE siap_stmt FROM @siap_ddl;
EXECUTE siap_stmt;
DEALLOCATE PREPARE siap_stmt;

SET @siap_ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()
    AND TABLE_NAME='siap_dispositions' AND COLUMN_NAME='result_requirement'),
  'SELECT 1',
  'ALTER TABLE siap_dispositions ADD COLUMN result_requirement VARCHAR(24) NOT NULL DEFAULT ''SUMMARY'''
);
PREPARE siap_stmt FROM @siap_ddl;
EXECUTE siap_stmt;
DEALLOCATE PREPARE siap_stmt;

SET @siap_ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()
    AND TABLE_NAME='siap_disposition_actions' AND COLUMN_NAME='result_letter_id'),
  'SELECT 1',
  'ALTER TABLE siap_disposition_actions ADD COLUMN result_letter_id CHAR(36) NULL,
    ADD CONSTRAINT fk_siap_disp_result_letter FOREIGN KEY (result_letter_id) REFERENCES siap_letters(id) ON DELETE SET NULL'
);
PREPARE siap_stmt FROM @siap_ddl;
EXECUTE siap_stmt;
DEALLOCATE PREPARE siap_stmt;
