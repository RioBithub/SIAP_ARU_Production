-- Existing invoices default to regular payment. Leave their documents and approvals intact.
SET @invoice_payment_columns = CONCAT_WS(', ',
  IF(EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='siap_v11_letters' AND COLUMN_NAME='invoice_persekot_reason'), NULL, 'ADD COLUMN invoice_persekot_reason VARCHAR(1000) NULL'),
  IF(EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='siap_v11_letters' AND COLUMN_NAME='invoice_payment_mode_revision'), NULL, 'ADD COLUMN invoice_payment_mode_revision INT UNSIGNED NOT NULL DEFAULT 0'),
  IF(EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='siap_v11_letters' AND COLUMN_NAME='invoice_payment_review_required'), NULL, 'ADD COLUMN invoice_payment_review_required TINYINT(1) NOT NULL DEFAULT 0')
);
SET @invoice_payment_sql = IF(@invoice_payment_columns = '', 'SELECT 1', CONCAT('ALTER TABLE siap_v11_letters ', @invoice_payment_columns));
PREPARE invoice_payment_stmt FROM @invoice_payment_sql;
EXECUTE invoice_payment_stmt;
DEALLOCATE PREPARE invoice_payment_stmt;
