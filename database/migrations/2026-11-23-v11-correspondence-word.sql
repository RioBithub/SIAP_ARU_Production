-- Keep a Word download tied to the PDF version produced from the same content.
SET @sql = IF(
  EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='siap_correspondence_drafts'
    AND COLUMN_NAME='document_snapshot'),
  'SELECT 1',
  'ALTER TABLE siap_correspondence_drafts ADD COLUMN document_snapshot LONGTEXT NULL'
);
PREPARE word_snapshot_stmt FROM @sql;
EXECUTE word_snapshot_stmt;
DEALLOCATE PREPARE word_snapshot_stmt;
